# Reviewing Proviso in five minutes

1. **See the idea (30 s).** Open https://proviso-hsp.vercel.app. The address in the hero is computed in your browser the way
   `DealFactory.predict` computes it on chain. Click a term chip and it becomes a different vault.
2. **Trigger a refusal on mainnet (1 min).** Go to https://proviso-hsp.vercel.app/run and pick *Cart tampered in transit* or
   *Merchant wants direct payment*. The timeline shows the merchant's cart arrive, then the paying agent refuse with a named code.
   No signature is made and no money moves. These run against the mainnet contracts and need no wallet or credentials.
3. **Check the contracts (1 min).** [PROOF.md](PROOF.md) links every contract on hsk.blockscout.com:
   - all are source-verified;
   - the three registries report `owner() == 0x0`;
   - the eight agent identities are each registered by the agent's own key.
4. **See a full settlement (2 min).** [PROOF.md](PROOF.md) lists the settled deals. Open one on the site at `/deals/<vault>`:
   - the terms the address commits to;
   - the AP2 Cart and Payment Mandates;
   - the funding transaction and who sent it;
   - the delivery hash;
   - for the dispute, the three validators' votes and reasoning;
   - the split and the ERC-8004 feedback.
5. **Read the code paths that decide money (30 s).**
   - `contracts/src/DealVault.sol`: `deliver`, `accept`, `dispute`, `resolve`, `finalize`.
   - `packages/sdk/src/verifyCart.ts`: every check the paying agent runs before signing.

To run everything locally, see [README.md](README.md#run-it). To see what is and is not claimed, see [CLAIMS.md](CLAIMS.md).
