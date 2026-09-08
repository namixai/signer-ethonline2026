// Signing a World ID 4.0 proof REQUEST, so the positive path can be run at all.
//
// World ID 4.0 refuses a request that is not signed by the relying party. Until this
// existed we could verify a proof and never obtain one: everything in `world-verify.js`
// was the receiving half of a conversation nobody could start.
//
// 🔴 WHERE THIS RUNS, and it is the same boundary as everything else here: OUTSIDE the
// enclave. The RP signing key is ours, held by whoever runs this, and the enclave has no
// network to reach World with anyway. This signs a request for a proof; it does not sign
// anything a venue would execute, and it must never be described as if it did.
//
// 🔴 THE KEY IS A PARAMETER. It is never read from a file or a vault by this module —
// the same rule the x402 payer key follows. Leak it and someone else can impersonate our
// app to World, which is why World's own documentation says to rotate it if it escapes.
//
// The algorithm is World's, reproduced from their spec rather than borrowed from their
// SDK, so the whole path is ours and checkable. Their published test vectors are asserted
// in the suite: an implementation of a signature scheme that has never reproduced a known
// value is a guess with good intentions.

import { keccak256, toHex, concatBytes, hexToBytes } from 'viem';
import { sign, serializeSignature } from 'viem/accounts';

// The order of the secp256k1 group. Hardcoded because viem does not export it, and reaching
// into @noble past viem would mean depending on the internals of a transitive dependency —
// a bump of viem could move it without a word. This is a constant of the curve rather than
// a version of anything, but a constant nobody checks is a guess, so the suite pins it by
// behaviour instead of by restating it: n-1 has to sign and n has to be refused, asserted
// against the real signing library.
const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

/**
 * keccak256, then shift right by 8 bits.
 *
 * The shift is what makes the result a field element rather than a hash: the top byte is
 * dropped, so the value always fits the BN254 scalar field and always begins 0x00. Skip it
 * and everything still "works" locally while World rejects every request.
 *
 * ⚠️ Keccak-256, not SHA3-256. Their padding differs and the SDK names look alike.
 */
export function hashToField(bytes) {
  const h = BigInt(keccak256(bytes)) >> 8n;
  return hexToBytes(`0x${h.toString(16).padStart(64, '0')}`);
}

const u64be = (n) => {
  const out = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 7; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
};

/**
 * The bytes that get signed: version, nonce, two timestamps, and the action hash when the
 * request is for a uniqueness proof.
 *
 * 49 bytes without an action, 81 with. That length is not decoration — it goes into the
 * EIP-191 prefix as a decimal string, so a message built one byte short produces a
 * perfectly valid signature over the wrong digest.
 */
export function computeRpSignatureMessage({ nonce, createdAt, expiresAt, action = null }) {
  if (nonce.length !== 32) throw new Error(`nonce must be 32 bytes, got ${nonce.length}`);
  const head = concatBytes([new Uint8Array([0x01]), nonce, u64be(createdAt), u64be(expiresAt)]);
  return action == null ? head : concatBytes([head, hashToField(new TextEncoder().encode(action))]);
}

/**
 * Sign a proof request.
 *
 * `random` and `now` are injectable so World's published vectors can be reproduced
 * exactly. In production both come from the platform.
 *
 * @returns { sig, nonce, createdAt, expiresAt } — the shape IDKit expects in `rp_context`
 */
export async function signRequest({
  signingKeyHex,
  action = null,
  ttl = 300,
  now = () => Math.floor(Date.now() / 1000),
  random = () => crypto.getRandomValues(new Uint8Array(32)),
} = {}) {
  if (typeof signingKeyHex !== 'string' || !/^(0x)?[0-9a-fA-F]{64}$/.test(signingKeyHex)) {
    // A named refusal, because a malformed key must fail here and not halfway through a
    // request World will reject for reasons that look like ours.
    return { ok: false, reason: 'bad_signing_key' };
  }
  const key = signingKeyHex.startsWith('0x') ? signingKeyHex : `0x${signingKeyHex}`;

  // 🔴 THE SHAPE IS NOT THE RANGE. Sixty-four hex characters describe 2^256 values, and only
  // the ones from 1 to n-1 are private keys; zero and everything from the group order up are
  // not. Without this check such a key passes the regex above and reaches viem's `sign`,
  // which throws — and THE THROW CARRIES THE KEY. The curve library names the rejected
  // scalar in its message, so a mistyped key lands in stderr, and from there in a CI log or
  // a pasted bug report, in decimal. This module has one rule, that the key never appears
  // anywhere, and the error path was the one place breaking it.
  const scalar = BigInt(key);
  if (scalar === 0n || scalar >= SECP256K1_ORDER) {
    return { ok: false, reason: 'bad_signing_key' };
  }

  const nonce = hashToField(random());
  const createdAt = now();
  const expiresAt = createdAt + ttl;
  const msg = computeRpSignatureMessage({ nonce, createdAt, expiresAt, action });

  // viem's hashMessage over RAW bytes is exactly World's prefix: the decimal byte length,
  // not the character length of a hex string. Passing the hex string instead would prefix
  // "162" for an 81-byte message and sign a digest World never computes.
  const signature = await sign({ hash: hashMessageRaw(msg), privateKey: key, to: 'object' });

  return {
    ok: true,
    sig: serializeSignature(signature),
    nonce: toHex(nonce),
    createdAt,
    expiresAt,
    messageBytes: msg.length,
  };
}

function hashMessageRaw(bytes) {
  const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${bytes.length}`);
  return keccak256(concatBytes([prefix, bytes]));
}
