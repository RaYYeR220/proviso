import { randomBytes } from "node:crypto";
import { encodeAbiParameters, keccak256, toHex, type Address, type Hex } from "viem";
import {
  BUCKETS,
  COURT_TAG,
  dealVaultAbi,
  readVault,
  validationRegistryAbi,
  type Terms,
} from "@proviso/sdk";
import type { Ctx } from "./context.ts";
import { addEvent, type DealRow } from "./db.ts";
import { getEvidence, putEvidence } from "./evidence.ts";

export function requestHashFor(vault: Address, i: number, salt: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint8" }, { type: "bytes32" }], [vault, i, salt]));
}

/**
 * Provider side of a dispute. The vault refunds unless the provider proves its case, so the provider (through
 * the platform, its approved ERC-8004 operator) files one validation request per panel member, each with a
 * request hash bound to this vault, pointing at a single evidence bundle: the task spec, the AP2 mandates, the
 * funding transaction, the deliverable and the payer's written reason — every piece hash-committed on chain.
 */
export async function fileCourt(ctx: Ctx, deal: DealRow, terms: Terms): Promise<void> {
  const { cfg, chain, db } = ctx;
  const vault = deal.vault as Address;
  // Each pass files only what is missing: a request that failed (a dropped RPC call, an empty relayer) is filed on
  // the next tick, so one bad call cannot leave the panel short of a quorum.
  const filed = new Set((db.prepare("SELECT idx FROM court WHERE vault = ?").all(deal.vault) as { idx: number }[]).map((r) => r.idx));
  if (filed.size >= 3) return;
  const prior = db.prepare("SELECT data_json FROM events WHERE vault = ? AND kind = 'court-bundle' ORDER BY id LIMIT 1").get(deal.vault) as
    | { data_json: string }
    | undefined;
  let bundleUri: string;
  if (prior) bundleUri = JSON.parse(prior.data_json).uri;
  else {
    const state = await readVault(chain.publicClient, vault);
    // Files are looked up by the hashes the vault committed, so the bundle is exactly what the chain points at.
    const file = (hash: Hex) => {
      const json = getEvidence(db, hash);
      return json ? JSON.parse(json) : null;
    };
    const bundle = putEvidence(db, cfg.publicUrl, {
      type: "proviso.court-bundle",
      chainId: cfg.chainId,
      vault,
      dealFactory: cfg.deployment.dealFactory,
      vaultImpl: cfg.deployment.vaultImpl,
      terms: JSON.parse(deal.terms_json),
      spec: deal.spec_json ? JSON.parse(deal.spec_json) : null,
      specFile: file(terms.specHash),
      cartMandate: JSON.parse(deal.cart_json),
      paymentMandate: deal.payment_mandate_json ? JSON.parse(deal.payment_mandate_json) : null,
      funding: { tx: deal.funding_tx, sender: deal.funding_sender, rail: deal.rail },
      onchain: { deliveryHash: state.deliveryHash, reasonHash: state.reasonHash, disputedAt: state.disputedAt },
      deliveryFile: file(state.deliveryHash),
      disputeFile: file(state.reasonHash),
    });
    addEvent(db, { vault, jobId: deal.job_id, kind: "court-bundle", data: { uri: bundle.uri, hash: bundle.hash } });
    bundleUri = bundle.uri;
  }

  for (let i = 0; i < 3; i++) {
    if (filed.has(i)) continue;
    const salt = toHex(randomBytes(32));
    const h = requestHashFor(vault, i, salt);
    const validator = terms.validators[i]!;
    const tx = await chain.write(cfg.relayer, {
      address: cfg.deployment.validationRegistry,
      abi: validationRegistryAbi,
      functionName: "validationRequest",
      args: [validator, terms.providerAgentId, bundleUri, h],
    });
    db.prepare("INSERT INTO court (vault, idx, salt, request_hash, validator, request_tx) VALUES (?,?,?,?,?,?)").run(
      deal.vault,
      i,
      salt,
      h,
      validator,
      tx,
    );
    addEvent(db, { vault, jobId: deal.job_id, kind: "validation-requested", data: { index: i, validator, requestHash: h }, tx });
  }
}

interface CourtRow {
  vault: string;
  idx: number;
  salt: Hex;
  request_hash: Hex;
  validator: string;
  response: number | null;
}

/** Calls `resolve` once two panel members answered the same bucket. Returns true if it resolved. */
export async function tryResolve(ctx: Ctx, deal: DealRow): Promise<boolean> {
  const { cfg, chain, db } = ctx;
  const rows = db.prepare("SELECT * FROM court WHERE vault = ? ORDER BY idx").all(deal.vault) as unknown as CourtRow[];
  const votes: { idx: number; salt: Hex; bucket: number }[] = [];
  for (const r of rows) {
    try {
      const s = (await chain.publicClient.readContract({
        address: cfg.deployment.validationRegistry,
        abi: validationRegistryAbi,
        functionName: "getValidationStatus",
        args: [r.request_hash],
      })) as readonly [Address, bigint, number, Hex, string, bigint];
      if (s[4] === COURT_TAG && (BUCKETS as readonly number[]).includes(s[2])) votes.push({ idx: r.idx, salt: r.salt, bucket: s[2] });
    } catch {
      // unknown request: not a vote
    }
  }
  for (const b of BUCKETS) {
    const agree = votes.filter((v) => v.bucket === b);
    if (agree.length >= 2) {
      const tx = await chain.write(cfg.relayer, {
        address: deal.vault as Address,
        abi: dealVaultAbi,
        functionName: "resolve",
        args: [agree.map((v) => v.idx), agree.map((v) => v.salt)],
      });
      addEvent(db, { vault: deal.vault, jobId: deal.job_id, kind: "resolved", data: { bucket: b, majority: agree.map((v) => v.idx) }, tx });
      return true;
    }
  }
  return false;
}
