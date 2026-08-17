// Path B for the position-NFT permits — viem's encoder, not ours.
//
//   node verify_nft_sdk.mjs
//
// Honest note on how independent this is, because it is less independent than the
// Permit2 set and saying so is the point of the exercise.
//
// For Permit2 there is @uniswap/permit2-sdk, which ships its OWN type definitions, so it
// can catch us misreading PermitHash.sol. There is no equivalent published SDK for these
// two permits, so viem is given the types WE read out of the sources. viem therefore
// checks our encoder, not our reading.
//
// The reading is checked by something better instead: every case pins the domain
// separator that the DEPLOYED contract reports, and verify_nft_ours.py compares against
// it. The domain is exactly where the v3/v4 difference lives, so the part of our reading
// most likely to be wrong is the part anchored on chain rather than on our own opinion.
//
// What remains unverified by either: the field ORDER inside the struct. Both paths take
// it from the same reading of the same type string. The type hash is pinned on chain for
// v3 (PERMIT_TYPEHASH() is a public getter and matches), which fixes the type string but
// not the order in which we concatenate values under it. Stated in the spec as a gap.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashTypedData } from "viem";

const HERE = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(join(HERE, "nft-permit-vectors.json"), "utf8"));

const T_PERMIT = [
  { name: "spender", type: "address" },
  { name: "tokenId", type: "uint256" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint256" },
];
const T_PERMIT_FOR_ALL = [
  { name: "operator", type: "address" },
  { name: "approved", type: "bool" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint256" },
];

function domainOf(c) {
  // viem emits a `version` field into the domain type only when the key is present, which
  // is exactly the v3/v4 difference — so the shape is carried by the object, not a flag.
  const base = {
    name: c.domain.name,
    chainId: c.chainId,
    verifyingContract: c.verifyingContract,
  };
  return c.domain.version === undefined ? base : { ...base, version: c.domain.version };
}

function big(v) {
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  if (typeof v === "number") return BigInt(v);
  return v;
}

function viemDigest(c) {
  const m = c.message;
  if (c.kind === "V3Permit" || c.kind === "V4Permit") {
    return hashTypedData({
      domain: domainOf(c),
      primaryType: "Permit",
      types: { Permit: T_PERMIT },
      message: {
        spender: m.spender,
        tokenId: big(m.tokenId),
        nonce: big(m.nonce),
        deadline: big(m.deadline),
      },
    });
  }
  if (c.kind === "V4PermitForAll") {
    return hashTypedData({
      domain: domainOf(c),
      primaryType: "PermitForAll",
      types: { PermitForAll: T_PERMIT_FOR_ALL },
      message: {
        operator: m.operator,
        approved: m.approved === "true" || m.approved === true,
        nonce: big(m.nonce),
        deadline: big(m.deadline),
      },
    });
  }
  throw new Error(`unknown kind ${c.kind}`);
}

let bad = 0;
for (const c of doc.cases) {
  const got = viemDigest(c);
  if (got.toLowerCase() === c.expected.digest.toLowerCase()) {
    console.log(`ok   ${c.id}`);
  } else {
    bad++;
    console.log(`FAIL ${c.id}\n     pinned (path A) ${c.expected.digest}\n     viem            ${got}`);
  }
}

// The pair that carries the whole point of this file existing.
const v3 = doc.cases.find((c) => c.id === "v3-permit-mainnet-to-universalrouter");
const v4 = doc.cases.find((c) => c.id === "v4-permit-mainnet-same-message-as-v3");
if (v3 && v4) {
  const a = viemDigest(v3);
  const b = viemDigest(v4);
  if (a.toLowerCase() === b.toLowerCase()) {
    bad++;
    console.log("FAIL viem agrees the v3 and v4 digests are equal — they must not be");
  } else {
    console.log("ok   viem also separates the v3 and v4 digests for an identical struct");
  }
}

if (bad) {
  console.log(`\nFAIL — ${bad} divergence(s) between path A and viem.`);
  process.exit(1);
}
console.log(`\nOK — path B (viem) reproduced all ${doc.cases.length} position-NFT digests.`);
