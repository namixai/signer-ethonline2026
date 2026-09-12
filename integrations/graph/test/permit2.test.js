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

// ---- the named-refusal contract, enforced on EVERY field rather than one ----

test('🔴 no malformed field escapes as an exception — the contract said so, one field kept it', () => {
  // Measured before the fix: a missing token threw InvalidAddressError, a missing spender
  // the same, an undefined sigDeadline a TypeError, a non-integer expiration a SyntaxError,
  // and a non-array policy list a TypeError. Five ways out of a function that promised none.
  // A caller expecting { ok:false, reason } got an exception and the reason was lost.
  const P = {
    allowedTokens: ['0x1111111111111111111111111111111111111111'],
    allowedSpenders: ['0x2222222222222222222222222222222222222222'],
    maxAmount: 1000n, maxExpiration: 9999999999n, maxSigDeadline: 9999999999n,
  };
  const O = {
    details: { token: '0x1111111111111111111111111111111111111111', amount: 1n, expiration: 1n, nonce: 0n },
    spender: '0x2222222222222222222222222222222222222222', sigDeadline: 1n,
  };
  const bad = [
    ['token missing', { ...O, details: { ...O.details, token: undefined } }, P],
    ['token malformed', { ...O, details: { ...O.details, token: 'not-an-address' } }, P],
    ['spender missing', { ...O, spender: undefined }, P],
    ['sigDeadline undefined', { ...O, sigDeadline: undefined }, P],
    ['expiration non-numeric', { ...O, details: { ...O.details, expiration: 'abc' } }, P],
    ['amount undefined', { ...O, details: { ...O.details, amount: undefined } }, P],
    ['allowedTokens not a list', O, { ...P, allowedTokens: 'nope' }],
    ['allowedSpenders not a list', O, { ...P, allowedSpenders: 42 }],
    ['allowedTokens holds junk', O, { ...P, allowedTokens: ['x'] }],
    ['maxAmount not numeric', O, { ...P, maxAmount: 'lots' }],
    ['maxExpiration not numeric', O, { ...P, maxExpiration: {} }],
  ];
  for (const [name, order, policy] of bad) {
    let r;
    assert.doesNotThrow(() => { r = checkPermitPolicy(order, policy); }, `${name} бросил вместо отказа`);
    assert.equal(r.ok, false, name);
    assert.ok(typeof r.reason === 'string' && r.reason !== '', `${name}: причина потеряна`);
  }
  // and the honest order still passes
  assert.deepEqual(checkPermitPolicy(O, P), { ok: true });
});

