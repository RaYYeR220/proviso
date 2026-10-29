export const DESK = (process.env.NEXT_PUBLIC_DESK_URL ?? "https://34-93-86-48.sslip.io").replace(/\/+$/, "");

export interface DeskEvent {
  id: number;
  vault: string | null;
  job_id: string | null;
  ts: number;
  kind: string;
  data: Record<string, any> | null;
  tx: string | null;
}

export interface DealSummary {
  vault: string;
  chain_id?: number;
  provider_id: string;
  job_id: string | null;
  scenario: string | null;
  payer: string;
  stage: string;
  rail: string | null;
  funding_tx: string | null;
  settled_tx: string | null;
  created_at: number;
  updated_at: number;
  terms: Record<string, any>;
  outcome: Record<string, any> | null;
}

export interface CourtRow {
  idx: number;
  validator: string;
  request_hash: string;
  request_tx: string | null;
  response: number | null;
  response_tx: string | null;
  reasoning: string | null;
}

export interface DealDetail {
  deal: DealSummary & {
    spec: Record<string, any>;
    cart: Record<string, any>;
    paymentMandate: Record<string, any> | null;
    delivery: { hash: string; uri: string; tx: string } | null;
    flow_id: string | null;
    payment_url: string | null;
    funding_sender: string | null;
    created_block: number;
  };
  vault: Record<string, any> | null;
  events: DeskEvent[];
  court: CourtRow[];
  explorer: string;
}

export interface JobDetail {
  job: { id: string; goal: string; scenario: string; status: string; created_at: number; updated_at: number; intent_json: string | null };
  events: DeskEvent[];
  deals: { vault: string; provider_id: string; stage: string; rail: string | null; scenario: string | null }[];
}

export interface DeskConfig {
  chainId: number;
  hspMode: string;
  deployment: Record<string, string>;
  token: { address: string; symbol: string; decimals: number };
  relayer: string;
  paymentAgent: string;
  demoUser: string;
  scenarios: Record<string, { title: string; goal: string }>;
  timing: Record<string, number>;
  fees: { feeBps: number; courtFeeBps: number };
}

export interface AgentEntry {
  id: string;
  name: string;
  description: string;
  roles: string[];
  priceUsd?: string;
  payout?: string;
  identity: { agentId: string; address: string; agentURI: string; registerTx?: string } | null;
  reputation: { count: string; average: number } | null;
  card: string;
  registration: string;
}

export async function desk<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${DESK}${path}`, { cache: "no-store", ...init });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json() as Promise<T>;
}

export function runScenario(scenario: string): Promise<{ jobId?: string; recorded?: string | null; reason?: string; error?: string }> {
  return fetch(`${DESK}/api/demo/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario }) }).then((r) => r.json());
}
