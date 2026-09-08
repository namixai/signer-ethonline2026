import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyWorldIdProof } from '../src/world-verify.js';

const OUR_APP = 'app_5f3eda09fb0da78389932c5c2d262282';
// Наше действие World ID 4.0, заведено через MCP портала 07.09 в ОБОИХ окружениях:
// production action_v4_89421e85…, staging action_v4_d3d3be49…
const OUR_ACTION = 'agent-signature-gate';
const args = (over = {}) => ({
  appId: OUR_APP,
  action: OUR_ACTION,
  proof: '0x' + '00'.repeat(256),
  merkleRoot: '0x' + '00'.repeat(32),
  nullifierHash: '0x' + '11'.repeat(32),
  ...over,
});
const stubFetch = (status, body) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

test('an accepted proof is verified', async () => {
  const r = await verifyWorldIdProof({ ...args(), fetchImpl: stubFetch(200, { success: true, nullifier_hash: '0xabc' }) });
  assert.deepEqual(r, { ok: true, verified: true, nullifierHash: '0xabc' });
});

test("🔴 a rejection keeps WORLD'S code, not one we invented", async () => {
  const r = await verifyWorldIdProof({ ...args(), fetchImpl: stubFetch(400, { code: 'invalid_proof', detail: 'Proof is invalid.' }) });
  assert.equal(r.ok, true);
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'invalid_proof', 'их код полезнее нашего пересказа');
  assert.equal(r.detail, 'Proof is invalid.');
});

test('🔴 an outage is NOT a failed verification', async () => {
  const r = await verifyWorldIdProof({ ...args(), fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'verify_unreachable');
  assert.equal(r.verified, undefined, 'сетевой сбой не выносит вердикт о человеке');
});

test('🔴 a non-JSON body means we did not reach the verifier — not that it said no', async () => {
  // A proxy, a captive portal, or a 404 HTML page. Reading that as "rejected" would
  // publish someone as unverified because our network was wrong.
  const r = await verifyWorldIdProof({ ...args(), fetchImpl: stubFetch(404, '<html>Not Found</html>') });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'verify_unreachable');
  assert.equal(r.verified, undefined);
});

test('a malformed app id or missing field refuses by name and never calls out', async () => {
  let called = 0;
  const counting = async () => { called++; return { ok: true, status: 200, text: async () => '{}' }; };
  for (const over of [{ appId: 'nope' }, { appId: '' }, { action: '' }, { proof: '' }, { merkleRoot: '' }, { nullifierHash: '' }]) {
    const r = await verifyWorldIdProof({ ...args(over), fetchImpl: counting });
    assert.equal(r.ok, false, JSON.stringify(over));
  }
  assert.equal(called, 0, 'кривой вход не должен уходить в сеть');
});

test('nothing is baked: app id, action, endpoint and version are all parameters', async () => {
  let seen = null;
  const spy = async (url, init) => { seen = { url, body: JSON.parse(init.body) }; return { ok: true, status: 200, text: async () => '{"success":true}' }; };
  await verifyWorldIdProof({ ...args({ appId: 'app_other', action: 'other-action' }), base: 'https://example.test', apiVersion: 'v9', fetchImpl: spy });
  assert.equal(seen.url, 'https://example.test/api/v9/verify/app_other');
  assert.equal(seen.body.action, 'other-action');
});

