"use client";

import { useEffect, useState } from "react";
import { desk, DESK, type DealDetail, type DeskConfig } from "@/lib/api";
import { addressUrl, HSP_RELAYER, RAIL_LABEL, short, STAGE_LABEL, txUrl, usd } from "@/lib/format";
import { DotAddress } from "./DotAddress";
import { Timeline } from "./Timeline";

const STATES = ["Open", "Funded", "Delivered", "Disputed", "Released", "Refunded", "Resolved"];
const V = ["A", "B", "C"];

export function DealView({ vault }: { vault: string }) {
  const [d, setD] = useState<DealDetail | null>(null);
  const [cfg, setCfg] = useState<DeskConfig | null>(null);
  useEffect(() => {
    desk<DeskConfig>("/api/config").then(setCfg).catch(() => {});
    let on = true;
    const load = () => desk<DealDetail>(`/api/deals/${vault}`).then((x) => on && setD(x)).catch(() => {});
    load();
    const id = setInterval(load, 4000);
    return () => {
      on = false;
      clearInterval(id);
    };
  }, [vault]);

  if (!d) return <p className="dim">Loading escrow…</p>;
  const chainId = cfg?.chainId ?? d.deal.chain_id ?? 0;
  const t = d.deal.terms;
  const status = d.vault?.status ?? "Open";
  const out = d.deal.outcome;
  const link = (tx?: string | null) => (tx ? txUrl(chainId, tx) : null);
  const viaHsp = d.deal.funding_sender && d.deal.funding_sender.toLowerCase() === HSP_RELAYER.toLowerCase();

  return (
    <div className="deal">
      <div className="deal-top">
        <div>
          <p className="eyebrow"><i />Escrow · {d.deal.provider_id} · {STAGE_LABEL[d.deal.stage] ?? d.deal.stage}</p>
          <h1 className="display h2" style={{ marginTop: 12 }}>{usd(t.amount)} held for {d.deal.spec?.skill ?? "a task"}</h1>
        </div>
        <div className="deal-badges">
          <span className={`tag ${viaHsp ? "ok" : ""}`}><i />{d.deal.rail ? RAIL_LABEL[d.deal.rail] : "Not funded yet"}</span>
          {out && <span className={`tag ${out.status === "Released" ? "ok" : "warn"}`}><i />{out.status}{out.status === "Resolved" ? ` · provider ${out.providerSharePct}%` : ""}</span>}
        </div>
      </div>

      <div className="panel addr-panel">
        <DotAddress address={d.deal.vault} label="Escrow address" />
        <div className="addr-meta">
          <span className="small dim">This address is <span className="mono">CREATE2(factory, salt, clone(vaultImpl) ‖ abi.encode(terms))</span>. Any change to the terms below gives a different address.</span>
          {addressUrl(chainId, d.deal.vault) && <a className="small" href={addressUrl(chainId, d.deal.vault)!} target="_blank" rel="noreferrer">Open on explorer ↗</a>}
        </div>
      </div>

      <div className="deal-grid">
        <div className="panel terms">
          <p className="eyebrow"><i />Terms (the vault&apos;s immutable args)</p>
          <dl>
            <dt>payer</dt><dd className="mono">{short(t.payer)}</dd>
            <dt>provider</dt><dd className="mono">{short(t.provider)}</dd>
            <dt>amount</dt><dd className="mono">{usd(t.amount)}</dd>
            <dt>deliver by</dt><dd className="mono">{new Date(Number(t.deliverBy) * 1000).toLocaleString()}</dd>
            <dt>challenge</dt><dd className="mono">{t.challengeWindow}s</dd>
            <dt>court</dt><dd className="mono">{t.courtWindow}s · 2 of 3</dd>
            <dt>fees</dt><dd className="mono">{t.feeBps / 100}% platform · {t.courtFeeBps / 100}% court</dd>
            <dt>validators</dt><dd className="mono">{(t.validators as string[]).map((v) => short(v, 3)).join(" ")}</dd>
            <dt>agent ids</dt><dd className="mono">provider #{t.providerAgentId} · payer #{t.payerAgentId}</dd>
            <dt>spec</dt><dd className="mono"><a href={`${DESK}/evidence/${t.specHash}`} target="_blank" rel="noreferrer">{short(t.specHash, 6)}</a></dd>
            <dt>intent</dt><dd className="mono">{short(t.intentHash, 6)}</dd>
          </dl>
        </div>

        <div className="panel state">
          <p className="eyebrow"><i />Vault state</p>
          <div className="statebar">
            {STATES.map((s) => (
              <span key={s} className={`st ${s === status ? "on" : ""}`}>{s}</span>
            ))}
          </div>
          {out?.toProvider !== undefined && (
            <div className="split">
              <p className="small dim">Settlement</p>
              <div className="split-row"><span>Provider</span><b className="mono">{usd(out.toProvider)}</b></div>
              <div className="split-row"><span>Payer refund</span><b className="mono">{usd(out.toPayer)}</b></div>
              <div className="split-row"><span>Platform fee</span><b className="mono">{usd(out.fee)}</b></div>
              {Number(out.courtFee) > 0 && <div className="split-row"><span>Validators</span><b className="mono">{usd(out.courtFee)}</b></div>}
              {link(out.tx) && <a className="small" href={link(out.tx)!} target="_blank" rel="noreferrer">Settlement tx ↗</a>}
            </div>
          )}
          {d.deal.funding_tx && (
            <p className="small dim" style={{ marginTop: 14 }}>
              Funded by {viaHsp ? "the HSP gateway relayer" : short(d.deal.funding_sender)}{" "}
              {link(d.deal.funding_tx) && <a href={link(d.deal.funding_tx)!} target="_blank" rel="noreferrer">↗</a>}
            </p>
          )}
        </div>
      </div>

      {d.court.length > 0 && (
        <div className="panel court">
          <p className="eyebrow"><i />Court · ERC-8004 ValidationRegistry</p>
          <div className="votes">
            {d.court.map((c) => (
              <div key={c.idx} className="vote">
                <div className="vote-head">
                  <span className="h3">Validator {V[c.idx]}</span>
                  <b className="vote-bucket">{c.response === null ? "…" : c.response < 0 ? "—" : `${c.response}%`}</b>
                </div>
                <p className="small dim">{c.reasoning ?? "Waiting for a response."}</p>
                <div className="small" style={{ display: "flex", gap: 12 }}>
                  {link(c.request_tx) && <a href={link(c.request_tx)!} target="_blank" rel="noreferrer">request ↗</a>}
                  {link(c.response_tx) && <a href={link(c.response_tx)!} target="_blank" rel="noreferrer">response ↗</a>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="deal-cols">
        <div>
          <p className="eyebrow" style={{ marginBottom: 18 }}><i />Timeline</p>
          <Timeline events={d.events} chainId={chainId} />
        </div>
        <div className="mandates">
          <p className="eyebrow" style={{ marginBottom: 18 }}><i />AP2 mandates</p>
          <details className="panel md">
            <summary>Cart Mandate (merchant, ES256K)</summary>
            <pre>{JSON.stringify(d.deal.cart, null, 2)}</pre>
          </details>
          {d.deal.paymentMandate && (
            <details className="panel md">
              <summary>Payment Mandate (payer, x402 v2 payload)</summary>
              <pre>{JSON.stringify(d.deal.paymentMandate, null, 2)}</pre>
            </details>
          )}
          {d.deal.delivery && (
            <a className="panel md" href={d.deal.delivery.uri} target="_blank" rel="noreferrer">Deliverable (hash-committed) ↗</a>
          )}
        </div>
      </div>
    </div>
  );
}
