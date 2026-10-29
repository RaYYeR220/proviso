import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { broadcast, TxReverted, type TxClients } from "../src/chain.ts";
import { fundingStep, needsMarkFunded } from "../src/keeper.ts";
import { fileCourt } from "../src/court.ts";
import { checkWithin } from "../src/agents/acceptance.ts";
import { openDb } from "../src/db.ts";
import type { Ctx } from "../src/context.ts";
import type { VaultState } from "@proviso/sdk";

/** a viem-shaped node error: the full message carries the request arguments (with "nonce: N"), the node's own words
 *  are in `details` */
const nodeError = (details: string) =>
  Object.assign(new Error(`${details}\n\nRequest Arguments:\n  from: 0x99\n  nonce: 7\n\nDetails: ${details}`), { shortMessage: "An error occurred.", details });

function fakeClients(script: { send?: (n: number) => void; receipt?: (n: number, hash: Hex) => { status: string } }) {
  const sent: Hex[] = [];
  let receipts = 0;
  let nonce = 7;
  const c: TxClients = {
    pendingNonce: async () => nonce,
    fees: async () => ({}),
    sign: async ({ nonce: n }) => (`0x${n.toString(16).padStart(4, "0")}${sent.length.toString(16).padStart(4, "0")}` as Hex),
    sendRaw: async (raw) => {
      sent.push(raw);
      script.send?.(sent.length);
      nonce += 1;
    },
    receipt: async (hash) => script.receipt?.(++receipts, hash) ?? { status: "success" },
  };
  return { c, sent };
}

describe("broadcast: a transaction that is out is waited for, never sent again", () => {
  const fast = { retries: 4, pause: () => 0 };

  it("does not re-send on a node error whose message only mentions the nonce in its request arguments", async () => {
    const { c, sent } = fakeClients({ send: () => { throw nodeError("execution reverted: AlreadySettled"); } });
    await expect(broadcast(c, fast)).rejects.toThrow();
    expect(sent).toHaveLength(1);
  });

  it("keeps waiting on the same hash when a receipt wait times out", async () => {
    const { c, sent } = fakeClients({ receipt: (n) => { if (n === 1) throw new Error("Timed out while waiting for transaction"); return { status: "success" }; } });
    await broadcast(c, fast);
    expect(sent).toHaveLength(1);
  });

  it("treats 'already known' as sent, and waits for that transaction", async () => {
    const { c, sent } = fakeClients({ send: () => { throw nodeError("already known"); } });
    await broadcast(c, fast);
    expect(sent).toHaveLength(1);
  });

  it("re-signs with a fresh nonce when a lagging node calls the price or the nonce stale", async () => {
    const { c, sent } = fakeClients({ send: (n) => { if (n === 1) throw nodeError("replacement transaction underpriced"); } });
    await broadcast(c, fast);
    expect(sent).toHaveLength(2);
  });

  it("reports a reverted transaction without sending another", async () => {
    const { c, sent } = fakeClients({ receipt: () => ({ status: "reverted" }) });
    await expect(broadcast(c, fast)).rejects.toBeInstanceOf(TxReverted);
    expect(sent).toHaveLength(1);
  });
});

describe("funding: only the payer's own transfer funds a deal", () => {
  it("waits when the balance is there but the payer's Transfer is not visible yet", () => {
    expect(fundingStep({ balance: 10n, amount: 10n, expired: false, payerTransfer: false })).toBe("wait");
  });
  it("funds once the payer's Transfer is visible", () => {
    expect(fundingStep({ balance: 10n, amount: 10n, expired: false, payerTransfer: true })).toBe("fund");
  });
  it("still opens an underfunded or unattributed vault after the deadline, into its refund path", () => {
    expect(fundingStep({ balance: 3n, amount: 10n, expired: true, payerTransfer: false })).toBe("fund");
    expect(fundingStep({ balance: 0n, amount: 10n, expired: true, payerTransfer: false })).toBe("expire");
  });
});

describe("a vault someone opened before the money landed", () => {
  const state = (over: Partial<VaultState>): VaultState =>
    ({ deployed: true, status: "Open", invalidTerms: false, ...over }) as VaultState;
  it("is marked funded once the balance covers the amount", () => {
    expect(needsMarkFunded(state({}), 10n, 10n)).toBe(true);
  });
  it("is left alone when already funded, invalid, short, or not visible yet", () => {
    expect(needsMarkFunded(state({ status: "Funded" }), 10n, 10n)).toBe(false);
    expect(needsMarkFunded(state({ invalidTerms: true }), 10n, 10n)).toBe(false);
    expect(needsMarkFunded(state({}), 9n, 10n)).toBe(false);
    expect(needsMarkFunded(state({ deployed: false }), 10n, 10n)).toBe(false);
  });
});

describe("court filing", () => {
  it("files the missing requests on the next pass after one of them failed, with one bundle", async () => {
    const db = openDb(".", ":memory:");
    const vault = "0x00000000000000000000000000000000000000aa";
    db.prepare(
      `INSERT INTO deals (vault, chain_id, provider_id, payer, terms_json, spec_json, cart_json, stage, created_block, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(vault, 177, "shady", "0x01", "{}", "{}", "{}", "disputed", 1, 1, 1);
    const deal = db.prepare("SELECT * FROM deals WHERE vault = ?").get(vault) as never;
    let calls = 0;
    const ctx = {
      cfg: { publicUrl: "https://desk.example", chainId: 177, relayer: {}, deployment: { dealFactory: "0x1", vaultImpl: "0x2", validationRegistry: "0x3" } },
      db,
      chain: {
        publicClient: { getCode: async () => "0x" },
        write: async () => {
          calls += 1;
          if (calls === 2) throw new Error("rpc dropped the request");
          return `0x${calls.toString(16).padStart(64, "0")}`;
        },
      },
    } as unknown as Ctx;
    const terms = { validators: ["0xa1", "0xa2", "0xa3"], providerAgentId: 3n, specHash: "0x00" } as never;
    await expect(fileCourt(ctx, deal, terms)).rejects.toThrow();
    await fileCourt(ctx, deal, terms);
    const rows = db.prepare("SELECT idx FROM court WHERE vault = ? ORDER BY idx").all(vault) as { idx: number }[];
    expect(rows.map((r) => r.idx)).toEqual([0, 1, 2]);
    const bundles = db.prepare("SELECT COUNT(*) AS n FROM events WHERE vault = ? AND kind = 'court-bundle'").get(vault) as { n: number };
    expect(bundles.n).toBe(1);
  });
});

describe("the acceptance check fails closed", () => {
  const ok = { accept: true, score: 90, reasons: ["fine"], floor: [] };
  it("passes a check that finishes inside its budget", async () => {
    expect((await checkWithin(async () => ok, 1000)).accept).toBe(true);
  });
  it("rejects when the check outlives the challenge window", async () => {
    const slow = () => new Promise<typeof ok>((r) => setTimeout(() => r(ok), 300));
    const out = await checkWithin(slow, 30);
    expect(out.accept).toBe(false);
    expect(out.reasons.join(" ")).toMatch(/did not finish/);
  });
  it("rejects when the model call fails", async () => {
    const out = await checkWithin(async () => { throw new Error("venice 503"); }, 1000);
    expect(out.accept).toBe(false);
  });
});
