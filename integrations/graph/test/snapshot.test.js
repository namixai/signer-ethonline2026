import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSnapshot, judgeOrder, bandFor, SNAPSHOT_SCHEMA, MAX_PAYLOAD_BYTES } from '../src/snapshot.js';

// 🔴 THE USABILITY INPUT IS BUILT BY checkUsable, NOT HAND-WRITTEN.
//
// The hand-written version carried `sourceBlock`, which is the name my snapshot code
// expected — while checkUsable actually returns `metaBlock`. The test agreed with the code
// instead of with the world, `?? ''` swallowed the mismatch, and `source_block` shipped
// EMPTY inside a signed artifact for a day. 122 tests did not notice, because they all
// asked the same wrong question.
//
// Deriving the fixture from the real function makes that class of drift impossible: rename
// a field in checkUsable and this goes red here rather than blank in production.
import { checkUsable } from '../src/usability.js';
import { readFileSync as _read } from 'node:fs';
import { fileURLToPath as _u } from 'node:url';
import { dirname as _d, join as _j } from 'node:path';

const _fxdir = _j(_d(_u(import.meta.url)), 'fixtures');
const _liveBody = JSON.parse(_read(_j(_fxdir, 'live-2026-09-04.body.json'), 'utf8'));
const LIVE_HEAD = 25904646n;
const LIVE_BLOCK_TS_MS = 1788533135 * 1000;

const good = () => ({
  subgraphId: '4cKy6QQMc5tpfdx8yxfYeb9TLZmgLQe44ddW1G7NwkA6',
  symbol: 'ONDO',
  verification: {
    ok: true,
    responseCID: '0xde663f13b66b00fce1ded5a617a4090b02c4431eceeed80039b3490a41349880',
    allocationId: '0xfDA28033222bE885965EB5c3011cc2280B7E3e99',
    subgraphDeploymentID: '0xcd25cb3fc522dabb',
  },
  usability: checkUsable(_liveBody, 'ONDO', LIVE_HEAD),
  indexer: { ok: true, indexer: '0x4e5c87772C29381bCaBC58C3f182B6633B5a274a' },
  chainHead: LIVE_HEAD,
  blockTimestampMs: LIVE_BLOCK_TS_MS,
  observedAtMs: LIVE_BLOCK_TS_MS + 1000,
});

test('the same inputs produce byte-identical output', () => {
  const a = buildSnapshot(good());
  const b = buildSnapshot(good());
  assert.equal(a.ok, true);
  assert.equal(a.dataText, b.dataText, 'сборка обязана быть детерминированной');
});