test('LIVE: World recognises OUR app and answers about OUR action', async (t) => {
  if (process.env.GRAPH_SNAPSHOT_OFFLINE === '1') {
    return t.skip('GRAPH_SNAPSHOT_OFFLINE=1 — живая проверка не выполнялась');
  }
  // Free, no secrets: an app id is a public identifier by construction, and the proof is
  // deliberately invalid. What this establishes is that our REQUEST reaches World's
  // verifier and is understood — the part we can settle without a phone.
  const r = await verifyWorldIdProof(args());
  if (r.ok === false && r.reason === 'verify_unreachable') {
    return t.skip(`World недоступен: ${r.detail}`);
  }
  assert.equal(r.ok, true, 'World ответил осмысленно');
  assert.equal(r.verified, false, 'заведомо неверное доказательство обязано быть отвергнуто');
  // 🔴 Measured 2026-09-07, AFTER the action was created: legacy v2 STILL answers
  // `invalid_action`. That is not a portal failure — World ID 4.0 actions hang off the
  // rp_id, so v2 (keyed by app id) cannot see ours. Asserting the exact code is the point:
  // if it ever changes, the legacy path changed underneath us and we want to be told.
  // ⚠️ What this does NOT establish: that OUR action exists. Falsified 2026-09-07 — swap
  // OUR_ACTION for a fabricated name and this stays green, because v2 answers
  // `invalid_action` for every action alike. The action's existence is evidenced by the
  // portal MCP response, not by this endpoint.
  assert.equal(r.reason, 'invalid_action',
    `v2 legacy ответил иначе, чем 07.09 — проверь, не появилось ли legacy-действие: ${JSON.stringify(r)}`);
});

// ---- the CURRENT endpoint (v4, keyed by rp_id). v2 is legacy per World's own reference ----

import { verifyWorldIdProofV4, WORLD_VERIFY_BASE } from '../src/world-verify.js';

const OUR_RP = 'rp_1509b9b6909048a4';
const v4args = (over = {}) => ({
  rpId: OUR_RP, action: OUR_ACTION, nonce: 'abcdef0123456789',
  responses: [{ identifier: 'test', proof: ['0x00'] }],
  ...over,
});

// 🔴 An outage served as a response, not thrown. Both verifiers must call it "could not
// ask", never "the proof was rejected" — the body of a 5xx is often JSON, and a caller
// that reads `verified: false` will tell a real person they failed verification.
// The pre-2026-09-07 code caught only a THROWN fetch, so this whole lane went unguarded.
for (const status of [500, 502, 503, 429]) {
  test(`🔴 HTTP ${status} is an outage, not a rejection — v2`, async () => {
    // A body shaped exactly like a genuine rejection, to make the trap as sharp as it is
    // in production: if status were ignored, this would parse cleanly and look decided.
    const r = await verifyWorldIdProof({ ...args(), fetchImpl: stubFetch(status, { code: 'invalid_proof' }) });
    assert.equal(r.ok, false, `HTTP ${status} вернулся как осмысленный ответ`);
    assert.equal(r.reason, 'verify_unreachable');
    assert.equal(r.verified, undefined, 'сбой не имеет права нести вердикт о доказательстве');
  });

  test(`🔴 HTTP ${status} is an outage, not a rejection — v4`, async () => {
    const r = await verifyWorldIdProofV4({ ...v4args(), fetchImpl: stubFetch(status, { code: 'verification_error' }) });
    assert.equal(r.ok, false, `HTTP ${status} вернулся как осмысленный ответ`);
    assert.equal(r.reason, 'verify_unreachable');
    assert.equal(r.verified, undefined, 'сбой не имеет права нести вердикт о доказательстве');
  });
}

test('a 4xx that is NOT 429 stays a rejection — the guard must not swallow real answers', async () => {
  // The failure mode of the fix itself: widening it to "any non-2xx is an outage" would
  // hide every genuine refusal World makes, and they all arrive as 400.
  const r = await verifyWorldIdProof({ ...args(), fetchImpl: stubFetch(400, { code: 'invalid_action' }) });
  assert.equal(r.ok, true);
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'invalid_action');
});

test('v4 defaults to the current domain, not the legacy one', () => {
  assert.equal(WORLD_VERIFY_BASE, 'https://developer.world.org');
});

