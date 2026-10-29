#!/usr/bin/env bash
# Verifies every contract created by the latest DeployProviso broadcast on Sourcify (Blockscout reads it).
# usage: script/verify.sh 133|177
set -euo pipefail
chain="$1"
case "$chain" in
  177) url="https://hsk.blockscout.com/api/" ;;
  133) url="https://testnet-explorer.hskchain.net/api/" ;;
  *) echo "unknown chain $chain" >&2; exit 1 ;;
esac
broadcast="broadcast/DeployProviso.s.sol/$chain/run-latest.json"

node -e '
const d = require("./" + process.argv[1]);
const enc = (types, args) => require("child_process").execFileSync("cast", ["abi-encode", `f(${types})`, ...args]).toString().trim();
for (const tx of d.transactions) {
  if (!["CREATE", "CREATE2"].includes(tx.transactionType)) continue;
  const name = tx.contractName;
  let args = "";
  if (name === "ERC1967Proxy") args = enc("address,bytes", tx.arguments);
  if (name === "DealFactory") args = enc("address,address,address,address,address,address,address", tx.arguments);
  console.log([name, tx.contractAddress, args].join(" "));
}' "$broadcast" | while read -r name addr args; do
  path="src/DealFactory.sol:DealFactory"
  case "$name" in
    ERC1967Proxy) path="node_modules/@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy" ;;
    RegistryBootstrap) path="src/erc8004/RegistryBootstrap.sol:RegistryBootstrap" ;;
    IdentityRegistryUpgradeable|ReputationRegistryUpgradeable|ValidationRegistryUpgradeable) path="src/erc8004/$name.sol:$name" ;;
  esac
  echo "verifying $name $addr"
  extra=()
  [ -n "${args:-}" ] && extra=(--constructor-args "$args")
  forge verify-contract "$addr" "$path" --chain-id "$chain" --verifier sourcify "${extra[@]}" --watch || true
done

# The vault implementation is created by the factory constructor.
impl=$(node -e "console.log(require('./deployments/$chain.json').vaultImpl)")
echo "verifying DealVault $impl"
forge verify-contract "$impl" src/DealVault.sol:DealVault --chain-id "$chain" --verifier sourcify --watch || true
