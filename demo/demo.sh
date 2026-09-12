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
# 🔴 SECRETS, and the correction that matters. This script never prints a token it SENDS
# — that was always true and it was never the risk. The dangerous credential travels the
# other way: in the default mode the client is the one who submits the order, so `/sign`
# answers with a `headers` map carrying the venue key (`X-MBX-APIKEY`, `KC-API-SIGN`, and
# on OKX the passphrase). The old filter hid four field NAMES and printed everything else,
# so those headers went to the screen we were about to film — and the one field it did
# name, `signature`, printed too, because it is an object and the guard began with
# `isinstance(v, str)`. Every response body now goes through `redact.py`, which prints an
# ALLOW-list and hides the rest; run `./precheck.sh` before filming and read its verdict.
# If a frame cannot run, it says so loudly and keeps going; it never quietly skips,
# because a demo that silently drops its hardest frame is a demo that lies by omission.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
# Единственное место, где тело ответа превращается в строки на экране.
REDACT="$HERE/redact.py"

DEMO_GATEWAY="${DEMO_GATEWAY:-https://signer-demo.usenami.io:8443}"
# Frames 1-2 need a gateway with an armed venue and a token for it. Neither is public.
SIGNER_GATEWAY="${SIGNER_GATEWAY:-}"
SIGNER_TOKEN="${SIGNER_TOKEN:-}"
VENUE="${VENUE:-hyperliquid_testnet}"

FRAME="${2:-all}"
[ "${1:-}" = "--frame" ] || FRAME=all

# 🔴 PACING IS OFF BY DEFAULT, and that is the point. A demo that sleeps for a stranger
# who just wants the output wastes their time; a demo recorded at machine speed is
# unreadable on camera. So the pause is a knob, the default is zero, and the recording is
# a REAL run with the knob turned up — not a fast run with timings painted on afterwards.
# python3 is already a hard dependency of this script (checked below), so no new one.
PAUSE_MS="${DEMO_PAUSE_MS:-0}"
pause() { [ "${PAUSE_MS}" -gt 0 ] 2>/dev/null && python3 -c "import time,sys; time.sleep(int(sys.argv[1])/1000)" "${1:-$PAUSE_MS}" || true; }

bar() { printf '\n\033[1m── %s\033[0m\n' "$1"; pause $((PAUSE_MS * 3)); }
note() { printf '   %s\n' "$1"; pause; }
stub() { printf '\n\033[1;33m── STUB: %s\033[0m\n' "$1"; pause $((PAUSE_MS * 2)); }

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
  printf '%s' "$out" | sed '$d' | python3 "$REDACT"
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
  printf '%s' "$out" | python3 "$REDACT"
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
  printf '%s' "$out" | sed '$d' | python3 "$REDACT"
  note "HTTP $(printf '%s' "$out" | tail -1) — expected 403, rule_class=policy"
}

PCR0_REGISTRY="${PCR0_REGISTRY:-0x38b42eED740b0fDeb211bBDf773F2238cAEec240}"
BASE_RPC="${BASE_RPC:-https://mainnet.base.org}"

