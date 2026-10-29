import { createPublicClient, formatUnits, http, parseAbi, type Address } from "viem";
import { hsk } from "@proviso/sdk";
import type { Ctx } from "../context.ts";

export interface Deliverable {
  format: "json" | "markdown";
  content: string;
  meta?: Record<string, unknown>;
}

export interface SkillDef {
  id: string;
  name: string;
  description: string;
  acceptance: string;
  examples: string[];
  run(ctx: Ctx, input: Record<string, unknown>): Promise<Deliverable>;
}

const mainnet = createPublicClient({ chain: hsk, transport: http("https://mainnet.hsk.xyz", { retryCount: 2 }) });

/** A small vault with a classic bug, used when an audit request names no target. */
export const SAMPLE_CONTRACT = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract TipJar {
    mapping(address => uint256) public balance;

    function deposit() external payable {
        balance[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(balance[msg.sender] >= amount, "insufficient");
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "send failed");
        balance[msg.sender] -= amount;
    }

    function sweep(address to) external {
        payable(to).transfer(address(this).balance);
    }
}`;

const AUDIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "findings"],
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "title", "location", "detail", "recommendation"],
        properties: {
          severity: { type: "string", enum: ["critical", "high", "medium", "low", "info"] },
          title: { type: "string" },
          location: { type: "string" },
          detail: { type: "string" },
          recommendation: { type: "string" },
        },
      },
    },
  },
};

async function verifiedSource(address: string): Promise<{ name: string; source: string } | null> {
  const res = await fetch(`https://hsk.blockscout.com/api/v2/smart-contracts/${address}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return null;
  const d = (await res.json()) as { name?: string; source_code?: string };
  return d.source_code ? { name: d.name ?? address, source: d.source_code } : null;
}

export const auditor: SkillDef = {
  id: "audit",
  name: "Smart-contract audit",
  description: "Reviews a Solidity contract (source, or a verified address on HSK Chain) and returns structured findings.",
  acceptance: "JSON with a summary and a findings array; every finding has severity, title, location, detail and recommendation; findings must be specific to the given code.",
  examples: ["Audit the contract at 0x… on HSK Chain", "Audit this Solidity source"],
  async run(ctx, input) {
    let name = String(input.name ?? "TipJar");
    let source = typeof input.source === "string" ? input.source : "";
    if (!source && typeof input.address === "string") {
      const v = await verifiedSource(input.address);
      if (v) ({ name, source } = v);
    }
    if (!source) source = SAMPLE_CONTRACT;
    const out = await ctx.llm.json<{ summary: string; findings: unknown[] }>(
      ctx.cfg.models.provider,
      [
        {
          role: "system",
          content:
            "You are a senior smart-contract auditor. Review the contract for security issues (reentrancy, access control, accounting, " +
            "unchecked calls, DoS, upgradeability, oracle and economic risks). Report only real, code-specific issues with exact function names. Answer as JSON.",
        },
        { role: "user", content: `Contract ${name}:\n\n${source.slice(0, 40_000)}` },
      ],
      AUDIT_SCHEMA,
      { maxTokens: 2500 },
    );
    return { format: "json", content: JSON.stringify(out, null, 2), meta: { contract: name, lines: source.split("\n").length } };
  },
};

const poolAbi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
]);
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)", "function symbol() view returns (string)"]);
const feedAbi = parseAbi(["function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)", "function decimals() view returns (uint8)"]);

const HSK_USDT_POOL: Address = "0x4ff515761864e7838B0AdB8b5b2B8B7A068905dC";
const APRO_HSK_USD: Address = "0x86CE42c1b714149Dc3A7b17169EF67b5F78A224b";
const APRO_USDT_USD: Address = "0x823d7f90f7A3498DB6595886b6B5dC95E6B0B7f3";

