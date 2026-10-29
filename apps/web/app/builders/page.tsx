import "../app.css";

export const metadata = { title: "Builders · Proviso" };

const STEPS = [
  {
    t: "Pay a provider safely (paying agent)",
    code: `import { verifyCart, buildPaymentMandate, HspPayer, predictVault } from "@proviso/sdk";

// cart and terms arrive as A2A data parts: ap2.mandates.CartMandate + proviso.terms
const check = await verifyCart({
  cart, terms, intent, intentSignature, user, self: account.address,
  deployment, token, merchantPublicKeyPem, spentSoFar, providerReputation,
  publicClient,
});
if (!check.ok) return refuse(check.code, check.detail); // nothing is signed

const { paymentMandate } = await buildPaymentMandate({ cart, account, token: hspToken });
await new HspPayer({ baseUrl: "https://hsp.hashkey.com" }).submit(flowId, paymentMandate);`,
  },
  {
    t: "Sell through escrow (provider agent)",
    code: `// 1. Register an ERC-8004 identity whose agentURI points at your A2A card.
await identityRegistry.write.register(["https://you.example/agent.json"]);
// 2. Approve the Proviso desk as operator so it can file court requests for you.
await identityRegistry.write.setApprovalForAll([desk, true]);
// 3. Quote: the desk issues the HSP cart with pay_to = predictVault(terms).
// 4. After funding, commit your deliverable:
const sig = await signDelivery(account, { chainId, vault, deliveryHash, uri });`,
  },
  {
    t: "Use it from any MCP client",
    code: `{
  "mcpServers": {
    "proviso": { "url": "https://34-14-151-28.sslip.io/mcp" }
  }
}
// or locally: PROVISO_DESK_URL=... npx tsx packages/mcp/src/stdio.ts`,
  },
];

export default function Builders() {
  return (
    <main className="wrap page">
      <p className="eyebrow"><i />SDK · MCP · A2A</p>
      <h1 className="display h1" style={{ maxWidth: "16ch" }}>Build on conditional settlement.</h1>
      <p className="lede" style={{ marginTop: 18 }}>
        <span className="mono">@proviso/sdk</span> is a TypeScript client for the HSP gateway on both sides (merchant orders, HMAC auth,
        ES256K cart mandates, webhooks; and the payer-side EIP-3009 / Permit2 Payment Mandate the official SDKs do not ship), plus AP2 v0.1
        types, the intent mandate, the cart verifier, vault signers and the vault address derivation.
      </p>
      <div className="steps">
        {STEPS.map((s) => (
          <div key={s.t} className="panel code-step">
            <p className="h3">{s.t}</p>
            <pre>{s.code}</pre>
          </div>
        ))}
      </div>
      <div className="panel" style={{ padding: 24, marginTop: 24 }}>
        <p className="h3" style={{ marginBottom: 10 }}>A2A extension</p>
        <p className="dim small">
          Cards declare AP2 v0.1 (roles), a2a-x402 v0.2 and the Proviso extension, which carries the deal factory, the agent&apos;s ERC-8004 id and
          the merchant-of-record key. Data parts: <span className="mono">proviso.task</span>, <span className="mono">ap2.mandates.CartMandate</span>,{" "}
          <span className="mono">proviso.terms</span>, <span className="mono">ap2.mandates.PaymentMandate</span>, <span className="mono">proviso.delivery</span>.{" "}
          <a href="https://github.com/RaYYeR220/proviso/blob/main/docs/a2a-extension.md">Spec ↗</a>
        </p>
      </div>
    </main>
  );
}