test('🔴 not one JSON number survives — canonical_v1 rejects them outright', () => {
  const { dataText } = buildSnapshot(good());
  // Every value must be a string, an object, or null. A bare number anywhere means the
  // enclave would refuse to canonicalise, and float canonicalisation is where independent
  // implementations diverge.
  const walk = (v, path) => {
    if (typeof v === 'number') assert.fail(`JSON-число по пути ${path}: ${v}`);
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(JSON.parse(dataText), '$');
});

test('every failed check becomes a NAMED refusal artifact, never an absence', () => {
  const cases = [
    [{ verification: { ok: false, reason: 'response_cid_mismatch' } }, 'attestation_not_verified', 'response_cid_mismatch'],
    [{ usability: { ok: false, reason: 'price_stale' } }, 'reading_not_usable', 'price_stale'],
    [{ indexer: { ok: false, reason: 'allocation_lookup_failed' } }, 'indexer_not_resolved', 'allocation_lookup_failed'],
    [{ usability: { ok: true, priceUSD: 'abc' } }, 'price_not_decimal_string', undefined],
  ];
  for (const [override, reason, detail] of cases) {
    const r = buildSnapshot({ ...good(), ...override });
    assert.equal(r.ok, false, reason);
    assert.equal(r.refusal.reason, reason);
    assert.equal(r.refusal.schema, SNAPSHOT_SCHEMA, 'отказ — такой же артефакт, со схемой');
    if (detail !== undefined) assert.equal(r.refusal.detail, detail, 'причина нижнего уровня сохранена');
  }
});

test('a refusal carries the reason the check gave, not a generic one', () => {
  const r = buildSnapshot({ ...good(), usability: { ok: false, reason: 'graphql_errors' } });
  assert.equal(r.refusal.detail, 'graphql_errors', 'иначе оператор не узнает, что именно случилось');
});

test('malformed request refuses by name and never throws', () => {
  for (const bad of [undefined, {}, { subgraphId: 'x' }, { subgraphId: 'x', symbol: 'W' }]) {
    const r = buildSnapshot(bad);
    assert.equal(r.ok, false);
    assert.equal(r.refusal.reason, 'bad_request');
  }
});

test('🔴 the band is exact integer arithmetic on a 30-digit price', () => {
  // Float would lose this outright. Expected values computed independently with Python
  // Decimal, not read off this implementation's output.
  const b = bandFor('2427.244046766495834139174824410641', 500n);
  assert.equal(b.low, '2305.881844428171042432216083190108');
  assert.equal(b.high, '2548.606249104820625846133565631173');
  assert.equal(b.low.split('.')[1].length, 30);
});

test('🔴 a snapshot observed BEFORE the block it reports is refused', () => {
  // It shipped: observed_at_ms said 2025-09-04 against a block stamped 2026-09-04, a year
  // early, and it was signed. Not a tolerance knob — you cannot observe a block that does
  // not exist yet.
  const r = buildSnapshot({ ...good(), observedAtMs: LIVE_BLOCK_TS_MS - 1 });
  assert.equal(r.ok, false);
  assert.equal(r.refusal.reason, 'observed_before_block');
  const ok = buildSnapshot({ ...good(), observedAtMs: LIVE_BLOCK_TS_MS });
  assert.equal(ok.ok, true, 'ровно в момент блока — допустимо');
});

test('🔴 block numbers must be PRESENT, not default to an empty string', () => {
  for (const key of ['metaBlock', 'priceBlock']) {
    const u = { ...good().usability, [key]: undefined };
    const r = buildSnapshot({ ...good(), usability: u });
    assert.equal(r.ok, false, key);
    assert.equal(r.refusal.reason, 'missing_block_number');
    assert.equal(r.refusal.detail, key);
  }
  const r = buildSnapshot({ ...good(), chainHead: undefined });
  assert.equal(r.refusal.reason, 'missing_block_number');
});

test('🔴 source_block is populated from what checkUsable actually returns', () => {
  const { snapshot } = buildSnapshot(good());
  assert.equal(snapshot.reading.source_block, '25904639');
  assert.notEqual(snapshot.reading.source_block, '', 'пустое поле в подписываемом артефакте хуже отсутствующего');
  assert.equal(snapshot.reading.block_timestamp_ms, String(LIVE_BLOCK_TS_MS));
});

test('band arithmetic on a whole number keeps it whole', () => {
  assert.deepEqual(bandFor('100', 1000n), { low: '90', high: '110' });
});

test('an absurd band width is refused rather than silently clamped', () => {
  assert.equal(bandFor('100', 10_000n), null);
  assert.equal(bandFor('100', -1n), null);
  assert.equal(buildSnapshot({ ...good(), bandBps: 10_000n }).refusal.reason, 'band_not_computable');
});

test('🔴 the rule decides — below, inside and above are three different answers', () => {
  const { snapshot } = buildSnapshot(good());
  // Значения берутся ОТ САМОЙ полосы, а не вписаны числами: иначе смена фикстуры молча
  // превращает тест в проверку не того. Ровно так он и сломался при переходе с WETH на
  // ONDO — и это правильный способ сломаться, потому что заметно.
  assert.equal(judgeOrder(snapshot, snapshot.reading.price_usd).allowed, true, 'своя же цена — внутри');

  const low = judgeOrder(snapshot, '0.0001');
  assert.equal(low.allowed, false);
  assert.equal(low.reason, 'below_band');

  const high = judgeOrder(snapshot, '999');
  assert.equal(high.allowed, false);
  assert.equal(high.reason, 'above_band');
});

test('the boundary is inclusive, and comparison is exact at 30 decimals', () => {
  const { snapshot } = buildSnapshot(good());
  assert.equal(judgeOrder(snapshot, snapshot.band.low_usd).allowed, true, 'ровно на границе — внутри');
  assert.equal(judgeOrder(snapshot, snapshot.band.high_usd).allowed, true);
  // one unit in the last place below the low bound must fall out
  const justBelow = snapshot.band.low_usd.replace(/[1-9]$/, (d) => String(Number(d) - 1));
  if (justBelow !== snapshot.band.low_usd) {
    assert.equal(judgeOrder(snapshot, justBelow).allowed, false, 'на одну единицу ниже — снаружи');
  }
});

test('a malformed order price is refused, not compared', () => {
  const { snapshot } = buildSnapshot(good());
  for (const bad of [undefined, null, '', 'abc', '-1', 12, {}]) {
    const r = judgeOrder(snapshot, bad);
    assert.equal(r.ok, false, String(bad));
    assert.equal(r.reason, 'order_price_not_decimal_string');
    assert.equal(r.allowed, undefined, 'кривой вход не даёт вердикта');
  }
});

test('🔴 the snapshot states what was NOT checked, in the artifact itself', () => {
  const { snapshot } = buildSnapshot(good());
  assert.ok(snapshot.not_checked.request_cid, 'requestCID: прообраз нам неизвестен');
  assert.match(snapshot.not_checked.indexer_correctness, /not that the number is right/);
});

test('the payload stays well under the enclave limit', () => {
  const r = buildSnapshot(good());
  assert.ok(r.bytes < MAX_PAYLOAD_BYTES / 4, `снимок ${r.bytes} байт`);
});

test('an oversized payload refuses instead of being signed', () => {
  const huge = { ...good(), symbol: 'W'.repeat(MAX_PAYLOAD_BYTES) };
  const r = buildSnapshot(huge);
  assert.equal(r.ok, false);
  assert.equal(r.refusal.reason, 'payload_too_large');
});

// ---- the live paid read of 2026-09-04, kept so it cannot drift from what was served ----

import { verifyAttestation, parseAttestationHeader } from '../src/attestation.js';

const liveBody = _read(_j(_fxdir, 'live-2026-09-04.body.json'), 'utf8').trim();
const liveAtt = parseAttestationHeader(_read(_j(_fxdir, 'live-2026-09-04.attestation.json'), 'utf8'));

test('🔴 the live capture still matches the indexer’s own responseCID', async () => {
  // Paid on 2026-09-04 for $0.01 USDC, settlement 0x8b36eb49… on Base. This asserts the
  // stored bytes are the bytes that were served: an editor stripping a newline or
  // re-indenting the file would change the hash, and the recording would quietly stop
  // being the thing the indexer signed.
  const r = await verifyAttestation(liveBody, liveAtt);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.responseCID, '0xde663f13b66b00fce1ded5a617a4090b02c4431eceeed80039b3490a41349880');
});

