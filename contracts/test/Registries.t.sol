// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Registries} from "../script/lib/Registries.sol";
import {IdentityRegistryUpgradeable} from "../src/erc8004/IdentityRegistryUpgradeable.sol";
import {ReputationRegistryUpgradeable} from "../src/erc8004/ReputationRegistryUpgradeable.sol";
import {ValidationRegistryUpgradeable} from "../src/erc8004/ValidationRegistryUpgradeable.sol";

contract RegistriesTest is Test {
    Registries.Set r;
    address agentOwner = makeAddr("agentOwner");
    address client = makeAddr("client");
    address validator = makeAddr("validator");

    function setUp() public {
        r = Registries.deploy(address(this));
    }

    function test_registries_endToEnd() public {
        vm.prank(agentOwner);
        uint256 id = IdentityRegistryUpgradeable(r.identity).register("https://example.org/agent.json");
        assertEq(IdentityRegistryUpgradeable(r.identity).ownerOf(id), agentOwner);

        vm.prank(client);
        ReputationRegistryUpgradeable(r.reputation).giveFeedback(id, 80, 0, "t1", "t2", "", "", bytes32(0));
        address[] memory clients = new address[](1);
        clients[0] = client;
        (uint64 count, int128 value,) = ReputationRegistryUpgradeable(r.reputation).getSummary(id, clients, "t1", "");
        assertEq(count, 1);
        assertEq(value, 80);

        bytes32 h = keccak256("req");
        vm.prank(agentOwner);
        ValidationRegistryUpgradeable(r.validation).validationRequest(validator, id, "ipfs://req", h);
        vm.prank(validator);
        ValidationRegistryUpgradeable(r.validation).validationResponse(h, 75, "ipfs://resp", bytes32(0), "tag");
        (address v, uint256 agentId, uint8 resp,, string memory tag,) =
            ValidationRegistryUpgradeable(r.validation).getValidationStatus(h);
        assertEq(v, validator);
        assertEq(agentId, id);
        assertEq(resp, 75);
        assertEq(tag, "tag");
    }

    function test_renounced_cannotUpgrade() public {
        Registries.renounce(r);
        address impl = address(new ValidationRegistryUpgradeable());
        vm.expectRevert();
        UUPSUpgradeable(r.validation).upgradeToAndCall(impl, "");
        vm.expectRevert();
        UUPSUpgradeable(r.identity).upgradeToAndCall(impl, "");
        vm.expectRevert();
        UUPSUpgradeable(r.reputation).upgradeToAndCall(impl, "");
    }
}
