// World AgentKit — resolving an agent's address to a registered human.
//
// WHAT THIS IS FOR: before Signer is asked for a signature, we want to know that the
// address asking has a real, World-ID-verified person standing behind it.
//
// 🔴 WHERE IT RUNS, AND WHY THAT IS NOT A DETAIL. Every step below needs the network,
// so NONE of it can happen inside the enclave:
//   - AgentBook.lookupHuman is a World Chain read;
//   - the signature check is ALSO potentially a chain read — World App wallets are
//     smart contract accounts, so verification goes through ERC-1271 (`isValidSignature`),
//     with plain ecrecover only as the EOA fallback.
// So the honest claim is "the agent's address is resolved to a registered human BEFORE a
// signature is requested". NOT "Signer signs only for agents with a human behind them" —
// that would place a check inside the attested boundary that demonstrably is not there.
//
// Sources read before writing this (not assumed):
//   worldcoin/agentkit  contracts/src/interfaces/IAgentBook.sol
//                       core/src/agent-book.ts, core/src/evm.ts, core/src/validate.ts

import { createPublicClient, http, getAddress, isAddress } from 'viem';

export const BASE_CHAIN = {
  id: 8453,
  name: 'Base',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://mainnet.base.org'] } },
};

// World Chain. The id is spelled out rather than imported so that a drifting chain
// definition cannot silently point this at another network.
export const WORLD_CHAIN = {
  id: 480,
  name: 'World Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://worldchain-mainnet.g.alchemy.com/public'] } },
};

// 🔴 Verified on chain before being baked: eth_getCode returns 7140 hex chars here, and
// `0x` (no contract at all) at 0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4 — the address
// our own roadmap carried since 28.08. Nothing ever called it, so nothing ever caught it.
// Baked constants need a watcher; see worldDrift() at the bottom.
export const AGENT_BOOK_ADDRESS = getAddress('0xA23aB2712eA7BBa896930544C7d6636a96b944dA');

const AGENT_BOOK_ABI = [
  {
    name: 'lookupHuman',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agent', type: 'address' }],
    outputs: [{ name: 'humanId', type: 'uint256' }],
  },
];

// Every network call this module makes is bounded. An unbounded read does not fail — it
// hangs, and a hung check reports nothing at all, not even "could not check".
export const RPC_TIMEOUT_MS = 10_000;

/**
 * 🔴 AGENTBOOK IS DEPLOYED TWICE, AND THE KIT'S OWN HALVES DISAGREE ABOUT WHICH ONE.
 *
 *   Base            0xE1D1…4561a4   — where `agentkit register` writes (CLI default)
 *   World Chain     0xA23aB…b944dA   — where `createAgentBookVerifier()` reads, hardcoded
 *   Base Sepolia    0xA23aB…b944dA   — same address, test network
 *
 * Verified by reading code at all three: each address holds a 3569-byte contract on the
 * chain the CLI documentation names, and nothing on the others. The CLI's supported
 * networks are `base` and `base-sepolia` ONLY — World Chain is not among them — while
 * core/src/agent-book.ts resolves against World Chain unconditionally, "regardless of
 * which chain the agent's signature was produced on".
 *
 * Follow both defaults and a correctly registered agent resolves to NOBODY. So we do not
 * pick one and hope: we ask BOTH and report which answered. One extra read removes the
 * entire failure class, and the alternative is debugging our own resolver for a
 * registration that simply landed elsewhere.
 */
export const AGENT_BOOK_DEPLOYMENTS = [
  { chain: 'base', chainId: 8453, viemChain: BASE_CHAIN, address: getAddress('0xE1D1D3526A6FAa37eb36bD10B933C1b77f4561a4'), rpcUrl: 'https://mainnet.base.org' },
  { chain: 'worldchain', chainId: 480, viemChain: WORLD_CHAIN, address: getAddress('0xA23aB2712eA7BBa896930544C7d6636a96b944dA'), rpcUrl: 'https://worldchain-mainnet.g.alchemy.com/public' },
];

/**
 * 🔴 THE CHAIN OBJECT MUST MATCH THE RPC. Pointing a client built with WORLD_CHAIN
 * (id 480) at a Base RPC read correctly today, but `client.chain.id` then lies about
 * which network the answer came from — and this module's whole job is to say WHICH
 * registry answered. A latent wrong label on a correct value is the worst kind.
 */
export function chainClient(chain, rpcUrl = chain.rpcUrls.default.http[0], timeout = RPC_TIMEOUT_MS) {
  return createPublicClient({ chain, transport: http(rpcUrl, { timeout }) });
}

