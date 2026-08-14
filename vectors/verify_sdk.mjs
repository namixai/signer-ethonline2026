// Path B — recompute the same digests with code we did not write.
//
//   node verify_sdk.mjs
//
// Two independent encoders run here, and they check different things:
//
//   @uniswap/permit2-sdk  supplies its OWN type definitions. If we misread a field
//                         order, a width, or a type name out of PermitHash.sol, this
//                         is what catches it — we are not feeding it our reading.
//   viem                  is given our types but encodes them with its own engine.
//                         This catches an encoder bug in path A that a shared
//                         misreading would hide.
//
// A disagreement between any two of the three is a finding. It is not resolved by
// picking the majority — it is resolved by going back to the contract.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "@uniswap/permit2-sdk";
import { hashTypedData } from "viem";

const { AllowanceTransfer, SignatureTransfer } = pkg;
const HERE = dirname(fileURLToPath(import.meta.url));
const doc = JSON.parse(readFileSync(join(HERE, "permit2-vectors.json"), "utf8"));
const PERMIT2 = doc.permit2Address;

// --- types for viem. Transcribed from PermitHash.sol, same source as path A. ---
const T_PERMIT_DETAILS = [
  { name: "token", type: "address" },
  { name: "amount", type: "uint160" },
  { name: "expiration", type: "uint48" },
  { name: "nonce", type: "uint48" },
];
const T_TOKEN_PERMISSIONS = [
  { name: "token", type: "address" },
  { name: "amount", type: "uint256" },
];
const T_SWAP_INTENT = [
  { name: "recipient", type: "address" },
  { name: "tokenOut", type: "address" },
  { name: "minAmountOut", type: "uint256" },
];

// Permit2's domain is three fields. Omitting `version` is the point, not an oversight.
const domainFor = (chainId) => ({ name: "Permit2", chainId, verifyingContract: PERMIT2 });

