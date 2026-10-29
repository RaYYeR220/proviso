import { decodeEventLog, getAddress, keccak256, parseAbiItem, type Address, type Hex } from "viem";
import {
  canonicalJson,
  cartHash,
  dealFactoryAbi,
  dealVaultAbi,
  encodeTerms,
  HSK,
  signQuote,
  readVault,
  termsFromJson,
  type CartMandate,
  type PaymentMandate,
  type VaultState,
} from "@proviso/sdk";
import type { Ctx } from "./context.ts";
import { erc20Abi } from "./chain.ts";
import { addEvent, getDeal, now, updateDeal, type DealRow } from "./db.ts";
import { putEvidence } from "./evidence.ts";
import { fileCourt, tryResolve } from "./court.ts";

const OPEN_STAGES = ["funded", "delivered", "disputed", "released", "refunded", "resolved"];
const TERMINAL = new Set(["Released", "Refunded", "Resolved"]);
const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

/** Label of the rail that funded a deal, derived only from who broadcast the funding transaction. */
export function railOf(ctx: Ctx, sender: Address): "hsp-gateway" | "self-relay" | "direct" {
  if (getAddress(sender) === getAddress(HSK.hspRelayer)) return "hsp-gateway";
  if (getAddress(sender) === getAddress(ctx.cfg.relayer.address)) return "self-relay";
  return "direct";
}

export class Keeper {
  private running = false;
  private funding = false;
  private wake = new Set<string>();

  constructor(private ctx: Ctx) {}

  nudge(vault: string) {
    this.wake.add(vault.toLowerCase());
    void this.fundTick();
    void this.tick();
  }

  /**
   * Opening a funded vault is time-critical: a vault only counts as funded once it is open, so the funding loop
   * runs on its own and is never queued behind court filings or settlements.
   */
  async fundTick(): Promise<void> {
    if (this.funding) return;
    this.funding = true;
    try {
      const rows = this.ctx.db
        .prepare("SELECT * FROM deals WHERE stage = 'awaiting-payment' ORDER BY created_at")
        .all() as unknown as DealRow[];
      await Promise.all(
        rows.map(async (deal) => {
          const terms = termsFromJson(JSON.parse(deal.terms_json));
          try {
            await this.tryFund(deal, terms.amount, Number(terms.deliverBy));
          } catch (e) {
            this.reportError(deal, e);
          }
        }),
      );
    } finally {
      this.funding = false;
    }
  }

  async tick(): Promise<void> {
    void this.fundTick();
    if (this.running) return;
    this.running = true;
    try {
      const rows = this.ctx.db
        .prepare(`SELECT * FROM deals WHERE stage IN (${OPEN_STAGES.map(() => "?").join(",")}) ORDER BY created_at`)
        .all(...OPEN_STAGES) as unknown as DealRow[];
      for (const deal of rows) {
        try {
          await this.step(deal);
        } catch (e) {
          this.reportError(deal, e);
        }
      }
    } finally {
      this.running = false;
      this.wake.clear();
    }
  }

  /** Records a keeper failure once per distinct message, so a retry loop does not flood the deal's timeline. */
  private reportError(deal: DealRow, e: unknown) {
    const message = String((e as Error).message ?? e).split(/\r?\n/)[0]!.slice(0, 300);
    const last = this.ctx.db
      .prepare("SELECT data_json FROM events WHERE vault = ? AND kind = 'keeper-error' ORDER BY id DESC LIMIT 1")
      .get(deal.vault) as { data_json: string } | undefined;
    if (last && JSON.parse(last.data_json).message === message) return;
    addEvent(this.ctx.db, { vault: deal.vault, jobId: deal.job_id, kind: "keeper-error", data: { message } });
  }

