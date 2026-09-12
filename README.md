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
before a signature exists — for the keys that carry them. On existing protocols, without
changing them.

Two qualifications belong right here rather than in a footnote, because without them the
paragraph above claims more than the software does. **The policy is the owner's, but we
are the ones who write it out** — there is no self-service yet, so "set by the owner"
describes whose rules they are, not who typed them. And **a per-order cap protects only
the keys it was written for**: the keyless testnet token carries no size limit at all, it
is bound to the withdrawal ban instead.

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

🔴 **And a distinction about the evidence, which matters more than the list.** Of those
three venues, **exactly one can be checked by an outsider without us**: Hyperliquid is
on-chain and its `info` API answers to anyone. **Binance and OKX cannot be.** They are
centralised, there is no public address, and the only artefacts are venue responses in our
own logs — which is our word about ourselves, however carefully we kept them. A reviewer
should read those two as unverifiable by construction, not as verified-and-omitted.

One venue that a stranger can confirm, said plainly, is worth more than three that rest on
our logs.

🔴 **And what that one venue does and does not confirm — a boundary that must not be glued
shut, because gluing it is the class of error this repository spent a day removing.** The
venue can confirm two things and not a third. It confirms that a named agent key is
**approved to sign** for the master account, and that particular fills happened. It says
**nothing about where that key lives.** "The key is inside an attested enclave" is a
different claim, proved by a different link — the reproducible build and its attestation,
below — and a chain is only as strong as its weakest link, not as strong as the link you
quote. A reader who takes the venue's answer as proof of the enclave has been misled, and
it would be our sentence that misled them.

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

- **Offline, one command, nothing needed from anyone:**

  ```bash
  cd vectors && make verify
  ```

  No account, no key, no network — standard library only. It runs our own encoder against
  the pinned cases and then plants deliberate defects, every one of which must be caught,
  because a suite that only proves the right answer passes just as happily when both sides
  share a mistake. The run prints how many defects; we deliberately do not repeat the
  number here, since a count in prose goes stale the moment someone adds a case, and this
  one already had.

  🔴 **If you have no `make`, you are not stuck.** On a clean macOS it arrives with the
  Xcode command line tools, and a minimal container may not have it at all — a missing
  tool at the very first command we promise would be a poor welcome. It runs exactly
  these four, in this order, and they need only `python3`:

  ```bash
  cd vectors && python3 verify_ours.py && python3 falsify.py && python3 verify_nft_ours.py && python3 falsify_nft.py
  ```

  That is the fallback, not the claim: the claim is `make verify`, and this is what it
  does so you can run it without the tool.

  ⚠️ **The `cd` in that line was missing when this paragraph was first written**, two
  paragraphs above a confession that the very same command had once shipped without its
  `cd` and failed at the reader's prompt. Same defect, same page, a day apart. Caught in
  review, and left named here rather than tidied away: knowing the shape of a mistake is
  not the same as not making it again.

  🔴 **This sentence has been wrong twice, so it is worth saying how it got fixed.** First
  it omitted the `cd`, and the command failed at the reader's prompt. Then it still said
  "one command" while naming two scripts — a reader counts what they type, and that was
  four. Rather than soften the claim a third time we made it true: `make verify` is the
  whole offline path. Falsification is inside it on purpose, not a separate target, because
  making the part that proves the rest can go red opt-in is the same as not having it.
- **Against Uniswap's own SDK, which needs the network once.**

  🔴 `npm ci` here reports seventeen advisories, one of them high. They come in through
  Uniswap's own SDK and its dependency tree, not from anything we wrote, and nothing in
  that tree touches a signature: this path exists to check our encoder against theirs, it
  holds no key and reaches no chain. We are not hiding the number behind a lockfile pin,
  because the honest version is that a reviewer will see it and should know why it is
  there. The offline path above has no dependencies at all.

  Still from `vectors/`:

  ```bash
  make verify-sdk
  ```

  It downloads viem and the Permit2 SDK and runs **both** SDK cross-checks — the earlier
  version of this line named only `verify_sdk.mjs` and quietly left the position-NFT one
  out, which is the same understatement the offline claim above had. It is worth running because it checks our encoder
  against theirs rather than against itself, but it is not the one-command claim, and
  `onchain_fieldorder.mjs` additionally talks to a chain.

