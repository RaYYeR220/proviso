// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Registries} from "../../script/lib/Registries.sol";
import {IdentityRegistryUpgradeable} from "../../src/erc8004/IdentityRegistryUpgradeable.sol";
import {DealFactory} from "../../src/DealFactory.sol";
import {DealVault, Status} from "../../src/DealVault.sol";
import {Terms} from "../../src/Terms.sol";

interface IFiatToken3009 {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
}

interface IPermit2 {
    struct TokenPermissions {
        address token;
        uint256 amount;
    }

    struct PermitTransferFrom {
        TokenPermissions permitted;
        uint256 nonce;
        uint256 deadline;
    }

    struct SignatureTransferDetails {
        address to;
        uint256 requestedAmount;
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function permitTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external;
}

/// @notice Runs the settlement path against the real HSK Chain mainnet tokens on a fork:
/// USDC.e (FiatTokenV2_2, EIP-3009) and USDT through canonical Permit2, each relayed the way the HSP gateway
/// relayer does it, into a vault address that does not exist yet. Enable with FORK_TESTS=1.
contract HskForkTest is Test {
    address constant USDC_E = 0x054ed45810DbBAb8B27668922D110669c9D88D0a;
    address constant USDT = 0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029;
    address constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address constant HSP_RELAYER = 0x1aaA5E4371aAdf96bEfb5bd2Af4d896FD16915Ea;
    address constant USDC_WHALE = 0x62cB71582F277ef581e5F282F78e482fa347Bde7;
    address constant USDT_WHALE = 0x8fed6470991878e806bcb733FFB8392B5D07e95E;

    bytes32 constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 constant TOKEN_PERMISSIONS_TYPEHASH = keccak256("TokenPermissions(address token,uint256 amount)");
    bytes32 constant PERMIT_TRANSFER_FROM_TYPEHASH = keccak256(
        "PermitTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline)TokenPermissions(address token,uint256 amount)"
    );

    bool enabled;
    DealFactory factory;
    uint256 payerPk = 0xA11CE;
    uint256 providerPk = 0xB0B;
    address payer;
    address provider;
    uint256 providerAgentId;
    uint256 payerAgentId;

    function setUp() public {
        enabled = vm.envOr("FORK_TESTS", false);
        if (!enabled) return;
        vm.createSelectFork("hsk");
        payer = vm.addr(payerPk);
        provider = vm.addr(providerPk);
        Registries.Set memory reg = Registries.deploy(address(this));
        factory = new DealFactory(makeAddr("fee"), reg.identity, reg.reputation, reg.validation, USDC_E, USDT);
        vm.prank(provider);
        providerAgentId = IdentityRegistryUpgradeable(reg.identity).register("p");
        vm.prank(payer);
        payerAgentId = IdentityRegistryUpgradeable(reg.identity).register("b");
        vm.prank(USDC_WHALE);
        IERC20(USDC_E).transfer(payer, 1_000_000);
        vm.prank(USDT_WHALE);
        IERC20(USDT).transfer(payer, 1_000_000);
    }

    function _terms(address token, bytes32 salt) internal returns (Terms memory t) {
        t.payer = payer;
        t.provider = provider;
        t.token = token;
        t.amount = 50_000; // 0.05
        t.deliverBy = uint64(block.timestamp + 1 hours);
        t.challengeWindow = 5 minutes;
        t.courtWindow = 30 minutes;
        t.feeBps = 100;
        t.courtFeeBps = 300;
        t.validators = [makeAddr("v0"), makeAddr("v1"), makeAddr("v2")];
        t.providerAgentId = providerAgentId;
        t.payerAgentId = payerAgentId;
        t.specHash = keccak256("spec");
        t.intentHash = keccak256("intent");
        t.salt = salt;
    }

    function _deliverAndAccept(DealVault v) internal {
        vm.prank(provider);
        v.deliver(keccak256("deliverable"), "u", "");
        vm.prank(payer);
        v.accept("");
    }

    function test_fork_usdc3009_toPredictedVault() public {
        if (!enabled) return;
        Terms memory t = _terms(USDC_E, keccak256("fork-usdc"));
        address vault = factory.predict(t);
        bytes32 nonce = keccak256(abi.encode(vault, "cart-mandate-id"));
        uint256 validBefore = block.timestamp + 300;

        bytes32 structHash =
            keccak256(abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, payer, vault, t.amount, 0, validBefore, nonce));
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", IFiatToken3009(USDC_E).DOMAIN_SEPARATOR(), structHash));
        (uint8 sv, bytes32 r, bytes32 s) = vm.sign(payerPk, digest);

        vm.prank(HSP_RELAYER);
        IFiatToken3009(USDC_E).transferWithAuthorization(payer, vault, t.amount, 0, validBefore, nonce, sv, r, s);
        assertEq(IERC20(USDC_E).balanceOf(vault), t.amount);
        assertTrue(IFiatToken3009(USDC_E).authorizationState(payer, nonce));

        DealVault v = DealVault(factory.open(t));
        assertEq(uint8(v.status()), uint8(Status.Funded));
        _deliverAndAccept(v);
        assertEq(IERC20(USDC_E).balanceOf(provider), t.amount - t.amount / 100);
    }

    function test_fork_usdc3009_cannotRedirect() public {
        if (!enabled) return;
        Terms memory t = _terms(USDC_E, keccak256("fork-usdc-2"));
        address vault = factory.predict(t);
        bytes32 nonce = keccak256("n");
        uint256 validBefore = block.timestamp + 300;
        bytes32 structHash =
            keccak256(abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, payer, vault, t.amount, 0, validBefore, nonce));
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", IFiatToken3009(USDC_E).DOMAIN_SEPARATOR(), structHash));
        (uint8 sv, bytes32 r, bytes32 s) = vm.sign(payerPk, digest);
        // A relayer that tries to send the payer's money anywhere but the vault gets an invalid signature.
        vm.prank(HSP_RELAYER);
        vm.expectRevert();
        IFiatToken3009(USDC_E).transferWithAuthorization(
            payer, makeAddr("thief"), t.amount, 0, validBefore, nonce, sv, r, s
        );
    }

    function test_fork_usdtPermit2_toPredictedVault() public {
        if (!enabled) return;
        Terms memory t = _terms(USDT, keccak256("fork-usdt"));
        address vault = factory.predict(t);
        vm.prank(payer);
        IERC20(USDT).approve(PERMIT2, type(uint256).max);

        uint256 nonce = uint256(keccak256(abi.encode(vault)));
        uint256 deadline = block.timestamp + 300;
        bytes32 permissions = keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, USDT, t.amount));
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TRANSFER_FROM_TYPEHASH, permissions, HSP_RELAYER, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", IPermit2(PERMIT2).DOMAIN_SEPARATOR(), structHash));
        (uint8 sv, bytes32 r, bytes32 s) = vm.sign(payerPk, digest);

        vm.prank(HSP_RELAYER);
        IPermit2(PERMIT2).permitTransferFrom(
            IPermit2.PermitTransferFrom(IPermit2.TokenPermissions(USDT, t.amount), nonce, deadline),
            IPermit2.SignatureTransferDetails(vault, t.amount),
            payer,
            abi.encodePacked(r, s, sv)
        );
        DealVault v = DealVault(factory.open(t));
        assertEq(uint8(v.status()), uint8(Status.Funded));
        _deliverAndAccept(v);
        assertEq(IERC20(USDT).balanceOf(provider), t.amount - t.amount / 100);
    }
}
