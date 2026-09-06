#!/usr/bin/env bash
# The demo, as a script rather than a video.
#
#   ./demo.sh            # runs every frame it can, prints an explicit STUB for the rest
#   ./demo.sh --frame 3  # one frame
#
# Why a script at all: we sell verifiability, so a recording nobody can reproduce is the
# wrong artifact. Everything below is a command a stranger can run. Frame 3 needs nothing
# from us at all — no account, no token, no permission.
#
# 🔴 SECRETS: this script never prints a token. Where one is needed it prints the variable
# NAME and whether it is set. If a frame cannot run, it says so loudly and keeps going;
# it never quietly skips, because a demo that silently drops its hardest frame is a demo
# that lies by omission.

set -uo pipefail

DEMO_GATEWAY="${DEMO_GATEWAY:-https://signer-demo.usenami.io:8443}"
# Frames 1-2 need a gateway with an armed venue and a token for it. Neither is public.
SIGNER_GATEWAY="${SIGNER_GATEWAY:-}"
SIGNER_TOKEN="${SIGNER_TOKEN:-}"
VENUE="${VENUE:-hyperliquid_testnet}"

FRAME="${2:-all}"
[ "${1:-}" = "--frame" ] || FRAME=all

bar() { printf '\n\033[1m── %s\033[0m\n' "$1"; }
note() { printf '   %s\n' "$1"; }
stub() { printf '\n\033[1;33m── STUB: %s\033[0m\n' "$1"; }

need() { command -v "$1" >/dev/null || { echo "missing: $1"; exit 2; }; }
need curl; need python3

run_frame_1() {
  bar "FRAME 1 — the agent asks for an order INSIDE policy, and gets a signature"
  if [ -z "$SIGNER_GATEWAY" ] || [ -z "$SIGNER_TOKEN" ]; then
    stub "frame 1 not run — no gateway with an armed venue"
    note "This frame needs a signing gateway where a venue is armed and a token for it."
    note "SIGNER_GATEWAY is ${SIGNER_GATEWAY:+set}${SIGNER_GATEWAY:-UNSET}, SIGNER_TOKEN is ${SIGNER_TOKEN:+set}${SIGNER_TOKEN:-UNSET}."
    note ""
    note "It is deliberately NOT pointed at the production box: that box holds real keys"
    note "and real money, and neither belongs on camera. What goes here is a demo tenant"
    note "with a testnet venue armed — same code, same attested image, no funds at risk."
    return 0
  fi
  note "gateway ${SIGNER_GATEWAY}   venue ${VENUE}   token: set (not printed)"
  local body
  body=$(cat <<JSON
{"venue":"${VENUE}","kind":"order","order":{"symbol":"BNB","is_buy":true,"size":"0.010","limit_px":"1","reduce_only":false}}
JSON
)
  local out code
  out=$(curl -s -w '\n%{http_code}' --max-time 25 -X POST "${SIGNER_GATEWAY}/sign" \
        -H "Authorization: Bearer ${SIGNER_TOKEN}" -H 'content-type: application/json' \
        -d "$body")
  code=$(printf '%s' "$out" | tail -1)
  printf '%s' "$out" | sed '$d' | python3 -c '
import sys,json
try:
    d=json.load(sys.stdin)
except Exception:
    print("   (non-JSON body)"); raise SystemExit
# A signature is long and boring on screen; show that it exists and its shape, not the value.
for k,v in d.items():
    if isinstance(v,str) and len(v)>24 and k.lower() in ("signature","r","s","sig"):
        print(f"   {k}: <{len(v)} chars> (not printed)")
    else:
        print(f"   {k}: {v}")
'
  note "HTTP ${code}  — expected 200 with a signature present"
}

run_frame_2() {
  bar "FRAME 2 — the agent asks for an order OVER the cap, and is refused"
  note "The point of this frame is not the refusal. It is WHERE the refusal came from."
  note "Every denial carries rule_class. Policy refusals say policy; the gateway's own"
  note "checks say something else. That one field is the difference between 'a server"
  note "said no' and 'the attested image said no', and it is machine-readable."
  note ""
  bar "  2a — a refusal we CAN show anyone, right now: the gateway's auth layer"
  local out
  out=$(curl -s --max-time 25 -H "Authorization: Bearer not-a-real-token" \
        "${DEMO_GATEWAY}/account/binance")
  printf '   %s\n' "$out"
  printf '%s' "$out" | python3 -c '
import sys,json
try: d=json.load(sys.stdin)
except Exception: raise SystemExit
rc=d.get("rule_class")
print(f"   -> rule_class = {rc!r}  (this one is the gateway, not the policy)")
' 2>/dev/null
  note ""
  if [ -z "$SIGNER_GATEWAY" ] || [ -z "$SIGNER_TOKEN" ]; then
    stub "2b not run — the over-cap refusal needs the same gateway as frame 1"
    note "Expected shape, from the department report of 2026-08-16:"
    note '   HTTP 403  {"denied":true,"reason_code":"policy_denied","rule_class":"policy",...}'
    note "Side by side with 2a, the contrast is the whole frame: same service, two"
    note "refusals, and the field says which layer decided."
    return 0
  fi
  local body
  body=$(cat <<JSON
{"venue":"${VENUE}","kind":"order","order":{"symbol":"BNB","is_buy":true,"size":"0.050","limit_px":"1","reduce_only":false}}
JSON
)
  out=$(curl -s -w '\n%{http_code}' --max-time 25 -X POST "${SIGNER_GATEWAY}/sign" \
        -H "Authorization: Bearer ${SIGNER_TOKEN}" -H 'content-type: application/json' -d "$body")
  printf '   %s\n' "$(printf '%s' "$out" | sed '$d')"
  note "HTTP $(printf '%s' "$out" | tail -1) — expected 403, rule_class=policy"
}

