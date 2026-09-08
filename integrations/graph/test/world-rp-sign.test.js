// World's own published vectors, asserted.
//
// A signature scheme that has never reproduced a known value is a guess with good
// intentions: it produces 65 plausible bytes for any input, and the only party who can
// tell you they are wrong is the one refusing your requests in production.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHex } from 'viem';
import { hashToField, computeRpSignatureMessage, signRequest } from '../src/world-rp-sign.js';

const enc = (s) => new TextEncoder().encode(s);
const bytes = (hex) => Uint8Array.from(Buffer.from(hex.replace(/^0x/, ''), 'hex'));

// The doc's deterministic randomness: bytes 0x00..0x1f.
const DETERMINISTIC = Uint8Array.from({ length: 32 }, (_, i) => i);
const DOC_KEY = '0xabababababababababababababababababababababababababababababababab';
const DOC_NONCE = '0x008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd';

test('hash_to_field reproduces both published vectors', () => {
  assert.equal(toHex(hashToField(new Uint8Array([1, 2, 3]))),
    '0x00f1885eda54b7a053318cd41e2093220dab15d65381b1157a3633a83bfd5c92');
  assert.equal(toHex(hashToField(enc('hello'))),
    '0x001c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36dea');
});

test('🔴 the top byte is dropped — the result is a field element, not a hash', () => {
  // Every output must start 0x00. Without the shift the value can exceed the scalar field
  // and World rejects the request, while everything here still looks like it worked.
  for (const s of ['', 'a', 'agent-signature-gate', 'x'.repeat(200)]) {
    assert.equal(toHex(hashToField(enc(s))).slice(2, 4), '00', `верхний байт не сброшен: ${s}`);
  }
});

test('compute_rp_signature_message: 49 bytes without an action, 81 with', () => {
  const nonce = bytes(DOC_NONCE);
  const a = computeRpSignatureMessage({ nonce, createdAt: 1700000000, expiresAt: 1700000300 });
  assert.equal(a.length, 49);
  assert.equal(toHex(a).slice(2),
    '01008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd000000006553f100000000006553f22c');

  const b = computeRpSignatureMessage({ nonce, createdAt: 1700000000, expiresAt: 1700000300, action: 'test-action' });
  assert.equal(b.length, 81);
  assert.equal(toHex(b).slice(2),
    '01008ae1aa597fa146ebd3aa2ceddf360668dea5e526567e92b0321816a4e895bd000000006553f100000000006553f22c00aa0ce59768ae5b1c52f07a9387f14f09f277422c0d2f8a268c7bad0c60a46a');
});

test('a nonce of the wrong width is refused, not padded', () => {
  // Padding would produce a valid signature over a message World never asked for.
  assert.throws(() => computeRpSignatureMessage({ nonce: new Uint8Array(31), createdAt: 1, expiresAt: 2 }), /32 bytes/);
});

test('🔴 sign_request reproduces the published signature — session proof, 49 bytes', async () => {
  const r = await signRequest({ signingKeyHex: DOC_KEY, ttl: 300, now: () => 1700000000, random: () => DETERMINISTIC });
  assert.equal(r.ok, true);
  assert.equal(r.nonce, DOC_NONCE);
  assert.equal(r.messageBytes, 49);
  assert.equal(r.sig,
    '0x14f693175773aed912852a601e9c0fd30f2afe2738d31388316232ce6f64ae9e4edbfb19d81c4229ba9c9fca78ede4b28956b7ba4415f08d957cbc1b3bdaa4021b');
});

test('🔴 sign_request reproduces the published signature — uniqueness proof, 81 bytes', async () => {
  const r = await signRequest({ signingKeyHex: DOC_KEY, action: 'test-action', ttl: 300, now: () => 1700000000, random: () => DETERMINISTIC });
  assert.equal(r.messageBytes, 81);
  assert.equal(r.sig,
    '0x05594adb6c1495768a38d523d7d6ee6356b2c31231919198794ed022ade7d08f73753f83bd167067d99c9b969d28e9222315837c66af25867b041273a6d5056f1b');
});

test('the two vectors differ — the action really enters the digest', async () => {
  // Both are signed with the same key, nonce and clock. If the action were dropped on the
  // floor the signatures would be identical and both assertions above would still pass.
  const a = await signRequest({ signingKeyHex: DOC_KEY, ttl: 300, now: () => 1700000000, random: () => DETERMINISTIC });
  const b = await signRequest({ signingKeyHex: DOC_KEY, action: 'test-action', ttl: 300, now: () => 1700000000, random: () => DETERMINISTIC });
  assert.notEqual(a.sig, b.sig);
});

test('a malformed key refuses by name and never signs', async () => {
  for (const k of [undefined, '', '0x', 'zz', '0x' + 'a'.repeat(63), 42]) {
    const r = await signRequest({ signingKeyHex: k, action: 'x' });
    assert.equal(r.ok, false, `принят ключ: ${String(k)}`);
    assert.equal(r.reason, 'bad_signing_key');
    assert.equal(r.sig, undefined);
  }
});

test('the signature is 65 bytes and carries a recovery byte of 27 or 28', async () => {
  const r = await signRequest({ signingKeyHex: DOC_KEY, action: 'agent-signature-gate' });
  assert.equal(r.sig.length, 2 + 130);
  assert.ok(['1b', '1c'].includes(r.sig.slice(-2)), `v = ${r.sig.slice(-2)}`);
  assert.ok(r.expiresAt - r.createdAt === 300);
});
