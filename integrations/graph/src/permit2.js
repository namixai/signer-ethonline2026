// Permit2 (Uniswap) EIP-712 digest construction.
//
// Spec: ../../specs/SPEC-permit2-signature-transfer.md in this repository, with runnable
// vectors in ../../vectors/. This module makes that spec RUNNABLE from JavaScript: a vector
// nobody can run validates nothing.
//
// Scope, stated plainly: this builds and checks the DIGEST. It does not sign — signing
// Permit2 needs its own action inside the enclave, which does not exist yet. Saying
// "Signer signs Permit2" before that lands would be a false claim in a public submission.

import { keccak256, encodeAbiParameters, toBytes, getAddress, concat } from 'viem';

const hash = (s) => keccak256(toBytes(s));

export const PERMIT2_ADDRESS = getAddress('0x000000000022d473030f116ddee9f6b43ac78ba3');

// 🔴 THREE fields, not four. Permit2's domain has NO `version`. Copying the usual
// four-field domain produces a valid-looking signature the contract rejects — and the
// rejection is `InvalidSigner`, which reads as "wrong key", not "wrong domain".
const DOMAIN_TYPE_HASH = hash('EIP712Domain(string name,uint256 chainId,address verifyingContract)');
const NAME_HASH = hash('Permit2');

const PERMIT_DETAILS_TYPE_HASH = hash(
  'PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)',
);
// Nested struct: the referenced type is appended, alphabetically, per EIP-712.
const PERMIT_SINGLE_TYPE_HASH = hash(
  'PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)' +
    'PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)',
);

export function domainSeparator(chainId = 1n, verifyingContract = PERMIT2_ADDRESS) {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
      [DOMAIN_TYPE_HASH, NAME_HASH, BigInt(chainId), getAddress(verifyingContract)],
    ),
  );
}

/** hashStruct(PermitDetails). `amount` is uint160 — padding it to 20 bytes is wrong. */
export function hashPermitDetails({ token, amount, expiration, nonce }) {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint160' }, { type: 'uint48' }, { type: 'uint48' }],
      [PERMIT_DETAILS_TYPE_HASH, getAddress(token), BigInt(amount), BigInt(expiration), BigInt(nonce)],
    ),
  );
}

/** hashStruct(PermitSingle) — the nested struct enters as its OWN hash, not inline. */
export function hashPermitSingle({ details, spender, sigDeadline }) {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }],
      [PERMIT_SINGLE_TYPE_HASH, hashPermitDetails(details), getAddress(spender), BigInt(sigDeadline)],
    ),
  );
}

export function permitSingleDigest(permitSingle, chainId = 1n, verifyingContract = PERMIT2_ADDRESS) {
  return keccak256(
    concat(['0x1901', domainSeparator(chainId, verifyingContract), hashPermitSingle(permitSingle)]),
  );
}

/**
 * Policy refusals the spec requires BEFORE a signature exists.
 *
 * The first one is the interesting one: an infinite allowance is refused REGARDLESS of
 * the amount cap. If it were merely capped, an owner who set a high ceiling would
 * silently lose the guarantee — the protection would evaporate exactly for the accounts
 * with the most at stake.
 */
