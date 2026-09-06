// World AgentKit resolver. Offline except one free public read at the end.
//
// The assertions that matter most are the negative ones: an outcome that means "we could
// not check" must never be indistinguishable from "the answer is no".

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  lookupHuman,
  verifyAgentSignature,
  checkMessage,
  AGENT_BOOK_ADDRESS,
  WORLD_CHAIN,
} from '../src/world.js';

const AGENT = '0x1111111111111111111111111111111111111111';
const CODE = '0x60806040';

const stub = ({ code = CODE, human, throwsOn } = {}) => ({
  async getCode() {
    if (throwsOn === 'getCode') throw new Error('rpc down');
    return code;
  },
  async readContract() {
    if (throwsOn === 'readContract') throw new Error('rpc down');
    return human;
  },
});

// ---- lookupHuman: three outcomes that must stay three ----

test('a registered agent resolves to a human id', async () => {
  const r = await lookupHuman(AGENT, { client: stub({ human: 42n }) });
  assert.equal(r.ok, true);
  assert.equal(r.registered, true);
  assert.equal(r.humanId, '0x2a');
});

test('humanId 0 from a LIVE contract is a real "no", not an absence', async () => {
  const r = await lookupHuman(AGENT, { client: stub({ human: 0n }) });
  assert.equal(r.ok, true);
  assert.equal(r.registered, false);
});

