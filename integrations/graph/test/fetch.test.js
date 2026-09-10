// No payment is made anywhere in this file. The quote is a free 402 read; everything
// else is stubbed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeChallenge, quote, paidQuery, priceQueryByAddress, priceQueryBySymbol, RECENT_PRICED_QUERY, PRICE_QUERY, SYMBOL_MATCH_LIMIT, shapeSymbolMatches } from '../src/fetch.js';

// The real challenge, captured from the live gateway on 2026-09-01 (free — reading a
// 402 costs nothing).
const LIVE_CHALLENGE =
  'eyJ4NDAyVmVyc2lvbiI6MiwiZXJyb3IiOiJQYXltZW50LVNpZ25hdHVyZSBoZWFkZXIgaXMgcmVxdWlyZWQiLCJyZXNvdXJjZSI6eyJ1cmwiOiJodHRwOi8vbWFpbm5ldC10aGVncmFwaC1hcmJpdHJ1bS0wNi1ldS1jZW50cmFsMi50aGVncmFwaC5jb20vc3ViZ3JhcGhzL2lkLzRjS3k2UVFNYzV0cGZkeDh5eGZZZWI5VExabWdMUWU0NGRkVzFHN053a0E2In0sImFjY2VwdHMiOlt7InNjaGVtZSI6ImV4YWN0IiwibmV0d29yayI6ImVpcDE1NTo4NDUzIiwiYW1vdW50IjoiMTAwMDAiLCJwYXlUbyI6IjB4NzlEQzM0RTQxQjJiNTkxMDc4ZDNkRTIyMkM0M0VjYWFCRDUyRmNDQiIsIm1heFRpbWVvdXRTZWNvbmRzIjozMDAsImFzc2V0IjoiMHg4MzM1ODlmQ0Q2ZURiNkUwOGY0YzdDMzJENGY3MWI1NGJkQTAyOTEzIiwiZXh0cmEiOnsiYXNzZXRUcmFuc2Zlck1ldGhvZCI6ImVpcDMwMDkiLCJuYW1lIjoiVVNEIENvaW4iLCJ2ZXJzaW9uIjoiMiJ9fV19';

test('the live 402 challenge decodes to the expected price and asset', () => {
  const c = decodeChallenge(LIVE_CHALLENGE);
  assert.equal(c.ok, true);
  assert.equal(c.x402Version, 2);
  assert.equal(c.network, 'eip155:8453', 'Base mainnet');
  assert.equal(c.amountAtomic, '10000', '10000 atomic USDC = $0.01');
  assert.equal(c.asset, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 'USDC on Base');
  assert.equal(c.transferMethod, 'eip3009');
  // The token's EIP-712 domain — signing against the wrong one authorises the wrong
  // contract with a perfectly valid signature.
  assert.deepEqual(c.tokenDomain, { name: 'USD Coin', version: '2' });
});

test('a missing or malformed challenge is a named refusal, not a throw', () => {
  assert.equal(decodeChallenge(null).reason, 'no_payment_required_header');
  assert.equal(decodeChallenge('not-base64-json!!').reason, 'challenge_not_base64_json');
  assert.equal(decodeChallenge(Buffer.from('{}').toString('base64')).reason, 'challenge_has_no_accepts');
});

test('paidQuery refuses without a payer key instead of sending an unpaid request', async () => {
  const r = await paidQuery({ privateKey: null, fetchImpl: () => assert.fail('must not call fetch') });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_payer_key');
});

// 🔴 A skip must be VISIBLE and NAMED. `node --test` prints the count and the reason, so
// "skipped: 2" in a CI summary says which coverage the run did not have — unlike a test
// that quietly passes because it never reached the network.
const OFFLINE = process.env.GRAPH_SNAPSHOT_OFFLINE === '1';

test('quote reads the price WITHOUT paying — SHAPE only, never the live number', async (t) => {
  if (OFFLINE) return t.skip('GRAPH_SNAPSHOT_OFFLINE=1 — живое чтение шлюза не выполнялось');
  // Free: a 402 costs nothing. But the default suite must not fail because The Graph
  // changed its price, rate-limited us, or 5xx'd — none of that is a defect in this
  // code. The exact values are asserted against the FIXED vector above; here we only
  // check that a live challenge still parses into the shape we expect.
  const c = await quote();
  if (!c.ok) return t.skip(`gateway not answering with a challenge: ${c.reason}`);
  assert.equal(typeof c.amountAtomic, 'string');
  assert.match(c.amountAtomic, /^\d+$/, 'the amount is an integer string');
  assert.match(c.network, /^eip155:\d+$/, 'a CAIP-2 chain id');
  assert.ok(c.asset?.startsWith('0x'), 'an asset address');
});

