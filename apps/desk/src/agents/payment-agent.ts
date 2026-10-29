import { generateKeyPairSync, randomUUID } from "node:crypto";
import { encodeAbiParameters, getAddress, keccak256, type Address, type Hex } from "viem";
import { Message, TaskState, type Task } from "@a2a-js/sdk";
import { ClientFactory } from "@a2a-js/sdk/client";
import {
  buildCartMandate,
  buildPaymentMandate,
  DATA_KEYS,
  dealVaultAbi,
  EXTENSIONS,
  findData,
  hashIntent,
  HSK,
  HspPayer,
  settlementReputation,
  signAccept,
  signDispute,
  signIntent,
  termsFromJson,
  verifyCart,
  type CartMandate,
  type HspToken,
  type Intent,
  type PaymentMandate,
  type TermsJson,
} from "@proviso/sdk";
import { agentIdOf, type Ctx } from "../context.ts";
import { addEvent, getDeal, now, updateDeal } from "../db.ts";
import { putEvidence } from "../evidence.ts";
import { facilitatorPayMandate } from "../facilitator.ts";
import type { Keeper } from "../keeper.ts";
import type { TaskSpec } from "../merchant.ts";
import { checkDeliverable } from "./acceptance.ts";
import { a2aBase } from "./cards.ts";
import { erc20Abi } from "../chain.ts";
import { SAMPLE_CONTRACT } from "./skills.ts";

export type Scenario = "audit" | "brief" | "shady" | "noshow" | "tampered" | "direct" | "reputation";

export const SCENARIOS: Record<Scenario, { title: string; goal: string }> = {
  audit: { title: "Audit, then translate", goal: "Audit the TipJar contract for security issues, then give me the summary in Hindi." },
  brief: { title: "Market brief", goal: "Brief me on HSK/USDT on HSKSwap: price, oracle deviation and liquidity." },
  shady: { title: "Provider delivers filler", goal: "Audit the TipJar contract (cheapest provider)." },
  noshow: { title: "Provider never delivers", goal: "Audit the TipJar contract (cheapest provider), fast." },
  tampered: { title: "Cart tampered in transit", goal: "Audit the TipJar contract." },
  direct: { title: "Merchant asks to be paid directly", goal: "Buy an audit from a plain HSP checkout." },
  reputation: { title: "Provider with a bad settlement record", goal: "Audit the TipJar contract; only providers that settle well." },
};

interface Step {
  provider: "auditor" | "analyst" | "localizer" | "shady";
  skill: string;
  input: Record<string, unknown>;
  /** Fill the input from the previous step's deliverable. */
  chain?: (prev: string) => Record<string, unknown>;
}

function plan(scenario: Scenario, goal: string): Step[] {
  switch (scenario) {
    case "audit":
      return [
        { provider: "auditor", skill: "audit", input: { name: "TipJar", source: SAMPLE_CONTRACT } },
        {
          provider: "localizer",
          skill: "localize",
          input: {},
          chain: (prev) => {
            const a = JSON.parse(prev) as { summary: string; findings: { severity: string; title: string }[] };
            return { text: `${a.summary}\n\n${a.findings.map((f) => `- [${f.severity}] ${f.title}`).join("\n")}`, language: "Hindi" };
          },
        },
      ];
    case "brief":
      return [{ provider: "analyst", skill: "market-brief", input: { question: goal } }];
    case "shady":
    case "noshow":
    case "tampered":
    case "reputation":
      return [{ provider: scenario === "tampered" ? "auditor" : "shady", skill: "audit", input: { name: "TipJar", source: SAMPLE_CONTRACT } }];
    case "direct":
      return [];
  }
}

