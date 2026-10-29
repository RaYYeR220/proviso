import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

export interface DealRow {
  vault: string;
  chain_id: number;
  provider_id: string;
  job_id: string | null;
  task_id: string | null;
  scenario: string | null;
  payer: string;
  terms_json: string;
  spec_json: string;
  cart_json: string;
  flow_id: string | null;
  payment_url: string | null;
  payment_mandate_json: string | null;
  stage: string;
  rail: string | null;
  funding_tx: string | null;
  funding_sender: string | null;
  delivery_json: string | null;
  outcome_json: string | null;
  settled_tx: string | null;
  created_block: number;
  created_at: number;
  updated_at: number;
}

export function openDb(dataDir: string, file = "desk.sqlite"): Db {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(file === ":memory:" ? ":memory:" : join(dataDir, file));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS deals (
      vault TEXT PRIMARY KEY, chain_id INTEGER NOT NULL, provider_id TEXT NOT NULL, job_id TEXT, task_id TEXT, scenario TEXT,
      payer TEXT NOT NULL, terms_json TEXT NOT NULL, spec_json TEXT NOT NULL, cart_json TEXT NOT NULL,
      flow_id TEXT, payment_url TEXT, payment_mandate_json TEXT, stage TEXT NOT NULL, rail TEXT,
      funding_tx TEXT, funding_sender TEXT, delivery_json TEXT, outcome_json TEXT, settled_tx TEXT,
      created_block INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS deals_stage ON deals(stage);
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, vault TEXT, job_id TEXT, ts INTEGER NOT NULL, kind TEXT NOT NULL,
      data_json TEXT, tx TEXT
    );
    CREATE INDEX IF NOT EXISTS events_vault ON events(vault);
    CREATE INDEX IF NOT EXISTS events_job ON events(job_id);
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, goal TEXT NOT NULL, scenario TEXT, status TEXT NOT NULL, intent_json TEXT, intent_sig TEXT,
      result_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evidence (hash TEXT PRIMARY KEY, json TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS webhooks (request_id TEXT NOT NULL, status TEXT NOT NULL, received_at INTEGER NOT NULL,
      PRIMARY KEY (request_id, status));
    CREATE TABLE IF NOT EXISTS court (vault TEXT NOT NULL, idx INTEGER NOT NULL, salt TEXT NOT NULL, request_hash TEXT NOT NULL,
      validator TEXT NOT NULL, request_tx TEXT, response INTEGER, response_tx TEXT, reasoning TEXT, PRIMARY KEY (vault, idx));
    CREATE TABLE IF NOT EXISTS demo_runs (ip TEXT NOT NULL, ts INTEGER NOT NULL);
  `);
  return db;
}

export const now = () => Math.floor(Date.now() / 1000);

export function addEvent(
  db: Db,
  e: { vault?: string | null; jobId?: string | null; kind: string; data?: unknown; tx?: string | null },
): void {
  db.prepare("INSERT INTO events (vault, job_id, ts, kind, data_json, tx) VALUES (?, ?, ?, ?, ?, ?)").run(
    e.vault ?? null,
    e.jobId ?? null,
    Date.now(),
    e.kind,
    e.data === undefined ? null : JSON.stringify(e.data, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
    e.tx ?? null,
  );
  for (const l of listeners) l(e);
}

const listeners = new Set<(e: { vault?: string | null; jobId?: string | null; kind: string }) => void>();
export function onEvent(fn: (e: { vault?: string | null; jobId?: string | null; kind: string }) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getDeal(db: Db, vault: string): DealRow | undefined {
  return db.prepare("SELECT * FROM deals WHERE vault = ? COLLATE NOCASE").get(vault) as DealRow | undefined;
}

export function updateDeal(db: Db, vault: string, fields: Partial<DealRow>): void {
  const keys = Object.keys(fields);
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE deals SET ${sets}, updated_at = ? WHERE vault = ? COLLATE NOCASE`).run(
    ...keys.map((k) => (fields as Record<string, string | number | null>)[k] ?? null),
    now(),
    vault,
  );
}
