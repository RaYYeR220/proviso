#!/usr/bin/env bash
# Deploys Proviso to a running anvil fork of HSK Chain mainnet, funds the agents and registers them. Real
# USDC.e / USDT / Permit2 bytecode, so the whole settlement path runs as on mainnet. Start the fork first:
#   anvil --fork-url https://mainnet.hsk.xyz --chain-id 31337 --port 8645 --block-time 2
# usage: KEYS=path/to/keys.env RPC=http://127.0.0.1:8645 scripts/fork-env.sh
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "${KEYS:?set KEYS to an env file with the role keys}"; set +a
rpc=${RPC:-http://127.0.0.1:8645}
usdc=0x054ed45810DbBAb8B27668922D110669c9D88D0a
usdt=0xF1B50eD67A9e2CC94Ad3c477779E2d4cBfFf9029
whale=0x62cB71582F277ef581e5F282F78e482fa347Bde7

[ "$(cast chain-id --rpc-url $rpc)" = "31337" ] || { echo "no 31337 fork at $rpc" >&2; exit 1; }

# gas first: the deployer is the relayer, whose mainnet balance alone may not cover the deployment
for k in RELAYER PAYMENT_AGENT AUDITOR ANALYST LOCALIZER SHADY VALIDATOR_0 VALIDATOR_1 VALIDATOR_2; do
  v="${k}_PRIVATE_KEY"; a=$(cast wallet address --private-key "${!v}")
  cast rpc anvil_setBalance "$a" 0x56BC75E2D63100000 --rpc-url $rpc >/dev/null
done

cd "$root/contracts"
PRIVATE_KEY=$RELAYER_PRIVATE_KEY USDC=$usdc USDT=$usdt forge script script/DeployProviso.s.sol --rpc-url $rpc --broadcast -q
cd "$root"
pa=$(cast wallet address --private-key "$PAYMENT_AGENT_PRIVATE_KEY")
cast rpc anvil_impersonateAccount $whale --rpc-url $rpc >/dev/null
cast send $usdc "transfer(address,uint256)" "$pa" 5000000 --from $whale --unlocked --rpc-url $rpc >/dev/null
echo "payment agent USDC.e: $(cast call $usdc 'balanceOf(address)(uint256)' $pa --rpc-url $rpc)"

rm -f "$root/contracts/deployments/31337-agents.json"
CHAIN_ID=31337 RPC_URL=$rpc DEPLOYMENT_FILE="$root/contracts/deployments/31337.json" \
  pnpm --filter @proviso/desk exec tsx scripts/register-agents.ts
