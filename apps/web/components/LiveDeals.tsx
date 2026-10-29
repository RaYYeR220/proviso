"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { desk, type DealSummary } from "@/lib/api";
import { ago, RAIL_LABEL, short, STAGE_LABEL, usd } from "@/lib/format";

const toneOf = (d: DealSummary) => {
  const o = d.outcome?.status;
  if (o === "Released") return "ok";
  if (o === "Refunded" || o === "Resolved") return "warn";
  return "";
};

/** The most recent escrows on the desk, refreshed while the page is open. */
export function LiveDeals({ limit = 8 }: { limit?: number }) {
  const [deals, setDeals] = useState<DealSummary[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let on = true;
    const load = () =>
      desk<DealSummary[]>("/api/deals")
        .then((d) => on && (setDeals(d.slice(0, limit)), setErr(false)))
        .catch(() => on && setErr(true));
    load();
    const id = setInterval(load, 8000);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, [limit]);

  if (err && !deals) return <p className="small dim">The desk is not reachable right now.</p>;
  if (!deals) return <p className="small dim">Loading escrows…</p>;
  if (!deals.length) return <p className="small dim">No deals yet. Run one.</p>;
  return (
    <div className="deal-list">
      {deals.map((d) => {
        const tone = toneOf(d);
        return (
          <Link key={d.vault} href={`/deals/${d.vault}`} className="deal-row">
            <span className="mono">{short(d.vault, 5)}</span>
            <span>{d.provider_id}</span>
            <span className="mono">{usd(d.terms.amount)}</span>
            <span className={`tag ${tone}`}>
              <i />
              {d.outcome?.status ?? STAGE_LABEL[d.stage] ?? d.stage}
              {d.outcome?.status === "Resolved" ? ` ${d.outcome.providerSharePct}%` : ""}
            </span>
            <span className="small dim">{d.rail ? RAIL_LABEL[d.rail] : "—"}</span>
            <span className="small dim">{ago(d.updated_at * 1000)}</span>
          </Link>
        );
      })}
    </div>
  );
}
