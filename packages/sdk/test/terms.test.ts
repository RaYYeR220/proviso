import { describe, expect, it } from "vitest";
import { createPublicClient, http, keccak256, toHex, zeroAddress, type Address } from "viem";
import { dealFactoryAbi } from "../src/abi.ts";
import { hskTestnet, deployments } from "../src/chains.ts";
import { encodeTerms, hashTerms, predictVault, type Terms } from "../src/terms.ts";

const sample: Terms = {
  payer: "0x9A712cb6353C84A7893b0A5Fd0702663a2032C21",
  provider: "0xE1793c158608d40a27A126330Af9D573d19b1Fe3",
  token: "0x8FE3cB719Ee4410E236Cd6b72ab1fCDC06eF53c6",
  amount: 50_000n,
  deliverBy: 1_900_000_000n,
  challengeWindow: 600,
  courtWindow: 1800,
  feeBps: 100,
  courtFeeBps: 300,
  validators: [
    "0x66770264c966fa2dC78c015820dfDc0098ECA1A6",
    "0x7c2135d26C4527EBfD253A84E4c93852a9c60090",
    "0x9b601ebD0be1E6D990EDBB788cFa58B20604bE2b",
  ],
  providerAgentId: 1n,
  payerAgentId: 0n,
  specHash: keccak256(toHex("spec")),
  intentHash: keccak256(toHex("intent")),
  salt: keccak256(toHex("cart-1")),
};

describe("terms", () => {
  it("hash is keccak of the abi encoding", () => {
    expect(hashTerms(sample)).toBe(keccak256(encodeTerms(sample)));
  });

  it("encoding is 17 static words (no dynamic parts)", () => {
    expect((encodeTerms(sample).length - 2) / 2).toBe(17 * 32);
  });

  it("changing any field changes the predicted vault", () => {
    const d = deployments[133]!;
    const base = predictVault({ dealFactory: d.dealFactory, vaultImpl: d.vaultImpl, terms: sample });
    const other = predictVault({ dealFactory: d.dealFactory, vaultImpl: d.vaultImpl, terms: { ...sample, amount: 50_001n } });
    expect(base).not.toBe(other);
    expect(base).not.toBe(zeroAddress);
  });

  it.skipIf(process.env.OFFLINE === "1")("matches DealFactory.predict on HSK testnet", async () => {
    const d = deployments[133]!;
    const client = createPublicClient({ chain: hskTestnet, transport: http() });
    const onchain = (await client.readContract({
      address: d.dealFactory,
      abi: dealFactoryAbi,
      functionName: "predict",
      args: [sample],
    })) as Address;
    expect(predictVault({ dealFactory: d.dealFactory, vaultImpl: d.vaultImpl, terms: sample })).toBe(onchain);
  });
});
