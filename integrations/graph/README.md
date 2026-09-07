# graph-snapshot — the producing half of the policy input

Reads the Uniswap V3 market from The Graph, **verifies the indexer's attestation**, and
assembles a canonical snapshot for Signer's policy.

The samples everything is checked against sit next to the code, in `test/fixtures/`. Two of
them are **live paid answers** (1 and 4 September), kept byte for byte; a test asserts their
hash matches the `responseCID` the indexer signed.

⚠️ The specification and the vector set this grew out of are **internal documents and are
not published**. There are deliberately no links to them here: a path a reader cannot open
is worse than no link at all. Everything needed to check this code is in this directory.

    npm ci && npm test          # the run prints the number of tests, not this file
    npm run quote               # ask the gateway its price FOR FREE (reading a 402 costs nothing)
    npm run drift               # watchdog on The Graph's addresses, needs the network
    npm run drift:world         # watchdog on the AgentBook address, needs the network
    npm run leverage            # one query, several deployments of the standardized schema
    npm run test:offline        # no network: live tests skip BY NAME, not silently

---

## Two steps, and the second does NOT follow from the first

**1. The signature** (`src/attestation.js`) — `responseCID` is computed over the **exact
bytes as they arrived**, then the EIP-712 digest is assembled and the signer's address
recovered.

**2. Usability** (`src/usability.js`) — separately.
Sample 2 in the fixtures is a **correctly attested answer with a GraphQL error and no
data**, billed like any other. "The signature verified" ≠ "a price was obtained".
The predicates: no `errors` (their presence is a **refusal**, not a warning) · `data` is
non-empty · `hasIndexingErrors == false` · source freshness against the chain head · a price
is found and is **not `"0"`** (zero is legitimate for long-tail tokens and useless as a
reference) · and **separately**, the freshness of the price itself.

⚠️ **The data carries two different ages.** A fresh subgraph head does not excuse a
year-old price: prices are written inside event handlers, and on a dead market those never
fire while indexing stays green. Both ages are bounded independently.

## What this code does NOT claim

`src/chain.js` resolves the signer's address to a staked indexer — with an **on-chain
query**. An enclave cannot do that: it has no network. Therefore

- **the attestation is not the enclave's trust anchor**; it goes into the snapshot as an
  **artifact for independent re-checking**;
- the anchor remains **our** signature, and we answer for having checked the chain.

🔴 **`requestCID` is deliberately not verified.** Its preimage is unknown to us: four
plausible encodings of a known query failed to reproduce the value in the sample. Claiming a
check you cannot perform is a ritual, not a guarantee.

🔴 **The Graph's addresses moved with Horizon.** The pre-Horizon `DisputeManager` is now
`LegacyDisputeManager`, and with it a **different address is recovered — silently, with no
error** (a test pins this). Anything baked needs a watchdog whose alarm is
**distinguishable from a policy refusal**.

## State

| part | status |
|---|---|
| attestation verification | ✅ works, tested against live samples |
| usability check | ✅ works |
| on-chain indexer resolution | ✅ verified with a live query |
| x402 client | ✅ built on `@x402/fetch`; the free `quote` verified live |
| paid query | ✅ live paid reads made; every one is spending, and spending is Alex's call |
| snapshot signing | ⏳ needs the data-signing key — an operator step in the signer lane |
| The Graph address watchdog | ✅ `npm run drift`, checked against the live address book |
| agent → human resolution (World) | ✅ `src/world.js`, live AgentBook read passes |
| AgentBook address watchdog | ✅ `npm run drift:world`, on-chain plus the official client's constant |
| Permit2 vectors | ✅ all four reproduced, domain checked against the deployed contract |

⚠️ No test counts are written in this file. They go stale the moment a case is added, and
this repository has already had a count drift while every gate stayed green. The run prints
the number.

## The tests are falsified, not merely green

