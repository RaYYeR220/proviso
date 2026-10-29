import { getAddress, parseUnits, type Address, type Hex, type PublicClient } from "viem";
import { dealFactoryAbi } from "./abi.ts";
import { hashIntent, recoverIntentSigner, type Intent } from "./ap2.ts";
import { verifyCartJwt } from "./hsp/jwt.ts";
import { X402_METHOD } from "./hsp/merchant.ts";
import type { CartMandate, HspToken } from "./hsp/types.ts";
import { predictVault, type Terms } from "./terms.ts";

export type RefusalCode =
  | "INTENT_SIG_INVALID"
  | "INTENT_EXPIRED"
  | "JWT_INVALID"
  | "CART_HASH_MISMATCH"
  | "CART_EXPIRED"
  | "MERCHANT_NOT_ALLOWED"
  | "PAYER_NOT_SELF"
  | "TOKEN_MISMATCH"
  | "AMOUNT_MISMATCH"
  | "NOT_REFUNDABLE"
  | "PAYTO_NOT_VAULT"
  | "INTENT_MISMATCH"
  | "TERMS_INVALID"
  | "OVER_DEAL_CAP"
  | "OVER_BUDGET"
  | "VALIDATOR_NOT_ALLOWED"
  | "REPUTATION_TOO_LOW";

export type VerifyCartResult = { ok: true; vault: Address } | { ok: false; code: RefusalCode; detail: string };

export interface VerifyCartInput {
  cart: CartMandate;
  terms: Terms;
  intent: Intent;
  intentSignature: Hex;
  /** Address that must have signed the intent (the human principal). */
  user: Address;
  /** The paying agent's own address. */
  self: Address;
  deployment: { dealFactory: Address; vaultImpl: Address };
  token: Pick<HspToken, "address" | "decimals" | "chain_id">;
  merchantPublicKeyPem: string;
  /** Base units already committed under this intent. */
  spentSoFar: bigint;
  /** Settlement-backed reputation of the provider (ERC-8004 summary filtered by the deal factory). */
  providerReputation: { count: bigint; average: number };
  /** Quote-time check of the terms; defaults to `DealFactory.validate` on chain. */
  checkTerms?: (t: Terms) => Promise<{ ok: boolean; reason?: string }>;
  publicClient?: PublicClient;
  now?: number;
}

const refuse = (code: RefusalCode, detail: string): VerifyCartResult => ({ ok: false, code, detail });

/**
 * Deterministic gate between a paying agent and its wallet. Every check fails closed; the first failure is
 * returned with a named code and nothing gets signed. The language model never sees keys and never calls this
 * with a different answer in mind: if this says no, no payment mandate exists.
 */
export async function verifyCart(input: VerifyCartInput): Promise<VerifyCartResult> {
  const { cart, terms, intent } = input;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const same = (a: string, b: string) => getAddress(a) === getAddress(b);

  let signer: Address;
  try {
    signer = await recoverIntentSigner(intent, input.intentSignature);
  } catch {
    return refuse("INTENT_SIG_INVALID", "intent signature does not recover");
  }
  if (!same(signer, input.user)) return refuse("INTENT_SIG_INVALID", `intent signed by ${signer}, expected ${input.user}`);
  if (Date.parse(intent.intent_expiry) / 1000 <= now) return refuse("INTENT_EXPIRED", `intent expired at ${intent.intent_expiry}`);

  const jwt = await verifyCartJwt(cart, input.merchantPublicKeyPem, now);
  if (!jwt.ok) return refuse(jwt.reason, "merchant authorization does not verify against the published merchant key");
  if (Date.parse(cart.contents.cart_expiry) / 1000 <= now) return refuse("CART_EXPIRED", `cart expired at ${cart.contents.cart_expiry}`);
  if (intent.merchants?.length && !intent.merchants.includes(cart.contents.merchant_name)) {
    return refuse("MERCHANT_NOT_ALLOWED", `${cart.contents.merchant_name} is not in the intent's merchants`);
  }

  if (!same(terms.payer, input.self) || !same(intent.proviso.payer, input.self)) {
    return refuse("PAYER_NOT_SELF", "the terms or the intent name a different payer");
  }

  const method = cart.contents.payment_request.method_data.find((m) => m.supported_methods === X402_METHOD);
  if (!method) return refuse("TOKEN_MISMATCH", "cart has no x402 payment method");
  const m = method.data;
  if (
    m.chain_id !== input.token.chain_id ||
    !same(m.contract_address, input.token.address) ||
    !same(terms.token, input.token.address) ||
    !same(intent.proviso.token, input.token.address)
  ) {
    return refuse("TOKEN_MISMATCH", `cart token ${m.contract_address} on ${m.chain_id} is not the intent token`);
  }
  const cartAmount = parseUnits(cart.contents.payment_request.details.total.amount.value, input.token.decimals);
  if (cartAmount !== terms.amount) return refuse("AMOUNT_MISMATCH", `cart total ${cartAmount} != terms amount ${terms.amount}`);

  const vault = predictVault({ ...input.deployment, terms });
  if (!same(m.pay_to, vault)) {
    return intent.requires_refundability
      ? refuse("NOT_REFUNDABLE", `pay_to ${m.pay_to} is not the escrow ${vault}; the intent requires refundability`)
      : refuse("PAYTO_NOT_VAULT", `pay_to ${m.pay_to} is not the escrow ${vault}`);
  }
  if (terms.intentHash !== hashIntent(intent)) return refuse("INTENT_MISMATCH", "terms commit to a different intent");

  const check = input.checkTerms ?? ((t: Terms) => onchainValidate(input, t));
  const valid = await check(terms);
  if (!valid.ok) return refuse("TERMS_INVALID", `deal factory rejects the terms: ${valid.reason ?? "unknown"}`);

  if (terms.amount > BigInt(intent.proviso.maxPerDeal)) return refuse("OVER_DEAL_CAP", `${terms.amount} > ${intent.proviso.maxPerDeal}`);
  if (input.spentSoFar + terms.amount > BigInt(intent.proviso.budgetTotal)) {
    return refuse("OVER_BUDGET", `${input.spentSoFar} + ${terms.amount} > ${intent.proviso.budgetTotal}`);
  }
  const allowed = new Set(intent.proviso.allowedValidators.map((a) => getAddress(a)));
  for (const v of terms.validators) {
    if (!allowed.has(getAddress(v))) return refuse("VALIDATOR_NOT_ALLOWED", `${v} is not an allowed validator`);
  }
  const rep = input.providerReputation;
  if (intent.proviso.minProviderReputation > 0 && rep.count > 0n && rep.average < intent.proviso.minProviderReputation) {
    return refuse("REPUTATION_TOO_LOW", `provider settles at ${rep.average}/100 over ${rep.count} deals`);
  }
  return { ok: true, vault };
}

async function onchainValidate(input: VerifyCartInput, t: Terms): Promise<{ ok: boolean; reason?: string }> {
  if (!input.publicClient) return { ok: false, reason: "no public client to validate terms" };
  const [ok, reason] = (await input.publicClient.readContract({
    address: input.deployment.dealFactory,
    abi: dealFactoryAbi,
    functionName: "validate",
    args: [t],
  })) as [boolean, string];
  return { ok, reason };
}