// 🔴 Шестой путь наружу через исключение, и он был ЦЕЛЫМ КЛАССОМ, а не одним полем.
// Замер до правки: amount, expiration, nonce и sigDeadline — все четыре возвращали
// { ok: true } на -1, а viem отказывал кадром ниже IntegerOutOfRangeError. Подписи бы
// не вышло, так что не эксплуатируется; именно поэтому и осталось бы — единственный
// симптом это гейт, сказавший «да», и имя отказа, потерянное там, где его не залогируешь.
//
// Проверка привязана к ШИРИНЕ ПОЛЯ, а не к списку плохих значений: список защищает
// список, граница защищает свойство.
test('numeric fields are bounded by their declared ABI width, both ends', () => {
  const P = {
    allowedTokens: ['0x1111111111111111111111111111111111111111'],
    allowedSpenders: ['0x2222222222222222222222222222222222222222'],
    // Потолки подняты до максимумов полей: иначе граничное значение упрётся в
    // ПОЛИТИКУ и тест измерит не диапазон, а лимит, который сам же и задал.
    maxAmount: (1n << 160n) - 1n,
    maxExpiration: (1n << 48n) - 1n,
    maxSigDeadline: (1n << 256n) - 1n,
  };
  const O = {
    details: { token: '0x1111111111111111111111111111111111111111', amount: 1n, expiration: 1n, nonce: 0n },
    spender: '0x2222222222222222222222222222222222222222', sigDeadline: 1n,
  };
  const U48 = (1n << 48n) - 1n;
  const U160 = (1n << 160n) - 1n;
  const U256 = (1n << 256n) - 1n;
  const withDetail = (k, v) => ({ ...O, details: { ...O.details, [k]: v } });

  const outOfRange = [
    ['amount -1', withDetail('amount', -1n)],
    ['amount 2^160', withDetail('amount', U160 + 1n)],
    ['expiration -1', withDetail('expiration', -1n)],
    ['expiration 2^48', withDetail('expiration', U48 + 1n)],
    ['nonce -1', withDetail('nonce', -1n)],
    ['nonce 2^48', withDetail('nonce', U48 + 1n)],
    ['sigDeadline -1', { ...O, sigDeadline: -1n }],
    ['sigDeadline 2^256', { ...O, sigDeadline: U256 + 1n }],
  ];
  for (const [name, order] of outOfRange) {
    const r = checkPermitPolicy(order, P);
    assert.equal(r.ok, false, `${name}: гейт сказал «да» значению вне диапазона поля`);
    assert.equal(r.reason, 'bad_request', name);
    assert.ok(/negative|declared width/.test(r.detail ?? ''), `${name}: причина не названа`);
  }

  // Границы, которые обязаны ПРОХОДИТЬ — иначе правка просто запрещает всё подряд.
  assert.equal(checkPermitPolicy(withDetail('amount', 0n), P).ok, true, 'amount 0');
  assert.equal(checkPermitPolicy(withDetail('expiration', U48), P).ok, true, 'expiration = uint48 max');
  assert.equal(checkPermitPolicy(withDetail('nonce', U48), P).ok, true, 'nonce = uint48 max');
  assert.equal(checkPermitPolicy({ ...O, sigDeadline: U256 }, P).ok, true, 'sigDeadline = uint256 max');
  // ...а бесконечный allowance остаётся ОТДЕЛЬНЫМ отказом, не «вне диапазона»:
  // владелец с высоким потолком не должен молча потерять эту гарантию.
  assert.equal(checkPermitPolicy(withDetail('amount', U160), P).reason, 'infinite_allowance_refused');
});

// Свойство, а не перечень: ВСЁ, что гейт пропустил, обязано собраться в дайджест без
// исключения. Это привязывает гейт к самой библиотеке, а не к списку случаев, который
// я придумал, — если viem завтра ужесточит диапазон, тест покраснеет сам.
test('anything the gate accepts builds a digest without throwing', () => {
  const P = {
    allowedTokens: ['0x1111111111111111111111111111111111111111'],
    allowedSpenders: ['0x2222222222222222222222222222222222222222'],
    maxAmount: (1n << 160n) - 1n, maxExpiration: (1n << 48n) - 1n, maxSigDeadline: (1n << 256n) - 1n,
  };
  const base = {
    details: { token: '0x1111111111111111111111111111111111111111', amount: 1n, expiration: 1n, nonce: 0n },
    spender: '0x2222222222222222222222222222222222222222', sigDeadline: 1n,
  };
  const U48 = (1n << 48n) - 1n, U160 = (1n << 160n) - 1n, U256 = (1n << 256n) - 1n;
  const values = [-1n, 0n, 1n, U48, U48 + 1n, U160 - 1n, U160, U160 + 1n, U256, U256 + 1n];
  let accepted = 0;
  for (const field of ['amount', 'expiration', 'nonce']) {
    for (const v of values) {
      const order = { ...base, details: { ...base.details, [field]: v } };
      if (!checkPermitPolicy(order, P).ok) continue;
      accepted += 1;
      assert.doesNotThrow(() => permitSingleDigest(order, 1n),
        `гейт пропустил ${field}=${v}, а дайджест на нём бросает`);
    }
  }
  for (const v of values) {
    const order = { ...base, sigDeadline: v };
    if (!checkPermitPolicy(order, P).ok) continue;
    accepted += 1;
    assert.doesNotThrow(() => permitSingleDigest(order, 1n),
      `гейт пропустил sigDeadline=${v}, а дайджест на нём бросает`);
  }
  // Растяжка на сам тест: если гейт начнёт отказывать ВСЕМУ, цикл выше станет пустым и
  // молча зелёным — ровно та тишина, которую мы и ловим.
  assert.ok(accepted >= 12, `принятых значений всего ${accepted} — проверять было нечего`);
});
