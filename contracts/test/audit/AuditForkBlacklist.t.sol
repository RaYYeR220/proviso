// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Registries} from "../../script/lib/Registries.sol";
import {IdentityRegistryUpgradeable} from "../../src/erc8004/IdentityRegistryUpgradeable.sol";
import {DealFactory} from "../../src/DealFactory.sol";
import {DealVault, Status} from "../../src/DealVault.sol";
import {Terms} from "../../src/Terms.sol";

interface IFiatAdmin {
    function owner() external view returns (address);
    function updateBlacklister(address) external;
    function blacklist(address) external;
}

/// Real USDC.e (FiatTokenV2_2) on an HSK mainnet fork: blacklisting the factory's immutable feeRecipient
/// makes every Delivered USDC.e vault with a non-zero fee unsettleable forever. FORK_TESTS=1 to run.
contract AuditForkBlacklist is Test {
    address constant USDC_E = 0x054ed45810DbBAb8B27668922D110669c9D88D0a;
    address constant USDT = 0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029;
    address constant USDC_WHALE = 0x62cB71582F277ef581e5F282F78e482fa347Bde7;

    function test_fork_poc_blacklistedFeeRecipient_strandsDeliveredVault() public {
        if (!vm.envOr("FORK_TESTS", false)) return;
        vm.createSelectFork("hsk");
        address payer = makeAddr("payer");
        address provider = makeAddr("provider");
        address fee = makeAddr("fee");
        Registries.Set memory reg = Registries.deploy(address(this));
        DealFactory factory = new DealFactory(fee, reg.identity, reg.reputation, reg.validation, USDC_E, USDT);
        vm.prank(provider);
        uint256 pid = IdentityRegistryUpgradeable(reg.identity).register("p");
        vm.prank(payer);
        uint256 bid = IdentityRegistryUpgradeable(reg.identity).register("b");

        Terms memory t;
        t.payer = payer;
        t.provider = provider;
        t.token = USDC_E;
        t.amount = 50_000;
        t.deliverBy = uint64(block.timestamp + 1 hours);
        t.challengeWindow = 5 minutes;
        t.courtWindow = 30 minutes;
        t.feeBps = 100;
        t.courtFeeBps = 300;
        t.validators = [makeAddr("v0"), makeAddr("v1"), makeAddr("v2")];
        t.providerAgentId = pid;
        t.payerAgentId = bid;
        t.salt = keccak256("bl");

        address vault = factory.predict(t);
        vm.prank(USDC_WHALE);
        IERC20(USDC_E).transfer(vault, t.amount);
        DealVault v = DealVault(factory.open(t));
        vm.prank(provider);
        v.deliver(keccak256("d"), "u", "");

        // Issuer blacklists the (immutable) platform fee recipient.
        address owner = IFiatAdmin(USDC_E).owner();
        vm.prank(owner);
        IFiatAdmin(USDC_E).updateBlacklister(address(this));
        IFiatAdmin(USDC_E).blacklist(fee);

        vm.prank(payer);
        vm.expectRevert();
        v.accept("");
        vm.warp(block.timestamp + t.challengeWindow + 1);
        vm.expectRevert();
        v.finalize();
        vm.prank(payer);
        vm.expectRevert(DealVault.TooLate.selector);
        v.dispute(bytes32("r"), "");
        vm.warp(block.timestamp + 3650 days);
        vm.expectRevert();
        v.finalize();
        assertEq(uint8(v.status()), uint8(Status.Delivered));
        assertEq(IERC20(USDC_E).balanceOf(vault), t.amount); // stranded: no exit path remains
    }
}
