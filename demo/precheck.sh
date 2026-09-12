#!/usr/bin/env bash
# Pre-shoot gate: may this demo go on camera?
#
#   ./precheck.sh
#
# It answers in a word — SAFE TO FILM or DO NOT FILM — because a check that
# answers with silence gets read as approval by whoever is holding the camera.
#
# What it does, and why in this order:
#
#   1. Feeds the redactor a set of REAL response shapes taken from the gateway's
#      own wire types, each one carrying a credential: the Binance `headers` map
#      (`X-MBX-APIKEY`), the OKX one (`OK-ACCESS-PASSPHRASE`), the flat
#      `api_key` string of `/sign/binance-request`, and a signature OBJECT —
#      the shape that slipped past the old filter because the guard began with
#      `isinstance(v, str)`.
#
#   2. Scans the RENDERED output for the four markers. Any hit → DO NOT FILM.
#
#   3. 🔴 Scans the RAW fixture for the same markers and demands a HIT.
#      This is the half that is usually missing. A scanner that cannot see a
#      leak reports every input as clean, and a green run then means "we looked"
#      when it means "we are blind". So the gate proves its own eyesight on
#      every run, against the same bytes, before it is allowed to say SAFE.
#
# What it does NOT cover, said here so a green run is not over-read. This gate is about
# `/sign` response bodies and the redactor that renders them. Frame 3 prints the output of
# `attest-verify.py` straight to the screen without passing it through the redactor, and
# that is deliberate: the attestation endpoint is public and unauthenticated, so everything
# the verifier prints — the measurement, the nonce, the certificate fingerprints, the
# module id — is already handed to anyone who asks for it. The one identifier in there that
# LOOKS like infrastructure, an enclave module id, is excluded by name in
# `scripts/scrub-check.sh` for exactly that reason. If frame 3 ever starts printing a body
# that needs a token to fetch, it belongs in this gate on the same day.
#
# Exit: 0 safe to film · 1 do not film · 2 the check itself could not run.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REDACT="$HERE/redact.py"
command -v python3 >/dev/null || { echo "НЕ ВЫПОЛНЕНО: нет python3"; exit 2; }
[ -r "$REDACT" ] || { echo "НЕ ВЫПОЛНЕНО: не найден $REDACT"; exit 2; }

# The markers. Deliberately the header NAMES and not sample values: a value we
# invent proves nothing about the value the gateway will actually return.
MARKERS='APIKEY|ACCESS|SIGN|passphrase'

fail=0
blind=0

# ── fixtures: the shapes the gateway really answers with ────────────────────
fx_binance='{"headers":{"X-MBX-APIKEY":"REDACTED_LOOKING_BUT_TREAT_AS_REAL","Content-Type":"application/x-www-form-urlencoded"},"signature":{"r":"0xaa","s":"0xbb","v":27},"receipt":{"seq":"41"},"venue":"binance","ok":true}'
fx_okx='{"headers":{"OK-ACCESS-KEY":"k","OK-ACCESS-SIGN":"s","OK-ACCESS-PASSPHRASE":"p","OK-ACCESS-TIMESTAMP":"t"},"venue":"okx","ok":true}'
fx_request='{"signature":"deadbeef","api_key":"AKIA_LOOKING_STRING","receipt":{"seq":"42"}}'
fx_denied='{"denied":true,"reason_code":"policy_denied","rule_class":"policy","decided_by":"enclave","detail":"size over cap"}'

