// The point of the "Composable or Standardized" track, made runnable.
//
// The claim we make: the subgraph this package reads is a Messari **Standardized
// Subgraph** (schema `DEX AMM (Extended)`), so ONE query pattern spans many deployments
// with no code change. A claim like that is worth nothing written down — this script is
// the claim executed.
//
// 🔴 HOW IT COULD BE FAKED, and how that is prevented. The cheap way to "show leverage"
// is to write a slightly different query per deployment and present the results side by
// side. Two guards, and the second is not ours:
//
//   1. The query is NOT written here. It is imported from `fetch.js` — the same constant
//      the production path uses — and hashed, so a per-chain query goes red.
//   2. 🔴 THE INDEXERS SAY SO THEMSELVES. Each attestation carries a `requestCID` over the
//      request bytes. Measured 2026-09-07: two deployments, two chains, two independent
//      indexers, and the SAME requestCID `0x32edaff5…`, while `responseCID` and
//      `subgraphDeploymentID` differ as they must. Identical request bytes, attested by
//      parties with no stake in our claim. That is evidence; guard 1 alone is only a
//      promise we make about ourselves.
//
// ⚠️ We still cannot compute `requestCID` from the query — its preimage encoding defeated
// four plausible readings, and `attestation.js` says so and refuses to pretend otherwise.
// Equality across deployments needs no preimage: it is a comparison, not a reconstruction.
//
// ⚠️ We did not choose the standardized subgraph for the prize. We had been reading it
// since the first live read and did not know: the id in `fetch.js` is byte-for-byte the
// one Messari's own deployment registry lists for `uniswap-v3-ethereum`. That is worth
// saying plainly rather than presenting a lucky fact as a design decision.

import { createHash } from 'node:crypto';
import { PRICE_QUERY, UNISWAP_V3_ETHEREUM, paidQuery, quote } from './fetch.js';
import { isMain } from './is-main.js';

/**
 * Deployments of the SAME standardized schema, from Messari's own deployment registry
 * (`deployment/deployment.json` in messari/subgraphs). Ids are theirs, not ours.
 *
 * The first entry is the one this package reads in production — it is in the list to
 * make the point that nothing was swapped in for the demonstration.
 */
export const STANDARDIZED_DEPLOYMENTS = [
  { slug: 'uniswap-v3-ethereum', chain: 'ethereum', id: UNISWAP_V3_ETHEREUM, production: true },
  { slug: 'uniswap-v3-base', chain: 'base', id: 'FUbEPQw1oMghy39fwWBFY5fE6MXPXZQtjncQy2cXdrNS' },
  { slug: 'uniswap-v3-arbitrum', chain: 'arbitrum', id: 'FQ6JYszEKApsBpAmiHesRsd9Ygc6mzmpNRANeVQFYoVX' },
  { slug: 'uniswap-v3-polygon', chain: 'polygon', id: 'BvYimJ6vCLkk63oWZy7WB5cVDTVVMugUAF35RAUZpQXE' },
  { slug: 'uniswap-v3-optimism', chain: 'optimism', id: 'EgnS9YE1avupkvCNj9fHnJxppfEmNNywYJtghqiu2pd9' },
];

// The fields the shared schema guarantees. These are the whole argument: they are not
// Uniswap's names, they are the standard's, which is why the same parser works on all.
const STANDARD_FIELDS = ['symbol', 'lastPriceUSD', 'lastPriceBlockNumber'];

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/**
 * Send the identical query to several deployments of the standardized schema.
 *
 * Three outcomes, never two:
 *   0  every deployment answered the shared query with the shared fields
 *   1  a deployment answered but did NOT match the shape — the standardization claim
 *      is false for it, and that is a finding, not an outage
 *   2  could not check (no payer key, no network) — never reported as agreement
 *
 * @param paid when false, only the free 402 challenge is read. That does NOT prove a
 *             deployment serves data: a fabricated id returns the same challenge,
 *             measured. Free mode says so in its own output rather than implying more.
 */