test('🔴 v4: `responses` is forwarded VERBATIM — remapping is a documented way to break it', async () => {
  // World's own note: "Forward the complete IDKit result without remapping response
  // identifiers or constructing a legacy verification_level."
  let seen = null;
  const spy = async (url, init) => { seen = { url, body: JSON.parse(init.body) }; return { ok: true, status: 200, text: async () => '{"success":true}' }; };
  const responses = [{ identifier: 'x', proof: ['0xaa'], extra_field_we_do_not_understand: 42 }];
  await verifyWorldIdProofV4({ ...v4args({ responses }), fetchImpl: spy });
  assert.deepEqual(seen.body.responses, responses, 'ни одно поле не переписано и не выброшено');
  assert.equal(seen.url, `${WORLD_VERIFY_BASE}/api/v4/verify/${OUR_RP}`);
  assert.equal(seen.body.protocol_version, '4.0');
});

test('v4 accepted proof', async () => {
  const r = await verifyWorldIdProofV4({ ...v4args(), fetchImpl: stubFetch(200, { success: true, nullifier: '0xn', results: [] }) });
  assert.equal(r.verified, true);
  assert.equal(r.nullifier, '0xn');
});

test('🔴 v4: the PER-RESULT code is preferred over the envelope — it is the specific one', async () => {
  const r = await verifyWorldIdProofV4({
    ...v4args(),
    fetchImpl: stubFetch(400, { code: 'generic', results: [{ identifier: 'x', success: false, code: 'invalid_proof', detail: 'no' }] }),
  });
  assert.equal(r.verified, false);
  assert.equal(r.reason, 'invalid_proof', 'иначе теряется единственное, что говорит, что чинить');
});

test('v4: an outage is not a rejection, and a non-JSON body is not either', async () => {
  const a = await verifyWorldIdProofV4({ ...v4args(), fetchImpl: async () => { throw new Error('down'); } });
  assert.equal(a.reason, 'verify_unreachable');
  assert.equal(a.verified, undefined);
  const b = await verifyWorldIdProofV4({ ...v4args(), fetchImpl: stubFetch(502, '<html/>') });
  assert.equal(b.reason, 'verify_unreachable');
});

test('v4 refuses malformed input without going to the network', async () => {
  let called = 0;
  const counting = async () => { called++; return { ok: true, status: 200, text: async () => '{}' }; };
  for (const over of [{ rpId: 'app_x' }, { rpId: '' }, { action: '' }, { nonce: '' }, { responses: [] }, { responses: 'x' }]) {
    assert.equal((await verifyWorldIdProofV4({ ...v4args(over), fetchImpl: counting })).ok, false, JSON.stringify(over));
  }
  assert.equal(called, 0);
});

// A body World's validator accepts, so the request reaches the rp/config lookup behind it.
// Every field here is required — measured, not guessed: identifier, a NUMERIC
// issuer_schema_id, nullifier, expires_at_min, and proof with EXACTLY five elements.
const wellFormed = () => [{
  identifier: '0x' + '22'.repeat(32),
  issuer_schema_id: 1,
  nullifier: '0x' + '11'.repeat(32),
  expires_at_min: Math.floor(Date.now() / 60_000) + 60,
  proof: ['0x1', '0x2', '0x3', '0x4', '0x5'],
}];
const ABSENT_RP = 'rp_0000000000000000';

test('LIVE: our rp is REGISTERED on World ID 4.0 — and the made-up rp proves the check bites', async (t) => {
  if (process.env.GRAPH_SNAPSHOT_OFFLINE === '1') return t.skip('GRAPH_SNAPSHOT_OFFLINE=1');
  const ours = await verifyWorldIdProofV4(v4args({ responses: wellFormed() }));
  const absent = await verifyWorldIdProofV4(v4args({ rpId: ABSENT_RP, responses: wellFormed() }));
  for (const r of [ours, absent]) {
    if (r.ok === false && r.reason === 'verify_unreachable') return t.skip(`World недоступен: ${r.detail}`);
  }

  assert.equal(ours.verified, false, 'заведомо фальшивое доказательство обязано быть отвергнуто');
  // Reached the proof check itself: envelope, rp and RP config were all accepted.
  assert.equal(ours.reason, 'verification_error', `наш rp не дошёл до проверки: ${JSON.stringify(ours)}`);
  // 🔴 The control. Without it the line above is satisfied by almost anything.
  assert.equal(absent.reason, 'app_not_migrated', `контроль сломался: ${JSON.stringify(absent)}`);
  assert.notEqual(ours.reason, absent.reason, 'если исходы совпали — тест снова ничего не утверждает');
});

