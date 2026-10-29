# Vendored ERC-8004 registries

`IdentityRegistryUpgradeable.sol`, `ReputationRegistryUpgradeable.sol` and
`ValidationRegistryUpgradeable.sol` are copied **unmodified** from the ERC-8004
reference implementation, https://github.com/erc-8004/erc-8004-contracts
(`contracts/`, MIT). They are deployed here behind our own ERC-1967 proxies on
HSK Chain, because the canonical `0x8004…` proxies cannot be recreated on a new
chain by anyone but their owner.

`RegistryBootstrap.sol` (ours) replaces the reference `MinimalUUPS` placeholder,
which hard-codes the reference team as owner. It sets the deployer as owner and
writes slot 0 exactly like `MinimalUUPS`, so the real implementations'
`initialize` (`reinitializer(2) onlyOwner`) runs unchanged in the upgrade call.
After deployment the owner renounces ownership, so no registry can be upgraded
again.
