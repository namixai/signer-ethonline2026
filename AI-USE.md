# Where AI was used, and how the prompts are handled

ETHGlobal allows AI and names Claude Code directly. It attaches three conditions: say
where it was used, don't let it build the project for you, and — if you work from specs —
put the specs, prompts and plans in the public submission repository. This file covers the
first condition; `plans/` and `specs/` cover the third.

## Where it was used

**Claude Code (Anthropic)**, running as a specialist session per department. In this
repository it did the work you can see: reading protocol sources, writing the specs,
implementing both verification paths, and drafting prose.

What it did not do: decide what to build, decide which prize tracks to enter, decide what
gets published, or spend money.

🔴 **A correction to what this file said until today.** It used to say "Every pull request
is reviewed and merged by a human", and that every finding from "two automated reviewers —
CodeRabbit and Gemini Code Assist" was handled by a human. **Both sentences were written to
fit a compliance template rather than to describe this repository, and both fail the first
check anyone would run.** Here is that check, as of 12 September, on all 25 pull requests:

- Every pull request is authored by one account, `namixai`, and every merged one was merged
  by that same account. There is no second party on either side of a merge.
- Not one review carries the `APPROVED` state. Every review state in the repository is
  `COMMENTED`.
- Eleven of the 25 — `#6`, `#7`, `#10` through `#16`, `#19`, `#20` — have no review record
  at all.
- Gemini Code Assist has never commented here. The only two participants on any pull
  request are `coderabbitai[bot]` (111 comments) and `namixai` (34).

**How it actually works, which we would rather be judged on.**

One account carries every commit and every merge, and it belongs to the person whose
project this is. The work is split across Claude Code sessions, one per area, and a session
does not merge its own work: a separate coordinating session reads the change, argues with
it, and decides. That gate is real — it has sent work back, and corrections in this
repository's history exist because of it — but it is another model session, not a second
human, and describing it as one would be the same overreach in a longer sentence.

The human decisions are the ones named above: scope, which tracks to enter, what may be
said in public, and any spending. Every payment behind the measurements in this repository
was made by hand, by him, after being shown the amount.

**The one automated reviewer, and what it was actually worth.** CodeRabbit comments on pull
requests here, and its findings are measured before they are accepted. Most were accurate
and were taken. Two worth naming: on `#17` it caught that a format check accepted `0x00…00`
and values at or above the secp256k1 group order, so an unusable key reached the signing
library — the fix, and the reason the refusal has to happen before that call, came out of
that thread. On `#22` it caught that an empty result was being reported as a saturated
ceiling.

The honest other half is that a bot finding accepted on authority is not review either. One
was refused with a reason on the record: it asked for pagination in a query where every
page is a paid request, a cost not visible from the diff. And one was right about the
defect while its proposed fix could not work as written — the deadline it suggested never
reaches the network, because the payment wrapper drops the abort signal it is given; that
was found by measuring, not by reading the suggestion.

## How the prompts are published

The prompts in `plans/prompts/` are the text that was actually given to the model. They
are written to be publishable from the start: no infrastructure addresses, no accounts, no
internal paths.

**Redaction policy, in one line:** redactions are limited to credentials and
infrastructure addresses; the wording of the task itself is never edited.

That matters more than it sounds. A prompt tidied up after the fact is a description of
work rather than a record of it, and the difference is exactly what the rule is asking
about. Where a prompt contains standing internal procedure — perimeter discipline, which
machine may be touched — that part is a department rule rather than a task, and it is out
of scope here rather than rewritten.

🔴 **What is missing from that directory, said before anyone has to notice it.** The three
prompts there are dated 14–16 August and cover the Permit2 and Uniswap reading. The work
done during the event window — the paid Graph integration, the World ID path, the demo and
the reel — was directed the same way, by written task orders, and **none of those are in
this repository.** The commit dates make the gap plain: 24 commits in August, then 22 more
across 3–11 September with no September prompt beside them. The reason is dull rather than
flattering: those orders are written in Russian in an internal channel, they carry other
departments' business and standing operational rules alongside the task, and splitting the
task out of them is an editing job nobody has done. Publishing them is a decision for the
person whose project this is, not something a model session gets to make on its own.

So read `plans/prompts/` as three real records, not as the complete set of direction. We
would rather hand a judge that sentence than a directory that quietly implies completeness.

**Which parts are AI-written — and whether that means a model built the project.** The
condition attached to the allowance is "don't let it build the project for you", so that
is the half answered first here. The file count comes underneath it, because a count
answers a narrower question than the rule asks.

**The thing being submitted is older than the event.** The signing path this submission
points at — a key generated inside the enclave, and a cap applied in the enclave before
signing rather than checked after — was exercised on live venues before ETHOnline
opened. On 16 August the enclave signed an order Hyperliquid accepted, and the cancel
was accepted too; the same policy that morning signed 0.010 BNB under its 0.041 cap and
refused 0.050 with `policy_denied`. Two of the three venues have a completed round trip
behind them, on 27 July and 19 August; the third has a signed order that was accepted
into the book and cancelled, never executed. `CONTINUITY.md` is the
component-by-component version of that, with dates, and it marks which rows predate the
window, which were cut during it, and which were written after 4 September — including
the ones where the window produced less than the plan promised. Nine days did not build
that, and nothing here claims they did.

**What the human decided, and what he argued with.** Scope: what gets built and what
gets refused. Which prize tracks to enter. What may be said in public, including every
claim in this file. And the money — every payment behind the measurements in this
repository was made by hand, by him, after being shown the amount. Then the part that
leaves no trace in a commit count: the arguing. Every correction marked 🔴 in these
documents is there because a claim was challenged and did not survive the challenge, not
because a model noticed on its own. This file carries such marks in three places — the
correction near the top, the September task orders that are not in this repository, and
the file count below — and the largest of them threw out two sentences it had been
carrying since it was created: "every pull request is reviewed and merged by a human",
and the one crediting two automated reviewers. Neither survived the first check anyone
would run.

**The measurement, since the rule asks for files rather than areas.** Through 12
September this repository tracked 100 files. Ninety-nine of them — everything under
`integrations/`, `vectors/`, `demo/`, `specs/`, `plans/`, `scripts/` and `.github/`,
every Markdown document at the top level including this one, and `.gitignore` — were
written by Claude Code sessions. The hundredth is `LICENSE`, which is the Apache License
2.0 verbatim and nobody's authorship. There is no hand-written module hiding in here,
and no file where a human typed the code and a model typed the comments.

🔴 **It tracks 108 as of 13 September, and the eight new files get their own sentence.**
`demo/reel/` gained a step runner, a balance reader and three slides with their SVG
sources. They were found as untracked files in the checkout the video is being filmed
from and committed here as they were: this file counted them and did not measure who
typed them, which is duller than folding them into the ninety-nine and is the only
version of the sentence it can stand behind. None of the eight is product code — the
runner invokes commands that were already in this repository, and the reader makes one
`balanceOf` call.

## Honest note about the boundary

Some of this material was written before the event window opened. It is dated where it
sits, and `CONTINUITY.md` lists it. The reason it exists early is dull: reading four
protocol repositories carefully takes longer than nine days leaves room for, and guessing
instead would have produced integrations that sign the wrong bytes.