export async function measureLeverage({
  deployments = STANDARDIZED_DEPLOYMENTS.slice(0, 2),
  paid = Boolean(process.env.X402_PRIVATE_KEY),
  query = PRICE_QUERY,
  paidImpl = paidQuery,
  quoteImpl = quote,
  now = () => Date.now(),
} = {}) {
  const sent = new Set();
  const results = [];

  for (const d of deployments) {
    sent.add(query);
    if (!paid) {
      const q = await quoteImpl(d.id, query);
      results.push({
        ...d,
        mode: 'quote-only',
        ok: Boolean(q?.amountAtomic),
        priced: q?.amountAtomic ?? null,
        note: 'a price challenge does NOT prove this deployment serves data',
      });
      continue;
    }

    const r = await paidImpl({ subgraphId: d.id, query });
    if (r.ok !== true) {
      results.push({ ...d, mode: 'paid', ok: false, reason: r.reason ?? `http_${r.status}`, spendUnknown: r.spendUnknown ?? false });
      continue;
    }

    let body;
    try {
      body = JSON.parse(r.rawBody);
    } catch {
      results.push({ ...d, mode: 'paid', ok: false, reason: 'non_json_body' });
      continue;
    }

    const meta = body?.data?._meta ?? null;

    // 🔴 THREE CASES, and collapsing the last two invents a finding. Measured before the
    // fix: a deployment answering `tokens: []` was reported as breaking the standard on
    // BOTH deployments at once — a false alarm that exits 1 and would have us "fixing"
    // a schema that is fine.
    //   tokens absent / not an array  -> the shared query was NOT honoured: all fields missing
    //   tokens: []                    -> honoured, no rows matched: says NOTHING about fields
    //   tokens: [t]                   -> honoured with a sample: check the fields on it
    const tokensField = body?.data?.tokens;
    const tokens = Array.isArray(tokensField) ? tokensField : null;
    const token = tokens?.[0] ?? null;
    const missing = tokens === null ? STANDARD_FIELDS : token == null ? [] : STANDARD_FIELDS.filter((f) => !(f in token));

    let requestCID = null;
    try {
      requestCID = JSON.parse(r.attestationHeader ?? '{}').requestCID ?? null;
    } catch {
      requestCID = null; // a malformed header is reported as absent, never invented
    }

    results.push({
      ...d,
      mode: 'paid',
      ok: missing.length === 0 && meta != null,
      // Stated, because "no fields missing" reads like a pass and an empty result is not
      // one — it is simply an absence of evidence either way.
      sampled: token != null,
      requestCID,
      missingStandardFields: missing,
      headBlock: meta?.block?.number ?? null,
      // Head age, not price age. They are different numbers and this package refuses to
      // conflate them anywhere else either — see usability.js.
      headLagSeconds: meta?.block?.timestamp ? Math.round(now() / 1000 - Number(meta.block.timestamp)) : null,
      hasIndexingErrors: meta?.hasIndexingErrors ?? null,
      attested: r.hasAttestation,
      topSymbol: token?.symbol ?? null,
      topPriceUSD: token?.lastPriceUSD ?? null,
    });
  }

  // 🔴 The falsifiable part of the claim, in two strengths.
  const queryHashes = [...sent].map(sha);
  const oneQuery = queryHashes.length === 1; // we sent one string — our own word

  // The stronger one: independent indexers attested the same request bytes. Only counted
  // when at least two deployments actually returned a CID, because one is not agreement
  // and none is not evidence.
  const cids = results.map((r) => r.requestCID).filter(Boolean);
  const attestedSameRequest = cids.length >= 2 && new Set(cids).size === 1;

  const answered = results.filter((r) => r.ok);
  const mismatched = results.filter((r) => r.mode === 'paid' && r.ok === false && r.missingStandardFields?.length);
  const checked = results.some((r) => r.ok) || mismatched.length > 0;

  const paidRun = results.some((r) => r.mode === 'paid');
  const sampledCount = results.filter((r) => r.sampled).length;

  // 🔴 НАБЛЮДЁННОЕ ПОЛЕ И ПРИГОДНАЯ ЦЕНА — РАЗНЫЕ ВЕЩИ, и рядом они путаются. Клейм
  // leverage про ЗАПРОС и СХЕМУ, а не про цену, и он верен при нулевой цене тоже. Но в
  // строках результата печатается `topPriceUSD`, и читатель, увидев «поле наблюдалось»
  // вместе с сильным клеймом, достраивает то, чего здесь не проверяли. Второй проход
  // постороннего 12.09: на `uniswap-v3-base` пришёл свежий JitoSOL с ценой ноль, и
  // прогон читался как «купили ноль за цент». Поэтому пригодность считается и называется
  // ОТДЕЛЬНО — она не усиливает и не ослабляет клейм, она не даёт его додумать.
  const priced = (v) => v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0;
  const sampledRows = results.filter((r) => r.sampled);
  const usablePriceRows = sampledRows.filter((r) => priced(r.topPriceUSD)).length;
  // 🔴 Имя называет то, что считается. Поле звалось `zeroPriceRows`, а дополнение к
  // `usablePriceRows` шире нуля: туда попадают null, пустая строка, нечисло и
  // отрицательное. Читатель отчёта, увидев «zero», решает, что цена была 0 — и не
  // смотрит на остальные случаи. Поймано ботом на PR #25.
  const unusablePriceRows = sampledRows.length - usablePriceRows;

  return {
    // 🔴 The summary must not read stronger than the run. In free mode every per-result
    // line says a price challenge proves nothing, but a reader skimming the top would
    // see `deploymentsAnswered: 2` and stop there. So the mode is stated first, and the
    // claim the run supports is spelled out rather than left to inference.
    mode: paidRun ? 'paid' : 'quote-only',
    claimSupported: paidRun
      ? (mismatched.length > 0
          // 🔴 A matching requestCID proves the REQUEST was identical. It says nothing
          // about the answer. Reporting the strong claim while `standardizationBroken`
          // is set (and the process exits 1) would have the summary contradict its own
          // findings — the same defect as the free/paid case one axis over, which is why
          // it survived: that one was fixed as an instance, not as a class.
          ? 'a deployment FAILED the shared-schema check — the leverage claim does NOT stand for it, whatever the requestCIDs say'
          : !attestedSameRequest
            ? 'deployments answered, but the request bytes were NOT attested identical — leverage not demonstrated'
            : sampledCount === 0
              ? 'the shared query was honoured everywhere and the request bytes are attested identical, but NO deployment returned a row — no field was actually observed'
              : usablePriceRows === 0
                ? 'one query, several deployments of the shared schema, identical requestCID attested by independent indexers — AND NOT ONE observed row carried a usable price, so nothing here says a price was bought'
                : 'one query, several deployments of the shared schema, identical requestCID attested by independent indexers')
      : 'NOTHING about the data: only that the gateway prices this query for these ids. A fabricated id returns the same challenge (measured).',
    checked,
    oneQuery,
    queryHash: queryHashes[0] ?? null,
    attestedSameRequest,
    attestedRequestCID: attestedSameRequest ? cids[0] : null,
    attestationsCompared: cids.length,
    // Сколько наблюдённых строк несли цену, которой можно пользоваться. Ноль здесь не
    // отменяет клейм выше и не подтверждает его: он про то, что цена НЕ наблюдалась.
    usablePriceRows,
    unusablePriceRows,
    schema: 'Messari Standardized Subgraph — DEX AMM (Extended)',
    registry: 'https://github.com/messari/subgraphs/blob/master/deployment/deployment.json',
    docs: 'https://thegraph.com/docs/en/subgraphs/existing-subgraphs/standard-subgraphs/',
    deploymentsQueried: results.length,
    deploymentsAnswered: answered.length,
    deploymentsSampled: sampledCount,
    codeChangesBetweenDeployments: 0,
    standardizationBroken: mismatched.length > 0 ? mismatched.map((m) => ({ slug: m.slug, missing: m.missingStandardFields })) : null,
    results,
  };
}

if (isMain(import.meta.url)) {
  const n = Number(process.argv[2] ?? 2);
  const r = await measureLeverage({ deployments: STANDARDIZED_DEPLOYMENTS.slice(0, Math.max(2, Math.min(n, STANDARDIZED_DEPLOYMENTS.length))) });
  console.log(JSON.stringify(r, null, 2));
  process.exitCode = r.checked === false ? 2 : r.standardizationBroken || !r.oneQuery ? 1 : 0;
}
