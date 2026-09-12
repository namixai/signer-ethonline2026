// Vectors are two live PAID samples, captured 2026-09-01 and kept verbatim in
// test/fixtures/sample1.* and sample2.* next to this file.
// Expected values were measured by hand (cast + free public RPC) before this code existed,
// so the test checks the code against the world, not against itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { verifyAttestation, parseAttestationHeader, receiptDigest, normaliseV } from '../src/attestation.js';
import { checkUsable } from '../src/usability.js';
import { checkAddressDrift } from '../src/drift.js';

const here = dirname(fileURLToPath(import.meta.url));
const raw = (n) => readFileSync(join(here, 'fixtures', n), 'utf8');
const att = (n) => parseAttestationHeader(raw(n));

// Measured 2026-09-01/02, independently of this code.
const EXPECTED = {
  sample1: {
    responseCID: '0xae3624d424bb22f0b7b23a7f1a75574e6fd7304de1cc23b1884fc718ba5520f7',
    digest: '0x88278db04e97daf5f1a03cab9f0faaf808b6c95dd535d66b8edb5727e26496fe',
    allocationId: '0xfda28033222be885965eb5c3011cc2280b7e3e99',
  },
  sample2: {
    responseCID: '0x32ebc93fd5c71ebc1b0880f2aeb02a56c9fb2acdbf4459a38b5ee59dc070bdca',
  },
};

test('sample 1: attestation verifies and recovers the measured allocation', async () => {
  const body = raw('sample1.body.json');
  const a = att('sample1.attestation.json');

  assert.equal(receiptDigest(a), EXPECTED.sample1.digest, 'EIP-712 digest');

  const r = await verifyAttestation(body, a);
  assert.equal(r.ok, true);
  assert.equal(r.responseCID, EXPECTED.sample1.responseCID);
  assert.equal(r.allocationId.toLowerCase(), EXPECTED.sample1.allocationId);
});

test('sample 2 (error response): attestation ALSO verifies — signature says nothing about content', async () => {
  const r = await verifyAttestation(raw('sample2.body.json'), att('sample2.attestation.json'));
  assert.equal(r.ok, true, 'an error response is attested just like a good one');
  assert.equal(r.responseCID, EXPECTED.sample2.responseCID);
});

test('tampering with one byte of the body breaks responseCID', async () => {
  const body = raw('sample1.body.json').replace('2427.244046766495834139174824410641', '9427.244046766495834139174824410641');
  const r = await verifyAttestation(body, att('sample1.attestation.json'));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'response_cid_mismatch');
});

test('the pre-Horizon DisputeManager recovers a DIFFERENT address — silently wrong, not an error', async () => {
  const legacy = {
    chainId: 42161,
    disputeManager: '0x0Ab2B043138352413Bb02e67E626a70320E3BD46', // now LegacyDisputeManager
    subgraphService: '0xb2Bb92d0DE618878E438b55D5846cfecD9301105',
  };
  const r = await verifyAttestation(raw('sample1.body.json'), att('sample1.attestation.json'), legacy);
  assert.equal(r.ok, true, 'it still "succeeds" — that is the danger');
  assert.notEqual(r.allocationId.toLowerCase(), EXPECTED.sample1.allocationId);
});

test('normaliseV maps the raw recovery id, and refuses a bogus one', () => {
  // Unit test of OUR function. The end-to-end path cannot test this: viem accepts
  // raw 0/1 on its own, so a broken normaliseV stays invisible there. Found by
  // planting the defect and watching nothing go red.
  assert.equal(normaliseV(0), 27);
  assert.equal(normaliseV(1), 28);
  assert.equal(normaliseV(27), 27);
  assert.equal(normaliseV(28), 28);
  assert.throws(() => normaliseV(42));
});

test('the gateway really does send raw v, and a bogus id is refused end-to-end', async () => {
  const a = att('sample1.attestation.json');
  assert.equal(a.v, 0, 'both fixture samples carry raw v');

  // 🔴 Это утверждение ИЗМЕНИЛОСЬ, и не в сторону послабления. Раньше здесь стояло
  // `assert.rejects`: негодный `v` ронял функцию, и тест это закреплял. Посторонний,
  // проходивший поверхность 12.09, ломал подпись руками и получал стектрейс — то есть
  // закреплённым оказалось именно то поведение, против которого весь остальной код.
  // Замысел теста был «отвергается end-to-end», а броском он был лишь по случайности
  // реализации. Теперь проверяется отказ по имени; отсутствие броска шире покрыто
  // проверкой «a signature nobody can read» ниже.
  const r = await verifyAttestation(raw('sample1.body.json'), { ...a, v: 42 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'attestation_unusable');
});

// ---- step 2: usability, which does NOT follow from step 1 ----

const CHAIN_HEAD = 25883900n; // just past the sample's block 25883882

test('sample 1 is usable for WETH', () => {
  const r = checkUsable(JSON.parse(raw('sample1.body.json')), 'WETH', CHAIN_HEAD);
  assert.equal(r.ok, true);
  assert.equal(r.priceUSD, '2427.244046766495834139174824410641');
});

test('sample 2 is REFUSED although its attestation verifies', () => {
  const r = checkUsable(JSON.parse(raw('sample2.body.json')), 'WETH', CHAIN_HEAD);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'graphql_errors');
});

