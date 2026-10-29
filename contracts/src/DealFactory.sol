// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Terms, TermsLib} from "./Terms.sol";
import {DealVault} from "./DealVault.sol";
import {IIdentityRegistry, IReputationRegistry, IValidationRegistry} from "./interfaces/IERC8004.sol";

/// @title DealFactory
/// @notice Predicts and deploys deal vaults. The predicted address of a vault is what a merchant puts in the
/// HSP Cart Mandate as `pay_to`; because the terms are the clone's immutable args, that address commits to the
/// whole deal. Everything here is immutable: no owner, no allowlist edits, no implementation swaps — a value
/// that could change would break the address a payer already signed to.
contract DealFactory {
    uint16 public constant MAX_FEE_BPS = 1_000;
    uint16 public constant MAX_COURT_FEE_BPS = 1_000;
    uint32 public constant MIN_WINDOW = 60;

    address public immutable vaultImpl;
    address public immutable feeRecipient;
    IIdentityRegistry public immutable identity;
    IReputationRegistry public immutable reputation;
    IValidationRegistry public immutable validation;
    address public immutable usdc;
    address public immutable usdt;

    mapping(address vault => bool) public isVault;

    event DealOpened(
        address indexed vault,
        address indexed payer,
        address indexed provider,
        address token,
        uint256 amount,
        bytes32 specHash,
        bytes32 salt
    );

    constructor(
        address feeRecipient_,
        address identity_,
        address reputation_,
        address validation_,
        address usdc_,
        address usdt_
    ) {
        vaultImpl = address(new DealVault());
        feeRecipient = feeRecipient_;
        identity = IIdentityRegistry(identity_);
        reputation = IReputationRegistry(reputation_);
        validation = IValidationRegistry(validation_);
        usdc = usdc_;
        usdt = usdt_;
    }

    /// @notice The address a deal's money must be sent to.
    function predict(Terms memory t) public view returns (address) {
        return Clones.predictDeterministicAddressWithImmutableArgs(vaultImpl, TermsLib.encode(t), t.salt);
    }

    /// @notice Deploys the vault for `t` (idempotent). Anyone may call it; it never reverts for decodable terms.
    function open(Terms memory t) external returns (address vault) {
        vault = predict(t);
        if (vault.code.length > 0) return vault;
        Clones.cloneDeterministicWithImmutableArgs(vaultImpl, TermsLib.encode(t), t.salt);
        isVault[vault] = true;
        emit DealOpened(vault, t.payer, t.provider, t.token, t.amount, t.specHash, t.salt);
        DealVault(vault).init();
    }

    /// @notice Quote-time check a merchant and a paying agent both run before any money moves.
    function validate(Terms memory t) public view returns (bool ok, string memory reason) {
        if (t.token != usdc && t.token != usdt) return (false, "token");
        if (t.amount == 0) return (false, "amount");
        if (t.payer == address(0) || t.provider == address(0) || t.payer == t.provider) return (false, "parties");
        for (uint256 i; i < 3; i++) {
            address v = t.validators[i];
            if (v == address(0) || v == t.payer || v == t.provider) return (false, "validators");
            for (uint256 j = i + 1; j < 3; j++) {
                if (v == t.validators[j]) return (false, "validators");
            }
        }
        if (t.feeBps > MAX_FEE_BPS || t.courtFeeBps > MAX_COURT_FEE_BPS) return (false, "fees");
        if (t.challengeWindow < MIN_WINDOW || t.courtWindow < MIN_WINDOW) return (false, "windows");
        if (t.deliverBy <= block.timestamp) return (false, "deliverBy");
        if (!_agentExists(t.providerAgentId)) return (false, "providerAgent");
        if (!_agentExists(t.payerAgentId)) return (false, "payerAgent");
        return (true, "");
    }

    /// @notice The ERC-8004 validation request hash a provider must use for panel member `i` of `vault`.
    function requestHash(address vault, uint8 i, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(vault, i, salt));
    }

    function _agentExists(uint256 agentId) private view returns (bool) {
        try identity.ownerOf(agentId) returns (address owner) {
            return owner != address(0);
        } catch {
            return false;
        }
    }
}
