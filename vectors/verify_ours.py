#!/usr/bin/env python3
"""Path A runner: recompute every digest in permit2-vectors.json with our own code.

    python3 verify_ours.py            # verify against the pinned file
    python3 verify_ours.py --emit     # regenerate the file from the case list

No network, no third-party packages, no Ethereum library. Exit code 0 = every
pinned digest reproduced; 1 = at least one did not.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import permit2_ref as ref  # noqa: E402
from keccak_min import keccak256  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
VECTORS = os.path.join(HERE, "permit2-vectors.json")


def h(b: bytes) -> str:
    return "0x" + b.hex()


def compute(case: dict) -> dict:
    """Everything a verifier can derive from a case's inputs. Both paths must agree
    on every key here, not just on the final digest — a digest can match while an
    intermediate is wrong only by coincidence, and we would rather see the coincidence."""
    chain_id = case["chainId"]
    ds = ref.domain_separator(chain_id, case.get("verifyingContract", ref.PERMIT2_ADDRESS))
    out = {"domainSeparator": h(ds)}
    kind = case["kind"]
    m = case["message"]

    if kind == "PermitSingle":
        out["hashPermitDetails"] = h(ref.hash_permit_details(m["details"]))
        sh = ref.hash_permit_single(m)
    elif kind == "PermitBatch":
        out["hashPermitDetails"] = [h(ref.hash_permit_details(d)) for d in m["details"]]
        sh = ref.hash_permit_batch(m)
    elif kind == "PermitTransferFrom":
        out["hashTokenPermissions"] = h(ref.hash_token_permissions(m["permitted"]))
        sh = ref.hash_permit_transfer_from(m, case["spender"])
    elif kind == "PermitBatchTransferFrom":
        out["hashTokenPermissions"] = [h(ref.hash_token_permissions(t)) for t in m["permitted"]]
        sh = ref.hash_permit_batch_transfer_from(m, case["spender"])
    elif kind == "PermitWitnessTransferFrom":
        w = ref.hash_swap_intent(case["witness"])
        out["hashTokenPermissions"] = h(ref.hash_token_permissions(m["permitted"]))
        out["witness"] = h(w)
        out["witnessTypeHash"] = h(
            ref.witness_type_hash(ref.STUB_WITNESS_SINGLE, case["witnessTypeString"])
        )
        sh = ref.hash_permit_witness_transfer_from(m, case["spender"], w, case["witnessTypeString"])
    elif kind == "PermitBatchWitnessTransferFrom":
        w = ref.hash_swap_intent(case["witness"])
        out["hashTokenPermissions"] = [h(ref.hash_token_permissions(t)) for t in m["permitted"]]
        out["witness"] = h(w)
        out["witnessTypeHash"] = h(
            ref.witness_type_hash(ref.STUB_WITNESS_BATCH, case["witnessTypeString"])
        )
        sh = ref.hash_permit_batch_witness_transfer_from(
            m, case["spender"], w, case["witnessTypeString"]
        )
    else:
        raise ValueError(f"unknown kind: {kind}")

    out["hashStruct"] = h(sh)
    out["digest"] = h(ref.digest(ds, sh))
    return out


def load_cases():
    with open(os.path.join(HERE, "cases.json"), encoding="utf-8") as f:
        return json.load(f)


def emit():
    doc = load_cases()
    for case in doc["cases"]:
        case["expected"] = compute(case)
    doc["typeHashes"] = {
        "PermitDetails": h(ref.type_hash(ref.TS_PERMIT_DETAILS)),
        "PermitSingle": h(ref.type_hash(ref.TS_PERMIT_SINGLE)),
        "PermitBatch": h(ref.type_hash(ref.TS_PERMIT_BATCH)),
        "TokenPermissions": h(ref.type_hash(ref.TS_TOKEN_PERMISSIONS)),
        "PermitTransferFrom": h(ref.type_hash(ref.TS_PERMIT_TRANSFER_FROM)),
        "PermitBatchTransferFrom": h(ref.type_hash(ref.TS_PERMIT_BATCH_TRANSFER_FROM)),
        "EIP712Domain(3-field)": h(ref.type_hash(ref.TS_EIP712_DOMAIN_3)),
        "SwapIntent": h(ref.type_hash(ref.TS_SWAP_INTENT)),
    }
    with open(VECTORS, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {VECTORS} ({len(doc['cases'])} cases)")


def verify() -> int:
    if not os.path.exists(VECTORS):
        print(f"FAIL: {VECTORS} is missing — run with --emit first", file=sys.stderr)
        return 1
    with open(VECTORS, encoding="utf-8") as f:
        doc = json.load(f)

    # keccak first: if the primitive is wrong every line below it is meaningless.
    if keccak256(b"").hex() != "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470":
        print("FAIL: keccak256 golden vector mismatch", file=sys.stderr)
        return 1

    bad = 0
    for case in doc["cases"]:
        got = compute(case)
        want = case["expected"]
        for key in sorted(set(got) | set(want)):
            if got.get(key) != want.get(key):
                bad += 1
                print(f"MISMATCH {case['id']}.{key}\n  pinned {want.get(key)}\n  ours   {got.get(key)}")
    for name, want in doc.get("typeHashes", {}).items():
        attr = {
            "PermitDetails": ref.TS_PERMIT_DETAILS,
            "PermitSingle": ref.TS_PERMIT_SINGLE,
            "PermitBatch": ref.TS_PERMIT_BATCH,
            "TokenPermissions": ref.TS_TOKEN_PERMISSIONS,
            "PermitTransferFrom": ref.TS_PERMIT_TRANSFER_FROM,
            "PermitBatchTransferFrom": ref.TS_PERMIT_BATCH_TRANSFER_FROM,
            "EIP712Domain(3-field)": ref.TS_EIP712_DOMAIN_3,
            "SwapIntent": ref.TS_SWAP_INTENT,
        }[name]
        got = h(ref.type_hash(attr))
        if got != want:
            bad += 1
            print(f"MISMATCH typeHash.{name}\n  pinned {want}\n  ours   {got}")

    if bad:
        print(f"\nFAIL — {bad} mismatch(es). This is a finding, not a nit.")
        return 1
    n = len(doc["cases"])
    print(f"OK — path A (ours, stdlib only) reproduced {n} cases and "
          f"{len(doc.get('typeHashes', {}))} type hashes.")
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--emit", action="store_true", help="regenerate permit2-vectors.json")
    args = ap.parse_args()
    if args.emit:
        emit()
    else:
        sys.exit(verify())