// ---- malformed input and dead networks: named refusals, never throws ----
// Six findings from review on this file. Same root as twice before: a NEW file, and I
// had not applied my own rule to it.

test('a challenge whose accept entry is a primitive is refused, not read as undefined', () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
  assert.equal(decodeChallenge(b64({ accepts: ['nonsense'] })).reason, 'challenge_accept_not_an_object');
  assert.equal(decodeChallenge(b64({ accepts: [{ network: 'x' }] })).reason, 'challenge_incomplete');
});

test('the challenge decoder does not need Node globals', () => {
  // Decoding uses atob + TextDecoder, both standard — the client has no reason to be
  // Node-only. Asserted by decoding a value built without Buffer.
  const json = '{"x402Version":2,"accepts":[{"network":"eip155:8453","amount":"1","asset":"0x00"}]}';
  const b64 = btoa(json);
  assert.equal(decodeChallenge(b64).amountAtomic, '1');
});

test('a dead network is fetch_failed, not a crash', async () => {
  const c = await quote(undefined, undefined, 'https://gateway.invalid.example/api/x402/subgraphs/id');
  assert.equal(c.ok, false);
  assert.equal(c.reason, 'fetch_failed');
});

test('a malformed payer key is refused by name, before any payment attempt', async () => {
  const r = await paidQuery({
    privateKey: '0xnotakey',
    fetchImpl: () => assert.fail('must not reach the network with a bad key'),
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad_payer_key');
});

test('a failed paid request reports that the spend is UNKNOWN, not that it did not happen', async () => {
  // The honest direction: a throw may mean the payment never went out, or that it did
  // and the response was lost. Recording it as "no spend" would be a guess.
  const r = await paidQuery({
    privateKey: '0x' + '11'.repeat(32),
    fetchImpl: async () => {
      throw new Error('connection reset');
    },
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'paid_request_failed');
  assert.equal(r.spendUnknown, true);
});

test('402 → payment → retry: the wrapper actually pays, with a stubbed gateway', async () => {
  // 🔴 The test the Critical finding asked for, and the one that would have caught it:
  // `wrapFetchWithPayment` needs an x402 CLIENT, not a viem account. With the account
  // the wrapper threw and the request was NEVER retried — a paid path that could not
  // pay. No money moves here: the gateway is a stub.
  const CHALLENGE = Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepts: [
        {
          scheme: 'exact',
          network: 'eip155:8453',
          amount: '10000',
          payTo: '0x79DC34E41B2b591078d3dE222C43EcaaBD52FcCB',
          maxTimeoutSeconds: 300,
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          extra: { assetTransferMethod: 'eip3009', name: 'USD Coin', version: '2' },
        },
      ],
    }),
  ).toString('base64');

  const calls = [];
  const stubGateway = async (_url, init) => {
    calls.push(init?.headers ?? {});
    if (calls.length === 1) {
      return new Response('', { status: 402, headers: { 'payment-required': CHALLENGE } });
    }
    return new Response('{"data":{"ok":true}}', {
      status: 200,
      headers: { 'graph-attestation': '{"requestCID":"0x00"}' },
    });
  };

  const r = await paidQuery({
    privateKey: '0x' + '11'.repeat(32),
    fetchImpl: stubGateway,
  });

  assert.equal(calls.length, 2, 'the request must be RETRIED after the 402');
  assert.equal(r.ok, true);
  assert.equal(r.rawBody, '{"data":{"ok":true}}');
  assert.equal(r.hasAttestation, true);
});


test('null challenge fields are refused, not returned as a confident ok', () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
  const base = { network: 'eip155:8453', amount: '10000', asset: '0x00' };
  for (const field of ['amount', 'asset', 'network']) {
    const broken = b64({ accepts: [{ ...base, [field]: null }] });
    assert.equal(decodeChallenge(broken).reason, 'challenge_incomplete', field);
    const empty = b64({ accepts: [{ ...base, [field]: '  ' }] });
    assert.equal(decodeChallenge(empty).reason, 'challenge_incomplete', `${field} blank`);
  }
  assert.equal(
    decodeChallenge(b64({ accepts: [{ ...base, amount: '1.5' }] })).reason,
    'challenge_amount_not_an_integer',
  );
});