export const UINT160_MAX = (1n << 160n) - 1n;
// The other declared widths, from the type strings above:
//   PermitDetails(address token, uint160 amount, uint48 expiration, uint48 nonce)
//   PermitSingle(PermitDetails details, address spender, uint256 sigDeadline)
const UINT48_MAX = (1n << 48n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;

export function checkPermitPolicy(permitSingle, policy) {
  // Malformed input is a named refusal, never a throw.
  if (permitSingle == null || typeof permitSingle !== 'object') {
    return { ok: false, reason: 'bad_request', detail: 'permitSingle missing' };
  }
  if (policy == null || typeof policy !== 'object') {
    return { ok: false, reason: 'policy_required', detail: 'no policy supplied' };
  }
  const { details, spender, sigDeadline } = permitSingle;
  if (details == null || typeof details !== 'object') {
    return { ok: false, reason: 'bad_request', detail: 'permitSingle.details missing' };
  }

  // 🔴 An INCOMPLETE policy is its own outcome, not a refusal — the same split the
  // enclave already makes (`POLICY_REQUIRED` vs `POLICY_DENIED`). Collapsing them
  // reads as "the rules said no" when the truth is "there are no rules yet", and
  // nobody goes and fixes a refusal.
  for (const [key, label] of [
    ['allowedTokens', 'no token allow-list'],
    ['allowedSpenders', 'no spender allow-list'],
    ['maxAmount', 'no amount cap'],
  ]) {
    if (policy[key] === undefined || policy[key] === null) {
      return { ok: false, reason: 'policy_required', detail: label };
    }
  }

  // 🔴 EVERY conversion is wrapped, not just `amount`. The contract above says malformed
  // input is a named refusal and never a throw, and only one field honoured it: a missing
  // token threw InvalidAddressError, a missing spender the same, an undefined sigDeadline a
  // TypeError, a non-integer expiration a SyntaxError, and a policy list that is not an
  // array a TypeError. Five ways out of a function that promised none. Measured, all five.
  //
  // A caller expecting { ok:false, reason } gets an exception instead and the reason is
  // lost — which is worse than a wrong reason, because there is nothing to log.
  const addr = (v, what) => {
    if (typeof v !== 'string') return null;
    try {
      return getAddress(v);
    } catch {
      return null;
    }
  };
  const big = (v) => {
    if (v === undefined || v === null || v === '' || typeof v === 'boolean') return null;
    try {
      return BigInt(v);
    } catch {
      return null;
    }
  };

  // 🔴 A RANGE, NOT A LIST OF BAD VALUES — and the sixth way out of a function that
  // promises none. Every numeric field was converted and then never bounded: a NEGATIVE
  // amount came back { ok: true } and viem refused one frame below with
  // IntegerOutOfRangeError. No signature is ever built, so nothing is exploitable — and
  // that is precisely why it would have stayed: the only symptom is a gate that says yes
  // and a refusal whose name is lost where nobody can log it.
  //
  // Measured before this fix, and WIDER than it was reported: amount, expiration, nonce
  // AND sigDeadline all returned { ok: true } at -1. Four fields, so the guard is each
  // field's declared ABI width rather than a `< 0n` test bolted onto the one that was
  // noticed. Listing paths protects a list; bounding the field protects the property.
  const ranged = (v, what, max) =>
    v === null ? `${what} is not an integer`
      : v < 0n ? `${what} is negative (${v}) and the field is unsigned`
        : v > max ? `${what} is ${v}, which does not fit its declared width`
          : null;

  const amount = big(details.amount);
  let bad = ranged(amount, 'amount', UINT160_MAX);
  if (bad) return { ok: false, reason: 'bad_request', detail: bad };

  // Checked here and NOT only under their policy caps: an owner who set no
  // maxExpiration still must not get a digest built from a field that cannot hold the
  // value. The cap is a policy question, the width is an arithmetic one.
  const expiration = big(details.expiration);
  bad = ranged(expiration, 'expiration', UINT48_MAX);
  if (bad) return { ok: false, reason: 'bad_request', detail: bad };
  const nonce = big(details.nonce);
  bad = ranged(nonce, 'nonce', UINT48_MAX);
  if (bad) return { ok: false, reason: 'bad_request', detail: bad };
  const deadline = big(sigDeadline);
  bad = ranged(deadline, 'sigDeadline', UINT256_MAX);
  if (bad) return { ok: false, reason: 'bad_request', detail: bad };

  // Refused regardless of the cap: an owner with a huge ceiling must not silently
  // lose this guarantee.
  if (amount === UINT160_MAX) {
    return { ok: false, reason: 'infinite_allowance_refused' };
  }
  const maxAmount = big(policy.maxAmount);
  if (maxAmount === null) return { ok: false, reason: 'policy_required', detail: 'maxAmount is not an integer' };
  if (amount > maxAmount) return { ok: false, reason: 'amount_over_cap' };

  const token = addr(details.token);
  if (token === null) return { ok: false, reason: 'bad_request', detail: 'details.token is not an address' };
  const spenderAddr = addr(spender);
  if (spenderAddr === null) return { ok: false, reason: 'bad_request', detail: 'spender is not an address' };

  // A policy list that is present but not a list is an incomplete configuration, not a
  // denial — the same split as a missing list above.
  if (!Array.isArray(policy.allowedTokens)) return { ok: false, reason: 'policy_required', detail: 'allowedTokens is not a list' };
  if (!Array.isArray(policy.allowedSpenders)) return { ok: false, reason: 'policy_required', detail: 'allowedSpenders is not a list' };

  const allowedTokens = [];
  for (const a of policy.allowedTokens) {
    const x = addr(a);
    if (x === null) return { ok: false, reason: 'policy_required', detail: `allowedTokens contains a non-address: ${String(a)}` };
    allowedTokens.push(x);
  }
  if (!allowedTokens.includes(token)) return { ok: false, reason: 'token_not_allowed' };

  const allowedSpenders = [];
  for (const a of policy.allowedSpenders) {
    const x = addr(a);
    if (x === null) return { ok: false, reason: 'policy_required', detail: `allowedSpenders contains a non-address: ${String(a)}` };
    allowedSpenders.push(x);
  }
  if (!allowedSpenders.includes(spenderAddr)) return { ok: false, reason: 'spender_not_allowed' };

  // The values are already converted and bounded above; only the caps are read here.
  if (policy.maxExpiration !== undefined) {
    const cap = big(policy.maxExpiration);
    if (cap === null) return { ok: false, reason: 'policy_required', detail: 'maxExpiration is not an integer' };
    if (expiration > cap) return { ok: false, reason: 'expiration_over_cap' };
  }
  if (policy.maxSigDeadline !== undefined) {
    const cap = big(policy.maxSigDeadline);
    if (cap === null) return { ok: false, reason: 'policy_required', detail: 'maxSigDeadline is not an integer' };
    if (deadline > cap) return { ok: false, reason: 'sig_deadline_over_cap' };
  }
  return { ok: true };
}
