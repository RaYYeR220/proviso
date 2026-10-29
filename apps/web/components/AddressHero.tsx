"use client";

import { useEffect, useMemo, useState } from "react";
import { keccak256, toHex, type Address } from "viem";
import { predictVault, type Terms } from "@/lib/terms";
import { AGENTS, DEPLOYMENT } from "@/lib/deployment";
import { DotAddress } from "./DotAddress";

const PROVIDERS: { name: string; address: Address; id: bigint }[] = [
  { name: "Auditor agent", address: AGENTS.auditor, id: 1n },
  { name: "Localizer agent", address: AGENTS.localizer, id: 3n },
  { name: "Analyst agent", address: AGENTS.analyst, id: 2n },
];
const PRICES = [
  { label: "0.05 USDC.e", amount: 50_000n },
  { label: "0.25 USDC.e", amount: 250_000n },
  { label: "12 USDC.e", amount: 12_000_000n },
];
const DUE = [
  { label: "2 hours", s: 7200n },
  { label: "24 hours", s: 86_400n },
  { label: "7 days", s: 604_800n },
];
const EPOCH = 1_793_000_000n;

/**
 * The real derivation: these chips change a field of the deal terms, and the vault address below is recomputed
 * in the browser exactly as DealFactory.predict computes it on chain (CREATE2 over a clone whose immutable args
 * are the ABI-encoded terms).
 */
export function AddressHero() {
  const [t, setT] = useState({ provider: 0, price: 0, due: 0 });
  useEffect(() => {
    const id = setTimeout(() => setT((x) => ({ ...x, price: 1 })), 3300);
    return () => clearTimeout(id);
  }, []);

  const vault = useMemo(() => {
    const p = PROVIDERS[t.provider]!;
    const terms: Terms = {
      payer: AGENTS.paymentAgent,
      provider: p.address,
      token: DEPLOYMENT.usdc,
      amount: PRICES[t.price]!.amount,
      deliverBy: EPOCH + DUE[t.due]!.s,
      challengeWindow: 120,
      courtWindow: 600,
      feeBps: 100,
      courtFeeBps: 300,
      validators: AGENTS.validators,
      providerAgentId: p.id,
      payerAgentId: 5n,
      specHash: keccak256(toHex("audit TipJar")),
      intentHash: keccak256(toHex("user intent")),
      salt: keccak256(toHex("deal-hero")),
    };
    return predictVault({ dealFactory: DEPLOYMENT.dealFactory, vaultImpl: DEPLOYMENT.vaultImpl, terms });
  }, [t]);

  const cycle = (k: keyof typeof t, n: number) => setT((x) => ({ ...x, [k]: (x[k] + 1) % n }));

  return (
    <section className="wrap" style={{ paddingTop: 32 }}>
      <div className="hero-head">
        <h1 className="display h1" style={{ animation: "rise .8s var(--ease) both" }}>
          Pay the terms,
          <br />
          not the agent.
        </h1>
        <div>
          <p className="lede">
            An agent&apos;s HSP payment lands in an escrow whose address is computed from the deal itself. Change one term and it is a
            different vault. It releases on delivery, refunds on a no-show, and splits on a 2-of-3 validator ruling.
          </p>
          <div style={{ display: "flex", gap: 12, marginTop: 22, flexWrap: "wrap" }}>
            <a className="btn" href="/run">
              <i />
              Watch a deal settle
            </a>
            <a className="btn ghost" href="#how">
              How it works
            </a>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 48 }}>
        <DotAddress address={vault} label="Escrow address derived from the deal terms" />
      </div>
      <div className="hero-chips">
        <span className="small dim" style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 8 }}>
          <i style={{ width: 7, height: 12, background: "var(--amb)", animation: "blink .9s steps(2) infinite" }} />
          Escrow address, derived in your browser from
        </span>
        <button className="chip" onClick={() => cycle("provider", PROVIDERS.length)}>
          provider <b>{PROVIDERS[t.provider]!.name}</b>
        </button>
        <button className="chip" onClick={() => cycle("price", PRICES.length)}>
          price <b>{PRICES[t.price]!.label}</b>
        </button>
        <button className="chip" onClick={() => cycle("due", DUE.length)}>
          deliver by <b>{DUE[t.due]!.label}</b>
        </button>
        <span className="chip">
          court <b>2 of 3</b>
        </span>
      </div>
    </section>
  );
}
