import { defineChain, type Address } from "viem";
import testnet from "../../../contracts/deployments/133.json" with { type: "json" };
import mainnet from "../../../contracts/deployments/177.json" with { type: "json" };

export const hsk = defineChain({
  id: 177,
  name: "HSK Chain",
  nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
  rpcUrls: { default: { http: ["https://mainnet.hsk.xyz", "https://mainnet02.hashkeychain.net"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://hsk.blockscout.com" } },
});

export const hskTestnet = defineChain({
  id: 133,
  name: "HSK Chain Testnet",
  nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet.hsk.xyz", "https://testnet02.hashkeychain.net"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://testnet-explorer.hskchain.net" } },
  testnet: true,
});

export interface Deployment {
  chainId: number;
  deployedAtBlock: number;
  dealFactory: Address;
  vaultImpl: Address;
  identityRegistry: Address;
  reputationRegistry: Address;
  validationRegistry: Address;
  feeRecipient: Address;
  usdc: Address;
  usdt: Address;
}

export const deployments: Record<number, Deployment | undefined> = {
  133: testnet as Deployment,
  177: mainnet as Deployment,
};

/** Registers a deployment (e.g. mainnet once deployed, or a local fork) at runtime. */
export function registerDeployment(d: Deployment): void {
  deployments[d.chainId] = d;
}

/** Fixed facts about HSK Chain that the HSP gateway and the vaults rely on. */
export const HSK = {
  /** EOA that broadcasts every HSP gateway settlement (EIP-3009 transferWithAuthorization / Permit2). */
  hspRelayer: "0x1aaA5E4371aAdf96bEfb5bd2Af4d896FD16915Ea" as Address,
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address,
  mainnet: {
    usdcE: "0x054ed45810DbBAb8B27668922D110669c9D88D0a" as Address,
    usdt: "0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029" as Address,
  },
} as const;
