# Claims

Every public statement about Proviso carries one of four evidence tags:

| Tag | Meaning |
|---|---|
| **VERIFIED-LIVE** | You can check it on HSK Chain mainnet or on the running desk right now |
| **REPRODUCIBLE** | A command in this repository reproduces it |
| **MODELED** | It is designed and tested, but has not happened live on mainnet yet |
| **NOT-CLAIMED** | We say explicitly that it is not true or not done |

## Contracts

- **VERIFIED-LIVE.** DealFactory, the DealVault implementation, and the three ERC-8004 registries are deployed on HSK Chain mainnet, and their sources are verified. Links are in [PROOF.md](PROOF.md).
- **VERIFIED-LIVE.** The registries cannot be upgraded: `owner()` returns the zero address on all three proxies.
- **VERIFIED-LIVE.** DealFactory has no owner and no admin functions. Vaults have none either.
- **REPRODUCIBLE.** A vault's address is CREATE2 over a clone whose immutable args are the ABI-encoded terms. `DealFactory.predict` and `@proviso/sdk` `predictVault` agree: `packages/sdk/test/terms.test.ts` checks this against the deployed factory.
- **REPRODUCIBLE.** Money can always leave a vault through its terms: release, refund, ruling, or a claim of a refused payout. 73 Foundry tests cover this, including fuzzed conservation of funds and the audit regressions.
- **REPRODUCIBLE.** USDC.e (EIP-3009) and USDT (Permit2) can each be relayed by the gateway relayer straight to a vault address that does not exist yet. A relayer cannot redirect a USDC.e authorization. See the fork tests in `contracts/test/fork`.
- **REPRODUCIBLE.** A USDC blacklist on one recipient does not freeze the others' settlement: `contracts/test/audit/AuditForkBlacklist.t.sol`.

## Agents and protocol

- **VERIFIED-LIVE.** Eight agents hold ERC-8004 identities on mainnet. Each registered its own identity. Each `agentURI` serves a registration file, and that file links to an A2A v1 AgentCard.
- **VERIFIED-LIVE.** The paying agent refuses before signing anything:
  - a cart altered in transit (`CART_HASH_MISMATCH`);
  - a cart that pays a wallet when the user's intent requires refundability (`NOT_REFUNDABLE`).
  Job records are in [PROOF.md](PROOF.md).
- **REPRODUCIBLE.** These flows run end to end on a fork of HSK Chain mainnet with live models:
  - audit → localize: two releases;
  - market brief: release;
  - filler: dispute, three validator responses, refund;
  - no-show: refund.
  Run `apps/desk/scripts/e2e.ts`; last result was 6 of 6.
- **REPRODUCIBLE.** The HSP gateway wire format matches HashKey's published merchant docs and the official checkout. This covers the HMAC request signing, the ES256K cart mandate with `cart_hash`, the Payment Mandate with an x402 v2 payload, and webhook verification. `packages/sdk/test/hsp.test.ts` tests it. One test reads the live production `chain-config`.
- **REPRODUCIBLE.** Validators: the 2-of-3 quorum ruled correctly on 20 of 20 pre-registered cases, and on 4 of 4 negative controls. The first run scored 19 of 20, and both runs are published. See `apps/desk/eval`.

## Settlement through the HSP gateway

- **MODELED.** Deals settled by HSP's own relayer (`0x1aaA5E43…15Ea`) into Proviso vaults. The merchant-of-record path (`HSP_MODE=gateway`) is implemented and tested against the documented API. It needs HSP merchant credentials, which HashKey issues by invitation, and those were not active when this was written. Until they are, mainnet deals are self-relayed: the desk broadcasts the payer's identical authorization itself. Each deal shows who funded it.
- **NOT-CLAIMED.** That any deal on the site is an HSP gateway settlement unless its funding sender is the HSP relayer address.

## Not claimed

- **NOT-CLAIMED.** An external security audit. The contracts had an internal adversarial review before deployment; [README](README.md#audit) lists its findings.
- **NOT-CLAIMED.** Economic deterrence against frivolous disputes. There is no dispute bond.
- **NOT-CLAIMED.** That the recipient of a USDT payment is enforced by the payer's signature. Permit2 does not sign the recipient.
- **NOT-CLAIMED.** Protection against two colluding validators.
- **NOT-CLAIMED.** Production volume. The live deals are demo deals with cent-sized amounts.
