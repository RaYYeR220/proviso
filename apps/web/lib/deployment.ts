import type { Address } from "viem";

/** Contract addresses the site derives vault addresses against (keep in sync with contracts/deployments). */
export const DEPLOYMENTS: Record<number, { dealFactory: Address; vaultImpl: Address; identityRegistry: Address; reputationRegistry: Address; validationRegistry: Address; usdc: Address; usdt: Address }> = {
  133: {
    dealFactory: "0xFEF4cF71286a43c3adcD5b59499160d729895817",
    vaultImpl: "0xac822DD3c348a56fB529F256D04Ef03e6Ab05417",
    identityRegistry: "0x629aca207C1e31BE5438b42f6ac446c66Dd6EdAC",
    reputationRegistry: "0x18961833b052FCFe74805854bB494583D169B881",
    validationRegistry: "0x75d69b137236a287ae7a93e84747ED919210184e",
    usdc: "0x8FE3cB719Ee4410E236Cd6b72ab1fCDC06eF53c6",
    usdt: "0x372325443233fEbaC1F6998aC750276468c83CC6",
  },
};

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 133);
export const DEPLOYMENT = DEPLOYMENTS[CHAIN_ID] ?? DEPLOYMENTS[133]!;

export const AGENTS = {
  paymentAgent: "0x9A712cb6353C84A7893b0A5Fd0702663a2032C21" as Address,
  auditor: "0xE1793c158608d40a27A126330Af9D573d19b1Fe3" as Address,
  analyst: "0x872aF6DE63357ffaa653bC9e24913AEC7cb635eb" as Address,
  localizer: "0x5Bc962Fcc8e63dbDe3A6Ebaa8714CedDF44dF289" as Address,
  validators: [
    "0x66770264c966fa2dC78c015820dfDc0098ECA1A6",
    "0x7c2135d26C4527EBfD253A84E4c93852a9c60090",
    "0x9b601ebD0be1E6D990EDBB788cFa58B20604bE2b",
  ] as const satisfies readonly [Address, Address, Address],
};
