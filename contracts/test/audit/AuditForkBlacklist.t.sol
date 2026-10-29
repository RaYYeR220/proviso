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

/// Real USDC.e (FiatTokenV2_2) on an HSK mainnet fork: a blacklisted payee cannot freeze settlement; its share is
/// held for claim(). FORK_TESTS=1 to run.
contract AuditForkBlacklist is Test {
    address constant USDC_E = 0x054ed45810DbBAb8B27668922D110669c9D88D0a;
    address constant USDT = 0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029;
    address constant USDC_WHALE = 0x62cB71582F277ef581e5F282F78e482fa347Bde7;

    function test_fork_blacklistedFeeRecipient_doesNotStrandVault() public {
        if (!vm.envOr("FORK_TESTS", false)) return;
        vm.createSelectFork("hsk");
        address payer = makeAddr("payer");
        address provider = makeAddr("provider");
        address fee = makeAddr("fee");
        Registries.Set memory reg = Registries.deploy(address(this));
        DealFactory factory = new DealFactory(fee, reg.identity, reg.reputation, reg.validation, USDC_E, USDT, address(this));
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

        // The vault still settles: the provider is paid, the blacklisted fee is held for a later claim.
        vm.prank(payer);
        v.accept("");
        assertEq(uint8(v.status()), uint8(Status.Released));
        assertEq(IERC20(USDC_E).balanceOf(provider), t.amount - t.amount / 100);
        assertEq(v.owed(fee), t.amount / 100);
        assertEq(IERC20(USDC_E).balanceOf(vault), t.amount / 100);
        // sweep never touches what is owed
        v.sweep(USDC_E);
        assertEq(IERC20(USDC_E).balanceOf(vault), t.amount / 100);
        // the fee recipient redirects its claim to a clean address
        address clean = makeAddr("clean");
        vm.prank(fee);
        v.claim(clean);
        assertEq(IERC20(USDC_E).balanceOf(clean), t.amount / 100);
        assertEq(v.owedTotal(), 0);
    }
}
