# Where AI was used, and how the prompts are handled

ETHGlobal allows AI and names Claude Code directly. It attaches three conditions: say
where it was used, don't let it build the project for you, and — if you work from specs —
put the specs, prompts and plans in the public submission repository. This file covers the
first condition; `plans/` and `specs/` cover the third.

## Where it was used

**Claude Code (Anthropic)**, running as a specialist session per department. In this
repository it did the work you can see: reading protocol sources, writing the specs,
implementing both verification paths, and drafting prose.

What it did not do: decide what to build, decide which prize tracks to enter, or merge
anything. Every pull request is reviewed and merged by a human. Public claims pass a
separate evidence gate before they are published anywhere.

Two automated reviewers — CodeRabbit and Gemini Code Assist — comment on pull requests.
Their findings are accepted, argued with, or rejected with a reason, by a human.

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

## Honest note about the boundary

Some of this material was written before the event window opened. It is dated where it
sits, and `CONTINUITY.md` lists it. The reason it exists early is dull: reading four
protocol repositories carefully takes longer than nine days leaves room for, and guessing
instead would have produced integrations that sign the wrong bytes.
