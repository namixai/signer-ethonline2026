#!/usr/bin/env bash
# Пошаговый прогон для съёмки. Один шаг — одна команда, потом ждём Enter.
#
# Почему не агент: агент между шагами думает несколько секунд, иногда печатает
# своё, и на записи это мёртвый воздух, который нельзя вырезать (ускорять ролик
# правилами запрещено). Здесь задержка ровно та, которую делает человек голосом.
#
#   ./step.sh            все шаги
#   ./step.sh 3          начать с третьего
#   ./step.sh 2 4        только со второго по четвёртый
#
# Enter — дальше. Ctrl-C — стоп.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# шаг = метка | папка относительно корня репозитория | команда
STEPS=(
  "The Graph: keyless price, indexer attestation, four refusals|integrations/graph|npm run demo"
  "Permit2: our encoder against pinned cases, then planted defects|vectors|make verify"
  "Permit2 on chain: the contract accepts our digest, rejects the reordered one|vectors|node onchain_fieldorder.mjs"
  "A stranger checks the running enclave: attestation, then the registry on Base|demo|./demo.sh --frame 3"
)

from="${1:-1}"; to="${2:-${#STEPS[@]}}"

# 🔴 Диапазон проверяем до цикла. Без этого `./step.sh abc` не гоняет ни одного шага,
# но печатает в конце «всё, 5 шагов» — бодрая строка про работу, которой не было;
# `./step.sh 9` идёт по seq ВНИЗ, от девятого к четвёртому; `./step.sh 2 99` дорисовывает
# девяносто пять пустых заголовков. Для съёмки это хуже отказа.
if ! printf '%s' "$from" | grep -Eq '^[1-9][0-9]*$' ||
   ! printf '%s' "$to"   | grep -Eq '^[1-9][0-9]*$' ||
   [ "$from" -gt "$to" ] || [ "$to" -gt "${#STEPS[@]}" ]; then
  echo "Использование: $0 [первый [последний]] — шаги 1..${#STEPS[@]}, по возрастанию." >&2
  echo "Получено: from=$from to=$to" >&2
  exit 2
fi

for i in $(seq "$from" "$to"); do
  IFS='|' read -r label dir cmd <<< "${STEPS[$((i-1))]}"

  printf '\n\033[1m── %d/%d  %s\033[0m\n' "$i" "${#STEPS[@]}" "$label"
  printf '\033[2m$ cd %s && %s\033[0m\n\n' "$dir" "$cmd"

  ( cd "$ROOT/$dir" && eval "$cmd" )
  rc=$?

  # 🔴 Ненулевой код не проглатываем: на записи «шаг упал» обязано быть видно,
  # иначе озвучка расскажет про результат, которого на экране нет.
  if [ $rc -ne 0 ]; then
    printf '\n\033[1;31m── ШАГ %d ВЕРНУЛ %d — это не успех. Дальше не идём.\033[0m\n' "$i" "$rc"
    exit "$rc"
  fi

  if [ "$i" -lt "$to" ]; then
    printf '\n\033[2m── Enter — дальше (%d/%d готово)\033[0m' "$i" "${#STEPS[@]}"
    read -r _
  fi
done

printf '\n\033[1m── всё, %d шагов\033[0m\n' "$((to - from + 1))"
