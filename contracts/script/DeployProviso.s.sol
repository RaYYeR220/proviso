// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {Registries} from "./lib/Registries.sol";
import {DealFactory} from "../src/DealFactory.sol";

/// @notice Deploys the ERC-8004 registries and the deal factory.
/// env: PRIVATE_KEY, USDC, USDT, FEE_RECIPIENT (optional, defaults to the deployer)
contract DeployProviso is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address usdc = vm.envAddress("USDC");
        address usdt = vm.envAddress("USDT");
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);

        vm.startBroadcast(pk);
        Registries.Set memory reg = Registries.deploy(deployer);
        DealFactory factory = new DealFactory(feeRecipient, reg.identity, reg.reputation, reg.validation, usdc, usdt);
        vm.stopBroadcast();

        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployedAtBlock", block.number);
        vm.serializeAddress(k, "identityRegistry", reg.identity);
        vm.serializeAddress(k, "reputationRegistry", reg.reputation);
        vm.serializeAddress(k, "validationRegistry", reg.validation);
        vm.serializeAddress(k, "dealFactory", address(factory));
        vm.serializeAddress(k, "vaultImpl", factory.vaultImpl());
        vm.serializeAddress(k, "feeRecipient", feeRecipient);
        vm.serializeAddress(k, "usdc", usdc);
        string memory json = vm.serializeAddress(k, "usdt", usdt);
        vm.writeJson(json, string.concat("./deployments/", vm.toString(block.chainid), ".json"));
        console2.log("DealFactory", address(factory));
    }
}