function viemHash(c) {
  const domain = domainFor(c.chainId);
  const m = c.message;
  switch (c.kind) {
    case "PermitSingle":
      return hashTypedData({
        domain,
        primaryType: "PermitSingle",
        types: {
          PermitDetails: T_PERMIT_DETAILS,
          PermitSingle: [
            { name: "details", type: "PermitDetails" },
            { name: "spender", type: "address" },
            { name: "sigDeadline", type: "uint256" },
          ],
        },
        message: bigintify(m),
      });
    case "PermitBatch":
      return hashTypedData({
        domain,
        primaryType: "PermitBatch",
        types: {
          PermitDetails: T_PERMIT_DETAILS,
          PermitBatch: [
            { name: "details", type: "PermitDetails[]" },
            { name: "spender", type: "address" },
            { name: "sigDeadline", type: "uint256" },
          ],
        },
        message: bigintify(m),
      });
    case "PermitTransferFrom":
      return hashTypedData({
        domain,
        primaryType: "PermitTransferFrom",
        types: {
          TokenPermissions: T_TOKEN_PERMISSIONS,
          PermitTransferFrom: [
            { name: "permitted", type: "TokenPermissions" },
            { name: "spender", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        message: bigintify({ ...m, spender: c.spender }),
      });
    case "PermitBatchTransferFrom":
      return hashTypedData({
        domain,
        primaryType: "PermitBatchTransferFrom",
        types: {
          TokenPermissions: T_TOKEN_PERMISSIONS,
          PermitBatchTransferFrom: [
            { name: "permitted", type: "TokenPermissions[]" },
            { name: "spender", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        message: bigintify({ ...m, spender: c.spender }),
      });
    case "PermitWitnessTransferFrom":
      return hashTypedData({
        domain,
        primaryType: "PermitWitnessTransferFrom",
        types: {
          TokenPermissions: T_TOKEN_PERMISSIONS,
          SwapIntent: T_SWAP_INTENT,
          PermitWitnessTransferFrom: [
            { name: "permitted", type: "TokenPermissions" },
            { name: "spender", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
            { name: "witness", type: "SwapIntent" },
          ],
        },
        message: bigintify({ ...m, spender: c.spender, witness: c.witness }),
      });
    case "PermitBatchWitnessTransferFrom":
      return hashTypedData({
        domain,
        primaryType: "PermitBatchWitnessTransferFrom",
        types: {
          TokenPermissions: T_TOKEN_PERMISSIONS,
          SwapIntent: T_SWAP_INTENT,
          PermitBatchWitnessTransferFrom: [
            { name: "permitted", type: "TokenPermissions[]" },
            { name: "spender", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
            { name: "witness", type: "SwapIntent" },
          ],
        },
        message: bigintify({ ...m, spender: c.spender, witness: c.witness }),
      });
    default:
      throw new Error(`unknown kind ${c.kind}`);
  }
}

function sdkHash(c) {
  const m = c.message;
  switch (c.kind) {
    case "PermitSingle":
    case "PermitBatch":
      return AllowanceTransfer.hash(m, PERMIT2, c.chainId);
    case "PermitTransferFrom":
    case "PermitBatchTransferFrom":
      // The SDK's own interface carries `spender` even though the Solidity struct
      // does not — same substitution the contract makes with msg.sender.
      return SignatureTransfer.hash({ ...m, spender: c.spender }, PERMIT2, c.chainId);
    case "PermitWitnessTransferFrom":
    case "PermitBatchWitnessTransferFrom":
      return SignatureTransfer.hash({ ...m, spender: c.spender }, PERMIT2, c.chainId, {
        witness: c.witness,
        witnessTypeName: "SwapIntent",
        witnessType: { SwapIntent: T_SWAP_INTENT },
      });
    default:
      throw new Error(`unknown kind ${c.kind}`);
  }
}

// JSON gives us Numbers; anything above 2^53 has already lost precision by the time
// it reaches here, so the vector file keeps large values as decimal strings where it
// matters and we widen everything to BigInt before encoding.
function bigintify(v) {
  if (Array.isArray(v)) return v.map(bigintify);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, bigintify(x)]));
  }
  if (typeof v === "number") return BigInt(v);
  if (typeof v === "string" && /^\d+$/.test(v)) return BigInt(v);
  return v;
}

let bad = 0;
for (const c of doc.cases) {
  const pinned = c.expected.digest;
  const fromSdk = sdkHash(c);
  const fromViem = viemHash(c);
  const okSdk = fromSdk.toLowerCase() === pinned.toLowerCase();
  const okViem = fromViem.toLowerCase() === pinned.toLowerCase();
  if (okSdk && okViem) {
    console.log(`ok   ${c.id}`);
  } else {
    bad++;
    console.log(`FAIL ${c.id}`);
    console.log(`     pinned (path A) ${pinned}`);
    if (!okSdk) console.log(`     permit2-sdk     ${fromSdk}   <-- differs`);
    if (!okViem) console.log(`     viem            ${fromViem}   <-- differs`);
  }
}

// The SDK also tells us what domain it thinks Permit2 uses. If it ever grows a
// `version` field, the digests above would still match each other and be wrong.
const d = AllowanceTransfer.getPermitData(doc.cases[0].message, PERMIT2, 1).domain;
const domainKeys = Object.keys(d).sort().join(",");
if (domainKeys !== "chainId,name,verifyingContract") {
  bad++;
  console.log(`FAIL domain shape: permit2-sdk reports [${domainKeys}], expected 3 fields without version`);
} else {
  console.log(`ok   domain shape (permit2-sdk): ${domainKeys}`);
}

if (bad) {
  console.log(`\nFAIL — ${bad} divergence(s) between path A and path B. Go back to the contract.`);
  process.exit(1);
}
console.log(`\nOK — path B (permit2-sdk + viem) reproduced all ${doc.cases.length} digests.`);
