#!/usr/bin/env bash
# Остаток USDC на Base у платящего кошелька — читаем у цепи, не у себя.
#
# Нужен для кадра «деньги»: показать остаток ДО платного запроса и ПОСЛЕ.
# Ключа не требует и не касается: balanceOf — это чтение.
#
#   X402_PAYER=0x… ./balance.sh
#
# Адрес берётся из X402_PAYER. Если он не задан, скрипт ОТКАЗЫВАЕТСЯ, а не
# показывает чужой кошелёк: перепутанный адрес в кадре — это неверная цифра,
# рассказанная голосом как своя.

set -euo pipefail

USDC=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913   # USDC на Base
RPC="${BASE_RPC:-https://mainnet.base.org}"

if [ -z "${X402_PAYER:-}" ]; then
  echo "🔴 X402_PAYER не задан. Поставь адрес кошелька, которым платишь в кадре:" >&2
  echo "   X402_PAYER=0x… $0" >&2
  exit 2
fi

# 🔴 Длину проверяем до сборки вызова. printf '%064s' задаёт МИНИМАЛЬНУЮ ширину:
# лишние символы он не срежет, а balanceOf(address) читает последние 40 hex слова —
# то есть при X402_PAYER=0xdeadCf3E… в кадр уйдёт остаток ДРУГОГО кошелька, а голос
# назовёт его адресом из переменной. Короткий адрес добьётся нулями слева и тоже
# прочитает не то, что напечатано.
if ! printf '%s' "$X402_PAYER" | grep -Eq '^0x[0-9a-fA-F]{40}$'; then
  echo "🔴 X402_PAYER=$X402_PAYER — это не адрес: нужно 0x и ровно 40 hex-символов" >&2
  exit 2
fi

addr="${X402_PAYER#0x}"
# balanceOf(address) = 0x70a08231, адрес добит нулями слева до 32 байт
data="0x70a08231$(printf '%064s' "$addr" | tr ' ' '0')"

raw=$(curl -s --max-time 20 "$RPC" -X POST -H 'content-type: application/json' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_call\",\"params\":[{\"to\":\"$USDC\",\"data\":\"$data\"},\"latest\"]}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("result",""))')

# 🔴 Пустой ответ — это «не прочитали», а не «ноль». Ноль на экране в кадре про
# деньги рассказал бы историю, которой не было.
if [ -z "$raw" ] || [ "$raw" = "0x" ]; then
  echo "🔴 цепь не ответила — остаток НЕИЗВЕСТЕН (это не ноль)" >&2
  exit 1
fi

python3 - "$raw" "${X402_PAYER}" <<'EOF'
import sys
from decimal import Decimal
raw, addr = sys.argv[1], sys.argv[2]
units = int(raw, 16)
print(f"  payer   {addr}")
print(f"  USDC    {Decimal(units) / Decimal(10**6):.6f}   ({units} atomic units, read from Base)")
EOF
