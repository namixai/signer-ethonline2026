#!/usr/bin/env python3
"""Prove the vector set can fail.

A cross-check that has never been seen to go red is not evidence of anything. Each
mutation below is a real mistake an implementer makes — the near-universal 4-field
domain, a field order taken from an SDK object instead of the type string, a uint48
"optimised" to its declared width, the single-transfer witness stub reused for a
batch. Every one of them must change a pinned digest.

    python3 falsify.py     # exit 0 means every mutation was caught

No network, no third-party packages.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import permit2_ref as ref  # noqa: E402
import verify_ours  # noqa: E402
from keccak_min import keccak256  # noqa: E402

doc = json.load(open(os.path.join(HERE, "permit2-vectors.json"), encoding="utf-8"))
CASES = {c["id"]: c for c in doc["cases"]}


def digest_of(case_id: str) -> str:
    """Recompute one case through the current (possibly mutated) module.

    `verify_ours` holds the same module object as `ref`, so setattr on `ref`
    is visible here — that is what makes the mutations below take effect.
    """
    return verify_ours.compute(CASES[case_id])["digest"]


checks = []


def mutation(name, case_id, apply_patch, undo_patch):
    pinned = CASES[case_id]["expected"]["digest"]
    apply_patch()
    try:
        got = digest_of(case_id)
    finally:
        undo_patch()
    caught = got != pinned
    checks.append((name, caught, got))
    print(f"{'CAUGHT ' if caught else 'MISSED '} {name}\n         -> {got}")


# 1. The four-field domain. Every other contract has `version`; Permit2 does not.
orig_domain = ref.domain_separator


def bad_domain(chain_id, verifying_contract=ref.PERMIT2_ADDRESS):
    ts = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    return keccak256(
        ref.type_hash(ts)
        + keccak256(b"Permit2")
        + keccak256(b"1")
        + ref.enc_uint(chain_id)
        + ref.enc_address(verifying_contract)
    )


mutation("4-field domain (adds `version`)", "allowance-single-mainnet-regression",
         lambda: setattr(ref, "domain_separator", bad_domain),
         lambda: setattr(ref, "domain_separator", orig_domain))

# 2. Field order taken from an object literal instead of the type string.
orig_single = ref.hash_permit_single


def swapped_single(p):
    return keccak256(
        ref.type_hash(ref.TS_PERMIT_SINGLE)
        + ref.hash_permit_details(p["details"])
        + ref.enc_uint(p["sigDeadline"])      # swapped
        + ref.enc_address(p["spender"])       # swapped
    )


mutation("spender/sigDeadline order swapped", "allowance-single-mainnet-regression",
         lambda: setattr(ref, "hash_permit_single", swapped_single),
         lambda: setattr(ref, "hash_permit_single", orig_single))

# 3. uint48 packed to its declared width instead of a full word.
orig_details = ref.hash_permit_details


def packed_details(d):
    def narrow(v, n):
        return int(v).to_bytes(n, "big")
    return keccak256(
        ref.type_hash(ref.TS_PERMIT_DETAILS)
        + ref.enc_address(d["token"])
        + narrow(d["amount"], 20)        # uint160 "optimised" to 20 bytes
        + narrow(d["expiration"], 6)     # uint48 "optimised" to 6 bytes
        + narrow(d["nonce"], 6)
    )


mutation("uint160/uint48 packed to declared width", "allowance-single-mainnet-regression",
         lambda: setattr(ref, "hash_permit_details", packed_details),
         lambda: setattr(ref, "hash_permit_details", orig_details))

# 4. Batch witness built on the single-transfer stub.
orig_stub = ref.STUB_WITNESS_BATCH
mutation("batch witness built on the single stub", "sigtransfer-witness-batch-base",
         lambda: setattr(ref, "STUB_WITNESS_BATCH", ref.STUB_WITNESS_SINGLE),
         lambda: setattr(ref, "STUB_WITNESS_BATCH", orig_stub))

# 5. SignatureTransfer signed against the wrong spender. One address off and the
#    permit authorises a different contract entirely — the digest must move.
case = CASES["sigtransfer-single-base-nonce-word1"]
other = dict(case)
other["spender"] = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af"  # mainnet router, wrong chain
moved = verify_ours.compute(other)["digest"] != case["expected"]["digest"]
checks.append(("spender substituted", moved, verify_ours.compute(other)["digest"]))
print(f"{'CAUGHT ' if moved else 'MISSED '} spender substituted\n         -> "
      f"{verify_ours.compute(other)['digest']}")

# 6. The one that already bit us: JSON numbers on the JavaScript side.
u160 = 1461501637330902918203684832716283019655932542975
lossy = int(float(u160))
checks.append(("JSON double round-trip of type(uint160).max", lossy != u160, str(lossy)))
print(f"{'CAUGHT ' if lossy != u160 else 'MISSED '} JSON double round-trip of "
      f"type(uint160).max\n         -> {lossy} (exact: {u160})")

missed = [n for n, ok, _ in checks if not ok]
print()
if missed:
    print(f"FAIL — {len(missed)} mutation(s) went undetected: {', '.join(missed)}")
    sys.exit(1)
print(f"OK — all {len(checks)} mutations changed a pinned value. The vector set bites.")
