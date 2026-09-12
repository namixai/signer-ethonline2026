# Continuity — what existed before ETHOnline 2026, and what is written in the window

Kept from day one rather than assembled before the deadline. That is what the Continuity
track asks for, and it is also the only version of this document worth writing: a
submission that passes off a pre-existing product as nine days of work is a lie that the
commit history exposes anyway.

**Last updated:** 2026-09-12 (the window section below rewritten under fact — see the diff
history of this file for the 2026-08-16 plan as first written; nothing there is deleted).

## The position in one sentence

Usenami Signer is an **existing product**. It is months older than the hackathon and it is
publicly verifiable. At ETHOnline 2026 we write the **integration** between that product
and the protocols of the track, and we write it in the window, in this repository.
Knowledge gathered before the event is not hidden — it is here, dated.

## What existed BEFORE the event (not claimed as hackathon work)

| component | state before | public confirmation |
|---|---|---|
| **Signer enclave** — signing inside AWS Nitro, key never leaves | in development since May 2026, live service | public build repository, reproducible PCR0 |
| **Reproducible build + attestation** | PCR0 rebuilds from a clean clone; a live NSM COSE document is served | `signer-demo.usenami.io:8443/attestation` — **the demo box**. We run more than one enclave; ask this one and you are asking the demo lane, not the production lane. Whether a measurement is registered is a question for the chain: `isPCR0Active` on the registry contract, on Base. |
| **EIP-712 signing (Hyperliquid)** | in production | sources in the public repository |
| **`sign_data`** — data signed by a separate attested key | designed 06.2026, implemented in the main lane | design documents in the repository |
| **attested-snapshot** — a signed market snapshot | schema contract v2, July 2026 | contract + public verification page |
| **Policy before signature** — limits applied in the enclave before signing | in production on CEX venues | sources |
| **A live signing cycle on a real venue** — key generated inside the enclave, attested policy with a cap, an order accepted by the venue and a cancel accepted | 2026-08-16, on Hyperliquid. Same morning, same policy: 0.010 BNB signed under the 0.041 cap, 0.050 refused with `policy_denied`. The accepted order rested and never filled | our own account and our own money; no external audit; **three** venues — Binance Futures since 27 July, Hyperliquid since 16 August, OKX since 18 August — and the proof is a different kind on each, which is why they must not be merged into one sentence: Binance and Hyperliquid each have a completed round trip (entry filled, position closed — 27 July and 19 August), while OKX has a signed order accepted into the book and cancelled, never executed; one human action in the path — the account approved the enclave's address on chain, once |

## What was written in August, BEFORE the window

Research and benches. None of it ships as submission code, and none of it is hidden —
without it the integrations written in the window would be guesswork.

| date | what | why it is not "hackathon work" |
|---|---|---|
| 2026-08-03 | track reconnaissance from protocol sources | knowledge, not code |
| 2026-08-04 | 1inch Fusion EIP-712: the domain belongs to the router, canonical field order comes from the type string, `Address` is `uint256` | prototype in the main repository |
| 2026-08-04 | Permit2 `PermitSingle`: three-field domain, nested struct hash; confirmed against the deployed contract | prototype / knowledge |
| 2026-08-05 | three specs written up as public artefacts | specs, not code |
| 2026-08-05 | demo scenario rehearsed; latency and keep-alive measured | measurements, not code |
| 2026-08-06 | WASM attestation-verifier PoC: a live document checked in the browser | prototype, does not ship as code |
| 2026-08-06 | PCR0 rebuilt byte-for-byte from a clean public clone | acceptance of a claim, not code |
| 2026-08-08 | plan for this repository + verifier-page spec | plan and spec |
| **2026-08-14** | **Permit2 in full** — AllowanceTransfer, SignatureTransfer, both witness variants; domains checked against the deployed contract on Ethereum and Base | knowledge and spec (`specs/`) |
| **2026-08-14** | **Uniswap execution path** — the swap is not signed; `executeSigned` from the router's `main` branch is not deployed at the live addresses | knowledge and spec (`specs/`) |
| **2026-08-14** | **Permit2 test vectors** — two independent implementations, an on-chain anchor, and a falsification set; the counts are not repeated here, because `vectors/README.md` already records what a repeated count did — both prose numbers had silently drifted from the scripts by 2026-09-07. Run `verify_ours.py` and `falsify.py`: each prints what it just read | bench (`vectors/`), does not ship as submission code |
| **2026-08-14** | this repository created, with the August material imported under its real dates | disclosure, which is the point |
| **2026-08-15** | **every signature surface in the swap path enumerated** — all 23 router commands classified; three forward a signature and a fourth nests; v3 and v4 position-NFT permits share a type hash and disagree about the domain | knowledge and spec (`specs/`) |
| **2026-08-16** | **the enclave signed an order Hyperliquid accepted, and the cancel was accepted**; the same policy signed 0.010 BNB under the cap and refused 0.050 | product milestone, not hackathon work — the signing path predates the event |
| **2026-08-15** | **position-NFT permit vectors** — two paths, every domain separator anchored against the deployed contract, and a falsification set; counts likewise live in the run, not here — `verify_nft_ours.py` and `falsify_nft.py` | bench (`vectors/`), does not ship as submission code |

