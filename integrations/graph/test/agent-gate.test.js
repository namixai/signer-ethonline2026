import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateSignatureRequest, GATE_SCHEMA } from '../src/agent-gate.js';

const AGENT = '0xF25047F2d2CD9d841b3ACf3CA1d38a2a697Ef368';
const stub = (r) => async () => r;

test('🔴 a registered human lets the signature request through', async () => {
  const g = await gateSignatureRequest({
    agentAddress: AGENT, observedAtMs: 1,
    lookup: stub({ ok: true, registered: true, humanId: '0x2a', chain: 'base',
                   checked: [{ chain: 'base', ok: true, registered: true }] }),
  });
  assert.equal(g.allowed, true);
  assert.equal(g.reason, 'registered_human');
  assert.equal(g.receipt.decision, 'signature_may_be_requested');
  assert.equal(g.receipt.human_id, '0x2a');
});

test('🔴 no human means NO SIGNATURE — this is the behaviour change, not a log line', async () => {
  const g = await gateSignatureRequest({
    agentAddress: AGENT, observedAtMs: 1,
    lookup: stub({ ok: true, registered: false,
                   checked: [{ chain: 'base', ok: true, registered: false },
                             { chain: 'worldchain', ok: true, registered: false }] }),
  });
  assert.equal(g.allowed, false);
  assert.equal(g.reason, 'no_registered_human');
  assert.equal(g.receipt.decision, 'refused_before_signature');
  assert.deepEqual(g.receipt.checked_registries, ['base:absent', 'worldchain:absent']);
});

test('🔴 "could not establish" also refuses, but is NOT the same reason', async () => {
  const g = await gateSignatureRequest({
    agentAddress: AGENT, observedAtMs: 1,
    lookup: stub({ ok: false, reason: 'lookup_incomplete',
                   checked: [{ chain: 'base', ok: true, registered: false },
                             { chain: 'worldchain', ok: false, reason: 'lookup_failed' }] }),
  });
  assert.equal(g.allowed, false, 'на денежном пути оба отказа одинаково безопасны');
  assert.equal(g.reason, 'human_unverified');
  assert.notEqual(g.reason, 'no_registered_human',
    'иначе оператор пойдёт онбордить агента, который уже онбордён, вместо починки узла');
  assert.equal(g.receipt.detail, 'lookup_incomplete');
});

test('a throwing resolver is an unperformed check, never a verdict', async () => {
  const g = await gateSignatureRequest({
    agentAddress: AGENT, observedAtMs: 1,
    lookup: async () => { throw new Error('rpc down'); },
  });
  assert.equal(g.allowed, false);
  assert.equal(g.reason, 'human_unverified');
});

test('a resolver returning nothing usable does not fall through to allow', async () => {
  for (const bad of [undefined, null, 'yes', 42]) {
    const g = await gateSignatureRequest({ agentAddress: AGENT, observedAtMs: 1, lookup: stub(bad) });
    assert.equal(g.allowed, false, String(bad));
    assert.equal(g.reason, 'human_unverified');
  }
});

test('a malformed agent address is the caller’s mistake and says so', async () => {
  for (const bad of [undefined, '', 42, null]) {
    const g = await gateSignatureRequest({ agentAddress: bad, observedAtMs: 1, lookup: stub({ ok: true, registered: true }) });
    assert.equal(g.allowed, false);
    assert.equal(g.reason, 'bad_request');
  }
  const g = await gateSignatureRequest({ agentAddress: 'nope', observedAtMs: 1, lookup: stub({ ok: false, reason: 'bad_address' }) });
  assert.equal(g.reason, 'bad_request', 'не «не смогли проверить» — вход кривой');
});

test('requiring a SPECIFIC human refuses a different one', async () => {
  const g = await gateSignatureRequest({
    agentAddress: AGENT, requireHumanId: '0xaaa', observedAtMs: 1,
    lookup: stub({ ok: true, registered: true, humanId: '0xbbb', chain: 'base' }),
  });
  assert.equal(g.allowed, false);
  assert.equal(g.reason, 'different_human');
  assert.equal(g.receipt.expected, '0xaaa');
});

test('🔴 the receipt names WHERE the decision was made', async () => {
  const g = await gateSignatureRequest({ agentAddress: AGENT, observedAtMs: 1, lookup: stub({ ok: true, registered: false }) });
  assert.equal(g.receipt.schema, GATE_SCHEMA);
  // Not "enclave". The gate runs on our side, before the request, and the artifact says so
  // rather than leaving a reader to assume the stronger thing.
  assert.equal(g.receipt.decided_by, 'gateway_before_enclave');
});

test('every refusal path produces a receipt — a refusal is an artifact, not a silence', async () => {
  const cases = [
    stub({ ok: true, registered: false }),
    stub({ ok: false, reason: 'lookup_incomplete' }),
    async () => { throw new Error('x'); },
    stub(null),
  ];
  for (const lookup of cases) {
    const g = await gateSignatureRequest({ agentAddress: AGENT, observedAtMs: 7, lookup });
    assert.equal(g.allowed, false);
    assert.ok(g.receipt, 'отказ без квитанции неотличим от «мы просто не спросили»');
    assert.equal(g.receipt.observed_at_ms, '7');
    assert.equal(g.receipt.agent, AGENT);
  }
});

test('LIVE: our own demo agent is refused today, and for the right reason', async (t) => {
  if (process.env.GRAPH_SNAPSHOT_OFFLINE === '1') {
    return t.skip('GRAPH_SNAPSHOT_OFFLINE=1 — живое чтение реестров не выполнялось');
  }
  // The negative path needs no registration to demonstrate, which is the point: we can
  // show the gate working today, and the answer is a real one from both registries.
  const g = await gateSignatureRequest({ agentAddress: AGENT, observedAtMs: Date.now() });
  assert.equal(g.allowed, false);
  assert.equal(g.reason, 'no_registered_human', `получено: ${g.reason} / ${JSON.stringify(g.receipt.detail)}`);
});

test('🔴 a null observation time becomes null, not the string "null"', async () => {
  for (const t of [null, undefined, NaN, Infinity, 'x', {}]) {
    const g = await gateSignatureRequest({ agentAddress: AGENT, observedAtMs: t, lookup: stub({ ok: true, registered: false }) });
    assert.equal(g.receipt.observed_at_ms, null, String(t));
  }
  const ok = await gateSignatureRequest({ agentAddress: AGENT, observedAtMs: 7, lookup: stub({ ok: true, registered: false }) });
  assert.equal(ok.receipt.observed_at_ms, '7');
});

test('🔴 the ALLOWING branch validates the humanId — a receipt naming nobody is not an allow', async () => {
  for (const h of ['', null, undefined, 'abc', 42, '0x']) {
    const g = await gateSignatureRequest({
      agentAddress: AGENT, observedAtMs: 1,
      lookup: stub({ ok: true, registered: true, humanId: h, chain: 'base' }),
    });
    assert.equal(g.allowed, false, `humanId=${JSON.stringify(h)}`);
    assert.equal(g.reason, 'human_unverified');
  }
  const g = await gateSignatureRequest({
    agentAddress: AGENT, observedAtMs: 1,
    lookup: stub({ ok: true, registered: true, humanId: '0x2a', chain: 'base' }),
  });
  assert.equal(g.allowed, true);
});
