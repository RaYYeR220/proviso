import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  keccak256,
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
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
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
    // A call that would revert fails here, before anything is signed, and is never retried.
    await publicClient.simulateContract({ ...req, account } as never);
    const data = encodeFunctionData({ abi: req.abi, functionName: req.functionName, args: req.args } as never);
    return broadcast({
      // Public RPCs can lag on the pending nonce; ask for it explicitly.
      pendingNonce: () => publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
      // Nodes reserve gasLimit × maxFeePerGas up front; the default (2× base fee) halves what a lean wallet can send.
      fees: async () => {
        const base = (await publicClient.getBlock()).baseFeePerGas ?? 0n;
        return base > 0n ? { maxFeePerGas: (base * 11n) / 10n + 1000n, maxPriorityFeePerGas: 1000n } : {};
      },
      sign: async (x) => wallet.signTransaction((await wallet.prepareTransactionRequest({ account, chain, to: req.address, data, ...x } as never)) as never),
      sendRaw: (raw) => publicClient.sendRawTransaction({ serializedTransaction: raw }),
      receipt: (hash) => publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 }),
    });
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

/** What `broadcast` needs from a chain: the transaction is signed locally, so its hash is known before it is sent. */
export interface TxClients {
  pendingNonce(): Promise<number>;
  fees(): Promise<{ maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }>;
  sign(x: { nonce: number; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }): Promise<Hex>;
  sendRaw(raw: Hex): Promise<unknown>;
  receipt(hash: Hex): Promise<{ status: string }>;
}

export class TxReverted extends Error {
  constructor(readonly hash: Hex) {
    super(`tx ${hash} reverted`);
  }
}

/** The node's own words for an error: viem's short message and details down the cause chain. Never the full message,
 *  which repeats the request arguments ("nonce: 7") and would match any nonce rule. */
export function nodeWords(e: unknown): string {
  const out: string[] = [];
  for (let x = e as { shortMessage?: string; details?: string; cause?: unknown } | undefined, i = 0; x && i < 6; x = x.cause as typeof x, i++) {
    if (x.shortMessage) out.push(x.shortMessage);
    if (x.details) out.push(x.details);
  }
  return out.length ? out.join(" | ") : String((e as Error)?.message ?? e).split(/\r?\n/)[0]!;
}

/**
 * Signs, sends and waits. Once a transaction is out, it is only ever waited for: a timeout, a dropped connection or
 * "already known" never produce a second copy under a fresh nonce (which would revert, and make a landed call look
 * failed). Only a node that refused it outright for a stale nonce or price gets a re-signed one.
 */
export async function broadcast(c: TxClients, opts: { retries: number; pause: (attempt: number) => number } = { retries: 4, pause: (n) => 2500 * (n + 1) }): Promise<Hex> {
  const STALE = /underpriced|nonce too low|lower than the current nonce|nonce too high|higher than the next one/i;
  const wait = (n: number) => new Promise((r) => setTimeout(r, opts.pause(n)));
  let hash: Hex | null = null;
  for (let attempt = 0; ; attempt++) {
    if (!hash) {
      const nonce = await c.pendingNonce();
      const signed = await c.sign({ nonce, ...(await c.fees()) });
      const h = keccak256(signed);
      try {
        await c.sendRaw(signed);
        hash = h;
      } catch (e) {
        const words = nodeWords(e);
        if (/already known/i.test(words)) hash = h;
        else if (attempt < opts.retries && STALE.test(words)) {
          await wait(attempt);
          continue;
        } else throw e;
      }
    }
    try {
      const receipt = await c.receipt(hash);
      if (receipt.status !== "success") throw new TxReverted(hash);
      return hash;
    } catch (e) {
      if (e instanceof TxReverted || attempt >= opts.retries) throw e;
      await wait(attempt);
    }
  }
}
