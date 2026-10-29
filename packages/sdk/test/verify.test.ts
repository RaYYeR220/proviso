import { generateKeyPairSync } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getAddress, keccak256, toHex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildCartMandate, type CartMandate, type HspToken } from "../src/hsp/index.ts";
import { hashIntent, signIntent, recoverIntentSigner, type Intent } from "../src/ap2.ts";
import { predictVault, type Terms } from "../src/terms.ts";
import { verifyCart, type RefusalCode, type VerifyCartInput } from "../src/verifyCart.ts";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
const merchantPem = privateKey.export({ type: "sec1", format: "pem" }).toString();
const merchantPub = publicKey.export({ type: "spki", format: "pem" }).toString();

const user = privateKeyToAccount("0x00000000000000000000000000000000000000000000000000000000000000a1");
const agent = privateKeyToAccount("0x00000000000000000000000000000000000000000000000000000000000000a2");
const provider = getAddress("0x00000000000000000000000000000000000000b1");
const validators = [
  getAddress("0x00000000000000000000000000000000000000c1"),
  getAddress("0x00000000000000000000000000000000000000c2"),
  getAddress("0x00000000000000000000000000000000000000c3"),
] as const;
const deployment = {
  dealFactory: getAddress("0x5102481bB8b769231Edc468A6AAe610becCA0292"),
  vaultImpl: getAddress("0x7B0Dd4D1bB08b15B5D34d2C2C2d9D0F3Af139125"),
};
const token: HspToken = {
  chain_id: 133,
  symbol: "USDC",
  name: "USD Coin",
  address: getAddress("0x8FE3cB719Ee4410E236Cd6b72ab1fCDC06eF53c6"),
  decimals: 6,
  version: "2",
  payment_protocol: "eip3009",
  permit2_spender: getAddress("0x1aaA5E4371aAdf96bEfb5bd2Af4d896FD16915Ea"),
};
const NOW = 1_850_000_000;

let intent: Intent;
let intentSignature: `0x${string}`;
let terms: Terms;

async function makeCart(over: { payTo?: Address; total?: string; tokenAddr?: Address; expiresAt?: Date; key?: string } = {}) {
  return buildCartMandate({
    cartMandateId: "deal-1",
    paymentRequestId: "pr-1",
    merchantName: "Proviso",
    merchantPrivateKeyPem: over.key ?? merchantPem,
    payTo: over.payTo ?? predictVault({ ...deployment, terms }),
    token: { chain_id: 133, address: over.tokenAddr ?? token.address, symbol: "USDC" },
    totalUsd: over.total ?? "0.05",
    expiresAt: over.expiresAt ?? new Date((NOW + 3600) * 1000),
  });
}

function input(cart: CartMandate, over: Partial<VerifyCartInput> = {}): VerifyCartInput {
  return {
    cart,
    terms,
    intent,
    intentSignature,
    user: user.address,
    self: agent.address,
    deployment,
    token,
    merchantPublicKeyPem: merchantPub,
    spentSoFar: 0n,
    providerReputation: { count: 3n, average: 90 },
    checkTerms: async () => ({ ok: true }),
    now: NOW,
    ...over,
  };
}

async function refusal(cart: CartMandate, over: Partial<VerifyCartInput> = {}): Promise<RefusalCode | "OK"> {
  const r = await verifyCart(input(cart, over));
  return r.ok ? "OK" : r.code;
}

beforeAll(async () => {
  intent = {
    natural_language_description: "Audit my contract, then translate the report to Hindi",
    user_cart_confirmation_required: false,
    merchants: ["Proviso"],
    requires_refundability: true,
    intent_expiry: new Date((NOW + 86400) * 1000).toISOString(),
    proviso: {
      chainId: 133,
      payer: agent.address,
      token: token.address,
      maxPerDeal: "100000",
      budgetTotal: "200000",
      minProviderReputation: 50,
      allowedValidators: [...validators],
    },
  };
  intentSignature = await signIntent(user, intent);
  terms = {
    payer: agent.address,
    provider,
    token: token.address,
    amount: 50_000n,
    deliverBy: BigInt(NOW + 1800),
    challengeWindow: 600,
    courtWindow: 1800,
    feeBps: 100,
    courtFeeBps: 300,
    validators,
    providerAgentId: 1n,
    payerAgentId: 2n,
    specHash: keccak256(toHex("spec")),
    intentHash: hashIntent(intent),
    salt: keccak256(toHex("deal-1")),
  };
});

describe("intent mandate", () => {
  it("signature recovers to the user", async () => {
    expect(await recoverIntentSigner(intent, intentSignature)).toBe(user.address);
  });
  it("hash changes when the budget changes", () => {
    expect(hashIntent({ ...intent, proviso: { ...intent.proviso, budgetTotal: "1" } })).not.toBe(hashIntent(intent));
  });
});

