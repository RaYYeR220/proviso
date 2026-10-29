import { createHmac } from "node:crypto";
import { getAddress, parseUnits, type Hex, type LocalAccount } from "viem";
import { HSK } from "../chains.ts";
import { canonicalJson, cartHash, randomHex, sha256Hex } from "./crypto.ts";
import { hspRequest, X402_METHOD } from "./merchant.ts";
import type {
  CartMandate,
  Eip3009Authorization,
  HspNetwork,
  HspToken,
  PaymentMandate,
  PaymentMandateContents,
  Permit2Authorization,
  X402PaymentPayload,
} from "./types.ts";

const TRANSFER_WITH_AUTHORIZATION = [
  { name: "from", type: "address" },
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" },
  { name: "nonce", type: "bytes32" },
] as const;

const PERMIT2_TYPES = {
  TokenPermissions: [
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  PermitTransferFrom: [
    { name: "permitted", type: "TokenPermissions" },
    { name: "spender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export interface BuiltPaymentMandate {
  paymentMandate: PaymentMandate;
  payload: X402PaymentPayload;
  authorization: Eip3009Authorization | Permit2Authorization;
  signature: Hex;
}

/**
 * Payer side: signs the token authorization for a cart (EIP-3009 for USDC-family tokens, Permit2 for the rest),
 * wraps it as an x402 v2 payload and returns the AP2 Payment Mandate the HSP gateway accepts.
 * The signature's recipient is the cart's `pay_to` — for USDC.e it is part of the signed message.
 */
export async function buildPaymentMandate(input: {
  cart: CartMandate;
  account: LocalAccount;
  token: HspToken;
  /** EIP-3009 bytes32 nonce or Permit2 uint256 nonce; random when omitted. */
  nonce?: Hex | bigint;
  validForSeconds?: number;
  now?: number;
}): Promise<BuiltPaymentMandate> {
  const { cart, account, token } = input;
  const method = cart.contents.payment_request.method_data.find((m) => m.supported_methods === X402_METHOD);
  if (!method) throw new Error("cart has no x402 payment method");
  if (getAddress(method.data.contract_address) !== getAddress(token.address) || method.data.chain_id !== token.chain_id) {
    throw new Error("cart token does not match the token to pay with");
  }
  const payTo = getAddress(method.data.pay_to);
  const total = cart.contents.payment_request.details.total;
  const value = parseUnits(total.amount.value, token.decimals);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const until = now + (input.validForSeconds ?? 300);

  let authorization: Eip3009Authorization | Permit2Authorization;
  let signature: Hex;
  if (token.payment_protocol === "eip3009") {
    const nonce = (typeof input.nonce === "string" ? input.nonce : `0x${randomHex(32)}`) as Hex;
    authorization = {
      from: account.address,
      to: payTo,
      value: value.toString(),
      validAfter: String(now),
      validBefore: String(until),
      nonce,
    };
    signature = await account.signTypedData({
      domain: { name: token.name, version: token.version, chainId: token.chain_id, verifyingContract: token.address },
      types: { TransferWithAuthorization: TRANSFER_WITH_AUTHORIZATION },
      primaryType: "TransferWithAuthorization",
      message: { from: account.address, to: payTo, value, validAfter: BigInt(now), validBefore: BigInt(until), nonce },
    });
  } else {
    const nonce = typeof input.nonce === "bigint" ? input.nonce : BigInt(`0x${randomHex(16)}`);
    authorization = {
      owner: account.address,
      spender: token.permit2_spender,
      permitted: { token: token.address, amount: value.toString() },
      nonce: nonce.toString(),
      deadline: String(until),
    };
    signature = await account.signTypedData({
      domain: { name: "Permit2", chainId: token.chain_id, verifyingContract: HSK.permit2 },
      types: PERMIT2_TYPES,
      primaryType: "PermitTransferFrom",
      message: {
        permitted: { token: token.address, amount: value },
        spender: token.permit2_spender,
        nonce,
        deadline: BigInt(until),
      },
    });
  }

  const payload: X402PaymentPayload = {
    x402Version: 2,
    payload: { signature, authorization },
    accepted: {
      scheme: "exact",
      network: `eip155:${token.chain_id}`,
      asset: token.address,
      amount: value.toString(),
      payTo,
      maxTimeoutSeconds: 3600,
      extra: { protocol: token.payment_protocol, name: token.name, version: token.version },
    },
  };

  const contents: PaymentMandateContents = {
    payment_mandate_id: cart.contents.payment_request.details.id,
    payment_details_id: paymentDetailsId(),
    payment_details_total: { label: "Total", amount: total.amount, pending: false },
    payment_response: {
      request_id: cart.contents.payment_request.details.id,
      method_name: X402_METHOD,
      details: { payment_payload: Buffer.from(JSON.stringify(payload)).toString("base64") },
      shipping_address: null,
      shipping_option: null,
      payer_name: null,
      payer_email: null,
      payer_phone: null,
    },
    merchant_agent: "HashkeyMerchant",
    timestamp: new Date(now * 1000).toISOString(),
  };

  return {
    paymentMandate: { payment_mandate_contents: contents, user_authorization: userAuthorization(cart, contents, account.address, now) },
    payload,
    authorization,
    signature,
  };
}

/** Decodes the x402 payload inside a Payment Mandate. */
export function decodePaymentPayload(m: PaymentMandate): X402PaymentPayload {
  return JSON.parse(Buffer.from(m.payment_mandate_contents.payment_response.details.payment_payload, "base64").toString("utf8"));
}

/**
 * The gateway's `user_authorization`: an HS256 JWT keyed with the payer address string, binding the cart and the
 * payment mandate contents. It carries no cryptographic weight (the EIP-712 token signature does); it is built
 * exactly like the official checkout so the gateway accepts it.
 */
function userAuthorization(cart: CartMandate, contents: PaymentMandateContents, from: string, now: number): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({
    aud: "HashkeyMerchant",
    nonce: `0x${randomHex(32)}`,
    iat: now,
    exp: Math.floor(new Date(cart.contents.cart_expiry).getTime() / 1000),
    iss: from,
    transaction_data: [cartHash(cart.contents), sha256Hex(canonicalJson(contents))],
  });
  const sig = createHmac("sha256", Buffer.from(from)).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

function paymentDetailsId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
  return `${ts}${String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0")}`;
}

export interface HspFlow {
  cartmandate?: CartMandate;
  cart_mandate?: CartMandate;
  multi_pay?: boolean;
  [k: string]: unknown;
}

/** Unauthenticated payer endpoints of the HSP gateway. */
export class HspPayer {
  constructor(readonly config: { baseUrl: string }) {}

  getChainConfig(): Promise<{ networks: HspNetwork[]; tokens: HspToken[] }> {
    return hspRequest(this.config.baseUrl, { method: "GET", path: "/api/v1/payment/chain-config" });
  }

  getFlow(flowId: string): Promise<HspFlow> {
    return hspRequest(this.config.baseUrl, { method: "GET", path: `/api/v1/payment/cart-mandate/flow/${encodeURIComponent(flowId)}` });
  }

  getFlowStatus(flowId: string, paymentDetailsId?: string): Promise<{ status?: string; tx_signature?: Hex; [k: string]: unknown }> {
    return hspRequest(this.config.baseUrl, {
      method: "GET",
      path: `/api/v1/payment/flow/${encodeURIComponent(flowId)}`,
      rawQuery: paymentDetailsId ? `payment_details_id=${encodeURIComponent(paymentDetailsId)}` : undefined,
    });
  }

  submit(
    flowId: string,
    paymentMandate: PaymentMandate,
    opts: { multiPay?: boolean } = {},
  ): Promise<{ flow_id: string; tx_signature?: Hex; metadata?: { status?: string } }> {
    return hspRequest(this.config.baseUrl, {
      method: "POST",
      path: opts.multiPay ? "/api/v1/payment/pay-mandate/multi-pay" : "/api/v1/payment/pay-mandate",
      rawBody: JSON.stringify({ flow_id: flowId, payment_mandate: paymentMandate }),
    });
  }
}
