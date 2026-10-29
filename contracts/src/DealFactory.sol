// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Terms, TermsLib} from "./Terms.sol";
import {DealVault, Status, RefundReason} from "./DealVault.sol";
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
    uint32 public constant MAX_WINDOW = 30 days;
    uint64 public constant MAX_HORIZON = 90 days;
    /// Gas forwarded to each ERC-8004 feedback write; settle() refuses to run with less, so a caller cannot
    /// starve the write into the catch branch and erase an outcome.
    uint256 public constant FEEDBACK_GAS = 500_000;

    address public immutable vaultImpl;
    address public immutable feeRecipient;
    IIdentityRegistry public immutable identity;
    IReputationRegistry public immutable reputation;
    IValidationRegistry public immutable validation;
    address public immutable usdc;
    address public immutable usdt;
    /// The only caller whose evidence URI is attached to reputation feedback; values never come from a caller.
    address public immutable settler;

    mapping(address vault => bool) public isVault;
    mapping(address vault => bool) public settled;

    event DealOpened(
        address indexed vault,
        address indexed payer,
        address indexed provider,
        address token,
        uint256 amount,
        bytes32 specHash,
        bytes32 salt
    );

    event ReputationWritten(
        address indexed vault, uint256 providerAgentId, uint256 payerAgentId, int128 providerValue, int128 payerValue
    );

    error NotVault();
    error NotTerminal();
    error AlreadySettled();
    error ZeroAddress();
    error InsufficientGas();

    event ReputationSkipped(address indexed vault, RefundReason reason);
    event FeedbackFailed(address indexed vault, uint256 agentId);

    constructor(
        address feeRecipient_,
        address identity_,
        address reputation_,
        address validation_,
        address usdc_,
        address usdt_,
        address settler_
    ) {
        if (
            feeRecipient_ == address(0) || identity_ == address(0) || reputation_ == address(0)
                || validation_ == address(0) || usdc_ == address(0) || usdt_ == address(0) || settler_ == address(0)
        ) revert ZeroAddress();
        vaultImpl = address(new DealVault());
        feeRecipient = feeRecipient_;
        identity = IIdentityRegistry(identity_);
        reputation = IReputationRegistry(reputation_);
        validation = IValidationRegistry(validation_);
        usdc = usdc_;
        usdt = usdt_;
        settler = settler_;
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
        if (
            t.challengeWindow < MIN_WINDOW || t.courtWindow < MIN_WINDOW || t.challengeWindow > MAX_WINDOW
                || t.courtWindow > MAX_WINDOW
        ) return (false, "windows");
        if (t.deliverBy <= block.timestamp || t.deliverBy > block.timestamp + MAX_HORIZON) return (false, "deliverBy");
        if (!_agentOf(t.providerAgentId, t.provider)) return (false, "providerAgent");
        if (!_agentOf(t.payerAgentId, t.payer)) return (false, "payerAgent");
        return (true, "");
    }

    /// @notice Writes settlement-backed reputation for a finished vault, once. The values come from the vault's
    /// on-chain outcome, never from the caller; the caller only supplies the evidence file (A2A task, AP2 mandate
    /// hashes, the HSP funding tx) that `feedbackURI` points to. Readers filter `getSummary` by this factory as
    /// the client to get reputation earned only through settled escrow.
    function settle(address vault, string calldata feedbackURI, bytes32 feedbackHash) external {
        if (!isVault[vault]) revert NotVault();
        if (settled[vault]) revert AlreadySettled();
        DealVault v = DealVault(vault);
        if (!v.isTerminal()) revert NotTerminal();
        settled[vault] = true;

        // Reputation is only written for deals that were actually funded, and never for a court that failed to
        // rule (that says nothing about either party). Invalid terms may name identities that are not the parties.
        RefundReason why = v.refundReason();
        if (why == RefundReason.InvalidTerms || why == RefundReason.NotFunded || why == RefundReason.NoQuorum) {
            emit ReputationSkipped(vault, why);
            return;
        }

        Status s = v.status();
        int128 providerValue = int128(uint128(v.providerSharePct()));
        int128 payerValue = 100;
        string memory outcome = "refunded-nodelivery";
        if (s == Status.Released) {
            outcome = "released";
        } else if (s == Status.Resolved) {
            outcome = "resolved";
            payerValue = 100 - providerValue;
        }

        (string memory uri, bytes32 hash_) = msg.sender == settler ? (feedbackURI, feedbackHash) : ("", bytes32(0));
        Terms memory t = v.terms();
        // A provider that never acknowledged these terms (no signed quote, no delivery) is not rated by them.
        if (v.providerCommitted()) {
            _feedback(vault, t.providerAgentId, providerValue, "proviso.settlement", outcome, uri, hash_);
        }
        _feedback(vault, t.payerAgentId, payerValue, "proviso.payer", outcome, uri, hash_);
        emit ReputationWritten(vault, t.providerAgentId, t.payerAgentId, providerValue, payerValue);
    }

    function _feedback(
        address vault,
        uint256 agentId,
        int128 value,
        string memory tag1,
        string memory tag2,
        string memory uri,
        bytes32 hash_
    ) private {
        if (gasleft() < FEEDBACK_GAS + 30_000) revert InsufficientGas();
        try reputation.giveFeedback{gas: FEEDBACK_GAS}(agentId, value, 0, tag1, tag2, "", uri, hash_) {}
        catch {
            emit FeedbackFailed(vault, agentId);
        }
    }

    /// @notice The ERC-8004 validation request hash a provider must use for panel member `i` of `vault`.
    function requestHash(address vault, uint8 i, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(vault, i, salt));
    }

    /// The identity must belong to the party (owner or its registered agent wallet), and must not have approved
    /// this factory, which would let it veto its own feedback.
    function _agentOf(uint256 agentId, address party) private view returns (bool) {
        address owner;
        try identity.ownerOf(agentId) returns (address o) {
            owner = o;
        } catch {
            return false;
        }
        if (owner == address(0)) return false;
        bool bound = owner == party;
        if (!bound) {
            try identity.getAgentWallet(agentId) returns (address w) {
                bound = w == party;
            } catch {}
        }
        if (!bound) return false;
        try identity.isApprovedForAll(owner, address(this)) returns (bool all) {
            if (all) return false;
        } catch {
            return false;
        }
        try identity.getApproved(agentId) returns (address one) {
            if (one == address(this)) return false;
        } catch {
            return false;
        }
        return true;
    }
}
