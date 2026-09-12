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

// Читает записанную аттестацию и НЕ падает, если её испортили. Форма отказа такая же,
// как у verifyAttestation, поэтому вызывающему всё равно, на каком шаге не сошлось.
const readAttestation = (name) => {
  try {
    return parseAttestationHeader(fx(name));
  } catch (err) {
    return {
      ok: false,
      reason: 'attestation_header_unreadable',
      detail: { fixture: name, note: String(err?.message ?? err).slice(0, 80) },
    };
  }
};

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

await step(1, 'The agent asks the price. This is free — reading a 402 costs nothing.');
const q = await quote();
if (q.ok) {
  say(`the gateway asks ${Number(q.amountAtomic) / 1e6} USDC on ${q.network}`);
  say(`payment method: ${q.transferMethod}, token "${q.tokenDomain.name}" v${q.tokenDomain.version}`);
} else {
  say('gateway unreachable:', q.reason);
}

await step(2, 'The answer carries the indexer\u2019s signature. We check it over the EXACT bytes.');
const body1 = fx('live-2026-09-04.body.json').trim();
// 🔴 РАЗБОР ЗАГОЛОВКА БРОСАЕТ ПО КОНТРАКТУ, и три теста это утверждают, — поэтому
// ловим здесь, а не меняем его. Это тот файл, который посторонний правит руками: он
// переворачивает разряд в подписи и запускает демо. Отказ по имени он увидеть должен,
// стектрейс — нет. Найдено вторым проходом постороннего 12.09.
const att1 = readAttestation('live-2026-09-04.attestation.json');
const v1 = att1.ok === false ? att1 : await verifyAttestation(body1, att1);
say('responseCID matched:', v1.ok);
say('recovered allocation address:', v1.allocationId);

await step(3, 'Who stands behind that signature. This is an on-chain read — an enclave cannot do it.');
if (!v1.ok) {
  // Do not walk on past a signature that did not verify: a secondary resolve error would
  // mask the primary one, and the screen would name the wrong cause.
  say('step skipped — signature did not verify:', v1.reason);
} else {
  try {
    // 🔴 The deployment id is passed ON PURPOSE. With `undefined`, the check in chain.js
    // that the allocation belongs to THIS subgraph switches itself off silently, and the
    // frame would show an indexer as if the chain had confirmed it. A claim stronger than
    // what was done — exactly what we do not do, least of all on camera.
    const who = await resolveIndexer(v1.allocationId, v1.subgraphDeploymentID, arbitrumClient());
    say(who.ok ? `staked indexer: ${who.indexer}` : `could not establish: ${who.reason}`);
    if (who.ok) say(`and the allocation is for THIS subgraph: ${v1.subgraphDeploymentID.slice(0, 18)}\u2026`);
  } catch (e) {
    say('could not establish:', String(e?.shortMessage ?? e));
  }
}

await step(4, 'A SECOND STEP, AND IT DOES NOT FOLLOW FROM THE FIRST: are the data usable?');
const CHAIN_HEAD = 25904646n;
const BLOCK_TS_MS = 1788533135 * 1000; // _meta.block.timestamp of that same answer; the chain head at read time, subgraph block was 25904639
const u1 = checkUsable(JSON.parse(body1), 'ONDO', CHAIN_HEAD);
say(`live read \u2192 ${u1.ok ? 'usable' : 'refused: ' + u1.reason}`, u1.ok ? `ONDO = ${u1.priceUSD}` : '');

// THE SAME answer carries three tokens priced "0" — not an invented case, what arrived.
const uZero = checkUsable(JSON.parse(body1), 'TSLAon', CHAIN_HEAD);
say(`same answer, TSLAon \u2192 REFUSED: ${uZero.reason}`);
say('zero is legitimate for a long-tail token and useless as a reference — refuse, not "free".');

