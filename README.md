# Usenami Signer × ETHOnline 2026 — submission repository

Continuity track ("Extend Open Source"). This repository holds the work of the event
window plus the specs, plans and prompts it is built from. The product it extends —
Usenami Signer — is older than the hackathon and lives at
[namixai/signer](https://github.com/namixai/signer).

## What Signer is, in one paragraph

One endpoint. An agent brings a ready order from some protocol, an AWS Nitro enclave
checks it against the owner's policy, and either signs it or refuses. We don't build a
DEX, we don't route trades, we don't invent a protocol. The claim is narrower than that
and it is checkable: the agent's key is physically out of reach, and limits are applied
before a signature exists. On existing protocols, without changing them.

## What was done before 4 September

Read this section first if you are judging the submission. It is the answer to "how much of
this is pre-existing", and we would rather state it than have you reconstruct it.

**The product existed before the event and is not claimed as hackathon work.** The enclave,
the reproducible build and its attestation, EIP-712 signing for Hyperliquid, and
policy-applied-before-signature on CEX venues were all built between May and July 2026.
They are public and independently checkable at
[namixai/signer](https://github.com/namixai/signer).

**And the signing path has now run end to end on a real venue.** On 16 August 2026, against
a policy compiled into the enclave image and covered by its attestation, the enclave signed
an order of 0.010 BNB under a 0.041 cap and refused one of 0.050 with `policy_denied`. Later
the same day Hyperliquid accepted an order signed by the enclave and accepted the cancel
afterwards. The order rested and never filled: this was a liveness test, not a trade.

The key is generated inside the enclave and leaves it only as a KMS-wrapped blob that
nothing but the enclave can open. One human action sits in the path and we are not going to
write around it — the account had to approve the enclave's address once, on chain, before
the venue would accept anything it signed. After that approval no human approved the order
and no human touched the key.

**What that is not.** Our own account and our own money, so nobody has trusted us with
theirs yet. No external audit. Order signing has run on three venues, not the same kind of
proof on each: Binance Futures since 27 July and Hyperliquid since 16 August both have a
completed round trip — entry filled, position closed. OKX, since 18 August, has a signed
order accepted into the book and cancelled — not a completed trade. That is the whole list,
and the three are not interchangeable in a sentence. First only in the sense of our own
first; the rules we hold ourselves to are in `CONTINUITY.md`, and one of them forbids the
other reading.

Nothing here is renamed or backdated. The Continuity track allows pre-existing work;
concealing it would be both a rule violation and a pointless one, since commit dates outlive
explanations. `CONTINUITY.md` carries the full component-by-component table and is updated
whenever the composition changes — not assembled before the deadline.

## What's here today

```
CONTINUITY.md  component-by-component: what predates the event, what is written in it
AI-USE.md      where AI was used, and how the prompts are published
specs/         protocol specs read from source, each pinned to a commit
vectors/       Permit2 test vectors, two independent paths + an on-chain anchor
plans/         PLAN.md, and prompts/ — the prompts the AI actually ran on
scripts/       scrub-check.sh, the hygiene gate that runs in CI
```

Start with `vectors/README.md` if you want to check something rather than read something.
**There are two paths, and they cost different things — we would rather say so than have you
find out.**

- **Offline, one command, nothing needed from anyone.** `python3 verify_ours.py` and
  `python3 falsify.py` use the standard library only: no account, no key, no network. The
  second one plants deliberate defects and every one must be caught — a suite that only
  proves the right answer passes just as happily when both sides share a mistake. The run
  prints how many; we deliberately do not repeat the number here, because a count in prose
  goes stale the moment someone adds a case, and this one already had.
- **Against Uniswap's own SDK, which needs the network once.** `npm ci && node verify_sdk.mjs`
  downloads viem and the Permit2 SDK. It is worth running because it checks our encoder
  against theirs rather than against itself, but it is not the one-command claim, and
  `onchain_fieldorder.mjs` additionally talks to a chain.

An earlier version of this line said the whole thing runs in one command with no network.
That was true of the first path and not the second, and we corrected it rather than leave a
reader to discover the gap.

## Code

`integrations/graph/` — the reading and verification code, written during the event window
(2026-09-02..05). Node, no build step:

```bash
cd integrations/graph && npm ci && npm test    # the run prints the count
npm run demo                                    # the whole walkthrough, ~2.6 min
```

What it does, in the order the walkthrough shows it: ask The Graph's keyless x402 gateway
for a price, verify the indexer's attestation over the **exact** response bytes, resolve the
allocation to a staked indexer on chain, decide separately whether the reading is *usable*,
assemble a canonical snapshot that states what was **not** checked as well as what was, and
apply the rule that follows from it. Plus the gate that refuses a signature to an agent with
no registered human behind it.

⚠️ **Where it runs:** outside the enclave. An enclave has no network, so none of this can
happen inside one. The claim is "checked before a signature was requested", never "enclave
policy".

## Specs

| file | what it settles |
|---|---|
| `specs/SPEC-permit2-signature-transfer.md` | Both halves of Permit2 — AllowanceTransfer and SignatureTransfer — what the signature actually binds, and what it doesn't |
| `specs/SPEC-uniswap-execution-path.md` | Where a Uniswap swap is signed and where it is only calldata; verified addresses on Ethereum and Base |
| `specs/SPEC-enclave-guarantee-boundary.md` | What the enclave does not promise: price, MEV, slippage |

## Verify the product itself, not just this repo

The interesting claim is not in this repository. It is that you can rebuild the enclave
image from a clean public clone and get the same measurement a running box reports — read
live from its own `/attestation` endpoint, not quoted here, because it changes on every
rotation and production and demo do not share one. That procedure lives in
[namixai/signer](https://github.com/namixai/signer), and it is the one thing worth an hour
of a reviewer's time.

## AI

Claude Code wrote a large part of this repository. `AI-USE.md` says where, and the prompts
are in `plans/prompts/` — the text that was actually executed, not a cleaned-up version.

## Licence

Apache-2.0. Everything new here stays open source.
