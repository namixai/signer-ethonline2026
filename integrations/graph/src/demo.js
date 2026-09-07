// Screen walkthrough of the producing half, for the submission video.
//
// Runs on a PAID READ MADE DURING THE EVENT (2026-09-04, transaction 0x8b36eb49… on Base,
// $0.01 USDC) plus free live reads. Re-shooting costs nothing, and every number on screen
// came from that request — the exact bytes are kept, and their hash is checked against the
// indexer's own responseCID by a test, so the recording cannot drift from what was served.
//
// 🔴 LANGUAGE RULE, because this ends up on video: nothing here may say "the enclave
// refused because of the price". The band is computed OUT HERE. What the enclave refuses
// is a request that fails its policy; the price check that precedes it is ours.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { verifyAttestation, parseAttestationHeader } from './attestation.js';
import { checkUsable } from './usability.js';
import { resolveIndexer, arbitrumClient } from './chain.js';
import { quote, UNISWAP_V3_ETHEREUM } from './fetch.js';
import { gateSignatureRequest } from './agent-gate.js';
import { buildSnapshot, judgeOrder } from './snapshot.js';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (n) => readFileSync(join(here, '..', 'test', 'fixtures', n), 'utf8');

// Deliberate presentation pacing for the video recording — NOT simulated latency.
// Zero by default, so tests and CI are untouched; the real network calls below take
// exactly as long as they take either way.
const PAUSE_MS = Number(process.env.DEMO_STEP_PAUSE_MS ?? 0);
const dwell = () => (PAUSE_MS > 0 ? new Promise((r) => setTimeout(r, PAUSE_MS)) : null);

const step = async (n, title) => {
  await dwell();
  console.log(`\n${'─'.repeat(72)}\n${n}. ${title}\n${'─'.repeat(72)}`);
};
const say = (...a) => console.log(' ', ...a);

await step(1, 'Агент спрашивает цену. Это бесплатно — 402 ничего не стоит.');
const q = await quote();
if (q.ok) {
  say(`шлюз просит ${Number(q.amountAtomic) / 1e6} USDC в сети ${q.network}`);
  say(`способ оплаты: ${q.transferMethod}, токен «${q.tokenDomain.name}» v${q.tokenDomain.version}`);
} else {
  say('шлюз недоступен:', q.reason);
}

await step(2, 'Ответ пришёл с подписью индексатора. Проверяем подпись — по точным байтам.');
const body1 = fx('live-2026-09-04.body.json').trim();
const att1 = parseAttestationHeader(fx('live-2026-09-04.attestation.json'));
const v1 = await verifyAttestation(body1, att1);
say('responseCID совпал:', v1.ok);
say('восстановленный адрес аллокации:', v1.allocationId);

await step(3, 'Кто за этой подписью стоит. Это запрос в цепь — энклав так не может.');
if (!v1.ok) {
  // Не идти дальше по несошедшейся подписи: вторичная ошибка резолва заслонила бы
  // первичную, и на экране была бы названа не та причина.
  say('шаг пропущен — подпись не сошлась:', v1.reason);
} else {
  try {
    // 🔴 Идентификатор развёртывания передаётся ОБЯЗАТЕЛЬНО. С `undefined` проверка
    // «аллокация именно для этого субграфа» в chain.js молча отключается, и кадр
    // показывал бы индексатора так, будто цепь это подтвердила. Клейм сильнее
    // выполненного — ровно то, чего мы не делаем, тем более на видео.
    const who = await resolveIndexer(v1.allocationId, v1.subgraphDeploymentID, arbitrumClient());
    say(who.ok ? `индексатор со ставкой: ${who.indexer}` : `не удалось: ${who.reason}`);
    if (who.ok) say(`и аллокация именно для этого субграфа: ${v1.subgraphDeploymentID.slice(0, 18)}…`);
  } catch (e) {
    say('не удалось:', String(e?.shortMessage ?? e));
  }
}

await step(4, 'ВТОРОЙ ШАГ, И ОН НЕ СЛЕДУЕТ ИЗ ПЕРВОГО: годятся ли данные.');
const CHAIN_HEAD = 25904646n;
const BLOCK_TS_MS = 1788533135 * 1000; // _meta.block.timestamp того же ответа // голова на момент чтения; блок субграфа был 25904639
const u1 = checkUsable(JSON.parse(body1), 'ONDO', CHAIN_HEAD);
say(`живое чтение → ${u1.ok ? 'годен' : 'отказ: ' + u1.reason}`, u1.ok ? `ONDO = ${u1.priceUSD}` : '');