test('🔴 an RPC failure is NOT "no human" — the defect the official client has', async () => {
  const r = await lookupHuman(AGENT, { client: stub({ throwsOn: 'readContract' }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'lookup_failed');
  // The whole point: a caller must not be able to read this as a decided "no".
  assert.equal(r.registered, undefined);
});

test('a migrated contract address is named, not read as "not registered"', async () => {
  const r = await lookupHuman(AGENT, { client: stub({ code: '0x' }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_contract_at_address');
  assert.equal(r.registered, undefined);
});

test('a getCode outage is could-not-check, not a migration claim', async () => {
  const r = await lookupHuman(AGENT, { client: stub({ throwsOn: 'getCode' }) });
  assert.equal(r.reason, 'lookup_failed');
});

test('a malformed agent address refuses by name instead of throwing', async () => {
  for (const bogus of ['', 'not-an-address', null, undefined, 42, '0x1234']) {
    const r = await lookupHuman(bogus, { client: stub({ human: 0n }) });
    assert.equal(r.ok, false, `lookupHuman(${JSON.stringify(bogus)})`);
    assert.equal(r.reason, 'bad_address');
  }
});

test('a non-bigint return refuses rather than being coerced', async () => {
  const r = await lookupHuman(AGENT, { client: stub({ human: undefined }) });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'lookup_failed');
});

// ---- signature: a failed check and an unperformed one are different answers ----

test('a good signature verifies', async () => {
  const client = { async verifyMessage() { return true; } };
  const r = await verifyAgentSignature({ message: 'hi', address: AGENT, signature: '0xabcd', client });
  assert.deepEqual(r, { ok: true, valid: true });
});

test('a bad signature is a decided false', async () => {
  const client = { async verifyMessage() { return false; } };
  const r = await verifyAgentSignature({ message: 'hi', address: AGENT, signature: '0xabcd', client });
  assert.deepEqual(r, { ok: true, valid: false });
});

test('🔴 an ERC-1271 chain fault must not be reported as an invalid signature', async () => {
  const client = { async verifyMessage() { throw new Error('rpc down'); } };
  const r = await verifyAgentSignature({ message: 'hi', address: AGENT, signature: '0xabcd', client });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'verification_failed');
  assert.equal(r.valid, undefined, 'a network fault is not a verdict on the human');
});

test('malformed signature input refuses by name', async () => {
  const client = { async verifyMessage() { return true; } };
  assert.equal((await verifyAgentSignature({ message: '', address: AGENT, signature: '0xab', client })).reason, 'bad_request');
  assert.equal((await verifyAgentSignature({ message: 'hi', address: 'nope', signature: '0xab', client })).reason, 'bad_address');
  assert.equal((await verifyAgentSignature({ message: 'hi', address: AGENT, signature: 'zz', client })).reason, 'bad_signature');
  assert.equal((await verifyAgentSignature()).reason, 'bad_request');
});

// ---- message checks ----

const URI = 'https://signer.usenami.io/agent';
const fresh = (over = {}) => ({
  domain: 'signer.usenami.io',
  uri: URI,
  issuedAt: new Date().toISOString(),
  nonce: 'nonceAAAA01',
  ...over,
});
const seen = new Set();
const nonceOnce = async (n) => (seen.has(n) ? false : (seen.add(n), true));

test('🔴 no nonce checker is an incomplete configuration, not a pass', async () => {
  const r = await checkMessage(fresh(), URI, {});
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'nonce_check_required');
});

test('a well-formed fresh message passes', async () => {
  const r = await checkMessage(fresh({ nonce: 'nonceAAAA02' }), URI, { checkNonce: nonceOnce });
  assert.equal(r.ok, true);
});

test('the same nonce a second time is refused as a replay', async () => {
  const p = fresh({ nonce: 'nonceAAAA03' });
  assert.equal((await checkMessage(p, URI, { checkNonce: nonceOnce })).ok, true);
  const r = await checkMessage(p, URI, { checkNonce: nonceOnce });
  assert.equal(r.reason, 'nonce_replayed');
});

test('a nonce store outage is could-not-check, not a replay accusation', async () => {
  const r = await checkMessage(fresh({ nonce: 'nonceAAAA04' }), URI, {
    checkNonce: async () => { throw new Error('store down'); },
  });
  assert.equal(r.reason, 'nonce_check_failed');
});

test('domain and uri are bound to the resource we expect', async () => {
  assert.equal((await checkMessage(fresh({ domain: 'evil.example', nonce: 'nonceAAAA05' }), URI, { checkNonce: nonceOnce })).reason, 'domain_mismatch');
  assert.equal((await checkMessage(fresh({ uri: 'https://evil.example/x', nonce: 'nonceAAAA06' }), URI, { checkNonce: nonceOnce })).reason, 'uri_mismatch');
  assert.equal((await checkMessage(fresh({ uri: 'not a url', nonce: 'nonceAAAA07' }), URI, { checkNonce: nonceOnce })).reason, 'bad_uri');
});

test('stale, future-dated, expired and not-yet-valid messages each refuse distinctly', async () => {
  const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  assert.equal((await checkMessage(fresh({ issuedAt: old, nonce: 'nonceAAAA08' }), URI, { checkNonce: nonceOnce })).reason, 'message_too_old');

  const wayAhead = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  assert.equal((await checkMessage(fresh({ issuedAt: wayAhead, nonce: 'nonceAAAA09' }), URI, { checkNonce: nonceOnce })).reason, 'issued_in_future');

  const expired = fresh({ expirationTime: new Date(Date.now() - 1000).toISOString(), nonce: 'nonceAAAA10' });
  assert.equal((await checkMessage(expired, URI, { checkNonce: nonceOnce })).reason, 'message_expired');

  const early = fresh({ notBefore: new Date(Date.now() + 60 * 1000).toISOString(), nonce: 'nonceAAAA11' });
  assert.equal((await checkMessage(early, URI, { checkNonce: nonceOnce })).reason, 'not_yet_valid');

  assert.equal((await checkMessage(fresh({ issuedAt: 'yesterday', nonce: 'nonceAAAA12' }), URI, { checkNonce: nonceOnce })).reason, 'bad_issued_at');
});

// ---- one free public read: proves the address and ABI against the world ----

test('LIVE (free): the baked AgentBook answers, and an unregistered address says so', async (t) => {
  if (process.env.GRAPH_SNAPSHOT_OFFLINE === '1') {
    return t.skip('GRAPH_SNAPSHOT_OFFLINE=1 — живое чтение реестра не выполнялось');
  }
  const unregistered = '0x0000000000000000000000000000000000001234';
  const r = await lookupHuman(unregistered);
  if (!r.ok && r.reason === 'lookup_failed') {
    t.skip(`World Chain RPC unreachable: ${r.detail}`);
    return;
  }
  // If we DID reach the chain, the address and ABI must both be right.
  assert.equal(r.ok, true, `unexpected refusal: ${r.reason} ${JSON.stringify(r.detail)}`);
  assert.equal(r.registered, false);
  assert.equal(WORLD_CHAIN.id, 480);
  assert.equal(AGENT_BOOK_ADDRESS, '0xA23aB2712eA7BBa896930544C7d6636a96b944dA');
});

// ---- five findings from review, all real. Four of them are my own rule broken in my
// own code: a malformed INPUT was being reported as "we could not check".

import { DEFAULT_CLOCK_TOLERANCE_MS } from '../src/world.js';

test('🔴 a malformed CONTRACT address is a misconfiguration, not "could not find out"', async () => {
  const r = await lookupHuman(AGENT, { client: stub({ human: 0n }), address: 'not-an-address' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad_contract_address');
  // The distinction that matters: not the agent's address, and not an outage.
  assert.notEqual(r.reason, 'bad_address');
  assert.notEqual(r.reason, 'lookup_failed');
});

test('🔴 an odd-length hex signature is a bad input, not a failed verification', async () => {
  const client = { async verifyMessage() { throw new Error('should never be reached'); } };
  const r = await verifyAgentSignature({ message: 'hi', address: AGENT, signature: '0x123', client });
  assert.equal(r.reason, 'bad_signature');
  assert.notEqual(r.reason, 'verification_failed', 'viem must never see it');
});

test('an even-length signature of non-standard size still reaches verification (ERC-1271)', async () => {
  // Smart-wallet signatures are arbitrary length, so the check must not pin 65 bytes.
  const client = { async verifyMessage() { return true; } };
  const r = await verifyAgentSignature({ message: 'hi', address: AGENT, signature: `0x${'ab'.repeat(200)}`, client });
  assert.deepEqual(r, { ok: true, valid: true });
});

test('🔴 domain is an RFC 3986 authority: the port is part of it', async () => {
  const withPort = 'https://localhost:3000/agent';
  // Authority including the port — what EIP-4361 asks for, and what the official kit
  // would reject, because it compares against `hostname`.
  const ok = await checkMessage(
    { domain: 'localhost:3000', uri: withPort, issuedAt: new Date().toISOString(), nonce: 'nonceAAAA13' },
    withPort,
    { checkNonce: nonceOnce },
  );
  assert.equal(ok.ok, true, 'a correctly formed message on a non-default port must pass');

  // Bare hostname where an authority was required: still refused, binding intact.
  const bare = await checkMessage(
    { domain: 'localhost', uri: withPort, issuedAt: new Date().toISOString(), nonce: 'nonceAAAA14' },
    withPort,
    { checkNonce: nonceOnce },
  );
  assert.equal(bare.reason, 'domain_mismatch');
});

test('clock skew inside tolerance is accepted, outside it is refused', async () => {
  const ahead = (ms) => new Date(Date.now() + ms).toISOString();
  const inside = await checkMessage(fresh({ issuedAt: ahead(DEFAULT_CLOCK_TOLERANCE_MS / 2), nonce: 'nonceAAAA15' }), URI, { checkNonce: nonceOnce });
  assert.equal(inside.ok, true, 'half a tolerance ahead is a drifting phone, not an attack');

  const outside = await checkMessage(fresh({ issuedAt: ahead(DEFAULT_CLOCK_TOLERANCE_MS * 3), nonce: 'nonceAAAA16' }), URI, { checkNonce: nonceOnce });
  assert.equal(outside.reason, 'issued_in_future');

  // The tolerance is a knob, and setting it to zero restores the strict behaviour.
  const strict = await checkMessage(fresh({ issuedAt: ahead(1000), nonce: 'nonceAAAA17' }), URI, { checkNonce: nonceOnce, clockToleranceMs: 0 });
  assert.equal(strict.reason, 'issued_in_future');
});

// ---- second review round (CodeRabbit). All four real; three are the same lesson again:
// a check that guards one shape of bad input while another walks past it.

test('🔴 a missing nonce never reaches the store — it carries no replay binding at all', async () => {
  // A plain Set-backed store answers "not seen" for undefined and approves the message
  // ONCE, with nothing binding it. Our own test helper below would have done that.
  const naive = new Set();
  const wouldApprove = async (n) => (naive.has(n) ? false : (naive.add(n), true));
  for (const bad of [undefined, null, '', 'short', 'has space', 'dash-es', 123, {}]) {
    const r = await checkMessage(fresh({ nonce: bad }), URI, { checkNonce: wouldApprove });
    assert.equal(r.ok, false, `nonce=${JSON.stringify(bad)}`);
    assert.equal(r.reason, 'bad_nonce');
  }
  assert.equal(naive.size, 0, 'the store must not even have been consulted');
});

test('🔴 the WHOLE uri is bound, not just its host', async () => {
  const expected = 'https://signer.usenami.io/agent';
  // Same host, different path: previously accepted.
  const otherPath = await checkMessage(
    { domain: 'signer.usenami.io', uri: 'https://signer.usenami.io/other', issuedAt: new Date().toISOString(), nonce: 'nonceBBBB01' },
    expected, { checkNonce: nonceOnce },
  );
  assert.equal(otherPath.reason, 'uri_mismatch');

  // Same host and path, downgraded scheme: previously accepted.
  const httpScheme = await checkMessage(
    { domain: 'signer.usenami.io', uri: 'http://signer.usenami.io/agent', issuedAt: new Date().toISOString(), nonce: 'nonceBBBB02' },
    expected, { checkNonce: nonceOnce },
  );
  assert.equal(httpScheme.reason, 'uri_mismatch');

  const exact = await checkMessage(
    { domain: 'signer.usenami.io', uri: expected, issuedAt: new Date().toISOString(), nonce: 'nonceBBBB03' },
    expected, { checkNonce: nonceOnce },
  );
  assert.equal(exact.ok, true);
});

// ---- AgentBook is deployed twice and the kit's halves disagree about which one ----

import { lookupHumanAnywhere, AGENT_BOOK_DEPLOYMENTS } from '../src/world.js';

const okStub = (human) => ({ async getCode() { return CODE; }, async readContract() { return human; } });
const deadStub = () => ({ async getCode() { throw new Error('rpc down'); } });

test('both deployments are known, on their own chains', () => {
  assert.equal(AGENT_BOOK_DEPLOYMENTS.length, 2);
  const byChain = Object.fromEntries(AGENT_BOOK_DEPLOYMENTS.map((d) => [d.chain, d]));
  assert.equal(byChain.base.chainId, 8453);
  assert.equal(byChain.base.address, '0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4');
  assert.equal(byChain.worldchain.chainId, 480);
  assert.equal(byChain.worldchain.address, '0xA23aB2712eA7BBa896930544C7d6636a96b944dA');
});

test('🔴 a registration on Base is found even though the kit library reads World Chain', async () => {
  const r = await lookupHumanAnywhere(AGENT, { clients: { base: okStub(7n), worldchain: okStub(0n) } });
  assert.equal(r.ok, true);
  assert.equal(r.registered, true);
  assert.equal(r.chain, 'base', 'and it says WHICH registry answered');
  assert.equal(r.humanId, '0x7');
});

test('a registration on World Chain is found too', async () => {
  const r = await lookupHumanAnywhere(AGENT, { clients: { base: okStub(0n), worldchain: okStub(9n) } });
  assert.equal(r.registered, true);
  assert.equal(r.chain, 'worldchain');
});

test('every registry answering "nobody" is a decided no', async () => {
  const r = await lookupHumanAnywhere(AGENT, { clients: { base: okStub(0n), worldchain: okStub(0n) } });
  assert.equal(r.ok, true);
  assert.equal(r.registered, false);
  assert.equal(r.checked.length, 2);
});

test('🔴 "absent here, could not ask there" is NOT "no human"', async () => {
  const r = await lookupHumanAnywhere(AGENT, { clients: { base: okStub(0n), worldchain: deadStub() } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'lookup_incomplete');
  assert.equal(r.registered, undefined, 'a partial sweep must never read as a decided no');
});

test('a found registration wins even if the other registry is unreachable', async () => {
  const r = await lookupHumanAnywhere(AGENT, { clients: { base: okStub(5n), worldchain: deadStub() } });
  assert.equal(r.registered, true, 'we already have the answer; the outage cannot unmake it');
  assert.equal(r.chain, 'base');
});

test('a malformed agent address is answered once, not repeated per registry', async () => {
  let calls = 0;
  const counting = { async getCode() { calls++; return CODE; }, async readContract() { return 0n; } };
  const r = await lookupHumanAnywhere('nope', { clients: { base: counting, worldchain: counting } });
  assert.equal(r.reason, 'bad_address');
  assert.equal(calls, 0);
});

// ---- review round 3 ----

test('🔴 an empty deployment list is a configuration error, not a verdict', async () => {
  // 0 === 0 used to satisfy "every registry answered" and return a decided "no human"
  // WITHOUT QUERYING ANYONE — this file's own thesis, broken inside it.
  const r = await lookupHumanAnywhere(AGENT, { deployments: [] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_deployments_configured');
  assert.equal(r.registered, undefined);
  for (const bogus of [null, 'base', {}, 0]) {
    assert.equal(
      (await lookupHumanAnywhere(AGENT, { deployments: bogus })).reason,
      'no_deployments_configured',
      `deployments=${JSON.stringify(bogus)}`,
    );
  }
});

test('`deployments: undefined` means "use the defaults", not "misconfigured"', async () => {
  // A destructuring default fires only for undefined, so this is the documented way to
  // ask for the standard set — distinct from an empty or malformed list. The first
  // version of the test above lumped them together and went to the real network to
  // prove it, which is how the distinction surfaced.
  const r = await lookupHumanAnywhere(AGENT, {
    deployments: undefined,
    clients: { base: okStub(0n), worldchain: okStub(0n) },
  });
  assert.equal(r.ok, true);
  assert.equal(r.registered, false);
  assert.equal(r.checked.length, AGENT_BOOK_DEPLOYMENTS.length);
});

test('every deployment carries a chain object matching its own chain id', () => {
  // A client built with the wrong chain object reads fine but mislabels WHICH network
  // answered — and naming the registry is this function's entire output.
  for (const d of AGENT_BOOK_DEPLOYMENTS) {
    assert.ok(d.viemChain, `${d.chain} has no viemChain`);
    assert.equal(d.viemChain.id, d.chainId, `${d.chain}: chain object disagrees with chainId`);
  }
});

test('🔴 registries are queried in parallel, not one after the other', async () => {
  const slow = (ms, human) => ({
    async getCode() { await new Promise((r) => setTimeout(r, ms)); return CODE; },
    async readContract() { return human; },
  });
  const started = Date.now();
  const r = await lookupHumanAnywhere(AGENT, {
    clients: { base: slow(150, 0n), worldchain: slow(150, 4n) },
  });
  const elapsed = Date.now() - started;
  assert.equal(r.registered, true);
  assert.equal(r.chain, 'worldchain');
  // Sequential would be ~300ms. Generous bound so a loaded machine does not flake.
  assert.ok(elapsed < 260, `took ${elapsed}ms — looks sequential`);
});

test('the reported chain stays deterministic when BOTH registries answer yes', async () => {
  // Deliberately NOT a race-to-first-success: the winner is deployment order, so the
  // answer to "which registry vouches for this agent" cannot change run to run.
  for (let i = 0; i < 5; i++) {
    const r = await lookupHumanAnywhere(AGENT, { clients: { base: okStub(1n), worldchain: okStub(2n) } });
    assert.equal(r.chain, 'base');
    assert.equal(r.humanId, '0x1');
  }
});

test('🔴 a malformed deployment entry refuses by name — it never throws, and never votes', async () => {
  // [null] used to THROW; [{}] was worse — with no address the destructuring default
  // fired and it quietly queried the STANDARD registry, returning a confident
  // "no human" from a deployment nobody asked for.
  const cases = [
    [[null], 'entry is not an object'],
    [[{}], 'missing chain name'],
    [[{ chain: 'x' }], 'bad address'],
    [[{ chain: 'x', address: AGENT }], 'missing rpcUrl'],
    [[{ chain: 'x', address: AGENT, rpcUrl: 'http://x' }], 'missing chain object'],
    [[{ chain: 'x', address: AGENT, rpcUrl: 'http://x', viemChain: { id: 1 }, chainId: 2 }], 'chainId disagrees'],
  ];
  for (const [deployments, why] of cases) {
    const r = await lookupHumanAnywhere(AGENT, { deployments });
    assert.equal(r.ok, false, JSON.stringify(deployments));
    assert.equal(r.reason, 'bad_deployment_config', JSON.stringify(deployments));
    assert.equal(r.registered, undefined, 'a misconfiguration must not produce a verdict');
    assert.match(r.detail.why, new RegExp(why));
  }
});
