# Continuity — what existed before ETHOnline 2026, and what is written in the window

Kept from day one rather than assembled before the deadline. That is what the Continuity
track asks for, and it is also the only version of this document worth writing: a
submission that passes off a pre-existing product as nine days of work is a lie that the
commit history exposes anyway.

**Last updated:** 2026-08-14.

## The position in one sentence

Usenami Signer is an **existing product**. It is months older than the hackathon and it is
publicly verifiable. At ETHOnline 2026 we write the **integration** between that product
and the protocols of the track, and we write it in the window, in this repository.
Knowledge gathered before the event is not hidden — it is here, dated.

## What existed BEFORE the event (not claimed as hackathon work)

| component | state before | public confirmation |
|---|---|---|
| **Signer enclave** — signing inside AWS Nitro, key never leaves | in development since May 2026, live service | public build repository, reproducible PCR0 |
| **Reproducible build + attestation** | PCR0 rebuilds from a clean clone; a live NSM COSE document is served | `signer-demo.usenami.io/attestation` |
| **EIP-712 signing (Hyperliquid)** | in production | sources in the public repository |
| **`sign_data`** — data signed by a separate attested key | designed 06.2026, implemented in the main lane | design documents in the repository |
| **attested-snapshot** — a signed market snapshot | schema contract v2, July 2026 | contract + public verification page |
| **Policy before signature** — limits applied in the enclave before signing | in production on CEX venues | sources |

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
| **2026-08-14** | **Permit2 test vectors** — 11 cases, two independent implementations, an on-chain anchor, six falsification mutations | bench (`vectors/`), does not ship as submission code |
| **2026-08-14** | this repository created, with the August material imported under its real dates | disclosure, which is the point |

## What will be written IN THE WINDOW (from 4 September)

- The 1inch Fusion and Uniswap Permit2 integrations — **written fresh**, already knowing how.
- Integration with 0G Compute TEE (the agent's reasoning half).
- "Data as a policy input": snapshot signature checked, freshness judged by enclave time,
  refusal before signing.
- The verifier page.
- README for the submission, the demo video, and the remaining spec artefacts.

## Public spec artefacts (the set is kept from day one)

| file | written |
|---|---|
| `specs/SPEC-permit2-signature-transfer.md` | 2026-08-14 |
| `specs/SPEC-uniswap-execution-path.md` | 2026-08-14 |
| `specs/SPEC-enclave-guarantee-boundary.md` | 2026-08-14 |
| `vectors/` (cases, both verifiers, falsification, on-chain anchor) | 2026-08-14 |
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
- **Dates do not move.** If a component existed before the event, it says so.
