# Proof

Every line below links to something you can check yourself. HSK Chain mainnet is chain 177; the explorer is
[hsk.blockscout.com](https://hsk.blockscout.com). Source verification is on Sourcify, with an exact match for every
contract.

## Contracts on HSK Chain mainnet

| Contract | Address |
|---|---|
| DealFactory | [0xE7466dd955329203bcB996bA89Da8882E2cAB263](https://hsk.blockscout.com/address/0xE7466dd955329203bcB996bA89Da8882E2cAB263) |
| DealVault (implementation the clones point to) | [0x0adb3adf35516A60Ea1662908Bd82Af6Ef6D4a12](https://hsk.blockscout.com/address/0x0adb3adf35516A60Ea1662908Bd82Af6Ef6D4a12) |
| ERC-8004 IdentityRegistry (proxy) | [0x2a83321DEaaB8dc74afAA97cA9594f1D1de8b4fe](https://hsk.blockscout.com/address/0x2a83321DEaaB8dc74afAA97cA9594f1D1de8b4fe) |
| ERC-8004 ReputationRegistry (proxy) | [0xb41B55D151bbE430b690cdFbf2a0A9D439b22a54](https://hsk.blockscout.com/address/0xb41B55D151bbE430b690cdFbf2a0A9D439b22a54) |
| ERC-8004 ValidationRegistry (proxy) | [0x6bbfD112b3F8b6FE5b6700FaD0816C7955c7A3cb](https://hsk.blockscout.com/address/0x6bbfD112b3F8b6FE5b6700FaD0816C7955c7A3cb) |

Deployed at block 29473080. All addresses are in `contracts/deployments/177.json` and every transaction is in
`contracts/broadcast/DeployProviso.s.sol/177/run-latest.json`. In the same broadcast:

- **DealFactory creation:** [0xbe56d035…028a](https://hsk.blockscout.com/tx/0xbe56d03510cea3e0e395992ad7c0eea48bfd343e3c0d2950a3c9a67b7040028a)
- **The registries renounced their upgrade keys:**
  [identity](https://hsk.blockscout.com/tx/0xca701fe8649dd97f57a7392bbe6a9b2f91094754615e9a4e56cfa16d22e3bc3b),
  [reputation](https://hsk.blockscout.com/tx/0xd155513354bb3cff74fb886f34f4cbca43b09bfeedb4fafd5b6c1e1a7377560c),
  [validation](https://hsk.blockscout.com/tx/0x71d780f257af5f0d6ecbb158146635fd207232a8671a85f26a2cda2fa4af94be).
  Check that each one now reports no owner:
  `cast call <registry> "owner()(address)" --rpc-url https://mainnet.hsk.xyz` returns `0x0000…0000`.

## Agents registered in ERC-8004 on mainnet

Each agent registered its own identity from its own key. Each provider then approved the Proviso desk as an operator, so the desk
can file dispute requests for it. Every `agentURI` resolves to a live registration file, and each file points to the agent's A2A card.

| Agent | Id | Wallet | Registration tx |
|---|---|---|---|
| Auditor | 0 | 0xE1793c158608d40a27A126330Af9D573d19b1Fe3 | [0x104f375c…](https://hsk.blockscout.com/tx/0x104f375cec735f0261d8d460340ce1333e3a8c42dce846d522d6da1de25f516d) |
| Analyst | 1 | 0x872aF6DE63357ffaa653bC9e24913AEC7cb635eb | [0x66073e08…](https://hsk.blockscout.com/tx/0x66073e08b544feae5ec0694f44f84195c4805299d9dfb0e1618e072769d728ad) |
| Localizer | 2 | 0x5Bc962Fcc8e63dbDe3A6Ebaa8714CedDF44dF289 | [0xe41b4515…](https://hsk.blockscout.com/tx/0xe41b451529077da085482a00b8891c9b983ff3ea1908aff218c15c45d56acc22) |
| Shady (unreliable on purpose) | 3 | 0x61746547653766aFE7cB718935010a42710f193E | [0xfc5484cb…](https://hsk.blockscout.com/tx/0xfc5484cba92ac9028d5cd801797836315553ee64c561047946f615c3480c162c) |
| Payment agent | 4 | 0x9A712cb6353C84A7893b0A5Fd0702663a2032C21 | [0x79469fb8…](https://hsk.blockscout.com/tx/0x79469fb8034c1dfc1ab8287374d65ed859cb38bbae61c2539799d84eee1c4c11) |
| Validator A | 5 | 0x66770264c966fa2dC78c015820dfDc0098ECA1A6 | [0x69cb1ca9…](https://hsk.blockscout.com/tx/0x69cb1ca9adda9ae9b0e309664a01a6920161dce161ba07ecf7009f3b9b72bb4c) |
| Validator B | 6 | 0x7c2135d26C4527EBfD253A84E4c93852a9c60090 | [0x6ae9f144…](https://hsk.blockscout.com/tx/0x6ae9f14497b4fcf3a62dd9b7db33435846e5e20e1e8d6ec6edb1032eee906281) |
| Validator C | 7 | 0x9b601ebD0be1E6D990EDBB788cFa58B20604bE2b | [0xdf0c9a4d…](https://hsk.blockscout.com/tx/0xdf0c9a4d970379bd6f1e20915c49ce183a6a2ba0fd90eb2b2fbdf5f16050e767) |

## Deals on mainnet

The desk at https://34-14-151-28.sslip.io runs against these contracts. Each job's timeline is public at
`/api/jobs/<id>`, and the site renders it at `/jobs/<id>`.

| Scenario | Outcome | Record |
|---|---|---|
| Cart tampered in transit | Refused `CART_HASH_MISMATCH`. Nothing signed; the escrow was never funded. | [job](https://proviso-hsp.vercel.app/jobs/job-3e69c518-3b63-4d9b-a4e1-ef2f9261749c) |
| Merchant asks to be paid directly | Refused `NOT_REFUNDABLE`. Nothing signed. | [job](https://proviso-hsp.vercel.app/jobs/job-0cd6696b-f646-419c-aa93-95c0977d6439) |

A refusal has no transaction, and that is the point. What can be checked is that the vault named in the tampered cart has no code
and no balance on chain.

## The same flows end to end, on a fork of mainnet

`scripts/fork-env.sh` and `apps/desk/scripts/e2e.ts` run every scenario against a fork of HSK Chain mainnet. The fork uses the
real USDC.e (EIP-3009), USDT and Permit2 bytecode and live models. Last run: audit → localize, market brief, filler → 2-of-3 court
→ refund, no-show → refund, tampered → refused, direct → refused. **6 of 6 passed.**

## Tests

| Suite | Count | Command |
|---|---|---|
| Contracts (unit, fuzz, audit regressions) | 73 | `cd contracts && forge test` |
| Contracts on a mainnet fork (USDC.e EIP-3009, USDT Permit2, a USDC blacklist) | 4 | `FORK_TESTS=1 forge test --mc "HskForkTest\|AuditForkBlacklist"` |
| SDK (HSP wire format, JWT, webhooks, every refusal) | 42 | `cd packages/sdk && pnpm test` |
| Desk (webhook forgery and replay, rails, acceptance floor) | 8 | `cd apps/desk && pnpm test` |
| MCP | 1 | `cd packages/mcp && pnpm test` |

## Validator eval

The answer key was committed before any validator ran: commit `84e6ce8`, in `apps/desk/eval/answer-key.json`.

- **Run 1** (`eval/results-run1.json`): the quorum ruled correctly on 19 of 20. One validator's model errored, so that case found no quorum and refunded.
- **Run 2** (`eval/results.json`), after fixing the model client: the quorum ruled correctly on 20 of 20, and each validator individually got 20 of 20.
- **Negative controls:** 4 of 4. Tampered evidence is decided by the integrity check, with no model involved.
- **Prompt injection:** resisted from both sides — case A6 for the provider, R1 for the buyer.
