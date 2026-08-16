#!/usr/bin/env python3
"""Prove the position-NFT vector set can fail.

    python3 falsify_nft.py     # exit 0 means every mutation was caught

Each mutation is a mistake someone actually makes when one codebase has to sign for two
Uniswap contracts that share a type hash and disagree about their domain.

No network, no third-party packages.
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import nft_permit_ref as ref  # noqa: E402
import verify_nft_ours as runner  # noqa: E402

doc = json.load(open(os.path.join(HERE, "nft-permit-vectors.json"), encoding="utf-8"))
CASES = {c["id"]: c for c in doc["cases"]}

checks = []


def record(name, caught, detail):
    checks.append((name, caught))
    print(f"{'CAUGHT ' if caught else 'MISSED '} {name}\n         -> {detail}")


def mutate(name, case_id, apply_patch, undo_patch):
    pinned = CASES[case_id]["expected"]["digest"]
    apply_patch()
    try:
        got = runner.compute(CASES[case_id])["digest"]
    finally:
        undo_patch()
    record(name, got != pinned, got)


# 1. The headline mistake: sign a v4 permit against the v3 domain. One shared builder,
#    two contracts, and the type hash check that would "catch" it passes.
v3 = CASES["v3-permit-mainnet-to-universalrouter"]
v4 = CASES["v4-permit-mainnet-same-message-as-v3"]
wrong = dict(v4)
wrong["kind"] = "V3Permit"
wrong["domain"] = {"name": "Uniswap v4 Positions NFT", "version": "1"}
record(
    "v4 message signed under a 4-field domain (version added)",
    runner.compute(wrong)["digest"] != v4["expected"]["digest"],
    runner.compute(wrong)["digest"],
)

# 2. And the reverse: v3 message under v4's 3-field domain.
wrong2 = dict(v3)
wrong2["kind"] = "V4Permit"
wrong2["domain"] = {"name": "Uniswap V3 Positions NFT-V1"}
record(
    "v3 message signed under a 3-field domain (version dropped)",
    runner.compute(wrong2)["digest"] != v3["expected"]["digest"],
    runner.compute(wrong2)["digest"],
)

# 3. Right shape, wrong verifyingContract — v3's message aimed at the v4 contract.
wrong3 = dict(v3)
wrong3["verifyingContract"] = "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e"
record(
    "correct domain shape, wrong verifyingContract",
    runner.compute(wrong3)["digest"] != v3["expected"]["digest"],
    runner.compute(wrong3)["digest"],
)

# 4. The nonce the signer could not verify. v3 reads it from chain state, so an
#    off-by-one is the most likely real-world error and it must move the digest.
wrong4 = json.loads(json.dumps(v3))
wrong4["message"]["nonce"] = "1"
record(
    "v3 nonce off by one (it comes from chain state, not from us)",
    runner.compute(wrong4)["digest"] != v3["expected"]["digest"],
    runner.compute(wrong4)["digest"],
)

# 5. `approved` flipped. If this did not move the digest, a revocation and a blanket
#    grant would be the same signature.
pf_true = CASES["v4-permitForAll-approved-true-UNBOUNDED"]
wrong5 = json.loads(json.dumps(pf_true))
wrong5["message"]["approved"] = "false"
record(
    "PermitForAll approved flipped true -> false",
    runner.compute(wrong5)["digest"] != pf_true["expected"]["digest"],
    runner.compute(wrong5)["digest"],
)

# 6. Permit and PermitForAll must not collide. They have the same arity and two shared
#    field names; only the type hash separates them.
mutate(
    "PermitForAll hashed under the Permit type hash",
    "v4-permitForAll-approved-true-UNBOUNDED",
    lambda: setattr(ref, "TS_PERMIT_FOR_ALL", ref.TS_PERMIT),
    lambda: setattr(
        ref,
        "TS_PERMIT_FOR_ALL",
        "PermitForAll(address operator,bool approved,uint256 nonce,uint256 deadline)",
    ),
)

# 6b. Two uint256 fields transposed. In Permit(spender, tokenId, nonce, deadline) three of
#     the four are uint256, so a transposition is invisible to every type-level check — the
#     same shape as the field-order defect that got a live Hyperliquid order rejected.
orig_permit = ref.hash_permit


def transposed_permit(m):
    from keccak_min import keccak256 as k
    return k(
        ref.type_hash(ref.TS_PERMIT)
        + ref.enc_address(m["spender"])
        + ref.enc_uint(m["nonce"])      # <- tokenId and nonce
        + ref.enc_uint(m["tokenId"])    # <- are transposed
        + ref.enc_uint(m["deadline"])
    )


mutate("tokenId/nonce transposed (both uint256, invisible to types)",
       "v3-permit-nonce-not-zero",
       lambda: setattr(ref, "hash_permit", transposed_permit),
       lambda: setattr(ref, "hash_permit", orig_permit))

# 7. The on-chain anchor itself must bite. Corrupt the pinned separator and the runner has
#    to notice — otherwise "we checked against the deployed contract" is decoration.
#
#    🔴 The first version of this mutation edited the dict in memory and reported MISSED.
#    The runner was fine; the test was wrong — verify() re-reads the file from disk, so it
#    never saw the corruption. Worth leaving the note: a falsification that fakes the
#    defect in the wrong place proves nothing, and it fails in the reassuring direction
#    only by luck. It has to go through the same door the real thing would.
import contextlib  # noqa: E402
import io  # noqa: E402

VEC = os.path.join(HERE, "nft-permit-vectors.json")
original = open(VEC, encoding="utf-8").read()
try:
    corrupt = json.loads(original)
    for c in corrupt["cases"]:
        if c["id"] == "v3-permit-mainnet-to-universalrouter":
            c["onchainDomainSeparator"] = "0x" + "11" * 32
    with open(VEC, "w", encoding="utf-8") as f:
        json.dump(corrupt, f, indent=2, ensure_ascii=False)
        f.write("\n")
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = runner.verify()
finally:
    with open(VEC, "w", encoding="utf-8") as f:
        f.write(original)
record("corrupted on-chain domain anchor", rc != 0, f"verify() returned {rc}")

# And the restore must have worked, or the next run inherits a corrupted file.
assert open(VEC, encoding="utf-8").read() == original, "failed to restore the vector file"

missed = [n for n, ok in checks if not ok]
print()
if missed:
    print(f"FAIL — {len(missed)} mutation(s) went undetected: {', '.join(missed)}")
    sys.exit(1)
print(f"OK — all {len(checks)} mutations changed a pinned value. The set bites.")
