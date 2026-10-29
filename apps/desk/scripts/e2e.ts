/**
 * Runs every demo scenario against a running desk and checks each ends where it must:
 *   audit     -> two deals released, reputation written
 *   brief     -> one deal released
 *   shady     -> disputed, 2-of-3 court refunds the payer
 *   noshow    -> no delivery, refunded after the deadline
 *   tampered  -> refused (CART_HASH_MISMATCH), nothing signed, no deal funded
 *   direct    -> refused (NOT_REFUNDABLE), nothing signed
 * usage: DESK=http://127.0.0.1:8788 tsx scripts/e2e.ts [scenario ...]
 */
const desk = (process.env.DESK ?? "http://127.0.0.1:8788").replace(/\/+$/, "");
const all = ["audit", "brief", "shady", "noshow", "tampered", "direct"];
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : all;

interface JobView {
  job: { status: string; scenario: string };
  events: { kind: string; data: Record<string, unknown> | null; tx: string | null }[];
  deals: { vault: string; provider_id: string; stage: string; rail: string | null }[];
}

const expectations: Record<string, (j: JobView) => string | null> = {
  audit: (j) => (j.deals.length === 2 && j.deals.every((d) => d.stage === "settled") && j.events.filter((e) => e.kind === "accepted").length === 2 ? null : "expected two accepted, settled deals"),
  brief: (j) => (j.deals.length === 1 && j.deals[0]!.stage === "settled" && j.events.some((e) => e.kind === "accepted") ? null : "expected one accepted deal"),
  shady: (j) => {
    const resolved = j.events.find((e) => e.kind === "resolved");
    return resolved && (resolved.data as { bucket: number }).bucket === 0 && j.deals[0]?.stage === "settled" ? null : "expected a 0% court ruling";
  },
  noshow: (j) => (j.events.some((e) => e.kind === "finalized") && j.deals[0]?.stage === "settled" && !j.events.some((e) => e.kind === "delivered") ? null : "expected a timeout refund"),
  tampered: (j) => (j.events.some((e) => e.kind === "refused" && e.data?.code === "CART_HASH_MISMATCH") && !j.events.some((e) => e.kind === "payment-mandate-signed") ? null : "expected CART_HASH_MISMATCH refusal"),
  direct: (j) => (j.events.some((e) => e.kind === "refused" && e.data?.code === "NOT_REFUNDABLE") && !j.events.some((e) => e.kind === "payment-mandate-signed") ? null : "expected NOT_REFUNDABLE refusal"),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = async (p: string) => (await fetch(`${desk}${p}`)).json();

async function run(scenario: string): Promise<{ scenario: string; ok: boolean; why: string | null; ms: number; vaults: string[] }> {
  const t0 = Date.now();
  const { jobId } = (await (await fetch(`${desk}/api/demo/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario }) })).json()) as { jobId: string };
  let j: JobView;
  for (;;) {
    j = (await get(`/api/jobs/${jobId}`)) as JobView;
    const settled = j.deals.every((d) => ["settled", "expired-unpaid"].includes(d.stage));
    if (j.job.status !== "running" && settled) break;
    if (Date.now() - t0 > 15 * 60_000) break;
    await sleep(4000);
  }
  const why = expectations[scenario]!(j);
  return { scenario, ok: !why, why, ms: Date.now() - t0, vaults: j.deals.map((d) => d.vault) };
}

const results = await Promise.all(wanted.map(run));
for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.scenario.padEnd(9)} ${(r.ms / 1000).toFixed(0).padStart(4)}s  ${r.why ?? ""} ${r.vaults.join(" ")}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