// В ТОМ ЖЕ ответе три токена с ценой "0" — не выдуманный случай, а то, что пришло.
const uZero = checkUsable(JSON.parse(body1), 'TSLAon', CHAIN_HEAD);
say(`тот же ответ, TSLAon → ОТКАЗ: ${uZero.reason}`);
say('ноль у хвостового токена законен и для эталона непригоден — отказ, а не «бесплатно».');

const body2 = fx('sample2.body.json');
const v2 = await verifyAttestation(body2, parseAttestationHeader(fx('sample2.attestation.json')));
const u2 = checkUsable(JSON.parse(body2), 'WETH', CHAIN_HEAD);
say(`образец 2 → подпись сошлась: ${v2.ok}, а данные: ОТКАЗ — ${u2.reason}`);
say('это оплаченный, корректно аттестованный ответ С ОШИБКОЙ И БЕЗ ДАННЫХ.');
say('«подпись сошлась» не значит «цена получена».');

await step(5, 'Ловушка, которую видно только если мерить ДВА возраста.');
const stale = JSON.parse(body1);
stale.data.tokens.find((t) => t.symbol === 'ONDO').lastPriceBlockNumber = '25000000';
say('голова субграфа свежая, а цена записана давно →', checkUsable(stale, 'ONDO', CHAIN_HEAD).reason);
say('цена пишется в обработчиках событий: мёртвый рынок = мёртвая цена под зелёной индексацией.');

await step(6, 'И решение, которое из этого следует.');
{
  const r = buildSnapshot({
    subgraphId: UNISWAP_V3_ETHEREUM, symbol: 'ONDO',
    verification: v1, usability: u1,
    indexer: { ok: true, indexer: '0x4e5c87772C29381bCaBC58C3f182B6633B5a274a' },
    chainHead: CHAIN_HEAD,
    // Время наблюдения и время блока идут ВМЕСТЕ: снимок отказывается собираться, если
    // наблюдение заявлено раньше блока, который он описывает. Так и был пойман снимок,
    // подписанный с датой на год раньше настоящего чтения.
    blockTimestampMs: BLOCK_TS_MS,
    observedAtMs: BLOCK_TS_MS + 1000,
  });
  if (r.ok) {
    say(`снимок собран: ${r.bytes} байт, подписывается ДОСЛОВНО`);
    say(`возраст источника: блок ${r.snapshot.reading.source_block}, цена из ${r.snapshot.reading.price_block}`);
    say(`полоса ±5%: ${r.snapshot.band.low_usd.slice(0, 12)}… … ${r.snapshot.band.high_usd.slice(0, 12)}…`);
    say('честная цена  →', judgeOrder(r.snapshot, r.snapshot.reading.price_usd).allowed ? 'РАЗРЕШЕНО' : 'ОТКАЗ');
    say('цена вдвое    →', judgeOrder(r.snapshot, '0.71').allowed ? 'РАЗРЕШЕНО' : 'ОТКАЗ');
    say('снимок сам называет, чего мы НЕ проверяли: requestCID и корректность индексатора.');
  } else {
    say(`снимок НЕ собран: ${r.refusal.reason} — и это артефакт, а не молчание`);
  }
}

await step(7, 'Гейт: агент без человека НЕ ПОЛУЧАЕТ ПОДПИСЬ.');
{
  // Отрицательный путь показывается СЕГОДНЯ и без всякой регистрации — в этом его сила.
  // Ответ настоящий, от обоих реестров AgentBook, а не выдуманный.
  const g = await gateSignatureRequest({
    agentAddress: '0xF25047F2d2CD9d841b3ACf3CA1d38a2a697Ef368',
    observedAtMs: Date.now(),
  });
  say(`решение: ${g.receipt.decision}`);
  say(`причина: ${g.reason}`);
  if (g.receipt.checked_registries) say(`спрошено: ${g.receipt.checked_registries.join(' · ')}`);
  say('');
  say('это ИЗМЕНЕНИЕ ПОВЕДЕНИЯ, а не запись в лог: подписи не будет.');
  say('«человека нет» — не то же, что «спросить не удалось»: у второго своя причина,');
  say('потому что чинить надо разное — онбординг агента или сломанный узел.');
  say(`принято: ${g.receipt.decided_by} — до энклава, не внутри него.`);
}

await step(8, 'Граница, названная вслух.');
say('всё выше выполняется СНАРУЖИ энклава: у него нет сети.');
say('аттестация индексатора кладётся в снимок как артефакт для независимой перепроверки,');
say('а ручается за снимок НАША подпись — и мы отвечаем за то, что цепочку проверили.');
say('гейт стоит ДО запроса подписи; запроса подписи в этом пакете ещё нет,');
say('поэтому честно: «подпись не запрашивается», а не «мы охраняем подпись».');
console.log();
await dwell();
