# One command, and now it is actually one.
#
# 🔴 THE README PROMISED "one command" AND THEN NAMED TWO SCRIPTS — and this README has
# already been burned by that exact phrase once, which it says out loud a few lines later.
# A reader counts what they type. So rather than soften the sentence a second time, here
# is the command that makes it true.
#
#   make verify        everything that needs nothing from anyone: no account, no key,
#                      no network. Four scripts, standard library only.
#   make verify-sdk    the cross-check against Uniswap's own SDK. Downloads packages,
#                      so it is NOT part of the offline claim and never will be.
#   make verify-all    both, in that order.
#
# Falsification is not a separate target on purpose: `falsify.py` runs inside `verify`,
# because a suite nobody has seen fail is not evidence, and making that opt-in would let
# a reader skip the only part that proves the rest can go red.

.POSIX:
.NOTPARALLEL:
.PHONY: verify verify-sdk verify-all

verify:
	@echo "── path A: our own encoder, standard library only ──"
	python3 verify_ours.py
	python3 falsify.py
	@echo
	@echo "── position NFT, same two halves ──"
	python3 verify_nft_ours.py
	python3 falsify_nft.py
	@echo
	@echo "✅ offline verification complete — no account, no key, no network."

verify-sdk:
	@echo "── path B: Uniswap's own SDK. This one downloads packages. ──"
	npm ci
	node verify_sdk.mjs
	node verify_nft_sdk.mjs
	@echo
	@echo "✅ cross-checked against code that shares nothing with ours."

# 🔴 НЕ СПИСКОМ ЗАВИСИМОСТЕЙ. Под `make -j` GNU Make запустил бы обе цели разом: платная
# сетевая проверка пошла бы даже при упавшей офлайновой, и вывод двух прогонов перемешался
# бы так, что непонятно, кто из них отказал. Гейт, который ломается от флага параллельности,
# перестаёт быть гейтом ровно тогда, когда его набирает кто-то незнакомый — а это и есть
# наш случай. Рецепт из двух вызовов $(MAKE) держит порядок при любом -j.
verify-all:
	$(MAKE) verify
	$(MAKE) verify-sdk
