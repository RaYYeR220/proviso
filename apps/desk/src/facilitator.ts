import { getAddress, hexToSignature, parseAbi, type Address, type Hex } from "viem";
import {
  decodePaymentPayload,
  HSK,
  type Eip3009Authorization,
  type PaymentMandate,
  type Permit2Authorization,
} from "@proviso/sdk";
import type { Ctx } from "./context.ts";
import { addEvent, type DealRow } from "./db.ts";

const fiatTokenAbi = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
]);
const permit2Abi = parseAbi([
  "struct TokenPermissions { address token; uint256 amount; }",
  "struct PermitTransferFrom { TokenPermissions permitted; uint256 nonce; uint256 deadline; }",
  "struct SignatureTransferDetails { address to; uint256 requestedAmount; }",
  "function permitTransferFrom(PermitTransferFrom permit, SignatureTransferDetails transferDetails, address owner, bytes signature)",
]);

/**
 * Self-relay rail: broadcasts a payer's signed HSP Payment Mandate ourselves, exactly as the HSP gateway relayer
 * would (`transferWithAuthorization` / Permit2). Used on testnet and whenever the gateway is unavailable. A deal
 * funded this way is recorded with our relayer as the funding sender and is never labelled as an HSP settlement.
 */
export async function selfRelay(ctx: Ctx, deal: DealRow, pm: PaymentMandate): Promise<Hex> {
  const payload = decodePaymentPayload(pm);
  const a = payload.payload.authorization;
  if (getAddress(payload.accepted.payTo) !== getAddress(deal.vault)) throw new Error("payment mandate does not pay this deal's escrow");
  const sig = payload.payload.signature;
  if (payload.accepted.extra.protocol === "eip3009") {
    const auth = a as Eip3009Authorization;
    if (getAddress(auth.to) !== getAddress(deal.vault)) throw new Error("authorization recipient is not the escrow");
    const { v, r, s } = hexToSignature(sig);
    return ctx.chain.write(ctx.cfg.relayer, {
      address: payload.accepted.asset,
      abi: fiatTokenAbi,
      functionName: "transferWithAuthorization",
      args: [auth.from, auth.to, BigInt(auth.value), BigInt(auth.validAfter), BigInt(auth.validBefore), auth.nonce, Number(v), r, s],
    });
  }
  const auth = a as Permit2Authorization;
  return ctx.chain.write(ctx.cfg.relayer, {
    address: HSK.permit2,
    abi: permit2Abi,
    functionName: "permitTransferFrom",
    args: [
      { permitted: { token: auth.permitted.token, amount: BigInt(auth.permitted.amount) }, nonce: BigInt(auth.nonce), deadline: BigInt(auth.deadline) },
      { to: deal.vault as Address, requestedAmount: BigInt(auth.permitted.amount) },
      auth.owner,
      sig,
    ],
  });
}

/** Mirrors `POST /api/v1/payment/pay-mandate` of the HSP gateway for self-relayed flows. */
export async function facilitatorPayMandate(ctx: Ctx, body: { flow_id?: string; payment_mandate?: PaymentMandate }) {
  const deal = ctx.db.prepare("SELECT * FROM deals WHERE flow_id = ?").get(body.flow_id ?? "") as DealRow | undefined;
  if (!deal || !body.payment_mandate) return { code: 10003, msg: "payment not found" };
  if (deal.stage !== "awaiting-payment") return { code: 40001, msg: "invalid mandate state" };
  const tx = await selfRelay(ctx, deal, body.payment_mandate);
  addEvent(ctx.db, { vault: deal.vault, jobId: deal.job_id, kind: "payment-relayed", data: { rail: "self-relay" }, tx });
  return { code: 0, msg: "success", data: { flow_id: body.flow_id, tx_signature: tx, metadata: { status: "payment-included" } } };
}
