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
theirs yet. No external audit. Order signing has run on three venues since — Binance
Futures 27 July, Hyperliquid 16 August, OKX 18 August — and the proof is not the same kind
on each: Binance and Hyperliquid both have a completed round trip, entry filled and
position closed (Binance 27 July, Hyperliquid **19 August** — three days after the venue
went live, not the same day; the 16 August Hyperliquid event was a cap-probe and cancel
that never filled, see `CONTINUITY.md`). OKX has a signed order accepted into the book and
cancelled — not a completed trade. That is the whole list, and the three are not
interchangeable in a sentence. First only in the sense of our own first; the rules we hold
ourselves to are in `CONTINUITY.md`, and one of them forbids the
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
plans/         PLAN.md, and prompts/ — three prompts, all predate the window (see AI below)
scripts/       scrub-check.sh, the hygiene gate that runs in CI
integrations/  the code written in the window — see Code below
demo/          demo.sh and the Hyperliquid storyboard: the demo as a script, not a video
```

Start with `vectors/README.md` if you want to check something rather than read something.
**There are two paths, and they cost different things — we would rather say so than have you
find out.**

- **Offline, one command, nothing needed from anyone.** `cd vectors` first — every command
  in this section runs from there, and an earlier version of this list omitted that, so the
  "one command" claim failed at the reader's prompt. `python3 verify_ours.py` and
  `python3 falsify.py` use the standard library only: no account, no key, no network. The
  second one plants deliberate defects and every one must be caught — a suite that only
  proves the right answer passes just as happily when both sides share a mistake. The run
  prints how many; we deliberately do not repeat the number here, because a count in prose
  goes stale the moment someone adds a case, and this one already had.
- **Against Uniswap's own SDK, which needs the network once.** Still from `vectors/`:
  `npm ci && node verify_sdk.mjs`
  downloads viem and the Permit2 SDK. It is worth running because it checks our encoder
  against theirs rather than against itself, but it is not the one-command claim, and
  `onchain_fieldorder.mjs` additionally talks to a chain.

An earlier version of this line said the whole thing runs in one command with no network.
That was true of the first path and not the second, and we corrected it rather than leave a
reader to discover the gap.

## Code

`integrations/graph/` — the reading and verification code, written during the event window
(2026-09-02..05) and migrated into this repository on 2026-09-07, which is why its history
here is a single commit rather than four days of them. Said out loud because `CONTINUITY.md`
invites exactly this check. Node, no build step:

```bash
cd integrations/graph && npm ci && npm test    # the run prints the count
npm run demo                                   # the walkthrough; finishes in about a second
npm run leverage                               # one query, several standardized deployments
```

`npm run demo` prints as fast as the terminal allows. To watch it at reading speed set
`DEMO_STEP_PAUSE_MS=22000`, or play the recording committed as
`integrations/graph/demo.cast` (asciinema). An earlier version of this line promised the
command itself took minutes; that was true of the recording, not of the command.

What it does, in the order the walkthrough shows it: ask The Graph's keyless x402 gateway
for a price, verify the indexer's attestation over the **exact** response bytes, resolve the
allocation to a staked indexer on chain, decide separately whether the reading is *usable*,
assemble a canonical snapshot that states what was **not** checked as well as what was, and
apply the rule that follows from it. Plus the gate that refuses a signature to an agent with
no registered human behind it.

### The subgraph is a Messari Standardized Subgraph

Worth stating plainly, because a judge on the Composable-or-Standardized track is looking
for exactly this and cannot see it otherwise. The deployment this code reads in production,
`4cKy6QQMc5tpfdx8yxfYeb9TLZmgLQe44ddW1G7NwkA6`, is the one Messari's own
[deployment registry](https://github.com/messari/subgraphs/blob/master/deployment/deployment.json)
lists for `uniswap-v3-ethereum`, on the
[`DEX AMM (Extended)`](https://thegraph.com/docs/en/subgraphs/existing-subgraphs/standard-subgraphs/)
standardized schema.

We did not choose it for the track. We had been reading it since the first live query and
only found out on 2026-09-07, while measuring whether the track was open to us at all. The
honest version of that is in `integrations/graph/LEVERAGE-EVIDENCE.md`, together with the
measurement: the identical query sent to two deployments on two chains came back with the
**same attested `requestCID`** from two independent indexers, while `responseCID` and
`subgraphDeploymentID` differ. One query pattern, several deployments, zero lines changed —
and the parties attesting to it have no stake in our claim.

`npm run leverage` re-runs it — **with `X402_PRIVATE_KEY` set**, because that measurement is
made of paid queries ($0.01 each, USDC on Base). Without the key the script runs in
quote-only mode and says so in its own output: it then proves nothing about the data, since
a fabricated subgraph id returns the same price challenge. Measured, not assumed.

⚠️ **Where it runs:** outside the enclave. An enclave has no network, so none of this can
happen inside one. The claim is "checked before a signature was requested", never "enclave
policy".

## Demo

Two different things share the word "demo" here, and they are not the same demo.

`npm run demo` above is the Graph walkthrough. This one is the Hyperliquid storyboard, and
it lives in `demo/`:

```bash
cd demo && ./demo.sh --frame 3
```

It prints `false` from the attestation registry and says why that's the right answer, not
a failure: production and demo are one owner with one active measurement at a time, and
this frame reads the one that isn't currently live. The full sequence is in
`demo/STORYBOARD-hyperliquid.md`.

## Specs

| file | what it settles |
|---|---|
| `specs/SPEC-permit2-signature-transfer.md` | Both halves of Permit2 — AllowanceTransfer and SignatureTransfer — what the signature actually binds, and what it doesn't |
| `specs/SPEC-uniswap-execution-path.md` | Where a Uniswap swap is signed and where it is only calldata; verified addresses on Ethereum and Base |
| `specs/SPEC-uniswap-signature-surfaces.md` | What else gets a typed-data signature in the router path besides Permit2 — three commands that do, and one nested path that does even when the top-level call doesn't |
| `specs/SPEC-enclave-guarantee-boundary.md` | What the enclave does not promise: price, MEV, slippage |

All four are in Russian. They are internal reading notes, published as they were written
rather than translated for the occasion — the same choice `AI-USE.md` makes about the
prompts, and for the same reason: a document tidied up after the fact describes the work
instead of recording it. What each one settles is in the table above, in English; the
reading itself isn't.

### Permit2, by file and line

The Uniswap track asks a README to point at the contracts and the lines of code, so here
they are rather than a directory to go hunting in. Links are pinned to a commit, because a
line number in prose drifts the moment someone adds an import.

**The contract** — Permit2, the same address on Ethereum and Base, checked against
`vectors/addresses.json`:
[`0x000000000022D473030F116dDEE9F6B43aC78BA3`](https://etherscan.io/address/0x000000000022D473030F116dDEE9F6B43aC78BA3)

**The code that builds the digest**, written in the window:

| what | where |
|---|---|
| the three-field domain separator — no `version`, and that is the whole trap | [`permit2.js#L32`](https://github.com/namixai/signer-ethonline2026/blob/8ce69ef/integrations/graph/src/permit2.js#L32) |
| `PermitDetails` struct hash | [`permit2.js#L42`](https://github.com/namixai/signer-ethonline2026/blob/8ce69ef/integrations/graph/src/permit2.js#L42) |
| `PermitSingle` struct hash, nested struct as its own hash | [`permit2.js#L52`](https://github.com/namixai/signer-ethonline2026/blob/8ce69ef/integrations/graph/src/permit2.js#L52) |
| the EIP-712 digest itself | [`permit2.js#L61`](https://github.com/namixai/signer-ethonline2026/blob/8ce69ef/integrations/graph/src/permit2.js#L61) |
| the policy check that refuses an unlimited approval | [`permit2.js#L77`](https://github.com/namixai/signer-ethonline2026/blob/8ce69ef/integrations/graph/src/permit2.js#L77) |

**The two independent verifications**, which is the part worth running:
[`vectors/permit2_ref.py#L114`](https://github.com/namixai/signer-ethonline2026/blob/8ce69ef/vectors/permit2_ref.py#L114)
is path A, hand-written EIP-712 with only keccak borrowed;
[`vectors/verify_sdk.mjs`](https://github.com/namixai/signer-ethonline2026/blob/8ce69ef/vectors/verify_sdk.mjs)
is path B, running Uniswap's own `@uniswap/permit2-sdk` with its own type definitions; and
[`vectors/onchain_fieldorder.mjs`](https://github.com/namixai/signer-ethonline2026/blob/8ce69ef/vectors/onchain_fieldorder.mjs)
hands the question to the deployed contract, which recovers a signer from *its* digest and
compares.

🔴 **What this is not.** It builds and checks a digest. There is no Permit2 signing inside
the enclave — that needs an action which does not exist yet, and writing otherwise would be
a false claim in a public submission.

## Verify the product itself, not just this repo

The interesting claim is not in this repository. It is that you can rebuild the enclave
image from a clean public clone and get the same measurement a running box reports — read
live from its own `/attestation` endpoint, not quoted here, because it changes on every
rotation and production and demo do not share one. That procedure lives in
[namixai/signer](https://github.com/namixai/signer), and it is the one thing worth an hour
of a reviewer's time.

## AI

Claude Code wrote a large part of this repository. `AI-USE.md` says where. The three
prompts in `plans/prompts/` are the text that was actually given to the model — and all
three predate the event window (14, 15, 16 August). The work written during the window
itself, `integrations/graph/` above, has no prompt file: we are not writing one after the
fact to backfill it. `AI-USE.md` explains why the early material exists at all.

## Licence

Apache-2.0. Everything new here stays open source.
