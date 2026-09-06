// Watcher tests. Fully offline — both sources are injected.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWorldDrift } from '../src/world-drift.js';
import { AGENT_BOOK_ADDRESS } from '../src/world.js';

const kitSrc = (addr) => `const AGENT_BOOK_ADDRESS: \`0x\${string}\` = '${addr}'\n`;
const liveClient = (code = '0x6080') => ({ async getCode() { return code; } });
const deadClient = () => ({ async getCode() { throw new Error('rpc down'); } });

// exit code the CLI would use — the three outcomes, as the operator sees them
const exitOf = (r) => (r.driftDetected ? 1 : r.checked ? 0 : 2);

test('agreement on both sources is no drift', async () => {
  const r = await checkWorldDrift({
    client: liveClient(),
    fetchText: async () => kitSrc(AGENT_BOOK_ADDRESS),
  });
  assert.equal(r.driftDetected, false);
  assert.equal(r.checked, true);
  assert.equal(exitOf(r), 0);
});

test('the kit naming a different address is drift, with the consequence spelled out', async () => {
  const r = await checkWorldDrift({
    client: liveClient(),
    fetchText: async () => kitSrc('0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4'),
  });
  assert.equal(r.driftDetected, true);
  assert.equal(r.kit.reason, 'kit_address_differs');
  assert.match(r.consequence, /every agent reads as having no human/);
  assert.equal(exitOf(r), 1);
});

test('an empty pinned address on chain is drift, and the stronger signal', async () => {
  const r = await checkWorldDrift({
    client: liveClient('0x'),
    fetchText: async () => kitSrc(AGENT_BOOK_ADDRESS),
  });
  assert.equal(r.driftDetected, true);
  assert.equal(r.onChain.reason, 'no_contract_at_pinned_address');
});

test('🔴 an unreadable kit source is NOT agreement — the symlink trap, again', async () => {
  // drift.js was once handed a symlink TARGET PATH instead of JSON. Anything that is
  // not the source must report "could not tell", never "the addresses match".
  const r = await checkWorldDrift({
    client: liveClient(),
    fetchText: async () => 'packages/address-book/src/agent-book.ts',
  });
  assert.equal(r.kit.checked, false);
  assert.equal(r.kit.reason, 'address_not_found_in_kit_source');
  assert.equal(r.driftDetected, false, 'not knowing is not drift');
  assert.equal(r.checked, false, 'and it is not a clean check either');
  assert.equal(exitOf(r), 2, 'the operator must see 2, not 0');
});

test('🔴 an RPC outage cannot be reported as a clean check', async () => {
  const r = await checkWorldDrift({
    client: deadClient(),
    fetchText: async () => kitSrc(AGENT_BOOK_ADDRESS),
  });
  assert.equal(r.onChain.checked, false);
  assert.equal(r.onChain.ok, null);
  assert.equal(r.checked, false);
  assert.equal(exitOf(r), 2);
});

test('a network fault on one source does not mask real drift on the other', async () => {
  const r = await checkWorldDrift({
    client: liveClient('0x'),
    fetchText: async () => { throw new Error('github down'); },
  });
  assert.equal(r.driftDetected, true, 'drift wins over an incomplete check');
  assert.equal(exitOf(r), 1);
});

test('the kit switching quote style is read, not reported as unreadable', async () => {
  for (const [label, src] of [
    ['двойные', `const AGENT_BOOK_ADDRESS = "${AGENT_BOOK_ADDRESS}"\n`],
    ['бэктики', `const AGENT_BOOK_ADDRESS = \`${AGENT_BOOK_ADDRESS}\`\n`],
  ]) {
    const r = await checkWorldDrift({ client: liveClient(), fetchText: async () => src });
    assert.equal(r.kit.checked, true, label);
    assert.equal(r.driftDetected, false, label);
  }
});

test('a quote-style change must still surface REAL drift, not hide it', async () => {
  const r = await checkWorldDrift({
    client: liveClient(),
    fetchText: async () => `const AGENT_BOOK_ADDRESS = "0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4"\n`,
  });
  assert.equal(r.driftDetected, true);
  assert.equal(r.kit.reason, 'kit_address_differs');
});

test('🔴 a commented-out old address must not be read as DRIFT', async () => {
  // The dangerous direction: a false alarm (exit 1) costs more than a false "could not
  // tell" (exit 2), because somebody acts on an alarm.
  const src = [
    "// const AGENT_BOOK_ADDRESS = '0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4'",
    "  // AGENT_BOOK_ADDRESS = '0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4'",
    `const AGENT_BOOK_ADDRESS = '${AGENT_BOOK_ADDRESS}'`,
  ].join('\n');
  const r = await checkWorldDrift({ client: liveClient(), fetchText: async () => src });
  assert.equal(r.driftDetected, false, 'a comment is not a change of address');
  assert.equal(r.kit.checked, true);
});

test('two real declarations are ambiguous, and ambiguity is could-not-check', async () => {
  const src = [
    `const AGENT_BOOK_ADDRESS = '${AGENT_BOOK_ADDRESS}'`,
    "export const AGENT_BOOK_ADDRESS = '0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4'",
  ].join('\n');
  const r = await checkWorldDrift({ client: liveClient(), fetchText: async () => src });
  assert.equal(r.kit.reason, 'ambiguous_address_in_kit_source');
  assert.equal(r.driftDetected, false, 'guessing between them would be the ritual');
  assert.equal(r.checked, false);
});

test('🔴 a stalled source cannot hang the watcher — it must still answer', { timeout: 3000 }, async () => {
  // A watchdog that hangs emits nothing, not even exit 2, and looks alive while blind.
  //
  // This stub NEVER settles on its own. That is deliberate: the first version of this
  // test used a stub that rejected after five seconds, so it stayed green with the
  // AbortSignal removed — it proved the promise eventually ended, not that WE bounded it.
  // Found by planting the defect and watching nothing go red.
  const started = Date.now();
  const r = await checkWorldDrift({
    client: liveClient(),
    timeoutMs: 50,
    fetchText: (_url, signal) =>
      new Promise((_res, rej) => {
        // 🔴 A REF'D TIMER, and it is not decoration. Without something holding the event
        // loop open, Node 22 ends the loop while this promise is pending and the runner
        // reports "Promise resolution is still pending but the event loop has already
        // resolved" — the test fails for a reason that has nothing to do with the defect
        // it guards. A real fetch holds a socket; the stub has to hold something too.
        //
        // 30s is far beyond the test's own 3s timeout, so it can never be what makes the
        // test pass: remove the AbortSignal and this still never settles in time, the
        // test times out, and it goes red. Verified both ways.
        const keepAlive = setTimeout(() => rej(new Error('stub timer — should never fire')), 30_000);
        signal?.addEventListener('abort', () => {
          clearTimeout(keepAlive);
          rej(new Error('aborted'));
        });
      }),
  });
  assert.ok(Date.now() - started < 2000, 'must return promptly, not eventually');
  assert.equal(r.kit.checked, false);
  assert.equal(r.kit.reason, 'kit_source_unreachable');
  assert.equal(r.checked, false);
  assert.equal(r.driftDetected, false, 'a timeout is not drift');
});