test('the live reading produces a snapshot, and the rule decides on it', async () => {
  const v = await verifyAttestation(liveBody, liveAtt);
  const head = 25904646n; // measured at read time; the subgraph was at 25904639
  const u = checkUsable(JSON.parse(liveBody), 'ONDO', head);
  assert.equal(u.ok, true);

  const r = buildSnapshot({
    subgraphId: '4cKy6QQMc5tpfdx8yxfYeb9TLZmgLQe44ddW1G7NwkA6',
    symbol: 'ONDO', verification: v, usability: u,
    indexer: { ok: true, indexer: '0x4e5c87772C29381bCaBC58C3f182B6633B5a274a' },
    chainHead: head, observedAtMs: 1_757_000_000_000,
  });
  assert.equal(r.ok, true);
  assert.equal(judgeOrder(r.snapshot, r.snapshot.reading.price_usd).allowed, true);
  assert.equal(judgeOrder(r.snapshot, '0.71').allowed, false, 'цена вдвое обязана отвергаться');
});

test('🔴 three tokens in that SAME live answer are priced "0" and are refused', () => {
  // Not a constructed case — it is what the gateway returned. A reference built on a
  // long-tail zero would be a plausible number with nothing behind it.
  const head = 25904646n;
  for (const sym of ['TSLAon', 'Block', 'MM']) {
    const u = checkUsable(JSON.parse(liveBody), sym, head);
    assert.equal(u.ok, false, sym);
    assert.equal(u.reason, 'price_absent_or_zero', sym);
    const r = buildSnapshot({
      subgraphId: 'x', symbol: sym, verification: { ok: true, responseCID: 'x', allocationId: 'x', subgraphDeploymentID: 'x' },
      usability: u, indexer: { ok: true, indexer: 'x' }, chainHead: head, observedAtMs: 1,
    });
    assert.equal(r.ok, false);
    assert.equal(r.refusal.reason, 'reading_not_usable');
    assert.equal(r.refusal.detail, 'price_absent_or_zero', 'причина нижнего уровня доезжает до артефакта');
  }
});

