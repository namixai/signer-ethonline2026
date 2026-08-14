#!/usr/bin/env bash
# Third anchor: ask the deployed contracts, not the repo and not us.
#
# The offline check (verify_ours.py + verify_sdk.mjs) proves two implementations agree.
# It cannot prove they agree with the chain. This script does that half, and it is the
# only part of the vector set that needs network.
#
#   ./anchor_onchain.sh
#
# Needs `cast` (foundry). Read-only: eth_call and eth_getCode, no key, nothing is sent.

set -uo pipefail

ETH_RPC="${ETH_RPC:-https://ethereum-rpc.publicnode.com}"
BASE_RPC="${BASE_RPC:-https://mainnet.base.org}"

PERMIT2=0x000000000022D473030F116dDEE9F6B43aC78BA3
UR_ETH=0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af
UR_BASE=0x6fF5693b99212Da76ad316178A184AB56D299b43

DS_ETH_EXPECTED=0x866a5aba21966af95d6c7ab78eb2b2fc913915c28be3b9aa07cc04ff903e3f28
DS_BASE_EXPECTED=0x3b6f35e4fce979ef8eac3bcdc8c3fc38fe7911bb0c69c8fe72bf1fd1a17e6f07
PM_ETH_EXPECTED=0x000000000004444c5dc75cB358380D2e3dE08A90
PM_BASE_EXPECTED=0x498581fF718922c3f8e6A244956aF099B2652b2b

command -v cast >/dev/null || { echo "cast not found — install foundry (https://getfoundry.sh)"; exit 2; }

fail=0
check() { # name expected actual
  if [ "$(echo "$2" | tr 'A-Z' 'a-z')" = "$(echo "$3" | tr 'A-Z' 'a-z')" ]; then
    echo "ok   $1"
  else
    echo "FAIL $1"; echo "     expected $2"; echo "     got      $3"; fail=$((fail+1))
  fi
}

echo "== Permit2 domain separators (the value the contract itself reports)"
check "chain 1 DOMAIN_SEPARATOR"    "$DS_ETH_EXPECTED"  "$(cast call --rpc-url "$ETH_RPC"  $PERMIT2 'DOMAIN_SEPARATOR()(bytes32)')"
check "chain 8453 DOMAIN_SEPARATOR" "$DS_BASE_EXPECTED" "$(cast call --rpc-url "$BASE_RPC" $PERMIT2 'DOMAIN_SEPARATOR()(bytes32)')"

echo
echo "== UniversalRouter names its own PoolManager"
check "chain 1 poolManager()"    "$PM_ETH_EXPECTED"  "$(cast call --rpc-url "$ETH_RPC"  $UR_ETH  'poolManager()(address)')"
check "chain 8453 poolManager()" "$PM_BASE_EXPECTED" "$(cast call --rpc-url "$BASE_RPC" $UR_BASE 'poolManager()(address)')"

echo
echo "== Is the route-signing surface deployed? (repo main has it; these addresses should not)"
for pair in "1:$ETH_RPC:$UR_ETH" "8453:$BASE_RPC:$UR_BASE"; do
  chain="${pair%%:*}"; rest="${pair#*:}"; rpc="${rest%:*}"; addr="${rest##*:}"
  code=$(cast code --rpc-url "$rpc" "$addr" | tr 'A-Z' 'a-z')
  if grep -q "6344684dc3" <<<"$code"; then
    echo "CHANGED chain $chain: executeSigned selector 0x44684dc3 IS present now."
    echo "        The spec text about this is stale — re-read SPEC-uniswap-execution-path.md §3."
    fail=$((fail+1))
  else
    echo "ok   chain $chain: executeSigned (0x44684dc3) absent, as documented"
  fi
  grep -q "633593564c" <<<"$code" \
    && echo "ok   chain $chain: execute(bytes,bytes[],uint256) present" \
    || { echo "FAIL chain $chain: execute selector missing — wrong address?"; fail=$((fail+1)); }
done

echo
if [ "$fail" -ne 0 ]; then
  echo "FAIL — $fail anchor(s) disagree with the pinned values. Chain wins; fix the docs."
  exit 1
fi
echo "OK — every on-chain anchor matches the pinned values."