Every planted defect must go red **in the test that asserts it**. Checked: a broken
`normaliseV`, `errors` treated as a warning, the price-age check removed — each produces
exactly one red.

🔴 **The first pass caught a false green of my own:** the test "raw v is normalised" passed
with the normalisation broken, because `viem` understands `v: 0` by itself. The test
asserted something other than what it checked. It is now split into a unit test of the
function and an end-to-end one, and the comment that oversold it has been rewritten.

## The watchdog on baked addresses

`npm run drift` compares the baked Graph addresses against their live address book.
**Three outcomes, and they do not collapse into two:** `0` — no drift, `1` — drift found,
`2` — **could not check**. The last one deliberately does not mean "no drift".

That is the rule a review caught unwritten: anything baked must have a watchdog whose alarm
is **distinguishable from a policy refusal**. Otherwise a protocol migration reads as "the
signature did not verify".

⚠️ The watchdog caught a trap on itself: `packages/address-book/src/subgraph-service/addresses.json`
is a **symlink** in git, and the raw endpoint returns the target path instead of JSON. It
honestly said "could not check" rather than "no drift". The URL now points at the real file.

## Permit2 vectors (Uniswap)

`src/permit2.js` makes the Permit2 EIP-712 spec **runnable**. The `vectors/` directory in
the submission repository was **empty** while the spec was cited as "partially validated" —
a vector you cannot run confirms nothing.

All four references are reproduced from first principles, and the **domain is checked
against the deployed contract** (`DOMAIN_SEPARATOR()`, a free `eth_call`), not only against
our own arithmetic.

⚠️ **The Permit2 domain has THREE fields, no `version`.** The familiar four-field one
produces a signature the contract rejects as `InvalidSigner` — that is, it complains about
the **key**, not the domain. A negative control for this is its own test.

⚠️ **The type label does not protect you.** `uint160` and `uint256` encode into the same
32-byte word, so swapping the label is **invisible**. Only packing into 20 bytes is
dangerous, and that has its own test, verified by the fact that it **fails** at the correct
width.

⚠️ **An incomplete policy is its own outcome, not a refusal.** No allow-list or no ceiling
⇒ `policy_required`, matching the enclave's `POLICY_REQUIRED`. Collapsing that into "not
allowed" means reading "the rules said no" where the truth is "there are no rules yet" —
and nobody goes and fixes that.

🔴 **This is digest assembly, not signing.** There is no Permit2 signing inside the enclave:
it needs an action of its own that does not exist yet. Writing "Signer signs Permit2" before
that would be a lie in a public submission.

## The subgraph we read is a Messari Standardized Subgraph

Found out on 7 September, and not because we went looking: the id in `src/fetch.js` is
byte for byte the one Messari's deployment registry lists for `uniswap-v3-ethereum`, on the
`DEX AMM (Extended)` schema. We had been reading the standard since the first live query and
did not know it.

`npm run leverage` sends the **identical** query to several deployments of that schema. The
evidence is not our word: attestations from two independent indexers came back with the
**same `requestCID`** while `responseCID` and `subgraphDeploymentID` differ — the request
bytes matched, and they are the ones saying so. The whole measurement: `LEVERAGE-EVIDENCE.md`.

⚠️ We still cannot compute `requestCID` from the query and do not pretend to: equality
across deployments is a comparison, not a reconstruction of the preimage.

## Money

Every paid query is **$0.01 USDC on Base**. The x402 handshake is not hand-rolled: the
official `@x402/fetch` and `@x402/evm` do it, the same ones `@graphprotocol/client-x402`
uses. The payment header format is not documented anywhere in a way that could be checked,
and guessing it would be one more ritual.

**The payer key is taken only from `X402_PRIVATE_KEY`.** This code never reads it from a
vault and never writes it anywhere. Without the variable, `paidQuery` **refuses** rather
than sending an unpaid request that would fail for an unclear reason.

`npm run quote` asks the price **for free**: reading a 402 costs nothing. It doubles as a
cheap liveness probe for the endpoint.

