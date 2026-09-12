# What these recordings are, and why their `requestCID`s differ

Three `requestCID` values live in this directory and in `../../LEVERAGE-EVIDENCE.md`, and
a reader who notices that before reading this file may reasonably think they have found a
contradiction. They have not, and the explanation is worth writing down rather than leaving
to be re-derived:

| recording | `requestCID` | when |
|---|---|---|
| `sample1.*`, `live-2026-09-04.*` | `0x8767a4b2…` | 1 and 4 September |
| `sample2.*` | `0xb55405a7…` | a different query — this is the GraphQL-error sample |
| the measurement in `LEVERAGE-EVIDENCE.md` | `0x32edaff5…` | 7 September |

🔴 **The `requestCID` is computed over the request, so a different query gives a different
value — that is the whole point of it.** These fixtures were recorded before `PRICE_QUERY`
reached its current wording, and nothing in that wording has moved since the 7 September
measurement. So the three values are three questions, not three answers to one question.

**What this is not.** It is not indexers disagreeing about the same request — that would be
the interesting failure, and it is the one `LEVERAGE-EVIDENCE.md` rules out by comparing
CIDs from independent indexers *within one run*. The early recordings simply predate the
query they are being compared against, and were never marked as such until now.

**Why they are kept anyway.** Two of them — `sample1` and `live-2026-09-04` — are live paid
answers, saved byte for byte, and the suite asserts their hash reproduces the `responseCID`
the indexer signed. That check is about the answer, not the request, so an older query does
not weaken it. `sample2` exists precisely because it is a correctly attested, normally
billed response that carries a GraphQL error and no data: proof that a verified signature
is not a price.

**If you re-record any of these,** the new `requestCID` will differ again, and that is
expected. What must not change silently is `PRICE_QUERY` itself — `../../src/fetch.js` explains
why, and a test asserts its bytes.
