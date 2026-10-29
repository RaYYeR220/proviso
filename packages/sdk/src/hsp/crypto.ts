import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { CartContents } from "./types.ts";

/** JSON with object keys sorted recursively and `undefined` members dropped (HSP's cart hashing rule). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeys);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) out[key] = sortKeys(child);
  }
  return out;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function hmacHex(secret: string | Uint8Array, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

export function equalHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

/** `cart_hash` claim of the merchant authorization: sha256 hex of the canonical cart contents. */
export function cartHash(contents: CartContents): string {
  return sha256Hex(canonicalJson(contents));
}

/** Headers for an HMAC-authenticated `/api/v1/merchant/*` call. */
export function buildAppAuthHeaders(input: {
  method: string;
  path: string;
  rawQuery: string;
  rawBody?: string;
  appKey: string;
  appSecret: string;
  timestamp?: number;
  nonce?: string;
}): Record<string, string> {
  const method = input.method.toUpperCase();
  const timestamp = input.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = input.nonce ?? randomHex(16);
  const bodyHash = input.rawBody ? sha256Hex(input.rawBody) : "";
  const signing = [method, input.path, input.rawQuery, bodyHash, String(timestamp), nonce].join("\n");
  return {
    "Content-Type": "application/json",
    "X-App-Key": input.appKey,
    "X-Timestamp": String(timestamp),
    "X-Nonce": nonce,
    "X-Signature": hmacHex(input.appSecret, signing),
  };
}