  async step(deal: DealRow): Promise<void> {
    const { cfg, chain } = this.ctx;
    const terms = termsFromJson(JSON.parse(deal.terms_json));
    if (deal.stage === "awaiting-payment") return this.tryFund(deal, terms.amount, Number(terms.deliverBy));

    const state = await readVault(chain.publicClient, deal.vault as Address);
    this.syncStage(deal, state);
    const t = now();
    const due =
      ((state.status === "Open" || state.status === "Funded") && (state.invalidTerms || t > Number(terms.deliverBy))) ||
      (state.status === "Delivered" && t > state.deliveredAt + terms.challengeWindow) ||
      (state.status === "Disputed" && t > state.disputedAt + terms.courtWindow);
    if (due) {
      const tx = await chain.write(cfg.relayer, { address: deal.vault as Address, abi: dealVaultAbi, functionName: "finalize" });
      addEvent(this.ctx.db, { vault: deal.vault, jobId: deal.job_id, kind: "finalized", data: { from: state.status }, tx });
      return this.syncStage(deal, await readVault(chain.publicClient, deal.vault as Address));
    }
    if (state.status === "Disputed") {
      const filed = this.ctx.db.prepare("SELECT COUNT(*) AS n FROM court WHERE vault = ?").get(deal.vault) as { n: number };
      if (filed.n === 0) await fileCourt(this.ctx, deal, terms);
      else if (await tryResolve(this.ctx, deal)) this.syncStage(deal, await readVault(chain.publicClient, deal.vault as Address));
      return;
    }
    if (TERMINAL.has(state.status) && !deal.settled_tx) await this.settle(getDeal(this.ctx.db, deal.vault)!, state);
  }

  private syncStage(deal: DealRow, state: VaultState) {
    const stage = state.status.toLowerCase() === "open" ? deal.stage : state.status.toLowerCase();
    if (stage !== deal.stage && deal.stage !== "settled") {
      updateDeal(this.ctx.db, deal.vault, { stage });
      deal.stage = stage;
    }
  }

  private async tryFund(deal: DealRow, amount: bigint, deliverBy: number) {
    const { cfg, chain, db } = this.ctx;
    const terms = termsFromJson(JSON.parse(deal.terms_json));
    const balance = (await chain.publicClient.readContract({
      address: terms.token,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [deal.vault as Address],
    })) as bigint;
    const expired = now() > deliverBy;
    if (balance === 0n) {
      if (expired) {
        updateDeal(db, deal.vault, { stage: "expired-unpaid" });
        addEvent(db, { vault: deal.vault, jobId: deal.job_id, kind: "expired-unpaid", data: { note: "no money was ever sent to the escrow" } });
      }
      return;
    }
    if (balance < amount && !expired) return;

    const logs = await chain.publicClient.getLogs({
      address: terms.token,
      event: transferEvent,
      args: { to: deal.vault as Address },
      fromBlock: BigInt(deal.created_block),
    });
    const fundingTx = logs[0]?.transactionHash;
    let sender: Address | null = null;
    if (fundingTx) sender = (await chain.publicClient.getTransaction({ hash: fundingTx })).from;
    const rail = sender ? railOf(this.ctx, sender) : "direct";
    updateDeal(db, deal.vault, { funding_tx: fundingTx ?? null, funding_sender: sender, rail });
    addEvent(db, { vault: deal.vault, jobId: deal.job_id, kind: "funded", data: { amount: balance.toString(), sender, rail }, tx: fundingTx ?? null });

    // Opening never reverts; an underfunded or late vault opens straight into its refund path.
    const tx = await chain.write(cfg.relayer, {
      address: cfg.deployment.dealFactory,
      abi: dealFactoryAbi,
      functionName: "open",
      args: [terms],
    });
    addEvent(db, { vault: deal.vault, jobId: deal.job_id, kind: "vault-opened", data: {}, tx });
    const state = await readVault(chain.publicClient, deal.vault as Address);
    updateDeal(db, deal.vault, { stage: state.status === "Open" ? "funded" : state.status.toLowerCase() });
    await this.confirmQuote(deal, terms);
  }