describe("verifyCart", () => {
  it("accepts a cart whose pay_to is the vault committed by the terms", async () => {
    const r = await verifyCart(input(await makeCart()));
    expect(r).toEqual({ ok: true, vault: predictVault({ ...deployment, terms }) });
  });

  it("INTENT_SIG_INVALID", async () => {
    const forged = await signIntent(agent, intent);
    expect(await refusal(await makeCart(), { intentSignature: forged })).toBe("INTENT_SIG_INVALID");
  });

  it("INTENT_EXPIRED", async () => {
    expect(await refusal(await makeCart(), { now: NOW + 86400 + 1 })).toBe("INTENT_EXPIRED");
  });

  it("JWT_INVALID (signed by another key)", async () => {
    const other = generateKeyPairSync("ec", { namedCurve: "secp256k1" }).privateKey.export({ type: "sec1", format: "pem" }).toString();
    expect(await refusal(await makeCart({ key: other }))).toBe("JWT_INVALID");
  });

  it("CART_HASH_MISMATCH (contents edited after signing)", async () => {
    const c = await makeCart();
    c.contents.merchant_name = "Someone else";
    expect(await refusal(c)).toBe("CART_HASH_MISMATCH");
  });

  it("CART_EXPIRED", async () => {
    expect(await refusal(await makeCart({ expiresAt: new Date((NOW - 1) * 1000) }), {})).toMatch(/CART_EXPIRED|JWT_INVALID/);
  });

  it("PAYER_NOT_SELF", async () => {
    expect(await refusal(await makeCart(), { self: user.address })).toBe("PAYER_NOT_SELF");
  });

  it("TOKEN_MISMATCH", async () => {
    const c = await makeCart({ tokenAddr: getAddress("0x372325443233fEbaC1F6998aC750276468c83CC6") });
    expect(await refusal(c)).toBe("TOKEN_MISMATCH");
  });

  it("AMOUNT_MISMATCH", async () => {
    expect(await refusal(await makeCart({ total: "0.06" }))).toBe("AMOUNT_MISMATCH");
  });

  it("NOT_REFUNDABLE when pay_to is a raw wallet and the intent requires refundability", async () => {
    expect(await refusal(await makeCart({ payTo: provider }))).toBe("NOT_REFUNDABLE");
  });

  it("PAYTO_NOT_VAULT when refundability is not required", async () => {
    const loose = { ...intent, requires_refundability: false };
    const sig = await signIntent(user, loose);
    const t = { ...terms, intentHash: hashIntent(loose) };
    expect(await refusal(await makeCart({ payTo: provider }), { intent: loose, intentSignature: sig, terms: t })).toBe(
      "PAYTO_NOT_VAULT",
    );
  });

  it("INTENT_MISMATCH (terms commit to a different intent)", async () => {
    expect(await refusal(await makeCart(), { terms: { ...terms, intentHash: keccak256(toHex("x")) } })).toMatch(
      /INTENT_MISMATCH|NOT_REFUNDABLE/,
    );
  });

  it("TERMS_INVALID (factory rejects)", async () => {
    expect(await refusal(await makeCart(), { checkTerms: async () => ({ ok: false, reason: "windows" }) })).toBe(
      "TERMS_INVALID",
    );
  });

  it("OVER_DEAL_CAP", async () => {
    const big = { ...terms, amount: 150_000n };
    const c = await buildCartMandate({
      cartMandateId: "deal-1",
      paymentRequestId: "pr-1",
      merchantName: "Proviso",
      merchantPrivateKeyPem: merchantPem,
      payTo: predictVault({ ...deployment, terms: big }),
      token: { chain_id: 133, address: token.address, symbol: "USDC" },
      totalUsd: "0.15",
      expiresAt: new Date((NOW + 3600) * 1000),
    });
    expect(await refusal(c, { terms: big })).toBe("OVER_DEAL_CAP");
  });

  it("OVER_BUDGET", async () => {
    expect(await refusal(await makeCart(), { spentSoFar: 160_000n })).toBe("OVER_BUDGET");
  });

  it("VALIDATOR_NOT_ALLOWED", async () => {
    const t = { ...terms, validators: [validators[0], validators[1], provider] as const };
    const c = await makeCart({ payTo: predictVault({ ...deployment, terms: t }) });
    expect(await refusal(c, { terms: t })).toBe("VALIDATOR_NOT_ALLOWED");
  });

  it("REPUTATION_TOO_LOW", async () => {
    expect(await refusal(await makeCart(), { providerReputation: { count: 5n, average: 20 } })).toBe("REPUTATION_TOO_LOW");
  });

  it("NOT_REFUNDABLE for a plain checkout with no escrow terms", async () => {
    expect(await refusal(await makeCart({ payTo: provider }), { terms: undefined })).toBe("NOT_REFUNDABLE");
  });

  it("MERCHANT_NOT_ALLOWED", async () => {
    const strict = { ...intent, merchants: ["Someone"] };
    const sig = await signIntent(user, strict);
    const t = { ...terms, intentHash: hashIntent(strict) };
    const c = await makeCart({ payTo: predictVault({ ...deployment, terms: t }) });
    expect(await refusal(c, { intent: strict, intentSignature: sig, terms: t })).toBe("MERCHANT_NOT_ALLOWED");
  });
});
