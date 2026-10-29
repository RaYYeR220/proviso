import { getAddress, hashTypedData, recoverTypedDataAddress, type Address, type Hex, type LocalAccount } from "viem";

/**
 * AP2 v0.1 IntentMandate (the user's standing instruction to a paying agent, human-not-present), plus the
 * spending terms Proviso's paying agent enforces. `requires_refundability: true` is what makes a plain HSP
 * transfer unacceptable: only a cart whose `pay_to` is a Proviso vault can be refunded.
 */
export interface Intent {
  natural_language_description: string;
  user_cart_confirmation_required: boolean;
  merchants?: string[] | null;
  skus?: string[] | null;
  requires_refundability?: boolean;
  intent_expiry: string;
  proviso: {
    chainId: number;
    payer: Address;
    token: Address;
    /** base units */
    maxPerDeal: string;
    /** base units, across all deals under this intent */
    budgetTotal: string;
    /** 0-100 settlement-backed reputation floor; 0 accepts new providers */
    minProviderReputation: number;
    allowedValidators: Address[];
  };
}

const INTENT_TYPES = {
  Intent: [
    { name: "description", type: "string" },
    { name: "userCartConfirmationRequired", type: "bool" },
    { name: "merchants", type: "string[]" },
    { name: "skus", type: "string[]" },
    { name: "requiresRefundability", type: "bool" },
    { name: "expiry", type: "string" },
    { name: "payer", type: "address" },
    { name: "token", type: "address" },
    { name: "maxPerDeal", type: "uint256" },
    { name: "budgetTotal", type: "uint256" },
    { name: "minProviderReputation", type: "uint8" },
    { name: "allowedValidators", type: "address[]" },
  ],
} as const;

function typed(intent: Intent) {
  return {
    domain: { name: "Proviso Intent", version: "1", chainId: intent.proviso.chainId },
    types: INTENT_TYPES,
    primaryType: "Intent" as const,
    message: {
      description: intent.natural_language_description,
      userCartConfirmationRequired: intent.user_cart_confirmation_required,
      merchants: intent.merchants ?? [],
      skus: intent.skus ?? [],
      requiresRefundability: !!intent.requires_refundability,
      expiry: intent.intent_expiry,
      payer: getAddress(intent.proviso.payer),
      token: getAddress(intent.proviso.token),
      maxPerDeal: BigInt(intent.proviso.maxPerDeal),
      budgetTotal: BigInt(intent.proviso.budgetTotal),
      minProviderReputation: intent.proviso.minProviderReputation,
      allowedValidators: intent.proviso.allowedValidators.map((a) => getAddress(a)),
    },
  };
}

/** EIP-712 hash of the intent; deal terms commit to it as `intentHash`. */
export function hashIntent(intent: Intent): Hex {
  return hashTypedData(typed(intent));
}

export function signIntent(account: LocalAccount, intent: Intent): Promise<Hex> {
  return account.signTypedData(typed(intent));
}

export function recoverIntentSigner(intent: Intent, signature: Hex): Promise<Address> {
  return recoverTypedDataAddress({ ...typed(intent), signature });
}

/** A2A data-part keys (AP2 v0.1 + Proviso). */
export const DATA_KEYS = {
  intentMandate: "ap2.mandates.IntentMandate",
  cartMandate: "ap2.mandates.CartMandate",
  paymentMandate: "ap2.mandates.PaymentMandate",
  paymentReceipt: "ap2.PaymentReceipt",
  terms: "proviso.terms",
  task: "proviso.task",
  delivery: "proviso.delivery",
  refusal: "proviso.refusal",
} as const;

export const EXTENSIONS = {
  ap2: "https://github.com/google-agentic-commerce/ap2/tree/v0.1",
  x402: "https://github.com/google-agentic-commerce/a2a-x402/blob/main/spec/v0.2",
  proviso: "https://github.com/RaYYeR220/proviso/blob/main/docs/a2a-extension.md",
} as const;

/** A2A v1 wire data part: `{ data: { <key>: <value> } }`. */
export function dataPart(key: string, value: unknown): { data: Record<string, unknown> } {
  return { data: { [key]: value } };
}

/** Finds `<key>` in A2A wire parts (`{data:{...}}`) or SDK parts (`{content:{$case:'data', value}}`). */
export function findData<T = unknown>(parts: readonly unknown[] | undefined, key: string): T | undefined {
  for (const p of parts ?? []) {
    const part = p as { data?: Record<string, unknown>; content?: { $case?: string; value?: Record<string, unknown> } };
    const d = part.data ?? (part.content?.$case === "data" ? part.content.value : undefined);
    if (d && key in d) return d[key] as T;
  }
  return undefined;
}
