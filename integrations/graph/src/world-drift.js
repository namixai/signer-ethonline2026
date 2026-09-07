// Watcher for the baked AgentBook address.
//
// The rule this exists to satisfy: anything baked needs a watcher whose alarm is
// DISTINGUISHABLE from a policy refusal. Without one, a contract migration reads as
// "this agent has no registered human" — a refusal aimed at the user instead of at us.
//
// This one has a specific debt behind it. Our roadmap carried
// 0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4 as the AgentBook address from 28.08. There
// is no contract at that address at all. Nothing caught it because nothing called it.

import { AGENT_BOOK_ADDRESS, WORLD_CHAIN, worldClient } from './world.js';
import { isMain } from './is-main.js';

export const KIT_SOURCE_URL =
  'https://raw.githubusercontent.com/worldcoin/agentkit/main/core/src/agent-book.ts';

/**
 * Two independent checks, either of which may come back "could not tell".
 *
 *   onChain  — is there still contract code at the pinned address?
 *   kit      — does the official client still name the same address?
 *
 * The on-chain check is the stronger of the two: the kit's source can lag a migration,
 * but bytecode cannot.
 */
export const SOURCE_TIMEOUT_MS = 10_000;

/**
 * 🔴 EVERY EXTERNAL CALL HERE IS BOUNDED. A watchdog that hangs emits nothing at all —
 * not even exit 2 — and a hung watchdog is indistinguishable from a running one. That is
 * worse than a wrong answer, because nobody goes looking for a process that appears fine.
 */
export async function checkWorldDrift({
  client,
  timeoutMs = SOURCE_TIMEOUT_MS,
  fetchText = async (url, signal) => (await fetch(url, { signal })).text(),
} = {}) {
  const out = { pinned: AGENT_BOOK_ADDRESS, chainId: WORLD_CHAIN.id };

  // --- 1. on chain ---
  try {
    const c = client ?? worldClient();
    const code = await c.getCode({ address: AGENT_BOOK_ADDRESS });
    out.onChain =
      !code || code === '0x'
        ? { checked: true, ok: false, reason: 'no_contract_at_pinned_address' }
        : { checked: true, ok: true, codeBytes: (code.length - 2) / 2 };
  } catch (err) {
    out.onChain = { checked: false, ok: null, reason: 'rpc_unreachable', detail: String(err?.shortMessage ?? err) };
  }

  // --- 2. the official client's constant ---
  try {
    const src = await fetchText(KIT_SOURCE_URL, AbortSignal.timeout(timeoutMs));
    // Anchored on an actual `const` DECLARATION, any quote style, and it must occur
    // EXACTLY ONCE.
    //
    // Loose matching was worse than noisy: a commented-out `// AGENT_BOOK_ADDRESS = '0xold'`
    // sitting above the real line would be picked up first and reported as DRIFT — exit 1,
    // an alarm, on a repository that had not changed its address at all. A false alarm
    // costs more than a false "could not tell", because someone acts on it.
    //
    // Two matches mean we cannot say which one the client uses, so that is `checked:false`
    // as well. Guessing between them would be the ritual this file exists to avoid.
    const all = [
      ...src.matchAll(
        /^\s*(?:export\s+)?const\s+AGENT_BOOK_ADDRESS\b[^=\n]*=\s*['"`](0x[0-9a-fA-F]{40})['"`]/gm,
      ),
    ];
    const m = all.length === 1 ? all[0] : null;
    if (all.length > 1) {
      out.kit = { checked: false, ok: null, reason: 'ambiguous_address_in_kit_source', detail: { matches: all.length } };
    } else if (!m) {
      // The file moved, was renamed, or the fetch returned something that is not the
      // source at all. Not knowing is not agreement.
      out.kit = { checked: false, ok: null, reason: 'address_not_found_in_kit_source' };
    } else if (m[1].toLowerCase() !== AGENT_BOOK_ADDRESS.toLowerCase()) {
      out.kit = { checked: true, ok: false, reason: 'kit_address_differs', live: m[1] };
    } else {
      out.kit = { checked: true, ok: true };
    }
  } catch (err) {
    out.kit = { checked: false, ok: null, reason: 'kit_source_unreachable', detail: String(err?.message ?? err) };
  }

  const checks = [out.onChain, out.kit];
  out.driftDetected = checks.some((c) => c.checked && c.ok === false);
  out.checked = checks.every((c) => c.checked);
  if (out.driftDetected) {
    out.consequence =
      'lookupHuman would answer for the wrong contract — every agent reads as having no human';
  }
  return out;
}

// `node src/world-drift.js`. 0 = agreed, 1 = drift, 2 = could not fully check.
if (isMain(import.meta.url)) {
  const r = await checkWorldDrift();
  console.log(JSON.stringify(r, null, 2));
  process.exitCode = r.driftDetected ? 1 : r.checked ? 0 : 2;
}
