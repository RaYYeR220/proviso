import { createHash, createHmac, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeJwt, decodeProtectedHeader } from "jose";
import { getAddress, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildAppAuthHeaders,
  buildCartMandate,
  buildPaymentMandate,
  canonicalJson,
  cartHash,
  decodePaymentPayload,
  flowIdFromPaymentUrl,
  HspPayer,
  signWebhookForTest,
  verifyCartJwt,
  verifyWebhook,
  type Eip3009Authorization,
  type HspToken,
  type Permit2Authorization,
} from "../src/hsp/index.ts";
import { HSK } from "../src/chains.ts";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
const merchantPrivatePem = privateKey.export({ type: "sec1", format: "pem" }).toString();
const merchantPublicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const other = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
const otherPublicPem = other.publicKey.export({ type: "spki", format: "pem" }).toString();

const usdcE: HspToken = {
  chain_id: 177,
  symbol: "USDC",
  name: "Bridged USDC",
  address: HSK.mainnet.usdcE,
  decimals: 6,
  version: "2",
  payment_protocol: "eip3009",
  permit2_spender: HSK.hspRelayer,
};
const usdt: HspToken = {
  chain_id: 177,
  symbol: "USDT",
  name: "Tether USD",
  address: HSK.mainnet.usdt,
  decimals: 6,
  version: "1",
  payment_protocol: "permit2",
  permit2_spender: HSK.hspRelayer,
};
const payTo = getAddress("0x00000000000000000000000000000000000ca5e5");
const payer = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000a11ce1");

async function cart(token = usdcE) {
  return buildCartMandate({
    cartMandateId: "deal-1",
    paymentRequestId: "pr-1",
    merchantName: "Proviso",
    merchantPrivateKeyPem: merchantPrivatePem,
    payTo,
    token,
    network: "hashkey",
    totalUsd: "0.05",
    items: [{ label: "Audit report", amount: { currency: "USD", value: "0.05" } }],
    expiresAt: new Date(Date.now() + 3600_000),
  });
}

describe("canonical json + cart hash", () => {
  it("sorts keys recursively and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[{"y":2,"z":1}]},"b":1}');
  });

  it("cart hash is sha256 of canonical contents", async () => {
    const c = await cart();
    const expected = createHash("sha256").update(canonicalJson(c.contents)).digest("hex");
    expect(cartHash(c.contents)).toBe(expected);
  });
});

describe("cart mandate JWT", () => {
  it("is ES256K with the cart hash claim and verifies with the merchant key", async () => {
    const c = await cart();
    expect(decodeProtectedHeader(c.merchant_authorization).alg).toBe("ES256K");
    expect(decodeJwt(c.merchant_authorization).cart_hash).toBe(cartHash(c.contents));
    expect(await verifyCartJwt(c, merchantPublicPem)).toEqual({ ok: true });
  });

  it("puts pay_to and the token into x402 method data", async () => {
    const c = await cart();
    const m = c.contents.payment_request.method_data[0]!;
    expect(m.supported_methods).toBe("https://www.x402.org/");
    expect(m.data).toMatchObject({ x402Version: 2, network: "hashkey", chain_id: 177, pay_to: payTo, coin: "USDC" });
  });

  it("rejects a tampered pay_to", async () => {
    const c = await cart();
    c.contents.payment_request.method_data[0]!.data.pay_to = "0x000000000000000000000000000000000000dEaD";
    expect(await verifyCartJwt(c, merchantPublicPem)).toEqual({ ok: false, reason: "CART_HASH_MISMATCH" });
  });

  it("rejects another key", async () => {
    const c = await cart();
    expect((await verifyCartJwt(c, otherPublicPem)).ok).toBe(false);
  });
});

describe("merchant request auth", () => {
  it("HMAC signs METHOD\\nPATH\\nQUERY\\nsha256(body)\\nTS\\nNONCE", () => {
    const body = '{"x":1}';
    const h = buildAppAuthHeaders({
      method: "post",
      path: "/api/v1/merchant/orders",
      rawQuery: "",
      rawBody: body,
      appKey: "ak",
      appSecret: "secret",
      timestamp: 1_800_000_000,
      nonce: "n1",
    });
    const bodyHash = createHash("sha256").update(body).digest("hex");
    const expected = createHmac("sha256", "secret")
      .update(["POST", "/api/v1/merchant/orders", "", bodyHash, "1800000000", "n1"].join("\n"))
      .digest("hex");
    expect(h["X-Signature"]).toBe(expected);
    expect(h["X-App-Key"]).toBe("ak");
  });
});

