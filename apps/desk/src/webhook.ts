import { verifyWebhook } from "@proviso/sdk";
import type { Ctx } from "./context.ts";
import { addEvent, now, type DealRow } from "./db.ts";

const FUNDED_STATES = new Set(["payment-included", "payment-safe", "payment-finalized"]);

/**
 * HSP gateway webhook. Verifies the HMAC signature and timestamp, drops replays (same request_id + status),
 * records the state change on the deal timeline and wakes the keeper when money is on chain. The keeper never
 * trusts the webhook for the amount: it reads the vault's balance and the funding transaction from the chain.
 */
export function handleHspWebhook(ctx: Ctx, rawBody: string, signatureHeader: string | undefined, onFunded: (vault: string) => void) {
  const check = verifyWebhook({ rawBody, signatureHeader, secret: ctx.cfg.hsp.webhookSecret ?? "" });
  if (!check.ok) return { status: 401, body: { ok: false, reason: check.reason } };
  const e = check.event;
  const fresh = ctx.db
    .prepare("INSERT OR IGNORE INTO webhooks (request_id, status, received_at) VALUES (?, ?, ?)")
    .run(String(e.request_id ?? e.payment_request_id), String(e.status), now());
  if (fresh.changes === 0) return { status: 200, body: { ok: true, duplicate: true } };

  const deal = ctx.db
    .prepare("SELECT * FROM deals WHERE json_extract(cart_json, '$.contents.id') = ?")
    .get(String(e.cart_mandate_id)) as DealRow | undefined;
  if (!deal) return { status: 200, body: { ok: true, unknown: true } };
  addEvent(ctx.db, {
    vault: deal.vault,
    jobId: deal.job_id,
    kind: "hsp-status",
    data: { status: e.status, payer: e.payer_address, to: e.to_pay_address, amount: e.amount, token: e.token },
    tx: (e.tx_signature as string | undefined) ?? null,
  });
  if (FUNDED_STATES.has(String(e.status))) onFunded(deal.vault);
  return { status: 200, body: { ok: true } };
}
