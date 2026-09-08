# Plan — what we are building, and what counts as done

The public half of the department plan. Internal machinery — which machines we may touch,
who reviews what, how prize slots get chosen, how we position against other teams — is not
here, because none of it tells you anything about the software.

The rule this file exists under: if you work from specs with an AI, the specs, plans and
prompts belong in the public submission repository. So here they are.

## The thing itself, in one paragraph

Signer is one endpoint. An agent brings a ready order from some protocol, an AWS Nitro
enclave checks it against the owner's policy, and either signs it or refuses. We do not
build a DEX, route trades, or invent a protocol. The demonstration is narrower and
checkable: the agent's key is physically out of reach, and limits are applied before a
signature exists — for the keys that carry them — on existing protocols, without
modifying them.

Same two qualifications as the README, and for the same reason: the policy is the owner's
but we write it out by hand (no self-service yet), and a per-order cap protects only the
keys it was written for — the keyless testnet token has no size limit, it is bound to the
withdrawal ban instead.

## Phases

### Phase 0 — bench

A separate demo key and policy on a separate machine, and one number that decides the rest
of the planning: how long the full cycle "edit → build → new measurement → enclave up"
actually takes. If that cycle turns out to be expensive, the phase plan changes rather than
the schedule slipping quietly.

### Phase 1 — 1inch Fusion

Struct hash for a Fusion order (eight flat fields) plus the 1inch domain. Policy:
token allow-list, amount ceiling, and a refusal to sign orders that carry calldata we
were not given.

**Acceptance is external, not ours.** An order signed by the enclave must be accepted by
the 1inch API. "The signature matched" proves nothing on its own: a wrong field order
produces a cryptographically valid signature that the protocol rejects.

**Falsification is mandatory.** An order outside policy must be refused *before* signing,
and a weakened check must fail its own test.

### Phase 2 — Uniswap Permit2

The same, with a nested structure. A nested struct enters as its own hash — that is an
EIP-712 rule, not our invention. Policy: amount ceiling, short lifetime, allowed spender
only. The demonstrable point of the track, as planned: the enclave refuses to sign an
unlimited approval.

⚠️ Scoped precisely, per `specs/SPEC-permit2-signature-transfer.md`: that guarantee is
about **AllowanceTransfer**. `SignatureTransfer` has no such value to refuse.

Acceptance: the signature is accepted by Permit2 on a test network.

🔴 **Status as actually built, so this plan and the shipped code agree:** digest
construction and verification were written and match this plan's scope — see
`integrations/graph/src/permit2.js` and `FEEDBACK.md`. The policy step described above and
the signing itself were not built this window: no Permit2-aware code runs in the enclave or
gateway today, and Permit2 signing needs an enclave action that does not exist yet. The
demonstrable point stayed a plan, not a result.

### Phase 3 — 0G

🔴 **Cut, not built — and not a scope choice on our side.** 0G disappeared from ETHOnline's
own public prize roster on 28 August 2026; the individual prize page is still reachable, the
general prize list no longer carries it. We were planning to build against a track that
stopped being listed, and did not substitute a different 0G integration. The plan below is
kept as written, dated, rather than deleted, per the same rule the rest of this submission
holds to.

~~Not "we deployed a contract in their network" — a project that ports by changing an RPC
URL exists without them by definition, and their own criterion says so. The angle is their
mechanism: a provider key born inside a TEE, with attestation binding hardware to that key.
That is the same trust model as ours, on the other half of the loop. **0G decides what to
do; Signer decides whether to sign it.**~~

### Phase 3b — The Graph

A subgraph over the attestation registry's events, plus an agent layer that **asks** it
before deciding: "which code measurement is active right now?". A passive subgraph is not
enough and we are not pretending otherwise — the data has to be load-bearing for a
decision.

**Built, not just planned** — see `integrations/graph/`: a signed market-reference
snapshot plus the rule that refuses an order priced outside a band computed from it. The
angle that shipped is a price reading, not the registry-events subgraph sketched above —
we do not have a record of why it moved and are not guessing at one here.
`CONTINUITY.md` has the full account, including what the claim as first written
overreached on.

### Phase 3c — World ID (not on this plan when written, added after it shipped)

Our own slot, not in the phases planned above — added here because a plan that goes silent
on real, shipped work is as misleading as one that promises work never done. A gate:
before a signature is requested, check two on-chain registries for a human behind the
calling agent, and refuse to ask if none is found. World ID is the identity primitive that
registry check is built against. Status and the exact claim boundary — including what has
*not* been observed live — are in `CONTINUITY.md`.

### Phase 4 — demo

Three refusals and one success, in this order: amount over the ceiling → refused inside the
enclave, before signing. Unlimited approval → refused. Attempted withdrawal → refused.
Legitimate swap → signed → transaction on a test network, hash on screen.

Plus the frame that is the actual point: **here is the measurement of the running code, and
here is how to check it yourself.**

### Phase 5 — submission

README, video, tracks marked. The submission is filed by a human.

## What counts as failure, and that is fine

If external acceptance does not pass after Phase 1 and the reason is not found in
reasonable time, we stop and submit what we have. A negative result with an honest README
beats a demo that lies. This is written down in advance so that it is a decision rather
than an improvisation.

## Where the specs sit in this

`specs/` is read before code is written, not after. The three specs dated 2026-08-14 exist
because reading four protocol repositories carefully takes longer than the window allows,
and guessing produces integrations that sign the wrong bytes. `vectors/` is how we find out
whether a reading was right — two implementations that share nothing, plus the chain.
