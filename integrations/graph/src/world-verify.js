// Verifying a World ID proof with OUR OWN app, not AgentKit's.
//
// 🔴 TWO THINGS THAT MUST NOT BE CONFUSED IN THE SUBMISSION, and they are easy to blur:
//
//   1. "our World ID flow is checked by the Sandbox App"  — this file. Our app id, our
//      action, our verification. Reachable today.
//   2. "we are registered in AgentBook"                   — NOT this file, and not true.
//      AgentBook's external nullifier is pinned to Worldcoin's own app, and its group is
//      Orb-only, confirmed by them at the 2026-09-04 workshop. We cannot register.
//
// Anything that reads as (2) on the strength of (1) is a false claim. The proof this file
// verifies says "a World ID holder completed OUR action" — it says nothing about AgentBook.
//
// 🔴 NOTHING IS BAKED. app id, action and endpoint are parameters. The relying-party key,
// when the portal flow needs one, is supplied by the caller and never read from a file by
// this module — the same rule the x402 payer key follows.

// 🔴 WHAT IS AND IS NOT PROVEN HERE, so it cannot be read as more than it is.
//
//   PROVEN, live and free (2026-09-07, re-measured once the RP was actually registered):
//   our relying party is registered on World ID 4.0, and the verifier gets as far as
//   checking the proof itself.
//     · v4, WELL-FORMED body, rp_1509b9b6… → `verification_error` / "All proof
//       verifications failed." — envelope, rp and config all accepted; what failed is the
//       deliberately fake proof.
//     · v4, WELL-FORMED body, a made-up rp → `app_not_migrated` / "This app has not been
//       migrated to World ID 4.0." — a DIFFERENT code. That contrast IS the evidence.
//       Without it, "our rp is live" would rest on nothing.
//
//   NOT PROVEN: the accepting path. We have never seen World answer "verified", and it
//   cannot be exercised until a real proof arrives from the Sandbox App. Every
//   positive-path test below is a MOCK, and calling it "verified against World" would be
//   a false claim.
//
// 🔴 TRAP 1 — VALIDATION RUNS FIRST AND HIDES EVERYTHING BEHIND IT. A malformed body gets
// `validation_error` for ANY rp id, including one that does not exist: measured, our rp and
// `rp_0000000000000000` are indistinguishable that way. So a live test that sends a
// malformed body proves NOTHING about our identifiers — and this file's own live test did
// exactly that until 2026-09-07, staying green against a fabricated rp. The test now sends
// a well-formed body on purpose, and pairs it with the made-up rp as a control.
//
// 🔴 TRAP 2 — THE v4 ACTION IS INVISIBLE TO v2. `agent-signature-gate` exists (created via
// the portal MCP in BOTH environments) and yet legacy v2, asked with our app id, still
// answers `invalid_action` / "Action not found." World ID 4.0 actions hang off the rp_id,
// not the app id. Anyone wiring the legacy path will chase an action that is right there.
//
// That split is the whole reason the negative path was measured first: it is the half that
// can be established today, and a refusal that is real is worth more than an acceptance
// that is staged.

export const WORLD_VERIFY_BASE = 'https://developer.world.org';
export const WORLD_VERIFY_BASE_LEGACY = 'https://developer.worldcoin.org';

// 🔴 v4 IS THE CURRENT ENDPOINT; v2 IS LABELLED LEGACY BY WORLD THEMSELVES.
// Checked against their reference, not inferred:
//   current  POST /api/v4/verify/{rp_id}  — success + results, no auth, accepts 3.0 proofs
//   legacy   POST /api/v2/verify/{app_id} — success + action + nullifier_hash + created_at
//
// We keep both and default to v4. The reason is not tidiness: AgentKit's own CLI is
// unusable today because it pins a World ID client two majors behind, and a submission
// judged in September 2026 should not repeat that on the verifying side.
//
// ⚠️ Their v4 note, worth obeying literally: "Forward the complete IDKit result without
// remapping response identifiers or constructing a legacy verification_level." Remapping
// is a documented way to break this, so `responses` is passed through untouched.

/**
 * Post a proof to World's verifier.
 *
 * Outcomes, and the third is the one that earns its keep:
 *   { ok: true,  verified: true }             — World accepted the proof
 *   { ok: true,  verified: false, reason }    — World rejected it, and said why
 *   { ok: false, reason: 'verify_unreachable' } — we could not ask
 *
 * A rejection and an outage are not the same event: the first is a statement about the
 * proof, the second about our network. Collapsing them would let an outage read as
 * "this person failed verification".
 */
