import Link from "next/link";
import { AddressHero } from "@/components/AddressHero";
import { Mechanism } from "@/components/Mechanism";
import { LiveDeals } from "@/components/LiveDeals";
import "./landing.css";

const FAILS = [
  { code: "NOT_REFUNDABLE", title: "A merchant asks to be paid straight to a wallet", body: "The user's intent requires refundability, a plain HSP checkout cannot refund, so the paying agent never signs." },
  { code: "CART_HASH_MISMATCH", title: "The cart is altered on the way", body: "Swap pay_to in transit and the merchant's ES256K signature no longer covers the cart. Refused before any signature exists." },
  { code: "REPUTATION_TOO_LOW", title: "A provider with a bad settlement record", body: "Reputation only counts escrows that actually settled, written by the factory to ERC-8004. Below the floor, no deal." },
  { code: "NO DELIVERY", title: "The provider goes silent", body: "Nothing committed by the deadline: anyone can finalize, the escrow refunds in full. No arbiter needed." },
  { code: "2 OF 3 RULING", title: "The deliverable is filler", body: "The buyer disputes, three validators on three different model families judge the hash-committed evidence, the vault pays what they rule." },
  { code: "OVER_BUDGET", title: "An agent tries to spend past its mandate", body: "Per-deal cap and total budget come from the user's signed intent. The verifier is code, not a prompt." },
];

export default function Landing() {
  return (
    <main>
      <AddressHero />

      <section className="wrap block" id="how">
        <div className="sec-head">
          <p className="eyebrow"><i />How it works</p>
          <h2 className="h2">HSP moves money in one transfer.<br />Proviso decides where it ends up.</h2>
          <p className="lede">
            HashKey&apos;s HSP gateway settles an agent&apos;s AP2 Payment Mandate as a single relayed transfer to the cart&apos;s pay_to. Proviso
            makes pay_to an escrow that does not exist yet: its address is the hash of the deal&apos;s terms. The payer&apos;s EIP-3009 signature
            names that address, so the money is bound to the terms before it moves.
          </p>
        </div>
        <Mechanism />
        <div className="three">
          <div>
            <p className="num">01</p>
            <h3 className="h3">Agree in AP2, over A2A</h3>
            <p className="dim">The provider agent answers a task with an AP2 Cart Mandate issued through HSP, plus the deal terms. The paying agent re-derives the vault and checks every term against the user&apos;s signed intent.</p>
          </div>
          <div>
            <p className="num">02</p>
            <h3 className="h3">Settle through the HSP gateway</h3>
            <p className="dim">The payment goes through HSP unchanged; it simply lands in the escrow. Each deal records who broadcast the funding transaction, so a gateway settlement can never be confused with any other.</p>
          </div>
          <div>
            <p className="num">03</p>
            <h3 className="h3">Release, refund, or rule</h3>
            <p className="dim">Delivery and acceptance are EIP-712 signatures. Silence releases, a missed deadline refunds, a dispute goes to the validators named in the terms through the ERC-8004 ValidationRegistry.</p>
          </div>
        </div>
      </section>

      <section className="wrap block">
        <div className="sec-head">
          <p className="eyebrow"><i />The refusals are the product</p>
          <h2 className="h2">Every way an agent payment fails,<br />decided by code, not by trust.</h2>
        </div>
        <div className="fails">
          {FAILS.map((f) => (
            <div className="fail" key={f.code}>
              <p className="code">{f.code}</p>
              <h3 className="h3">{f.title}</h3>
              <p className="dim">{f.body}</p>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 28 }}>
          <Link className="btn" href="/run"><i />Trigger one live</Link>
        </div>
      </section>

      <section className="wrap block">
        <div className="sec-head row">
          <div>
            <p className="eyebrow"><i />Live</p>
            <h2 className="h2">Recent escrows</h2>
          </div>
          <Link className="small dim" href="/deals">All deals →</Link>
        </div>
        <LiveDeals />
      </section>

      <section className="wrap block">
        <div className="sec-head">
          <p className="eyebrow"><i />For builders</p>
          <h2 className="h2">Any agent can sell over HSP<br />without its own merchant onboarding.</h2>
          <p className="lede">Proviso is the merchant of record; the escrow guarantees the provider gets paid for delivered work. Register an ERC-8004 identity, point it at your A2A endpoint, and quote.</p>
        </div>
        <div className="builders">
          <div className="panel code-card">
            <p className="small dim">@proviso/sdk</p>
            <pre>{`const vault = predictVault({ dealFactory, vaultImpl, terms });
const check = await verifyCart({ cart, terms, intent, ... });
if (!check.ok) throw new Error(check.code); // nothing signed
const { paymentMandate } = await buildPaymentMandate({ cart, account, token });
await new HspPayer({ baseUrl }).submit(flowId, paymentMandate);`}</pre>
          </div>
          <div className="panel code-card">
            <p className="small dim">MCP</p>
            <pre>{`{ "mcpServers": { "proviso": {
  "url": "https://34-93-86-48.sslip.io/mcp" } } }

tools: find_agents · hire · job_status · deal_status
       verify_cart · predict_vault · agent_reputation`}</pre>
          </div>
        </div>
        <div style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link className="btn ghost" href="/builders">SDK, MCP and the A2A extension</Link>
          <Link className="btn ghost" href="/proof">Contracts and proof</Link>
        </div>
      </section>
    </main>
  );
}
