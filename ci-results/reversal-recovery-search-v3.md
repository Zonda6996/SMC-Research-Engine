# Reversal recovery-crossing search v3

- Exact Outer lines and extended histories: 86,420 rows / 370 labels.
- Grid: 35200 causal models.
- Family: prior Inner/Outer visit → cross a normalized recovery level → one signal → global cooldown.

## Winner

```json
{
  "arm": "inner",
  "recoveryLevel": 0.65,
  "minRecoveryDelta": 0.125,
  "maxEpisodeBars": 192,
  "globalCooldownBars": 72,
  "requireDirectional": false,
  "requireCloseInsideInner": false
}
```

| Split | Precision | Recall | F1 | Pred/original |
|---|---:|---:|---:|---:|
| fit | 12.33% | 16.36% | 14.06% | 1.33 |
| validation | 14.29% | 19.23% | 16.39% | 1.35 |
| sealed BTC | 4.88% | 6.25% | 5.48% | 1.28 |

## Futures holdouts

| Dataset | TP | FP | FN | Precision | Recall | Pred | Ratio |
|---|---:|---:|---:|---:|---:|---:|---:|
| eth-perp-15m | 7 | 89 | 68 | 7.29% | 9.33% | 96 | 1.28 |
| btc-perp-5m | 6 | 120 | 75 | 4.76% | 7.41% | 126 | 1.56 |
| btc-perp-4h | 3 | 42 | 35 | 6.67% | 7.89% | 45 | 1.18 |

Aggregate: 5.99% precision / 8.25% recall.

## SOL Spot separate

| Dataset | TP | FP | FN | Precision | Recall | Pred | Ratio |
|---|---:|---:|---:|---:|---:|---:|---:|
| sol-spot-15m | 6 | 115 | 57 | 4.96% | 9.52% | 121 | 1.92 |

## Strict gate

**FAIL**. Production remains unchanged on FAIL.
