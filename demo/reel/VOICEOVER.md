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

⚠️ **What this file is, so it is not mistaken for a record of work already done:** a
script, not a record of the take. It says what to read; it does not say whether anything
was read.

🔴 **And it deliberately no longer answers "has this been filmed".** Until 13 September it
said "nothing has been filmed yet" — true when written, and a sentence that turns into a
lie in a public repository the moment somebody presses record. Before it, another version
said "the footage is finished", which was false in the other direction. A moving fact kept
in two files goes stale in one of them, and the one a reader happens to open is the one
that misleads.

So the answer lives where it can be checked instead of asserted: the submitted entry either
carries a video or it does not, and a judge can see which without our help. `CONTINUITY.md`
tracks the intent with a date. This file stays a script.

**How to use it.** Play the reel, read the column marked *SAY* out loud, start each block
when the screen reaches the cue. Every block is written short on purpose: if you finish
early, stop and let the terminal breathe. Silence reads as confidence; rushing does not.

⚠️ Do not speed the video up to fit, and do not speed your reading up either. If a block
runs long, cut a sentence — every block below has one sentence that can go, marked `[cut]`.

---

## Act 1 — the window's work: reading The Graph (0:00 – 1:59)

🔴 **Act 1 was 2:41 and is now 1:59.** Forty-two seconds were taken out of it to pay for
Act 3, which did not exist and had to: we enter a Uniswap track and the reel showed nothing
from it. What paid for it, in the order this file's own cut list prescribes — both `[cut]`
lines, and the merge of two blocks that were halves of one idea (the signature, and who the
signer is). Nothing was dropped that a judge needs; the silent hold at the end went too,
and the boundary line now breathes into the act change instead.

| cue | on screen | SAY |
|---|---|---|
| 0:00 | title, step 1 appears | "Usenami Signer. An agent brings a ready order; an enclave checks it against the owner's policy, then signs — or refuses. The product is older than this hackathon; this part is not." |
| 0:14 | `the gateway asks 0.01 USDC on eip155:8453` | "The agent needs a price. It asks The Graph. No API key, no account — the gateway answers with a bill, and the agent pays it. One cent, in USDC, on Base." |
| 0:28 | `responseCID matched: true`, then `staked indexer: 0x…` | "The answer arrives signed by the indexer who served it, and we check that signature over the exact bytes — re-serialise the JSON and the hash moves. Then we ask the chain who signed: a staked indexer, holding the allocation for this subgraph." |
| 0:47 | step 4, `same answer, TSLAon → REFUSED` | "Now the part that does not follow. A verified signature does not mean you got a price. Same answer, same attestation, three tokens priced zero. Legitimate — and useless as a reference. So we refuse." |
| 1:03 | step 5, stale price | "Here is the trap. The head is fresh; the price is a year old. Prices are written in event handlers, so a dead market keeps a dead price under green indexing. Two ages, measured apart." |
| 1:19 | step 6, band and REFUSED | "Then the decision. A snapshot canonical to the byte — the exact text an enclave would sign, though nothing here signs it — stating what we did **not** check as well as what we did." |
| 1:34 | step 7, the gate | "And the gate. An agent with no registered human behind it gets no signature — a change of behaviour, not a log line. And 'no human' is not 'we could not ask'." |
| 1:48 | step 8, the boundary | "One boundary, out loud: all of this runs outside the enclave, before a signature is requested. We do not claim the enclave did it." |

## Act 2 — the standardized schema (1:59 – 2:21)

| cue | on screen | SAY |
|---|---|---|
| 1:59 | `npm run leverage` output, then the JSON | "The subgraph is a Messari Standardized Subgraph. We did not pick it for the prize; we were already on it and did not know. The same query runs unchanged on other chains. The part we cannot fake: two independent indexers attested the same digest — they say so, not us." |

## Act 3 — Permit2: the encoding checked against someone else's implementation (2:21 – 3:04)

🔴 **This act did not exist until 13 September, and its absence was the sharpest hole in the
reel.** We enter a Uniswap track, our contribution to it is the vector set, and a judge
watching the video would not have seen one frame of it. Alex found that while sitting down
to film, which is the worst moment to find it and the only one left.

| cue | on screen | SAY |
|---|---|---|
| 2:21 | `cd vectors && make verify`, the CAUGHT lines scrolling | "Now the Uniswap half. Permit2's digest, rebuilt from the spec by our own encoder against pinned cases — then defects planted in it, every one caught. No key, no network." |
| 2:34 | the `tokenId/nonce transposed` line | "One of those defects is the one types cannot see: tokenId and nonce transposed, both uint256. Nothing in the vector set catches that on its own." |
| 2:46 | `onchain_fieldorder.mjs`, both ok lines | "So we let the deployed contract decide. Permit2 accepted a signature over our digest and rejected the mis-ordered one with InvalidSigner. The boundary: nothing here signs a Permit2 payload. We checked the encoding — against Uniswap's SDK, and against the chain." |

🔴 **The line that must not slip, and it is the easiest one in the reel to slip.** Do **not**
say "we sign Permit2", "the enclave signs Permit2", or anything a listener can round up to
either. `README.md` states that no Permit2 signing action exists in this submission, and the
spoken words have to match the written ones — a reel that overstates what the repository
admits is worse than a reel that shows nothing.

## Act 4 — a stranger checks the running enclave (3:04 – 3:47)

