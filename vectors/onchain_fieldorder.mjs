// The field-order check that neither offline path can make.
//
//   node onchain_fieldorder.mjs        # needs network; read-only eth_call, no key on chain
//
// WHY THIS FILE EXISTS
//
// Both offline paths take the ORDER of fields inside a struct from the same reading of the
// same type string. If we concatenated `nonce` before `tokenId`, both paths would agree and
// both would be wrong. The type hash does not help: it is a hash of the type *string*, and
// the string is right — it is our concatenation that would be wrong. Nothing in the vector
// set could tell.
//
// This is not hypothetical. On 2026-08-15 a live Hyperliquid order was rejected for exactly
// this: the field order inside the signed action differed from canonical (`s` placed before
// `r`), the venue rebuilt the payload its own way, the digest moved, and recovery returned
// a different address. Valid signature, wrong bytes, no useful error.
//
// So we let the contract decide. Permit2 recovers a signer from ITS OWN digest and compares
// it to the claimed owner. If our field order were wrong, its digest would differ from ours,
// recovery would land on some other address, and it would revert InvalidSigner. Success is
// therefore the contract agreeing, byte for byte, with our concatenation order.
//
// Read-only throughout: eth_call simulates, nothing is broadcast, nothing is spent. The key
// below is derived deterministically from a fixed string so anyone re-running this gets the
// same address; it holds nothing and signs nothing but this probe.
//
// 🔴 It is NOT Anvil's account #0, and the reason is a finding worth keeping. That address
// has an EIP-7702 delegation on mainnet (its code is 0xef0100…), so `claimedSigner.code.length`
// is non-zero and Permit2 takes the ERC-1271 branch instead of ecrecover: it asks the
// delegate's isValidSignature, and the delegate there reverts with no data.
//
// Precisely: the signature is not left unchecked — the check is REDIRECTED. What happens to
// an ordinary ECDSA signature then depends entirely on the delegate's code, and in this case
// it is discarded without ever being recovered. Any owner carrying a 7702 delegation behaves
// the same way, which is a live consideration for a signer: which verification path our
// signature meets is chain state we do not control and cannot see from inside the enclave.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { sign } from "viem/accounts";
import { encodeFunctionData, isHex } from "viem";

const HERE = dirname(fileURLToPath(import.meta.url));
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const RPC = process.env.ETH_RPC || "https://ethereum-rpc.publicnode.com";

// keccak256("usenami signer field-order probe v1")
const TEST_KEY = "0x5f4ebac922c0bbca4e617a6a9150a1566ed0e03c38db025a6b18e1898e430088";
const TEST_ADDR = "0x4562dF20Ed53fc0B013A5cFFd00df30648145fA4";

const INVALID_SIGNER = "0x815e1d64"; // SignatureVerification.InvalidSigner()

// --- our own digest, via path A (python, standard library only) ----------------
// Deliberately shelling out to path A rather than recomputing here: the whole point is
// to test OUR encoder against the chain, not to test a second JavaScript one.
function ourDigest(details, spender, sigDeadline, swap) {
  const args = [
    join(HERE, "digest_permit_single.py"),
    "--token", details.token,
    "--amount", details.amount,
    "--expiration", details.expiration,
    "--nonce", details.nonce,
    "--spender", spender,
    "--sig-deadline", sigDeadline,
    "--chain-id", "1",
  ];
  if (swap) args.push("--swap", swap);
  const r = spawnSync("python3", args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`path A failed: ${r.stderr || r.stdout}`);
  const out = r.stdout.trim();
  if (!isHex(out) || out.length !== 66) throw new Error(`path A returned ${out}`);
  return out;
}

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

// Permit2.allowance(owner, token, spender) -> (uint160 amount, uint48 expiration, uint48 nonce)
async function currentNonce(owner, token, spender) {
  const data = encodeFunctionData({
    abi: [{
      name: "allowance", type: "function", stateMutability: "view",
      inputs: [{ type: "address" }, { type: "address" }, { type: "address" }],
      outputs: [{ type: "uint160" }, { type: "uint48" }, { type: "uint48" }],
    }],
    functionName: "allowance",
    args: [owner, token, spender],
  });
  const r = await rpc("eth_call", [{ to: PERMIT2, data }, "latest"]);
  if (r.error) throw new Error(`allowance() failed: ${JSON.stringify(r.error)}`);
  // third word is the nonce
  return BigInt("0x" + r.result.slice(2).slice(128, 192)).toString();
}

