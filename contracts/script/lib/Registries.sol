// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {RegistryBootstrap} from "../../src/erc8004/RegistryBootstrap.sol";
import {IdentityRegistryUpgradeable} from "../../src/erc8004/IdentityRegistryUpgradeable.sol";
import {ReputationRegistryUpgradeable} from "../../src/erc8004/ReputationRegistryUpgradeable.sol";
import {ValidationRegistryUpgradeable} from "../../src/erc8004/ValidationRegistryUpgradeable.sol";

/// @notice Deploys the three ERC-8004 registries behind ERC-1967 proxies owned by `owner`
/// (the caller of these functions must be `owner`), and renounces them afterwards.
library Registries {
    struct Set {
        address identity;
        address reputation;
        address validation;
    }

    function deploy(address owner) internal returns (Set memory s) {
        address boot = address(new RegistryBootstrap());

        s.identity = _proxy(boot, owner, address(0));
        UUPSUpgradeable(s.identity).upgradeToAndCall(
            address(new IdentityRegistryUpgradeable()), abi.encodeCall(IdentityRegistryUpgradeable.initialize, ())
        );

        s.reputation = _proxy(boot, owner, s.identity);
        UUPSUpgradeable(s.reputation).upgradeToAndCall(
            address(new ReputationRegistryUpgradeable()),
            abi.encodeCall(ReputationRegistryUpgradeable.initialize, (s.identity))
        );

        s.validation = _proxy(boot, owner, s.identity);
        UUPSUpgradeable(s.validation).upgradeToAndCall(
            address(new ValidationRegistryUpgradeable()),
            abi.encodeCall(ValidationRegistryUpgradeable.initialize, (s.identity))
        );
    }

    function renounce(Set memory s) internal {
        OwnableUpgradeable(s.identity).renounceOwnership();
        OwnableUpgradeable(s.reputation).renounceOwnership();
        OwnableUpgradeable(s.validation).renounceOwnership();
    }

    function _proxy(address boot, address owner, address identity) private returns (address) {
        return address(new ERC1967Proxy(boot, abi.encodeCall(RegistryBootstrap.initialize, (owner, identity))));
    }
}
