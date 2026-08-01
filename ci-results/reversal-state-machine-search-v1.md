# Reversal global chronological state-machine search v1

- Engine: `reversal-state-machine-research-1.0-exact-bands`.
- Grid: 3564 causal state machines.
- Selection: first 50% of BTC Futures 15m/1h; top 200 move to the next 25%; final 25% is sealed until the family is fixed.
- Event matching is one-to-one. Main metric is exact-bar; ±1 bar is diagnostic only.
- No PnL or future outcome is used.

## Selected state machine

```json
{
  "armKind": "inner-rsi35",
  "maxPendingBars": 8,
  "confirmKind": "recovery25",
  "rearmKind": "neutral",
  "cooldownBars": 0,
  "neutralBars": 2
}
```

| Split | TP | FP | FN | Precision | Recall | F1 | Predictions / truth |
|---|---:|---:|---:|---:|---:|---:|---:|
| fit | 8 | 78 | 20 | 9.30% | 28.57% | 14.04% | 3.07 |
| validation | 5 | 47 | 11 | 9.62% | 31.25% | 14.71% | 3.25 |
| sealed BTC 15m/1h | 5 | 46 | 16 | 9.80% | 23.81% | 13.89% | 2.43 |

## Untouched Futures holdouts

| Dataset | TP | FP | FN | Precision | Recall | Predictions |
|---|---:|---:|---:|---:|---:|---:|
| eth-perp-15m | 10 | 155 | 37 | 6.06% | 21.28% | 165 |
| btc-perp-5m | 18 | 270 | 63 | 6.25% | 22.22% | 288 |
| btc-perp-4h | 2 | 81 | 36 | 2.41% | 5.26% | 83 |

Aggregate: precision 5.60%, recall 18.07%, F1 8.55%.

## Spot holdout — separate market-kind slice

| Dataset | TP | FP | FN | Precision | Recall | Predictions |
|---|---:|---:|---:|---:|---:|---:|
| sol-spot-15m | 10 | 136 | 27 | 6.85% | 27.03% | 146 |

Aggregate: precision 6.85%, recall 27.03%, F1 10.93%.

## Production gate

**FAIL** — each Futures holdout needs precision ≥15%, recall ≥40%, and prediction/original count ratio 0.5–2.0.

This is a vendor-fidelity result, not evidence of trading profitability. If the gate fails, production `detectReversals()` must remain unchanged.