export function worldClient(rpcUrl = WORLD_CHAIN.rpcUrls.default.http[0], timeout = RPC_TIMEOUT_MS) {
  return chainClient(WORLD_CHAIN, rpcUrl, timeout);
}

/**
 * Resolve an agent address to its anonymous human id.
 *
 * 🔴 THREE OUTCOMES, AND THE THIRD IS THE POINT.
 *
 *   { ok: true,  registered: true,  humanId }   a human is registered for this agent
 *   { ok: true,  registered: false }            the contract answered: nobody is
 *   { ok: false, reason: … }                    we could not find out
 *
 * The official client collapses the last two — `core/src/agent-book.ts` returns `null`
 * both when `humanId === 0n` and inside `catch {}`. A caller cannot then tell "this
 * agent has no human" from "the RPC was down", so an outage refuses legitimate humans
 * while the operator goes looking for an unregistered agent. Same defect shape we
 * already refused in chain.js (`allocation_lookup_failed`).
 */
export async function lookupHuman(agentAddress, { client, address = AGENT_BOOK_ADDRESS } = {}) {
  if (typeof agentAddress !== 'string' || !isAddress(agentAddress)) {
    return { ok: false, reason: 'bad_address', detail: String(agentAddress) };
  }
  // A malformed CONTRACT address is a misconfiguration on our side, and it gets its own
  // name. Without this it fell through to `lookup_failed` — "we could not find out" —
  // which is the very collapse this module exists to refuse, committed against ourselves.
  if (typeof address !== 'string' || !isAddress(address)) {
    return { ok: false, reason: 'bad_contract_address', detail: String(address) };
  }
  const c = client ?? worldClient();

  // A migrated or mis-typed contract address answers eth_call with empty data, which
  // some decoders happily read as zero — i.e. as "not registered". Ask first whether
  // there is any code here at all, so a migration is named instead of mistaken for
  // an answer.
  try {
    const code = await c.getCode({ address });
    if (!code || code === '0x') {
      return { ok: false, reason: 'no_contract_at_address', detail: { address } };
    }
  } catch (err) {
    return { ok: false, reason: 'lookup_failed', detail: String(err?.shortMessage ?? err) };
  }

  let humanId;
  try {
    humanId = await c.readContract({
      address,
      abi: AGENT_BOOK_ABI,
      functionName: 'lookupHuman',
      args: [getAddress(agentAddress)],
    });
  } catch (err) {
    return { ok: false, reason: 'lookup_failed', detail: String(err?.shortMessage ?? err) };
  }

  if (typeof humanId !== 'bigint') {
    return { ok: false, reason: 'lookup_failed', detail: `unexpected return: ${typeof humanId}` };
  }
  // Zero is a real answer from a live contract, not an absence of one.
  if (humanId === 0n) return { ok: true, registered: false };
  return { ok: true, registered: true, humanId: `0x${humanId.toString(16)}` };
}

/**
 * Verify the agent's SIWE signature.
 *
 * 🔴 A FAILED CHECK AND AN UNPERFORMED ONE ARE DIFFERENT ANSWERS, for the same reason
 * as above and with sharper consequences: `verifyMessage` may reach the chain
 * (ERC-1271), so a network fault would otherwise be reported as "this human's
 * signature is invalid".
 */
export async function verifyAgentSignature({ message, address, signature, client } = {}) {
  if (typeof message !== 'string' || message.length === 0) {
    return { ok: false, reason: 'bad_request', detail: 'message must be a non-empty string' };
  }
  if (typeof address !== 'string' || !isAddress(address)) {
    return { ok: false, reason: 'bad_address', detail: String(address) };
  }
  // Even length required: hex is bytes. `0x123` is not a signature, and letting it
  // through made viem throw during parsing — reported as `verification_failed`, i.e.
  // "could not check" for what is plainly a malformed input. Length is deliberately NOT
  // pinned to 65 bytes: ERC-1271 signatures from smart wallets are arbitrary length.
  if (typeof signature !== 'string' || !/^0x([0-9a-fA-F]{2})+$/.test(signature)) {
    return { ok: false, reason: 'bad_signature', detail: 'signature must be 0x-hex, even length' };
  }
  const c = client ?? worldClient();
  try {
    const valid = await c.verifyMessage({ address: getAddress(address), message, signature });
    return { ok: true, valid: Boolean(valid) };
  } catch (err) {
    return { ok: false, reason: 'verification_failed', detail: String(err?.shortMessage ?? err) };
  }
}