describe("payment mandate (payer side)", () => {
  it("EIP-3009 authorization binds to pay_to and verifies against the token domain", async () => {
    const c = await cart();
    const built = await buildPaymentMandate({
      cart: c,
      account: payer,
      token: usdcE,
      nonce: "0x1111111111111111111111111111111111111111111111111111111111111111",
    });
    const { paymentMandate, signature } = built;
    const authorization = built.authorization as Eip3009Authorization;
    expect(authorization).toMatchObject({ from: payer.address, to: payTo, value: "50000" });
    const ok = await verifyTypedData({
      address: payer.address,
      domain: { name: "Bridged USDC", version: "2", chainId: 177, verifyingContract: usdcE.address },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: payer.address,
        to: payTo,
        value: 50000n,
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: "0x1111111111111111111111111111111111111111111111111111111111111111",
      },
      signature,
    });
    expect(ok).toBe(true);

    const contents = paymentMandate.payment_mandate_contents;
    expect(contents.payment_mandate_id).toBe("pr-1");
    expect(contents.payment_response.method_name).toBe("https://www.x402.org/");
    expect(contents.merchant_agent).toBe("HashkeyMerchant");
    expect(contents.payment_details_total.amount).toEqual({ value: "0.05", currency: "USD" });

    const payload = decodePaymentPayload(paymentMandate);
    expect(payload.x402Version).toBe(2);
    expect(payload.accepted).toMatchObject({
      scheme: "exact",
      network: "eip155:177",
      asset: usdcE.address,
      amount: "50000",
      payTo,
      extra: { protocol: "eip3009", name: "Bridged USDC", version: "2" },
    });

    const ua = decodeJwt(paymentMandate.user_authorization);
    expect(ua.iss).toBe(payer.address);
    expect(ua.transaction_data).toEqual([
      cartHash(c.contents),
      createHash("sha256").update(canonicalJson(contents)).digest("hex"),
    ]);
  });

  it("Permit2 authorization names the HSP relayer as spender", async () => {
    const c = await cart(usdt);
    const built = await buildPaymentMandate({ cart: c, account: payer, token: usdt, nonce: 7n });
    const { signature } = built;
    const authorization = built.authorization as Permit2Authorization;
    expect(authorization).toMatchObject({ owner: payer.address, spender: HSK.hspRelayer, nonce: "7" });
    const ok = await verifyTypedData({
      address: payer.address,
      domain: { name: "Permit2", chainId: 177, verifyingContract: HSK.permit2 },
      types: {
        TokenPermissions: [
          { name: "token", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        PermitTransferFrom: [
          { name: "permitted", type: "TokenPermissions" },
          { name: "spender", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "PermitTransferFrom",
      message: {
        permitted: { token: usdt.address, amount: 50000n },
        spender: HSK.hspRelayer,
        nonce: 7n,
        deadline: BigInt(authorization.deadline),
      },
      signature,
    });
    expect(ok).toBe(true);
  });

  it("refuses to sign when the cart's token is not the given token", async () => {
    const c = await cart(usdt);
    await expect(buildPaymentMandate({ cart: c, account: payer, token: usdcE })).rejects.toThrow(/token/);
  });

  it("parses flow ids from payment urls", () => {
    expect(flowIdFromPaymentUrl("https://pay.hashkey.com/flow/abc123")).toBe("abc123");
    expect(flowIdFromPaymentUrl("https://pay.hashkey.com/flow/abc123?x=1")).toBe("abc123");
  });
});

describe("webhooks", () => {
  const secret = "whsec";
  const body = JSON.stringify({ event_type: "payment", status: "payment-finalized", request_id: "r1" });

  it("accepts a fresh signed body", () => {
    const header = signWebhookForTest(secret, body, Math.floor(Date.now() / 1000));
    expect(verifyWebhook({ rawBody: body, signatureHeader: header, secret }).ok).toBe(true);
  });

  it("rejects a forged signature", () => {
    const header = signWebhookForTest("wrong", body, Math.floor(Date.now() / 1000));
    expect(verifyWebhook({ rawBody: body, signatureHeader: header, secret })).toMatchObject({ ok: false });
  });

  it("rejects a stale timestamp", () => {
    const header = signWebhookForTest(secret, body, Math.floor(Date.now() / 1000) - 3600);
    expect(verifyWebhook({ rawBody: body, signatureHeader: header, secret })).toMatchObject({ ok: false });
  });

  it("rejects a modified body", () => {
    const header = signWebhookForTest(secret, body, Math.floor(Date.now() / 1000));
    expect(verifyWebhook({ rawBody: body.replace("r1", "r2"), signatureHeader: header, secret }).ok).toBe(false);
  });

  it("rejects a missing secret", () => {
    const header = signWebhookForTest(secret, body, Math.floor(Date.now() / 1000));
    expect(verifyWebhook({ rawBody: body, signatureHeader: header, secret: "" }).ok).toBe(false);
  });
});

describe.skipIf(process.env.OFFLINE === "1")("live HSP production read endpoints", () => {
  it("chain-config lists HSK Chain USDC.e and USDT settled by the HSP relayer", async () => {
    const cfg = await new HspPayer({ baseUrl: "https://hsp.hashkey.com" }).getChainConfig();
    const t = cfg.tokens.filter((x) => x.chain_id === 177);
    expect(t.map((x) => x.address.toLowerCase())).toEqual(
      expect.arrayContaining([HSK.mainnet.usdcE.toLowerCase(), HSK.mainnet.usdt.toLowerCase()]),
    );
    for (const x of t) expect(x.permit2_spender.toLowerCase()).toBe(HSK.hspRelayer.toLowerCase());
  });
});
