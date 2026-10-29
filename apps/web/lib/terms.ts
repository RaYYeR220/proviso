// Mirror of packages/sdk/src/terms.ts so the site deploys on its own; keep the two in sync.
import {
  concat,
  encodeAbiParameters,
  getContractAddress,
  keccak256,
  numberToHex,
  type Address,
  type Hex,
} from "viem";

/** Mirror of the Solidity `Terms` struct. The vault address is derived from its ABI encoding. */
export interface Terms {
  payer: Address;
  provider: Address;
  token: Address;
  amount: bigint;
  deliverBy: bigint;
  challengeWindow: number;
  courtWindow: number;
  feeBps: number;
  courtFeeBps: number;
  validators: readonly [Address, Address, Address];
  providerAgentId: bigint;
  payerAgentId: bigint;
  specHash: Hex;
  intentHash: Hex;
  salt: Hex;
}

export const termsAbiParameter = {
  type: "tuple",
  components: [
    { name: "payer", type: "address" },
    { name: "provider", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deliverBy", type: "uint64" },
    { name: "challengeWindow", type: "uint32" },
    { name: "courtWindow", type: "uint32" },
    { name: "feeBps", type: "uint16" },
    { name: "courtFeeBps", type: "uint16" },
    { name: "validators", type: "address[3]" },
    { name: "providerAgentId", type: "uint256" },
    { name: "payerAgentId", type: "uint256" },
    { name: "specHash", type: "bytes32" },
    { name: "intentHash", type: "bytes32" },
    { name: "salt", type: "bytes32" },
  ],
} as const;

export function encodeTerms(t: Terms): Hex {
  return encodeAbiParameters([termsAbiParameter], [t]);
}

export function hashTerms(t: Terms): Hex {
  return keccak256(encodeTerms(t));
}

/**
 * Init code of an OpenZeppelin `Clones.cloneDeterministicWithImmutableArgs` clone: an EIP-1167 proxy whose
 * runtime code is followed by `args`.
 */
export function cloneInitCode(implementation: Address, args: Hex): Hex {
  const argsLength = (args.length - 2) / 2;
  return concat([
    "0x61",
    numberToHex(argsLength + 0x2d, { size: 2 }),
    "0x3d81600a3d39f3363d3d373d3d3d363d73",
    implementation,
    "0x5af43d82803e903d91602b57fd5bf3",
    args,
  ]);
}

/** The address a deal's money must be sent to (same result as `DealFactory.predict`). */
export function predictVault(input: { dealFactory: Address; vaultImpl: Address; terms: Terms }): Address {
  return getContractAddress({
    opcode: "CREATE2",
    from: input.dealFactory,
    salt: input.terms.salt,
    bytecode: cloneInitCode(input.vaultImpl, encodeTerms(input.terms)),
  });
}

/** JSON-safe form of Terms (bigints as decimal strings), for A2A data parts and evidence files. */
export type TermsJson = Omit<Terms, "amount" | "deliverBy" | "providerAgentId" | "payerAgentId"> & {
  amount: string;
  deliverBy: string;
  providerAgentId: string;
  payerAgentId: string;
};

export function termsToJson(t: Terms): TermsJson {
  return {
    ...t,
    amount: t.amount.toString(),
    deliverBy: t.deliverBy.toString(),
    providerAgentId: t.providerAgentId.toString(),
    payerAgentId: t.payerAgentId.toString(),
  };
}

export function termsFromJson(j: TermsJson): Terms {
  return {
    ...j,
    validators: [j.validators[0], j.validators[1], j.validators[2]],
    amount: BigInt(j.amount),
    deliverBy: BigInt(j.deliverBy),
    providerAgentId: BigInt(j.providerAgentId),
    payerAgentId: BigInt(j.payerAgentId),
  };
}
