// Step 2 — usability. The module had NO suite at all until 2026-09-07, which is how a
// review found three block values that sailed through: a negative meta block, a boolean
// price block, a negative price block. A fix landing without a test is a fix nobody can
// keep, so the table below is written by FIELD, not by case — the defect was never one
// bad value, it was one guard applied to a subset of the fields it covers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUsable, STALENESS_LIMIT_BLOCKS } from '../src/usability.js';

const HEAD = 100n;
const body = ({ metaBlock = 100, priceBlock = 100, price = '1.5' } = {}) => ({
  data: {
    _meta: { block: { number: metaBlock }, hasIndexingErrors: false },
    tokens: [{ symbol: 'ONDO', lastPriceUSD: price, lastPriceBlockNumber: priceBlock }],
  },
});

// Every block field, the value that breaks it, and the name it MUST refuse by.
const FIELDS = [
  {
    name: 'chainHead', reason: 'bad_chain_head', except: new Map(),
    call: (v) => checkUsable(body(), 'ONDO', v),
  },
  {
    name: 'meta.block', reason: 'bad_meta_block',
    // ⚠️ A seam, pinned as MEASURED rather than as wished. `false` and `''` are present
    // but falsy, so they hit the earlier `missing_meta_block` guard and never reach the
    // block parser. Both are still refusals by name and neither is accepted, so this is
    // imprecision in the label, not a hole — and recording it here means a future change
    // to the refusal taxonomy shows up as a red test instead of a silent rename.
    except: new Map([[false, 'missing_meta_block'], ['', 'missing_meta_block']]),
    call: (v) => checkUsable(body({ metaBlock: v }), 'ONDO', HEAD),
  },
  {
    name: 'lastPriceBlock', reason: 'bad_last_price_block', except: new Map(),
    call: (v) => checkUsable(body({ priceBlock: v }), 'ONDO', HEAD),
  },
];

// 🔴 -1 is the case that motivated this file. It is not "a small block": with a head of
// 100n it reports a lag of 101n and passes a 200n limit AS FRESH. A malformed reading
// that flatters the bound is worse than one that trips it.
const MALFORMED = [-1, '-1', -5n, true, false, 'abc', '25904639.0', '', 1.5];

for (const f of FIELDS) {
  test(`🔴 ${f.name}: every malformed value refuses by name, none crashes`, () => {
    for (const v of MALFORMED) {
      let r;
      assert.doesNotThrow(() => { r = f.call(v); }, `${f.name}=${String(v)} бросил вместо отказа`);
      assert.equal(r.ok, false, `${f.name}=${String(v)} принято`);
      const want = f.except.get(v) ?? f.reason;
      assert.equal(r.reason, want, `${f.name}=${String(v)} → ${r.reason}, ожидалось ${want}`);
    }
  });
}

test('the guard is not overzealous: real heights still pass', () => {
  for (const v of [0, '0', 100, '100', 100n]) {
    const r = checkUsable(body({ metaBlock: v, priceBlock: v }), 'ONDO', HEAD);
    assert.equal(r.ok, true, `отвергнута законная высота ${String(v)}: ${r.reason}`);
  }
});

// The falsification: undo the guard and this file must go red. Kept as an executable
// note rather than a comment, because a comment cannot be run.
test('🔴 a negative block would pass the freshness bound if the guard were removed', () => {
  const lagIfAccepted = HEAD - BigInt(-1);
  assert.ok(lagIfAccepted < STALENESS_LIMIT_BLOCKS,
    'предпосылка дефекта исчезла: -1 больше не укладывается в предел, тест выше потерял смысл');
  assert.equal(checkUsable(body({ metaBlock: -1 }), 'ONDO', HEAD).reason, 'bad_meta_block');
});

test('absent is not malformed — the two keep separate names', () => {
  // ⚠️ NOT via body(): its default parameter substitutes 100 for an explicit `undefined`,
  // so the helper would quietly test the healthy case. Caught by this very assertion
  // failing on its first run — the same class the module was fixed for, one level up.
  const raw = (v) => ({
    data: {
      _meta: { block: { number: 100 }, hasIndexingErrors: false },
      tokens: [{ symbol: 'ONDO', lastPriceUSD: '1.5', lastPriceBlockNumber: v }],
    },
  });
  assert.equal(checkUsable(raw(null), 'ONDO', HEAD).reason, 'missing_last_price_block');
  assert.equal(checkUsable(raw(undefined), 'ONDO', HEAD).reason, 'missing_last_price_block');
  // and the key missing entirely, which is how a real malformed response arrives
  const noKey = raw(0); delete noKey.data.tokens[0].lastPriceBlockNumber;
  assert.equal(checkUsable(noKey, 'ONDO', HEAD).reason, 'missing_last_price_block');
});
