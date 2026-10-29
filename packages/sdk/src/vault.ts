import { keccak256, toHex, type Address, type Hex, type LocalAccount, type PublicClient } from "viem";
import { dealFactoryAbi, dealVaultAbi, reputationRegistryAbi } from "./abi.ts";

export const VAULT_STATUS = ["Open", "Funded", "Delivered", "Disputed", "Released", "Refunded", "Resolved"] as const;
export type VaultStatus = (typeof VAULT_STATUS)[number];
export const REFUND_REASON = ["None", "NoDelivery", "NoQuorum", "InvalidTerms"] as const;
export const COURT_TAG = "proviso.court.v1";
export const SETTLEMENT_TAG = "proviso.settlement";
export const PAYER_TAG = "proviso.payer";
/** Vote buckets a validator may answer (provider's share, percent). */
export const BUCKETS = [0, 25, 50, 75, 100] as const;

const domain = (chainId: number, vault: Address) => ({ name: "Proviso", version: "1", chainId, verifyingContract: vault });

/** Provider's signature committing a deliverable; anyone may relay it to `DealVault.deliver`. */
export function signDelivery(account: LocalAccount, a: { chainId: number; vault: Address; deliveryHash: Hex; uri: string }) {
  return account.signTypedData({
    domain: domain(a.chainId, a.vault),
    types: { Delivery: [{ name: "deliveryHash", type: "bytes32" }, { name: "uri", type: "string" }] },
    primaryType: "Delivery",
    message: { deliveryHash: a.deliveryHash, uri: a.uri },
  });
}

/** Payer's acceptance of the committed deliverable (releases the escrow). */
export function signAccept(account: LocalAccount, a: { chainId: number; vault: Address; deliveryHash: Hex }) {
  return account.signTypedData({
    domain: domain(a.chainId, a.vault),
    types: { Accept: [{ name: "deliveryHash", type: "bytes32" }] },
    primaryType: "Accept",
    message: { deliveryHash: a.deliveryHash },
  });
}

/** Payer's dispute of the committed deliverable, with a hash of the written reason. */
export function signDispute(account: LocalAccount, a: { chainId: number; vault: Address; deliveryHash: Hex; reasonHash: Hex }) {
  return account.signTypedData({
    domain: domain(a.chainId, a.vault),
    types: { Dispute: [{ name: "deliveryHash", type: "bytes32" }, { name: "reasonHash", type: "bytes32" }] },
    primaryType: "Dispute",
    message: { deliveryHash: a.deliveryHash, reasonHash: a.reasonHash },
  });
}

export interface VaultState {
  address: Address;
  deployed: boolean;
  status: VaultStatus;
  refundReason: (typeof REFUND_REASON)[number];
  invalidTerms: boolean;
  providerSharePct: number;
  fundedAt: number;
  deliveredAt: number;
  disputedAt: number;
  deliveryHash: Hex;
  reasonHash: Hex;
}

export async function readVault(client: PublicClient, vault: Address): Promise<VaultState> {
  const code = await client.getCode({ address: vault });
  const empty = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;
  if (!code || code === "0x") {
    return {
      address: vault, deployed: false, status: "Open", refundReason: "None", invalidTerms: false, providerSharePct: 0,
      fundedAt: 0, deliveredAt: 0, disputedAt: 0, deliveryHash: empty, reasonHash: empty,
    };
  }
  const read = (functionName: string) => client.readContract({ address: vault, abi: dealVaultAbi, functionName: functionName as never }) as Promise<unknown>;
  const [status, refundReason, invalidTerms, share, fundedAt, deliveredAt, disputedAt, deliveryHash, reasonHash] = await Promise.all([
    read("status"), read("refundReason"), read("invalidTerms"), read("providerSharePct"), read("fundedAt"),
    read("deliveredAt"), read("disputedAt"), read("deliveryHash"), read("reasonHash"),
  ]);
  return {
    address: vault,
    deployed: true,
    status: VAULT_STATUS[Number(status)]!,
    refundReason: REFUND_REASON[Number(refundReason)]!,
    invalidTerms: invalidTerms as boolean,
    providerSharePct: Number(share),
    fundedAt: Number(fundedAt),
    deliveredAt: Number(deliveredAt),
    disputedAt: Number(disputedAt),
    deliveryHash: deliveryHash as Hex,
    reasonHash: reasonHash as Hex,
  };
}

/** Hash used to commit content (a deliverable, a dispute reason, an evidence bundle). */
export function contentHash(content: string): Hex {
  return keccak256(toHex(content));
}

/** ERC-8004 validation request hash for panel member `i` of `vault` (same as `DealFactory.requestHash`). */
export function courtRequestHash(client: PublicClient, factory: Address, vault: Address, i: number, salt: Hex): Promise<Hex> {
  return client.readContract({ address: factory, abi: dealFactoryAbi, functionName: "requestHash", args: [vault, i, salt] }) as Promise<Hex>;
}

/** Reputation earned only through settled Proviso escrow (ERC-8004 summary filtered by the deal factory). */
export async function settlementReputation(
  client: PublicClient,
  a: { reputationRegistry: Address; dealFactory: Address; agentId: bigint; tag?: string },
): Promise<{ count: bigint; average: number }> {
  const [count, value, decimals] = (await client.readContract({
    address: a.reputationRegistry,
    abi: reputationRegistryAbi,
    functionName: "getSummary",
    args: [a.agentId, [a.dealFactory], a.tag ?? SETTLEMENT_TAG, ""],
  })) as [bigint, bigint, number];
  return { count, average: count === 0n ? 0 : Number(value) / 10 ** decimals };
}
