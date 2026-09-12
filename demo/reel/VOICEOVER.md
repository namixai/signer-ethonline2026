# Voiceover — the reel, read by a person

**Who reads it:** Alex, over the finished footage. ETHGlobal forbids synthesized or AI
voices, and forbids a silent screencast with text cards instead of talking. It does **not**
require the voice to be recorded in sync with the screen — that gap is why this file exists:
the footage is finished, the voice goes on top, and a fluffed line is re-read, not re-shot.

**How to use it.** Play the reel, read the column marked *SAY* out loud, start each block
when the screen reaches the cue. Every block is written short on purpose: if you finish
early, stop and let the terminal breathe. Silence reads as confidence; rushing does not.

⚠️ Do not speed the video up to fit, and do not speed your reading up either. If a block
runs long, cut a sentence — every block below has one sentence that can go, marked `[cut]`.

---

## Act 1 — the window's work: reading The Graph (0:00 – 2:41)

| cue | on screen | SAY |
|---|---|---|
| 0:00 | title, step 1 appears | "This is Usenami Signer. An agent brings a ready order. An enclave checks it against the owner's policy, then signs it — or refuses. The product is older than this hackathon. This part was written during it." |
| 0:17 | `the gateway asks 0.01 USDC on eip155:8453` | "The agent needs a price. It asks The Graph. No API key, no account — the gateway answers with a bill, and the agent pays it. One cent, in USDC, on Base." |
| 0:34 | `responseCID matched: true` | "The answer arrives signed by the indexer who served it. We check that signature over the exact bytes. Re-serialise the JSON and the hash changes — so we keep the bytes." |
| 0:51 | `staked indexer: 0x…` | "And we ask the chain who that signer is. A staked indexer, with the allocation for this exact subgraph. `[cut]` The enclave itself cannot do this — it has no network." |
| 1:09 | step 4, `same answer, TSLAon → REFUSED` | "Now the part that does not follow. A verified signature does not mean you got a price. Same answer, same attestation, three tokens priced zero. Legitimate — and useless as a reference. So we refuse." |
| 1:26 | step 5, stale price | "Here is the trap. The head is fresh; the price is a year old. Prices are written in event handlers, so a dead market keeps a dead price under green indexing. Two ages, measured apart." |
| 1:43 | step 6, band and REFUSED | "Then the decision. A snapshot, signed verbatim, that states what we did **not** check as well as what we did. An honest price passes. A price twice that is refused." |
| 2:00 | step 7, the gate | "And the gate. An agent with no registered human behind it gets no signature. A change of behaviour, not a log line. `[cut]` And 'no human' is not 'we could not ask'. Different reasons, because the fix is different." |
| 2:17 | step 8, the boundary | "One boundary, said out loud: all of this runs outside the enclave, before a signature is requested. We do not claim the enclave did it." |
| 2:35 | screen holds | *(silence — let the last frame sit)* |

## Act 2 — the standardized schema (2:42 – 3:03)

| cue | on screen | SAY |
|---|---|---|
| 2:42 | `npm run leverage` output, then the JSON | "The subgraph we read is a Messari Standardized Subgraph. We did not pick it for the prize; we were already on it and did not know. The same query, unchanged, runs on other chains. The part we cannot fake: two independent indexers attested the same request digest. They say so, not us." |

## Act 3 — a stranger checks the running enclave (3:04 – 3:37)

| cue | on screen | SAY |
|---|---|---|
| 3:04 | frame 3 header, nonce | "Last, the part that needs nothing from us. No account, no token, no permission." |
| 3:14 | `pcr0_sha384`, attestation doc | "The service returns a measurement of the code it is running, signed by the hardware." |
| 3:22 | the `cast call`, its answer, then the closing lines | "Ask the registry on Base whether it is active — and read what it actually says, with the owner address beside it. 🔴 **READ THE SCREEN. THIS SCRIPT DOES NOT KNOW THE ANSWER AND MUST NOT PRETEND TO.** Three things can appear and they are not the same: **true** with an owner you recognise, which is the pass; **false**, which is worth one calm sentence — the registry keeps one active measurement per owner, so another of our lanes *may* be holding it at that moment; and **a failed call**, which is a could-not-check and not a false at all, so say that instead of reading it as a refusal. Close on the check that needs no registry: rebuild from the public clone, and compare." |

---

## If a block will not fit

Cut in this order, and stop as soon as it fits: every `[cut]` line, then the second sentence
of Act 2's first block, then Act 3's 3:14 block entirely. Do **not** cut the boundary line at
2:17 or the registry reading at 3:22 — those two are the honesty of the whole reel, and a
reel that drops them is selling something else. (That line used to be called "the false
explanation", from when the registry answered false; the point was never the word, it was
reading the chain out loud instead of telling the viewer what it would say.)

## What is deliberately not said

- No "the enclave refused because the price was bad." The band is computed outside.
- No "Signer signs Permit2." There is no enclave action for it yet.
- No "attested market data." The indexer signs **what it answered**, not that it is true.