  /** Hosted providers acknowledge the exact terms they quoted; without this the vault never rates them. */
  private async confirmQuote(deal: DealRow, terms: ReturnType<typeof termsFromJson>) {
    const { cfg, chain, db } = this.ctx;
    const hosted = cfg.providers.find((p) => getAddress(p.account.address) === getAddress(terms.provider));
    if (!hosted) return;
    const vault = deal.vault as Address;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const sig = await signQuote(hosted.account, { chainId: cfg.chainId, vault, termsHash: keccak256(encodeTerms(terms)) });
        const tx = await chain.write(cfg.relayer, { address: vault, abi: dealVaultAbi, functionName: "confirm", args: [sig] });
        addEvent(db, { vault, jobId: deal.job_id, kind: "quote-confirmed", data: { provider: hosted.id }, tx });
        return;
      } catch (e) {
        // a lagging RPC node may not see the freshly deployed vault yet
        await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        if (attempt === 2) this.reportError(deal, e);
      }
    }
  }

  private async settle(deal: DealRow, state: VaultState) {
    const { cfg, chain, db } = this.ctx;
    const logs = await chain.publicClient.getLogs({
      address: deal.vault as Address,
      event: parseAbiItem("event Settled(uint8 outcome, uint8 providerSharePct, uint256 toProvider, uint256 toPayer, uint256 fee, uint256 courtFee)"),
      fromBlock: BigInt(deal.created_block),
    });
    const settled = logs[0];
    const outcome = settled
      ? {
          status: state.status,
          refundReason: state.refundReason,
          providerSharePct: state.providerSharePct,
          toProvider: settled.args.toProvider!.toString(),
          toPayer: settled.args.toPayer!.toString(),
          fee: settled.args.fee!.toString(),
          courtFee: settled.args.courtFee!.toString(),
          tx: settled.transactionHash,
        }
      : { status: state.status, refundReason: state.refundReason, providerSharePct: state.providerSharePct };
    const cart = JSON.parse(deal.cart_json) as CartMandate;
    const pm = deal.payment_mandate_json ? (JSON.parse(deal.payment_mandate_json) as PaymentMandate) : null;
    const terms = termsFromJson(JSON.parse(deal.terms_json));
    // ERC-8004 feedback file: what the settlement-backed score is based on, linkable from the registry entry.
    const file = putEvidence(db, cfg.publicUrl, {
      type: "proviso.settlement-feedback",
      agentRegistry: `eip155:${cfg.chainId}:${cfg.deployment.identityRegistry}`,
      agentId: terms.providerAgentId.toString(),
      clientAddress: `eip155:${cfg.chainId}:${cfg.deployment.dealFactory}`,
      createdAt: new Date().toISOString(),
      a2a: { taskId: deal.task_id },
      proofOfPayment: { fromAddress: terms.payer, toAddress: deal.vault, chainId: String(cfg.chainId), txHash: deal.funding_tx },
      ap2: {
        cart_mandate_id: cart.contents.id,
        cart_hash: cartHash(cart.contents),
        merchant_authorization: cart.merchant_authorization,
        payment_mandate_id: pm?.payment_mandate_contents.payment_mandate_id ?? null,
      },
      proviso: { vault: deal.vault, rail: deal.rail, outcome },
    });
    const tx = await chain.write(cfg.relayer, {
      address: cfg.deployment.dealFactory,
      abi: dealFactoryAbi,
      functionName: "settle",
      args: [deal.vault as Address, file.uri, file.hash],
    });
    updateDeal(db, deal.vault, { stage: "settled", settled_tx: tx, outcome_json: canonicalJson(outcome) });
    addEvent(db, { vault: deal.vault, jobId: deal.job_id, kind: "reputation-written", data: { feedbackUri: file.uri, outcome }, tx });
  }
}

export function decodeVaultLog(data: Hex, topics: [Hex, ...Hex[]]) {
  return decodeEventLog({ abi: dealVaultAbi, data, topics });
}
