// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {DealVault, RefundReason} from "../src/DealVault.sol";
import {DealFactory} from "../src/DealFactory.sol";
import {Terms} from "../src/Terms.sol";
import {ReputationRegistryUpgradeable} from "../src/erc8004/ReputationRegistryUpgradeable.sol";

contract HubTest is Base {
    function _summary(uint256 agentId, string memory tag1, string memory tag2)
        internal
        view
        returns (uint64 count, int128 value)
    {
        address[] memory clients = new address[](1);
        clients[0] = address(factory);
        (count, value,) = ReputationRegistryUpgradeable(reg.reputation).getSummary(agentId, clients, tag1, tag2);
    }

    function test_settle_released() public {
        DealVault v = _fundAndOpen(_terms());
        _deliver(v, keccak256("d"));
        _accept(v);
        factory.settle(address(v), "https://desk.example/feedback/1.json", keccak256("file"));
        (uint64 n, int128 val) = _summary(providerAgentId, "proviso.settlement", "released");
        assertEq(n, 1);
        assertEq(val, 100);
        (n, val) = _summary(payerAgentId, "proviso.payer", "released");
        assertEq(n, 1);
        assertEq(val, 100);
    }

    function test_settle_once() public {
        DealVault v = _fundAndOpen(_terms());
        _deliver(v, keccak256("d"));
        _accept(v);
        factory.settle(address(v), "", bytes32(0));
        vm.expectRevert(DealFactory.AlreadySettled.selector);
        factory.settle(address(v), "", bytes32(0));
    }

    function test_settle_requiresTerminal() public {
        DealVault v = _fundAndOpen(_terms());
        vm.expectRevert(DealFactory.NotTerminal.selector);
        factory.settle(address(v), "", bytes32(0));
    }

    function test_settle_rejectsForeignVault() public {
        vm.expectRevert(DealFactory.NotVault.selector);
        factory.settle(makeAddr("notavault"), "", bytes32(0));
    }

    function test_settle_noDelivery_values() public {
        Terms memory t = _terms();
        DealVault v = _fundAndOpen(t);
        _confirm(v);
        vm.warp(t.deliverBy + 1);
        v.finalize();
        factory.settle(address(v), "", bytes32(0));
        (uint64 n, int128 val) = _summary(providerAgentId, "proviso.settlement", "refunded-nodelivery");
        assertEq(n, 1);
        assertEq(val, 0);
        (, val) = _summary(payerAgentId, "proviso.payer", "refunded-nodelivery");
        assertEq(val, 100);
    }

    function test_settle_disputeLost_byPayer() public {
        DealVault v = _fundAndOpen(_terms());
        _deliver(v, keccak256("d"));
        _dispute(v, keccak256("r"));
        _vote(v, 0, "s0", 75, COURT_TAG);
        _vote(v, 1, "s1", 75, COURT_TAG);
        uint8[] memory idx = new uint8[](2);
        bytes32[] memory salts = new bytes32[](2);
        (idx[0], idx[1]) = (0, 1);
        (salts[0], salts[1]) = (bytes32("s0"), bytes32("s1"));
        v.resolve(idx, salts);
        factory.settle(address(v), "", bytes32(0));
        (, int128 val) = _summary(providerAgentId, "proviso.settlement", "resolved");
        assertEq(val, 75);
        (, val) = _summary(payerAgentId, "proviso.payer", "resolved");
        assertEq(val, 25);
    }

    function test_settle_invalidTerms_noFeedback() public {
        Terms memory t = _terms();
        t.providerAgentId = 999; // provider identity does not exist
        address predicted = factory.predict(t);
        usdc.mint(predicted, t.amount);
        DealVault v = DealVault(factory.open(t));
        v.finalize();
        factory.settle(address(v), "", bytes32(0)); // must not revert
        (uint64 n,) = _summary(payerAgentId, "proviso.payer", "");
        assertEq(n, 0);
    }

    function _confirm(DealVault v) internal {
        v.confirm(_sign(providerPk, v, keccak256(abi.encode(v.QUOTE_TYPEHASH(), v.termsHash()))));
    }

    function test_settle_noDelivery_unconfirmedProvider_notRated() public {
        Terms memory t = _terms();
        DealVault v = _fundAndOpen(t);
        vm.warp(t.deliverBy + 1);
        v.finalize();
        factory.settle(address(v), "", bytes32(0));
        (uint64 n,) = _summary(providerAgentId, "proviso.settlement", "");
        assertEq(n, 0);
        (n,) = _summary(payerAgentId, "proviso.payer", "");
        assertEq(n, 1);
    }

    function test_settle_neverFunded_skipped() public {
        Terms memory t = _terms();
        DealVault v = DealVault(factory.open(t));
        vm.warp(t.deliverBy + 1);
        v.finalize();
        assertEq(uint8(v.refundReason()), uint8(RefundReason.NotFunded));
        factory.settle(address(v), "", bytes32(0));
        (uint64 n,) = _summary(providerAgentId, "proviso.settlement", "");
        assertEq(n, 0);
        (n,) = _summary(payerAgentId, "proviso.payer", "");
        assertEq(n, 0);
    }

    function test_settle_noQuorum_skipped() public {
        Terms memory t = _terms();
        DealVault v = _fundAndOpen(t);
        _deliver(v, keccak256("d"));
        _dispute(v, keccak256("r"));
        vm.warp(block.timestamp + t.courtWindow + 1);
        v.finalize();
        factory.settle(address(v), "", bytes32(0));
        (uint64 n,) = _summary(providerAgentId, "proviso.settlement", "");
        assertEq(n, 0);
    }

    function test_settle_onlySettlerAttachesEvidence() public {
        DealVault v = _fundAndOpen(_terms());
        _deliver(v, keccak256("d"));
        _accept(v);
        vm.prank(makeAddr("stranger"));
        factory.settle(address(v), "ipfs://lies", keccak256("lies"));
        assertTrue(factory.settled(address(v)));
        (uint64 n, int128 val) = _summary(providerAgentId, "proviso.settlement", "released");
        assertEq(n, 1);
        assertEq(val, 100); // value still comes from the vault; the stranger's URI was dropped
    }

    function test_settle_selfFeedbackBlocked_doesNotRevert() public {
        // If the payer and the provider identities collide with the factory's own rights the registry may
        // reject feedback; settlement bookkeeping must still complete.
        DealVault v = _fundAndOpen(_terms());
        _deliver(v, keccak256("d"));
        _accept(v);
        vm.mockCallRevert(reg.reputation, abi.encodeWithSelector(ReputationRegistryUpgradeable.giveFeedback.selector), "x");
        factory.settle(address(v), "", bytes32(0));
        assertTrue(factory.settled(address(v)));
    }
}
