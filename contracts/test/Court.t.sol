// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {DealVault, Status, RefundReason} from "../src/DealVault.sol";
import {Terms} from "../src/Terms.sol";
import {IdentityRegistryUpgradeable} from "../src/erc8004/IdentityRegistryUpgradeable.sol";
import {ValidationRegistryUpgradeable} from "../src/erc8004/ValidationRegistryUpgradeable.sol";

contract CourtTest is Base {
    DealVault v;
    Terms t;

    function setUp() public override {
        super.setUp();
        t = _terms();
        v = _fundAndOpen(t);
        _deliver(v, keccak256("deliverable"));
        _dispute(v, keccak256("reason"));
    }

    function _idx(uint8 a, uint8 b) internal pure returns (uint8[] memory r) {
        r = new uint8[](2);
        r[0] = a;
        r[1] = b;
    }

    function _salts(bytes32 a, bytes32 b) internal pure returns (bytes32[] memory r) {
        r = new bytes32[](2);
        r[0] = a;
        r[1] = b;
    }

    function test_resolve_twoOfThree_release() public {
        _vote(v, 0, "s0", 100, COURT_TAG);
        _vote(v, 2, "s2", 100, COURT_TAG);
        v.resolve(_idx(0, 2), _salts("s0", "s2"));
        assertEq(uint8(v.status()), uint8(Status.Resolved));
        assertEq(v.providerSharePct(), 100);
        uint256 courtFee = AMOUNT * 300 / 10_000;
        uint256 r = AMOUNT - courtFee;
        assertEq(usdc.balanceOf(validators[0]), courtFee / 2);
        assertEq(usdc.balanceOf(validators[2]), courtFee / 2);
        assertEq(usdc.balanceOf(validators[1]), 0);
        assertEq(usdc.balanceOf(feeRecipient), r / 100);
        assertEq(usdc.balanceOf(provider), r - r / 100);
        assertEq(usdc.balanceOf(payer), 0);
        assertEq(usdc.balanceOf(address(v)), 0);
    }

    function test_resolve_twoOfThree_refund() public {
        _vote(v, 0, "s0", 0, COURT_TAG);
        _vote(v, 1, "s1", 0, COURT_TAG);
        v.resolve(_idx(0, 1), _salts("s0", "s1"));
        assertEq(v.providerSharePct(), 0);
        uint256 courtFee = AMOUNT * 300 / 10_000;
        assertEq(usdc.balanceOf(payer), AMOUNT - courtFee);
        assertEq(usdc.balanceOf(provider), 0);
        assertEq(usdc.balanceOf(feeRecipient), 0);
    }

    function test_resolve_partialBucket() public {
        _vote(v, 1, "s1", 25, COURT_TAG);
        _vote(v, 2, "s2", 25, COURT_TAG);
        v.resolve(_idx(1, 2), _salts("s1", "s2"));
        uint256 courtFee = AMOUNT * 300 / 10_000;
        uint256 r = AMOUNT - courtFee;
        uint256 gross = r * 25 / 100;
        assertEq(usdc.balanceOf(provider), gross - gross / 100);
        assertEq(usdc.balanceOf(feeRecipient), gross / 100);
        assertEq(usdc.balanceOf(payer), r - gross);
    }

    function test_resolve_thirdOffline_ok() public {
        _vote(v, 0, "s0", 50, COURT_TAG);
        _vote(v, 1, "s1", 50, COURT_TAG);
        // validator 2 never answers
        v.resolve(_idx(0, 1), _salts("s0", "s1"));
        assertEq(uint8(v.status()), uint8(Status.Resolved));
        assertEq(v.providerSharePct(), 50);
    }

    function test_resolve_allThree_majorityPaidOnly() public {
        _vote(v, 0, "s0", 100, COURT_TAG);
        _vote(v, 1, "s1", 0, COURT_TAG);
        _vote(v, 2, "s2", 100, COURT_TAG);
        uint8[] memory idx = new uint8[](3);
        bytes32[] memory salts = new bytes32[](3);
        (idx[0], idx[1], idx[2]) = (0, 1, 2);
        (salts[0], salts[1], salts[2]) = (bytes32("s0"), bytes32("s1"), bytes32("s2"));
        v.resolve(idx, salts);
        uint256 courtFee = AMOUNT * 300 / 10_000;
        assertEq(usdc.balanceOf(validators[0]), courtFee / 2);
        assertEq(usdc.balanceOf(validators[2]), courtFee / 2);
        assertEq(usdc.balanceOf(validators[1]), 0);
    }

    function test_resolve_splitBuckets_noQuorum() public {
        _vote(v, 0, "s0", 0, COURT_TAG);
        _vote(v, 1, "s1", 100, COURT_TAG);
        vm.expectRevert(DealVault.NoQuorum.selector);
        v.resolve(_idx(0, 1), _salts("s0", "s1"));
    }

    function test_resolve_rejects_foreignVaultVote() public {
        // A second dispute in front of the same panel: votes cast there must not count here.
        Terms memory t2 = _terms();
        t2.salt = keccak256("cart-2");
        DealVault other = _fundAndOpen(t2);
        _deliver(other, keccak256("x"));
        _dispute(other, keccak256("r"));
        _vote(other, 0, "s0", 100, COURT_TAG);
        _vote(other, 1, "s1", 100, COURT_TAG);
        vm.expectRevert(DealVault.NoQuorum.selector);
        v.resolve(_idx(0, 1), _salts("s0", "s1"));
    }

    function test_resolve_rejects_wrongValidator() public {
        // Request for panel slot 1 addressed to a stranger instead of validators[1].
        bytes32 h = factory.requestHash(address(v), 1, "s1");
        address stranger = makeAddr("stranger");
        vm.prank(provider);
        ValidationRegistryUpgradeable(reg.validation).validationRequest(stranger, providerAgentId, "", h);
        vm.prank(stranger);
        ValidationRegistryUpgradeable(reg.validation).validationResponse(h, 100, "", bytes32(0), COURT_TAG);
        _vote(v, 0, "s0", 100, COURT_TAG);
        vm.expectRevert(DealVault.NoQuorum.selector);
        v.resolve(_idx(0, 1), _salts("s0", "s1"));
    }

    function test_resolve_rejects_wrongAgentId() public {
        // The provider registers a second identity and files the request under it.
        vm.prank(provider);
        uint256 otherId = IdentityRegistryUpgradeable(reg.identity).register("x");
        bytes32 h = factory.requestHash(address(v), 1, "s1");
        vm.prank(provider);
        ValidationRegistryUpgradeable(reg.validation).validationRequest(validators[1], otherId, "", h);
        vm.prank(validators[1]);
        ValidationRegistryUpgradeable(reg.validation).validationResponse(h, 100, "", bytes32(0), COURT_TAG);
        _vote(v, 0, "s0", 100, COURT_TAG);
        vm.expectRevert(DealVault.NoQuorum.selector);
        v.resolve(_idx(0, 1), _salts("s0", "s1"));
    }

    function test_resolve_rejects_untaggedResponse() public {
        _vote(v, 0, "s0", 0, COURT_TAG);
        _vote(v, 1, "s1", 0, "other.tag");
        vm.expectRevert(DealVault.NoQuorum.selector);
        v.resolve(_idx(0, 1), _salts("s0", "s1"));
    }

    function test_resolve_rejects_requestWithoutResponse() public {
        // An unanswered request reads as response 0 with an empty tag; it must not count as a 0 vote.
        _vote(v, 0, "s0", 0, COURT_TAG);
        bytes32 h = factory.requestHash(address(v), 1, "s1");
        vm.prank(provider);
        ValidationRegistryUpgradeable(reg.validation).validationRequest(validators[1], providerAgentId, "", h);
        vm.expectRevert(DealVault.NoQuorum.selector);
        v.resolve(_idx(0, 1), _salts("s0", "s1"));
    }

    function test_resolve_rejects_nonBucket() public {
        _vote(v, 0, "s0", 60, COURT_TAG);
        _vote(v, 1, "s1", 60, COURT_TAG);
        vm.expectRevert(DealVault.NoQuorum.selector);
        v.resolve(_idx(0, 1), _salts("s0", "s1"));
    }

    function test_resolve_rejects_staleResponse() public {
        // Votes recorded before this dispute was opened (pre-arranged) must not count.
        Terms memory t2 = _terms();
        t2.salt = keccak256("cart-3");
        address future = factory.predict(t2);
        bytes32 h0 = factory.requestHash(future, 0, "s0");
        bytes32 h1 = factory.requestHash(future, 1, "s1");
        vm.startPrank(provider);
        ValidationRegistryUpgradeable(reg.validation).validationRequest(validators[0], providerAgentId, "", h0);
        ValidationRegistryUpgradeable(reg.validation).validationRequest(validators[1], providerAgentId, "", h1);
        vm.stopPrank();
        vm.prank(validators[0]);
        ValidationRegistryUpgradeable(reg.validation).validationResponse(h0, 100, "", bytes32(0), COURT_TAG);
        vm.prank(validators[1]);
        ValidationRegistryUpgradeable(reg.validation).validationResponse(h1, 100, "", bytes32(0), COURT_TAG);
        vm.warp(block.timestamp + 1);
        DealVault w = _fundAndOpen(t2);
        _deliver(w, keccak256("d"));
        _dispute(w, keccak256("r"));
        vm.expectRevert(DealVault.NoQuorum.selector);
        w.resolve(_idx(0, 1), _salts("s0", "s1"));
    }

    function test_resolve_duplicateIndex_reverts() public {
        _vote(v, 0, "s0", 100, COURT_TAG);
        vm.expectRevert(DealVault.NoQuorum.selector);
        v.resolve(_idx(0, 0), _salts("s0", "s0"));
    }

    function test_resolve_afterCourtWindow_reverts() public {
        _vote(v, 0, "s0", 100, COURT_TAG);
        _vote(v, 1, "s1", 100, COURT_TAG);
        vm.warp(block.timestamp + t.courtWindow + 1);
        vm.expectRevert(DealVault.TooLate.selector);
        v.resolve(_idx(0, 1), _salts("s0", "s1"));
    }

    function test_noQuorum_refundAfterCourtWindow() public {
        vm.expectRevert(DealVault.NotFinal.selector);
        v.finalize();
        vm.warp(block.timestamp + t.courtWindow + 1);
        v.finalize();
        assertEq(uint8(v.status()), uint8(Status.Refunded));
        assertEq(uint8(v.refundReason()), uint8(RefundReason.NoQuorum));
        assertEq(usdc.balanceOf(payer), AMOUNT);
    }

    function testFuzz_conservation_court(uint8 bucketIdx, uint16 feeBps, uint16 courtFeeBps, uint96 extra) public {
        Terms memory t2 = _terms();
        t2.salt = keccak256("fuzz");
        t2.feeBps = uint16(bound(feeBps, 0, 1000));
        t2.courtFeeBps = uint16(bound(courtFeeBps, 0, 1000));
        uint8 bucket = uint8(bound(bucketIdx, 0, 4)) * 25;
        address predicted = factory.predict(t2);
        usdc.mint(predicted, t2.amount + extra);
        DealVault w = DealVault(factory.open(t2));
        _deliver(w, keccak256("d"));
        _dispute(w, keccak256("r"));
        _vote(w, 0, "f0", bucket, COURT_TAG);
        _vote(w, 1, "f1", bucket, COURT_TAG);
        uint256 before = usdc.balanceOf(payer) + usdc.balanceOf(provider) + usdc.balanceOf(feeRecipient)
            + usdc.balanceOf(validators[0]) + usdc.balanceOf(validators[1]) + usdc.balanceOf(validators[2]);
        w.resolve(_idx(0, 1), _salts("f0", "f1"));
        uint256 afterSum = usdc.balanceOf(payer) + usdc.balanceOf(provider) + usdc.balanceOf(feeRecipient)
            + usdc.balanceOf(validators[0]) + usdc.balanceOf(validators[1]) + usdc.balanceOf(validators[2]);
        assertEq(afterSum - before, t2.amount + extra);
        assertEq(usdc.balanceOf(address(w)), 0);
    }
}