/** Live HSK/USDT state on HSKSwap and the APRO oracle, read from HSK Chain mainnet. */
export async function hskMarketSnapshot() {
  const [slot0, liquidity, t0, t1, fee] = await Promise.all([
    mainnet.readContract({ address: HSK_USDT_POOL, abi: poolAbi, functionName: "slot0" }),
    mainnet.readContract({ address: HSK_USDT_POOL, abi: poolAbi, functionName: "liquidity" }),
    mainnet.readContract({ address: HSK_USDT_POOL, abi: poolAbi, functionName: "token0" }),
    mainnet.readContract({ address: HSK_USDT_POOL, abi: poolAbi, functionName: "token1" }),
    mainnet.readContract({ address: HSK_USDT_POOL, abi: poolAbi, functionName: "fee" }),
  ]);
  const [d0, d1, s0, s1, b0, b1] = await Promise.all([
    mainnet.readContract({ address: t0, abi: erc20, functionName: "decimals" }),
    mainnet.readContract({ address: t1, abi: erc20, functionName: "decimals" }),
    mainnet.readContract({ address: t0, abi: erc20, functionName: "symbol" }),
    mainnet.readContract({ address: t1, abi: erc20, functionName: "symbol" }),
    mainnet.readContract({ address: t0, abi: erc20, functionName: "balanceOf", args: [HSK_USDT_POOL] }),
    mainnet.readContract({ address: t1, abi: erc20, functionName: "balanceOf", args: [HSK_USDT_POOL] }),
  ]);
  const sqrt = Number(slot0[0]) / 2 ** 96;
  const price1per0 = sqrt * sqrt * 10 ** (d0 - d1);
  const hskIs0 = s0.toUpperCase().includes("HSK");
  const poolHskUsd = hskIs0 ? price1per0 : 1 / price1per0;
  const [hskRound, hskDec, usdtRound, usdtDec] = await Promise.all([
    mainnet.readContract({ address: APRO_HSK_USD, abi: feedAbi, functionName: "latestRoundData" }),
    mainnet.readContract({ address: APRO_HSK_USD, abi: feedAbi, functionName: "decimals" }),
    mainnet.readContract({ address: APRO_USDT_USD, abi: feedAbi, functionName: "latestRoundData" }),
    mainnet.readContract({ address: APRO_USDT_USD, abi: feedAbi, functionName: "decimals" }),
  ]);
  const oracleHskUsd = Number(formatUnits(hskRound[1], hskDec));
  const oracleUsdtUsd = Number(formatUnits(usdtRound[1], usdtDec));
  return {
    pool: HSK_USDT_POOL,
    feeTier: Number(fee) / 1e6,
    tick: slot0[1],
    liquidity: liquidity.toString(),
    reserves: { [s0]: formatUnits(b0, d0), [s1]: formatUnits(b1, d1) },
    poolHskUsd,
    oracle: {
      hskUsd: oracleHskUsd,
      hskUpdatedAt: new Date(Number(hskRound[3]) * 1000).toISOString(),
      usdtUsd: oracleUsdtUsd,
      usdtUpdatedAt: new Date(Number(usdtRound[3]) * 1000).toISOString(),
    },
    poolVsOracleBps: Math.round(((poolHskUsd - oracleHskUsd) / oracleHskUsd) * 10_000),
    readAt: new Date().toISOString(),
  };
}

export const analyst: SkillDef = {
  id: "market-brief",
  name: "HSK market brief",
  description: "Reads the live HSK/USDT pool on HSKSwap and the APRO oracle on HSK Chain and writes a short market brief.",
  acceptance: "Markdown brief that quotes the live pool price, the oracle price and their deviation, pool reserves, and states data freshness.",
  examples: ["Brief me on HSK/USDT liquidity and price"],
  async run(ctx, input) {
    const snap = await hskMarketSnapshot();
    const text = await ctx.llm.text(ctx.cfg.models.provider, [
      {
        role: "system",
        content:
          "You are a crypto market analyst. Write a concise markdown brief (under 250 words) for a trading agent. Use only the numbers given; " +
          "quote pool price, oracle price, deviation in bps, reserves, and how stale the oracle is. No investment advice.",
      },
      { role: "user", content: `Question: ${String(input.question ?? "HSK/USDT on HSKSwap")}\n\nLive data:\n${JSON.stringify(snap, null, 2)}` },
    ]);
    return { format: "markdown", content: text, meta: { snapshot: snap } };
  },
};

export const localizer: SkillDef = {
  id: "localize",
  name: "Hindi localization",
  description: "Translates a report into Hindi (Devanagari), keeping code identifiers, numbers and addresses intact.",
  acceptance: "The full text translated into Hindi in Devanagari script; technical identifiers, numbers and addresses unchanged; nothing omitted.",
  examples: ["Translate this audit summary into Hindi"],
  async run(ctx, input) {
    const text = String(input.text ?? "");
    const out = await ctx.llm.text(ctx.cfg.models.provider, [
      {
        role: "system",
        content:
          "Translate the user's text into Hindi (Devanagari). Keep code identifiers, function names, numbers, addresses and severity labels in English. " +
          "Output only the translation in markdown.",
      },
      { role: "user", content: text.slice(0, 12_000) },
    ]);
    return { format: "markdown", content: out, meta: { sourceChars: text.length } };
  },
};

/** The unreliable provider used to show the negative paths. */
export const shady: SkillDef = {
  id: "audit",
  name: "Smart-contract audit (cheap)",
  description: "Claims to audit contracts. Sometimes delivers filler; sometimes never delivers.",
  acceptance: auditor.acceptance,
  examples: ["Audit this contract"],
  async run(_ctx, input) {
    if (input.__mode === "noshow") throw new NoShow();
    return {
      format: "json",
      content: JSON.stringify({
        summary: "Lorem ipsum dolor sit amet. The contract looks fine overall.",
        findings: [{ severity: "info", title: "General review", location: "n/a", detail: "Lorem ipsum dolor sit amet, consectetur adipiscing elit.", recommendation: "TBD" }],
      }, null, 2),
    };
  },
};

export class NoShow extends Error {
  constructor() {
    super("provider will not deliver");
  }
}
