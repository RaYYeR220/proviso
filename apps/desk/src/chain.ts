import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { hsk, hskTestnet } from "@proviso/sdk";
import type { Config } from "./config.ts";

export const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export function chainFor(cfg: Config) {
  if (cfg.chainId === 177) return hsk;
  if (cfg.chainId === 133) return hskTestnet;
  return defineChain({
    id: cfg.chainId,
    name: `local-${cfg.chainId}`,
    nativeCurrency: { name: "HSK", symbol: "HSK", decimals: 18 },
    rpcUrls: { default: { http: [cfg.rpcUrl] } },
  });
}

export interface Chain {
  publicClient: PublicClient;
  /** Sends a contract write from `account`, serialized per account, and waits for the receipt. */
  write(account: PrivateKeyAccount, req: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }): Promise<Hex>;
  explorerTx(hash: string): string;
  explorerAddress(addr: string): string;
}

export function makeChain(cfg: Config): Chain {
  const chain = chainFor(cfg);
  const transport = http(cfg.rpcUrl, { retryCount: 3, timeout: 30_000 });
  const publicClient = createPublicClient({ chain, transport }) as PublicClient;
  const queues = new Map<string, Promise<unknown>>();
  const explorer = chain.blockExplorers?.default.url ?? "";

  async function send(account: PrivateKeyAccount, req: { address: Address; abi: Abi; functionName: string; args?: readonly unknown[] }) {
    const wallet = createWalletClient({ account, chain, transport });
    const { request } = await publicClient.simulateContract({ ...req, account } as never);
    const hash = await wallet.writeContract(request as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") throw new Error(`tx ${hash} reverted`);
    return hash;
  }

  return {
    publicClient,
    write(account, req) {
      const prev = queues.get(account.address) ?? Promise.resolve();
      const next = prev.catch(() => undefined).then(() => send(account, req));
      queues.set(account.address, next);
      return next;
    },
    explorerTx: (h) => (explorer ? `${explorer}/tx/${h}` : h),
    explorerAddress: (a) => (explorer ? `${explorer}/address/${a}` : a),
  };
}
