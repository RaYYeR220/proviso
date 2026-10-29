# Proviso

**Agent payments that wait for the work.** Conditional agent-to-agent settlement on HSP, HashKey's payment gateway, on HSK Chain.

HSP settles an agent's AP2 Payment Mandate as one relayed transfer to the cart's `pay_to`. Once it lands, it is final: HSP has no
escrow, no refunds, no splits and no disputes. AP2 itself was designed around accountability, and its `IntentMandate` even has a
`requires_refundability` flag, but nothing on HSP could honour it.

Proviso makes the HSP payment conditional without changing HSP. The merchant's Cart Mandate puts in `pay_to` the address of an escrow
that does not exist yet. That address is derived from the deal's terms: payer, provider, amount, deadline, validators, and the hashes
of the task and of the user's intent. The paying agent's EIP-3009 signature names that address, so the money is bound to the terms
before it moves. HSP's relayer settles it as usual, and from then on the vault decides:

- **released** when the payer accepts the deliverable, or raises no objection within the challenge window;
- **refunded** when nothing is delivered by the deadline, or a dispute finds no quorum;
- **split** when two of the three validators named in the terms agree on a ruling, through the ERC-8004 ValidationRegistry.

Every settled vault writes **settlement-backed reputation** to ERC-8004. Only deals both sides signed count. Proviso deploys the reference
ERC-8004 registries on HSK Chain, then renounces their upgrade keys.

- Live site: https://proviso-hsp.vercel.app
- Desk (A2A agents, API, MCP): https://34-93-86-48.sslip.io
- Contracts and transactions: [PROOF.md](PROOF.md) · what is and is not claimed: [CLAIMS.md](CLAIMS.md) · five-minute review: [JUDGES.md](JUDGES.md)

## How it works

```
 user ──signs AP2 IntentMandate (EIP-712, requires_refundability)──▶ payment agent
                                                                       │ A2A SendMessage(task)
 provider agent ◀──────────────────────────────────────────────────────┘
   │ Proviso (HSP merchant of record) creates the HSP order:
   │   pay_to = predictVault(terms)  ← CREATE2(clone(vaultImpl) ‖ abi.encode(terms))
   └─ A2A artifact: ap2.mandates.CartMandate + proviso.terms ─────────▶ payment agent
                                                                       │ verifyCart: ES256K merchant sig, cart hash,
                                                                       │ pay_to == vault(terms), caps, validators,
                                                                       │ settlement reputation  →  refuse, or:
                                                                       │ sign EIP-3009(to = vault) → AP2 PaymentMandate
 HSP gateway ◀── POST /api/v1/payment/pay-mandate ─────────────────────┘
   └─ relayer: USDC.e.transferWithAuthorization(payer → vault)        (HSK Chain)
 desk: factory.open(terms) → Funded → provider signs the quote → delivers (EIP-712, hash on chain)
   → payer accepts (release) │ disputes → 3× ERC-8004 validationRequest → 2 matching responses → resolve
   → factory.settle → ERC-8004 giveFeedback(provider, payer)
```

| Path | What |
|---|---|
| `contracts/` | `DealFactory`, `DealVault` (Foundry). The ERC-8004 registries are vendored unmodified, see `contracts/src/erc8004/README.md` |
| `packages/sdk` | `@proviso/sdk`. HSP gateway client for merchants (HMAC, ES256K cart mandates, orders, webhooks) and for payers (EIP-3009 and Permit2 Payment Mandates). Also AP2 v0.1 types, the intent mandate, `verifyCart`, vault signers and `predictVault` |
| `apps/desk` | Merchant of record, HSP webhook and keeper. The A2A agents: four providers, the payment agent and three validators. REST API, SSE, and MCP over HTTP |
| `packages/mcp` | `@proviso/mcp`: the same tools over stdio |
| `apps/web` | The site |
| `docs/a2a-extension.md` | The A2A extension and its data parts |

## The refusals

The paying agent's `verifyCart` is code, not a prompt. It runs before anything is signed and returns a named reason on failure:

- `NOT_REFUNDABLE`: the cart pays a wallet, not an escrow, and the intent requires refundability.
- `CART_HASH_MISMATCH`: the cart was changed after the merchant signed it.
- `PAYTO_NOT_VAULT`: `pay_to` is not the address derived from the terms.
- `OVER_DEAL_CAP` and `OVER_BUDGET`: the cart is outside the user's signed limits.
- `REPUTATION_TOO_LOW`: the provider's settled-escrow score is below the user's floor.
- `VALIDATOR_NOT_ALLOWED`, `TOKEN_MISMATCH`, `AMOUNT_MISMATCH`, `TERMS_INVALID`, `INTENT_EXPIRED`, `INTENT_SIG_INVALID` and more.

After payment, the vault takes over:

- A missed deadline refunds; anyone can trigger it.
- A dispute refunds unless any two validators agree to pay the provider.
- A token that refuses one recipient (for example a USDC blacklist) does not freeze the others. That share waits in the vault for `claim()`.

## Settlement rails

For every deal, the desk records the transaction that funded the escrow and who sent it. A deal is labelled **HSP gateway** only when
that sender is HSP's relayer `0x1aaA5E4371aAdf96bEfb5bd2Af4d896FD16915Ea`.

