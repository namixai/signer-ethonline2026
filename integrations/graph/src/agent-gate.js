// The gate: an agent that does not resolve to a registered human gets NO SIGNATURE.
//
// 🔴 WHY THIS EXISTS AS A GATE AND NOT A REPORT. A resolver that looks up the human and
// then signs anyway changes nothing about the product — it is a lookup with a log line.
// World's own "What Won't Qualify" slide names that case: "agent registration demos that
// don't change product behavior". The difference between reporting and refusing is the
// whole point, and it is one branch of code.
//
// 🔴 WHERE IT RUNS, SAID PRECISELY. Outside the enclave. There is no enclave action that
// resolves an agent, and there will not be one in this window — resolution needs the
// network and an enclave has none. So the claim is:
//
//     "no signature is REQUESTED for an agent that does not resolve to a registered human"
//
// and never "the enclave refuses such agents". The gate is ours, it runs before the
// request, and a reader should be able to see which of those two we mean.
//
// FAIL-CLOSED, WITH THE REASON KEPT SEPARATE. Three inputs, two outcomes for the caller
// and three for the operator:
//
//   registered            -> signature may be requested
//   definitively absent   -> refused, `no_registered_human`
//   could not establish   -> refused, `human_unverified`      <- NOT the same thing
//
// Both refusals stop a signature, so on the money path they are equally safe. They are
// kept apart because the operator response differs completely: one is "this agent was
// never registered", the other is "our view of the registry is broken". Collapsing them
// sends someone to onboard an agent that is already onboarded.

import { lookupHumanAnywhere } from './world.js';

export const GATE_SCHEMA = 'usenami.agent-gate.v1';

/**
 * @param requireHumanId optional — when set, the agent must resolve to THIS human.
 *        ⚠️ Read the caveat in the README before using it: AgentBook lets any World ID
 *        holder overwrite an agent's record, so a third party can break such a policy
 *        from outside by re-pointing it. Absence of a human cannot be forged; a specific
 *        identity can be replaced.
 */
export async function gateSignatureRequest({
  agentAddress,
  requireHumanId = null,
  lookup = lookupHumanAnywhere,
  observedAtMs,
} = {}) {
  const receipt = (allowed, reason, extra = {}) => ({
    allowed,
    reason,
    receipt: {
      schema: GATE_SCHEMA,
      decision: allowed ? 'signature_may_be_requested' : 'refused_before_signature',
      // Named in the receipt itself so nobody has to take our word for where it ran.
      decided_by: 'gateway_before_enclave',
      reason,
      agent: typeof agentAddress === 'string' ? agentAddress : null,
      // 🔴 `=== undefined` let null through as the STRING "null" — the exact shape this
      // file argues against, committed inside it. A finite number or nothing at all.
      observed_at_ms: typeof observedAtMs === 'number' && Number.isFinite(observedAtMs)
        ? String(observedAtMs)
        : null,
      ...extra,
    },
  });

  if (typeof agentAddress !== 'string' || agentAddress === '') {
    return receipt(false, 'bad_request', { detail: 'agentAddress missing' });
  }

  let r;
  try {
    r = await lookup(agentAddress);
  } catch (err) {
    // A throwing resolver is an unperformed check, not a verdict about the agent.
    return receipt(false, 'human_unverified', { detail: String(err?.message ?? err) });
  }

  if (!r || typeof r !== 'object') {
    return receipt(false, 'human_unverified', { detail: 'resolver returned nothing usable' });
  }

  if (r.ok !== true) {
    // bad_address is the caller's mistake and deserves its own name; everything else is
    // "we could not establish it".
    if (r.reason === 'bad_address') return receipt(false, 'bad_request', { detail: r.reason });
    return receipt(false, 'human_unverified', { detail: r.reason ?? null });
  }

  if (r.registered !== true) {
    return receipt(false, 'no_registered_human', { checked_registries: registriesOf(r) });
  }

  if (requireHumanId !== null && r.humanId !== requireHumanId) {
    return receipt(false, 'different_human', { expected: requireHumanId, got: r.humanId ?? null });
  }

  // 🔴 THE ALLOWING BRANCH VALIDATES TOO. A resolver answering `registered: true` with an
  // empty or malformed humanId would produce a receipt that says a human is behind this
  // agent and names nobody — the one branch where a missing value costs a signature.
  if (typeof r.humanId !== 'string' || !/^0x[0-9a-fA-F]+$/.test(r.humanId)) {
    return receipt(false, 'human_unverified', { detail: `malformed humanId: ${String(r.humanId)}` });
  }

  return receipt(true, 'registered_human', {
    human_id: r.humanId,
    registry: r.chain ?? null,
    checked_registries: registriesOf(r),
  });
}

/** Which registries actually answered — so a refusal says how thoroughly we looked. */
function registriesOf(r) {
  if (!Array.isArray(r.checked)) return null;
  return r.checked.map((c) => `${c.chain}:${c.ok ? (c.registered ? 'registered' : 'absent') : (c.reason ?? 'error')}`);
}
