import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createPublicClient, defineChain, http, type Address, type Hex } from "viem";
import {
  predictVault,
  settlementReputation,
  termsFromJson,
  verifyCart,
  type CartMandate,
  type Intent,
  type TermsJson,
} from "@proviso/sdk";

export interface ProvisoMcpOptions {
  /** Base URL of a Proviso desk (the public API the web app uses). */
  deskUrl: string;
}

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });

/**
 * MCP tools over a Proviso desk. Read tools work against any desk; `hire` starts a job that the desk's own
 * payment agent pays for (subject to the desk's demo limits). Nothing here holds or asks for a private key.
 */
export function createProvisoMcp(opts: ProvisoMcpOptions): McpServer {
  const desk = opts.deskUrl.replace(/\/+$/, "");
  const get = async (p: string) => {
    const r = await fetch(`${desk}${p}`);
    if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
    return r.json();
  };
  let cached: Promise<{ chainId: number; deployment: Record<string, Address>; token: { address: Address; decimals: number } }> | undefined;
  const config = () => (cached ??= get("/api/config"));
  const client = async () => {
    const c = await config();
    const rpc = c.chainId === 177 ? "https://mainnet.hsk.xyz" : c.chainId === 133 ? "https://testnet.hsk.xyz" : process.env.PROVISO_RPC_URL ?? "http://127.0.0.1:8645";
    return createPublicClient({
      chain: defineChain({ id: c.chainId, name: `hsk-${c.chainId}`, nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } }),
      transport: http(rpc),
    });
  };

  const server = new McpServer({ name: "proviso", version: "0.1.0" });

  server.registerTool(
    "find_agents",
    {
      title: "Find provider agents",
      description: "Lists the agents behind a Proviso desk with their A2A cards, ERC-8004 identities, prices and settlement-backed reputation.",
      inputSchema: {},
    },
    async () => text(await get("/api/agents")),
  );

  server.registerTool(
    "hire",
    {
      title: "Hire an agent through escrow",
      description:
        "Starts a job: the desk's payment agent signs an AP2 intent for you, buys the work from provider agents over A2A, pays through HSP into a per-deal escrow, and accepts or disputes the result. Returns a job id to follow with job_status. Scenarios: audit, brief, shady, noshow, tampered, direct, reputation.",
      inputSchema: { scenario: z.string().default("audit"), goal: z.string().max(300).optional() },
    },
    async ({ scenario, goal }) => {
      const r = await fetch(`${desk}/api/demo/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario, goal }) });
      return text(await r.json());
    },
  );

  server.registerTool(
    "job_status",
    { title: "Follow a job", description: "Timeline of a job: intent, carts, refusals, payments, deliveries, court votes, settlement.", inputSchema: { jobId: z.string() } },
    async ({ jobId }) => text(await get(`/api/jobs/${encodeURIComponent(jobId)}`)),
  );

  server.registerTool(
    "deal_status",
    {
      title: "Inspect an escrow",
      description: "One deal by vault address: terms, AP2 cart and payment mandates, the HSP funding transaction and who sent it, on-chain vault state, court votes, outcome.",
      inputSchema: { vault: z.string() },
    },
    async ({ vault }) => text(await get(`/api/deals/${vault}`)),
  );

  server.registerTool(
    "predict_vault",
    {
      title: "Derive a deal's escrow address",
      description: "Computes the vault address committed by a set of deal terms (what a merchant must put in the cart's pay_to).",
      inputSchema: { terms: z.record(z.string(), z.any()) },
    },
    async ({ terms }) => {
      const c = await config();
      return text({ vault: predictVault({ dealFactory: c.deployment.dealFactory!, vaultImpl: c.deployment.vaultImpl!, terms: termsFromJson(terms as unknown as TermsJson) }) });
    },
  );

  server.registerTool(
    "verify_cart",
    {
      title: "Check a cart before paying",
      description:
        "Runs Proviso's deterministic cart verifier: merchant signature, cart hash, expiry, token and amount, pay_to equals the escrow derived from the terms, the user's signed intent (budget, caps, validators, refundability) and the provider's settlement reputation. Returns ok or a named refusal code.",
      inputSchema: {
        cart: z.record(z.string(), z.any()),
        terms: z.record(z.string(), z.any()).optional(),
        intent: z.record(z.string(), z.any()),
        intentSignature: z.string(),
        user: z.string(),
        self: z.string(),
        merchantPublicKeyPem: z.string(),
        spentSoFar: z.string().default("0"),
      },
    },
    async (a) => {
      const c = await config();
      const publicClient = await client();
      const terms = a.terms ? termsFromJson(a.terms as unknown as TermsJson) : undefined;
      const rep = terms
        ? await settlementReputation(publicClient as never, {
            reputationRegistry: c.deployment.reputationRegistry!,
            dealFactory: c.deployment.dealFactory!,
            agentId: terms.providerAgentId,
          })
        : { count: 0n, average: 0 };
      const r = await verifyCart({
        cart: a.cart as unknown as CartMandate,
        terms,
        intent: a.intent as unknown as Intent,
        intentSignature: a.intentSignature as Hex,
        user: a.user as Address,
        self: a.self as Address,
        deployment: { dealFactory: c.deployment.dealFactory!, vaultImpl: c.deployment.vaultImpl! },
        token: { address: c.token.address, decimals: c.token.decimals, chain_id: c.chainId },
        merchantPublicKeyPem: a.merchantPublicKeyPem,
        spentSoFar: BigInt(a.spentSoFar),
        providerReputation: rep,
        publicClient: publicClient as never,
      });
      return text(r);
    },
  );

  server.registerTool(
    "agent_reputation",
    {
      title: "Settlement-backed reputation",
      description: "ERC-8004 reputation of an agent counting only feedback written by the Proviso deal factory, i.e. only from escrows that actually settled.",
      inputSchema: { agentId: z.string(), role: z.enum(["provider", "payer"]).default("provider") },
    },
    async ({ agentId, role }) => {
      const c = await config();
      const r = await settlementReputation((await client()) as never, {
        reputationRegistry: c.deployment.reputationRegistry!,
        dealFactory: c.deployment.dealFactory!,
        agentId: BigInt(agentId),
        tag: role === "payer" ? "proviso.payer" : "proviso.settlement",
      });
      return text({ agentId, role, deals: r.count.toString(), average: r.average });
    },
  );

  return server;
}
