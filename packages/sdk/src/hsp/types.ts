import type { Address, Hex } from "viem";

/** AP2 v0.1 / W3C Payment Request shapes as the HSP gateway uses them. */
export interface PaymentCurrencyAmount {
  currency: string;
  value: string;
}

export interface PaymentItem {
  label: string;
  amount: PaymentCurrencyAmount;
  pending?: boolean;
}

export interface X402MethodData {
  x402Version: 2;
  network: string;
  chain_id: number;
  contract_address: Address;
  pay_to: Address;
  coin: string;
}

export interface PaymentMethodData {
  supported_methods: string;
  data: X402MethodData;
}

export interface PaymentRequest {
  method_data: PaymentMethodData[];
  details: {
    id: string;
    display_items: PaymentItem[];
    total: PaymentItem;
  };
}

export interface CartContents {
  id: string;
  user_cart_confirmation_required: boolean;
  payment_request: PaymentRequest;
  cart_expiry: string;
  merchant_name: string;
}

export interface CartMandate {
  contents: CartContents;
  merchant_authorization: string;
}

export interface PaymentMandateContents {
  payment_mandate_id: string;
  payment_details_id: string;
  payment_details_total: PaymentItem;
  payment_response: {
    request_id: string;
    method_name: string;
    details: { payment_payload: string };
    shipping_address: null;
    shipping_option: null;
    payer_name: null;
    payer_email: null;
    payer_phone: null;
  };
  merchant_agent: string;
  timestamp: string;
}

export interface PaymentMandate {
  payment_mandate_contents: PaymentMandateContents;
  user_authorization: string;
}

/** A token entry of `GET /api/v1/payment/chain-config`. */
export interface HspToken {
  chain_id: number;
  symbol: string;
  name: string;
  address: Address;
  decimals: number;
  version: string;
  payment_protocol: "eip3009" | "permit2";
  is_stablecoin?: boolean;
  permit2_spender: Address;
}

export interface HspNetwork {
  chain_id: number;
  name: string;
  display_name?: string;
  is_testnet?: boolean;
}

export interface Eip3009Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

export interface Permit2Authorization {
  owner: Address;
  spender: Address;
  permitted: { token: Address; amount: string };
  nonce: string;
  deadline: string;
}

/** x402 v2 "exact" PaymentPayload carried (base64) inside the AP2 PaymentMandate. */
export interface X402PaymentPayload {
  x402Version: 2;
  payload: { signature: Hex; authorization: Eip3009Authorization | Permit2Authorization };
  accepted: {
    scheme: "exact";
    network: string;
    asset: Address;
    amount: string;
    payTo: Address;
    maxTimeoutSeconds: number;
    extra: { protocol: "eip3009" | "permit2"; name: string; version: string };
  };
  resource?: { url: string; description: string; mimeType: string };
}

/** Payment states reported by the gateway (and its webhooks). */
export type HspPaymentStatus =
  | "payment-required"
  | "payment-submitted"
  | "payment-verified"
  | "payment-processing"
  | "payment-included"
  | "payment-safe"
  | "payment-finalized"
  | "payment-failed";

export interface HspWebhookEvent {
  event_type: string;
  payment_request_id: string;
  request_id: string;
  cart_mandate_id: string;
  payer_address: Address;
  to_pay_address: Address;
  amount: string;
  token: string;
  token_address: Address;
  chain: string;
  network: string;
  status: HspPaymentStatus;
  tx_signature?: Hex;
  [k: string]: unknown;
}
