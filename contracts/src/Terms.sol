// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The full economic agreement of one deal. A vault's address is derived from the ABI encoding of
/// these terms (they are the clone's immutable args), so the address itself commits to every field.
struct Terms {
    address payer; // paying agent wallet: EIP-3009 `from`, refund recipient
    address provider; // provider payout address
    address token; // settlement token (allowlisted by the factory)
    uint256 amount; // base units the vault must hold to count as funded
    uint64 deliverBy; // unix seconds; no delivery by then => refundable
    uint32 challengeWindow; // seconds after delivery for the payer to accept or dispute
    uint32 courtWindow; // seconds after a dispute for the validator quorum to rule
    uint16 feeBps; // platform fee on the provider's share
    uint16 courtFeeBps; // paid on dispute to validators in the majority
    address[3] validators; // dispute panel (ERC-8004 validator agents)
    uint256 providerAgentId; // ERC-8004 identity of the provider
    uint256 payerAgentId; // ERC-8004 identity of the payer
    bytes32 specHash; // hash of the task spec the provider quoted
    bytes32 intentHash; // EIP-712 hash of the user's intent mandate
    bytes32 salt; // uniqueness, derived from the HSP cart mandate id
}

library TermsLib {
    function encode(Terms memory t) internal pure returns (bytes memory) {
        return abi.encode(t);
    }

    function decode(bytes memory data) internal pure returns (Terms memory) {
        return abi.decode(data, (Terms));
    }

    function hash(Terms memory t) internal pure returns (bytes32) {
        return keccak256(abi.encode(t));
    }
}
