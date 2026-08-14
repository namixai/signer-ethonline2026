# Permit2 test vectors — two independent paths, one chain anchor

Every digest in `permit2-vectors.json` is computed twice by code that shares nothing,
and the two results are compared. A disagreement is a finding: it means one of the two
readings of Permit2 is wrong, and the way to settle it is to go back to the contract,
not to pick a favourite.

## Run it

```bash
python3 verify_ours.py     # path A — our own encoder, standard library only
python3 falsify.py         # six deliberate defects; every one must be caught
npm ci && node verify_sdk.mjs   # path B — Uniswap's own SDK, plus viem
./anchor_onchain.sh        # optional, needs network + foundry: ask the deployed contracts
```

The first two need nothing but Python 3. No network, no packages, no Ethereum library.
`npm ci` needs the network once; after that path B runs offline too.

## Why the paths are actually independent

**Path A** (`permit2_ref.py`, `keccak_min.py`) implements EIP-712 encoding by hand. The
only borrowed primitive is keccak256, and that one is written from the Keccak permutation
and pinned to golden vectors including the 136-byte rate boundary. Nothing here has ever
seen an Ethereum library.

**Path B** (`verify_sdk.mjs`) runs `@uniswap/permit2-sdk`, which brings **its own type
definitions**. This is the part that matters: if we misread a field order, an integer
width, or a type name out of `PermitHash.sol`, path A would be confidently and
consistently wrong, and only a source that doesn't share our reading can say so. `viem`
is there as a third encoder over the same types, to separate "we misread the contract"
from "we wrote a broken encoder".

**The anchor** (`anchor_onchain.sh`) asks the deployed contracts for their domain
separators and for the address of the PoolManager the router is wired to. Two
implementations agreeing with each other is not the same as agreeing with the chain.

## What the cases cover

Eleven cases across both halves of Permit2 — `PermitSingle`, `PermitBatch`,
`PermitTransferFrom`, `PermitBatchTransferFrom` and both witness variants, on chain 1 and
on Base. Each carries a `why` field saying which mistake it exists to catch. Highlights:

- the vector published in our Permit2 spec on 2026-08-05, unchanged, as a regression anchor;
- `amount = type(uint160).max`, where `AllowanceTransfer._transfer` stops decrementing;
- `expiration = 0`, which is the *safest* value and not the most dangerous;
- a nonce outside word 0 of the unordered bitmap;
- the batch witness stub, which is a different string from the single one.

## One thing the file format itself got wrong

All integers are decimal **strings**, and that is not stylistic. JSON numbers are IEEE-754
doubles in JavaScript:

```
type(uint160).max = 1461501637330902918203684832716283019655932542975
JSON.parse gives    1461501637330902918203684832716283019655932542976
```

One too many. Python reads the same literal exactly, so the two paths were quietly
checking different numbers — and the damage landed on the one value that decides whether
a Permit2 approval is infinite or merely large. Path B caught it on its first run, which
is the entire point of having a path B. `falsify.py` keeps a check on it.

## Provenance

Sources read to build this, pinned by commit:

| repo | commit |
|---|---|
| `Uniswap/permit2` | `cc56ad0f3439c502c246fc5cfcc3db92bb8b7219` |
| `Uniswap/universal-router` | `fb25ff09c71dcfc13665e6c65788db737f29e0d4` |
| `Uniswap/v4-core` | `46c6834698c48bc4a463a86d8420f4eb1d7f3b75` |
| `Uniswap/v4-periphery` | `07336f2144f522874e2c3c85e04d1d3f8d5fa471` |

Deployed addresses and codehashes, checked on 2026-08-14, are in `addresses.json`.
`package-lock.json` pins path B at `@uniswap/permit2-sdk` 1.3.0, `viem` 2.21.55,
`ethers` 5.8.0.