test('a long-tail token priced "0" is refused, not treated as free', () => {
  const r = checkUsable(JSON.parse(raw('sample1.body.json')), 'LYX', CHAIN_HEAD);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'price_absent_or_zero');
});

test('a stale source is refused — the GMX trap', () => {
  const r = checkUsable(JSON.parse(raw('sample1.body.json')), 'WETH', 25883882n + 100000n);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'source_stale');
});

test('indexing errors are refused', () => {
  const body = JSON.parse(raw('sample1.body.json'));
  body.data._meta.hasIndexingErrors = true;
  assert.equal(checkUsable(body, 'WETH', CHAIN_HEAD).reason, 'indexing_errors');
});

test('a fresh subgraph head does NOT excuse a stale price — the two ages are separate', () => {
  const body = JSON.parse(raw('sample1.body.json'));
  const weth = body.data.tokens.find((t) => t.symbol === 'WETH');
  weth.lastPriceBlockNumber = '25000000'; // head is current, this price is not
  const r = checkUsable(body, 'WETH', CHAIN_HEAD);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'price_stale');
});

// ---- malformed input must REFUSE with a reason, never throw and never pass ----
// Six findings from CodeRabbit on the first review of this code. They share one root:
// I had not applied my own rule — everything malformed resolves to a named refusal —
// to my own input handling.

test('falsy-but-not-numeric recovery ids are refused, not coerced to 27', () => {
  for (const bogus of [null, false, '', [], undefined, {}]) {
    assert.throws(() => normaliseV(bogus), undefined, `normaliseV(${JSON.stringify(bogus)})`);
  }
  assert.throws(() => normaliseV(1.5));
});

test('a parsed object instead of raw bytes is refused by name', async () => {
  const parsed = JSON.parse(raw('sample1.body.json'));
  const r = await verifyAttestation(parsed, att('sample1.attestation.json'));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'raw_body_required');
});

test('a null attestation header is refused with a readable message', () => {
  assert.throws(() => parseAttestationHeader('null'), /must be a JSON object/);
  assert.throws(() => parseAttestationHeader(null), /must be a JSON object/);
});

test('a non-numeric price is refused, not compared as NaN', () => {
  const body = JSON.parse(raw('sample1.body.json'));
  body.data.tokens.find((t) => t.symbol === 'WETH').lastPriceUSD = 'abc';
  const r = checkUsable(body, 'WETH', CHAIN_HEAD);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'price_absent_or_zero');
});

test('a negative price is refused', () => {
  const body = JSON.parse(raw('sample1.body.json'));
  body.data.tokens.find((t) => t.symbol === 'WETH').lastPriceUSD = '-1';
  assert.equal(checkUsable(body, 'WETH', CHAIN_HEAD).reason, 'price_absent_or_zero');
});

test('a null price block refuses instead of crashing on BigInt(null)', () => {
  const body = JSON.parse(raw('sample1.body.json'));
  body.data.tokens.find((t) => t.symbol === 'WETH').lastPriceBlockNumber = null;
  const r = checkUsable(body, 'WETH', CHAIN_HEAD);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'missing_last_price_block');
});

test('a garbage price block refuses instead of throwing', () => {
  const body = JSON.parse(raw('sample1.body.json'));
  body.data.tokens.find((t) => t.symbol === 'WETH').lastPriceBlockNumber = 'not-a-number';
  const r = checkUsable(body, 'WETH', CHAIN_HEAD);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad_last_price_block');
});

// ---- drift watcher: my own spec rule, which the review caught me not implementing ----

test('drift watcher reports no drift when the address book matches', async () => {
  const book = {
    '42161': {
      DisputeManager: { address: '0x2FE023a575449AcB698648eD21276293Fa176f96' },
      SubgraphService: { address: '0xb2Bb92d0DE618878E438b55D5846cfecD9301105' },
    },
  };
  const r = await checkAddressDrift(undefined, async () => book);
  assert.equal(r.checked, true);
  assert.equal(r.driftDetected, false);
});

