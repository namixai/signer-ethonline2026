#!/usr/bin/env python3
"""Print one PermitSingle digest, computed by path A — nothing else.

    python3 digest_permit_single.py --token 0x… --amount 1 --expiration 2 --nonce 0 \
        --spender 0x… --sig-deadline 2000000000 --chain-id 1 [--swap expiration-nonce]

Exists so `onchain_fieldorder.mjs` can ask OUR encoder for a digest and hand it to the
deployed contract, instead of recomputing it in JavaScript and testing JavaScript against
the chain. The contract is the arbiter of field order; this is the thing being judged.

`--swap` deliberately reverses two fields of the SAME width inside PermitDetails. The type
string, the type hash and every declared width stay correct — only the concatenation order
changes, which is the one defect no type check can see, and the one that rejected a live
Hyperliquid order on 2026-08-15.

Standard library only.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import permit2_ref as ref  # noqa: E402
from keccak_min import keccak256  # noqa: E402


def hash_details_swapped(d: dict) -> bytes:
    """PermitDetails with expiration and nonce transposed. Both are uint48."""
    return keccak256(
        ref.type_hash(ref.TS_PERMIT_DETAILS)
        + ref.enc_address(d["token"])
        + ref.enc_uint(d["amount"])
        + ref.enc_uint(d["nonce"])        # <- these two
        + ref.enc_uint(d["expiration"])   # <- are swapped
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    for f in ("token", "amount", "expiration", "nonce", "spender", "sig-deadline", "chain-id"):
        ap.add_argument(f"--{f}", required=True)
    ap.add_argument("--swap", choices=["expiration-nonce"], default=None)
    a = ap.parse_args()

    details = {"token": a.token, "amount": a.amount, "expiration": a.expiration, "nonce": a.nonce}
    permit = {"details": details, "spender": a.spender, "sigDeadline": a.sig_deadline}

    ds = ref.domain_separator(a.chain_id)
    if a.swap == "expiration-nonce":
        sh = keccak256(
            ref.type_hash(ref.TS_PERMIT_SINGLE)
            + hash_details_swapped(details)
            + ref.enc_address(permit["spender"])
            + ref.enc_uint(permit["sigDeadline"])
        )
    else:
        sh = ref.hash_permit_single(permit)

    print("0x" + ref.digest(ds, sh).hex())
    return 0


if __name__ == "__main__":
    sys.exit(main())
