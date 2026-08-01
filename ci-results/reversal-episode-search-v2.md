# Reversal long-memory episode search v2

- Engine: `reversal-episode-research-2.0-long-memory`.
- Grid: 55080 causal long-memory machines.
- Search uses 50% fit → top 300 only on 25% validation → one sealed 25% report.
- Futures group holdouts and SOL Spot were not used for selection.

## Winner

```json
{
  "armInner": true,
  "armThreshold": 15,
  "oscillator": "stoch",
  "smoothFast": 3,
  "smoothSlow": 8,
  "releaseThreshold": 25,
  "confirm": "osc-cross",
  "minDwellBars": 0,
  "maxEpisodeBars": 64,
  "minRecoveryWidth": 0.25,
  "rearm": "cooldown",
  "cooldownBars": 64
}
```

| Split | Precision | Recall | F1 | Predictions / truth |
|---|---:|---:|---:|---:|
| fit | 8.93% | 17.86% | 11.90% | 2.00 |
| validation | 9.68% | 18.75% | 12.77% | 1.94 |
| sealed | 3.03% | 4.76% | 3.70% | 1.57 |

## Futures holdouts

| Dataset | TP | FP | FN | Precision | Recall | Predictions |
|---|---:|---:|---:|---:|---:|---:|
| eth-perp-15m | 7 | 78 | 40 | 8.24% | 14.89% | 85 |
| btc-perp-5m | 11 | 151 | 70 | 6.79% | 13.58% | 162 |
| btc-perp-4h | 3 | 55 | 35 | 5.17% | 7.89% | 58 |

Aggregate 6.89% precision / 12.65% recall.

## SOL Spot — separate

| Dataset | TP | FP | FN | Precision | Recall | Predictions |
|---|---:|---:|---:|---:|---:|---:|
| sol-spot-15m | 5 | 81 | 32 | 5.81% | 13.51% | 86 |

## Gate

**FAIL** — production remains unchanged unless every Futures holdout passes 15% precision, 40% recall and 0.5–2.0 count ratio.
