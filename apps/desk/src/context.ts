import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getAddress, type Address } from "viem";
import type { Config } from "./config.ts";
import type { Chain } from "./chain.ts";
import type { Db } from "./db.ts";
import type { Llm } from "./llm.ts";

/** ERC-8004 identities of the hosted agents, written by scripts/register-agents.ts. */
export interface AgentIdentity {
  role: string;
  address: Address;
  agentId: string;
  agentURI: string;
  registerTx?: string;
  operatorTx?: string;
}

export interface Ctx {
  cfg: Config;
  db: Db;
  chain: Chain;
  llm: Llm;
  agents: Record<string, AgentIdentity>;
}

export function agentsFile(chainId: number): string {
  return fileURLToPath(new URL(`../../../contracts/deployments/${chainId}-agents.json`, import.meta.url));
}

export function loadAgents(chainId: number): Record<string, AgentIdentity> {
  const f = agentsFile(chainId);
  if (!existsSync(f)) return {};
  const raw = JSON.parse(readFileSync(f, "utf8")) as Record<string, AgentIdentity>;
  for (const a of Object.values(raw)) a.address = getAddress(a.address);
  return raw;
}

export function agentIdOf(ctx: Ctx, role: string): bigint {
  const a = ctx.agents[role];
  if (!a) throw new Error(`agent ${role} is not registered on chain ${ctx.cfg.chainId} (run scripts/register-agents.ts)`);
  return BigInt(a.agentId);
}
