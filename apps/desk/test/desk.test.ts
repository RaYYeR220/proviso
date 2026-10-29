import { describe, expect, it } from "vitest";
import { signWebhookForTest } from "@proviso/sdk";
import { openDb, type Db } from "../src/db.ts";
import { handleHspWebhook } from "../src/webhook.ts";
import { railOf } from "../src/keeper.ts";
import { floorChecks } from "../src/agents/acceptance.ts";
import type { Ctx } from "../src/context.ts";

const SECRET = "whsec_test";

function ctxWith(db: Db): Ctx {
  return {
    cfg: { hsp: { webhookSecret: SECRET }, relayer: { address: "0x99375054F10Bd5854bFa850E1a422f4d0D540f07" } },
    db,
  } as unknown as Ctx;
}

function seedDeal(db: Db, cartId: string) {
  db.prepare(
    `INSERT INTO deals (vault, chain_id, provider_id, payer, terms_json, spec_json, cart_json, stage, created_block, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run("0x00000000000000000000000000000000000000aa", 177, "auditor", "0x01", "{}", "{}", JSON.stringify({ contents: { id: cartId } }), "awaiting-payment", 1, 1, 1);
}

const body = (status: string) =>
  JSON.stringify({ event_type: "payment", request_id: "r-1", payment_request_id: "pr-1", cart_mandate_id: "deal-1", status, amount: "0.05" });

describe("HSP webhook", () => {
  it("accepts a signed event, records it and wakes the keeper once funds are on chain", () => {
    const db = openDb(".", ":memory:");
    seedDeal(db, "deal-1");
    const woke: string[] = [];
    const raw = body("payment-included");
    const r = handleHspWebhook(ctxWith(db), raw, signWebhookForTest(SECRET, raw, Math.floor(Date.now() / 1000)), (v) => woke.push(v));
    expect(r.status).toBe(200);
    expect(woke).toEqual(["0x00000000000000000000000000000000000000aa"]);
    expect((db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'hsp-status'").get() as { n: number }).n).toBe(1);
  });

  it("rejects a forged signature without touching state", () => {
    const db = openDb(".", ":memory:");
    seedDeal(db, "deal-1");
    const raw = body("payment-finalized");
    const r = handleHspWebhook(ctxWith(db), raw, signWebhookForTest("attacker", raw, Math.floor(Date.now() / 1000)), () => {
      throw new Error("must not wake");
    });
    expect(r.status).toBe(401);
    expect((db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n).toBe(0);
  });

  it("drops a replay of the same request and status", () => {
    const db = openDb(".", ":memory:");
    seedDeal(db, "deal-1");
    const raw = body("payment-finalized");
    const header = signWebhookForTest(SECRET, raw, Math.floor(Date.now() / 1000));
    let wakes = 0;
    handleHspWebhook(ctxWith(db), raw, header, () => wakes++);
    const second = handleHspWebhook(ctxWith(db), raw, header, () => wakes++);
    expect(second.body).toMatchObject({ duplicate: true });
    expect(wakes).toBe(1);
  });

  it("does not wake the keeper for a failed payment", () => {
    const db = openDb(".", ":memory:");
    seedDeal(db, "deal-1");
    const raw = body("payment-failed");
    let wakes = 0;
    handleHspWebhook(ctxWith(db), raw, signWebhookForTest(SECRET, raw, Math.floor(Date.now() / 1000)), () => wakes++);
    expect(wakes).toBe(0);
  });
});

describe("rail labelling", () => {
  const ctx = ctxWith(openDb(".", ":memory:"));
  it("labels only the HSP gateway relayer as hsp-gateway", () => {
    expect(railOf(ctx, "0x1aaA5E4371aAdf96bEfb5bd2Af4d896FD16915Ea")).toBe("hsp-gateway");
    expect(railOf(ctx, "0x99375054F10Bd5854bFa850E1a422f4d0D540f07")).toBe("self-relay");
    expect(railOf(ctx, "0x0000000000000000000000000000000000000001")).toBe("direct");
  });
});

describe("acceptance floor", () => {
  const audit = { skill: "audit", input: {}, acceptance: "" };
  it("rejects filler without asking a model", () => {
    const filler = JSON.stringify({ summary: "Lorem ipsum dolor sit amet.", findings: [{ severity: "info", title: "x", location: "n/a", detail: "", recommendation: "TBD" }] });
    expect(floorChecks(audit, filler).filter((c) => !c.ok).length).toBeGreaterThan(0);
  });
  it("passes a located, substantive audit", () => {
    const good = JSON.stringify({
      summary: "withdraw() sends ETH before updating balances, allowing reentrancy that drains the contract; sweep() is unprotected.",
      findings: [{ severity: "critical", title: "Reentrancy", location: "TipJar.withdraw", detail: "call before state update", recommendation: "CEI" }],
    });
    expect(floorChecks(audit, good).every((c) => c.ok)).toBe(true);
  });
  it("requires Devanagari for a Hindi localization", () => {
    const spec = { skill: "localize", input: {}, acceptance: "" };
    expect(floorChecks(spec, "This is English").every((c) => c.ok)).toBe(false);
    expect(floorChecks(spec, "TipJar.withdraw में reentrancy की गंभीर समस्या है").every((c) => c.ok)).toBe(true);
  });
});
