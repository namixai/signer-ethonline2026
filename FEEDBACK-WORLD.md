# Feedback on building with World AgentKit

Written while integrating AgentBook resolution into a signing service during ETHOnline 2026.
We build an AWS Nitro enclave that holds an agent's key and applies the owner's policy
before a signature exists; an enclave has no network, so the AgentBook check described
below runs outside it, before a signature is requested — never inside the attested
boundary. Everything here is something we hit while building and verified ourselves, not
secondhand. Dates are given so a reader can tell what was current: **2–7 September 2026**.

---

## 1. AgentBook is deployed on two chains, and the kit's own defaults disagree about which one

```text
Base           0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4   — where `agentkit register` writes (CLI default)
World Chain    0xA23aB2712eA7BBa896930544C7d6636a96b944dA   — where createAgentBookVerifier() reads, hardcoded
Base Sepolia   0xA23aB2712eA7BBa896930544C7d6636a96b944dA   — same address, test network
```

We read the code rather than assumed: `agentkit register` in the CLI supports `base` and
`base-sepolia` only — World Chain isn't among its supported networks — while
`core/src/agent-book.ts` resolves against World Chain unconditionally, "regardless of which
chain the agent's signature was produced on." Follow both defaults in sequence — register
with the CLI, resolve with the SDK — and **a correctly registered agent resolves to
nobody**, with no error at either step to say why.

**What would help.** A line in the CLI's `register` command output naming the chain it just
wrote to, and the same in the SDK's resolve call. We stopped guessing and now query both
deployments, report which one answered, and treat that as one extra network read rather
than a support ticket waiting to happen.

## 2. `invalid_action` turned out to be the whole story

Our first live probe against the verify endpoint used a deliberately invalid proof, expecting
to exercise the rejection path. It came back `invalid_action` / "Action not found" instead.
That was actually useful: the app identifier was recognized, the request shape was accepted,
and the one missing piece was that the action itself hadn't been created in the Developer
Portal yet — a human step, not a code defect. Once the action (`agent-signature-gate`) was
created and the RP registered, the same request shape resolved past that error.

**What would help.** `invalid_action` and "your app doesn't exist" currently read as the same
class of error from the client side. Distinguishing "app not found" from "app found, action
not configured" in the error body would have saved us a diagnostic pass.

## 3. v2 is marked legacy in your own docs — but only if you go looking

An earlier internal review of ours claimed the v2 verify response omits `success` and
carries `verification_level`/`uses`/`max_uses` instead, and that the parameter is `signal`
rather than `signal_hash`. We checked that claim against World's own reference rather than
trust it, and it was wrong on both counts — the documented v2 response does carry `success`,
and the parameter is `signal_hash`. We're noting our own mistake here because the process of
checking it surfaced something more useful than the mistake itself: **v2 is marked legacy in
your documentation**, and the current path is `/api/v4/verify/{rp_id}`, which we then moved
to. A live probe with our own `rp_id` against v4 returned a `validation_error` naming exactly
what was missing, which is how we confirmed the identifier was already recognized by the
current endpoint before we'd finished configuring the action.

## 4. A test was green with a fabricated `rp_id`, and that's a defect in the test, not the code

Following your guidance to forward the IDKit proof result without remapping, we wrote that
path to fail loudly if a caller tried to relabel fields — a negative test that itself needed
verifying it could fail. It couldn't, at first: a live-shaped test was passing green with a
made-up `rp_id`, meaning the assertion was checking that a call completed, not that it
checked the right thing. Fixed; the full suite is 155/155 now, including that one.

**Why we're including this rather than just the fix.** A suite that only proves the right
answer passes just as happily when both sides of an assertion share the same mistake. This
is the second time in this submission we caught exactly that shape of false-green (the other
is in `vectors/README.md`, unrelated code) — worth a general note, not just a World-specific
one.

---

## 5. The Developer Portal blocks by the browser's exit IP, not by country

One browser on our team got a flat Cloudflare block on `developer.world.org`. Before
treating it as a country-level restriction — a much bigger problem — we checked: same
machine, same country, same edge, but a request from the command line instead of the
browser came back 200. The block was tracking that browser's exit IP, nothing broader. We
went through the Developer Portal MCP instead, which the block never touched.

**What would help.** Whatever fires on this block naming the actual signal. IP reputation
and geography are different problems, and we burned time on the wrong one first.

## 6. Sandbox access runs through an Apple review queue with no visible ETA

Testing an actual accept response needs the World ID Sandbox App, which ships through
TestFlight. Our install request has been sitting in `pending` review since we applied,
with nothing on our side beyond that one word.

