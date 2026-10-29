// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {Registries} from "./lib/Registries.sol";
import {DealFactory} from "../src/DealFactory.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// @notice Deploys the ERC-8004 registries and the deal factory.
/// env: PRIVATE_KEY, USDC, USDT, FEE_RECIPIENT and SETTLER (optional, default to the deployer),
///      RENOUNCE=true to renounce the registries' upgrade keys in the same broadcast
contract DeployProviso is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address usdc = vm.envAddress("USDC");
        address usdt = vm.envAddress("USDT");
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);
        address settler = vm.envOr("SETTLER", deployer);
        bool renounce = vm.envOr("RENOUNCE", false);

        vm.startBroadcast(pk);
        Registries.Set memory reg = Registries.deploy(deployer);
        DealFactory factory =
            new DealFactory(feeRecipient, reg.identity, reg.reputation, reg.validation, usdc, usdt, settler);
        if (renounce) Registries.renounce(reg);
        vm.stopBroadcast();
        if (renounce) {
            require(OwnableUpgradeable(reg.identity).owner() == address(0), "identity owned");
            require(OwnableUpgradeable(reg.reputation).owner() == address(0), "reputation owned");
            require(OwnableUpgradeable(reg.validation).owner() == address(0), "validation owned");
        }

        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployedAtBlock", block.number);
        vm.serializeAddress(k, "identityRegistry", reg.identity);
        vm.serializeAddress(k, "reputationRegistry", reg.reputation);
        vm.serializeAddress(k, "validationRegistry", reg.validation);
        vm.serializeAddress(k, "dealFactory", address(factory));
        vm.serializeAddress(k, "vaultImpl", factory.vaultImpl());
        vm.serializeAddress(k, "feeRecipient", feeRecipient);
        vm.serializeAddress(k, "settler", settler);
        vm.serializeBool(k, "registriesRenounced", renounce);
        vm.serializeAddress(k, "usdc", usdc);
        string memory json = vm.serializeAddress(k, "usdt", usdt);
        vm.writeJson(json, string.concat("./deployments/", vm.toString(block.chainid), ".json"));
        console2.log("DealFactory", address(factory));
    }
}