## What has been written IN THE WINDOW (from 4 September) — status as of 8 September

The 16 August plan and the actual window diverged. Two items on that plan were cut, one
shipped in a different, narrower shape than written, and three integrations happened that
were not on the plan at all. All of it below — cut items included — because a page that
quietly drops what it can't deliver is worse than one that says so.

### What the 16 August plan promised

| promised | status | what actually happened |
|---|---|---|
| 1inch Fusion integration | **cut** | never started as integration code in this window. What exists is the 4 August knowledge and the 5 August spec, both already listed above as pre-window |
| Uniswap Permit2 integration | **partial — digest only, does not sign** | `integrations/graph/src/permit2.js`, written in the window: builds and checks the EIP-712 digest against the 14 August spec, so the spec is runnable rather than read. It does not sign, and nothing in this repository will. 🔴 **Corrected 12 September:** this row used to add that the enclave action "does not exist", which was already untrue when written — `namixai/signer` has `sign_permit2_permit_single` and a gateway route for it on its `main` since 10–11 September (`865f418`, `17faf5a`). We described another repository from memory. The action is not deployed to the demo lane, which answers 404 on that route, so nothing we published lets anyone exercise it; that is a different sentence from "it does not exist", and the difference is the kind a reviewer checks |
| Integration with 0G Compute TEE | **cut** | not a scope choice on our side: 0G disappeared from ETHOnline's own public prize roster on 28 August. The individual 0G prize page is still reachable; the general prize list no longer lists it. We were building toward a track that stopped being listed, and did not replace it with a different 0G integration |
| "Data as a policy input": snapshot signature checked, freshness judged by enclave time, refusal before signing | **shipped, in a corrected shape** | see below — the enclave-time framing as originally written overclaimed, and the actual claim is narrower |
| The verifier page | **cut** | not built this window. The 8 August spec (below) and the 6 August WASM proof-of-concept exist; the page connecting them does not. The window's engineering time went to the three integrations below instead, none of which were on this plan |
| README for the submission, the demo video, and the remaining spec artefacts | **README: written, one oversell caught and fixed. Video: not made** | the top-level README claimed "runs in one command and needs no account, no key and no network" — true for the offline path, false for the path that verifies live against a deployed contract. Fixed to name both paths and what each costs. The demo video does not exist yet: `demo/STORYBOARD-hyperliquid.md` and a runnable `demo/demo.sh` do |

### The reworded item: data as a policy input

🔴 The claim as first written said market data would be "an input to enclave policy" — that
overclaimed. The enclave does not parse this snapshot; no enclave action exists that verifies
a signed snapshot and applies a band, and building one was ruled out for this window. What
exists instead: a signed statement we make about our own check (schema
`usenami.market-reference.dex.v1`, sent to `/sign-data`, so the enclave still owns
canonicalisation and the signature — we do not run a second canonicaliser), and a rule
(`judgeOrder`) that compares an order's price against a ±5%-by-default band computed from
that snapshot and refuses outside it. It catches a stale quote, a manipulated route, or a
fat-finger price with no relationship to the market. It does not claim best execution —
nothing here promises the best price, only a sane one. The honest claim is "the price was
checked before a signature was requested," not "market data is an input to enclave policy."

### What was written that was not on the 16 August plan at all

**The Graph integration.** A live-data path — attestation check, usability check, indexer
resolution — plus the gate and the snapshot rule above, both of which consume it. Tests green
against live data and against an offline fixture set (a few cases skipped by name where they
need live network access), an 8-frame demo that runs end to end. A test count is not quoted
here on purpose: a number typed next to the code drifts from the code the moment either one
changes, and this repository has already caught itself doing exactly that once — the count
lives in the code, not in this page. `namixai/signer-ethonline2026#5`.