An earlier version of this line said the whole thing runs in one command with no network.
That was true of the first path and not the second, and we corrected it rather than leave a
reader to discover the gap.

## Code

🔴 **What this needs, so a version mismatch is not your first surprise:** `python3` for the
offline vectors, and **Node 20 or newer** for everything under `integrations/graph` — the
suite runs on the built-in test runner, and an older Node answers `bad option: --test`,
which reads like our bug and is not one. CI runs Node 22. Nothing here needs a specific
Python version beyond 3.

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

It asks the attestation registry whether the measurement it just fetched is registered,
and prints the answer with the owner address beside it. 🔴 **Read the chain, not this
sentence.** An earlier version of this paragraph told you the answer would be `false` and
explained why that was fine; at the time it was. The registry keeps one active measurement
per owner, so which of our lanes holds it moves, and a page that predicts the answer will
be wrong sooner or later. The frame explains both readings when you run it. The full
sequence is in
`demo/STORYBOARD-hyperliquid.md`.

## Specs

| file | what it settles |
|---|---|
| `specs/SPEC-permit2-signature-transfer.md` | Both halves of Permit2 — AllowanceTransfer and SignatureTransfer — what the signature actually binds, and what it doesn't |
| `specs/SPEC-uniswap-execution-path.md` | Where a Uniswap swap is signed and where it is only calldata; verified addresses on Ethereum and Base |
| `specs/SPEC-uniswap-signature-surfaces.md` | What else gets a typed-data signature in the router path besides Permit2 — three commands that do, and one nested path that does even when the top-level call doesn't |
| `specs/SPEC-enclave-guarantee-boundary.md` | What the enclave does not promise: price, MEV, slippage |

🔴 **Russian, and not only here.** As of 12 September, **39 tracked files in this
repository contain Russian** — the four specs above among them, and among the other
thirty-five `integrations/graph/README.md`, which documents the code this submission calls
its window work, and `demo/STORYBOARD-hyperliquid.md`. `demo/precheck.sh` prints in
Russian, and `npm run test:offline` gives Russian reasons for the six tests it skips,
beside their English names. Do not take the number on trust — it is every tracked file
holding a Cyrillic character, and it moves as files are added:

```bash
git ls-files | grep -v node_modules | python3 -c "
import pathlib, re, sys
cyr = re.compile(r'[\u0400-\u04FF]')
print(sum(1 for f in sys.stdin.read().split()
          if cyr.search(pathlib.Path(f).read_text(errors='ignore'))))"
```

(Python rather than `grep -P`, because the `grep` shipped with macOS has no `-P` and would
answer `invalid option` rather than a number. Checked on both.)

This paragraph has now been wrong twice, in the same direction both times. It first said
"all four are in Russian", which reads as a complete inventory and was not one; the
replacement said "thirty-six files" and was a count nobody re-ran. A number in a document
is a claim with a shelf life, so this one ships with the command that checks it.

They are internal reading notes and internal test commentary, published as they were
written rather than translated for the occasion — the same choice `AI-USE.md` makes about
the prompts, and for the same reason: a document tidied up after the fact describes the
work instead of recording it. Everything on the path a reader actually walks is in
English: this file, the demo output, the test names, and the table above saying what each
spec settles. The reading itself is not, and `integrations/graph/README.md` now opens by
saying so in English before the Russian starts.

### Permit2, by file and line

🔴 **The boundary first, and a correction to what this file said a few hours ago.** What is
in **this** repository is the Permit2 **digest**: built from the spec, checked against the
deployed contract, reproduced by two implementations that share no code. No signing. That
part has not changed.

