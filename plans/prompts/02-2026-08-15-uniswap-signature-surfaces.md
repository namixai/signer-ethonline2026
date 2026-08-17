# Prompt 02 — 2026-08-15 — the other half of the Uniswap picture

**Executed by:** Claude Code (Opus), department session "signer-hackathon".
**Produced:** `specs/SPEC-uniswap-signature-surfaces.md`, the correction to
`specs/SPEC-uniswap-execution-path.md` §4, and the `nft-*` half of `vectors/`.
**Authored before the event window** and disclosed here — see `CONTINUITY.md`.

Published as executed. Per `AI-USE.md`, redactions are limited to credentials and
infrastructure addresses; the wording of the task itself is not edited. Nothing was
withheld from this one.

---

## Original text (Russian, as given)

> Новая задача — доделать вторую половину картины по Uniswap, ту, что ты сам вскрыл.
>
> Ты нашёл F1: `executeSigned` из `main` универсального роутера **не задеплоен** на боевых
> адресах. Значит вопрос «что именно наш энклав будет подписывать для свопа» остаётся
> открытым, а без ответа сентябрьская интеграция пишется вслепую. Разбери по
> первоисточникам:
>
> 1. **Что в сегодняшнем пути свопа вообще подписывается**, а что идёт просто calldata от
>    отправителя транзакции. Моё рабочее понимание: подписывается Permit2
>    (SignatureTransfer / AllowanceTransfer), а вызов роутера — нет. Подтверди или
>    опровергни кодом, с адресами и строками.
> 2. **Где в этом пути может стоять наша политика** — какие поля реально ограничивают
>    (токен, сумма, получатель, срок, spender), и что из этого энклав может проверить,
>    ничего не зная о внешнем мире.
> 3. 🔴 **Что мы НЕ сможем гарантировать** — цену исполнения, MEV, проскальзывание.
>    Сформулируй так, как это пойдёт наружу, но не публикуй: клеймы через гейт.
> 4. **Тестовые векторы** на то, что подписывается, тем же способом, что и в первой части:
>    два независимых пути расчёта дигеста плюс мутации.
>
> Интеграцию в энклав в августе не пишем — правило роадмапа в силе. Спеки и векторы
> кладёшь в публичный репозиторий, историю коммитов держишь честной.

## English summary of what was asked

Finish the half of the Uniswap picture the previous pass opened up. That pass established
that `executeSigned` — the route-level signature in the router's `main` branch — is not
deployed at the live addresses, which leaves the question of what an enclave would actually
sign for a swap unanswered, and an unanswered question there means the September
integration gets written blind.

Four things, from primary sources. What in today's swap path is covered by a signature and
what is merely calldata from the transaction sender — the working hypothesis being that
Permit2 is signed and the router call is not, to be confirmed or refuted with code,
addresses and line numbers. Where our policy can sit, which fields genuinely constrain
anything, and which of those an enclave can check knowing nothing about the outside world.
What we will not be able to guarantee — execution price, MEV, slippage — written the way it
will read outside but not published, since claims go through an evidence gate. And test
vectors over whatever turns out to be signed, built the same way as the first set: two
independent paths to each digest, plus mutations.

Still out of scope for August: writing the enclave integration.

## What the model did with it

Confirmed the hypothesis in the main and refuted it in the detail. The router call is
indeed unsigned. But signature consumption is not one command — it is three, plus a fourth
route through nesting, and the third of them (`V3_POSITION_MANAGER_PERMIT`) hands an
ERC-721 permit to a contract whose EIP-712 domain is shaped differently from Permit2's.

The finding that justified the whole pass: Uniswap v3 and v4 position managers share the
struct type hash `0x49ecf333…` and disagree about the domain, so an identical message
produces an identical struct hash and a different digest.

A fan-out of five readers plus adversarial verifiers ran over the surfaces; three of its
claims were refuted as over-general and the corrected versions were used instead. Every
load-bearing claim in the spec was then re-verified by hand against the pinned sources and,
where possible, against the deployed contracts.