export const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Freshness and binding checks over the SIWE payload — all offline, so they run first
 * and cost nothing.
 *
 * 🔴 THE NONCE CHECKER IS REQUIRED HERE, DELIBERATELY UNLIKE THE OFFICIAL KIT.
 * `core/src/validate.ts` guards it with `if (options.checkNonce)`, so an integrator who
 * supplies no checker gets no replay protection at all and no warning — the same signed
 * message can be presented again for the whole five-minute window. The kit's own error
 * string for that branch reads "possible replay attack", so the defence is understood;
 * it is simply off unless asked for. For an order-signing path a five-minute replay
 * window is the difference between one trade and a hundred, so a missing checker is an
 * incomplete configuration (`nonce_check_required`), never a silent pass.
 */
export const DEFAULT_CLOCK_TOLERANCE_MS = 60 * 1000;

export async function checkMessage(
  payload,
  expectedResourceUri,
  {
    maxAgeMs = DEFAULT_MAX_AGE_MS,
    clockToleranceMs = DEFAULT_CLOCK_TOLERANCE_MS,
    checkNonce,
    now = Date.now,
  } = {},
) {
  if (payload == null || typeof payload !== 'object') {
    return { ok: false, reason: 'bad_request', detail: 'payload missing' };
  }
  if (typeof checkNonce !== 'function') {
    return { ok: false, reason: 'nonce_check_required', detail: 'no replay protection supplied' };
  }

  let expected;
  try {
    expected = new URL(expectedResourceUri);
  } catch {
    return { ok: false, reason: 'bad_request', detail: 'expectedResourceUri is not a URL' };
  }
  // 🔴 `host`, NOT `hostname`. EIP-4361 defines `domain` as an RFC 3986 authority, which
  // carries the port when there is one. The official kit compares against `hostname`
  // (core/src/validate.ts), so on any deployment with a non-default port it rejects every
  // legitimate message — while checking `uri` against `host` two lines later, so the kit
  // is inconsistent with itself. Ours has no explicit port today, where host === hostname,
  // so this changes no behaviour for us and stops being wrong the moment one appears.
  if (payload.domain !== expected.host) {
    return { ok: false, reason: 'domain_mismatch', detail: { got: payload.domain, expected: expected.host } };
  }
  // 🔴 THE WHOLE URI, not just its host. Comparing hosts accepted a signature issued
  // for `http://signer.usenami.io/other` against an expectation of
  // `https://signer.usenami.io/agent` — different scheme AND different resource. Since
  // this binding exists precisely to stop a signature being replayed at another resource,
  // checking only the host defeated half of it. The official kit compares hosts too
  // (core/src/validate.ts), so this is theirs as well as mine.
  let href;
  try {
    href = new URL(payload.uri).href;
  } catch {
    return { ok: false, reason: 'bad_uri', detail: String(payload.uri) };
  }
  if (href !== expected.href) {
    return { ok: false, reason: 'uri_mismatch', detail: { got: href, expected: expected.href } };
  }

  const issuedAt = new Date(payload.issuedAt).getTime();
  if (Number.isNaN(issuedAt)) return { ok: false, reason: 'bad_issued_at' };
  const age = now() - issuedAt;
  // Phone clocks drift. Refusing a message because the signer's clock is a second ahead
  // costs a real person their request and buys nothing, so a bounded tolerance is allowed.
  //
  // ⚠️ IT IS A TRADE, SAID OUT LOUD: accepting a future-dated message stretches the
  // effective validity to maxAgeMs + clockToleranceMs. That is affordable HERE only
  // because replay is stopped by the mandatory nonce checker above, not by the clock —
  // the time window is depth, not the control. Anyone lowering the nonce requirement must
  // revisit this number.
  if (age < -clockToleranceMs) return { ok: false, reason: 'issued_in_future', detail: { age, clockToleranceMs } };
  if (age > maxAgeMs) return { ok: false, reason: 'message_too_old', detail: { age, maxAgeMs } };

  if (payload.expirationTime != null) {
    const exp = new Date(payload.expirationTime).getTime();
    if (Number.isNaN(exp)) return { ok: false, reason: 'bad_expiration_time' };
    if (exp < now()) return { ok: false, reason: 'message_expired' };
  }
  if (payload.notBefore != null) {
    const nb = new Date(payload.notBefore).getTime();
    if (Number.isNaN(nb)) return { ok: false, reason: 'bad_not_before' };
    if (now() < nb) return { ok: false, reason: 'not_yet_valid' };
  }

  // 🔴 SHAPE FIRST, STORE SECOND. An absent nonce used to reach `checkNonce` as
  // `undefined`, and a plain Set-backed store answers "not seen" for that — so a message
  // carrying NO replay binding at all was approved, once, silently. Our own test helper
  // would have done exactly this. Same silhouette as `''` in normaliseV and NaN in the
  // price: a falsy value slipping past a guard aimed at a different falsy value.
  // EIP-4361 asks for at least 8 alphanumeric characters.
  if (typeof payload.nonce !== 'string' || !/^[A-Za-z0-9]{8,}$/.test(payload.nonce)) {
    return { ok: false, reason: 'bad_nonce', detail: String(payload.nonce) };
  }

  let fresh;
  try {
    fresh = await checkNonce(payload.nonce);
  } catch (err) {
    // Could not consult the nonce store. Not a replay — an unperformed check.
    return { ok: false, reason: 'nonce_check_failed', detail: String(err?.message ?? err) };
  }
  if (!fresh) return { ok: false, reason: 'nonce_replayed', detail: { nonce: payload.nonce } };

  return { ok: true };
}


