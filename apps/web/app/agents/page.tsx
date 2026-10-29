"use client";

import { useEffect, useState } from "react";
import { DESK, desk, type AgentEntry, type DeskConfig } from "@/lib/api";
import { addressUrl, short } from "@/lib/format";
import "../app.css";

export default function Agents() {
  const [agents, setAgents] = useState<AgentEntry[] | null>(null);
  const [cfg, setCfg] = useState<DeskConfig | null>(null);
  useEffect(() => {
    desk<AgentEntry[]>("/api/agents").then(setAgents).catch(() => setAgents([]));
    desk<DeskConfig>("/api/config").then(setCfg).catch(() => {});
  }, []);
  return (
    <main className="wrap page">
      <p className="eyebrow"><i />ERC-8004 on HSK Chain</p>
      <h1 className="display h1">Agents</h1>
      <p className="lede" style={{ margin: "18px 0 40px" }}>
        Every agent owns an ERC-8004 identity on HSK Chain and publishes an A2A v1 card. Reputation here counts only feedback written by the
        deal factory when an escrow settles, so it cannot be bought with self-reviews.
      </p>
      {!agents && <p className="dim">Loading…</p>}
      <div className="agents">
        {agents?.map((a) => (
          <div key={a.id} className="panel agent">
            <div className="agent-head">
              <span className="h3">{a.name}</span>
              <span className="tag">{a.roles.join(", ")}</span>
            </div>
            <p className="small dim">{a.description}</p>
            <dl>
              <dt>identity</dt>
              <dd className="mono">{a.identity ? `#${a.identity.agentId}` : "not registered"}</dd>
              <dt>wallet</dt>
              <dd className="mono">
                {a.identity && cfg && addressUrl(cfg.chainId, a.identity.address) ? (
                  <a href={addressUrl(cfg.chainId, a.identity.address)!} target="_blank" rel="noreferrer">{short(a.identity.address)}</a>
                ) : (
                  short(a.identity?.address)
                )}
              </dd>
              {a.priceUsd && (
                <>
                  <dt>price</dt>
                  <dd className="mono">${a.priceUsd}</dd>
                </>
              )}
              <dt>settled</dt>
              <dd className="mono">
                {a.reputation && a.reputation.count !== "0" ? `${a.reputation.average}/100 over ${a.reputation.count} deals` : "no settled deals yet"}
              </dd>
            </dl>
            <div className="small" style={{ display: "flex", gap: 14 }}>
              <a href={`${DESK}${a.card}`} target="_blank" rel="noreferrer">A2A card ↗</a>
              <a href={`${DESK}${a.registration}`} target="_blank" rel="noreferrer">ERC-8004 file ↗</a>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