What changed is the sentence that followed it. Until today this file also said the signing
action did not exist in the product either. **That is wrong, and it was wrong when written:**
`namixai/signer` gained an enclave action `sign_permit2_permit_single` and a gateway route
`POST /sign/permit2-permit-single` on 10 and 11 September — commits `865f418` and `17faf5a`
on its `main`, in `poc/enclave/src/signer.rs`, `poc/enclave/src/proto.rs` and
`poc/gateway/src/handlers.rs`. We asserted the state of another repository without opening
it. It is corrected here rather than quietly edited out, because a reviewer can find those
commits in a minute and should not have to wonder which of our sentences to trust.

So the honest three lines:

- **This submission** contains the digest work, and no signing. Nothing here will sign for you.
- **The product** has the action in its source since 10–11 September.
- **Nobody can exercise it from what we published:** the demo gateway answers 404 on that
  route — measured — as it does on `/sign/order`. The demo lane exposes attestation, not
  signing.

The Uniswap track asks a README to point at the contracts and the lines of code, so here
they are rather than a directory to go hunting in. Links are pinned to a commit, because a
line number in prose drifts the moment someone adds an import.

**The contract** — Permit2, the same address on Ethereum and Base, checked against
`vectors/addresses.json`:
[`0x000000000022D473030F116dDEE9F6B43aC78BA3`](https://etherscan.io/address/0x000000000022D473030F116dDEE9F6B43aC78BA3)

**The code that builds the digest**, written in the window:

| what | where |
|---|---|
| the three-field domain separator — no `version`, and that is the whole trap | [`permit2.js#L32`](https://github.com/namixai/signer-ethonline2026/blob/df9c774/integrations/graph/src/permit2.js#L32) |
| `PermitDetails` struct hash | [`permit2.js#L42`](https://github.com/namixai/signer-ethonline2026/blob/df9c774/integrations/graph/src/permit2.js#L42) |
| `PermitSingle` struct hash, nested struct as its own hash | [`permit2.js#L52`](https://github.com/namixai/signer-ethonline2026/blob/df9c774/integrations/graph/src/permit2.js#L52) |
| the EIP-712 digest itself | [`permit2.js#L61`](https://github.com/namixai/signer-ethonline2026/blob/df9c774/integrations/graph/src/permit2.js#L61) |
| the policy check that refuses an unlimited approval | [`permit2.js#L77`](https://github.com/namixai/signer-ethonline2026/blob/df9c774/integrations/graph/src/permit2.js#L77) |

**The two independent verifications**, which is the part worth running:
[`vectors/permit2_ref.py#L114`](https://github.com/namixai/signer-ethonline2026/blob/df9c774/vectors/permit2_ref.py#L114)
is path A, hand-written EIP-712 with only keccak borrowed;
[`vectors/verify_sdk.mjs`](https://github.com/namixai/signer-ethonline2026/blob/df9c774/vectors/verify_sdk.mjs)
is path B, running Uniswap's own `@uniswap/permit2-sdk` with its own type definitions; and
[`vectors/onchain_fieldorder.mjs`](https://github.com/namixai/signer-ethonline2026/blob/df9c774/vectors/onchain_fieldorder.mjs)
hands the question to the deployed contract, which recovers a signer from *its* digest and
compares.

**And the boundary again, now that you have seen the files:** everything above builds and
checks a digest. None of it signs one.

### World ID, by file and line

Two halves, and they reached this repository separately. The receiving half, checking a
proof that comes back, was written on 7 September and moved in on the 8th, so it lands here
in one commit rather than the one it was written in. Same caveat as `integrations/graph/`
above, same reason for saying it. The asking half, which signs the request that makes a proof
happen at all, was written on 8 September. Until then we could check a proof and had no way
to get one: a listener with nobody speaking.

**The code**, pinned to a commit:

| what | where |
|---|---|
| `hash_to_field` — keccak256 shifted right by eight bits, which is what turns a hash into a field element | [`world-rp-sign.js#L42`](https://github.com/namixai/signer-ethonline2026/blob/df9c774/integrations/graph/src/world-rp-sign.js#L42) |
| the message the relying party signs — 49 bytes without an action, 81 with one | [`world-rp-sign.js#L62`](https://github.com/namixai/signer-ethonline2026/blob/df9c774/integrations/graph/src/world-rp-sign.js#L62) |
| the EIP-191 prefix, whose length is counted in **bytes** and written in decimal | [`world-rp-sign.js#L122`](https://github.com/namixai/signer-ethonline2026/blob/df9c774/integrations/graph/src/world-rp-sign.js#L122) |
| checking a returned proof against World ID 4.0 | [`world-verify.js#L166`](https://github.com/namixai/signer-ethonline2026/blob/df9c774/integrations/graph/src/world-verify.js#L166) |
| the AgentBook lookup, and the three answers it keeps apart | [`world.js#L110`](https://github.com/namixai/signer-ethonline2026/blob/df9c774/integrations/graph/src/world.js#L110) |

The signing scheme is built from World's specification rather than lifted from their SDK, so
the whole path is ours to answer for, and their published vectors are asserted in the suite.
An implementation of a signature scheme that has never reproduced a known value is a guess
with good intentions. It also agrees with their SDK's own `signRequest` on our action:
two implementations that share no code, arriving at the same bytes.

**Running it end to end** needs a phone with the World ID Sandbox App:

```bash
cd integrations/graph && npm run world:proof
```

It signs a request, prints a QR code, waits, and then says one of three things. Two of them
are World's answers: `verified` and `not_verified`. The third, `could_not_ask`, covers every
case where the question never reached a person at all: no signing key, a request the bridge
refused, a poll that ran out of time. Folding that third outcome into `not_verified` would
report a network problem as a human failing to prove they are one.

🔴 **What we have not seen.** World has never answered `verified` to us. What we have seen
is one thing: a deliberately invalid proof refused by name at their verifier. Their bridge
does hand back a live sandbox link for our request, and an earlier draft of this page
offered that as evidence — it is not. Measured: the bridge returns the same link for a
request signed with a key that is not ours, and for an `rp_id` we invented. It says the
endpoint is up, nothing about us. What speaks for the signing is the paragraph above: their
own vectors, reproduced. The positive path needs a real proof from a real phone. And none of
this is the same claim as being registered in AgentBook — that needs an Orb, and we do not
have one.

## Verify the product itself, not just this repo

The interesting claim is not in this repository. It is that you can rebuild the enclave
image from a clean public clone and get the same measurement a running box reports — read
live from its own `/attestation` endpoint, not quoted here, because it changes on every
rotation and production and demo do not share one. That procedure lives in
[namixai/signer](https://github.com/namixai/signer) — the procedure is
[`docs/VERIFY-SIGNER-YOURSELF.md`](https://github.com/namixai/signer/blob/main/docs/VERIFY-SIGNER-YOURSELF.md)
and the closure check is
[`poc/scripts/enclave-closure-check.py`](https://github.com/namixai/signer/blob/main/poc/scripts/enclave-closure-check.py).
Both paths are spelled out because the obvious guesses — those filenames at the repository
root — are 404s, and a reviewer who has to search for the thing we told them to run has
already been given a worse answer than the one we meant. It is the one thing worth an hour
of a reviewer's time.

## AI

Claude Code wrote a large part of this repository. `AI-USE.md` says where. The three
prompts in `plans/prompts/` are the text that was actually given to the model — and all
three predate the event window (14, 15, 16 August). The work written during the window
itself, `integrations/graph/` above, has no prompt file: we are not writing one after the
fact to backfill it. `AI-USE.md` explains why the early material exists at all.

## Licence

Apache-2.0. Everything new here stays open source.
