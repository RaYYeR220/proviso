// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// @notice Placeholder implementation a registry proxy starts on. Same storage layout as the reference
/// MinimalUUPS (identity registry address in slot 0), but the owner is the caller instead of a fixed address.
contract RegistryBootstrap is OwnableUpgradeable, UUPSUpgradeable {
    address private _identityRegistry;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address identityRegistry_) public initializer {
        __Ownable_init(owner_);
        _identityRegistry = identityRegistry_;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