/**
 * Ask EVERY known AgentBook deployment, because the kit writes to one and reads another.
 *
 * 🔴 THE THIRD OUTCOME IS THE ONE THAT EARNS ITS KEEP. "Not found on the registry we
 * could reach, and the other was unreachable" is NOT "this agent has no human" — it is
 * partial knowledge, and reporting it as a decided no would refuse a legitimate person
 * because one RPC was down. It gets its own name.
 *
 * @param clients optional map { base: client, worldchain: client } for offline tests
 */
export async function lookupHumanAnywhere(agentAddress, { deployments = AGENT_BOOK_DEPLOYMENTS, clients = {} } = {}) {
  // Checked once, before any network call: the same answer would come back from every
  // registry, and the test asserts not a single client is touched.
  if (typeof agentAddress !== 'string' || !isAddress(agentAddress)) {
    return { ok: false, reason: 'bad_address', detail: String(agentAddress) };
  }
  // 🔴 An empty list used to satisfy `answered.length === deployments.length` as 0 === 0
  // and return a decided "no human" WITHOUT ASKING ANYONE. A check that queries nothing
  // must never produce a verdict — that is the whole thesis of this file, broken in it.
  if (!Array.isArray(deployments) || deployments.length === 0) {
    return { ok: false, reason: 'no_deployments_configured', detail: 'nothing was queried' };
  }

  // 🔴 EVERY ENTRY VALIDATED BEFORE ANY REQUEST. `[null]` used to THROW out of the
  // mapper — breaking this module's contract that malformed input becomes a named
  // refusal, never an exception. And `[{}]` was worse than it looked: with no `address`,
  // the destructuring default inside lookupHuman fired and it quietly queried the
  // STANDARD registry, returning a confident "no human" sourced from a deployment the
  // caller never asked for. A missing value falling through to a default and producing a
  // verdict is the same defect as the absent nonce and the empty list above.
  for (const [i, d] of deployments.entries()) {
    const bad = (why) => ({ ok: false, reason: 'bad_deployment_config', detail: { index: i, why } });
    if (d == null || typeof d !== 'object') return bad('entry is not an object');
    if (typeof d.chain !== 'string' || d.chain === '') return bad('missing chain name');
    if (typeof d.address !== 'string' || !isAddress(d.address)) return bad(`bad address for ${d.chain}`);
    if (typeof d.rpcUrl !== 'string' || d.rpcUrl === '') return bad(`missing rpcUrl for ${d.chain}`);
    if (d.viemChain == null || typeof d.viemChain.id !== 'number') return bad(`missing chain object for ${d.chain}`);
    if (d.chainId !== undefined && d.chainId !== d.viemChain.id) return bad(`chainId disagrees with chain object for ${d.chain}`);
  }

  // In parallel: sequential probing made a dead first RPC cost the full timeout before
  // the second registry was asked at all — up to 10s of waiting for an answer the other
  // registry already had. Order is still deployment order when picking the winner, so a
  // race between two registries cannot make the reported chain non-deterministic.
  const checked = await Promise.all(
    deployments.map(async (d) => {
      const client = clients[d.chain] ?? chainClient(d.viemChain, d.rpcUrl);
      const r = await lookupHuman(agentAddress, { client, address: d.address });
      return { chain: d.chain, ...r };
    }),
  );

  const hit = checked.find((c) => c.ok && c.registered);
  if (hit) return { ok: true, registered: true, humanId: hit.humanId, chain: hit.chain, checked };

  if (checked.every((c) => c.ok)) {
    // Every registry answered, and every one said nobody. That is a decided no.
    return { ok: true, registered: false, checked };
  }
  return {
    ok: false,
    reason: 'lookup_incomplete',
    detail: 'not registered where we could look, and at least one registry did not answer',
    checked,
  };
}