export async function verifyWorldIdProof({
  appId,
  action,
  proof,
  merkleRoot,
  nullifierHash,
  verificationLevel = 'orb',
  signalHash,
  base = WORLD_VERIFY_BASE,
  apiVersion = 'v2',
  fetchImpl = fetch,
  timeoutMs = 10_000,
} = {}) {
  if (typeof appId !== 'string' || !/^app_[A-Za-z0-9_]+$/.test(appId)) {
    return { ok: false, reason: 'bad_app_id', detail: String(appId) };
  }
  if (typeof action !== 'string' || action === '') {
    return { ok: false, reason: 'bad_request', detail: 'action missing' };
  }
  for (const [k, v] of [['proof', proof], ['merkleRoot', merkleRoot], ['nullifierHash', nullifierHash]]) {
    if (typeof v !== 'string' || v === '') return { ok: false, reason: 'bad_request', detail: `${k} missing` };
  }

  const body = {
    action,
    proof,
    merkle_root: merkleRoot,
    nullifier_hash: nullifierHash,
    verification_level: verificationLevel,
  };
  if (signalHash !== undefined) body.signal_hash = signalHash;

  let res, text;
  try {
    res = await fetchImpl(`${base}/api/${apiVersion}/verify/${appId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await res.text();
  } catch (err) {
    return { ok: false, reason: 'verify_unreachable', detail: String(err?.message ?? err) };
  }

  // 🔴 A 5xx or a 429 is THEIR infrastructure, not a statement about this proof. The guard
  // above only catches a THROWN fetch; a served error arrives as an ordinary response, and
  // if its body happens to be JSON it would come back as { verified: false } — an outage
  // reading as "this person failed verification". That is precisely the collapse the
  // contract at the top of this function forbids, and it survived on the path the original
  // guard did not cover. Same rule, both halves — found in review 2026-09-07.
  if (res.status >= 500 || res.status === 429) {
    return { ok: false, reason: 'verify_unreachable', detail: `status ${res.status}` };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A non-JSON body means we did not reach the verifier we think we did — a proxy, a
    // captive portal, an error page. That is "could not ask", not "rejected".
    return { ok: false, reason: 'verify_unreachable', detail: `non-JSON body, status ${res.status}` };
  }

  if (res.ok && parsed?.success === true) {
    return { ok: true, verified: true, nullifierHash: parsed.nullifier_hash ?? nullifierHash };
  }

  // World answered and said no. Keep THEIR code — it is more useful than ours.
  return {
    ok: true,
    verified: false,
    reason: parsed?.code ?? `http_${res.status}`,
    detail: parsed?.detail ?? parsed?.attribute ?? null,
    status: res.status,
  };
}


/**
 * Verify against the CURRENT endpoint, keyed by relying-party id.
 *
 * Same three outcomes as the legacy call, and for the same reason: World rejecting a proof
 * and us failing to reach World are different events.
 *
 * `responses` is forwarded VERBATIM — see the note at the top of this file.
 */
export async function verifyWorldIdProofV4({
  rpId,
  action,
  nonce,
  responses,
  protocolVersion = '4.0',
  environment,
  sessionId,
  base = WORLD_VERIFY_BASE,
  fetchImpl = fetch,
  timeoutMs = 10_000,
} = {}) {
  if (typeof rpId !== 'string' || !/^rp_[A-Za-z0-9_]+$/.test(rpId)) {
    return { ok: false, reason: 'bad_rp_id', detail: String(rpId) };
  }
  if (typeof action !== 'string' || action === '') {
    return { ok: false, reason: 'bad_request', detail: 'action missing' };
  }
  if (typeof nonce !== 'string' || nonce === '') {
    return { ok: false, reason: 'bad_request', detail: 'nonce missing' };
  }
  if (!Array.isArray(responses) || responses.length === 0) {
    return { ok: false, reason: 'bad_request', detail: 'responses must be a non-empty array' };
  }

  const body = { protocol_version: protocolVersion, nonce, action, responses };
  if (environment !== undefined) body.environment = environment;
  if (sessionId !== undefined) body.session_id = sessionId;

  let res, text;
  try {
    res = await fetchImpl(`${base}/api/v4/verify/${rpId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await res.text();
  } catch (err) {
    return { ok: false, reason: 'verify_unreachable', detail: String(err?.message ?? err) };
  }

  // 🔴 A 5xx or a 429 is THEIR infrastructure, not a statement about this proof. The guard
  // above only catches a THROWN fetch; a served error arrives as an ordinary response, and
  // if its body happens to be JSON it would come back as { verified: false } — an outage
  // reading as "this person failed verification". That is precisely the collapse the
  // contract at the top of this function forbids, and it survived on the path the original
  // guard did not cover. Same rule, both halves — found in review 2026-09-07.
  if (res.status >= 500 || res.status === 429) {
    return { ok: false, reason: 'verify_unreachable', detail: `status ${res.status}` };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'verify_unreachable', detail: `non-JSON body, status ${res.status}` };
  }

  if (res.ok && parsed?.success === true) {
    return { ok: true, verified: true, nullifier: parsed.nullifier ?? null, results: parsed.results ?? null };
  }

  // Their per-result `code` is more specific than the envelope, so prefer it when present.
  const firstResultCode = Array.isArray(parsed?.results) ? parsed.results.find((r) => r?.code)?.code : undefined;
  return {
    ok: true,
    verified: false,
    reason: firstResultCode ?? parsed?.code ?? `http_${res.status}`,
    detail: parsed?.detail ?? parsed?.message ?? null,
    status: res.status,
  };
}