run_frame_3() {
  bar "FRAME 3 — a stranger checks the running code themselves"
  note "Nothing here needs an account, a token, or our permission. This is the frame"
  note "the whole product rests on, and it is the only one that works for anyone today."

  local nonce body
  nonce=$(python3 -c 'import secrets;print(secrets.token_hex(16))')
  note "fresh nonce: ${nonce}   (the document is bound to it, so a replay is visible)"

  # 🔴 A PRIVATE temp file now. The old fixed path under /tmp, in a world-writable
  # directory, is a pre-created file or a symlink waiting to happen, and two runs of this
  # script at once quietly read each other's headers. `mktemp` plus a trap costs one line,
  # and the trap means the cleanup no longer has to be repeated at every `return`.
  local hdr
  hdr=$(mktemp -t demo_hdr) || { stub "frame 3 not run — mktemp failed"; return 0; }
  trap 'rm -f "$hdr"' RETURN
  body=$(curl -s -D "$hdr" --max-time 25 "${DEMO_GATEWAY}/attestation?nonce=${nonce}")
  note "cache-control: $(grep -i '^cache-control' "$hdr" | tr -d '\r' | cut -d' ' -f2-)"
  note ""

  # 🔴 THE PCR0 NOW COMES OUT OF THE SIGNED DOCUMENT, AND IT USED TO NOT.
  #
  # This block read `pcr0_sha384` from the JSON body and handed that to the registry. That
  # field is written by our own gateway. So the one step this frame rests on compared a
  # number we typed against a registration we made, while the hardware signature sat in
  # `attestation_doc_b64` with only its LENGTH printed and its bytes never opened. The
  # frame claimed "a stranger checks the running code themselves", and at that step it
  # was not true. The nonce was in the same condition: the line above says the document
  # is bound to it, and nothing checked that either.
  #
  # attest-verify.py opens the COSE document: ES384 over the COSE Sig_structure against
  # the leaf certificate, the certificate chain, and the nonce inside the document
  # against the one we just sent. The JSON field becomes a CROSS-CHECK that can go red
  # rather than the source of the answer. If any check fails it prints no PCR0 and the
  # registry is not asked — a document we could not authenticate must not be able to
  # fetch itself a `true`.
  printf '%s' "$body" | python3 "$HERE/attest-verify.py" --nonce "${nonce}"
  local pcr0 verdict
  pcr0=$(printf '%s' "$body" | python3 "$HERE/attest-verify.py" --nonce "${nonce}" --pcr0-only 2>/dev/null)
  verdict=$?
  note ""
  if [ -z "$pcr0" ]; then
    # 🔴 A could-not-check is not a false, and the two must not print the same sentence.
    # Conflating them is how a missing openssl turns into "the enclave failed", and how a
    # real failure hides behind "probably just tooling".
    if [ "$verdict" = "2" ]; then
      stub "could not check the document here — this is NOT a verdict on the enclave"
      note "The verifier needs openssl and a readable body; one of those was missing. The"
      note "registry is not asked, because the PCR0 to ask about was never authenticated."
    else
      stub "the document DID NOT VERIFY — the registry is NOT being asked"
      note "A red check above is this frame's answer, not a reason to skip it. Asking the"
      note "registry about a PCR0 we could not authenticate would print a true that means"
      note "nothing."
    fi
    return 0
  fi

  # 🔴 This comment used to say we deliberately do not print `registered_onchain` from the
  # response. Measured against the live endpoint on 12.09, the response carries exactly
  # three fields — `attestation_doc_b64`, `pcr0_sha384`, `timestamp_ms` — and no
  # `registered_onchain` at all, so there was nothing left to decline to print. The reason
  # outlives the field and is why the next line exists: any such flag would be read from
  # the gateway's own configuration, making it our word about ourselves. The question "is
  # this measurement registered" has an answer that owes us nothing, and this is it.
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
  note "Both lines matter, and both are yours to read: the chain answers true or false,"
  note "and the address next to it says whose registration that is. A true under an"
  note "owner you do not recognise is not a pass."
  note ""
  note "⚠️ If you see false, that is worth a sentence rather than alarm: the registry"
  note "keeps ONE active measurement PER OWNER, so registering a second enclave under"
  note "the same owner deprecates the first in the same transaction. A false beside a"
  note "healthy service usually means another of our lanes holds the registration at"
  note "that moment, not that the code is unverified. This text has said false was the"
  note "expected answer here, because for a stretch it was — it is not a promise that"
  note "it will be, and the registry is the thing to believe, not this paragraph."
  note ""
  note "🔴 And the check we would rather be judged on does not use the registry at all:"
  note "rebuild the image from the public clone and compare the measurement yourself."
  note ""
  note "What a viewer does next, and what it costs them: rebuild the image from the"
  note "public clone and compare PCR0. That procedure is VERIFY-SIGNER-YOURSELF.md in"
  note "namixai/signer. We do not ask anyone to take the hash on faith — the point of"
  note "the frame is that they do not have to."
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