**A gate that refuses to ask for a signature, not one that reports after asking.** Before a
signature is requested, the code checks two on-chain registries (Base and World Chain) for a
registered human behind the calling agent. Two distinct refusal reasons, kept apart on
purpose: `no_registered_human` (the registry was reached and confirmed absence) and
`human_unverified` (the check could not be completed — the registry was unreachable or gave
an answer the code doesn't trust) — collapsing them would send an operator to re-register an
agent that was already registered, instead of fixing a broken lookup. 🔴 The receipt names
where the decision was made — `decided_by: gateway_before_enclave` — and a test pins that
exact string so the claim can't drift to "the enclave refused" if someone else edits the file
later.

**World ID: our code reaches their live verifier and is recognized by it — a successful
verification has not been observed.** The RP is registered on-chain in both production and
staging, and the `agent-signature-gate` action is configured in both. A live probe with a
deliberately wrong RP against a correct request body returns a different error
(`app_not_migrated`) than the same probe with our real RP (`verification_error`, meaning the
request reached proof checking) — that contrast is what proves the identifier is live and
recognized, not a claim taken on faith.

On 8 September the half that asks was written, and the half that answers finally moved in.
Until then `world-verify.js` could check a proof and nothing in the repository could get one
— a listener with nobody speaking.

`src/world-rp-sign.js` signs the request World requires from a relying party, built from
their specification rather than lifted from their SDK. Their published vectors are asserted
in the suite, and the result agrees with their own `signRequest` on our action — two
implementations sharing no code and landing on the same bytes. Written 8 September.

`src/world-verify.js` and its tests were written on 7 September and until the 8th lived only
in the working tree, never in this repository. A reader could see the AgentBook resolver and
not the code that checks a World proof, the half the track is about. A repository whose
history is thinner than the work has to explain itself before someone else does.

`scripts/world-proof.mjs` runs the whole path — `npm run world:proof` — and reports one of
three outcomes, never two. `verified` and `not_verified` are World's answers. `could_not_ask`
is every case where the question never reached a person: no signing key, a request the bridge
refused, a poll that ran out of time. Collapsing the third into `not_verified` would report a
broken network as a human failing to prove they are one.

What none of this shows: World has never returned a "verified" response to us, and will not
until a real proof arrives from a Sandbox App. What is missing is a person and a phone, not
code. Where we stand with that app is not something a reader could check, so this page makes
no claim about it either way. What we have seen is one thing: a deliberately invalid proof
refused by name at their verifier. Their bridge does return a live sandbox link for our
request, and this page used to offer that as evidence — measurement says otherwise. The same
link comes back for a request signed with a key that is not ours, and for an rp_id we
invented, so it reports the endpoint is up and nothing about us. The signing is vouched for
by the reproduced vectors above, not by the bridge. **A sandbox-verified request path is not the same claim as being registered in
AgentBook, and this document does not conflate the two.**

## Public spec artefacts (the set is kept from day one)

| file | written |
|---|---|
| `specs/SPEC-permit2-signature-transfer.md` | 2026-08-14 |
| `specs/SPEC-uniswap-execution-path.md` | 2026-08-14 |
| `specs/SPEC-enclave-guarantee-boundary.md` | 2026-08-14 |
| `vectors/` — Permit2 family (cases, both verifiers, falsification, on-chain anchor) | 2026-08-14 |
| `specs/SPEC-uniswap-signature-surfaces.md` | 2026-08-15 |
| `vectors/` — position-NFT family (`nft-*`) | 2026-08-15 |
| `vectors/onchain_fieldorder.mjs` — field order judged by the deployed Permit2 | 2026-08-16 |
| `demo/STORYBOARD-hyperliquid.md` + `demo/demo.sh` — three frames, runnable rather than filmed | 2026-08-16 |
| the Fusion, Permit2 and attestation specs of 2026-08-05, and the verifier-page spec of 2026-08-08 | imported as the window opens |

## Rules we hold ourselves to

- **No public claim without evidence.** Every claim passes an internal evidence gate before
  it is published anywhere, including in this repository.
- **We do not claim order-book-depth slippage**, because we don't have it. A bound against
  a reference price is implementable; that is a different promise, and we say which one.
- **We do not sell phishing protection.** Phishing losses fell 83% in a year, Permit2 makes
  approval lifetimes possible on its own, and Blockaid and MetaMask block at the point of
  signature. Our angle is the agent with **no human in the loop**: every one of those
  defences ends at a person looking at a screen. A simulation draws a warning with nobody
  to read it; revocation needs a button with nobody to press it.
- **We do not take credit for approval limits.** Permit2 makes a lifetime possible but not
  mandatory. Our contribution is making it enforceable from the key holder's side.
- 🔴 **We never write "nobody else does this".** Another team runs a policy engine inside a
  TEE on the same AWS Nitro, with amount limits, reproducible builds, attestation, EIP-712
  and a live Hyperliquid integration, and has raised more than $65M. **We are not first.**
  Any uniqueness claim survives exactly one search, and takes the credibility of everything
  around it when it goes.
- **We say what the live run does not cover.** The Hyperliquid cycle of 2026-08-16 ran on
  our own account with our own money, has had no external audit, and required one on-chain
  approval from the account before the venue would accept anything the enclave signed. It is
  also one venue of three, and the other two are not the same kind of evidence — Binance has
  a completed round trip like Hyperliquid's, OKX has a signature the venue booked and then
  cancelled, with nothing executed. Stating the milestone without those qualifications next to it would be
  the same overreach as any other unqualified claim.
- **We do not stitch two runs into one.** The cap probes and the venue-accepted order happened
  in separate runs on the same day; describing them as one continuous unattended cycle would
  be a small lie that a reader with the timestamps could catch.
- **Dates do not move.** If a component existed before the event, it says so.
