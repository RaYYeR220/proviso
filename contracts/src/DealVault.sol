// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Terms, TermsLib} from "./Terms.sol";
import {IValidationRegistry} from "./interfaces/IERC8004.sol";

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
    NoDelivery, // funded, provider never delivered
    NoQuorum, // disputed, the panel did not agree in time
    InvalidTerms, // terms the factory rejects; refunded through sweep()
    NotFunded // the terms amount never arrived before the deadline
}

interface IDealFactory {
    function validate(Terms memory t) external view returns (bool ok, string memory reason);
    function feeRecipient() external view returns (address);
    function validation() external view returns (IValidationRegistry);
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
    /// Provider's acknowledgement of these exact terms; without it (or a delivery) no reputation is written for it.
    bytes32 public constant QUOTE_TYPEHASH = keccak256("Quote(bytes32 termsHash)");
    /// @notice Tag a validator must put on its ERC-8004 validation response for it to count as a vote.
    string public constant COURT_TAG = "proviso.court.v1";
    bytes32 private constant COURT_TAG_HASH = keccak256(bytes(COURT_TAG));

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
    bool public providerCommitted;

    /// Payouts a token refused to deliver (e.g. a blacklisted recipient); the recipient claims them later.
    mapping(address recipient => uint256) public owed;
    uint256 public owedTotal;

    event Funded(uint256 balance);
    event Delivered(bytes32 deliveryHash, string uri);
    event Accepted();
    event Committed();
    event Owed(address indexed recipient, uint256 amount);
    event Claimed(address indexed recipient, address to, uint256 amount);
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
    error NoQuorum();
    error NothingOwed();

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

    /// @notice Records the provider's signed acknowledgement of these terms (relayable).
    function confirm(bytes calldata sig) external {
        if (isTerminal()) revert WrongStatus();
        _requireSig(terms().provider, keccak256(abi.encode(QUOTE_TYPEHASH, termsHash())), sig);
        if (!providerCommitted) {
            providerCommitted = true;
            emit Committed();
        }
    }