check_one() { # check_one <name> <json>
  local name="$1" body="$2" rendered raw_hits red_hits
  rendered="$(printf '%s' "$body" | python3 "$REDACT" 2>&1)" || {
    printf '  НЕ ВЫПОЛНЕНО  %s — редактор упал\n' "$name"; blind=1; return
  }

  # (3) сначала докажем, что сканер вообще видит утечку в этом теле.
  #     Сырое тело сканируем ЦЕЛИКОМ: там имена заголовков и есть признак.
  raw_hits="$(printf '%s' "$body" | grep -ciE "$MARKERS" || true)"

  # (2) и только потом — что в отредактированном её нет.
  #     🔴 Здесь сканируем ТОЛЬКО ЗНАЧЕНИЯ, отрезав `ключ: `. Имя поля никогда не
  #     было секретом: строка `signature: <hidden: dict>` доказывает, что фильтр
  #     сработал, а не что он протёк. Сканер, который краснеет на собственном
  #     имени поля, научит оператора игнорировать красноту — и в тот день, когда
  #     она будет настоящей, её пролистают.
  red_hits="$(printf '%s' "$rendered" | sed 's/^[^:]*: //' | grep -ciE "$MARKERS" || true)"

  # (2b) 🔴 СТРУКТУРНАЯ проверка, и она сильнее поиска по образцу. Найдена
  #      фальсификацией: под старым правилом плоский `api_key` из
  #      /sign/binance-request проходил мимо всех четырёх маркеров — в его
  #      ЗНАЧЕНИИ их нет, а имя мы отрезаем. Поиск по словам ловит только те
  #      секреты, чьи слова мы угадали; здесь же требование к ФОРМЕ строки:
  #      либо ключ разрешён к показу, либо значение скрыто. Третьего нет.
  #
  #      Список разрешённых продублирован здесь НАМЕРЕННО. Расширят SHOW в
  #      redact.py — этот гейт покраснеет, пока человек не расширит и его. Новое
  #      поле в кадре должно стоить двух правок и одного ревьюера, а не одной.
  # 🔴 python3 -c, а НЕ heredoc: `python3 - <<PY` забирает stdin под текст
  #    программы, данные до неё не доходят, `sys.stdin.read()` возвращает пусто
  #    и проверка молча проходит ВСЕГДА. Первая редакция этого блока была именно
  #    такой и была no-op — поймано мутацией: подложил старое правило, а строка
  #    с плоским `api_key` осталась зелёной.
  struct_bad="$(printf '%s\n' "$rendered" | python3 -c '
import sys
ALLOWED = {"venue","kind","ok","denied","reason_code","rule_class","decided_by",
           "detail","error","http_status","outcome","submitted","env",
           "symbol","side","size","limit_px","reduce_only","(body)"}
bad = []
for line in sys.stdin.read().splitlines():
    if not line.strip():
        continue
    k, _, v = line.strip().partition(": ")
    if v.startswith("<hidden:") or v.startswith("(body is not JSON"):
        continue
    if k not in ALLOWED:
        bad.append(k)
print(" ".join(bad))
')"
  if [ -n "$struct_bad" ]; then
    printf '  🔴 УТЕЧКА      %s — поле напечатано ЗНАЧЕНИЕМ и не входит в разрешённые: %s\n' "$name" "$struct_bad"
    fail=1
    return
  fi

  if [ "$name" != "отказ политики" ] && [ "$raw_hits" -eq 0 ]; then
    printf '  🔴 СЛЕПОЙ      %s — сканер не нашёл маркеров в СЫРОМ теле, значит он не увидел бы и утечку\n' "$name"
    blind=1
    return
  fi
  if [ "$red_hits" -ne 0 ]; then
    printf '  🔴 УТЕЧКА      %s — маркер остался после редактирования:\n' "$name"
    printf '%s\n' "$rendered" | grep -iE "$MARKERS" | sed 's/^/       /'
    fail=1
    return
  fi
  printf '  ok            %s\n' "$name"
}

echo "── предсъёмочная проверка: что попадёт в кадр ──"
check_one "Binance /sign — headers с X-MBX-APIKEY" "$fx_binance"
check_one "OKX /sign — headers с passphrase"       "$fx_okx"
check_one "/sign/binance-request — плоский api_key" "$fx_request"
check_one "отказ политики"                          "$fx_denied"

echo
echo "── что кадр ПОКАЖЕТ на отказе политики (ради этого он и снимается) ──"
printf '%s' "$fx_denied" | python3 "$REDACT"

echo
if [ "$blind" -ne 0 ]; then
  echo "НЕ ВЫПОЛНЕНО — сканер не доказал, что видит утечку. Это не «чисто», это «мы не смотрели»."
  exit 2
fi
if [ "$fail" -ne 0 ]; then
  echo "DO NOT FILM — НЕ СНИМАТЬ: секрет пережил редактирование."
  exit 1
fi
echo "SAFE TO FILM — снимать можно: на всех четырёх формах ответа секретов в выводе нет,"
echo "и сканер на каждом прогоне доказал, что он их видит."
exit 0