When the gateway cannot be used — testnet runs, local forks, or a deal created without gateway credentials — the desk broadcasts the
payer's identical signed authorization itself. Those deals are labelled **self-relayed**.

## Run it

Requirements: Node 22+, pnpm 9, Foundry.

```bash
pnpm install
cd contracts && forge test                         # 73 tests, including the audit regressions
FORK_TESTS=1 forge test --mc "HskForkTest|AuditForkBlacklist"   # real USDC.e / USDT / Permit2 on a fork of HSK Chain mainnet
cd ../packages/sdk && pnpm test                    # 42 tests (one reads the live HSP chain-config)
cd ../../apps/desk && pnpm test
```

End to end on a fork of HSK Chain mainnet, running every scenario with live models:

```bash
anvil --fork-url https://mainnet.hsk.xyz --chain-id 31337 --port 8645 --block-time 2
KEYS=./keys.env RPC=http://127.0.0.1:8645 scripts/fork-env.sh      # deploy, fund agents, register ERC-8004 identities
cd apps/desk && pnpm start                                          # with the env below
DESK=http://127.0.0.1:8788 pnpm exec tsx scripts/e2e.ts             # audit, brief, shady, noshow, tampered, direct
```

| Variable | Meaning |
|---|---|
| `CHAIN_ID`, `RPC_URL`, `DEPLOYMENT_FILE` | Chain and contract addresses (`contracts/deployments/<chain>.json`) |
| `RELAYER_PRIVATE_KEY` | Pays gas for opening vaults and relaying signed actions; also the factory's settler |
| `PAYMENT_AGENT_PRIVATE_KEY`, `USER_DEMO_PRIVATE_KEY` | The paying agent's wallet, and the demo user who signs its intent |
| `AUDITOR_…`, `ANALYST_…`, `LOCALIZER_…`, `SHADY_PRIVATE_KEY` | Provider payout keys; they sign quotes and deliveries |
| `VALIDATOR_0…2_PRIVATE_KEY`, `VALIDATOR_0…2_MODEL` | The dispute panel, and the model each one runs |
| `HSP_MODE` | `gateway` or `self-relay` |
| `HSP_BASE_URL`, `HSP_APP_KEY`, `HSP_APP_SECRET`, `HSP_MERCHANT_KEY_FILE`, `HSP_MERCHANT_PUBKEY_FILE` | Merchant-of-record credentials and ES256K key |
| `VENICE_API_KEY` | Language models for agents and validators (`LLM_STUB=1` for a deterministic stand-in) |
| `PUBLIC_URL`, `PORT`, `DATA_DIR` | Where the desk is reachable, and where it keeps its SQLite database |
| `DELIVERY_SECONDS`, `NOSHOW_SECONDS`, `CHALLENGE_WINDOW`, `COURT_WINDOW` | Demo timings |

## Validator eval

`apps/desk/eval` holds 20 dispute cases, 4 negative controls, and an answer key committed before any validator ran. The cases cover
good work, filler, off-task work, partial work, and prompt injection from either party.

- **Run 1:** the quorum ruled correctly on 19 of 20. One model failed to answer, so that case had no quorum and refunded.
- **Run 2:** after fixing the model client, the quorum ruled correctly on 20 of 20, and each validator was individually right on 20 of 20.
- **Negative controls:** all 4 were decided by the integrity check, with no model involved.

Both runs are kept: `eval/results-run1.json` and `eval/results.json`.

## Audit

Before deployment the contracts went through an adversarial review: 1 High, 2 Medium, 4 Low. Each fixed finding has a regression test
in `contracts/test/audit/`.

- **H-1 (fixed).** Anyone could poison an agent's reputation with zero-capital vaults. Agent ids are now bound to the parties. Unfunded
  vaults write nothing, and a provider is only rated after it signs the quote or delivers.
- **M-1 (fixed).** A blacklisted payee could freeze a vault. Payments are now pushed with a fallback to `claim()`.
- **L-1 to L-3 (fixed).** Evidence spoofing, invalid-token refunds, and unbounded windows.
- **Open by design:** M-2 and L-4, listed under Honest limits below.

## Honest limits

- **Disputes cost the payer little.** There is no dispute bond. If the provider wins, it pays the court fee; if the payer wins, the payer pays it. A payer
  that disputes everything loses nothing in money. What it does lose is payer reputation: every lost dispute is written to ERC-8004 under
  `proviso.payer`. Providers can refuse low-reputation payers, but nothing on chain forces them to.
- **Who calls `resolve()` picks which agreeing validators are counted.** Only those validators are paid the court fee. The desk always
  passes every vote it can see.
- **USDT and Permit2.** A Permit2 signature does not name the recipient. For USDT the escrow guarantee therefore rests on the gateway
  sending to `pay_to`. For USDC.e the recipient is in the payer's own signature.
- **One merchant of record.** Proviso holds the HSP merchant credentials for every hosted provider.
- **Validators.** Collusion by two of the three is out of scope. Each validator answers only the first request per vault.
- **Models.** Agents and validators run on hosted models via Venice. Acceptance checks and verdicts always pass a deterministic floor first:
  format and filler checks, then hash integrity. Above that floor, the judgement is a model's.
- **No upgrades.** After setup the ERC-8004 registries cannot be upgraded by anyone. A bug means a new deployment.

## License

MIT. The ERC-8004 registries in `contracts/src/erc8004/` are from the ERC-8004 reference implementation (MIT).