// ---- review round on the signed artifact itself ----

test('🔴 an explicit null never becomes the STRING "null" anywhere in an artifact', async () => {
  // Found by review, not by me — and it is the same shape I had just fixed in the gate
  // receipt, committed again one file over, on the object we invite strangers to check.
  const walk = (v, path) => {
    if (v === 'null' || v === 'undefined') assert.fail(`строка «${v}» по пути ${path}`);
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  for (const t of [null, undefined]) {
    const r = buildSnapshot({ observedAtMs: t });
    assert.equal(r.ok, false);
    assert.equal(r.refusal.observed_at_ms, null, String(t));
    walk(r.refusal, '$refusal');
  }
  const ok = buildSnapshot({ ...good(), blockTimestampMs: null });
  assert.equal(ok.ok, true, 'необязательное поле без метки блока — допустимо');
  assert.equal(ok.snapshot.reading.block_timestamp_ms, null);
  walk(ok.snapshot, '$snapshot');
});

test('🔴 the module carries no Node-only API — a SOURCE guard, because a runtime one cannot', () => {
  // My first version of this test compared the byte count against TextEncoder. It stayed
  // GREEN when I put Buffer back, because Buffer.byteLength returns the same number —
  // the test measured the count, not the dependency. "Does not depend on Node" is a
  // static property and cannot be established by running on Node.
  //
  // Same technique the gateway route guard uses in this repo, and for the same reason.
  const src = _read(_j(_d(_u(import.meta.url)), '..', 'src', 'snapshot.js'), 'utf8');
  const offenders = [];
  for (const api of ['Buffer', 'require(', '__dirname', 'process.']) {
    // Ищем ВНЕ комментариев: комментарий про Buffer в этом файле законен и объясняет,
    // почему его тут нет.
    for (const line of src.split('\n')) {
      const code = line.replace(/\/\/.*$/, '');
      if (code.includes(api)) offenders.push(`${api} в строке: ${line.trim().slice(0, 60)}`);
    }
  }
  assert.deepEqual(offenders, [], 'пакет открывают судьи; привязывать его к Node незачем');
});

test('the byte count is bytes, not characters', () => {
  const { dataText, bytes } = buildSnapshot(good());
  assert.equal(bytes, new TextEncoder().encode(dataText).length);
  assert.equal(new TextEncoder().encode('э'.repeat(10)).length, 20, 'кириллица — два байта на символ');
});
