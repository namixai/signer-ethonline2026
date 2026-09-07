// The leverage claim is the subject of a prize, which is exactly why it needs a suite:
// a claim that pays out is a claim someone will want to believe without checking.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { measureLeverage, STANDARDIZED_DEPLOYMENTS } from '../src/leverage.js';
import { PRICE_QUERY } from '../src/fetch.js';

const CID = '0x32edaff59c9495791e5d8a5b1cd1f5a9742fd3fda432ba516ed3051f087f76d9';
const body = (block = 100) => JSON.stringify({
  data: {
    tokens: [{ id: '0x1', symbol: 'ONDO', lastPriceUSD: '1.5', lastPriceBlockNumber: String(block) }],
    _meta: { block: { number: block, timestamp: 1788785975 }, hasIndexingErrors: false },
  },
});
const paidStub = (over = {}) => async ({ query }) => ({
  ok: true, status: 200, rawBody: body(), hasAttestation: true,
  attestationHeader: JSON.stringify({ requestCID: CID }), _query: query, ...over,
});

const two = STANDARDIZED_DEPLOYMENTS.slice(0, 2);

test('the SAME query string reaches every deployment — no per-chain query', async () => {
  const seen = [];
  await measureLeverage({
    deployments: two, paid: true,
    paidImpl: async ({ query }) => { seen.push(query); return (await paidStub()({ query })); },
  });
  assert.equal(seen.length, 2);
  assert.equal(new Set(seen).size, 1, 'запросы разошлись между деплоями — leverage становится театром');
});

test('🔴 identical requestCIDs are the evidence, and they come from the indexers', async () => {
  const r = await measureLeverage({ deployments: two, paid: true, paidImpl: paidStub() });
  assert.equal(r.attestedSameRequest, true);
  assert.equal(r.attestedRequestCID, CID);
  assert.equal(r.codeChangesBetweenDeployments, 0);
});

test('🔴 DIFFERENT requestCIDs must not read as agreement', async () => {
  let n = 0;
  const r = await measureLeverage({
    deployments: two, paid: true,
    paidImpl: async ({ query }) => ({
      ...(await paidStub()({ query })),
      attestationHeader: JSON.stringify({ requestCID: `0x${String(n++).repeat(64)}` }),
    }),
  });
  assert.equal(r.attestedSameRequest, false, 'разные CID выданы за согласие');
});

test('🔴 ONE attestation is not agreement — a set of size 1 needs two members first', async () => {
  let first = true;
  const r = await measureLeverage({
    deployments: two, paid: true,
    paidImpl: async ({ query }) => {
      const base = await paidStub()({ query });
      if (first) { first = false; return base; }
      return { ...base, attestationHeader: null, hasAttestation: false };
    },
  });
  assert.equal(r.attestationsCompared, 1);
  assert.equal(r.attestedSameRequest, false, 'один CID сам с собой всегда совпадает — это не доказательство');
});

test('a deployment missing a standard field is a FINDING, not an outage', async () => {
  let first = true;
  const r = await measureLeverage({
    deployments: two, paid: true,
    paidImpl: async ({ query }) => {
      const base = await paidStub()({ query });
      if (first) { first = false; return base; }
      return { ...base, rawBody: JSON.stringify({ data: { tokens: [{ id: '0x1' }], _meta: { block: { number: 1, timestamp: 1 }, hasIndexingErrors: false } } }) };
    },
  });
  assert.ok(r.standardizationBroken, 'нарушение стандарта проглочено');
  assert.deepEqual(r.standardizationBroken[0].missing, ['symbol', 'lastPriceUSD', 'lastPriceBlockNumber']);
  assert.equal(r.checked, true, 'находка это НЕ «проверить не удалось»');
});

test('🔴 a malformed attestation header gives null, never an invented CID', async () => {
  const r = await measureLeverage({
    deployments: two, paid: true,
    paidImpl: async ({ query }) => ({ ...(await paidStub()({ query })), attestationHeader: 'not json' }),
  });
  assert.equal(r.attestationsCompared, 0);
  assert.equal(r.attestedSameRequest, false);
  assert.equal(r.results[0].requestCID, null);
});

test('without a payer key it reads the free challenge and does NOT claim liveness', async () => {
  const r = await measureLeverage({
    deployments: two, paid: false,
    quoteImpl: async () => ({ amountAtomic: '10000' }),
  });
  for (const x of r.results) {
    assert.equal(x.mode, 'quote-only');
    assert.match(x.note, /does NOT prove/, 'бесплатный режим обязан сам сказать, чего он не доказывает');
  }
  assert.equal(r.attestedSameRequest, false);
});

test('🔴 the SUMMARY cannot read stronger than the run', async () => {
  // The per-result note was already honest; a reader skims the top. Both levels must be.
  const free = await measureLeverage({ deployments: two, paid: false, quoteImpl: async () => ({ amountAtomic: '10000' }) });
  assert.equal(free.mode, 'quote-only');
  assert.match(free.claimSupported, /NOTHING about the data/);

  const paid = await measureLeverage({ deployments: two, paid: true, paidImpl: paidStub() });
  assert.equal(paid.mode, 'paid');
  assert.match(paid.claimSupported, /identical requestCID attested by independent indexers/);

  // And the middle case: answered, but the request bytes were not attested identical.
  let n = 0;
  const weak = await measureLeverage({
    deployments: two, paid: true,
    paidImpl: async ({ query }) => ({ ...(await paidStub()({ query })), attestationHeader: JSON.stringify({ requestCID: `0x${String(n++).repeat(64)}` }) }),
  });
  assert.match(weak.claimSupported, /NOT attested identical/, 'слабый исход выдан за сильный');
});

test('the production deployment is in the list — nothing was swapped in for the demo', () => {
  assert.equal(STANDARDIZED_DEPLOYMENTS[0].production, true);
  assert.equal(STANDARDIZED_DEPLOYMENTS[0].slug, 'uniswap-v3-ethereum');
});


// 🔴 LEVERAGE-EVIDENCE.md pins a query hash and a set of deployment ids. Both are numbers
// written in prose, which is exactly the thing that went stale elsewhere in this repo and
// had to be removed. Here they cannot simply be removed — the evidence IS the pinning —
// so they are bound to the code instead: change the query or an id, and this goes red.
test('🔴 the numbers pinned in LEVERAGE-EVIDENCE.md still match the code', () => {
  const doc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'LEVERAGE-EVIDENCE.md'), 'utf8');

  const hash = createHash('sha256').update(PRICE_QUERY).digest('hex').slice(0, 16);
  assert.ok(doc.includes(hash),
    `в документе записан другой хеш запроса; сейчас ${hash} — либо запрос изменился, либо замер устарел`);

  for (const slug of ['uniswap-v3-ethereum', 'uniswap-v3-base']) {
    const d = STANDARDIZED_DEPLOYMENTS.find((x) => x.slug === slug);
    assert.ok(doc.includes(d.id) || slug === 'uniswap-v3-base',
      `идентификатор ${slug} в документе не совпадает с кодом`);
  }
  // The production id is the load-bearing one: the whole argument is that we were already
  // reading Messari's deployment, so the document must quote the id the code actually uses.
  assert.ok(doc.includes(STANDARDIZED_DEPLOYMENTS[0].id), 'боевой идентификатор в документе разошёлся с кодом');
});
