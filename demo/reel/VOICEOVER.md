# Voiceover — the reel, read by a person

**Who reads it:** Alex, over the footage, once there is footage. The rule is **ETHOnline
2026's**, not a general ETHGlobal one, and it is worth quoting from its own page rather
than paraphrasing: under "Common mistakes to avoid in your demo video" the event says *do
not use a text to speech synthesizer / AI Voiceover*, and *do not play music with text on
the video describing your project (instead of talking)*. Source, checked 12 September:
<https://ethglobal.com/events/ethonline2026/info/details>. Nothing there requires the
voice to be recorded in sync with the screen — that gap is why this file exists: the
footage gets shot first, the voice goes on top afterwards, and a fluffed line is re-read
rather than re-shot.

🔴 **Before recording anything, the constraints that reject an upload rather than cost a
point.** All four are from the same page, and none of them was written down anywhere in
this repository until 12 September — which is how a re-shoot gets discovered on deadline
day:

| the rule | what happens if it is broken |
|---|---|
| between 2 and 4 minutes | upload is **automatically rejected** outside those bounds |
| at least 720p | upload **fails** below it |
| no mobile phone as the camera | asked to re-submit |
| no speeding the video up to fit | asked to re-submit |

This script is paced for 3:47, which leaves thirteen seconds of margin under the ceiling
and is nowhere near the floor. If a block gets cut on the day, check the total is still
over two minutes before exporting.

⚠️ **State, so this file is not mistaken for a record of work already done:** nothing has
been filmed yet. This is a script waiting for a take, and `CONTINUITY.md` says the same in
its own table. An earlier version of the line above read "the footage is finished", which
described the intended order of work but sounded like a claim about what exists.

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
| 1:43 | step 6, band and REFUSED | "Then the decision. A snapshot canonical to the byte — the exact text an enclave would sign, though nothing here signs it — stating what we did **not** check as well as what we did. An honest price passes; twice that, refused." |
| 2:00 | step 7, the gate | "And the gate. An agent with no registered human behind it gets no signature. A change of behaviour, not a log line. `[cut]` And 'no human' is not 'we could not ask'. Different reasons, because the fix is different." |
| 2:17 | step 8, the boundary | "One boundary, said out loud: all of this runs outside the enclave, before a signature is requested. We do not claim the enclave did it." |
| 2:35 | screen holds | *(silence — let the last frame sit)* |

## Act 2 — the standardized schema (2:42 – 3:03)

| cue | on screen | SAY |
|---|---|---|
| 2:42 | `npm run leverage` output, then the JSON | "The subgraph we read is a Messari Standardized Subgraph. We did not pick it for the prize; we were already on it and did not know. The same query, unchanged, runs on other chains. The part we cannot fake: two independent indexers attested the same request digest. They say so, not us." |

## Act 3 — a stranger checks the running enclave (3:04 – 3:47)

| cue | on screen | SAY |
|---|---|---|
| 3:04 | frame 3 header, fresh nonce | "Last, the part that needs nothing from us. No account, no token, no permission." |
| 3:14 | the five checks, all green | "The service returns a measurement of the code it is running, signed by the hardware — and we open that signature, not the number printed beside it." |
| 3:26 | the `cast call` and its answer | "Then the registry on Base: is that measurement active? Read the answer off the screen — it is the chain's, not ours." |
| 3:37 | the closing lines | "And the check that needs no registry is the one to judge us on: rebuild from the public clone, and compare." |

---

## Measuring the pace instead of feeling it

The reel is 3:47. Every block below fits at a comfortable read, and that is a measurement,
not an impression:

```bash
python3 demo/reel/check-pace.py demo/reel/VOICEOVER.md 145 227
```

145 words per minute is the ceiling, 227 is the reel in seconds — pass it, or the last
block gets an invented window and the last block is where a script overruns. As of
12 September: 434 words over 227 seconds, 115 words per minute, zero blocks over the
limit. The 3:22 block used to run at 216, which is not a read, it is a sprint.

## If a block will not fit

Cut in this order, and stop as soon as it fits: every `[cut]` line, then the second sentence
of Act 2's first block, then the 3:26 registry block — the screen carries that one on its
own. Do **not** cut the boundary line at 2:17, the "not the number printed beside it" clause
at 3:14, or the rebuild line at 3:37. Those three are the honesty of the whole reel, and a
reel that drops them is selling something else.

🔴 An earlier version of this list named "Act 3's 2:24 block", and Act 3 has never had a
2:24 block. It also protected a line that said the registry answers `false`; the registry
answers what it answers on the day, and the reel now tells the viewer to read it rather
than predicting it out loud.

## What is deliberately not said

- No "the enclave refused because the price was bad." The band is computed outside.
- No "Signer signs Permit2." There is no enclave action for it yet.
- No "attested market data." The indexer signs **what it answered**, not that it is true.
- No "signed snapshot." The snapshot is canonical and signable; the signing key lives in an
  enclave this submission does not carry, and `integrations/graph/package.json` says so in
  its own description. An earlier take of the 1:43 line said "signed verbatim" — three
  words that would have claimed the one thing we do not do here.
- No prediction of the registry's answer. Frame 3 reads it live; a script that says the
  answer in advance is a script that can be wrong on camera, and on 12 September the old
  line already was — it said `false`, and the chain said `true`.
