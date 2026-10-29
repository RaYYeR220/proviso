import { equalHex, hmacHex } from "./crypto.ts";
import type { HspWebhookEvent } from "./types.ts";

export const WEBHOOK_TOLERANCE_SECONDS = 300;

export type WebhookCheck = { ok: true; event: HspWebhookEvent } | { ok: false; reason: string };

/**
 * Verifies an HSP gateway webhook: `X-Signature: t=<unix>,v1=<hex hmac_sha256(secret, t + "." + rawBody)>`.
 * Fails closed on a missing secret, a missing/garbled header, a stale timestamp or a bad signature.
 * Replay protection beyond the time window (dedupe by `request_id` + status) is the receiver's job.
 */
export function verifyWebhook(input: {
  rawBody: string;
  signatureHeader: string | undefined | null;
  secret: string;
  toleranceSeconds?: number;
  now?: number;
}): WebhookCheck {
  if (!input.secret) return { ok: false, reason: "no secret configured" };
  if (!input.signatureHeader) return { ok: false, reason: "missing X-Signature" };
  let t: number | undefined;
  let v1 = "";
  for (const part of input.signatureHeader.split(",")) {
    const p = part.trim();
    if (p.startsWith("t=")) t = Number(p.slice(2));
    else if (p.startsWith("v1=")) v1 = p.slice(3);
  }
  if (!t || !Number.isInteger(t) || !v1) return { ok: false, reason: "malformed X-Signature" };
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS)) return { ok: false, reason: "stale timestamp" };
  if (!equalHex(hmacHex(input.secret, `${t}.${input.rawBody}`), v1)) return { ok: false, reason: "bad signature" };
  try {
    return { ok: true, event: JSON.parse(input.rawBody) as HspWebhookEvent };
  } catch {
    return { ok: false, reason: "body is not JSON" };
  }
}

/** Produces a valid `X-Signature` header; used by tests and the local gateway simulator. */
export function signWebhookForTest(secret: string, rawBody: string, timestamp: number): string {
  return `t=${timestamp},v1=${hmacHex(secret, `${timestamp}.${rawBody}`)}`;
}
