# Reversal volume-aware fear/greed search v6

- Volume recovered from official Bybit V5 kline; all six datasets have 100% timestamp coverage and negligible OHLC drift.
- 189952 causal candidates: momentum + relative volume + range volatility + Apex distance, smoothed score, extreme arm, release cross, memory and cooldown.

## Winner

```json
{
  "mom": 0,
  "vol": 0,
  "range": 1,
  "dist": 0,
  "smooth": 3,
  "arm": 15,
  "release": 5,
  "cooldown": 80,
  "memory": 96,
  "directional": true
}
```

| split | precision | recall | F1 | ratio |
|---|---:|---:|---:|---:|
| fit | 6.00% | 5.45% | 5.71% | 0.91 |
| validation | 6.67% | 7.69% | 7.14% | 1.15 |
| sealed | 0.00% | 0.00% | 0.00% | 0.78 |

## Futures OOS

| dataset | TP | FP | FN | precision | recall | pred | ratio |
|---|---:|---:|---:|---:|---:|---:|---:|
| eth-perp-15m | 6 | 66 | 69 | 8.33% | 8.00% | 72 | 0.96 |
| btc-perp-5m | 4 | 76 | 77 | 5.00% | 4.94% | 80 | 0.99 |
| btc-perp-4h | 1 | 23 | 37 | 4.17% | 2.63% | 24 | 0.63 |

Aggregate 6.25% / 5.67%

## SOL Spot

| sol-spot-15m | 2 | 79 | 61 | 2.47% | 3.17% | 81 | 1.29 |

## Gate

**FAIL**
