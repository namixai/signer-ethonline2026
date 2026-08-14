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

**Research done in August, before the window, is in this repository under its real dates.**
That means the three specs in `specs/` and the whole of `vectors/`, all dated 2026-08-14,
plus the earlier August specs imported as the window opens. They are research and test
material — not submission code. The reason they exist early is dull: reading four protocol
repositories carefully takes longer than nine days leaves room for, and guessing instead
produces integrations that sign the wrong bytes.

**The integrations are written in the window, from scratch, already knowing how.** So are
the verifier page, the demo, and the submission README. The August prototypes are named in
`CONTINUITY.md` and do not ship as code.

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
It runs in one command and needs no account, no key and no network.

## Specs

| file | what it settles |
|---|---|
| `specs/SPEC-permit2-signature-transfer.md` | Both halves of Permit2 — AllowanceTransfer and SignatureTransfer — what the signature actually binds, and what it doesn't |
| `specs/SPEC-uniswap-execution-path.md` | Where a Uniswap swap is signed and where it is only calldata; verified addresses on Ethereum and Base |
| `specs/SPEC-enclave-guarantee-boundary.md` | What the enclave does not promise: price, MEV, slippage |

## Verify the product itself, not just this repo

The interesting claim is not in this repository. It is that you can rebuild the enclave
image from a clean public clone and get the same measurement the live service reports.
That procedure lives in [namixai/signer](https://github.com/namixai/signer), and it is
the one thing worth an hour of a reviewer's time.

## AI

Claude Code wrote a large part of this repository. `AI-USE.md` says where, and the prompts
are in `plans/prompts/` — the text that was actually executed, not a cleaned-up version.

## Licence

Apache-2.0. Everything new here stays open source.
