import Link from "next/link";
import { DEPLOYMENTS } from "@/lib/deployment";
import { addressUrl, explorerBase } from "@/lib/format";
import "../app.css";

export const metadata = { title: "Proof · Proviso" };

const EVAL = [
  { k: "Quorum correct", v: "20 / 20", s: "pre-registered answer key, 3 model families" },
  { k: "Negative controls", v: "4 / 4", s: "tampered evidence decided without a model" },
  { k: "Injection attempts", v: "2 / 2 resisted", s: "from the provider and from the buyer" },
  { k: "First run", v: "19 / 20", s: "one model error broke a quorum; fixed, both runs published" },
];
const TESTS = [
  { k: "Contracts", v: "70 + 3", s: "Foundry unit + fuzz, plus forks of HSK mainnet USDC.e and USDT" },
  { k: "SDK", v: "42", s: "HSP wire format, JWT, webhooks, every refusal code" },
  { k: "End to end", v: "6 / 6", s: "every scenario on a mainnet fork with live models" },
];

// The live mainnet runs listed in PROOF.md: three settlements and three refusals.
const SETTLED = [
  { vault: "0xfCA9454b2dD8a302960193821156C52b5aBfa581", what: "Market brief", outcome: "released to the provider" },
  { vault: "0xE1877b02596Fa7D2b09aF0595eEf46FDDb42e184", what: "Filler deliverable", outcome: "ruled 0% by three validators, refunded" },
  { vault: "0xC786615d11cdE422161CB6C55c31f01a0B5DC85B", what: "Provider never delivers", outcome: "refunded after the deadline" },
];
const REFUSED = [
  { job: "job-3e69c518-3b63-4d9b-a4e1-ef2f9261749c", what: "Cart tampered in transit", code: "CART_HASH_MISMATCH" },
  { job: "job-0cd6696b-f646-419c-aa93-95c0977d6439", what: "Merchant wants direct payment", code: "NOT_REFUNDABLE" },
  { job: "job-dfb324e8-c89e-4e50-99c3-d11188556a19", what: "Provider with a bad record", code: "REPUTATION_TOO_LOW" },
];

export default function Proof() {
  const rows = Object.entries(DEPLOYMENTS).sort(([a]) => (a === "177" ? -1 : 1));
  return (
    <main className="wrap page">
      <p className="eyebrow"><i />Verify it yourself</p>
      <h1 className="display h1">Proof</h1>
      <p className="lede" style={{ marginTop: 18 }}>
        Every contract is verified, every deal links its transactions, and the claims below are reproducible from the repository.
      </p>

      {rows.map(([chain, d]) => (
        <div key={chain} className="panel proof-block">
          <p className="h3">{chain === "177" ? "HSK Chain mainnet (177)" : "HSK Chain testnet (133)"}</p>
          <dl>
            {Object.entries(d).map(([k, a]) => (
              <div key={k} className="kv">
                <dt>{k}</dt>
                <dd className="mono">
                  {explorerBase(Number(chain)) ? (
                    <a href={addressUrl(Number(chain), a)!} target="_blank" rel="noreferrer">{a}</a>
                  ) : (
                    a
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}

      <div className="panel proof-block">
        <p className="h3">Live on mainnet</p>
        <dl>
          {SETTLED.map((x) => (
            <div key={x.vault} className="kv">
              <dt>{x.what}</dt>
              <dd>
                <Link href={`/deals/${x.vault}`} className="mono">{x.vault}</Link> <span className="small dim">· {x.outcome}</span>
              </dd>
            </div>
          ))}
          {REFUSED.map((x) => (
            <div key={x.job} className="kv">
              <dt>{x.what}</dt>
              <dd>
                <Link href={`/jobs/${x.job}`} className="mono">{x.code}</Link> <span className="small dim">· refused before signing, no money moved</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="stats">
        {[...EVAL, ...TESTS].map((x) => (
          <div key={x.k} className="panel stat">
            <span className="small dim">{x.k}</span>
            <b className="stat-v">{x.v}</b>
            <span className="small dim">{x.s}</span>
          </div>
        ))}
      </div>
      <p className="small dim" style={{ marginTop: 24 }}>
        Sources: <a href="https://github.com/RaYYeR220/proviso">repository</a> · PROOF.md · CLAIMS.md · apps/desk/eval/results.json
      </p>
    </main>
  );
}