test('🔴 LIVE: a MALFORMED body hides the rp completely — this is why the check above is well-formed', async (t) => {
  if (process.env.GRAPH_SNAPSHOT_OFFLINE === '1') return t.skip('GRAPH_SNAPSHOT_OFFLINE=1');
  // The shape this file's own live test used until 2026-09-07. It was green against a
  // fabricated rp id, because validation answers before anything looks the rp up.
  const bad = { responses: [{ identifier: 'test', proof: '0x00' }] };
  const ours = await verifyWorldIdProofV4(v4args(bad));
  const absent = await verifyWorldIdProofV4(v4args({ ...bad, rpId: ABSENT_RP }));
  for (const r of [ours, absent]) {
    if (r.ok === false && r.reason === 'verify_unreachable') return t.skip(`World недоступен: ${r.detail}`);
  }
  assert.equal(ours.reason, 'validation_error');
  assert.equal(ours.reason, absent.reason,
    'ловушка исчезла: форма тела больше не маскирует rp — можно упростить живую проверку');
});

// Транспортный статус — не приговор.
//
// Замер до правки: 401, 403, 451, 301 и 404 возвращались как not_verified с reason
// `http_401` и подобными. Отозванный ключ, геоблок или переехавший адрес докладывались
// как человек, не прошедший проверку. Гвардия выше называла 5xx и 429 поимённо и
// оставляла всё остальное.
//
// Проверяем не список статусов, а правило, ради которого список существовал: на не-2xx
// World либо назвал свой код (значит смотрел и отказал), либо не назвал — и тогда
// приговора нет.
test('a transport status with no code from World is not a verdict', async () => {
  const stub = (status, body) => async () =>
    new Response(body, { status, headers: { 'content-type': 'application/json' } });
  for (const [status, body] of [
    [401, '{"error":"unauthorized"}'],
    [403, '{"error":"forbidden"}'],
    [451, '{}'],
    [404, '{}'],
    [400, '{"error":"bad request"}'],
  ]) {
    const r = await verifyWorldIdProofV4({
      rpId: 'rp_test', action: 'a', nonce: '0x00', responses: [{}], fetchImpl: stub(status, body),
    });
    assert.equal(r.ok, false, `статус ${status} прошёл как приговор`);
    assert.equal(r.reason, 'verify_no_verdict', `статус ${status}`);
    assert.notEqual(r.verified, false, `статус ${status} доложен как «не прошёл проверку»`);
  }
});

// 🔴 Обратная половина того же правила, и без неё первая проверка проходила бы при
// заглушенном «всё не-2xx это не приговор» — а это уже потеря настоящих отказов World.
test('a non-2xx that carries a World code IS a verdict and stays one', async () => {
  const stub = (status, body) => async () =>
    new Response(body, { status, headers: { 'content-type': 'application/json' } });
  const cases = [
    [400, '{"code":"invalid_proof"}', 'invalid_proof'],
    [400, '{"results":[{"code":"max_verifications_reached"}]}', 'max_verifications_reached'],
  ];
  for (const [status, body, expected] of cases) {
    const r = await verifyWorldIdProofV4({
      rpId: 'rp_test', action: 'a', nonce: '0x00', responses: [{}], fetchImpl: stub(status, body),
    });
    assert.equal(r.ok, true, `${expected}: настоящий отказ World потерян как транспортный`);
    assert.equal(r.verified, false);
    assert.equal(r.reason, expected);
  }
});
