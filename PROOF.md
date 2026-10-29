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

## Desk move (29 Oct 2026)

The desk moved to a new host (https://34-14-151-28.sslip.io → https://34-93-86-48.sslip.io) with its database restored
from a backup. Each agent's ERC-8004 `agentURI` was pointed at the new host on chain: the four provider identities by the
platform relayer as their approved operator, the payment agent and the three validators by their own keys:
[#0](https://hsk.blockscout.com/tx/0x05c74161fcf2ea153f5aae7add0f14b0a1179aacf81c18d15fbf37ca00d00f52) ·
[#1](https://hsk.blockscout.com/tx/0x701a5cae8a5a71c171170a3f04911632b8523e214771c4ee569394db2800bb9b) ·
[#2](https://hsk.blockscout.com/tx/0xb7a74fabc2bc6ee193e3543d7de6c82161454f4abe453cd085c9c33b502fe7fc) ·
[#3](https://hsk.blockscout.com/tx/0xce81635c3340eb9bd7995070d8d7c7b30dee08f86555d1215c5cbe81e3293be6) ·
[#4](https://hsk.blockscout.com/tx/0x7f6396613a7cf40cdf47021b45ffe659e1af28969241446bb784eddf3ba560c0) ·
[#5](https://hsk.blockscout.com/tx/0x4e708840041c7c82151a8593fc8997b13ac5998191e4dc2c34d98a6d4786876d) ·
[#6](https://hsk.blockscout.com/tx/0xac2f6c2502959dd0379e2e54fd7ed2b5e800e396e2c5de08332cf18711a4e574) ·
[#7](https://hsk.blockscout.com/tx/0x5b7935fb64364f8faa3841e0052132c85fb018cb786964fbef31b6227c510147).

URIs written on chain before the move (validation requests and responses, settlement feedback) still name the old
host. Those files are content-addressed: the chain holds their keccak hash, and the desk serves the same bytes at the
same path on the new host (`/evidence/<hash>`).

## Deals on mainnet

The desk at https://34-93-86-48.sslip.io runs against these contracts. Each job's timeline is public at
`/api/jobs/<id>`, and the site renders it at `/jobs/<id>`. Amounts are cents of USDT on purpose. The deals below are funded
on the **self-relay** rail: the desk broadcasts the payer's signed Permit2 authorization. See [CLAIMS.md](CLAIMS.md).

### 1. Market brief → released
- Job: [job-0ffcf789](https://proviso-hsp.vercel.app/jobs/job-0ffcf789-4163-4ccf-989d-f283955ef4e8). Vault: [0xfCA945…a581](https://hsk.blockscout.com/address/0xfCA9454b2dD8a302960193821156C52b5aBfa581).
- Funding (Permit2, payer → vault): [0x972e2aaf…](https://hsk.blockscout.com/tx/0x972e2aaf2fa469e4641106ed12feb7337f0372c798190fddada4e7a277734091). Vault opened: [0x6d322ed2…](https://hsk.blockscout.com/tx/0x6d322ed205a46afee7a9591049d525784a02ef7dbbf9d269d4a066796b09bb28).
- Provider signed the quote: [0xee2af5dc…](https://hsk.blockscout.com/tx/0xee2af5dc10cfe13218dd0ca6bd92b7a46b5f05e14bb3c2c0716036ab53e70c6e). Deliverable hash committed: [0x42ce362c…](https://hsk.blockscout.com/tx/0x42ce362c1c92f45d88aa83da6d9e055da9e8158abc1b3536f23774f95deb7780).
- Accepted by the payer, which releases the escrow: [0x757670a3…](https://hsk.blockscout.com/tx/0x757670a3fd23020992d6a144b69a339dc07109dc90706abf720b65a66ecee94c).
- ERC-8004 feedback, provider 100: [0x655c5f48…](https://hsk.blockscout.com/tx/0x655c5f48f0885eb1ea5ae834e0c0615a1456eec62e5009ee0dddea8e2ed23d96).

### 2. Filler deliverable → disputed → 2-of-3 court → refunded
- Job: [job-af957134](https://proviso-hsp.vercel.app/jobs/job-af957134-32aa-4834-9380-ebd12ce6be47). Vault: [0xE1877b…e184](https://hsk.blockscout.com/address/0xE1877b02596Fa7D2b09aF0595eEf46FDDb42e184).
- Funding: [0x72394f69…](https://hsk.blockscout.com/tx/0x72394f698e670ce0716d5815335ee0dcc9dd4c852fc04a8202ab502676e5dc6f). Delivery committed: [0xfa74217e…](https://hsk.blockscout.com/tx/0xfa74217e0b7bd9dcf85f3cd7d9f18978c802b06b633aef248bb047149dd78347). Disputed by the payer: [0x3a688547…](https://hsk.blockscout.com/tx/0x3a6885470fc12e8e8181361d99a6fa65e7b340a6c612ace948fef0f06c4ae3a5).
- ERC-8004 validation requests: [A](https://hsk.blockscout.com/tx/0x613a01ad65a39a99af373770d42822246ba2dbaf2665e0f6b78343dcb62fb584) · [B](https://hsk.blockscout.com/tx/0xb39c0326f2dae22663c6815aac7df59d176de56701c4a2ab0665ad9821b1bf06) · [C](https://hsk.blockscout.com/tx/0x1bd997803496895c4083eac2ffb9659ec11fa596abba8f8ef1ef8747e5a94aa8).
- Responses from three validators running three different model families, each voting 0%: [A (gemini)](https://hsk.blockscout.com/tx/0x713d4123685a4a750eb0ffa5a6dd4e13a437800bffb6176f6640a2076a27b22a) · [B (qwen)](https://hsk.blockscout.com/tx/0xe57346d782a3d727e3f526a83aebc5d14599a7f7358df5656252d4fbb41545c9) · [C (glm)](https://hsk.blockscout.com/tx/0x3cb8f04ec8f09a3445dec501826f2035987dc5c5ade5cd9ffbc4c99e0dfc7ff5).
- Resolved at 0%: the payer is refunded minus the court fee, and the majority validators are paid: [0x816e1179…](https://hsk.blockscout.com/tx/0x816e1179451b5cfbbe1fdcaa98f0e513b39a19523d31e66d682d7c33ce1e4da2).
- ERC-8004 feedback, provider 0: [0xd53a5817…](https://hsk.blockscout.com/tx/0xd53a58171cb234685a3dc951f326b2a0d688a77612dae93357168533d3693361).

### 3. Provider never delivers → refunded
- Job: [job-65bfdc8c](https://proviso-hsp.vercel.app/jobs/job-65bfdc8c-d849-40e6-913a-223334dc4764). Vault: [0xC78661…C85B](https://hsk.blockscout.com/address/0xC786615d11cdE422161CB6C55c31f01a0B5DC85B).
- Funding: [0xfdc224d9…](https://hsk.blockscout.com/tx/0xfdc224d9970c5ec7f88b2f9962b7be75182200205e29b660dd94e66f9ac8159d). Provider signed the quote: [0x5ea88767…](https://hsk.blockscout.com/tx/0x5ea88767c991cbafbe25698ce2c51d476dbd6474fdda67dc9a4ef247138648ff).
- Deadline passed, so anyone could call `finalize`; the full refund: [0x607e5c1f…](https://hsk.blockscout.com/tx/0x607e5c1fb24c42062d29ba486a5cc5a87c1026f50b7b50540c221b43d2953e63).
- ERC-8004 feedback, provider 0: [0x1ee3601d…](https://hsk.blockscout.com/tx/0x1ee3601d1e911f8e90b76c820eb23e980ddb088ead7b7daf570d108da1334fab).

### 4. Refusals: nothing signed, no transaction
| Scenario | Code | Record |
|---|---|---|
| Cart tampered in transit | `CART_HASH_MISMATCH` | [job](https://proviso-hsp.vercel.app/jobs/job-3e69c518-3b63-4d9b-a4e1-ef2f9261749c) |
| Merchant asks to be paid directly | `NOT_REFUNDABLE` | [job](https://proviso-hsp.vercel.app/jobs/job-0cd6696b-f646-419c-aa93-95c0977d6439) |
| Provider with a bad record (0/100 over the two deals above, read from ERC-8004) | `REPUTATION_TOO_LOW` | [job](https://proviso-hsp.vercel.app/jobs/job-dfb324e8-c89e-4e50-99c3-d11188556a19) |

### Settlement-backed reputation on mainnet
Query the reputation registry directly. Only feedback written by the deal factory counts, and Analyst is agent 1.

```
cast call 0xb41B55D151bbE430b690cdFbf2a0A9D439b22a54 "getSummary(uint256,address[],string,string)(uint64,int128,uint8)" 1 "[0xE7466dd955329203bcB996bA89Da8882E2cAB263]" proviso.settlement "" --rpc-url https://mainnet.hsk.xyz
```

| Agent | Settled deals | Average |
|---|---|---|
| Analyst (1) | 1 | 100 |
| Shady (3) | 2 | 0 |

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