// Тикер — не ключ, и это куплено за деньги, а не выведено рассуждением.
//
// Замер 10.09: запрос `tokens(where: {symbol: "WETH"})` вернул ПЯТЬ разных сущностей,
// все с символом WETH, у всех цена ноль. Настоящего Wrapped Ether среди них не было.
// Токен с любым тикером может задеплоить кто угодно, поэтому тикер опознаёт токен так же,
// как имя опознаёт человека. Адрес контракта этой беды лишён.
test('a token is asked for by address, and the address is validated', () => {
  const q = priceQueryByAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
  // Субграф ключует токены адресом в нижнем регистре: тот же адрес в другом регистре
  // не найдёт ничего, и это молчаливый пустой ответ, а не ошибка.
  assert.match(q, /id: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"/);
  assert.doesNotMatch(q, /0xC02aaA39/, 'адрес уехал в запрос в исходном регистре');
  for (const bad of ['WETH', '0x123', '', '0xzzzz39b223fe8d0a0e5c4f27ead9083c756cc2', null]) {
    assert.throws(() => priceQueryByAddress(bad), /not a contract address/, `принят мусор: ${String(bad)}`);
  }
});

test('asking by ticker returns every namesake, not the first one', () => {
  const q = priceQueryBySymbol('WETH');
  assert.match(q, /symbol: "WETH"/);
  // 🔴 Не `first: 1`. Взять первую строку — значит выбрать однофамильца ровно так же
  // часто, как нужный токен, и не узнать об этом.
  assert.match(q, new RegExp(`first: ${SYMBOL_MATCH_LIMIT}`));
  for (const bad of ['', 'a'.repeat(33), 'DROP TABLE', '"; }']) {
    assert.throws(() => priceQueryBySymbol(bad), /not a plausible symbol/, `принят мусор: ${String(bad)}`);
  }
});

// Предел выдачи объявлен, а не спрятан.
//
// Ревью справедливо заметило: срезка на двадцати молча теряла совпадения. Пагинация тут
// не решение — КАЖДАЯ страница это платный запрос, и тикер с тысячей однофамильцев
// опустошил бы кошелёк, отвечая на один вопрос. Поэтому потолок поднят до сотни, задан
// явно и проверяется, а насыщение вызывающий обязан увидеть отдельным словом.
test('the result ceiling is explicit and bounded by what the gateway accepts', () => {
  assert.equal(SYMBOL_MATCH_LIMIT, 100);
  assert.match(priceQueryBySymbol('WETH', 7), /first: 7/);
  for (const bad of [0, -1, 1001, 2.5, 'x', null]) {
    // 1000 — потолок самого The Graph. Запрос сверх него шлюз отвергает, и отвергает
    // ПОСЛЕ списания: за такую опечатку платит вызывающий, поэтому проверяем здесь.
    assert.throws(() => priceQueryBySymbol('WETH', bad), /limit must be an integer/, `принят предел ${String(bad)}`);
  }
});

// 🔴 Побайтово, а не по фрагментам.
//
// Ревью право: проверки по кускам пропускают смену пробелов, полей и служебного блока —
// байты запроса меняются, requestCID меняется, тест молчит. Здесь запрос сверяется целиком.
// Вторая линия уже стоит в test/leverage.test.js: там от PRICE_QUERY берётся sha256 и
// сверяется с числом, ЗАПИСАННЫМ в LEVERAGE-EVIDENCE.md, так что расхождение кода и
// документа тоже красное. Эта проверка ближе к месту правки и потому заметнее.
test('PRICE_QUERY is asserted byte for byte, not by fragments', () => {
  const expected =
    '{\n' +
    '  tokens(first: 5, orderBy: lastPriceBlockNumber, orderDirection: desc) {\n' +
    '    id symbol lastPriceUSD lastPriceBlockNumber\n' +
    '  }\n' +
    '  _meta { block { number timestamp } hasIndexingErrors }\n' +
    '}';
  assert.equal(PRICE_QUERY, expected,
    'байты PRICE_QUERY изменились — requestCID в LEVERAGE-EVIDENCE.md больше не воспроизводится');
});

test('the recent query asks only for tokens that carry a price', () => {
  // Без фильтра замер дал пять нулевых из пяти дважды подряд, и пять годных из двадцати
  // при расширении. С фильтром — пять из пяти.
  assert.match(RECENT_PRICED_QUERY, /lastPriceUSD_gt: 0/);
  assert.match(RECENT_PRICED_QUERY, /orderBy: lastPriceBlockNumber/);
});

// 🔴 Этот тест защищает не поведение, а доказательство.
test('PRICE_QUERY is frozen, because LEVERAGE-EVIDENCE.md rests on its exact bytes', () => {
  // requestCID в LEVERAGE-EVIDENCE.md вычислен над этими самыми байтами. Изменить их —
  // значит превратить опубликованное доказательство в утверждение, которое никто не
  // может воспроизвести. Новые запросы добавляются РЯДОМ, этот не трогается.
  assert.match(PRICE_QUERY, /tokens\(first: 5, orderBy: lastPriceBlockNumber, orderDirection: desc\)/);
  assert.doesNotMatch(PRICE_QUERY, /where:/, 'в PRICE_QUERY появился фильтр — доказательство leverage сломано');
});

// Обещание из комментария обязано где-то исполняться.
//
// Ревью на #22 право: `priceQueryBySymbol` объяснял, что насыщение сообщается, а не
// угадывается, — и до этой функции ничто в пакете его не сообщало. Флаг вычислял
// потребитель, то есть читателю этих файлов обещали контракт, который файлы не держат.
test('a symbol answer says whether it was cut off at the ceiling', () => {
  const rows = (n) => JSON.stringify({ data: { tokens: Array.from({ length: n }, () => ({ symbol: 'WETH' })) } });

  // Ровно потолок — «столько поместилось», а не «это все» и не «есть ещё».
  assert.equal(shapeSymbolMatches(rows(SYMBOL_MATCH_LIMIT)).saturated, true);
  assert.equal(shapeSymbolMatches(rows(SYMBOL_MATCH_LIMIT - 1)).saturated, false);
  assert.equal(shapeSymbolMatches(rows(0)).saturated, false);

  // Потолок берётся из аргумента, а не из умолчания: иначе проверка молчит при любом
  // пределе, кроме одного, и запрос с `first: 3` считался бы ненасыщенным всегда.
  assert.equal(shapeSymbolMatches(rows(3), 3).saturated, true);
  assert.equal(shapeSymbolMatches(rows(3), 4).saturated, false);
  assert.equal(shapeSymbolMatches(rows(3), 3).limit, 3);
});

test('a symbol answer that is not an answer refuses by name', () => {
  assert.equal(shapeSymbolMatches('{').reason, 'body_not_json');
  assert.equal(shapeSymbolMatches(JSON.stringify({ errors: [{ message: 'boom' }] })).reason, 'graphql_errors');
  assert.equal(shapeSymbolMatches(JSON.stringify({ data: {} })).reason, 'no_tokens_field');
  // 🔴 Пустой список — это ОТВЕТ «совпадений нет», а не сбой. Спутать их значит послать
  // вызывающего чинить запрос там, где чинить нечего.
  assert.equal(shapeSymbolMatches(JSON.stringify({ data: { tokens: [] } })).ok, true);
});

// Потолок на платёж — настоящий, а не проверка «перед».
//
// Ревью на signer-mcp#19 право по сути и неточно в деталях: потолок существовал и до
// правки — библиотека режет на `$1` за платёж по умолчанию. Только запрос стоит цент,
// то есть защита была в сто раз слабее нужной, и подорожавший до 99 центов вызов
// подписался бы молча. Здесь потолок задан явно и проверяется НАСТОЯЩЕЙ заготовкой 402,
// снятой со шлюза: меняется в ней только сумма.
//
// 🔴 Первая версия этого теста строила заготовку руками, и отказ пришёл от разбора, а не
// от потолка — то есть тест был зелёным, ничего не проверив. Фикстура снята с прода.
test('a 402 above the ceiling is refused before anything is signed', async () => {
  const { readFileSync } = await import('node:fs');
  const challengePath = new URL('./fixtures/challenge-402.json', import.meta.url);
  const challenge = JSON.parse(readFileSync(challengePath, 'utf8'));
  const serve = (amountAtomic) => {
    const c = JSON.parse(JSON.stringify(challenge));
    c.accepts[0].amount = String(amountAtomic);
    const header = Buffer.from(JSON.stringify(c)).toString('base64');
    return async () => new Response('{}', { status: 402, headers: { 'payment-required': header } });
  };
  const key = `0x${'11'.repeat(32)}`;

  // Пять центов при потолке в два: подписи быть не должно.
  const over = await paidQuery({ privateKey: key, fetchImpl: serve(50_000) });
  assert.equal(over.ok, false, 'платёж выше потолка прошёл');
  assert.notEqual(over.reason, undefined);
  // Отказ обязан быть ПРО ДЕНЬГИ, а не про разбор: разбор ломается и на верной сумме.
  assert.match(
    `${over.reason} ${JSON.stringify(over.detail ?? '')}`,
    /amount|limit|spend|exceed|max/i,
    `отказ не про сумму — потолок не сработал: ${over.reason} / ${JSON.stringify(over.detail)}`,
  );
});
