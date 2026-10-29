import { keccak256, toHex, type Hex } from "viem";
import { canonicalJson } from "@proviso/sdk";
import { now, type Db } from "./db.ts";

/**
 * Content-addressed evidence store. The hash of every file is keccak256 of its canonical JSON, the same value
 * that gets committed on chain (delivery hash, dispute reason hash, feedback hash), so anyone can re-derive it.
 */
export function putEvidence(db: Db, publicUrl: string, obj: unknown): { hash: Hex; uri: string; json: string } {
  const json = canonicalJson(obj);
  const hash = keccak256(toHex(json));
  db.prepare("INSERT OR IGNORE INTO evidence (hash, json, created_at) VALUES (?, ?, ?)").run(hash, json, now());
  return { hash, uri: `${publicUrl}/evidence/${hash}`, json };
}

export function getEvidence(db: Db, hash: string): string | undefined {
  const row = db.prepare("SELECT json FROM evidence WHERE hash = ?").get(hash.toLowerCase()) as { json: string } | undefined;
  return row?.json;
}

export function evidenceHash(obj: unknown): Hex {
  return keccak256(toHex(canonicalJson(obj)));
}