test('drift watcher catches a moved DisputeManager — the Horizon case', async () => {
  const book = {
    '42161': {
      DisputeManager: { address: '0x0000000000000000000000000000000000000042' },
      SubgraphService: { address: '0xb2Bb92d0DE618878E438b55D5846cfecD9301105' },
    },
  };
  const r = await checkAddressDrift(undefined, async () => book);
  assert.equal(r.driftDetected, true);
  assert.equal(r.reason, 'pinned_address_drift');
  assert.equal(r.drift[0].key, 'disputeManager');
});

test('an unreachable address book is its own outcome, not "no drift"', async () => {
  const r = await checkAddressDrift(undefined, async () => {
    throw new Error('network down');
  });
  assert.equal(r.checked, false);
  assert.equal(r.driftDetected, null, 'must NOT be reported as false');
  assert.equal(r.reason, 'address_book_unreachable');
});

test('a price block ahead of the chain head is refused, not treated as fresh', () => {
  const body = JSON.parse(raw('sample1.body.json'));
  body.data.tokens.find((t) => t.symbol === 'WETH').lastPriceBlockNumber = '99999999';
  const r = checkUsable(body, 'WETH', CHAIN_HEAD);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'price_block_ahead_of_chain');
});

test('🔴 the body is hashed as TEXT, not guessed at — toBytes decodes hex-looking strings', async () => {
  // Measured on viem 2.56.3: toBytes('0xdeadbeef') returns 4 bytes (hex-decoded) where the
  // UTF-8 text is 10, and toBytes(new Uint8Array([1,2,3])) returns 5 rather than 3.
  // responseCID is computed over the EXACT response bytes, and a helper that guesses the
  // type by shape is the last thing that belongs there.
  const { stringToBytes, toBytes, keccak256 } = await import('viem');
  const hexish = '0xdeadbeef';
  assert.notEqual(toBytes(hexish).length, stringToBytes(hexish).length,
    'если бы совпадали, ловушки бы не было и этот тест был бы бессмысленным');
  assert.equal(stringToBytes(hexish).length, 10, 'текст, а не декодированный hex');

  // And the real path: a body that happens to start with 0x must still hash as its text.
  const body = '0x1234';
  const viaText = keccak256(stringToBytes(body));
  const r = await verifyAttestation(body, { ...att('sample1.attestation.json'), responseCID: viaText });
  // 🔴 Утверждать УСПЕХ, а не отсутствие одной ошибки. Прежняя версия проверяла
  // `reason !== 'response_cid_mismatch'` — и прошла бы при отказе по любой ДРУГОЙ причине,
  // то есть по причине, не имеющей отношения к тому, что тест утверждает. Ровно тот класс,
  // за которым я гоняюсь в чужом коде.
  assert.equal(r.ok, true, `ожидался успех, получено: ${r.reason}`);
  assert.equal(r.responseCID, viaText, 'хеш посчитан по тексту, а не по декодированному hex');
});

test('🔴 a null field in the attestation header is refused, not passed down', () => {
  // `=== undefined` let {"v": null} through: normaliseV then threw a type message from a
  // lower frame, and a null r/s reached viem. Same trap the x402 client already records —
  // null !== undefined, and a check for one lets the other past.
  const base = JSON.parse(raw('sample1.attestation.json'));
  for (const field of ['requestCID', 'responseCID', 'subgraphDeploymentID', 'r', 's', 'v']) {
    assert.throws(
      () => parseAttestationHeader(JSON.stringify({ ...base, [field]: null })),
      new RegExp(`missing field: ${field}`),
      `null в ${field} должен отвергаться по имени`,
    );
  }
});

test('🔴 a malformed block number is a named refusal, not an escaped SyntaxError', () => {
  // The rule was already written for the PRICE block and applied to one of the two.
  // Measured before the fix: "abc" and "25904639.0" both threw SyntaxError out of
  // checkUsable, and so did a malformed chainHead.
  const body = (n) => ({ data: { tokens: [], _meta: { block: { number: n }, hasIndexingErrors: false } } });
  for (const bad of ['abc', '25904639.0', {}, true, '']) {
    let r;
    assert.doesNotThrow(() => { r = checkUsable(body(bad), 'X', 100n); }, `meta.block.number=${String(bad)}`);
    assert.equal(r.ok, false);
    assert.ok(['bad_meta_block', 'missing_meta_block'].includes(r.reason), `получено: ${r.reason}`);
  }
  for (const bad of ['abc', {}, null]) {
    let r;
    assert.doesNotThrow(() => { r = checkUsable(body('1'), 'X', bad); }, `chainHead=${String(bad)}`);
    assert.equal(r.reason, 'bad_chain_head');
  }
});