| cue | on screen | SAY |
|---|---|---|
| 3:04 | frame 3 header, fresh nonce | "Last, the part that needs nothing from us. No account, no token, no permission." |
| 3:14 | the six checks, all green | "The service returns a measurement of the code it is running, signed by the hardware — and we open that signature, not the number printed beside it." |
| 3:26 | the `cast call` and its answer | "Then the registry on Base: is that measurement active? Read the answer off the screen — it is the chain's, not ours." |
| 3:37 | the closing lines | "And the check that needs no registry is the one to judge us on: rebuild from the public clone, and compare." |

---

## Measuring the pace instead of feeling it

The reel is 3:47, and it stays 3:47 after Act 3 was added — the time came out of Act 1
rather than off the end, because the ceiling is not a guideline: an upload over four minutes
is rejected by the uploader, not marked down by a judge.

```bash
python3 demo/reel/check-pace.py demo/reel/VOICEOVER.md 145 227
python3 demo/reel/check-pace.py demo/reel/VOICEOVER.md 135 227   # the stricter read
```

The second argument is the ceiling in words per minute and 227 is the reel in seconds —
pass it, or the last block gets an invented window, and the last block is where a script
overruns.

**As of 13 September: 487 words over 227 seconds, 129 words per minute, zero blocks over
the limit at 145 — and zero at 135 as well.**

🔴 **Why the 135 run is here and not just the 145 one.** Adding an act without lengthening
the reel puts pressure on every block, and the first draft of this change passed at 145
while SEVEN blocks sat above 135. The script's own header says a comfortable read is
130–150 and **lower for a second language**, which is the case here. Passing the looser
check while failing the tighter one is the shape of a script that reads fine to whoever
wrote it and fights the person holding the microphone. Fifteen words came out across those
seven blocks; nothing in them was substance.

## If a block will not fit

Cut in this order, and stop as soon as it fits: the second sentence of Act 2's block, then
the 3:26 registry block — the screen carries that one on its own. Do **not** cut the
boundary line at 1:48, the Permit2 boundary at 2:46, the "not the number printed beside it"
clause at 3:14, or the rebuild line at 3:37. Those four are the honesty of the whole reel,
and a reel that drops them is selling something else.

⚠️ **The `[cut]` lines are gone, and that is why this list starts one item later.** Both of
them were spent on 13 September to pay for Act 3 — that is what they were reserved for.
There is no slack left of that kind, so the next thing that does not fit costs a sentence
somebody wanted.

🔴 Two earlier versions of this list were wrong about their own file. One named "Act 3's
2:24 block" when Act 3 had no 2:24 block. Another protected a line saying the registry
answers `false`; the registry answers what it answers on the day, and the reel now tells
the viewer to read it rather than predicting it out loud. The cue times above were
re-checked against the table on 13 September, after the acts were renumbered.

## Act 3 runs in half a second — how it is slowed, and what to install first

Measured on 13 September: `make verify` finishes in **0.53 s** and `onchain_fieldorder.mjs`
in **0.7 s**. On camera that is a flicker, and a flicker is not evidence — a judge cannot
read what they cannot see.

The reel is recorded with the output **paced line by line**, the same idea `demo.sh` uses
with `DEMO_PAUSE_MS` and for the same reason: the recording must be a REAL run slowed down,
never a fast run with timings painted on afterwards.

```bash
cd vectors
make verify 2>&1 | while IFS= read -r l; do printf '%s\n' "$l"; sleep 0.35; done
node onchain_fieldorder.mjs 2>&1 | while IFS= read -r l; do printf '%s\n' "$l"; sleep 0.5; done
```

Measured with the pause: the `make verify` run takes **15.2 s** — comfortably inside the
13-second block plus the pause at the act change, and the scroll is readable rather than a
blur. Nothing about what runs changes; only when each line appears.

⚠️ **If the recording is driven by a step runner that waits for Enter between commands, the
pacing above still applies inside each command.** The two solve different problems: a runner
removes the dead air BETWEEN steps — the seconds where nothing happens and which cannot be
cut out afterwards, since speeding the video up is forbidden — while the line pause removes
the flicker WITHIN one step. A runner alone still gives you half a second of unreadable
scroll where this act's evidence is supposed to be.

⚠️ **Install the vector dependencies before filming, or the second command fails on camera.**
`onchain_fieldorder.mjs` needs `@uniswap/permit2-sdk` and `viem`, and a fresh clone has no
`node_modules`. It fails with `ERR_MODULE_NOT_FOUND` and a stack trace — which is what
happened to me on this very checkout while preparing this act:

```bash
cd vectors && npm ci     # or npm install; ~10 s, once
```

`make verify` needs none of that — python standard library only, which is why it is the
first screen of the act rather than the second.

## What is deliberately not said

- No "the enclave refused because the price was bad." The band is computed outside.
- No "Signer signs Permit2", and Act 3 is where that would be easiest to say by accident.
  There is no enclave action for it in this submission — `README.md` says so in writing, and
  the spoken words have to match the written ones. What Act 3 shows is the ENCODING checked
  against Uniswap's own SDK and against the deployed contract. "We checked the encoding" and
  "we sign it" are one careless sentence apart, and the careless one is shorter.
- No "attested market data." The indexer signs **what it answered**, not that it is true.
- No "signed snapshot." The snapshot is canonical and signable; the signing key lives in an
  enclave this submission does not carry, and `integrations/graph/package.json` says so in
  its own description. An earlier take of the 1:43 line said "signed verbatim" — three
  words that would have claimed the one thing we do not do here.
- No prediction of the registry's answer. Frame 3 reads it live; a script that says the
  answer in advance is a script that can be wrong on camera, and on 12 September the old
  line already was — it said `false`, and the chain said `true`.
