#!/usr/bin/env node
// Ask for a World ID proof and check the answer. The half we could never run before.
//
//   WORLD_ID_SIGNER_PRIVATE_KEY=0x… node scripts/world-proof.mjs
//
// It signs a request with our relying-party key, prints a QR for the World ID Sandbox
// App, waits for the person to approve it, and sends what comes back to World's verifier.
//
// 🔴 THREE OUTCOMES, and the third is the one that earns its keep:
//   verified        — World accepted the proof
//   not verified    — World rejected it, and said why
//   could not ask   — we never got an answer: no key, no network, timeout, cancelled
// A timeout is not a failed verification, and reporting it as one would tell a real person
// they failed a check that was never run. Same split as src/world.js and world-verify.js.
//
// 🔴 THE KEY IS NEVER READ FROM A FILE HERE, and never printed. It comes from the
// environment, like the x402 payer key, and the operator decides where it lives. World's
// own docs say to rotate it if it leaks, and the portal does not keep a copy: there is no
// second one.

import { readFile } from 'node:fs/promises';
import qrcode from 'qrcode-terminal';
import { signRequest } from '../src/world-rp-sign.js';
import { verifyWorldIdProofV4 } from '../src/world-verify.js';

// 🔴 IDKit ships its WASM next to itself and loads it with
// `fetch(new URL("idkit_wasm_bg.wasm", import.meta.url))`. In a browser that is an HTTP
// URL; under Node it is `file:`, and Node's fetch answers "not implemented... yet...".
// Measured on Node v26: the file is right there on disk and the fetch fails anyway.
//
// So this serves file: URLs from disk and leaves every other request alone. It is a shim
// around a browser assumption, not a workaround for something being wrong with IDKit —
// and it is installed BEFORE the dynamic import below, because the wasm loads on import.
const nodeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url ?? String(input);
  if (url.startsWith('file:')) return new Response(await readFile(new URL(url)));
  return nodeFetch(input, init);
};

const { IDKit, orbLegacy, proofOfHuman, deviceLegacy, IDKitErrorCodes } = await import('@worldcoin/idkit-core');

const APP_ID = process.env.WORLD_APP_ID ?? 'app_5f3eda09fb0da78389932c5c2d262282';
const RP_ID = process.env.WORLD_RP_ID ?? 'rp_1509b9b6909048a4';
const ACTION = process.env.WORLD_ACTION ?? 'agent-signature-gate';

// 🔴 `sandbox`, not `staging`. IDKit accepts production | staging | sandbox, and they are
// three different places: `staging` points at the simulator, `sandbox` at the World ID
// Sandbox App that a tester installs from the portal. Ask for `staging` while holding the
// Sandbox App and the request goes somewhere nobody is listening.
const ENVIRONMENT = process.env.WORLD_ENV ?? 'sandbox';

const PRESETS = { 'proof-of-human': proofOfHuman, 'orb-legacy': orbLegacy, 'device-legacy': deviceLegacy };
const presetName = process.env.WORLD_PRESET ?? 'proof-of-human';
const TIMEOUT_MS = Number(process.env.WORLD_TIMEOUT_MS ?? 180_000);

const out = (o) => { console.log(JSON.stringify(o, null, 2)); return o; };

const key = process.env.WORLD_ID_SIGNER_PRIVATE_KEY;
if (!key) {
  // Refusing beats building a request World will reject for a reason that looks like ours.
  out({ outcome: 'could_not_ask', reason: 'no_signing_key',
        detail: 'set WORLD_ID_SIGNER_PRIVATE_KEY; it is the RP signing key, not a wallet key' });
  process.exit(2);
}
const preset = PRESETS[presetName];
if (!preset) {
  out({ outcome: 'could_not_ask', reason: 'unknown_preset', detail: `known: ${Object.keys(PRESETS).join(', ')}` });
  process.exit(2);
}

const signed = await signRequest({ signingKeyHex: key, action: ACTION, ttl: 300 });
if (!signed.ok) {
  out({ outcome: 'could_not_ask', reason: signed.reason });
  process.exit(2);
}

let request;
try {
  request = await IDKit.request({
    app_id: APP_ID,
    action: ACTION,
    environment: ENVIRONMENT,
    allow_legacy_proofs: true,
    rp_context: {
      rp_id: RP_ID,
      nonce: signed.nonce,
      created_at: signed.createdAt,
      expires_at: signed.expiresAt,
      signature: signed.sig,
    },
  }).preset(preset({ signal: process.env.WORLD_SIGNAL ?? 'usenami-signer-demo' }));
} catch (err) {
  out({ outcome: 'could_not_ask', reason: 'request_not_created', detail: String(err?.message ?? err) });
  process.exit(2);
}

console.error(`\n  app      ${APP_ID}\n  rp       ${RP_ID}\n  action   ${ACTION}\n  env      ${ENVIRONMENT}\n  preset   ${presetName}\n`);
if (request.connectorURI) {
  qrcode.generate(request.connectorURI, { small: true });
  console.error(`\n  Scan with the World ID Sandbox App, or open on the phone:\n  ${request.connectorURI}\n`);
} else {
  console.error('  no connector URI — running inside World App, native transport\n');
}
console.error(`  waiting up to ${Math.round(TIMEOUT_MS / 1000)}s…\n`);

let completion;
try {
  completion = await request.pollUntilCompletion({ pollInterval: 2000, timeout: TIMEOUT_MS });
} catch (err) {
  out({ outcome: 'could_not_ask', reason: 'poll_failed', detail: String(err?.message ?? err) });
  process.exit(2);
}

if (!completion?.success) {
  // Cancelled and timed out are NOT rejections. Nobody said no; nobody said anything.
  const reason = completion?.error === IDKitErrorCodes.Timeout ? 'timeout'
    : completion?.error === IDKitErrorCodes.Cancelled ? 'cancelled'
    : `bridge_${completion?.error ?? 'unknown'}`;
  out({ outcome: 'could_not_ask', reason, requestId: request.requestId });
  process.exit(2);
}

const r = await verifyWorldIdProofV4({
  rpId: RP_ID,
  action: ACTION,
  nonce: signed.nonce,
  responses: completion.responses ?? completion.response ?? [],
  environment: ENVIRONMENT,
});

if (r.ok === false) {
  out({ outcome: 'could_not_ask', reason: r.reason, detail: r.detail });
  process.exit(2);
}
if (r.verified) {
  // The artifact worth keeping: this is the first time World has answered "yes" to us.
  out({ outcome: 'verified', rp_id: RP_ID, action: ACTION, environment: ENVIRONMENT,
        nullifier: r.nullifier, results: r.results, at: new Date().toISOString() });
  process.exit(0);
}
out({ outcome: 'not_verified', reason: r.reason, detail: r.detail, status: r.status });
process.exit(1);
