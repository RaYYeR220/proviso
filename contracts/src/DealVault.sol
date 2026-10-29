// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Terms, TermsLib} from "./Terms.sol";

enum Status {
    Open, // deployed, waiting for the terms amount to be present
    Funded, // balance >= amount, waiting for delivery
    Delivered, // provider committed a deliverable, challenge window running
    Disputed, // payer disputed, court window running
    Released, // provider paid in full (accepted or challenge window elapsed)
    Refunded, // payer refunded in full
    Resolved // court split the escrow
}

enum RefundReason {
    None,
    NoDelivery,
    NoQuorum,
    InvalidTerms
}

interface IDealFactory {
    function validate(Terms memory t) external view returns (bool ok, string memory reason);
    function feeRecipient() external view returns (address);
}

/// @title DealVault
/// @notice Escrow for one agent-to-agent deal. Each vault is a minimal clone whose immutable args are the ABI
/// encoding of its Terms, so its address is a commitment to the whole agreement. Funds arrive by a plain token
/// transfer (in production: the HSP gateway relaying the payer's EIP-3009 authorization to this address),
/// possibly before the clone is deployed. There is no admin: every exit is defined by the terms.
contract DealVault is EIP712, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    bytes32 public constant DELIVERY_TYPEHASH = keccak256("Delivery(bytes32 deliveryHash,string uri)");
    bytes32 public constant ACCEPT_TYPEHASH = keccak256("Accept(bytes32 deliveryHash)");
    bytes32 public constant DISPUTE_TYPEHASH = keccak256("Dispute(bytes32 deliveryHash,bytes32 reasonHash)");

    address public immutable factory;

    bool public initialized;
    bool public invalidTerms;
    Status public status;
    RefundReason public refundReason;
    uint8 public providerSharePct;
    uint64 public fundedAt;
    uint64 public deliveredAt;
    uint64 public disputedAt;
    bytes32 public deliveryHash;
    bytes32 public reasonHash;

    event Funded(uint256 balance);
    event Delivered(bytes32 deliveryHash, string uri);
    event Accepted();
    event Disputed(bytes32 reasonHash);
    event Settled(
        Status outcome, uint8 providerSharePct, uint256 toProvider, uint256 toPayer, uint256 fee, uint256 courtFee
    );

    error OnlyFactory();
    error WrongStatus();
    error TooLate();
    error NotFinal();
    error BadSignature();
    error EmptyHash();

    constructor() EIP712("Proviso", "1") {
        factory = msg.sender;
    }

    // ---------------------------------------------------------------- views

    function terms() public view returns (Terms memory) {
        return TermsLib.decode(Clones.fetchCloneArgs(address(this)));
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function isTerminal() public view returns (bool) {
        return status == Status.Released || status == Status.Refunded || status == Status.Resolved;
    }

    // ---------------------------------------------------------------- lifecycle

    /// @notice Called once by the factory right after deployment. Never reverts for decodable terms: terms the
    /// factory would reject are flagged and become refundable, so money already sent here can always leave.
    function init() external {
        if (msg.sender != factory || initialized) revert OnlyFactory();
        initialized = true;
        (bool ok,) = IDealFactory(factory).validate(_withLiveDeadline(terms()));
        if (!ok) {
            invalidTerms = true;
            return;
        }
        _tryFund(terms());
    }

    /// @notice Moves an Open vault to Funded once the terms amount is present (before the delivery deadline).
    function markFunded() external {
        if (status != Status.Open) revert WrongStatus();
        _tryFund(terms());
    }

    function deliver(bytes32 deliveryHash_, string calldata uri, bytes calldata sig) external {
        Terms memory t = terms();
        if (status == Status.Open) _tryFund(t);
        if (status != Status.Funded) revert WrongStatus();
        if (block.timestamp > t.deliverBy) revert TooLate();
        if (deliveryHash_ == bytes32(0)) revert EmptyHash();
        _requireSig(
            t.provider, keccak256(abi.encode(DELIVERY_TYPEHASH, deliveryHash_, keccak256(bytes(uri)))), sig
        );
        status = Status.Delivered;
        deliveredAt = uint64(block.timestamp);
        deliveryHash = deliveryHash_;
        emit Delivered(deliveryHash_, uri);
    }

    function accept(bytes calldata sig) external nonReentrant {
        if (status != Status.Delivered) revert WrongStatus();
        Terms memory t = terms();
        _requireSig(t.payer, keccak256(abi.encode(ACCEPT_TYPEHASH, deliveryHash)), sig);
        emit Accepted();
        _release(t);
    }

    function dispute(bytes32 reasonHash_, bytes calldata sig) external {
        if (status != Status.Delivered) revert WrongStatus();
        Terms memory t = terms();
        if (block.timestamp > uint256(deliveredAt) + t.challengeWindow) revert TooLate();
        _requireSig(t.payer, keccak256(abi.encode(DISPUTE_TYPEHASH, deliveryHash, reasonHash_)), sig);
        status = Status.Disputed;
        disputedAt = uint64(block.timestamp);
        reasonHash = reasonHash_;
        emit Disputed(reasonHash_);
    }

    /// @notice Anyone may settle a vault whose clock has run out: silence after delivery releases, no delivery
    /// (or invalid terms) refunds, a dispute without a quorum refunds.
    function finalize() external nonReentrant {
        Terms memory t = terms();
        Status s = status;
        if (s == Status.Open) {
            if (invalidTerms) return _refund(RefundReason.InvalidTerms);
            if (block.timestamp > t.deliverBy) return _refund(RefundReason.NoDelivery);
        } else if (s == Status.Funded) {
            if (block.timestamp > t.deliverBy) return _refund(RefundReason.NoDelivery);
        } else if (s == Status.Delivered) {
            if (block.timestamp > uint256(deliveredAt) + t.challengeWindow) return _release(t);
        } else if (s == Status.Disputed) {
            if (block.timestamp > uint256(disputedAt) + t.courtWindow) return _refund(RefundReason.NoQuorum);
        }
        revert NotFinal();
    }

    /// @notice After settlement, anything left here (late transfers, foreign tokens) belongs to the payer.
    function sweep(address token) external nonReentrant {
        if (!isTerminal()) revert WrongStatus();
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) IERC20(token).safeTransfer(terms().payer, bal);
    }

    // ---------------------------------------------------------------- internals

    function _tryFund(Terms memory t) internal {
        if (invalidTerms || block.timestamp > t.deliverBy) return;
        uint256 bal = IERC20(t.token).balanceOf(address(this));
        if (bal < t.amount) return;
        status = Status.Funded;
        fundedAt = uint64(block.timestamp);
        emit Funded(bal);
    }

    /// The deadline is judged by the vault's lifecycle, not by the factory's quote-time check, so a relay that
    /// lands late still opens (and then refunds) instead of being marked invalid. Mutates its argument: callers
    /// pass a fresh decode.
    function _withLiveDeadline(Terms memory t) private view returns (Terms memory) {
        if (t.deliverBy <= block.timestamp) t.deliverBy = uint64(block.timestamp + 1);
        return t;
    }

    function _requireSig(address signer, bytes32 structHash, bytes calldata sig) internal view {
        if (sig.length == 0) {
            if (msg.sender != signer) revert BadSignature();
            return;
        }
        if (!SignatureChecker.isValidSignatureNow(signer, _hashTypedDataV4(structHash), sig)) revert BadSignature();
    }

    function _release(Terms memory t) internal {
        IERC20 token = IERC20(t.token);
        uint256 bal = token.balanceOf(address(this));
        uint256 owed = bal < t.amount ? bal : t.amount;
        uint256 fee = owed * t.feeBps / 10_000;
        uint256 toProvider = owed - fee;
        uint256 toPayer = bal - owed;
        status = Status.Released;
        providerSharePct = 100;
        _pay(token, IDealFactory(factory).feeRecipient(), fee);
        _pay(token, t.provider, toProvider);
        _pay(token, t.payer, toPayer);
        emit Settled(Status.Released, 100, toProvider, toPayer, fee, 0);
    }

    function _refund(RefundReason reason) internal {
        Terms memory t = terms();
        IERC20 token = IERC20(t.token);
        uint256 bal = token.balanceOf(address(this));
        status = Status.Refunded;
        refundReason = reason;
        _pay(token, t.payer, bal);
        emit Settled(Status.Refunded, 0, 0, bal, 0, 0);
    }

    function _pay(IERC20 token, address to, uint256 amount) internal {
        if (amount > 0) token.safeTransfer(to, amount);
    }
}
