# Prompt 01 — 2026-08-14 — Permit2 and the Uniswap execution path

**Executed by:** Claude Code (Opus), department session "signer-hackathon".
**Produced:** `specs/SPEC-permit2-signature-transfer.md`,
`specs/SPEC-uniswap-execution-path.md`, `specs/SPEC-enclave-guarantee-boundary.md`,
the whole of `vectors/`, and this repository skeleton.
**Authored before the event window** and disclosed here — see `CONTINUITY.md`.

Published as executed. Per `AI-USE.md`, redactions are limited to credentials and
infrastructure addresses; the wording of the task itself is not edited. One paragraph is
withheld on that basis and marked inline.

---

## Original text (Russian, as given)

> Читай В ПОРЯДКЕ, всё с origin/main: [internal index] → [hackathon roadmap] →
> [report protocol]. Предыдущее окно сдало 12.08: [internal report].
>
> ЗАДАЧА (фундамент августа, интеграцию в энклав в августе НЕ писать — §правила
> роадмапа): разобрать семью EVM/AMM, которой у нашего подписанта нет. По
> ПЕРВОИСТОЧНИКАМ — контракты и исходники, не доки, как ты уже сделал с 1inch Fusion
> 04.08 (домен роутера, порядок полей из строки типа). Три вопроса:
>
> 1. Permit2 (AllowanceTransfer и SignatureTransfer): что именно подписывает агент, какие
>    поля несут ограничение (amount, expiration, sigDeadline, spender) и какие из них
>    энклав может резать политикой, ничего не зная о внешнем мире.
> 2. Uniswap: путь исполнения свопа (UniversalRouter / PoolManager v4) — что подписывается,
>    а что идёт просто calldata; адреса контрактов на Base и mainnet.
> 3. Граница честности: что энклав НЕ гарантирует — цена исполнения, MEV, проскальзывание.
>    Сформулируй так, как это пойдёт наружу, но НЕ публикуй: клеймы через гейт CTO.
>
> КРИТЕРИЙ ПРИЁМКИ: спека + тестовые векторы, воспроизводимые offline — дигест считается
> ДВУМЯ независимыми путями (наш код и эталонный SDK), расхождение = находка. Плюс
> публичный репозиторий-скелет: спеки и промты лежат там с первого дня, это требование
> правил про ИИ.
>
> [Withheld: one paragraph of standing perimeter discipline — which machine the department
> may work on and how it identifies itself. Department procedure, not part of the task.]
>
> PR-first, своя ветка, мержу я. Отчёт по протоколу.

## English summary of what was asked

Take apart the EVM/AMM signing family the signer does not support yet, working from
primary sources — the contracts themselves, not the documentation — the same way the
1inch Fusion analysis was done on 2026-08-04, where the useful facts turned out to be that
the domain belongs to the router and that the canonical field order comes from the type
string rather than from any SDK object.

Three questions. What exactly does an agent sign in Permit2, across both AllowanceTransfer
and SignatureTransfer; which fields actually carry a constraint; and which of those an
enclave can enforce knowing nothing about the outside world. Then the Uniswap swap path:
what is signed and what is merely calldata, with contract addresses on Ethereum and Base.
Then the honesty boundary — what the enclave does not guarantee: execution price, MEV,
slippage — written the way it will read outside, but not published: claims go through an
evidence gate first.

Acceptance: a spec plus test vectors reproducible offline, with each digest computed along
two independent paths — our own code and a reference SDK — and any divergence treated as a
finding rather than smoothed over. Plus this repository skeleton, so that specs and prompts
are in a public repository from day one, which the AI rules require.

Explicitly out of scope for August: writing the enclave integration itself. August is
foundation; the integrations are written inside the event window.

## What the model did with it

Read the four Uniswap repositories at pinned commits, checked every address claim against
deployed bytecode rather than documentation, built both verification paths, and wrote the
three specs. Two defects surfaced during the work and are recorded where they happened
rather than tidied away: JSON number precision silently corrupting `type(uint160).max`
between the two paths (`vectors/README.md`), and the first version of `scrub-check.sh`
reporting "clean" on a directory whose files were all still untracked.
