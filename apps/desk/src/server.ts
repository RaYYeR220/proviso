import express, { type Request, type Response } from "express";
import type { AgentExecutor } from "@a2a-js/sdk/server";
import { DefaultRequestHandler, InMemoryTaskStore } from "@a2a-js/sdk/server";
import { agentCardHandler, jsonRpcHandler, UserBuilder } from "@a2a-js/sdk/server/express";
import { readVault, settlementReputation, PAYER_TAG, type VaultState } from "@proviso/sdk";
import { parseEther, parseUnits, type Address } from "viem";
import { erc20Abi } from "./chain.ts";
import type { Ctx } from "./context.ts";
import { onEvent, type DealRow } from "./db.ts";
import { getEvidence } from "./evidence.ts";
import { facilitatorPayMandate } from "./facilitator.ts";
import type { Keeper } from "./keeper.ts";
import { handleHspWebhook } from "./webhook.ts";
import { agentCard, registrationFile, type CardInput } from "./agents/cards.ts";
import { ProviderExecutor } from "./agents/provider.ts";
import { analyst, auditor, localizer, shady, type SkillDef } from "./agents/skills.ts";
import { SCENARIOS, startJob, type Scenario } from "./agents/payment-agent.ts";
import { publishTask, TaskState } from "./agents/a2a.ts";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createProvisoMcp } from "@proviso/mcp";

const SKILLS: Record<string, SkillDef> = { auditor, analyst, localizer, shady };

/** Agents that act through the registries rather than through A2A tasks answer every message with a pointer. */
class InfoExecutor implements AgentExecutor {
  constructor(private text: string) {}
  cancelTask = async () => {};
  async execute(rc: Parameters<AgentExecutor["execute"]>[0], bus: Parameters<AgentExecutor["execute"]>[1]) {
    publishTask(rc, bus, TaskState.TASK_STATE_REJECTED, this.text);
  }
}

export function agentCatalog(ctx: Ctx): CardInput[] {
  const providers = ctx.cfg.providers.map((p) => {
    const s = SKILLS[p.id]!;
    return {
      id: p.id,
      name: `${p.name} agent`,
      description: s.description,
      roles: ["merchant"],
      skills: [{ id: s.id, name: s.name, description: s.description, examples: s.examples }],
      payout: p.account.address,
      priceUsd: p.priceUsd,
    };
  });
  return [
    ...providers,
    {
      id: "payment-agent",
      name: "Payment agent",
      description: "Hires provider agents for a user under a signed AP2 intent mandate; pays through HSP only into escrow.",
      roles: ["shopper"],
      skills: [{ id: "hire", name: "Hire agents", description: "Plans a job, buys it from provider agents, accepts or disputes the result.", examples: [] }],
    },
    ...ctx.cfg.validators.map((v, i) => ({
      id: `validator-${i}`,
      name: v.name,
      description: `Independent dispute validator (${v.model}). Answers ERC-8004 validation requests for Proviso escrows.`,
      roles: ["validator"],
      skills: [{ id: "adjudicate", name: "Adjudicate", description: "Rules what share of an escrow a provider earned.", examples: [] }],
      payout: v.account.address,
    })),
  ];
}

