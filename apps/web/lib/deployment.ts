import type { Address } from "viem";

/** Contract addresses the site derives vault addresses against (keep in sync with contracts/deployments). */
export const DEPLOYMENTS: Record<number, { dealFactory: Address; vaultImpl: Address; identityRegistry: Address; reputationRegistry: Address; validationRegistry: Address; usdc: Address; usdt: Address }> = {
  177: {
    dealFactory: "0xE7466dd955329203bcB996bA89Da8882E2cAB263",
    vaultImpl: "0x0adb3adf35516A60Ea1662908Bd82Af6Ef6D4a12",
    identityRegistry: "0x2a83321DEaaB8dc74afAA97cA9594f1D1de8b4fe",
    reputationRegistry: "0xb41B55D151bbE430b690cdFbf2a0A9D439b22a54",
    validationRegistry: "0x6bbfD112b3F8b6FE5b6700FaD0816C7955c7A3cb",
    usdc: "0x054ed45810DbBAb8B27668922D110669c9D88D0a",
    usdt: "0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029",
  },
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

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 177);
export const DEPLOYMENT = DEPLOYMENTS[CHAIN_ID] ?? DEPLOYMENTS[177]!;

/** ERC-8004 agent ids of the hosted agents on each chain. */
export const AGENT_IDS: Record<number, { auditor: bigint; analyst: bigint; localizer: bigint; paymentAgent: bigint }> = {
  177: { auditor: 0n, analyst: 1n, localizer: 2n, paymentAgent: 4n },
  133: { auditor: 1n, analyst: 2n, localizer: 3n, paymentAgent: 5n },
};

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
