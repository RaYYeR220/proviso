import { randomUUID } from "node:crypto";
import { keccak256, parseUnits, toHex, type Address, type Hex } from "viem";
import {
  buildCartMandate,
  dealFactoryAbi,
  HspMerchant,
  predictVault,
  termsToJson,
  type CartMandate,
  type Terms,
} from "@proviso/sdk";
import type { ProviderProfile } from "./config.ts";
import { agentIdOf, type Ctx } from "./context.ts";
import { addEvent, now } from "./db.ts";
import { putEvidence } from "./evidence.ts";

export interface TaskSpec {
  skill: string;
  input: Record<string, unknown>;
  /** What the buyer will check the deliverable against. */
  acceptance: string;
}

export interface DealCart {
  terms: Terms;
  vault: Address;
  cart: CartMandate;
  flowId: string;
  paymentUrl: string;
  specUri: string;
}

/**
 * Proviso is the HSP merchant of record for every hosted (and onboarded) provider agent. For each quote it
 * fixes the deal terms, derives the escrow address from them and creates an HSP order whose `pay_to` is that
 * address — so the gateway's ordinary settlement lands in escrow instead of in anyone's wallet.
 */
export async function createDealCart(
  ctx: Ctx,
  req: {
    provider: ProviderProfile;
    spec: TaskSpec;
    payer: Address;
    payerAgentId: bigint;
    intentHash: Hex;
    deliverySeconds?: number;
    jobId?: string | null;
    taskId?: string | null;
    scenario?: string | null;
  },
): Promise<DealCart> {
  const { cfg, db, chain } = ctx;
  const cartMandateId = `deal-${randomUUID()}`;
  const paymentRequestId = `pr-${randomUUID()}`;
  const spec = putEvidence(db, cfg.publicUrl, { type: "proviso.task-spec", provider: req.provider.id, ...req.spec });
  const block = await chain.publicClient.getBlock();

  const terms: Terms = {
    payer: req.payer,
    provider: req.provider.account.address,
    token: cfg.token.address,
    amount: parseUnits(req.provider.priceUsd, cfg.token.decimals),
    // A quiet chain's latest block can lag wall-clock time; deadlines count from whichever is later.
    deliverBy: BigInt(Math.max(Number(block.timestamp), now())) + BigInt(req.deliverySeconds ?? cfg.timing.deliverySeconds),
    challengeWindow: cfg.timing.challengeWindow,
    courtWindow: cfg.timing.courtWindow,
    feeBps: cfg.fees.feeBps,
    courtFeeBps: cfg.fees.courtFeeBps,
    validators: [cfg.validators[0]!.account.address, cfg.validators[1]!.account.address, cfg.validators[2]!.account.address],
    providerAgentId: agentIdOf(ctx, req.provider.id),
    payerAgentId: req.payerAgentId,
    specHash: spec.hash,
    intentHash: req.intentHash,
    salt: keccak256(toHex(cartMandateId)),
  };

  const [ok, reason] = (await chain.publicClient.readContract({
    address: cfg.deployment.dealFactory,
    abi: dealFactoryAbi,
    functionName: "validate",
    args: [terms],
  })) as [boolean, string];
  if (!ok) throw new Error(`terms rejected by the deal factory: ${reason}`);

  const vault = predictVault({ dealFactory: cfg.deployment.dealFactory, vaultImpl: cfg.deployment.vaultImpl, terms });
  const token = { chain_id: cfg.chainId, address: cfg.token.address, symbol: cfg.token.symbol };
  const items = [{ label: `${req.provider.name}: ${req.spec.skill}`, amount: { currency: "USD", value: req.provider.priceUsd } }];
  const expiresAt = new Date(Number(terms.deliverBy) * 1000);

  let cart: CartMandate;
  let flowId: string;
  let paymentUrl: string;
  if (cfg.hspMode === "gateway") {
    if (!cfg.hsp.appKey || !cfg.hsp.appSecret) throw new Error("HSP gateway mode needs HSP_APP_KEY and HSP_APP_SECRET");
    const merchant = new HspMerchant({
      baseUrl: cfg.hsp.baseUrl,
      appKey: cfg.hsp.appKey,
      appSecret: cfg.hsp.appSecret,
      merchantName: cfg.hsp.merchantName,
      merchantPrivateKeyPem: cfg.hsp.merchantKeyPem,
    });
    const order = await merchant.createOrder({
      cartMandateId,
      paymentRequestId,
      payTo: vault,
      token,
      totalUsd: req.provider.priceUsd,
      items,
      expiresAt,
      userConfirmationRequired: false,
      webhookUrl: `${cfg.publicUrl}/hsp/webhook`,
    });
    cart = order.cartMandate;
    flowId = order.flowId;
    paymentUrl = order.paymentUrl;
  } else {
    cart = await buildCartMandate({
      cartMandateId,
      paymentRequestId,
      merchantName: cfg.hsp.merchantName,
      merchantPrivateKeyPem: cfg.hsp.merchantKeyPem,
      payTo: vault,
      token,
      totalUsd: req.provider.priceUsd,
      items,
      expiresAt,
      userConfirmationRequired: false,
    });
    flowId = `local-${cartMandateId}`;
    paymentUrl = `${cfg.publicUrl}/facilitator/flow/${flowId}`;
  }

  const t = now();
  db.prepare(
    `INSERT INTO deals (vault, chain_id, provider_id, job_id, task_id, scenario, payer, terms_json, spec_json, cart_json,
      flow_id, payment_url, stage, created_block, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    vault,
    cfg.chainId,
    req.provider.id,
    req.jobId ?? null,
    req.taskId ?? null,
    req.scenario ?? null,
    req.payer,
    JSON.stringify(termsToJson(terms)),
    JSON.stringify({ ...req.spec, uri: spec.uri, hash: spec.hash }),
    JSON.stringify(cart),
    flowId,
    paymentUrl,
    "awaiting-payment",
    Number(block.number),
    t,
    t,
  );
  addEvent(db, {
    vault,
    jobId: req.jobId,
    kind: "cart-issued",
    data: { provider: req.provider.id, amountUsd: req.provider.priceUsd, flowId, paymentUrl, rail: cfg.hspMode, cartMandateId, payTo: vault },
  });
  return { terms, vault, cart, flowId, paymentUrl, specUri: spec.uri };
}