**What would help.** App Store review isn't World's to speed up, but it's the one piece of
this integration neither we nor World can move. A known-ETA note, or a web-based sandbox
path, would help anyone racing a hackathon deadline against it.

## 7. AgentBook needs Orb, not Selfie Check — and we didn't find that written anywhere

Going in, we assumed any World ID credential level might register an agent in AgentBook —
the AgentKit and Selfie Check prize pages sit side by side and neither rules the other out.
World's own team corrected us directly, at the 4 September workshop: AgentBook registration
is Orb-level only. Selfie Check doesn't reach it.

**What would help.** Say that in the AgentBook docs themselves. It would have saved us
building on an assumption the prize pages never contradicted — and it's worth pairing with
how thin Orb access already is geographically, since together they make AgentBook a
narrower door than either page alone suggests.

---

## 8. Creating a request succeeds no matter what the relying party signs

World ID 4.0 has the relying party sign its request: a nonce, a created-at, an expires-at,
and the action, under the RP's key. We implemented that from your spec and it reproduces
your published vectors. Then we ran a control, because a check we have never seen fail is
not a check.

The control is one line: keep everything the same and sign with a key that is not the RP's.
The bridge returned a live `https://sandbox.world.org/verify?t=wld&i=…&k=…` link, exactly
as it does for a correctly signed request. So we pushed further and passed an `rp_id` that
does not exist at all — `rp_deadbeefdeadbeef`. Same result: a session, a link, a QR a person
could scan.

Both are reproducible in three minutes against your sandbox with any key.

**Why this is worth your time even if it is deliberate.** We are not claiming the request
should be authenticated at the bridge; deferring every check to verification may well be the
design, and from the outside we cannot tell. The cost is in what an implementer concludes.
Getting the RP signature right is the fiddly part of the integration — the field is a hash
shifted by eight bits, the message is 49 bytes or 81, and the EIP-191 prefix counts bytes in
decimal rather than characters. Miss any of those and the bridge still hands you a link, a
QR still renders, and a person still scans it. The first word you get that anything is wrong
arrives after a human has already been asked to prove they are one.

It also produces false evidence, and we walked into it ourselves. An earlier draft of our
own README offered "our request was accepted by their bridge" as part of what we had
observed. It is not evidence of anything about us; we removed it after running the control
above. Anyone writing up an integration is liable to make the same inference, and it will
read as a claim about their signing when it is a claim about your uptime.

**What we would have wanted**, in order of how much it would have helped: a request refused
at creation when the `rp_context` signature does not verify against the registered key; or,
failing that, one sentence in the request-creation docs saying that creation performs no RP
authentication, so acceptance means the endpoint is reachable and nothing more. Either one
turns a silent hour into an immediate error.

---

## Sandbox and Orb — geography we hit before we hit code

Orb verification is not something we can reach as a two-person remote team: the official
coverage locator lists no Orb location in Warsaw, Berlin, or Lisbon, and the nearest
confirmed points are Munich and London (both World Flagship) — a trip, not an errand. We
checked the Document-verification alternative next: Ukraine is not on World's own published
list of NFC-passport-supported countries for Document-level verification. We read the CLI
source directly to see whether AgentBook's registration path could accept a Document-level
credential instead of Orb; the verification call in `cli/src/index.ts` doesn't pass a level
parameter at all, so that requirement is configured on the Developer Portal side, which we
don't have access to. We're stating this as "didn't find it," not "confirmed absent."

Sandbox App access came through the form linked from the bounty page
(`forms.gle/mqbaiwMvX5MzmKdY8`), which is how we tested the request/response shape above
without a phone and without an Orb in reach.

---

## What worked well

- **`success`/`action`/`nullifier_hash`/`created_at` on the v4 path is a shape we could build
  a real negative test against**, once we stopped assuming the v2 shape and read the current
  one.
- **The qualification text's own wording — "Registers *or* resolves agents through
  AgentBook" — matches what an enclave-based signer can actually do.** An enclave has no
  network, so it cannot register anything on chain by itself; it can only act on a
  resolution performed outside it. Seeing that distinction already present in your own
  requirement, rather than having to argue for it, made the integration boundary easy to
  state honestly.
- **The public locator and the country list were enough to get a real, checkable answer**
  about Orb and Document-level access without needing to ask anyone — we'd rather find a
  hard "no" ourselves than guess.

---

## What this document does not claim

We resolve an agent's address against AgentBook and verify the agent's signature before a
signature of our own is requested; we do not register agents ourselves, and as of this
writing we have not completed a live Orb or Document-level human verification on our own
side — the reading half of this integration is what's tested and working, not a claim that
our own agents carry a registered human today. The AgentBook check runs outside the enclave,
because the enclave has no network; nothing here should be read as "enclave policy."
