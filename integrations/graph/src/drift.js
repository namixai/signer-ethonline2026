// The watcher for everything this package pins.
//
// The spec rule this implements, verbatim: anything baked must have a NAMED external
// watcher that compares it against the live value on a schedule, and whose alarm is
// DISTINGUISHABLE FROM A POLICY REFUSAL. Without it a protocol migration reads as
// "signature did not verify" — a fail-closed that lies about its cause, which nobody
// goes and fixes.
//
// This is not hypothetical. The pre-Horizon DisputeManager silently recovers a
// different address: no error, no exception, just the wrong allocation. It cost the
// first attempt at the end-to-end check.

import { GRAPH_NETWORK } from './attestation.js';
import { isMain } from './is-main.js';

// NB: `packages/address-book/src/subgraph-service/addresses.json` is a SYMLINK in git —
// fetching it raw returns the target path as text, not JSON. The watcher caught that
// itself and reported "could not check" rather than "no drift", which is the whole
// point of keeping those two outcomes apart. This is the real file.
export const ADDRESS_BOOK_URL =
  'https://raw.githubusercontent.com/graphprotocol/contracts/main/packages/subgraph-service/addresses.json';

/**
 * Compare the pinned addresses against The Graph's published address book.
 *
 * The result is deliberately its own shape — `driftDetected`, not `denied` — so it
 * can never be filed under "policy refused".
 *
 * @param fetchJson injectable so tests stay offline
 */
export async function checkAddressDrift(
  network = GRAPH_NETWORK,
  fetchJson = async (url) => (await fetch(url)).json(),
) {
  let book;
  try {
    book = await fetchJson(ADDRESS_BOOK_URL);
  } catch (err) {
    // Not knowing is its own outcome. Reporting "no drift" because the check failed
    // would be the same lie in a different direction.
    return {
      checked: false,
      driftDetected: null,
      reason: 'address_book_unreachable',
      detail: String(err?.message ?? err),
    };
  }

  const live = book?.[String(network.chainId)];
  if (!live) {
    return {
      checked: false,
      driftDetected: null,
      reason: 'chain_absent_from_address_book',
      detail: { chainId: network.chainId },
    };
  }

  const drift = [];
  for (const [key, bookKey] of [
    ['disputeManager', 'DisputeManager'],
    ['subgraphService', 'SubgraphService'],
  ]) {
    const liveAddr = live[bookKey]?.address;
    if (!liveAddr) {
      drift.push({ key, pinned: network[key], live: null, note: 'absent from address book' });
      continue;
    }
    if (liveAddr.toLowerCase() !== network[key].toLowerCase()) {
      drift.push({ key, pinned: network[key], live: liveAddr });
    }
  }

  return drift.length === 0
    ? { checked: true, driftDetected: false }
    : {
        checked: true,
        driftDetected: true,
        reason: 'pinned_address_drift',
        drift,
        // Said out loud because the failure mode is a wrong answer, not an error.
        consequence:
          'attestations will still verify and recover a DIFFERENT allocation — wrong, silently',
      };
}

// Watchdog entry point: `node src/drift.js`. Exit 1 on drift, 2 when the check
// could not run — three outcomes, never collapsed into two.
if (isMain(import.meta.url)) {
  const r = await checkAddressDrift();
  console.log(JSON.stringify(r, null, 2));
  // exitCode, not exit(): the JSON above must survive a pipe.
  process.exitCode = r.checked === false ? 2 : r.driftDetected ? 1 : 0;
}
