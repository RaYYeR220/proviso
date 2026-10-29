"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { runScenario } from "@/lib/api";

const SCENARIOS = [
  { id: "audit", title: "Audit, then translate", body: "Two agents hired in sequence: a contract audit, then the summary in Hindi. Both escrows release on acceptance.", outcome: "Released ×2" },
  { id: "brief", title: "Market brief", body: "An analyst agent reads the live HSK/USDT pool on HSKSwap and the APRO oracle and writes a brief.", outcome: "Released" },
  { id: "shady", title: "Provider delivers filler", body: "The deliverable fails the acceptance check, the buyer disputes, three validators rule on chain.", outcome: "Ruled 0% · refunded" },
  { id: "noshow", title: "Provider never delivers", body: "The escrow is funded, the provider goes silent, the deadline passes and anyone can trigger the refund.", outcome: "Refunded" },
  { id: "tampered", title: "Cart tampered in transit", body: "Someone swaps pay_to on the way. The merchant signature no longer covers the cart.", outcome: "Refused, nothing signed" },
  { id: "direct", title: "Merchant wants direct payment", body: "A valid HSP cart that pays a wallet instead of an escrow. The user's intent requires refundability.", outcome: "Refused, nothing signed" },
  { id: "reputation", title: "Provider with a bad record", body: "The same unreliable provider again, under an intent that requires a 40/100 settlement record.", outcome: "Refused" },
];

export function RunPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = async (id: string) => {
    setBusy(id);
    setError(null);
    const r: { jobId?: string; recorded?: string | null; reason?: string; error?: string } = await runScenario(id).catch(() => ({ error: "The desk is not reachable." }));
    if (r.jobId) router.push(`/jobs/${r.jobId}`);
    else if (r.recorded) router.push(`/jobs/${r.recorded}?recorded=1`);
    else {
      setError(r.error ?? r.reason ?? "Could not start.");
      setBusy(null);
    }
  };
  return (
    <>
      <div className="scenarios">
        {SCENARIOS.map((s) => (
          <button key={s.id} className="scenario" onClick={() => go(s.id)} disabled={!!busy}>
            <span className="s-title h3">{s.title}</span>
            <span className="dim">{s.body}</span>
            <span className="s-out">
              <span className="mono small">{s.outcome}</span>
              <span className="s-go">{busy === s.id ? "Starting…" : "Run →"}</span>
            </span>
          </button>
        ))}
      </div>
      {error && <p className="small" style={{ color: "var(--bad)", marginTop: 16 }}>{error}</p>}
    </>
  );
}