/** A stand-in for an ordinary HSP merchant (no escrow), used only by the "direct" scenario. */
const plainMerchant = (() => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
  return {
    name: "Plain Checkout (simulated)",
    privatePem: privateKey.export({ type: "sec1", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
})();

export function merchantKeys(ctx: Ctx): Record<string, string> {
  return { [ctx.cfg.hsp.merchantName]: ctx.cfg.hsp.merchantPublicKeyPem, [plainMerchant.name]: plainMerchant.publicPem };
}

function hspToken(ctx: Ctx): HspToken {
  const t = ctx.cfg.token;
  return {
    chain_id: ctx.cfg.chainId,
    symbol: t.symbol,
    name: t.name,
    address: t.address,
    decimals: t.decimals,
    version: t.version,
    payment_protocol: t.protocol,
    // Permit2 lets only the named spender pull: the HSP relayer on the gateway rail, our relayer when self-relaying.
    permit2_spender: ctx.cfg.hspMode === "gateway" ? HSK.hspRelayer : ctx.cfg.relayer.address,
  };
}

/**
 * The user's standing instruction, signed once by the user's key; deal terms commit to its hash. "Cheapest
 * provider" jobs accept providers with any settlement record; every other job requires 40/100 or better.
 */
export function demoIntent(ctx: Ctx, goal: string, scenario?: Scenario): Intent {
  const unit = 10 ** ctx.cfg.token.decimals;
  return {
    natural_language_description: goal,
    user_cart_confirmation_required: false,
    merchants: null,
    requires_refundability: true,
    intent_expiry: new Date(Date.now() + 3600_000).toISOString(),
    proviso: {
      chainId: ctx.cfg.chainId,
      payer: ctx.cfg.paymentAgent.address,
      token: ctx.cfg.token.address,
      maxPerDeal: String(0.1 * unit),
      budgetTotal: String(0.25 * unit),
      minProviderReputation: scenario === "shady" || scenario === "noshow" ? 0 : 40,
      allowedValidators: ctx.cfg.validators.map((v) => v.account.address),
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const asTask = (r: unknown): Task | undefined => (r && typeof r === "object" && "status" in r ? (r as Task) : undefined);

export function startJob(ctx: Ctx, keeper: Keeper, scenario: Scenario, goal?: string): string {
  const id = `job-${randomUUID()}`;
  const g = goal?.trim() || SCENARIOS[scenario].goal;
  const t = now();
  ctx.db.prepare("INSERT INTO jobs (id, goal, scenario, status, created_at, updated_at) VALUES (?,?,?,?,?,?)").run(id, g, scenario, "running", t, t);
  void runJob(ctx, keeper, id, scenario, g).catch((e) => {
    addEvent(ctx.db, { jobId: id, kind: "job-error", data: { message: String((e as Error).message ?? e).slice(0, 500) } });
    ctx.db.prepare("UPDATE jobs SET status = 'error', updated_at = ? WHERE id = ?").run(now(), id);
  });
  return id;
}

async function runJob(ctx: Ctx, keeper: Keeper, jobId: string, scenario: Scenario, goal: string) {
  const intent = demoIntent(ctx, goal, scenario);
  const intentSig = await signIntent(ctx.cfg.demoUser, intent);
  ctx.db.prepare("UPDATE jobs SET intent_json = ?, intent_sig = ? WHERE id = ?").run(JSON.stringify(intent), intentSig, jobId);
  addEvent(ctx.db, {
    jobId,
    kind: "intent-signed",
    data: {
      user: ctx.cfg.demoUser.address,
      intentHash: hashIntent(intent),
      requiresRefundability: true,
      maxPerDeal: intent.proviso.maxPerDeal,
      budgetTotal: intent.proviso.budgetTotal,
      minProviderReputation: intent.proviso.minProviderReputation,
    },
  });

  if (scenario === "direct") {
    await refusePlainCheckout(ctx, jobId, intent, intentSig);
    return finish(ctx, jobId, "refused");
  }

  let prev = "";
  let spent = 0n;
  const results: unknown[] = [];
  for (const step of plan(scenario, goal)) {
    const input = step.chain ? step.chain(prev) : step.input;
    const r = await hire(ctx, keeper, { jobId, scenario, step: { ...step, input }, intent, intentSig, spent });
    results.push(r);
    if (r.outcome !== "accepted") break;
    spent += r.amount;
    prev = r.content ?? "";
  }
  return finish(ctx, jobId, results.every((r) => (r as { outcome: string }).outcome === "accepted") ? "done" : "done-with-exceptions", results);
}

function finish(ctx: Ctx, jobId: string, status: string, result?: unknown) {
  const json = JSON.stringify(result ?? null, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  ctx.db.prepare("UPDATE jobs SET status = ?, result_json = ?, updated_at = ? WHERE id = ?").run(status, json, now(), jobId);
  addEvent(ctx.db, { jobId, kind: "job-finished", data: { status } });
}

interface HireResult {
  outcome: "accepted" | "disputed" | "refused" | "no-delivery" | "failed";
  vault?: Address;
  amount: bigint;
  content?: string;
}

async function hire(
  ctx: Ctx,
  keeper: Keeper,
  a: { jobId: string; scenario: Scenario; step: Step; intent: Intent; intentSig: Hex; spent: bigint },
): Promise<HireResult> {
  const { cfg } = ctx;
  const ext = { serviceParameters: { "A2A-Extensions": [EXTENSIONS.ap2, EXTENSIONS.x402, EXTENSIONS.proviso].join(",") } };
  const client = await new ClientFactory().createFromUrl(`${a2aBase(ctx, a.step.provider)}/`);
  addEvent(ctx.db, { jobId: a.jobId, kind: "a2a-request", data: { provider: a.step.provider, skill: a.step.skill } });

  const first = asTask(
    await client.sendMessage(
      {
        tenant: "",
        metadata: {},
        configuration: undefined,
        message: Message.fromJSON({
          messageId: randomUUID(),
          role: "ROLE_USER",
          parts: [
            { data: { [DATA_KEYS.task]: { skill: a.step.skill, input: a.step.input, payer: cfg.paymentAgent.address, payerAgentId: agentIdOf(ctx, "payment-agent").toString(), intentHash: hashIntent(a.intent), jobId: a.jobId, scenario: a.scenario } } },
            { data: { [DATA_KEYS.intentMandate]: a.intent } },
          ],
        }),
      },
      ext,
    ),
  );
  if (!first || first.status?.state !== TaskState.TASK_STATE_INPUT_REQUIRED) {
    addEvent(ctx.db, { jobId: a.jobId, kind: "a2a-failed", data: { state: first?.status?.state } });
    return { outcome: "failed", amount: 0n };
  }
  const parts = first.artifacts.flatMap((x) => x.parts as unknown[]);
  let cart = findData<CartMandate>(parts, DATA_KEYS.cartMandate)!;
  const termsJson = findData<TermsJson & { vault: Address }>(parts, DATA_KEYS.terms)!;
  const hsp = findData<{ flowId: string; paymentUrl: string }>(parts, "proviso.hsp")!;
  const terms = termsFromJson(termsJson);
  const vault = getAddress(termsJson.vault);
  addEvent(ctx.db, { vault, jobId: a.jobId, kind: "cart-received", data: { merchant: cart.contents.merchant_name, payTo: cart.contents.payment_request.method_data[0]?.data.pay_to, total: cart.contents.payment_request.details.total.amount } });

  if (a.scenario === "tampered") {
    // A man in the middle swaps the escrow for its own wallet on the way to the paying agent.
    cart = structuredClone(cart);
    cart.contents.payment_request.method_data[0]!.data.pay_to = "0x000000000000000000000000000000000000bAd0";
    addEvent(ctx.db, { vault, jobId: a.jobId, kind: "tampered-in-transit", data: { payTo: "0x000000000000000000000000000000000000bAd0" } });
  }

  const rep = await settlementReputation(ctx.chain.publicClient, {
    reputationRegistry: cfg.deployment.reputationRegistry,
    dealFactory: cfg.deployment.dealFactory,
    agentId: terms.providerAgentId,
  });
  const verdict = await verifyCart({
    cart,
    terms,
    intent: a.intent,
    intentSignature: a.intentSig,
    user: cfg.demoUser.address,
    self: cfg.paymentAgent.address,
    deployment: cfg.deployment,
    token: { address: cfg.token.address, decimals: cfg.token.decimals, chain_id: cfg.chainId },
    merchantPublicKeyPem: merchantKeys(ctx)[cart.contents.merchant_name] ?? "",
    spentSoFar: a.spent,
    providerReputation: rep,
    publicClient: ctx.chain.publicClient,
  });
  if (!verdict.ok) {
    addEvent(ctx.db, { vault, jobId: a.jobId, kind: "refused", data: { code: verdict.code, detail: verdict.detail, signed: false } });
    return { outcome: "refused", vault, amount: 0n };
  }
  addEvent(ctx.db, { vault, jobId: a.jobId, kind: "cart-verified", data: { vault: verdict.vault, providerReputation: { count: rep.count.toString(), average: rep.average } } });

  if (!(await walletReady(ctx, a.jobId, vault, terms.amount))) return { outcome: "failed", vault, amount: 0n };
  const nonce =
    cfg.token.protocol === "eip3009"
      ? keccak256(encodeAbiParameters([{ type: "address" }, { type: "string" }], [vault, cart.contents.id]))
      : BigInt(keccak256(encodeAbiParameters([{ type: "address" }, { type: "string" }], [vault, cart.contents.id])));
  const { paymentMandate } = await buildPaymentMandate({ cart, account: cfg.paymentAgent, token: hspToken(ctx), nonce });
  updateDeal(ctx.db, vault, { payment_mandate_json: JSON.stringify(paymentMandate) });
  addEvent(ctx.db, { vault, jobId: a.jobId, kind: "payment-mandate-signed", data: { nonce, protocol: cfg.token.protocol } });

  if (cfg.hspMode === "gateway") {
    const res = await new HspPayer({ baseUrl: cfg.hsp.baseUrl }).submit(hsp.flowId, paymentMandate);
    addEvent(ctx.db, { vault, jobId: a.jobId, kind: "hsp-submitted", data: { flowId: hsp.flowId, status: res.metadata?.status ?? null }, tx: res.tx_signature ?? null });
  } else {
    const res = await facilitatorPayMandate(ctx, { flow_id: hsp.flowId, payment_mandate: paymentMandate });
    if (res.code !== 0) throw new Error(`self-relay failed: ${res.msg}`);
  }
  keeper.nudge(vault);

  await client.sendMessage(
    {
      tenant: "",
      metadata: {},
      configuration: { returnImmediately: true, acceptedOutputModes: [], taskPushNotificationConfig: undefined },
      message: Message.fromJSON({
        messageId: randomUUID(),
        role: "ROLE_USER",
        taskId: first.id,
        contextId: first.contextId,
        parts: [{ data: { [DATA_KEYS.paymentMandate]: paymentMandate } }],
      }),
    },
    ext,
  );

  const deadline = Number(terms.deliverBy) * 1000 + 30_000;
  let done: Task | undefined;
  while (Date.now() < deadline) {
    await sleep(3000);
    const t = await client.getTask({ tenant: "", id: first.id, historyLength: 0 }, ext);
    if (t.status?.state === TaskState.TASK_STATE_COMPLETED || t.status?.state === TaskState.TASK_STATE_FAILED) {
      done = t;
      break;
    }
    const deal = getDeal(ctx.db, vault);
    if (deal && ["refunded", "settled"].includes(deal.stage)) break;
  }
  if (!done || done.status?.state !== TaskState.TASK_STATE_COMPLETED) {
    addEvent(ctx.db, { vault, jobId: a.jobId, kind: "no-delivery", data: { note: "provider did not deliver; the escrow refunds after the deadline" } });
    return { outcome: "no-delivery", vault, amount: terms.amount };
  }

  const delivery = findData<{ deliveryHash: Hex; content: string; uri: string }>(done.artifacts.flatMap((x) => x.parts as unknown[]), DATA_KEYS.delivery)!;
  const deal = getDeal(ctx.db, vault)!;
  const spec = JSON.parse(deal.spec_json) as TaskSpec;
  const check = await checkDeliverable(ctx, spec, delivery.content);
  addEvent(ctx.db, { vault, jobId: a.jobId, kind: "acceptance-checked", data: { accept: check.accept, score: check.score, reasons: check.reasons, floor: check.floor } });

  if (check.accept) {
    const sig = await signAccept(cfg.paymentAgent, { chainId: cfg.chainId, vault, deliveryHash: delivery.deliveryHash });
    const tx = await ctx.chain.write(cfg.relayer, { address: vault, abi: dealVaultAbi, functionName: "accept", args: [sig] });
    addEvent(ctx.db, { vault, jobId: a.jobId, kind: "accepted", data: { score: check.score }, tx });
    keeper.nudge(vault);
    return { outcome: "accepted", vault, amount: terms.amount, content: delivery.content };
  }
  const reason = putEvidence(ctx.db, cfg.publicUrl, {
    type: "proviso.dispute",
    vault,
    deliveryHash: delivery.deliveryHash,
    reason: `The deliverable does not meet the acceptance criterion: ${check.reasons.join("; ")}`,
    floor: check.floor,
    score: check.score,
  });
  const sig = await signDispute(cfg.paymentAgent, { chainId: cfg.chainId, vault, deliveryHash: delivery.deliveryHash, reasonHash: reason.hash });
  const tx = await ctx.chain.write(cfg.relayer, { address: vault, abi: dealVaultAbi, functionName: "dispute", args: [reason.hash, sig] });
  addEvent(ctx.db, { vault, jobId: a.jobId, kind: "disputed", data: { reasonHash: reason.hash, uri: reason.uri, reasons: check.reasons }, tx });
  keeper.nudge(vault);
  return { outcome: "disputed", vault, amount: terms.amount };
}

/**
 * The paying agent checks its own wallet before signing: enough of the token, and for Permit2 tokens an allowance
 * to the canonical Permit2 contract (granted once, on chain, from the agent's wallet).
 */
async function walletReady(ctx: Ctx, jobId: string, vault: Address, amount: bigint): Promise<boolean> {
  const { cfg, chain } = ctx;
  const owner = cfg.paymentAgent.address;
  const balance = (await chain.publicClient.readContract({ address: cfg.token.address, abi: erc20Abi, functionName: "balanceOf", args: [owner] })) as bigint;
  if (balance < amount) {
    addEvent(ctx.db, { vault, jobId, kind: "wallet-empty", data: { balance: balance.toString(), needed: amount.toString(), token: cfg.token.symbol } });
    return false;
  }
  if (cfg.token.protocol === "permit2") {
    const allowance = (await chain.publicClient.readContract({ address: cfg.token.address, abi: erc20Abi, functionName: "allowance", args: [owner, HSK.permit2] })) as bigint;
    if (allowance < amount) {
      const tx = await chain.write(cfg.paymentAgent, { address: cfg.token.address, abi: erc20Abi, functionName: "approve", args: [HSK.permit2, 2n ** 256n - 1n] });
      addEvent(ctx.db, { vault, jobId, kind: "permit2-approved", data: { token: cfg.token.symbol }, tx });
    }
  }
  return true;
}

/** A merchant that wants the money sent straight to its wallet: valid signature, no escrow, so the agent refuses. */
async function refusePlainCheckout(ctx: Ctx, jobId: string, intent: Intent, intentSig: Hex) {
  const { cfg } = ctx;
  const shady = cfg.providers.find((p) => p.id === "shady")!;
  const cart = await buildCartMandate({
    cartMandateId: `plain-${randomUUID()}`,
    paymentRequestId: `pr-${randomUUID()}`,
    merchantName: plainMerchant.name,
    merchantPrivateKeyPem: plainMerchant.privatePem,
    payTo: shady.account.address,
    token: { chain_id: cfg.chainId, address: cfg.token.address, symbol: cfg.token.symbol },
    totalUsd: "0.05",
    expiresAt: new Date(Date.now() + 3600_000),
    userConfirmationRequired: false,
  });
  addEvent(ctx.db, { jobId, kind: "cart-received", data: { merchant: cart.contents.merchant_name, payTo: shady.account.address, total: cart.contents.payment_request.details.total.amount } });
  const verdict = await verifyCart({
    cart,
    intent,
    intentSignature: intentSig,
    user: cfg.demoUser.address,
    self: cfg.paymentAgent.address,
    deployment: cfg.deployment,
    token: { address: cfg.token.address, decimals: cfg.token.decimals, chain_id: cfg.chainId },
    merchantPublicKeyPem: plainMerchant.publicPem,
    spentSoFar: 0n,
    providerReputation: { count: 0n, average: 0 },
  });
  addEvent(ctx.db, { jobId, kind: verdict.ok ? "cart-verified" : "refused", data: verdict.ok ? {} : { code: verdict.code, detail: verdict.detail, signed: false } });
}
