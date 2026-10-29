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
  { k: "Contracts", v: "54 + 3", s: "Foundry unit + fuzz, plus forks of HSK mainnet USDC.e and USDT" },
  { k: "SDK", v: "42", s: "HSP wire format, JWT, webhooks, every refusal code" },
  { k: "End to end", v: "6 / 6", s: "every scenario on a mainnet fork with live models" },
];

export default function Proof() {
  const rows = Object.entries(DEPLOYMENTS);
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