PCR0_REGISTRY="${PCR0_REGISTRY:-0x38b42eED740b0fDeb211bBDf773F2238cAEec240}"
BASE_RPC="${BASE_RPC:-https://mainnet.base.org}"

run_frame_3() {
  bar "FRAME 3 — a stranger checks the running code themselves"
  note "Nothing here needs an account, a token, or our permission. This is the frame"
  note "the whole product rests on, and it is the only one that works for anyone today."

  local nonce doc
  nonce=$(python3 -c 'import secrets;print(secrets.token_hex(16))')
  note "fresh nonce: ${nonce}   (the document is bound to it, so a replay is visible)"

  doc=$(curl -s -D /tmp/.demo_hdr --max-time 25 "${DEMO_GATEWAY}/attestation?nonce=${nonce}")
  local pcr0
  pcr0=$(printf '%s' "$doc" | python3 -c '
import sys,json
d=json.load(sys.stdin)
print("   pcr0_sha384        :", d.get("pcr0_sha384"), file=sys.stderr)
print("   attestation_doc    : <%d chars of NSM-signed COSE> (not printed)" % len(d.get("attestation_doc_b64") or ""), file=sys.stderr)
print(d.get("pcr0_sha384") or "")
')
  note "cache-control: $(grep -i '^cache-control' /tmp/.demo_hdr | tr -d '\r' | cut -d' ' -f2-)"
  note ""

  # We deliberately do NOT print `registered_onchain` from the response. That field is read
  # from an environment variable on the gateway, so it reports what the operator configured
  # — it is our word about ourselves. The question "is this measurement registered" has an
  # answer that owes us nothing, and this is it.
  note "Is that measurement registered on chain? Ask the registry, not us:"
  printf '   cast call %s "isPCR0Active(bytes)(bool,address)" 0x%s --rpc-url %s\n' \
    "$PCR0_REGISTRY" "$pcr0" "$BASE_RPC"
  if command -v cast >/dev/null 2>&1 && [ -n "$pcr0" ]; then
    cast call "$PCR0_REGISTRY" "isPCR0Active(bytes)(bool,address)" "0x${pcr0}" --rpc-url "$BASE_RPC" \
      2>/dev/null | sed 's/^/   /' \
      || note "(registry call failed — that is a could-not-check, not a false)"
  else
    note "(install foundry to run it here; the command above is the whole check)"
  fi
  note "Both lines matter: false, or a different owner, means stop."
  note ""
  note "⚠️ Read that answer with one fact in hand: the registry keeps ONE active"
  note "measurement PER OWNER, so registering a second enclave under the same owner"
  note "deprecates the first in the same transaction. If this returns false while the"
  note "service is healthy, the likely reason is that another of our lanes currently"
  note "holds the registration — not that the code is unverified. The rebuild check in"
  note "VERIFY-SIGNER-YOURSELF.md does not depend on the registry at all, and that is"
  note "the one we would rather be judged on."
  note ""
  note "What a viewer does next, and what it costs them: rebuild the image from the"
  note "public clone and compare PCR0. That procedure is VERIFY-SIGNER-YOURSELF.md in"
  note "namixai/signer. We do not ask anyone to take the hash on faith — the point of"
  note "the frame is that they do not have to."
  rm -f /tmp/.demo_hdr
}

echo "Usenami Signer — demo, run as a script so it can be re-run"
echo "gateway (public, read-only): ${DEMO_GATEWAY}"

case "$FRAME" in
  1) run_frame_1 ;;
  2) run_frame_2 ;;
  3) run_frame_3 ;;
  all) run_frame_1; run_frame_2; run_frame_3 ;;
  *) echo "unknown frame: $FRAME"; exit 2 ;;
esac

echo
echo "Done. Frames printed STUB above did not run, and the storyboard says what each needs."