// permit(address owner, PermitSingle permitSingle, bytes signature)
function permitCalldata(owner, details, spender, sigDeadline, signature) {
  return encodeFunctionData({
    abi: [{
      name: "permit", type: "function", stateMutability: "nonpayable",
      inputs: [
        { type: "address", name: "owner" },
        {
          type: "tuple", name: "permitSingle",
          components: [
            {
              type: "tuple", name: "details",
              components: [
                { type: "address", name: "token" },
                { type: "uint160", name: "amount" },
                { type: "uint48", name: "expiration" },
                { type: "uint48", name: "nonce" },
              ],
            },
            { type: "address", name: "spender" },
            { type: "uint256", name: "sigDeadline" },
          ],
        },
        { type: "bytes", name: "signature" },
      ],
      outputs: [],
    }],
    functionName: "permit",
    args: [
      owner,
      [[details.token, BigInt(details.amount), Number(details.expiration), Number(details.nonce)],
       spender, BigInt(sigDeadline)],
      signature,
    ],
  });
}

const sigToBytes = (s) =>
  ("0x" + s.r.slice(2) + s.s.slice(2) + (s.v ?? (27n + BigInt(s.yParity ?? 0))).toString(16).padStart(2, "0"));

async function main() {
  const token = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"; // WETH
  const spender = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af"; // UniversalRouter, chain 1
  const sigDeadline = "2000000000";

  // If the probe address ever acquires code — a 7702 delegation is enough — Permit2 stops
  // using ecrecover and this whole check stops testing what it claims to test. Fail loudly
  // rather than report a green that means something else.
  const code = await rpc("eth_getCode", [TEST_ADDR, "latest"]);
  if (code.result && code.result !== "0x") {
    console.log(`FAIL probe address ${TEST_ADDR} has code (${code.result.slice(0, 12)}…).`);
    console.log("     Permit2 would redirect to the ERC-1271 branch and never reach ecrecover;");
    console.log("     this check would be measuring the delegate, not our field order.");
    process.exit(1);
  }

  // The nonce is chain state, so read it rather than guess. A stale one would fail the
  // check for a reason unrelated to field order — the kind of false red that teaches
  // people to ignore a check.
  const nonce = await currentNonce(TEST_ADDR, token, spender);
  const details = { token, amount: "1000000000000000000", expiration: "2000000000", nonce };
  console.log(`owner ${TEST_ADDR}  on-chain nonce for (owner,token,spender) = ${nonce}`);

  let bad = 0;

  // --- POSITIVE: our concatenation order, judged by the contract -----------------
  const good = ourDigest(details, spender, sigDeadline, null);
  const goodSig = sigToBytes(await sign({ hash: good, privateKey: TEST_KEY }));
  const r1 = await rpc("eth_call", [
    { from: TEST_ADDR, to: PERMIT2, data: permitCalldata(TEST_ADDR, details, spender, sigDeadline, goodSig) },
    "latest",
  ]);
  if (r1.error) {
    bad++;
    console.log(`FAIL positive: contract rejected our digest\n     ${good}\n     ${JSON.stringify(r1.error)}`);
    if (JSON.stringify(r1.error).includes(INVALID_SIGNER)) {
      console.log("     InvalidSigner -> the contract's digest differs from ours. FIELD ORDER IS WRONG.");
    }
  } else {
    console.log(`ok   positive: Permit2 accepted a signature over our digest ${good}`);
    console.log("     the deployed contract rebuilt the same bytes we did — field order confirmed");
  }

  // --- NEGATIVE: swap two same-width fields, which no type check can see ----------
  // expiration and nonce are both uint48. Swapping them leaves the type string, the type
  // hash and every width untouched; only the order changes. This is the Hyperliquid defect
  // transplanted into Permit2.
  const swapped = ourDigest(details, spender, sigDeadline, "expiration-nonce");
  if (swapped === good) {
    bad++;
    console.log("FAIL negative: swapping expiration and nonce did not change the digest at all");
  } else {
    const badSig = sigToBytes(await sign({ hash: swapped, privateKey: TEST_KEY }));
    const r2 = await rpc("eth_call", [
      { from: TEST_ADDR, to: PERMIT2, data: permitCalldata(TEST_ADDR, details, spender, sigDeadline, badSig) },
      "latest",
    ]);
    const err = JSON.stringify(r2.error || {});
    if (r2.error && err.includes(INVALID_SIGNER)) {
      console.log(`ok   negative: mis-ordered digest ${swapped}`);
      console.log("     rejected with InvalidSigner — the check can go red, so the positive means something");
    } else if (r2.error) {
      // Any other revert, and any transport failure, proves nothing. Accepting them as a
      // pass would let a flaky RPC turn this whole file green without Permit2 ever having
      // recovered a signer — the exact defect this check exists to rule out, one layer up.
      bad++;
      console.log(`FAIL negative: rejected, but NOT with InvalidSigner (${err.slice(0, 140)})`);
      console.log("     the transposed digest has to fail through signer recovery, or this proves nothing");
    } else {
      bad++;
      console.log("FAIL negative: the contract ACCEPTED a mis-ordered digest. Something is very wrong.");
    }
  }

  console.log();
  if (bad) {
    console.log(`FAIL — ${bad} check(s) failed.`);
    process.exit(1);
  }
  console.log("OK — the deployed contract agrees with our field order, and disagrees when it is wrong.");
}

main().catch((e) => {
  console.error("error:", e.message);
  process.exit(2);
});
