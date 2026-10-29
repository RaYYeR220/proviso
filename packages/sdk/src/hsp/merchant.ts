import type { Address } from "viem";
import { buildAppAuthHeaders } from "./crypto.ts";
import { signCartJwt } from "./jwt.ts";
import type { CartContents, CartMandate, HspToken, PaymentItem } from "./types.ts";

export const X402_METHOD = "https://www.x402.org/";

/** HSP network names used in `method_data[].data.network`. */
export const HSP_NETWORK: Record<number, string> = { 177: "hashkey", 133: "hashkey-testnet" };

export interface BuildCartInput {
  cartMandateId: string;
  paymentRequestId: string;
  merchantName: string;
  merchantPrivateKeyPem: string;
  /** Where the gateway sends the money. For Proviso this is the predicted deal vault. */
  payTo: Address;
  token: Pick<HspToken, "chain_id" | "address" | "symbol">;
  network?: string;
  /** USD total with at most two decimals, e.g. "0.05". */
  totalUsd: string;
  items?: PaymentItem[];
  expiresAt: Date;
  userConfirmationRequired?: boolean;
}

/** Builds and signs an AP2 Cart Mandate in the HSP wire format (one x402 payment method). */
export async function buildCartMandate(input: BuildCartInput): Promise<CartMandate> {
  if (!/^\d+(\.\d{1,2})?$/.test(input.totalUsd)) throw new Error(`totalUsd must have at most 2 decimals: ${input.totalUsd}`);
  const total: PaymentItem = { label: "Total", amount: { currency: "USD", value: input.totalUsd } };
  const contents: CartContents = {
    id: input.cartMandateId,
    user_cart_confirmation_required: input.userConfirmationRequired ?? true,
    payment_request: {
      method_data: [
        {
          supported_methods: X402_METHOD,
          data: {
            x402Version: 2,
            network: input.network ?? HSP_NETWORK[input.token.chain_id] ?? String(input.token.chain_id),
            chain_id: input.token.chain_id,
            contract_address: input.token.address,
            pay_to: input.payTo,
            coin: input.token.symbol,
          },
        },
      ],
      details: {
        id: input.paymentRequestId,
        display_items: input.items ?? [{ label: "Service", amount: total.amount }],
        total,
      },
    },
    cart_expiry: input.expiresAt.toISOString(),
    merchant_name: input.merchantName,
  };
  const merchant_authorization = await signCartJwt({
    contents,
    merchantPrivateKeyPem: input.merchantPrivateKeyPem,
    issuer: input.merchantName,
    expiresAt: Math.floor(input.expiresAt.getTime() / 1000),
  });
  return { contents, merchant_authorization };
}

export class HspApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(`HSP ${status}/${code}: ${message}`);
  }
}

export async function hspRequest<T>(
  baseUrl: string,
  input: { method: string; path: string; rawQuery?: string; rawBody?: string; headers?: Record<string, string> },
): Promise<T> {
  const url = `${baseUrl.replace(/\/+$/, "")}${input.path}${input.rawQuery ? `?${input.rawQuery}` : ""}`;
  const res = await fetch(url, {
    method: input.method,
    headers: { "Content-Type": "application/json", ...input.headers },
    body: input.rawBody,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let env: { code?: number; msg?: string; data?: unknown };
  try {
    env = JSON.parse(text);
  } catch {
    throw new HspApiError(res.status, res.status, `non-JSON response: ${text.slice(0, 200)}`);
  }
  if (!res.ok || env.code !== 0) throw new HspApiError(res.status, env.code ?? res.status, env.msg ?? "error", env.data);
  return env.data as T;
}

export interface HspMerchantConfig {
  baseUrl: string;
  appKey: string;
  appSecret: string;
  merchantName: string;
  merchantPrivateKeyPem: string;
}

export interface CreatedOrder {
  cartMandate: CartMandate;
  paymentRequestId: string;
  paymentUrl: string;
  flowId: string;
  multiPay: boolean;
}

/** Merchant side of the HSP gateway (orders + payment queries), HMAC-authenticated. */
export class HspMerchant {
  constructor(readonly config: HspMerchantConfig) {}

  async createOrder(
    input: Omit<BuildCartInput, "merchantName" | "merchantPrivateKeyPem"> & { webhookUrl?: string; redirectUrl?: string },
    opts: { reusable?: boolean } = {},
  ): Promise<CreatedOrder> {
    const cartMandate = await buildCartMandate({
      ...input,
      merchantName: this.config.merchantName,
      merchantPrivateKeyPem: this.config.merchantPrivateKeyPem,
    });
    const path = opts.reusable ? "/api/v1/merchant/orders/reusable" : "/api/v1/merchant/orders";
    const rawBody = JSON.stringify({
      cart_mandate: cartMandate,
      redirect_url: input.redirectUrl,
      webhook_url: input.webhookUrl,
    });
    const data = await this.authed<{ payment_request_id: string; payment_url: string; multi_pay?: boolean }>({
      method: "POST",
      path,
      rawBody,
    });
    return {
      cartMandate,
      paymentRequestId: data.payment_request_id,
      paymentUrl: data.payment_url,
      flowId: flowIdFromPaymentUrl(data.payment_url),
      multiPay: data.multi_pay ?? !!opts.reusable,
    };
  }

  async getPayments(q: { cartMandateId?: string; paymentRequestId?: string; flowId?: string }): Promise<unknown> {
    const params = new URLSearchParams();
    if (q.cartMandateId) params.set("cart_mandate_id", q.cartMandateId);
    if (q.paymentRequestId) params.set("payment_request_id", q.paymentRequestId);
    if (q.flowId) params.set("flow_id", q.flowId);
    return this.authed({ method: "GET", path: "/api/v1/merchant/payments", rawQuery: params.toString() });
  }

  private authed<T>(input: { method: string; path: string; rawQuery?: string; rawBody?: string }): Promise<T> {
    const headers = buildAppAuthHeaders({
      method: input.method,
      path: input.path,
      rawQuery: input.rawQuery ?? "",
      rawBody: input.rawBody,
      appKey: this.config.appKey,
      appSecret: this.config.appSecret,
    });
    return hspRequest<T>(this.config.baseUrl, { ...input, headers });
  }
}

/** `https://pay.hashkey.com/flow/<flow_id>` → `<flow_id>`. */
export function flowIdFromPaymentUrl(paymentUrl: string): string {
  const path = new URL(paymentUrl).pathname.replace(/\/+$/, "");
  const id = path.split("/").pop();
  if (!id) throw new Error(`no flow id in ${paymentUrl}`);
  return id;
}
