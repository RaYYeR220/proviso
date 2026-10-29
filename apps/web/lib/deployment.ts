import type { Address } from "viem";

/** Contract addresses the site derives vault addresses against (keep in sync with contracts/deployments). */
export const DEPLOYMENTS: Record<number, { dealFactory: Address; vaultImpl: Address; identityRegistry: Address; reputationRegistry: Address; validationRegistry: Address; usdc: Address; usdt: Address }> = {
  133: {
    dealFactory: "0x5102481bB8b769231Edc468A6AAe610becCA0292",
    vaultImpl: "0x7B0Dd4D1bB08b15B5D34d2C2C2d9D0F3Af139125",
    identityRegistry: "0x76e212Cf2aF95d17D6CD40C29FD4dAea19D1F5eF",
    reputationRegistry: "0x2C808A951957B1F0D0d066A62370932DFac788B1",
    validationRegistry: "0xAe9E6d4dd97527B01C0410ce822Feb3eA66B4036",
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
