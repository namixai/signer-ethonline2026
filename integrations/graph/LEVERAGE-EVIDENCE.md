# Standardized-schema leverage: the measurement, not the claim

**What is claimed:** the subgraph this package reads in production is a **Messari
Standardized Subgraph** on the `DEX AMM (Extended)` schema, so one query pattern spans
many deployments with **no code change**.

**How to re-run it:** `npm run leverage` (add `X402_PRIVATE_KEY` for the paid path; without
it the script reads the free price challenge and says, in its own output, that this proves
nothing about the data).

---

## We did not pick it for the prize — we found out we were already on it

The id in `src/fetch.js` is byte-for-byte the one Messari's deployment registry lists for
`uniswap-v3-ethereum`:

```
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