export function createServer(ctx: Ctx, keeper: Keeper) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type, a2a-version, a2a-extensions");
    if (req.method === "OPTIONS") return void res.sendStatus(204);
    next();
  });

  // HSP webhook needs the raw body for the signature.
  app.post("/hsp/webhook", express.text({ type: "*/*" }), (req, res) => {
    const r = handleHspWebhook(ctx, String(req.body ?? ""), req.header("x-signature"), (vault) => keeper.nudge(vault));
    res.status(r.status).json(r.body);
  });
  app.use(express.json({ limit: "2mb" }));

  // A2A agents
  const catalog = agentCatalog(ctx);
  for (const c of catalog) {
    const card = agentCard(ctx, c);
    const profile = ctx.cfg.providers.find((p) => p.id === c.id);
    const executor: AgentExecutor = profile
      ? new ProviderExecutor(ctx, profile, SKILLS[profile.id]!, keeper)
      : new InfoExecutor(
          c.id === "payment-agent"
            ? "The payment agent buys on behalf of a user; start a job through the Proviso API or MCP server."
            : "This validator acts through the ERC-8004 ValidationRegistry; it does not take A2A tasks.",
        );
    const handler = new DefaultRequestHandler(card, new InMemoryTaskStore(), executor);
    app.use(`/a2a/${c.id}/.well-known/agent-card.json`, agentCardHandler({ agentCardProvider: handler }));
    app.use(`/a2a/${c.id}`, jsonRpcHandler({ requestHandler: handler, userBuilder: UserBuilder.noAuthentication }));
  }

  app.get("/agents/:file", (req, res) => {
    const id = req.params.file.replace(/\.json$/, "");
    const c = catalog.find((x) => x.id === id);
    if (!c) return void res.status(404).json({ error: "unknown agent" });
    res.json(registrationFile(ctx, c));
  });

  app.get("/evidence/:hash", (req, res) => {
    const json = getEvidence(ctx.db, req.params.hash);
    if (!json) return void res.status(404).json({ error: "not found" });
    res.type("application/json").send(json);
  });

  // HSP-compatible facilitator for the self-relay rail
  app.post("/facilitator/pay-mandate", async (req, res) => {
    try {
      res.json(await facilitatorPayMandate(ctx, req.body));
    } catch (e) {
      res.status(400).json({ code: 10001, msg: (e as Error).message });
    }
  });
  app.get("/facilitator/flow/:flowId", (req, res) => {
    const d = ctx.db.prepare("SELECT cart_json, stage, vault FROM deals WHERE flow_id = ?").get(req.params.flowId) as
      | { cart_json: string; stage: string; vault: string }
      | undefined;
    if (!d) return void res.status(404).json({ code: 10003, msg: "payment not found" });
    res.json({ code: 0, msg: "success", data: { cartmandate: JSON.parse(d.cart_json), stage: d.stage, vault: d.vault } });
  });

  // Public API for the web app and the MCP server
  const api = express.Router();
  api.get("/config", (_req, res) => {
    res.json({
      chainId: ctx.cfg.chainId,
      hspMode: ctx.cfg.hspMode,
      deployment: ctx.cfg.deployment,
      token: ctx.cfg.token,
      relayer: ctx.cfg.relayer.address,
      paymentAgent: ctx.cfg.paymentAgent.address,
      demoUser: ctx.cfg.demoUser.address,
      scenarios: SCENARIOS,
      timing: ctx.cfg.timing,
      fees: ctx.cfg.fees,
    });
  });

  api.get("/agents", async (_req, res) => {
    const out = await Promise.all(
      catalog.map(async (c) => {
        const id = ctx.agents[c.id];
        let reputation = null;
        if (id) {
          const tag = c.id === "payment-agent" ? PAYER_TAG : undefined;
          const r = await settlementReputation(ctx.chain.publicClient, {
            reputationRegistry: ctx.cfg.deployment.reputationRegistry,
            dealFactory: ctx.cfg.deployment.dealFactory,
            agentId: BigInt(id.agentId),
            tag,
          }).catch(() => null);
          reputation = r ? { count: r.count.toString(), average: r.average } : null;
        }
        return { ...c, identity: id ?? null, reputation, card: `/a2a/${c.id}/.well-known/agent-card.json`, registration: `/agents/${c.id}.json` };
      }),
    );
    res.json(out);
  });

  const rate = (ip: string) => {
    const hour = Math.floor(Date.now() / 1000) - 3600;
    const day = Math.floor(Date.now() / 1000) - 86400;
    const mine = ctx.db.prepare("SELECT COUNT(*) AS n FROM demo_runs WHERE ip = ? AND ts > ?").get(ip, hour) as { n: number };
    const all = ctx.db.prepare("SELECT COUNT(*) AS n FROM demo_runs WHERE ts > ?").get(day) as { n: number };
    return mine.n < ctx.cfg.demo.perIpPerHour && all.n < ctx.cfg.demo.dailyCap;
  };

  const PAID = new Set(["audit", "brief", "shady", "noshow"]);
  /** Paid scenarios need gas on the relayer and tokens on the paying agent; refusals never move money. */
  const canPay = async (scenario: string) => {
    if (!PAID.has(scenario)) return true;
    const [gas, tokens] = await Promise.all([
      ctx.chain.publicClient.getBalance({ address: ctx.cfg.relayer.address }),
      ctx.chain.publicClient.readContract({ address: ctx.cfg.token.address, abi: erc20Abi, functionName: "balanceOf", args: [ctx.cfg.paymentAgent.address] }) as Promise<bigint>,
    ]);
    const perDeal = parseUnits(ctx.cfg.demo.amountUsd, ctx.cfg.token.decimals) * (scenario === "audit" ? 2n : 1n);
    return gas >= parseEther(process.env.DEMO_MIN_GAS ?? "0.6") && tokens >= perDeal;
  };

  api.post("/demo/run", async (req, res) => {
    const scenario = String(req.body?.scenario ?? "audit") as Scenario;
    if (!(scenario in SCENARIOS)) return void res.status(400).json({ error: "unknown scenario" });
    if (!(await canPay(scenario).catch(() => false))) {
      const recorded = ctx.db
        .prepare("SELECT id FROM jobs WHERE scenario = ? AND status != 'error' ORDER BY created_at DESC LIMIT 1")
        .get(scenario) as { id: string } | undefined;
      return void res.json({ recorded: recorded?.id ?? null, reason: "The demo wallet is out of funds for a paid run; showing the most recent recorded run on this chain." });
    }
    // Refusals move no money and cost no gas, so only paid runs count against the demo limits.
    if (PAID.has(scenario)) {
      const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0]!.trim();
      if (!rate(ip)) return void res.status(429).json({ error: "demo limit reached; recorded runs are on the deals page" });
      ctx.db.prepare("INSERT INTO demo_runs (ip, ts) VALUES (?, ?)").run(ip, Math.floor(Date.now() / 1000));
    }
    res.json({ jobId: startJob(ctx, keeper, scenario, typeof req.body?.goal === "string" ? req.body.goal.slice(0, 300) : undefined) });
  });

  api.get("/jobs", (_req, res) => {
    res.json(ctx.db.prepare("SELECT id, goal, scenario, status, created_at, updated_at FROM jobs ORDER BY created_at DESC LIMIT 50").all());
  });

  api.get("/jobs/:id", (req, res) => {
    const job = ctx.db.prepare("SELECT * FROM jobs WHERE id = ?").get(req.params.id);
    if (!job) return void res.status(404).json({ error: "not found" });
    const events = ctx.db.prepare("SELECT * FROM events WHERE job_id = ? ORDER BY id").all(req.params.id);
    const deals = ctx.db.prepare("SELECT vault, provider_id, stage, rail, scenario FROM deals WHERE job_id = ? ORDER BY created_at").all(req.params.id);
    res.json({ job, events: events.map(parseEvent), deals });
  });

  api.get("/deals", (_req, res) => {
    const rows = ctx.db
      .prepare("SELECT vault, provider_id, job_id, scenario, payer, stage, rail, funding_tx, settled_tx, outcome_json, created_at, updated_at, terms_json FROM deals ORDER BY created_at DESC LIMIT 100")
      .all() as unknown as DealRow[];
    res.json(rows.map((r) => ({ ...r, terms: JSON.parse(r.terms_json), outcome: r.outcome_json ? JSON.parse(r.outcome_json) : null, terms_json: undefined, outcome_json: undefined })));
  });

  api.get("/deals/:vault", async (req, res) => {
    const d = ctx.db.prepare("SELECT * FROM deals WHERE vault = ? COLLATE NOCASE").get(req.params.vault) as DealRow | undefined;
    if (!d) return void res.status(404).json({ error: "not found" });
    let vault: VaultState | null = null;
    try {
      vault = await readVault(ctx.chain.publicClient, d.vault as Address);
    } catch {
      vault = null;
    }
    const events = ctx.db.prepare("SELECT * FROM events WHERE vault = ? COLLATE NOCASE ORDER BY id").all(d.vault);
    const court = ctx.db.prepare("SELECT idx, validator, request_hash, request_tx, response, response_tx, reasoning FROM court WHERE vault = ? ORDER BY idx").all(d.vault);
    res.json({
      deal: {
        ...d,
        terms: JSON.parse(d.terms_json),
        spec: JSON.parse(d.spec_json),
        cart: JSON.parse(d.cart_json),
        paymentMandate: d.payment_mandate_json ? JSON.parse(d.payment_mandate_json) : null,
        delivery: d.delivery_json ? JSON.parse(d.delivery_json) : null,
        outcome: d.outcome_json ? JSON.parse(d.outcome_json) : null,
      },
      vault: vault ? { ...vault } : null,
      events: events.map(parseEvent),
      court,
      explorer: ctx.chain.explorerAddress(d.vault),
    });
  });

  api.get("/stats", (_req, res) => {
    const by = ctx.db.prepare("SELECT stage, COUNT(*) AS n FROM deals GROUP BY stage").all();
    const rails = ctx.db.prepare("SELECT rail, COUNT(*) AS n FROM deals WHERE rail IS NOT NULL GROUP BY rail").all();
    const refusals = ctx.db.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'refused'").get() as { n: number };
    res.json({ byStage: by, byRail: rails, refusals: refusals.n });
  });

  api.get("/stream", (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const off = onEvent((e) => res.write(`data: ${JSON.stringify({ vault: e.vault ?? null, jobId: e.jobId ?? null, kind: e.kind })}\n\n`));
    const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
    req.on("close", () => {
      off();
      clearInterval(ping);
    });
  });
  app.use("/api", api);

  // MCP over streamable HTTP (stateless): the same tools as the stdio server, against this desk.
  app.post("/mcp", async (req, res) => {
    const server = createProvisoMcp({ deskUrl: `http://127.0.0.1:${ctx.cfg.port}` });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.get("/mcp", (_req, res) => void res.status(405).json({ error: "POST JSON-RPC to /mcp (streamable HTTP, stateless)" }));

  app.get("/health", async (_req, res) => {
    try {
      const block = await ctx.chain.publicClient.getBlockNumber();
      res.json({ ok: true, chainId: ctx.cfg.chainId, block: block.toString(), hspMode: ctx.cfg.hspMode });
    } catch (e) {
      res.status(503).json({ ok: false, error: (e as Error).message });
    }
  });

  return app;
}

function parseEvent(e: unknown) {
  const r = e as { data_json: string | null };
  return { ...r, data: r.data_json ? JSON.parse(r.data_json) : null, data_json: undefined };
}
