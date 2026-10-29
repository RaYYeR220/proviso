// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {Registries} from "./lib/Registries.sol";

/// @notice Renounces ownership of the three registry proxies, after which they can never be upgraded.
/// env: PRIVATE_KEY; reads ./deployments/<chainid>.json
contract RenounceRegistries is Script {
    function run() external {
        string memory json = vm.readFile(string.concat("./deployments/", vm.toString(block.chainid), ".json"));
        Registries.Set memory reg = Registries.Set({
            identity: vm.parseJsonAddress(json, ".identityRegistry"),
            reputation: vm.parseJsonAddress(json, ".reputationRegistry"),
            validation: vm.parseJsonAddress(json, ".validationRegistry")
        });
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));
        Registries.renounce(reg);
        vm.stopBroadcast();
    }
}
