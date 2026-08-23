# Stateful Apex S4 v2 — final independent holdout reveal

- Final decision: **KILL**.
- Reveal count: **1**. No retune, subgroup/PnL rescue, losing-symbol exclusion, Vendor Shapes, S1 OOS read, or ONDO/VIRTUAL reuse.
- Integrity: **PASS**; 3 files, 60000 rows, 409 events, 409 labels.

## Aggregate at 5 bps/side

| arm | resolved N | mean netR | CI95 | PF | WR | maxDD R |
|---|---:|---:|---|---:|---:|---:|
| unfiltered v1 | 399 | -0.02205 | [-0.14444, 0.09872] | 0.96034 | 0.46617 | 43.74858 |
| frozen v2 | 174 | -0.00032 | [-0.19157, 0.23155] | 0.99935 | 0.53448 | 15.81275 |

Paired delta v2-v1: **0.02173**, CI95 [-0.14912, 0.22548].

Breadth: 2/3 positive symbols; 2/3 positive independent series.

| symbol | v1 N | v1 mean | v2 N | v2 mean |
|---|---:|---:|---:|---:|
| ZECUSDT | 128 | -0.08989 | 55 | 0.01979 |
| 1000PEPEUSDT | 135 | -0.02023 | 64 | -0.14127 |
| BOMEUSDT | 136 | 0.03998 | 55 | 0.14358 |

## Frozen gates

- minimumBreadth: **PASS**
- v2MeanPositive: **FAIL**
- v2CiLowPositive: **FAIL**
- pairedDeltaPositive: **PASS**
- pairedDeltaCiLowPositive: **FAIL**
- positiveSymbolBreadth60Pct: **PASS**
- positiveSeriesBreadth60Pct: **PASS**

Final frozen decision: **KILL**.