// Байты обязаны хешироваться как байты.
//
// Функция объявляет, что принимает Uint8Array, и до правки прогоняла его через
// stringToBytes — хешировала текстовое представление массива вместо самих байтов. Замер
// на НАСТОЯЩЕМ записанном ответе: строкой проходит, теми же байтами даёт
// `response_cid_mismatch`. Ломалось при этом самое дорогое: сверка подписи индексера
// начинала проверять не то, что пришло, и объявляла годный ответ подделанным.
// Найдено ревью CodeRabbit на signer-mcp#19.
test('🔴 the same body verifies the same whether it arrives as text or as bytes', async () => {
  const body = raw('sample1.body.json');
  const attestation = att('sample1.attestation.json');

  const asText = await verifyAttestation(body, attestation);
  const asBytes = await verifyAttestation(new TextEncoder().encode(body), attestation);

  assert.equal(asText.ok, true, `строкой не прошло: ${asText.reason}`);
  assert.equal(asBytes.ok, true, `байтами не прошло: ${asBytes.reason} — байты хешируются не как байты`);
  // Не только оба ok: вердикт обязан быть ТЕМ ЖЕ, включая восстановленные поля.
  assert.equal(asBytes.responseCID, asText.responseCID);
  assert.equal(asBytes.allocationId, asText.allocationId);
});

// Кривая подпись — отказ по имени, а не падение.
//
// 🔴 Найдено вторым проходом постороннего 12.09: он ломал подпись руками и видел
// стектрейс. Замер тогда: из одиннадцати рукотворных порч ВОСЕМЬ бросали. Здесь это
// дороже всего — у нас семьдесят два кода отказа и отдельный словарь, отличающий
// «ответа нет» от «не смог спросить», и всё это обесценивается одним стектрейсом
// на том шаге, который судья ломает первым.
test('🔴 a signature nobody can read refuses by name, and never throws', async () => {
  const body = raw('sample1.body.json');
  const base = JSON.parse(raw('sample1.attestation.json'));

  const corruptions = {
    'нe-hex символ':      { r: `${base.r.slice(0, -1)}z` },
    'без 0x':             { r: base.r.slice(2) },
    'пустая строка':      { r: '' },
    'нули':               { r: `0x${'0'.repeat(64)}` },
    'двойная длина':      { r: base.r + base.r.slice(2) },
    's нули':             { s: `0x${'0'.repeat(64)}` },
    'v мусор':            { v: 99 },
    'v строка':           { v: 'x' },
  };

  for (const [name, patch] of Object.entries(corruptions)) {
    // Не в try/catch: брошенное исключение обязано ПРОВАЛИТЬ тест, а не быть им поймано.
    const r = await verifyAttestation(body, { ...base, ...patch });
    assert.equal(r.ok, false, `принята нечитаемая подпись: ${name}`);
    assert.equal(r.reason, 'attestation_unusable', name);

    // 🔴 И сообщение библиотеки НЕ уходит наружу: viem печатает отвергнутый скаляр
    // целиком, то есть саму испорченную подпись. Ровно та же утечка через путь ошибки,
    // что была с ключом RP.
    const text = JSON.stringify(r);
    for (const field of ['r', 's']) {
      const v = { ...base, ...patch }[field];
      if (typeof v === 'string' && v.length > 20) {
        assert.ok(!text.includes(v.slice(2, 30)), `${name}: значение поля ${field} уехало в отказ`);
      }
    }
    // Форма полей в отказе есть — по ней и чинят, не видя значений.
    assert.equal(r.detail.fields.length, 3, name);
  }
});

test('🔴 an absent attestation refuses by name and never throws', async () => {
  // Замер 12.09: `verifyAttestation('{}', null)` и с `undefined` бросали TypeError
  // «Cannot read properties of null». Файл объявляет, что не бросает никогда — на
  // пустом входе это было неправдой, а пустое значение приходит из разбора чужого
  // ответа так же легко, как испорченная подпись.
  const body = raw('sample1.body.json');
  for (const [name, att] of [
    ['null', null],
    ['undefined', undefined],
    ['пустой объект', {}],
    ['массив', []],
    ['строка', 'x'],
    ['число', 5],
  ]) {
    // Не в try/catch: брошенное исключение обязано ПРОВАЛИТЬ тест, а не быть им поймано.
    const r = await verifyAttestation(body, att);
    assert.equal(r.ok, false, name);
    assert.equal(r.reason, 'attestation_required', `${name}: не то имя отказа`);
  }

  // 🔴 И РАЗНЫЕ БОЛЕЗНИ НАЗЫВАЮТСЯ РАЗНО. Пустой объект раньше отказывал как
  // `response_cid_mismatch` с `claimed: undefined` — формально верно, по смыслу мимо:
  // читатель шёл сверять байты ответа, тогда как аттестации не было вовсе. А годная
  // аттестация с ДРУГИМ responseCID по-прежнему обязана давать несовпадение.
  const good = att('sample1.attestation.json');
  const mismatched = await verifyAttestation(body, { ...good, responseCID: `0x${'0'.repeat(64)}` });
  assert.equal(mismatched.reason, 'response_cid_mismatch');
});

