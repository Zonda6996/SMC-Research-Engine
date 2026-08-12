# Reversal global-cooldown first-eligible search v4

- 305760 causal candidates; motivated by the observed 52–60 bar minimum gap across every dataset.

## Winner

```json
{
  "candidate": "inner-recovery",
  "cooldownBars": 72,
  "warmupBars": 0,
  "minDistance": 0.45,
  "maxDistance": 1,
  "minRecoveryDelta": 0.15,
  "innerMemoryBars": 192
}
```

| split | precision | recall | F1 | ratio |
|---|---:|---:|---:|---:|
| fit | 14.77% | 23.64% | 18.18% | 1.60 |
| validation | 17.02% | 30.77% | 21.92% | 1.81 |
| sealed | 6.52% | 9.38% | 7.69% | 1.44 |

## Futures OOS

| dataset | TP | FP | FN | precision | recall | pred | ratio |
|---|---:|---:|---:|---:|---:|---:|---:|
| eth-perp-15m | 13 | 102 | 62 | 11.30% | 17.33% | 115 | 1.53 |
| btc-perp-5m | 17 | 133 | 64 | 11.33% | 20.99% | 150 | 1.85 |
| btc-perp-4h | 3 | 50 | 35 | 5.66% | 7.89% | 53 | 1.39 |

Aggregate 10.38% / 17.01%.

## SOL Spot

| sol-spot-15m | 7 | 132 | 56 | 5.04% | 11.11% | 139 | 2.21 |

## Gate

**FAIL**
