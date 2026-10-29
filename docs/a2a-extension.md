# Proviso A2A extension

URI: `https://github.com/RaYYeR220/proviso/blob/main/docs/a2a-extension.md`

Proviso agents speak [A2A v1.0](https://a2a-protocol.org/latest/specification/) and carry
[AP2 v0.1](https://github.com/google-agentic-commerce/ap2/tree/v0.1) mandates in data parts, the same
shapes the HSP gateway uses. This extension adds one thing on top: the deal terms an escrow address is
derived from, so the paying agent can check that the cart's `pay_to` is an escrow before it signs.

An agent card that supports it lists three extensions:

```json
"extensions": [
  { "uri": "https://github.com/google-agentic-commerce/ap2/tree/v0.1", "required": true, "params": { "roles": ["merchant"] } },
  { "uri": "https://github.com/google-agentic-commerce/a2a-x402/blob/main/spec/v0.2", "required": false, "params": {} },
  { "uri": "https://github.com/RaYYeR220/proviso/blob/main/docs/a2a-extension.md", "required": false,
    "params": { "chainId": 177, "dealFactory": "0x…", "identityRegistry": "0x…", "agentId": "1",
                "merchantOfRecord": { "name": "Proviso", "publicKeyPem": "-----BEGIN PUBLIC KEY-----…" },
                "priceUsd": "0.05" } }
]
```

Clients activate them with the `A2A-Extensions` header.

## Data parts

| key | in | carries |
|---|---|---|
| `proviso.task` | user message, turn 1 | `{ skill, input, payer, payerAgentId, intentHash }` |
| `ap2.mandates.IntentMandate` | user message, turn 1 | the user's signed intent (AP2 v0.1 fields + `proviso` spending terms) |
| `ap2.mandates.CartMandate` | artifact `cart` | the HSP Cart Mandate; `method_data[0].data.pay_to` is the escrow |
| `proviso.terms` | artifact `cart` | the deal `Terms` (decimal strings for integers) and the derived `vault` |
| `proviso.hsp` | artifact `cart` | `{ flowId, paymentUrl, rail }` |
| `ap2.mandates.PaymentMandate` | user message, turn 2 | the payer's AP2 Payment Mandate (x402 v2 payload inside) |
| `proviso.delivery` | artifact `deliverable` | `{ vault, deliveryHash, uri, tx, format, content }` |

## Flow

1. **Turn 1.** The paying agent sends `proviso.task` and its intent. The provider answers with the
   `cart` artifact and status `TASK_STATE_INPUT_REQUIRED`.
2. **Check.** Before signing anything the paying agent recomputes
   `vault = predictVault(dealFactory, vaultImpl, terms)` and checks that `pay_to == vault`. It also checks
   the merchant's ES256K signature over the cart and the terms against its intent: amount, token, deadline,
   validators, and the provider's settlement-backed reputation. Any mismatch refuses with a named code
   (`@proviso/sdk` `verifyCart`).
3. **Pay.** The paying agent signs the token authorization (EIP-3009 `to = vault` for USDC.e) and submits the
   Payment Mandate to the HSP gateway (`POST /api/v1/payment/pay-mandate`). It also sends the mandate to the
   provider on the same task (turn 2, `returnImmediately: true`).
4. **Work.** Once the escrow holds the amount, the provider works and commits the hash of the deliverable
   to the vault with an EIP-712 `Delivery` signature. It returns the `deliverable` artifact and
   `TASK_STATE_COMPLETED`.
5. **Settle.** The paying agent accepts (`Accept`, which releases the escrow) or disputes (`Dispute` with a
   hash of its written reason). If it does nothing, the escrow releases when the challenge window ends.
   A dispute is decided by any two of the three validators named in the terms, through the ERC-8004
   ValidationRegistry.
