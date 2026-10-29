// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {DealVault, Status, RefundReason} from "../src/DealVault.sol";
import {Terms} from "../src/Terms.sol";
import {MockToken} from "./mocks/MockToken.sol";

contract VaultTest is Base {
    function test_predict_matchesOpen() public {
        Terms memory t = _terms();
        address predicted = factory.predict(t);
        assertEq(predicted.code.length, 0);
        assertEq(factory.open(t), predicted);
        assertGt(predicted.code.length, 0);
        assertTrue(factory.isVault(predicted));
    }

    function test_terms_liveInBytecode() public {
        Terms memory t = _terms();
        DealVault v = DealVault(factory.open(t));
        Terms memory r = v.terms();
        assertEq(r.payer, t.payer);
        assertEq(r.amount, t.amount);
        assertEq(r.salt, t.salt);
        assertEq(r.validators[2], t.validators[2]);
    }

    function test_open_idempotent() public {
        Terms memory t = _terms();
        address a = factory.open(t);
        address b = factory.open(t);
        assertEq(a, b);
    }

    function test_open_fundedInInit() public {
        DealVault v = _fundAndOpen(_terms());
        assertEq(uint8(v.status()), uint8(Status.Funded));
    }

    function test_open_beforeFunding_thenMarkFunded() public {
        Terms memory t = _terms();
        DealVault v = DealVault(factory.open(t));
        assertEq(uint8(v.status()), uint8(Status.Open));
        usdc.mint(address(v), t.amount);
        v.markFunded();
        assertEq(uint8(v.status()), uint8(Status.Funded));
    }

    function test_open_lateRelay_routesToRefund() public {
        Terms memory t = _terms();
        address predicted = factory.predict(t);
        usdc.mint(predicted, t.amount);
        vm.warp(t.deliverBy + 1); // the relay landed after the delivery deadline
        DealVault v = DealVault(factory.open(t)); // must not revert
        assertEq(uint8(v.status()), uint8(Status.Open));
        v.finalize();
        assertEq(uint8(v.status()), uint8(Status.Refunded));
        assertEq(uint8(v.refundReason()), uint8(RefundReason.NotFunded));
        assertEq(usdc.balanceOf(payer), t.amount);
    }

    function test_invalidTerms_openNeverReverts_refunds() public {
        Terms memory t = _terms();
        t.token = address(new MockToken("JUNK")); // not allowlisted
        address predicted = factory.predict(t);
        MockToken(t.token).mint(predicted, t.amount);
        DealVault v = DealVault(factory.open(t));
        assertTrue(v.invalidTerms());
        v.finalize();
        assertEq(uint8(v.status()), uint8(Status.Refunded));
        assertEq(uint8(v.refundReason()), uint8(RefundReason.InvalidTerms));
        v.sweep(t.token); // invalid terms touch no token on refund; the payer sweeps it back
        assertEq(MockToken(t.token).balanceOf(payer), t.amount);
    }

    function test_underfunded_neverDeliverable_refundAfterDeadline() public {
        Terms memory t = _terms();
        address predicted = factory.predict(t);
        usdc.mint(predicted, t.amount - 1);
        DealVault v = DealVault(factory.open(t));
        assertEq(uint8(v.status()), uint8(Status.Open));
        string memory uri = "u";
        bytes32 dh = bytes32(uint256(1));
        bytes memory sig = _sign(providerPk, v, keccak256(abi.encode(DELIVERY_TYPEHASH, dh, keccak256(bytes(uri)))));
        vm.expectRevert(DealVault.WrongStatus.selector);
        v.deliver(dh, uri, sig);
        vm.expectRevert(DealVault.NotFinal.selector);
        v.finalize();
        vm.warp(t.deliverBy + 1);
        v.finalize();
        assertEq(usdc.balanceOf(payer), t.amount - 1);
    }

    function test_deliver_requiresProviderSig() public {
        DealVault v = _fundAndOpen(_terms());
        string memory uri = "u";
        bytes32 dh = keccak256("deliverable");
        bytes memory bad = _sign(payerPk, v, keccak256(abi.encode(DELIVERY_TYPEHASH, dh, keccak256(bytes(uri)))));
        vm.expectRevert(DealVault.BadSignature.selector);
        v.deliver(dh, uri, bad);
    }

    function test_deliver_relayedBySig() public {
        DealVault v = _fundAndOpen(_terms());
        vm.prank(makeAddr("relayer"));
        _deliver(v, keccak256("deliverable"));
        assertEq(uint8(v.status()), uint8(Status.Delivered));
        assertEq(v.deliveryHash(), keccak256("deliverable"));
    }

    function test_deliver_directBySender() public {
        DealVault v = _fundAndOpen(_terms());
        vm.prank(provider);
        v.deliver(keccak256("d"), "u", "");
        assertEq(uint8(v.status()), uint8(Status.Delivered));
    }

    function test_deliver_fundsArrivedButNotMarked_autoMarks() public {
        Terms memory t = _terms();
        DealVault v = DealVault(factory.open(t));
        usdc.mint(address(v), t.amount);
        vm.prank(provider);
        v.deliver(keccak256("d"), "u", "");
        assertEq(uint8(v.status()), uint8(Status.Delivered));
    }

    function test_deliver_afterDeadline_reverts() public {
        Terms memory t = _terms();
        DealVault v = _fundAndOpen(t);
        vm.warp(t.deliverBy + 1);
        vm.prank(provider);
        vm.expectRevert(DealVault.TooLate.selector);
        v.deliver(keccak256("d"), "u", "");
    }

    function test_accept_releases_withFee() public {
        DealVault v = _fundAndOpen(_terms());
        _deliver(v, keccak256("d"));
        _accept(v);
        assertEq(uint8(v.status()), uint8(Status.Released));
        assertEq(usdc.balanceOf(feeRecipient), AMOUNT / 100);
        assertEq(usdc.balanceOf(provider), AMOUNT - AMOUNT / 100);
        assertEq(usdc.balanceOf(address(v)), 0);
        assertEq(v.providerSharePct(), 100);
    }

    function test_accept_wrongSigner_reverts() public {
        DealVault v = _fundAndOpen(_terms());
        _deliver(v, keccak256("d"));
        bytes memory sig = _sign(providerPk, v, keccak256(abi.encode(ACCEPT_TYPEHASH, v.deliveryHash())));
        vm.expectRevert(DealVault.BadSignature.selector);
        v.accept(sig);
    }

    function test_challengeTimeout_releases() public {
        Terms memory t = _terms();
        DealVault v = _fundAndOpen(t);
        _deliver(v, keccak256("d"));
        vm.expectRevert(DealVault.NotFinal.selector);
        v.finalize();
        vm.warp(block.timestamp + t.challengeWindow + 1);
        v.finalize();
        assertEq(uint8(v.status()), uint8(Status.Released));
        assertEq(usdc.balanceOf(provider), AMOUNT - AMOUNT / 100);
    }

    function test_noDelivery_refund() public {
        Terms memory t = _terms();
        DealVault v = _fundAndOpen(t);
        vm.warp(t.deliverBy + 1);
        v.finalize();
        assertEq(uint8(v.status()), uint8(Status.Refunded));
        assertEq(uint8(v.refundReason()), uint8(RefundReason.NoDelivery));
        assertEq(usdc.balanceOf(payer), AMOUNT);
    }

    function test_overpayment_sweptToPayer() public {
        Terms memory t = _terms();
        address predicted = factory.predict(t);
        usdc.mint(predicted, t.amount + 5);
        DealVault v = DealVault(factory.open(t));
        _deliver(v, keccak256("d"));
        _accept(v);
        assertEq(usdc.balanceOf(payer), 5);
        assertEq(usdc.balanceOf(address(v)), 0);
    }

    function test_sweep_foreignToken() public {
        DealVault v = _fundAndOpen(_terms());
        MockToken junk = new MockToken("JUNK");
        junk.mint(address(v), 42);
        vm.expectRevert(DealVault.WrongStatus.selector);
        v.sweep(address(junk));
        _deliver(v, keccak256("d"));
        _accept(v);
        v.sweep(address(junk));
        assertEq(junk.balanceOf(payer), 42);
    }

    function test_dispute_outsideWindow_reverts() public {
        Terms memory t = _terms();
        DealVault v = _fundAndOpen(t);
        _deliver(v, keccak256("d"));
        vm.warp(block.timestamp + t.challengeWindow + 1);
        bytes32 reason = keccak256("bad");
        bytes memory sig = _sign(payerPk, v, keccak256(abi.encode(DISPUTE_TYPEHASH, v.deliveryHash(), reason)));
        vm.expectRevert(DealVault.TooLate.selector);
        v.dispute(reason, sig);
    }

    function test_dispute_beforeDelivery_reverts() public {
        DealVault v = _fundAndOpen(_terms());
        bytes32 reason = keccak256("bad");
        bytes memory sig = _sign(payerPk, v, keccak256(abi.encode(DISPUTE_TYPEHASH, bytes32(0), reason)));
        vm.expectRevert(DealVault.WrongStatus.selector);
        v.dispute(reason, sig);
    }

    function test_init_onlyFactory() public {
        DealVault v = DealVault(factory.open(_terms()));
        vm.expectRevert(DealVault.OnlyFactory.selector);
        v.init();
    }

    function test_validate_reasons() public {
        Terms memory t;
        bool ok;
        string memory why;

        (ok,) = factory.validate(_terms());
        assertTrue(ok);

        t = _terms();
        t.token = address(1);
        (ok, why) = factory.validate(t);
        assertFalse(ok);
        assertEq(why, "token");

        t = _terms();
        t.amount = 0;
        (ok, why) = factory.validate(t);
        assertEq(why, "amount");

        t = _terms();
        t.payer = address(0);
        (ok, why) = factory.validate(t);
        assertEq(why, "parties");

        t = _terms();
        t.provider = t.payer;
        (ok, why) = factory.validate(t);
        assertEq(why, "parties");

        t = _terms();
        t.validators[1] = t.validators[0];
        (ok, why) = factory.validate(t);
        assertEq(why, "validators");

        t = _terms();
        t.validators[2] = t.provider;
        (ok, why) = factory.validate(t);
        assertEq(why, "validators");

        t = _terms();
        t.feeBps = 1001;
        (ok, why) = factory.validate(t);
        assertEq(why, "fees");

        t = _terms();
        t.courtFeeBps = 1001;
        (ok, why) = factory.validate(t);
        assertEq(why, "fees");

        t = _terms();
        t.challengeWindow = 59;
        (ok, why) = factory.validate(t);
        assertEq(why, "windows");

        t = _terms();
        t.deliverBy = uint64(block.timestamp);
        (ok, why) = factory.validate(t);
        assertEq(why, "deliverBy");

        t = _terms();
        t.providerAgentId = 999;
        (ok, why) = factory.validate(t);
        assertEq(why, "providerAgent");

        t = _terms();
        t.payerAgentId = 999;
        (ok, why) = factory.validate(t);
        assertEq(why, "payerAgent");
    }

    function test_noAdminSurface() public {
        DealVault v = DealVault(factory.open(_terms()));
        (bool hasOwner,) = address(v).call(abi.encodeWithSignature("owner()"));
        (bool hasFactoryOwner,) = address(factory).call(abi.encodeWithSignature("owner()"));
        assertFalse(hasOwner);
        assertFalse(hasFactoryOwner);
    }

    function testFuzz_conservation_release(uint96 extra, uint16 feeBps) public {
        Terms memory t = _terms();
        t.feeBps = uint16(bound(feeBps, 0, 1000));
        address predicted = factory.predict(t);
        usdc.mint(predicted, t.amount + extra);
        DealVault v = DealVault(factory.open(t));
        _deliver(v, keccak256("d"));
        _accept(v);
        assertEq(usdc.balanceOf(provider) + usdc.balanceOf(feeRecipient) + usdc.balanceOf(payer), t.amount + extra);
        assertEq(usdc.balanceOf(address(v)), 0);
    }
}
