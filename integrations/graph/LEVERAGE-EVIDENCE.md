# Standardized-schema leverage: the measurement, not the claim

**What is claimed:** the subgraph this package reads in production is a **Messari
Standardized Subgraph** on the `DEX AMM (Extended)` schema, so one query pattern spans
many deployments with **no code change**.

**How to re-run it:** `X402_PRIVATE_KEY=0x… npm run leverage`. The key is **required** to
reproduce the table below: every row is a paid query, $0.01 in USDC on Base. Without it the
script runs quote-only and says in its own output that this proves nothing about the data —
a fabricated subgraph id returns the same price challenge, measured.

---

## We did not pick it for the prize — we found out we were already on it

The id in `src/fetch.js` is byte-for-byte the one Messari's deployment registry lists for
`uniswap-v3-ethereum`:

```text
src/fetch.js:26          4cKy6QQMc5tpfdx8yxfYeb9TLZmgLQe44ddW1G7NwkA6
messari/subgraphs        uniswap-v3-ethereum  status=prod
  deployment/deployment.json → services.decentralized-network.query-id
```

The schema file `subgraphs/uniswap-v3-forks/schema.graphql` carries the header
`# Subgraph Schema: DEX AMM (Extended)` and differs from the root
`schema-dex-amm-extended.graphql` by 48 lines — one extra network enum value,
`_lastPricePool`, and one entity. The Graph's own documentation permits exactly this:
*"A standardized schema is a base contract, not a ceiling."*

Saying we chose it deliberately would be a nicer story and a false one.

## The measurement, 2026-09-07

The **identical** query string (`PRICE_QUERY`, sha256/16 `ed709e53c67b14bb`) sent to two
deployments of the same standardized schema, paid per query with x402 on Base:

| | `uniswap-v3-ethereum` | `uniswap-v3-base` |
|---|---|---|
| head block | 25 925 631 | 50 998 323 |
| `hasIndexingErrors` | false | false |
| top token / price | LCAI / 0.00128997925666313 | Surplus / 0.0000364488377219201 |
| attestation returned | yes | yes |
| **`requestCID`** | **`0x32edaff5…f76d9`** | **`0x32edaff5…f76d9`** |
| `responseCID` | `0xad87e53c…a068` | `0x12162dd5…5d14` |
| `subgraphDeploymentID` | `0xcd25cb3f…06b1` | `0xbb28c0aa…0c30` |
| payment tx (Base) | `0xa74788d0f8769bb6614d667e1635909dd3017c1dd183b26ccb24e999db337f1a` | `0xc7addaf5a488b6b4d11bb6328e3a03c53d20aff8ed2d8290b9eb275d3096f599` |

**The row that matters is `requestCID`.** Two chains, two deployments, two independent
indexers — and the same attested request digest, while `responseCID` and
`subgraphDeploymentID` differ as they must. The request bytes were identical, and the
parties saying so have no stake in our claim. Guard one ("we sent one string") is our own
word; this is not.

⚠️ We still cannot compute `requestCID` from the query — four plausible encodings failed to
reproduce a known value, and `attestation.js` refuses to claim a check it cannot perform.
Equality across deployments needs no preimage: it is a comparison, not a reconstruction.

## The same measurement again, five days later — 2026-09-12

The table above rests on one pair of paid queries from one afternoon. A claim that was
measured once and a claim that reproduces are different claims, so here is the second pair.

| | first pass | second pass |
|---|---|---|
| date | 2026-09-07 | 2026-09-12 |
| payer | `0x4dF34ec7…f81F` | `0xCf3E005a…5ba9` |
| payment txs (Base) | `0xa74788d0…37f1a`, `0xc7addaf5…96f599` | `0xaaf0bfd974d011fe48b541d489ddf24e28a65a60e53abd7facc4135a753e235a` (block 51 216 605), `0x2ebdb456bfb700fa36a3d4b58c41448f814917570ea9ea4f42b4366cbfd9a362` (block 51 216 606) |
| recipient | `0x79dc34e4…fccb` | `0x79dc34e4…fccb` — the same |
| price per query | $0.01 USDC | $0.01 USDC |

Every value in the second column was read off Base directly — the USDC `Transfer` logs for
those two blocks — rather than copied from a run's own output. Two adjacent blocks, one cent
each, to the gateway address the first pass paid.

⚠️ **What this does NOT show, said here because the obvious reading is wrong.** The two
payer addresses are different, and **both of them are ours**: the first is the agent wallet
this project has used for x402 all along, the second a wallet funded specifically for these
measurements. So this is the same route and the same price reproducing from a second
account of ours after five days — it is **not** an independent third party paying, and
nothing here should be read as one. A reader can confirm that for themselves from the
addresses above, which is the point of printing them.

⚠️ **The `requestCID` row is deliberately absent from the second column.** The digest
equality is the strongest line in the table above, and repeating it requires the
attestation artifacts from that second run, which are not in this repository. It is not
carried over on the strength of a matching price. When those artifacts are published, the
row can be filled in and checked; until then the second pass stands for the payment route
and the price, and for nothing about the digest.

## What became easier, concretely

- **Zero** lines changed between deployments: same query, same parser, same usability
  predicates, same snapshot assembly. Adding a chain is one entry in
  `STANDARDIZED_DEPLOYMENTS`.
- The zero-price guard in `usability.js` fired on the second deployment on its first live
  run — `1INCH`, `TSLAon`, `LUNA`, `rETH` and others came back `lastPriceUSD: "0"`. A guard
  written against one deployment held on another without being told about it, which is
  the practical shape of "standardized".

## What this does NOT show

- Nothing about **price** freshness. The table reports **head** age. Those are two
  different numbers and this package refuses to conflate them; see `usability.js`.
- Nothing about deployments beyond the two measured. Three more ids are listed in
  `src/leverage.js`, unmeasured and marked as such.
- The paid path was exercised with the agent's own wallet through an x402 client. This
  package never holds a payer key: `paidQuery` takes it from `X402_PRIVATE_KEY` and
  refuses by name when it is absent.

## Cost

$0.01 USDC per query, on Base. The two rows above cost $0.02 in total.
