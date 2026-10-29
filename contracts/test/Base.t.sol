// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Registries} from "../script/lib/Registries.sol";
import {IdentityRegistryUpgradeable} from "../src/erc8004/IdentityRegistryUpgradeable.sol";
import {ValidationRegistryUpgradeable} from "../src/erc8004/ValidationRegistryUpgradeable.sol";
import {DealFactory} from "../src/DealFactory.sol";
import {DealVault, Status} from "../src/DealVault.sol";
import {Terms} from "../src/Terms.sol";
import {MockToken} from "./mocks/MockToken.sol";

abstract contract Base is Test {
    Registries.Set reg;
    DealFactory factory;
    MockToken usdc;
    MockToken usdt;

    uint256 payerPk = 0xA11CE;
    uint256 providerPk = 0xB0B;
    address payer;
    address provider;
    address feeRecipient = makeAddr("feeRecipient");
    address[3] validators;
    uint256 providerAgentId;
    uint256 payerAgentId;

    uint256 constant AMOUNT = 1_000_000; // 1.00 USDC (6 decimals)
    string constant COURT_TAG = "proviso.court.v1";

    bytes32 constant DELIVERY_TYPEHASH = keccak256("Delivery(bytes32 deliveryHash,string uri)");
    bytes32 constant ACCEPT_TYPEHASH = keccak256("Accept(bytes32 deliveryHash)");
    bytes32 constant DISPUTE_TYPEHASH = keccak256("Dispute(bytes32 deliveryHash,bytes32 reasonHash)");

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        payer = vm.addr(payerPk);
        provider = vm.addr(providerPk);
        validators = [makeAddr("v0"), makeAddr("v1"), makeAddr("v2")];

        reg = Registries.deploy(address(this));
        usdc = new MockToken("USDC");
        usdt = new MockToken("USDT");
        factory = new DealFactory(feeRecipient, reg.identity, reg.reputation, reg.validation, address(usdc), address(usdt));

        vm.prank(provider);
        providerAgentId = IdentityRegistryUpgradeable(reg.identity).register("https://p.example/agent.json");
        vm.prank(payer);
        payerAgentId = IdentityRegistryUpgradeable(reg.identity).register("https://b.example/agent.json");
    }

    function _terms() internal view returns (Terms memory t) {
        t.payer = payer;
        t.provider = provider;
        t.token = address(usdc);
        t.amount = AMOUNT;
        t.deliverBy = uint64(block.timestamp + 1 hours);
        t.challengeWindow = 10 minutes;
        t.courtWindow = 30 minutes;
        t.feeBps = 100; // 1%
        t.courtFeeBps = 300; // 3%
        t.validators = validators;
        t.providerAgentId = providerAgentId;
        t.payerAgentId = payerAgentId;
        t.specHash = keccak256("spec");
        t.intentHash = keccak256("intent");
        t.salt = keccak256("cart-1");
    }

    /// Funds the predicted address the way the HSP relayer would (a plain token transfer), then opens it.
    function _fundAndOpen(Terms memory t) internal returns (DealVault v) {
        address predicted = factory.predict(t);
        MockToken(t.token).mint(predicted, t.amount);
        v = DealVault(factory.open(t));
    }

    function _sign(uint256 pk, DealVault v, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", v.domainSeparator(), structHash));
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, vv);
    }

    function _deliver(DealVault v, bytes32 dh) internal {
        string memory uri = "https://desk.example/evidence/1";
        v.deliver(dh, uri, _sign(providerPk, v, keccak256(abi.encode(DELIVERY_TYPEHASH, dh, keccak256(bytes(uri))))));
    }

    function _accept(DealVault v) internal {
        v.accept(_sign(payerPk, v, keccak256(abi.encode(ACCEPT_TYPEHASH, v.deliveryHash()))));
    }

    function _dispute(DealVault v, bytes32 reason) internal {
        v.dispute(reason, _sign(payerPk, v, keccak256(abi.encode(DISPUTE_TYPEHASH, v.deliveryHash(), reason))));
    }

    /// Provider files a validation request for panel member i; validator i answers `bucket` with the court tag.
    function _vote(DealVault v, uint8 i, bytes32 salt, uint8 bucket, string memory tag) internal {
        bytes32 h = factory.requestHash(address(v), i, salt);
        vm.prank(provider);
        ValidationRegistryUpgradeable(reg.validation).validationRequest(
            validators[i], providerAgentId, "https://desk.example/evidence/bundle", h
        );
        vm.prank(validators[i]);
        ValidationRegistryUpgradeable(reg.validation).validationResponse(h, bucket, "", bytes32(0), tag);
    }
}
