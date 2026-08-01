# Reversal simplified fear-greed proxy search v5

## Winner

```json
{
  "weights": [
    1,
    1,
    2,
    2
  ],
  "smooth": 3,
  "arm": 20,
  "release": 25,
  "cooldown": 56,
  "innerMemory": 256,
  "directional": true
}
```

| split | precision | recall | F1 | ratio |
|---|---:|---:|---:|---:|
| fit | 6.77% | 16.36% | 9.57% | 2.42 |
| validation | 7.35% | 19.23% | 10.64% | 2.62 |
| sealed | 4.29% | 9.38% | 5.88% | 2.19 |

## Futures OOS

| dataset | TP | FP | FN | precision | recall | pred | ratio |
|---|---:|---:|---:|---:|---:|---:|---:|
| eth-perp-15m | 12 | 177 | 63 | 6.35% | 16.00% | 189 | 2.52 |
| btc-perp-5m | 6 | 222 | 75 | 2.63% | 7.41% | 228 | 2.81 |
| btc-perp-4h | 4 | 87 | 34 | 4.40% | 10.53% | 91 | 2.39 |

Aggregate 4.33% / 11.34%

## SOL Spot

| sol-spot-15m | 8 | 208 | 55 | 3.70% | 12.70% | 216 | 3.43 |

## Gate

**FAIL**
