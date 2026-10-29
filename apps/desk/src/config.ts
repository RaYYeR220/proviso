import { readFileSync } from "node:fs";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { deployments, registerDeployment, type Deployment } from "@proviso/sdk";

export type HspMode = "gateway" | "self-relay";

const env = (k: string, d?: string): string => {
  const v = process.env[k] ?? d;
  if (v === undefined || v === "") throw new Error(`missing env ${k}`);
  return v;
};
const opt = (k: string): string | undefined => process.env[k] || undefined;
const key = (k: string): PrivateKeyAccount => privateKeyToAccount(env(k) as Hex);

export interface ProviderProfile {
  id: "auditor" | "analyst" | "localizer" | "shady";
  name: string;
  account: PrivateKeyAccount;
  /** USD price per job, two decimals */
  priceUsd: string;
}

export interface Config {
  port: number;
  publicUrl: string;
  chainId: number;
  rpcUrl: string;
  deployment: Deployment;
  dataDir: string;
  hspMode: HspMode;
  hsp: { baseUrl: string; appKey?: string; appSecret?: string; webhookSecret?: string; merchantName: string; merchantKeyPem: string; merchantPublicKeyPem: string };
  /** HSP chain-config token entry fields for the settlement token on this chain */
  token: { address: Address; symbol: string; name: string; version: string; decimals: number; protocol: "eip3009" | "permit2" };
  relayer: PrivateKeyAccount;
  paymentAgent: PrivateKeyAccount;
  demoUser: PrivateKeyAccount;
  providers: ProviderProfile[];
  validators: { account: PrivateKeyAccount; model: string; name: string }[];
  venice: { apiKey?: string; baseUrl: string; stub: boolean };
  models: { provider: string; planner: string; acceptance: string };
  timing: { deliverySeconds: number; noShowSeconds: number; challengeWindow: number; courtWindow: number; keeperIntervalMs: number };
  fees: { feeBps: number; courtFeeBps: number };
  demo: { amountUsd: string; dailyCap: number; perIpPerHour: number };
}

export function loadConfig(): Config {
  const chainId = Number(env("CHAIN_ID", "133"));
  const deploymentFile = opt("DEPLOYMENT_FILE");
  if (deploymentFile) registerDeployment(JSON.parse(readFileSync(deploymentFile, "utf8")));
  const deployment = deployments[chainId];
  if (!deployment) throw new Error(`no deployment for chain ${chainId}`);
  const merchantKeyPem = readFileSync(env("HSP_MERCHANT_KEY_FILE"), "utf8");
  const merchantPublicKeyPem = readFileSync(env("HSP_MERCHANT_PUBKEY_FILE"), "utf8");
  const relayer = key("RELAYER_PRIVATE_KEY");

  return {
    port: Number(env("PORT", "8787")),
    publicUrl: env("PUBLIC_URL", "http://localhost:8787").replace(/\/+$/, ""),
    chainId,
    rpcUrl: env("RPC_URL", chainId === 177 ? "https://mainnet.hsk.xyz" : "https://testnet.hsk.xyz"),
    deployment,
    dataDir: env("DATA_DIR", "./data"),
    hspMode: env("HSP_MODE", "self-relay") as HspMode,
    hsp: {
      baseUrl: env("HSP_BASE_URL", chainId === 177 ? "https://hsp.hashkey.com" : "https://merchant-qa.hashkeymerchant.com"),
      appKey: opt("HSP_APP_KEY"),
      appSecret: opt("HSP_APP_SECRET"),
      webhookSecret: opt("HSP_WEBHOOK_SECRET") ?? opt("HSP_APP_SECRET"),
      merchantName: env("HSP_MERCHANT_NAME", "Proviso"),
      merchantKeyPem,
      merchantPublicKeyPem,
    },
    token: {
      address: getAddress(env("TOKEN_ADDRESS", deployment.usdc)),
      symbol: env("TOKEN_SYMBOL", "USDC"),
      name: env("TOKEN_NAME", chainId === 177 ? "Bridged USDC" : "USD Coin"),
      version: env("TOKEN_VERSION", "2"),
      decimals: Number(env("TOKEN_DECIMALS", "6")),
      protocol: env("TOKEN_PROTOCOL", "eip3009") as "eip3009" | "permit2",
    },
    relayer,
    paymentAgent: key("PAYMENT_AGENT_PRIVATE_KEY"),
    demoUser: key("USER_DEMO_PRIVATE_KEY"),
    providers: [
      { id: "auditor", name: "Auditor", account: key("AUDITOR_PRIVATE_KEY"), priceUsd: env("PRICE_AUDITOR", "0.05") },
      { id: "analyst", name: "Analyst", account: key("ANALYST_PRIVATE_KEY"), priceUsd: env("PRICE_ANALYST", "0.05") },
      { id: "localizer", name: "Localizer", account: key("LOCALIZER_PRIVATE_KEY"), priceUsd: env("PRICE_LOCALIZER", "0.03") },
      { id: "shady", name: "Shady", account: key("SHADY_PRIVATE_KEY"), priceUsd: env("PRICE_SHADY", "0.05") },
    ],
    validators: [
      { name: "Validator A", account: key("VALIDATOR_0_PRIVATE_KEY"), model: env("VALIDATOR_0_MODEL", "gemini-3-8-flash") },
      { name: "Validator B", account: key("VALIDATOR_1_PRIVATE_KEY"), model: env("VALIDATOR_1_MODEL", "qwen-3-8-flash") },
      { name: "Validator C", account: key("VALIDATOR_2_PRIVATE_KEY"), model: env("VALIDATOR_2_MODEL", "z-ai-glm-5-3-flash") },
    ],
    venice: { apiKey: opt("VENICE_API_KEY"), baseUrl: env("VENICE_BASE_URL", "https://api.venice.ai/api/v1"), stub: opt("LLM_STUB") === "1" },
    models: {
      provider: env("PROVIDER_MODEL", "qwen-3-8-flash"),
      planner: env("PLANNER_MODEL", "gemini-3-8-flash"),
      acceptance: env("ACCEPTANCE_MODEL", "gemini-3-8-flash"),
    },
    timing: {
      deliverySeconds: Number(env("DELIVERY_SECONDS", "900")),
      noShowSeconds: Number(env("NOSHOW_SECONDS", "120")),
      challengeWindow: Number(env("CHALLENGE_WINDOW", "120")),
      courtWindow: Number(env("COURT_WINDOW", "600")),
      keeperIntervalMs: Number(env("KEEPER_INTERVAL_MS", "4000")),
    },
    fees: { feeBps: Number(env("FEE_BPS", "100")), courtFeeBps: Number(env("COURT_FEE_BPS", "300")) },
    demo: { amountUsd: env("DEMO_AMOUNT_USD", "0.05"), dailyCap: Number(env("DEMO_DAILY_CAP", "60")), perIpPerHour: Number(env("DEMO_PER_IP_PER_HOUR", "6")) },
  };
}
