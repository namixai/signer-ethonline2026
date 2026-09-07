// Step 2: is the response USABLE?
//
// 🔴 This does not follow from step 1, and that is not a theoretical worry.
// Fixture sample 2 is a GraphQL error response with no data at all — correctly
// attested and normally billed. Signature verified, responseCID matched, nothing
// to price with. A caller that treats "signature checked" as "price obtained"
// will compare an order against an absent number.
//
// Every predicate below is a REFUSAL when unmet, never a warning, and never a
// fallback to a previous value: a stale reference lets the band be satisfied by
// a wrong price, which turns the guard into a hole rather than weakening it.

export const STALENESS_LIMIT_BLOCKS = 200n; // ~40 min on Ethereum; the policy owner sets the real one.

function fail(reason, detail) {
  return { ok: false, reason, detail };
}

/**
 * @param body        parsed response (the parse must be of a COPY; keep raw bytes intact)
 * @param wantSymbol  token symbol we need a price for, e.g. 'WETH'
 * @param chainHead   current block height, read independently (free public RPC)
 */
export function checkUsable(body, wantSymbol, chainHead, limit = STALENESS_LIMIT_BLOCKS) {
  // A GraphQL error is a refusal, not a warning. Sample 2 proves it can arrive
  // fully attested.
  if (body?.errors !== undefined) {
    return fail('graphql_errors', { errors: body.errors });
  }
  if (!body?.data || Object.keys(body.data).length === 0) {
    return fail('empty_data');
  }

  const meta = body.data._meta;
  if (!meta?.block?.number && meta?.block?.number !== 0) {
    return fail('missing_meta_block');
  }
  if (meta.hasIndexingErrors !== false) {
    return fail('indexing_errors', { hasIndexingErrors: meta.hasIndexingErrors });
  }

  // Source freshness. This is the check the GMX trap would have defeated: there,
  // INDEXING showed 100% while the price had not moved in a year, because the
  // price is written inside event handlers and a dead market fires none.
  // 🔴 ОБА ЧИСЛА ЧЕРЕЗ ПРОВЕРКУ, а не прямо в BigInt. Условие выше смотрело только
  // истинность, поэтому "abc" или "25904639.0" доводили BigInt до SyntaxError, и он уходил
  // из checkUsable мимо контракта — при том что для блока ЦЕНЫ это правило уже
  // сформулировано ниже. Правило было и применялось к одному из двух. Замерено: бросали
  // оба, и кривой chainHead тоже.
  const asBlock = (v) => {
    if (v === undefined || v === null || v === '' || typeof v === 'boolean') return null;
    try { return BigInt(v); } catch { return null; }
  };
  const head = asBlock(chainHead);
  if (head === null) return fail('bad_chain_head', { chainHead: String(chainHead) });
  const metaBlockN = asBlock(meta.block.number);
  if (metaBlockN === null) return fail('bad_meta_block', { number: String(meta.block.number) });

  const lag = head - metaBlockN;
  if (lag < 0n) return fail('source_ahead_of_chain', { lag: lag.toString() });
  if (lag > limit) {
    return fail('source_stale', { lag: lag.toString(), limit: limit.toString() });
  }

  const tokens = body.data.tokens ?? [];
  const token = tokens.find((t) => t.symbol === wantSymbol);
  if (!token) return fail('token_not_found', { wantSymbol });

  // "0" is a LEGITIMATE value for long-tail tokens whose price the mapping does
  // not compute (LYX and TREAT in sample 1) — and unusable as a reference.
  // NaN === 0 is false, so a garbage price would sail past a bare zero-check and
  // become the reference the band is measured against. Require a real positive number.
  const price = Number(token.lastPriceUSD);
  if (token.lastPriceUSD == null || !Number.isFinite(price) || price <= 0) {
    return fail('price_absent_or_zero', { symbol: wantSymbol, lastPriceUSD: token.lastPriceUSD });
  }
  // `== null` catches null as well as undefined: BigInt(null) throws, and a crash
  // is not a refusal — everything malformed must come back as a named reason.
  if (token.lastPriceBlockNumber == null) {
    return fail('missing_last_price_block');
  }
  let priceBlock;
  try {
    priceBlock = BigInt(token.lastPriceBlockNumber);
  } catch {
    return fail('bad_last_price_block', { value: String(token.lastPriceBlockNumber) });
  }

  // The price carries its OWN age, separate from the subgraph's head. A snapshot
  // can be freshly signed over a year-old price; both ages must be bounded.
  const priceLag = head - priceBlock;
  // A price block ahead of the chain head is not "very fresh" — it is nonsense, and
  // a negative lag would sail under any upper bound. Same guard as for the source.
  if (priceLag < 0n) {
    return fail('price_block_ahead_of_chain', { priceLag: priceLag.toString() });
  }
  if (priceLag > limit) {
    return fail('price_stale', { priceLag: priceLag.toString(), limit: limit.toString() });
  }

  return {
    ok: true,
    symbol: token.symbol,
    priceUSD: token.lastPriceUSD,
    priceBlock: String(token.lastPriceBlockNumber),
    metaBlock: String(meta.block.number),
    sourceLagBlocks: lag.toString(),
    priceLagBlocks: priceLag.toString(),
  };
}
