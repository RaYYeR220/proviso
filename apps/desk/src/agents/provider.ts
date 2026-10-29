import { getAddress, type Address, type Hex } from "viem";
import type { AgentExecutor, ExecutionEventBus, RequestContext } from "@a2a-js/sdk/server";
import {
  DATA_KEYS,
  decodePaymentPayload,
  findData,
  readVault,
  signDelivery,
  dealVaultAbi,
  type PaymentMandate,
} from "@proviso/sdk";
import type { ProviderProfile } from "../config.ts";
import type { Ctx } from "../context.ts";
import { addEvent, getDeal, updateDeal, type DealRow } from "../db.ts";
import { putEvidence } from "../evidence.ts";
import type { Keeper } from "../keeper.ts";
import { createDealCart, type TaskSpec } from "../merchant.ts";
import { activateExtensions, dataPart, publishArtifact, publishStatus, publishTask, TaskState, textPart } from "./a2a.ts";
import { NoShow, type SkillDef } from "./skills.ts";

export interface TaskRequest {
  skill: string;
  input: Record<string, unknown>;
  payer: Address;
  payerAgentId: string;
  intentHash: Hex;
  jobId?: string;
  scenario?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A provider agent speaking A2A v1 with the AP2 extension. Turn 1: the paying agent sends a task; the provider
 * answers with an AP2 Cart Mandate (issued by Proviso as merchant of record, `pay_to` = the deal's escrow) and
 * asks for input. Turn 2: the paying agent sends its Payment Mandate; once the escrow is funded on chain the
 * provider does the work, commits the deliverable's hash to the vault and returns it.
 */
export class ProviderExecutor implements AgentExecutor {
  constructor(
    private ctx: Ctx,
    private profile: ProviderProfile,
    private skill: SkillDef,
    private keeper: Keeper,
  ) {}

  cancelTask = async () => {};

  async execute(rc: RequestContext, bus: ExecutionEventBus): Promise<void> {
    activateExtensions(rc);
    const pm = findData<PaymentMandate>(rc.userMessage.parts as unknown[], DATA_KEYS.paymentMandate);
    if (!rc.task) return this.quote(rc, bus);
    if (pm) return this.fulfil(rc, bus, pm);
    publishTask(rc, bus, TaskState.TASK_STATE_INPUT_REQUIRED, "Waiting for an ap2.mandates.PaymentMandate for the cart above.");
  }

  private async quote(rc: RequestContext, bus: ExecutionEventBus) {
    const req = findData<TaskRequest>(rc.userMessage.parts as unknown[], DATA_KEYS.task);
    if (!req || req.skill !== this.skill.id) {
      publishTask(rc, bus, TaskState.TASK_STATE_REJECTED, `Send a ${DATA_KEYS.task} data part for skill "${this.skill.id}".`);
      return;
    }
    const spec: TaskSpec = { skill: this.skill.id, input: req.input, acceptance: this.skill.acceptance };
    publishTask(rc, bus, TaskState.TASK_STATE_SUBMITTED);
    try {
      const deal = await createDealCart(this.ctx, {
        provider: this.profile,
        spec,
        payer: getAddress(req.payer),
        payerAgentId: BigInt(req.payerAgentId),
        intentHash: req.intentHash,
        deliverySeconds: req.scenario === "noshow" ? this.ctx.cfg.timing.noShowSeconds : undefined,
        jobId: req.jobId,
        taskId: rc.taskId,
        scenario: req.scenario,
      });
      publishArtifact(rc, bus, {
        id: "cart",
        name: "AP2 CartMandate",
        parts: [
          dataPart(DATA_KEYS.cartMandate, deal.cart),
          dataPart(DATA_KEYS.terms, { ...JSON.parse(JSON.stringify(deal.terms, (_k, v) => (typeof v === "bigint" ? v.toString() : v))), vault: deal.vault, specUri: deal.specUri }),
          dataPart("proviso.hsp", { flowId: deal.flowId, paymentUrl: deal.paymentUrl, rail: this.ctx.cfg.hspMode }),
        ],
      });
      publishStatus(
        rc,
        bus,
        TaskState.TASK_STATE_INPUT_REQUIRED,
        `Payment required: ${this.profile.priceUsd} USD into escrow ${deal.vault}. Released on delivery, refunded if I miss ${new Date(Number(deal.terms.deliverBy) * 1000).toISOString()}.`,
      );
    } catch (e) {
      publishStatus(rc, bus, TaskState.TASK_STATE_FAILED, `Could not issue a cart: ${(e as Error).message}`);
    }
  }

  private async fulfil(rc: RequestContext, bus: ExecutionEventBus, pm: PaymentMandate) {
    const { ctx } = this;
    const deal = ctx.db.prepare("SELECT * FROM deals WHERE task_id = ?").get(rc.taskId) as DealRow | undefined;
    if (!deal) return publishTask(rc, bus, TaskState.TASK_STATE_FAILED, "No deal for this task.");
    const payload = decodePaymentPayload(pm);
    if (getAddress(payload.accepted.payTo) !== getAddress(deal.vault)) {
      return publishTask(rc, bus, TaskState.TASK_STATE_FAILED, "This payment mandate does not pay the deal's escrow.");
    }
    updateDeal(ctx.db, deal.vault, { payment_mandate_json: JSON.stringify(pm) });
    addEvent(ctx.db, { vault: deal.vault, jobId: deal.job_id, kind: "payment-mandate-received", data: { by: this.profile.id } });
    publishTask(rc, bus, TaskState.TASK_STATE_WORKING, "Payment mandate received. Waiting for the escrow to be funded on chain.");

    const terms = JSON.parse(deal.terms_json) as { deliverBy: string };
    const deadline = Number(terms.deliverBy) * 1000;
    let funded = false;
    while (Date.now() < deadline) {
      this.keeper.nudge(deal.vault);
      const s = await readVault(ctx.chain.publicClient, deal.vault as Address);
      if (s.status === "Funded") {
        funded = true;
        break;
      }
      if (s.status !== "Open") break;
      await sleep(3000);
    }
    if (!funded) return publishStatus(rc, bus, TaskState.TASK_STATE_FAILED, "Escrow was not funded before the delivery deadline.");
    publishStatus(rc, bus, TaskState.TASK_STATE_WORKING, "Escrow funded. Working.");

    const spec = JSON.parse(deal.spec_json) as TaskSpec;
    let out;
    try {
      out = await this.skill.run(ctx, deal.scenario === "noshow" ? { ...spec.input, __mode: "noshow" } : spec.input);
    } catch (e) {
      if (e instanceof NoShow) {
        addEvent(ctx.db, { vault: deal.vault, jobId: deal.job_id, kind: "provider-silent", data: { provider: this.profile.id } });
        return; // never delivers; the vault refunds after deliverBy
      }
      return publishStatus(rc, bus, TaskState.TASK_STATE_FAILED, `Work failed: ${(e as Error).message}`);
    }

    const file = putEvidence(ctx.db, ctx.cfg.publicUrl, {
      type: "proviso.delivery",
      vault: deal.vault,
      provider: this.profile.account.address,
      skill: this.skill.id,
      format: out.format,
      content: out.content,
      meta: out.meta ?? {},
    });
    const sig = await signDelivery(this.profile.account, { chainId: ctx.cfg.chainId, vault: deal.vault as Address, deliveryHash: file.hash, uri: file.uri });
    const tx = await ctx.chain.write(ctx.cfg.relayer, {
      address: deal.vault as Address,
      abi: dealVaultAbi,
      functionName: "deliver",
      args: [file.hash, file.uri, sig],
    });
    updateDeal(ctx.db, deal.vault, { delivery_json: JSON.stringify({ hash: file.hash, uri: file.uri, tx }), stage: "delivered" });
    addEvent(ctx.db, { vault: deal.vault, jobId: deal.job_id, kind: "delivered", data: { deliveryHash: file.hash, uri: file.uri, provider: this.profile.id }, tx });

    publishArtifact(rc, bus, {
      id: "deliverable",
      name: `${this.skill.name} result`,
      parts: [
        dataPart(DATA_KEYS.delivery, { vault: deal.vault, deliveryHash: file.hash, uri: file.uri, tx, format: out.format, content: out.content }),
        textPart(out.content.slice(0, 4000)),
      ],
    });
    publishStatus(rc, bus, TaskState.TASK_STATE_COMPLETED, `Delivered. Commitment ${file.hash} recorded in the escrow; accept to release payment.`);
  }
}

export function dealForTask(ctx: Ctx, taskId: string): DealRow | undefined {
  const row = ctx.db.prepare("SELECT vault FROM deals WHERE task_id = ?").get(taskId) as { vault: string } | undefined;
  return row ? getDeal(ctx.db, row.vault) : undefined;
}
