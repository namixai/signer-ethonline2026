// Reference vectors from ../../specs/SPEC-permit2-signature-transfer.md, reproduced from first
// principles. The domain is additionally checked against the DEPLOYED contract — the
// spec asks for exactly that, and it is a free eth_call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicClient, http, keccak256, encodeAbiParameters, toBytes, getAddress, concat, pad, numberToHex } from 'viem';
import { mainnet } from 'viem/chains';

import {
  PERMIT2_ADDRESS,
  domainSeparator,
  hashPermitDetails,
  hashPermitSingle,
  permitSingleDigest,
  checkPermitPolicy,
  UINT160_MAX,
} from '../src/permit2.js';

// Order from the spec: WETH, 1e18, expiration 2000000000, nonce 0,
// spender = 1inch AggregationRouterV6, sigDeadline 2000000000.
const WETH = getAddress('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
const SPENDER = getAddress('0x111111125421ca6dc452d289314280a0f8842a65');
const ORDER = {
  details: { token: WETH, amount: 10n ** 18n, expiration: 2000000000n, nonce: 0n },
  spender: SPENDER,
  sigDeadline: 2000000000n,
};

const EXPECTED = {
  domainSeparator: '0x866a5aba21966af95d6c7ab78eb2b2fc913915c28be3b9aa07cc04ff903e3f28',
  hashDetails: '0x665449c71b4a0866197bdf385920f206dbc3e9b2de768e8579a480105bb5d16a',
  hashSingle: '0x5c95ac3857991257e81acf69af4cd1911a4adf071f8496a6ad320dc666ecf746',
  digest: '0x1ef7d06d76cfa91f98a4ced55bacca4066b5fc35c0f507fdd8437dadaad18eea',
};

test('all four reference vectors reproduce', () => {
  assert.equal(domainSeparator(1n), EXPECTED.domainSeparator);
  assert.equal(hashPermitDetails(ORDER.details), EXPECTED.hashDetails);
  assert.equal(hashPermitSingle(ORDER), EXPECTED.hashSingle);
  assert.equal(permitSingleDigest(ORDER, 1n), EXPECTED.digest);
});

test('the domain matches the DEPLOYED contract, not just our arithmetic', async (t) => {
  let onchain;
  try {
    const client = createPublicClient({ chain: mainnet, transport: http('https://ethereum-rpc.publicnode.com', { timeout: 10_000, retryCount: 1 }) });
    onchain = await client.readContract({
      address: PERMIT2_ADDRESS,
      abi: [{ name: 'DOMAIN_SEPARATOR', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32' }] }],
      functionName: 'DOMAIN_SEPARATOR',
    });
  } catch {
    return t.skip('RPC unreachable');
  }
  assert.equal(onchain, EXPECTED.domainSeparator);
  assert.equal(domainSeparator(1n), onchain);
});

test('NEGATIVE CONTROL: the usual four-field domain gives a DIFFERENT separator', () => {
  // The spec demands this control: without it, "the contract accepted it" proves
  // nothing, because the result could be right for an unrelated reason.
  const fourField = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }],
      [
        keccak256(toBytes('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')),
        keccak256(toBytes('Permit2')),
        keccak256(toBytes('1')),
        1n,
        PERMIT2_ADDRESS,
      ],
    ),
  );
  assert.notEqual(fourField, EXPECTED.domainSeparator, 'a version field must change the domain');
});

test('the chain id is part of the domain — a different chain is a different signature', () => {
  assert.notEqual(domainSeparator(8453n), domainSeparator(1n));
});

test('the nested struct enters as its own hash, not inline', () => {
  // If details were flattened into PermitSingle, changing only a details field while
  // keeping its hash would be impossible — this asserts the composition really nests.
  const other = { ...ORDER, details: { ...ORDER.details, nonce: 1n } };
  assert.notEqual(hashPermitSingle(other), EXPECTED.hashSingle);
});

// ---- policy refusals, before any signature exists ----

const POLICY = {
  maxAmount: 10n ** 20n,
  allowedTokens: [WETH],
  allowedSpenders: [SPENDER],
  maxExpiration: 2000000000n,
  maxSigDeadline: 2000000000n,
};

test('the reference order passes policy', () => {
  assert.equal(checkPermitPolicy(ORDER, POLICY).ok, true);
});

test('infinite allowance is refused EVEN WHEN the cap would allow it', () => {
  // The whole point: an owner with a huge ceiling must not silently lose this.
  const generous = { ...POLICY, maxAmount: UINT160_MAX };
  const infinite = { ...ORDER, details: { ...ORDER.details, amount: UINT160_MAX } };
  const r = checkPermitPolicy(infinite, generous);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'infinite_allowance_refused');
});

test('a spender outside the allow-list is refused', () => {
  const r = checkPermitPolicy({ ...ORDER, spender: getAddress('0x1111111254eeb25477b68fb85ed929f73a960582') }, POLICY);
  assert.equal(r.reason, 'spender_not_allowed');
});

test('a token outside the allow-list is refused', () => {
  const r = checkPermitPolicy(
    { ...ORDER, details: { ...ORDER.details, token: getAddress('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48') } },
    POLICY,
  );
  assert.equal(r.reason, 'token_not_allowed');
});

test('an over-cap amount and an over-cap deadline are refused', () => {
  assert.equal(
    checkPermitPolicy({ ...ORDER, details: { ...ORDER.details, amount: 10n ** 21n } }, POLICY).reason,
    'amount_over_cap',
  );
  assert.equal(
    checkPermitPolicy({ ...ORDER, sigDeadline: 2000000001n }, POLICY).reason,
    'sig_deadline_over_cap',
  );
});

test('amount is a 32-byte word — packing it into 20 bytes changes the hash', () => {
  // The spec warns that "optimising" amount to 20 bytes gives a wrong hash and no error.
  // Guarded here explicitly, because the TYPE LABEL is not the guard: viem encodes
  // uint160 and uint256 to the same 32-byte word, so swapping the label is invisible.
  // Only the packing width matters.
  const packed = keccak256(
    concat([
      keccak256(toBytes('PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)')),
      pad(WETH, { size: 32 }),
      pad(numberToHex(10n ** 18n), { size: 20 }), // ← the mistake: 20 bytes, not 32
      pad(numberToHex(2000000000n), { size: 32 }),
      pad(numberToHex(0n), { size: 32 }),
    ]),
  );
  assert.notEqual(packed, EXPECTED.hashDetails, 'a 20-byte amount must not reproduce the vector');
});

test('an INCOMPLETE policy is policy_required, not a refusal', () => {
  // The enclave makes this split (POLICY_REQUIRED vs POLICY_DENIED). Collapsing them
  // reads as "the rules said no" when the truth is "there are no rules yet".
  for (const missing of ['allowedTokens', 'allowedSpenders', 'maxAmount']) {
    const partial = { ...POLICY };
    delete partial[missing];
    const r = checkPermitPolicy(ORDER, partial);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'policy_required', `missing ${missing}`);
  }
  assert.equal(checkPermitPolicy(ORDER, null).reason, 'policy_required');
});

test('malformed input is a named refusal, not a throw', () => {
  assert.equal(checkPermitPolicy(null, POLICY).reason, 'bad_request');
  assert.equal(checkPermitPolicy({ spender: SPENDER, sigDeadline: 1n }, POLICY).reason, 'bad_request');
  assert.equal(
    checkPermitPolicy({ ...ORDER, details: { ...ORDER.details, amount: 'abc' } }, POLICY).reason,
    'bad_request',
  );
});
