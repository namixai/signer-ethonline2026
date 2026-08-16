# Prompt 03 — 2026-08-16 — the live run, and the field-order gap

**Executed by:** Claude Code (Opus), department session "signer-hackathon".
**Produced:** the live-run paragraphs in `README.md` and `CONTINUITY.md`,
`vectors/onchain_fieldorder.mjs`, `vectors/digest_permit_single.py`, the transposition
mutations in both falsification sets, and §8a/§8b of
`specs/SPEC-uniswap-signature-surfaces.md`.
**Authored before the event window** and disclosed here — see `CONTINUITY.md`.

Published as executed. Per `AI-USE.md`, redactions are limited to credentials and
infrastructure addresses; the wording of the task itself is not edited. Nothing was
withheld from this one.

---

## Original text (Russian, as given)

> **Новость, которая меняет содержание твоей витрины: сегодня энклав подписал живой ордер
> на Hyperliquid, площадка его приняла, отмена прошла.** Полный цикл, без человека
> в цепочке подписи. Ордер над капом при этом отбит политикой изнутри измерения. Это уже
> не «мы планируем», а «работает на боевой площадке».
>
> **Задача — две части.**
>
> **1. Отрази это в публичном репозитории честно.** В README и CONTINUITY есть раздел
> «что сделано до 4 сентября» — теперь туда входит рабочий путь HL: минт ключа внутри
> энклава, аттестованная политика с капом, живой ордер и отмена. 🔴 Границы: **наш
> собственный счёт и наши деньги**, аудита нет, площадка одна плюс Binance. Никаких
> «первые в мире». Числа — только те, что я назвал: кап 0.041 BNB, ордер 0.03 прошёл,
> 0.05 отбит.
>
> **2. Продолжай сентябрьский фундамент по Uniswap.** Ты уже показал, что `executeSigned`
> из `main` не задеплоен и что реально подписывается Permit2, а вызов роутера — нет.
> Следующий кусок: **тестовые векторы на то, что подписывается**, тем же способом, что
> в первой части — два независимых пути расчёта дигеста плюс мутации. И одна строка
> вывода: где в этом пути может стоять наша политика, а где нет.
>
> И сразу учти урок сегодняшнего дня, он прямо по твоей теме: у Hyperliquid подпись
> отвергалась только потому, что **порядок полей внутри действия** отличался от
> канонического (`s` перед `r`). Биржа пересобирает msgpack по-своему, дигест уезжает,
> восстанавливается чужой адрес. Для Uniswap то же самое будет с порядком полей
> в типизированных данных — заложи это в векторы как отдельную проверку.
>
> Интеграцию в энклав в августе не пишем.

## English summary of what was asked

Two parts. First, record honestly in the public repository that the enclave has now signed
a live order on a real venue: key minted inside the enclave, attested policy with a cap, the
order accepted and the cancel accepted, with an over-cap order refused from inside the
measurement. With the limits stated next to it — our own account and our own money, no
audit, one venue plus Binance — the given numbers and nothing invented, and no claim to be
first at anything.

Second, keep building the September foundation for Uniswap: test vectors over whatever is
actually signed, two independent paths to each digest plus mutations, and one line on where
policy can sit and where it cannot.

And a lesson from the same day, directly on topic: the Hyperliquid signature was rejected
purely because the field order inside the signed action differed from canonical — `s` placed
before `r`. The venue rebuilds the payload its own way, the digest moves, and recovery
returns a different address. The same failure will exist for Uniswap in the field order of
typed data, so it should be a check of its own in the vectors.

Still out of scope for August: writing the enclave integration.

## What the model did with it

The vectors and the policy line asked for in part 2 already existed from prompt 02, in the
pull request that was still open — so this pass did not rebuild them. What it did instead
was close the gap the field-order lesson pointed at, which the previous spec had recorded in
its own words as unverified: both offline paths took field order from the same reading, so
they would have agreed on the same wrong digest.

That is now settled by the deployed contract rather than by another reading of the source.
Our encoder produces a digest, a throwaway key signs it, `permit()` is simulated read-only,
and Permit2 recovers a signer from its own digest and compares. Plus the negative: transpose
two fields of the same width, where nothing type-level can see the difference, and the
contract answers `InvalidSigner`.

The first attempt failed for a reason worth keeping — the well-known test address it used
carries an EIP-7702 delegation on mainnet, so Permit2 took the ERC-1271 branch and never
reached `ecrecover`. Recorded as §8b, because it means whether our signature is examined at
all depends on chain state the enclave cannot see.