    function termsHash() public view returns (bytes32) {
        return keccak256(Clones.fetchCloneArgs(address(this)));
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
        providerCommitted = true;
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

    /// @notice Settles a dispute from the ERC-8004 ValidationRegistry. `idx[k]` names a panel member and
    /// `salts[k]` the salt the provider used for that member's request, whose hash is bound to this vault
    /// (`keccak256(abi.encode(vault, i, salt))`). Any two panel members answering the same bucket
    /// (0/25/50/75/100 = provider's share in percent) decide; the court fee goes to the members in that majority.
    function resolve(uint8[] calldata idx, bytes32[] calldata salts) external nonReentrant {
        if (status != Status.Disputed) revert WrongStatus();
        Terms memory t = terms();
        if (block.timestamp > uint256(disputedAt) + t.courtWindow) revert TooLate();
        if (idx.length != salts.length || idx.length < 2 || idx.length > 3) revert NoQuorum();

        (bool[3] memory voted, uint8[3] memory votes) = _collect(t, idx, salts);

        for (uint256 a; a < 3; a++) {
            for (uint256 b = a + 1; b < 3; b++) {
                if (voted[a] && voted[b] && votes[a] == votes[b]) {
                    bool[3] memory majority;
                    for (uint256 c; c < 3; c++) {
                        majority[c] = voted[c] && votes[c] == votes[a];
                    }
                    return _resolve(t, votes[a], majority);
                }
            }
        }
        revert NoQuorum();
    }

    /// @notice Anyone may settle a vault whose clock has run out: silence after delivery releases, no delivery
    /// (or invalid terms) refunds, a dispute without a quorum refunds.
    function finalize() external nonReentrant {
        Terms memory t = terms();
        Status s = status;
        if (s == Status.Open) {
            if (invalidTerms) return _refund(RefundReason.InvalidTerms);
            if (block.timestamp > t.deliverBy) return _refund(RefundReason.NotFunded);
        } else if (s == Status.Funded) {
            if (block.timestamp > t.deliverBy) return _refund(RefundReason.NoDelivery);
        } else if (s == Status.Delivered) {
            if (block.timestamp > uint256(deliveredAt) + t.challengeWindow) return _release(t);
        } else if (s == Status.Disputed) {
            if (block.timestamp > uint256(disputedAt) + t.courtWindow) return _refund(RefundReason.NoQuorum);
        }
        revert NotFinal();
    }

    /// @notice After settlement, anything left here (late transfers, foreign tokens, or the whole balance of a
    /// vault whose terms were invalid) belongs to the payer. Amounts owed to other parties stay claimable.
    function sweep(address token) external nonReentrant {
        if (!isTerminal()) revert WrongStatus();
        Terms memory t = terms();
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 reserved = token == t.token ? owedTotal : 0;
        if (bal > reserved) IERC20(token).safeTransfer(t.payer, bal - reserved);
    }

    /// @notice Withdraws a payout that could not be pushed (the caller's address was refused by the token),
    /// to any address the caller chooses.
    function claim(address to) external nonReentrant {
        uint256 amount = owed[msg.sender];
        if (amount == 0) revert NothingOwed();
        owed[msg.sender] = 0;
        owedTotal -= amount;
        IERC20(terms().token).safeTransfer(to, amount);
        emit Claimed(msg.sender, to, amount);
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
        uint256 due = bal < t.amount ? bal : t.amount;
        uint256 fee = due * t.feeBps / 10_000;
        uint256 toProvider = due - fee;
        uint256 toPayer = bal - due;
        status = Status.Released;
        providerSharePct = 100;
        _pay(token, IDealFactory(factory).feeRecipient(), fee);
        _pay(token, t.provider, toProvider);
        _pay(token, t.payer, toPayer);
        emit Settled(Status.Released, 100, toProvider, toPayer, fee, 0);
    }

    function _refund(RefundReason reason) internal {
        status = Status.Refunded;
        refundReason = reason;
        // Invalid terms may name a token that is not a token; touch nothing and let sweep() return the funds.
        if (reason == RefundReason.InvalidTerms) {
            emit Settled(Status.Refunded, 0, 0, 0, 0, 0);
            return;
        }
        Terms memory t = terms();
        IERC20 token = IERC20(t.token);
        uint256 bal = token.balanceOf(address(this));
        _pay(token, t.payer, bal);
        emit Settled(Status.Refunded, 0, 0, bal, 0, 0);
    }

    function _collect(Terms memory t, uint8[] calldata idx, bytes32[] calldata salts)
        internal
        view
        returns (bool[3] memory voted, uint8[3] memory votes)
    {
        address registry = address(IDealFactory(factory).validation());
        uint256 seen;
        for (uint256 k; k < idx.length; k++) {
            uint8 i = idx[k];
            if (i >= 3 || seen & (1 << i) != 0) revert NoQuorum();
            seen |= 1 << i;
            (voted[i], votes[i]) = _readVote(registry, t, i, salts[k]);
        }
    }

    function _readVote(address registry, Terms memory t, uint8 i, bytes32 salt)
        internal
        view
        returns (bool ok, uint8 bucket)
    {
        bytes32 h = keccak256(abi.encode(address(this), i, salt));
        (bool success, bytes memory ret) =
            registry.staticcall(abi.encodeCall(IValidationRegistry.getValidationStatus, (h)));
        if (!success) return (false, 0); // unknown request
        (address validator, uint256 agentId, uint8 response,, string memory tag, uint256 lastUpdate) =
            abi.decode(ret, (address, uint256, uint8, bytes32, string, uint256));
        ok = validator == t.validators[i] && agentId == t.providerAgentId && lastUpdate >= disputedAt
            && keccak256(bytes(tag)) == COURT_TAG_HASH && response <= 100 && response % 25 == 0;
        bucket = response;
    }

    function _resolve(Terms memory t, uint8 bucket, bool[3] memory majority) internal {
        IERC20 token = IERC20(t.token);
        uint256 bal = token.balanceOf(address(this));
        uint256 due = bal < t.amount ? bal : t.amount;

        uint256 n;
        for (uint256 c; c < 3; c++) {
            if (majority[c]) n++;
        }
        uint256 perValidator = due * t.courtFeeBps / 10_000 / n;
        uint256 courtFee = perValidator * n;
        uint256 remainder = due - courtFee;
        uint256 providerGross = remainder * bucket / 100;
        uint256 fee = providerGross * t.feeBps / 10_000;
        uint256 toProvider = providerGross - fee;
        uint256 toPayer = bal - courtFee - providerGross;

        status = Status.Resolved;
        providerSharePct = bucket;
        for (uint256 c; c < 3; c++) {
            if (majority[c]) _pay(token, t.validators[c], perValidator);
        }
        _pay(token, IDealFactory(factory).feeRecipient(), fee);
        _pay(token, t.provider, toProvider);
        _pay(token, t.payer, toPayer);
        emit Settled(Status.Resolved, bucket, toProvider, toPayer, fee, courtFee);
    }

    /// Push payment that never reverts: a recipient the token refuses is credited and can claim() later, so one
    /// blacklisted party cannot freeze the others' settlement.
    function _pay(IERC20 token, address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, bytes memory ret) = address(token).call(abi.encodeCall(IERC20.transfer, (to, amount)));
        if (ok && (ret.length == 0 || abi.decode(ret, (bool)))) return;
        owed[to] += amount;
        owedTotal += amount;
        emit Owed(to, amount);
    }
}
