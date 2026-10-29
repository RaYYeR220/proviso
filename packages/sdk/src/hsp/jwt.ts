import { createPrivateKey, createPublicKey, randomUUID, sign, verify } from "node:crypto";
import { cartHash } from "./crypto.ts";
import type { CartMandate, CartContents } from "./types.ts";

/** The merchant SDKs use this spelling; the docs spell it "HashkeyMerchant". Both are accepted on verify. */
export const MERCHANT_JWT_AUDIENCE = "HashKeyMerchant";
const ACCEPTED_AUDIENCES = new Set(["HashKeyMerchant", "HashkeyMerchant"]);

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");

// ES256K = ECDSA over secp256k1 with SHA-256, signature as raw r||s (JWS), which WebCrypto-based JOSE
// libraries cannot produce; node:crypto can.

/** ES256K `merchant_authorization` over a cart's contents. */
export async function signCartJwt(input: {
  contents: CartContents;
  merchantPrivateKeyPem: string;
  issuer: string;
  subject?: string;
  expiresAt: number;
  audience?: string;
}): Promise<string> {
  const key = createPrivateKey(input.merchantPrivateKeyPem.replace(/\\n/g, "\n"));
  const now = Math.floor(Date.now() / 1000);
  const signingInput = `${b64url({ alg: "ES256K", typ: "JWT" })}.${b64url({
    iss: input.issuer,
    sub: input.subject ?? input.issuer,
    aud: input.audience ?? MERCHANT_JWT_AUDIENCE,
    iat: now,
    exp: input.expiresAt,
    jti: randomUUID(),
    cart_hash: cartHash(input.contents),
  })}`;
  const sig = sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${sig.toString("base64url")}`;
}

export type CartJwtCheck = { ok: true } | { ok: false; reason: "JWT_INVALID" | "CART_HASH_MISMATCH" };

/** Verifies a cart's merchant authorization against the merchant's published secp256k1 public key. */
export async function verifyCartJwt(
  cart: CartMandate,
  merchantPublicKeyPem: string,
  now = Math.floor(Date.now() / 1000),
): Promise<CartJwtCheck> {
  try {
    const [h, p, s] = cart.merchant_authorization.split(".");
    if (!h || !p || !s) return { ok: false, reason: "JWT_INVALID" };
    const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    if (header.alg !== "ES256K") return { ok: false, reason: "JWT_INVALID" };
    const key = createPublicKey(merchantPublicKeyPem.replace(/\\n/g, "\n"));
    const valid = verify("sha256", Buffer.from(`${h}.${p}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url"));
    if (!valid) return { ok: false, reason: "JWT_INVALID" };
    const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    const auds: unknown[] = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!auds.some((a) => typeof a === "string" && ACCEPTED_AUDIENCES.has(a))) return { ok: false, reason: "JWT_INVALID" };
    if (typeof claims.exp === "number" && claims.exp < now) return { ok: false, reason: "JWT_INVALID" };
    if (claims.cart_hash !== cartHash(cart.contents)) return { ok: false, reason: "CART_HASH_MISMATCH" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "JWT_INVALID" };
  }
}