const body2 = fx('sample2.body.json');
const att2 = readAttestation('sample2.attestation.json');
const v2 = att2.ok === false ? att2 : await verifyAttestation(body2, att2);
const u2 = checkUsable(JSON.parse(body2), 'WETH', CHAIN_HEAD);
say(`sample 2 \u2192 signature verified: ${v2.ok}, but the data: REFUSED — ${u2.reason}`);
say('a paid, correctly attested answer WITH AN ERROR AND NO DATA.');
say('"the signature verified" does not mean "a price was obtained".');

await step(5, 'A trap you see only if you measure TWO ages.');
const stale = JSON.parse(body1);
stale.data.tokens.find((t) => t.symbol === 'ONDO').lastPriceBlockNumber = '25000000';
say('subgraph head fresh, price written long ago \u2192', checkUsable(stale, 'ONDO', CHAIN_HEAD).reason);
say('prices are written in event handlers: a dead market = a dead price under green indexing.');

await step(6, 'And the decision that follows from it.');
{
  const r = buildSnapshot({
    subgraphId: UNISWAP_V3_ETHEREUM, symbol: 'ONDO',
    verification: v1, usability: u1,
    indexer: { ok: true, indexer: '0x4e5c87772C29381bCaBC58C3f182B6633B5a274a' },
    chainHead: CHAIN_HEAD,
    // Observation time and block time travel TOGETHER: the snapshot refuses to assemble if
    // the observation claims to predate the block it describes. That is how a snapshot
    // signed a year before the actual read was caught.
    blockTimestampMs: BLOCK_TS_MS,
    observedAtMs: BLOCK_TS_MS + 1000,
  });
  if (r.ok) {
    say(`snapshot assembled: ${r.bytes} bytes, signed VERBATIM`);
    say(`source age: block ${r.snapshot.reading.source_block}, price from ${r.snapshot.reading.price_block}`);
    say(`band \u00b15%: ${r.snapshot.band.low_usd.slice(0, 12)}\u2026 \u2026 ${r.snapshot.band.high_usd.slice(0, 12)}\u2026`);
    say('honest price  \u2192', judgeOrder(r.snapshot, r.snapshot.reading.price_usd).allowed ? 'ALLOWED' : 'REFUSED');
    say('price doubled \u2192', judgeOrder(r.snapshot, '0.71').allowed ? 'ALLOWED' : 'REFUSED');
    say('the snapshot names what we did NOT check: requestCID, and whether the indexer is right.');
  } else {
    say(`snapshot NOT assembled: ${r.refusal.reason} — and that is an artifact, not silence`);
  }
}

await step(7, 'The gate: an agent with no human behind it GETS NO SIGNATURE.');
{
  // The negative path can be shown TODAY, with no registration at all — that is its
  // strength. The answer is real, from both AgentBook registries, not invented.
  const g = await gateSignatureRequest({
    agentAddress: '0xF25047F2d2CD9d841b3ACf3CA1d38a2a697Ef368',
    observedAtMs: Date.now(),
  });
  say(`decision: ${g.receipt.decision}`);
  say(`reason: ${g.reason}`);
  if (g.receipt.checked_registries) say(`asked: ${g.receipt.checked_registries.join(' \u00b7 ')}`);
  say('');
  say('this is a CHANGE OF BEHAVIOUR, not a log line: there will be no signature.');
  say('"no human" is not "could not ask": the second has its own reason,');
  say('because the fix differs — onboard the agent, or repair a broken node.');
  say(`decided by: ${g.receipt.decided_by} — before the enclave, not inside it.`);
}

await step(8, 'The boundary, said out loud.');
say('everything above runs OUTSIDE the enclave: it has no network.');
say('the indexer attestation goes into the snapshot as an artifact anyone can re-check,');
say('but OUR signature is what vouches for the snapshot — and we answer for checking the chain.');
say('the gate sits BEFORE a signature is requested; this package does not request one yet,');
say('so the honest wording is "no signature is requested", not "we guard the signature".');
console.log();
await dwell();
