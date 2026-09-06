# Feedback on building with Uniswap Permit2

Written while integrating Permit2 into a signing service during ETHOnline 2026. We build an
AWS Nitro enclave that holds an agent's key and applies the owner's policy before a
signature exists, so our contact with Permit2 is narrow and specific: we construct the
EIP-712 digest, decide whether policy allows it, and we needed to be certain the digest is
right before anything signs it.

Everything below is something we hit while building, with the check we used. Dates and
addresses are given so a reader can tell what was current: **4 September 2026**.

---

## The short version

**Permit2's typed data has three details that each produce a signature which looks correct,
verifies as well-formed, and is rejected on chain.** None of them raises an error where the
mistake is made. We hit all three, and the failure mode was the same every time: a valid
signature over the wrong bytes.

The three are listed below. If only one thing from this document is worth acting on, it is
the first — because its on-chain rejection actively points away from the cause.

---

## 1. The domain has three fields, and `InvalidSigner` sends you looking at your key

Permit2's EIP-712 domain is:

```text
EIP712Domain(string name,uint256 chainId,address verifyingContract)
name = "Permit2"
```

There is **no `version` field**. Nearly every other contract we integrate uses the
four-field domain, so the natural move — reuse the domain helper that already works — is
wrong here, and wrong silently.

**What makes this expensive is the error, not the mistake.** A wrong domain separator
produces a signature that recovers to a different address, and the contract reverts with
`InvalidSigner`. Read literally, that says "the signer is not who you claim" — so the first
hour goes into the key, the account, the chain id, and the address derivation. The domain is
the last place you look, because the signature verified fine locally.

**What would help.** A sentence in the Permit2 docs saying the domain is three-field and
naming `InvalidSigner` as its symptom. One line would have saved us that hour, and we
expect it is a common hour.

## 2. A nested struct enters as its own hash, and the type string is a concatenation

```text
PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)

PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)
```

Two rules apply at once and both are easy to half-apply: referenced types are appended to
the primary type, sorted by name; and a struct-typed member encodes as `hashStruct(member)`,
**not** as its fields inline.

This one is in EIP-712 rather than in Permit2, and the spec does state it. But it is the
step where a hand-written implementation most often diverges, and the divergence is again
silent.

## 3. `uint160` and `uint48` still occupy a full 32-byte word

EIP-712 encodes every integer as 32 bytes big-endian regardless of declared width. Packing
`amount` into 20 bytes because the type says `uint160` yields a different hash and no error
anywhere.

We caught this one only because a test asserted the digest against an independently
computed value. It is worth saying plainly: **`uint160` in the type string is a constraint
on the value, not on the encoding.**

---

## What we did about it, in case the approach is useful

We wrote the digest construction with vectors that can be checked without a transaction,
an account, or a testnet — the domain separator is readable straight from the deployed
contract:

```bash
# Use the RPC of the chain you will actually sign for — the separator is chain-specific.
RPC=https://mainnet.base.org
cast call 0x000000000022D473030F116dDEE9F6B43aC78BA3 "DOMAIN_SEPARATOR()(bytes32)" --rpc-url "$RPC"
cast chain-id --rpc-url "$RPC"   # must equal the chainId you put in your own domain
```

Comparing that against a locally computed separator is a five-second check that catches
trap 1 outright, and it needs nothing from anyone.

⚠️ **Query the chain you are signing for, not mainnet.** `DOMAIN_SEPARATOR()` is built from
`block.chainid`, so each deployment returns a different value and a mainnet answer proves
nothing about a Base signature. Measured on 4 September 2026, same address on all three:

```text
Ethereum     chainId 1      0x866a5aba21966af9…
Base         chainId 8453   0x3b6f35e4fce979ef…
World Chain  chainId 480    0x7bbefd3f28aeae36…
```

We only noticed because we cross-checked the chain id rather than assuming the address
being identical meant the answer would be. **This is worth a line in the docs**: the
constant address is exactly what makes it easy to forget the separator is not constant.

**We also kept a negative control**, which we would recommend to anyone doing this: sign the
same payload under a deliberately *wrong* domain and assert the digest differs. A test that
only asserts the right answer passes just as happily when both sides share the same mistake.

---

## A design note, offered as a question rather than a complaint

An infinite allowance in Permit2 is `type(uint160).max`. In our policy layer we refuse it
**regardless of the configured amount cap**, and the reasoning may be worth sharing: if
infinite were merely "a very large number" subject to the cap, then an owner who sets a high
ceiling silently loses the protection — exactly the owner with the most at stake. Treating
it as its own category rather than an extreme of a continuum turned out to matter.

We are not suggesting the protocol should change; `uint160.max` as the sentinel is clear and
checkable. It is the integrator-side conclusion we would have liked to read somewhere.

---

## What worked well

- **The same address wherever it is deployed** (`0x000000000022D473030F116dDEE9F6B43aC78BA3`,
  CREATE2). Deployment addresses that differ per network are a steady source of
  misconfiguration, and not having that problem is worth more than it sounds.

  ⚠️ We first wrote "on every chain" here, and that claims more than CREATE2 gives. Per
  EIP-1014 the address is derived from **three** inputs — the deployer address, the salt,
  and the hash of the init code — so keeping all three identical is what reproduces the
  address on another chain. It is a recipe, not a guarantee that anyone has followed it:
  someone still has to deploy. Confirm before you rely on it —
  `cast code 0x000000000022D473030F116dDEE9F6B43aC78BA3 --rpc-url "$RPC"` returning `0x`
  means it is not there.
- **`DOMAIN_SEPARATOR()` is public.** Being able to check our construction against the
  contract, with no key and no transaction, is what made trap 1 findable at all.
- **The separation of allowance from transfer** is the property our product depends on: an
  agent can be permitted a bounded amount with an expiry, without handing over an
  open-ended approval. That shape is what let us apply a policy before a signature exists
  rather than after a transaction.

---

## What this document does not claim

We integrated the **digest construction and the policy checks that precede signing**. We are
not claiming a full Permit2 integration, and specifically not that our enclave signs Permit2
payloads today — that needs a signing action inside the attested image which does not exist
yet. The vectors and the checks are real and runnable; the signing is not there, and we
would rather say so here than have it inferred.