🔴 **A failed paid query reports `spendUnknown: true`, not "we did not spend".** A throw at
that step can mean the payment never went out, or that it did and the answer was lost.
Recording it as "no spend" would be a guess, and you do not guess about money.

⚠️ But a 402 **does not prove a subgraph exists**: a fabricated id produces the same
challenge, because the gateway asks for payment before resolving the id. Measured.

---

## World AgentKit — resolving an agent to a human

`src/world.js`. Asks AgentBook (World Chain, chainId 480,
`0xA23aB2712eA7BBa896930544C7d6636a96b944dA`) whether a World-ID-verified human stands
behind an agent's address, and verifies that human's SIWE signature.

**Where this runs, and why that is not a detail.** Everything here needs the network, so
**none of it can happen inside an enclave**: the resolution is a read from World Chain, and
verifying the signature is potentially a read too, because World App wallets are smart
contracts and go through **ERC-1271**, with ecrecover only as a fallback for EOAs.

So the claim is bounded like this: **"before requesting a signature, we ask the AgentBook
registry whether a registered human stands behind the address, and we distinguish three
answers."** Not "Signer only signs for agents with a human" — that would place the check
inside the attested boundary, where it is not.

🔴 **And none of our agents is in the registry.** Registration is closed to us from both
sides: World ID is unobtainable (no Orb within reach, and Document level is not supported
for Ukraine), and the published `agentkit-cli@0.2.0` does not address a test network — it
has no `--network` flag, the network is a hard-coded constant, though the documentation
describes one. So **nothing may be written in the present tense about a registered agent**:
the reading half works, and that is exactly what it should be called.

### Three outcomes instead of two, and that is not pedantry

The official client (`worldcoin/agentkit`, `core/src/agent-book.ts`) returns `null` both for
`humanId === 0n` and inside a `catch {}`. Telling "there is no human" apart from "the RPC is
down" is impossible, and the consequence is asymmetric: on a failure a **legitimate human is
refused**, and someone goes looking for an unregistered agent instead of a broken node.

| outcome | meaning |
|---|---|
| `ok:true, registered:true` | a live contract named a `humanId` |
| `ok:true, registered:false` | a live contract answered "nobody" |
| `ok:false, lookup_failed` | **could not establish** — never read as "no" |
| `ok:false, no_contract_at_address` | no code at the address: a migration named, not mistaken for an answer |

The same split applies to the signature: a network failure is `verification_failed`, not
`valid:false`.

### Replay protection is on by force

In the kit it is optional: `if (options.checkNonce)` in `core/src/validate.ts`. Pass no
callback and a signed message replays inside a five-minute window — while the kit itself
calls that branch a "possible replay attack". Here the absence of a nonce store is a refusal,
`nonce_check_required`, in the same spirit as `policy_required`. A store failure is a
separate `nonce_check_failed`, not an accusation of replay.

### The baked address has a watchdog

`npm run drift:world` checks the address **two independent ways**: whether there is code at
it on chain, and whether the official client names the same one. The on-chain answer is the
stronger of the two — the kit's source can lag a migration, bytecode cannot. Outcomes
`0` / `1` / `2`, where `2` is "could not check" and is not `0`.

🔴 **The watchdog exists out of debt, not principle.** Our roadmap carried the address
`0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4` from 28 August, at which there is **no contract
at all**. Nobody noticed for five days, **because nobody executed that path** — the same
class as `wrapFetchWithPayment` given a viem account instead of a client. Planting the old
address reddens the live test, which is what proves the test checks the world rather than
itself.

---

## A note on language

This file, the code and its output are in English. The **specifications** in `specs/` are
in Russian: they are internal working documents, published as they were written rather than
tidied up for an audience. Translating them after the fact would make them read as
documents prepared for judging, which is not what they are. The same reasoning applies to
the prompts in `plans/prompts/` — they are the text that was actually given to the model.
