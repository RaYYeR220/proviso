// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {DealVault, Status, RefundReason} from "../../src/DealVault.sol";
import {DealFactory} from "../../src/DealFactory.sol";
import {Terms} from "../../src/Terms.sol";
import {IdentityRegistryUpgradeable} from "../../src/erc8004/IdentityRegistryUpgradeable.sol";
import {ReputationRegistryUpgradeable} from "../../src/erc8004/ReputationRegistryUpgradeable.sol";

/// Regression tests for the pre-deployment self-audit. Base's `provider`/`providerAgentId` play the victim in the
/// reputation cases.
contract AuditRegression is Base {
    function _summary(uint256 agentId, string memory tag1) internal view returns (uint64 n, int128 v) {
        address[] memory c = new address[](1);
        c[0] = address(factory);
        (n, v,) = ReputationRegistryUpgradeable(reg.reputation).getSummary(agentId, c, tag1, "");
    }

    function _confirm(DealVault v) internal {
        v.confirm(_sign(providerPk, v, keccak256(abi.encode(v.QUOTE_TYPEHASH(), v.termsHash()))));
    }

    /// H-1: naming someone else's agent id in your own deal gets you invalid terms and no feedback at all.
    function test_reputationPoison_otherAgentId_rejected() public {
        DealVault good = _fundAndOpen(_terms());
        _deliver(good, keccak256("d"));
        _accept(good);
        factory.settle(address(good), "", bytes32(0));

        address atk = makeAddr("attacker");
        vm.prank(atk);
        uint256 atkAgent = IdentityRegistryUpgradeable(reg.identity).register("x");
        for (uint256 k; k < 3; k++) {
            Terms memory t = _terms();
            t.payer = atk;
            t.provider = makeAddr("atkProvider");
            t.validators = [makeAddr("a0"), makeAddr("a1"), makeAddr("a2")];
            t.payerAgentId = atkAgent;
            t.providerAgentId = providerAgentId; // the victim's identity
            t.deliverBy = uint64(vm.getBlockTimestamp() + 1);
            t.salt = keccak256(abi.encode("atk", k));
            (bool ok, string memory why) = factory.validate(t);
            assertFalse(ok);
            assertEq(why, "providerAgent");
            DealVault v = DealVault(factory.open(t));
            assertTrue(v.invalidTerms());
            vm.warp(vm.getBlockTimestamp() + 2);
            v.finalize();
            factory.settle(address(v), "ipfs://attacker", keccak256("lie"));
        }
        (uint64 n, int128 val) = _summary(providerAgentId, "proviso.settlement");
        assertEq(n, 1);
        assertEq(val, 100);
    }

    /// H-1: even with the victim's own address as provider, an unfunded vault writes nothing, and a funded one
    /// the victim never acknowledged writes nothing for the provider.
    function test_reputationPoison_victimAddress_needsVictimSignature() public {
        Terms memory t = _terms();
        t.deliverBy = uint64(block.timestamp + 1);
        DealVault unfunded = DealVault(factory.open(t));
        vm.warp(block.timestamp + 2);
        unfunded.finalize();
        assertEq(uint8(unfunded.refundReason()), uint8(RefundReason.NotFunded));
        factory.settle(address(unfunded), "", bytes32(0));

        Terms memory t2 = _terms();
        t2.salt = keccak256("funded-unacknowledged");
        DealVault funded = _fundAndOpen(t2);
        vm.warp(t2.deliverBy + 1);
        funded.finalize();
        factory.settle(address(funded), "", bytes32(0));

        (uint64 n,) = _summary(providerAgentId, "proviso.settlement");
        assertEq(n, 0);
    }

    /// The honest no-show still counts once the provider signed the quote.
    function test_noShow_afterSignedQuote_rated() public {
        Terms memory t = _terms();
        DealVault v = _fundAndOpen(t);
        _confirm(v);
        assertTrue(v.providerCommitted());
        vm.warp(t.deliverBy + 1);
        v.finalize();
        factory.settle(address(v), "", bytes32(0));
        (uint64 n, int128 val) = _summary(providerAgentId, "proviso.settlement");
        assertEq(n, 1);
        assertEq(val, 0);
    }

    function test_confirm_wrongSigner_reverts() public {
        DealVault v = _fundAndOpen(_terms());
        bytes memory sig = _sign(payerPk, v, keccak256(abi.encode(v.QUOTE_TYPEHASH(), v.termsHash())));
        vm.expectRevert(DealVault.BadSignature.selector);
        v.confirm(sig);
    }

    /// L-1: an identity that approves the factory (to veto its own feedback) cannot be quoted.
    function test_factoryApprovedIdentity_rejectedAtQuote() public {
        vm.prank(provider);
        IdentityRegistryUpgradeable(reg.identity).setApprovalForAll(address(factory), true);
        (bool ok, string memory why) = factory.validate(_terms());
        assertFalse(ok);
        assertEq(why, "providerAgent");
    }

    /// L-1 residual: approving the factory after the deal opened makes the provider write fail; it is recorded
    /// as FeedbackFailed on chain rather than silently.
    function test_feedbackVetoAfterOpen_isVisible() public {
        Terms memory t = _terms();
        DealVault v = _fundAndOpen(t);
        _confirm(v);
        vm.warp(t.deliverBy + 1);
        v.finalize();
        vm.prank(provider);
        IdentityRegistryUpgradeable(reg.identity).approve(address(factory), providerAgentId);
        vm.expectEmit(true, false, false, true, address(factory));
        emit DealFactory.FeedbackFailed(address(v), providerAgentId);
        factory.settle(address(v), "", bytes32(0));
    }

    /// L-2: a vault whose terms name a non-token still becomes terminal, and sweep returns what was sent.
    function test_invalidTerms_noCodeToken_recoverable() public {
        Terms memory t = _terms();
        t.token = makeAddr("typoToken");
        address predicted = factory.predict(t);
        usdc.mint(predicted, t.amount);
        DealVault v = DealVault(factory.open(t));
        assertTrue(v.invalidTerms());
        v.finalize();
        assertEq(uint8(v.status()), uint8(Status.Refunded));
        v.sweep(address(usdc));
        assertEq(usdc.balanceOf(payer), t.amount);
    }

    /// L-3: terms that would lock funds for months are invalid at quote time.
    function test_bounds_onHorizonAndWindows() public view {
        Terms memory t = _terms();
        t.deliverBy = uint64(block.timestamp + 91 days);
        (bool ok, string memory why) = factory.validate(t);
        assertFalse(ok);
        assertEq(why, "deliverBy");
        t = _terms();
        t.courtWindow = 31 days;
        (ok, why) = factory.validate(t);
        assertFalse(ok);
        assertEq(why, "windows");
    }

    /// L-4 (accepted limit): the caller of resolve() chooses which agreeing validators are counted, and only
    /// those are paid. Documented in the README; the desk always passes every vote it can see.
    function test_limit_resolveCallerChoosesMajoritySubset() public {
        DealVault v = _fundAndOpen(_terms());
        _deliver(v, keccak256("d"));
        _dispute(v, keccak256("r"));
        _vote(v, 0, "s0", 100, COURT_TAG);
        _vote(v, 1, "s1", 100, COURT_TAG);
        _vote(v, 2, "s2", 100, COURT_TAG);
        uint8[] memory idx = new uint8[](2);
        bytes32[] memory salts = new bytes32[](2);
        (idx[0], idx[1]) = (0, 1);
        (salts[0], salts[1]) = (bytes32("s0"), bytes32("s1"));
        v.resolve(idx, salts);
        assertEq(usdc.balanceOf(validators[2]), 0);
    }

    /// No gas limit lets open() complete with valid terms flagged invalid.
    function test_probe_openGasGrief() public {
        Terms memory t = _terms();
        address predicted = factory.predict(t);
        usdc.mint(predicted, t.amount);
        bytes memory data = abi.encodeCall(DealFactory.open, (t));
        uint256 g0 = _firstOk(address(factory), data, 60_000, 900_000);
        for (uint256 g = g0 - 2_000; g < g0 + 2_000; g += 3) {
            uint256 snap = vm.snapshotState();
            (bool ok,) = address(factory).call{gas: g}(data);
            bool bad = ok && DealVault(predicted).invalidTerms();
            vm.revertToState(snap);
            assertFalse(bad, "open gas grief window exists");
        }
    }

    /// No gas limit lets settle() complete while the provider's feedback write was starved.
    function test_probe_settleGasGrief() public {
        Terms memory t = _terms();
        DealVault v = _fundAndOpen(t);
        _confirm(v);
        vm.warp(t.deliverBy + 1);
        v.finalize();
        bytes memory data = abi.encodeCall(DealFactory.settle, (address(v), "", bytes32(0)));
        uint256 g0 = _firstOk(address(factory), data, 30_000, 3_000_000);
        for (uint256 g = g0 - 2_000; g < g0 + 2_000; g += 3) {
            uint256 snap = vm.snapshotState();
            (bool ok,) = address(factory).call{gas: g}(data);
            bool bad;
            if (ok) {
                (uint64 n,) = _summary(providerAgentId, "proviso.settlement");
                bad = n == 0;
            }
            vm.revertToState(snap);
            assertFalse(bad, "settle gas grief window exists");
        }
    }

    function _firstOk(address target, bytes memory data, uint256 lo, uint256 hi) internal returns (uint256) {
        for (uint256 g = lo; g < hi; g += 1_000) {
            uint256 snap = vm.snapshotState();
            (bool ok,) = target.call{gas: g}(data);
            vm.revertToState(snap);
            if (ok) return g;
        }
        revert("never ok");
    }
}