test('🔴 a broken digest field does NOT report itself as a broken signature', async () => {
  // Найдено ботом на PR #25 и подтверждено замером: дайджест и восстановление подписи
  // стояли в одном try, и порча `requestCID` выдавала `note: signature could not be
  // read` при трёх идеальных r/s/v (length 66, hex true) — отказ показывал пальцем на
  // здоровую подпись. Эта проверка умирает вместе с правкой: сведите два try обратно в
  // один, и stage станет 'signature', а список полей — r,s,v.
  const base = att('sample1.attestation.json');
  const body = raw('sample1.body.json');

  // 🔴 `0x` + 64 буквы «Z» здесь не для красоты: до правки этот вход НЕ отказывался
  // вовсе. viem сверяет у bytes32 размер, а не алфавит, поэтому не-hex проходил
  // насквозь, менял дайджест и восстанавливал постороннего подписанта — ok:true.
  const bads = {
    'не hex, но верной длины': `0x${'Z'.repeat(64)}`,
    'короткий':               '0xZZ',
    'без 0x':                 'a'.repeat(64),
    'пустая строка':          '',
    'null':                   null,
    'число':                  5,
  };

  for (const field of ['requestCID', 'subgraphDeploymentID']) {
    for (const [name, bad] of Object.entries(bads)) {
      const label = `${field}/${name}`;
      const r = await verifyAttestation(body, { ...base, [field]: bad });
      assert.equal(r.ok, false, `принят негодный вход дайджеста: ${label}`);
      assert.equal(r.reason, 'attestation_unusable', label);
      assert.equal(r.detail.stage, 'digest', `${label}: отказ назвал не тот этап`);
      assert.deepEqual(
        r.detail.fields.map((f) => f.field),
        ['requestCID', 'responseCID', 'subgraphDeploymentID'],
        `${label}: в отказе не входы дайджеста`,
      );
      assert.ok(!/signature/i.test(r.detail.note), `${label}: примечание всё ещё про подпись`);
      if (typeof bad === 'string' && bad.length > 20) {
        assert.ok(
          !JSON.stringify(r).includes(bad.slice(2, 30)),
          `${label}: значение уехало в отказ`,
        );
      }
    }
  }

  // Обратная половина, без которой проверка была бы зелёной на «всегда stage: digest»:
  // порча подписи по-прежнему называет ПОДПИСЬ.
  const sig = await verifyAttestation(body, { ...base, r: `0x${'0'.repeat(64)}` });
  assert.equal(sig.detail.stage, 'signature');
  assert.deepEqual(sig.detail.fields.map((f) => f.field), ['r', 's', 'v']);

  // И граница проверки названа замером, а не обещанием: 64 нуля — ЗАКОННЫЙ hex, он
  // проходит и восстанавливает другого подписанта. Отсекает его цепь (нет аллокации),
  // а не форма. Если однажды это начнёт отказывать здесь — проверка расширилась молча.
  const zeros = await verifyAttestation(body, { ...base, requestCID: `0x${'0'.repeat(64)}` });
  assert.equal(zeros.ok, true, 'законный hex обязан дойти до восстановления подписанта');
  assert.match(zeros.allocationId, /^0x[0-9a-fA-F]{40}$/);
  assert.notEqual(
    zeros.allocationId,
    (await verifyAttestation(body, base)).allocationId,
    'другой requestCID обязан дать другого подписанта — иначе дайджест не зависит от входа',
  );
});

test('a readable signature still recovers its signer', async () => {
  // Иначе предыдущая проверка была бы зелёной при «отвергать всё».
  const r = await verifyAttestation(raw('sample1.body.json'), att('sample1.attestation.json'));
  assert.equal(r.ok, true, r.reason);
  assert.match(r.allocationId, /^0x[0-9a-fA-F]{40}$/);
});
