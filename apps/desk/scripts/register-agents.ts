/**
 * Registers every hosted agent in the ERC-8004 IdentityRegistry from the agent's own key (so each agent owns its
 * identity), approves the platform relayer as operator for provider identities (so it can file validation
 * requests on their behalf), and tops up gas where an agent has to send transactions itself.
 * Idempotent; writes contracts/deployments/<chainId>-agents.json.
 */
import { writeFileSync } from "node:fs";
import { createWalletClient, decodeEventLog, http, parseEther, type Address } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { identityRegistryAbi } from "@proviso/sdk";
import { loadConfig } from "../src/config.ts";
import { chainFor, makeChain } from "../src/chain.ts";
import { agentsFile, loadAgents, type AgentIdentity } from "../src/context.ts";

const cfg = loadConfig();
const chain = makeChain(cfg);
const client = chain.publicClient;
const agents = loadAgents(cfg.chainId);
const gasTopUp = parseEther(process.env.AGENT_GAS ?? (cfg.chainId === 177 ? "0.6" : "0.003"));

const roles: { role: string; account: PrivateKeyAccount; operator: boolean; needsGas: boolean }[] = [
  ...cfg.providers.map((p) => ({ role: p.id, account: p.account, operator: true, needsGas: false })),
  { role: "payment-agent", account: cfg.paymentAgent, operator: false, needsGas: false },
  ...cfg.validators.map((v, i) => ({ role: `validator-${i}`, account: v.account, operator: false, needsGas: true })),
];

async function topUp(to: Address, min: bigint) {
  const bal = await client.getBalance({ address: to });
  if (bal >= min) return;
  const wallet = createWalletClient({ account: cfg.relayer, chain: chainFor(cfg), transport: http(cfg.rpcUrl) });
  const hash = await wallet.sendTransaction({ to, value: min - bal });
  await client.waitForTransactionReceipt({ hash });
  console.log(`  topped up ${to} (${hash})`);
}

for (const r of roles) {
  const uri = `${cfg.publicUrl}/agents/${r.role}.json`;
  const existing = agents[r.role];
  // Registering costs the agent ~150k gas, approving ~50k; validators also pay for their own responses.
  await topUp(r.account.address, r.needsGas ? gasTopUp : gasTopUp / 3n);
  if (!existing) {
    const tx = await chain.write(r.account, { address: cfg.deployment.identityRegistry, abi: identityRegistryAbi, functionName: "register", args: [uri] });
    const receipt = await client.getTransactionReceipt({ hash: tx });
    let agentId: bigint | undefined;
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: identityRegistryAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "Registered") agentId = (ev.args as { agentId: bigint }).agentId;
      } catch {
        // other events
      }
    }
    if (agentId === undefined) throw new Error(`no Registered event for ${r.role}`);
    agents[r.role] = { role: r.role, address: r.account.address, agentId: agentId.toString(), agentURI: uri, registerTx: tx } satisfies AgentIdentity;
    console.log(`${r.role}: agent #${agentId} (${tx})`);
  } else if (existing.agentURI !== uri) {
    const tx = await chain.write(r.account, { address: cfg.deployment.identityRegistry, abi: identityRegistryAbi, functionName: "setAgentURI", args: [BigInt(existing.agentId), uri] });
    existing.agentURI = uri;
    console.log(`${r.role}: agentURI updated (${tx})`);
  }
  if (r.operator && !agents[r.role]!.operatorTx) {
    const tx = await chain.write(r.account, { address: cfg.deployment.identityRegistry, abi: identityRegistryAbi, functionName: "setApprovalForAll", args: [cfg.relayer.address, true] });
    agents[r.role]!.operatorTx = tx;
    console.log(`${r.role}: platform relayer approved as operator (${tx})`);
  }
  writeFileSync(agentsFile(cfg.chainId), JSON.stringify(agents, null, 2) + "\n");
}
console.log(`wrote ${agentsFile(cfg.chainId)}`);
