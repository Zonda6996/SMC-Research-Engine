# Heatmap magnet validation — causal snapshots

- Window: 2026-05-01..2026-07-29; TF 15m; split 2026-06-15
- Snapshot cadence: 2 days after 20-day warm-up; forward horizon: 96 bars (24h)
- At each snapshot: 3 strongest active pools per side; controls are lower-half pools matched by current price distance and circularly permuted distances.
- Pool detection receives only candles/aux available at the snapshot. No production defaults or version changed.

| Model / split | N | Strong hit | Weak distance-match | Permuted distance | one-sided permutation p |
|---|---:|---:|---:|---:|---:|
| volume|train | 312 | 12.2% | 10.6% | 6.7% | 0.010 |
| oi|train | 312 | 10.9% | 10.3% | 5.0% | 0.020 |
| volume|test | 504 | 4.8% | 3.0% | 2.6% | 0.010 |
| oi|test | 504 | 2.2% | 1.8% | 2.0% | 0.455 |

## Symbol / side slices

| Slice | N | Strong | Weak | Permuted | p |
|---|---:|---:|---:|---:|---:|
| volume|train|BTC/USDT|sell-side | 39 | 0.0% | 0.0% | 0.2% | 1.000 |
| volume|train|BTC/USDT|buy-side | 39 | 17.9% | 10.3% | 11.1% | 0.205 |
| oi|train|BTC/USDT|sell-side | 39 | 0.0% | 0.0% | 0.4% | 1.000 |
| oi|train|BTC/USDT|buy-side | 39 | 12.8% | 12.8% | 7.3% | 0.154 |
| volume|test|BTC/USDT|sell-side | 63 | 1.6% | 0.0% | 0.7% | 0.429 |
| volume|test|BTC/USDT|buy-side | 63 | 7.9% | 3.2% | 2.9% | 0.016 |
| oi|test|BTC/USDT|sell-side | 63 | 1.6% | 1.6% | 0.2% | 0.143 |
| oi|test|BTC/USDT|buy-side | 63 | 1.6% | 1.6% | 1.7% | 0.651 |
| volume|train|ETH/USDT|sell-side | 39 | 2.6% | 0.0% | 1.2% | 0.436 |
| volume|train|ETH/USDT|buy-side | 39 | 23.1% | 23.1% | 19.3% | 0.231 |
| oi|train|ETH/USDT|sell-side | 39 | 0.0% | 0.0% | 0.0% | 1.000 |
| oi|train|ETH/USDT|buy-side | 39 | 23.1% | 23.1% | 14.9% | 0.077 |
| volume|test|ETH/USDT|sell-side | 63 | 6.3% | 1.6% | 2.7% | 0.016 |
| volume|test|ETH/USDT|buy-side | 63 | 7.9% | 6.3% | 4.0% | 0.111 |
| oi|test|ETH/USDT|sell-side | 63 | 0.0% | 0.0% | 0.0% | 1.000 |
| oi|test|ETH/USDT|buy-side | 63 | 3.2% | 3.2% | 2.4% | 0.492 |
| volume|train|SOL/USDT|sell-side | 39 | 0.0% | 0.0% | 0.2% | 1.000 |
| volume|train|SOL/USDT|buy-side | 39 | 28.2% | 28.2% | 20.9% | 0.179 |
| oi|train|SOL/USDT|sell-side | 39 | 0.0% | 0.0% | 0.0% | 1.000 |
| oi|train|SOL/USDT|buy-side | 39 | 25.6% | 25.6% | 19.6% | 0.231 |
| volume|test|SOL/USDT|sell-side | 63 | 0.0% | 0.0% | 0.1% | 1.000 |
| volume|test|SOL/USDT|buy-side | 63 | 6.3% | 6.3% | 4.9% | 0.365 |
| oi|test|SOL/USDT|sell-side | 63 | 1.6% | 1.6% | 1.2% | 0.587 |
| oi|test|SOL/USDT|buy-side | 63 | 6.3% | 3.2% | 6.2% | 0.635 |
| volume|train|XRP/USDT|sell-side | 39 | 2.6% | 0.0% | 3.0% | 0.769 |
| volume|train|XRP/USDT|buy-side | 39 | 23.1% | 23.1% | 14.6% | 0.077 |
| oi|train|XRP/USDT|sell-side | 39 | 2.6% | 0.0% | 1.1% | 0.385 |
| oi|train|XRP/USDT|buy-side | 39 | 23.1% | 20.5% | 15.5% | 0.026 |
| volume|test|XRP/USDT|sell-side | 63 | 0.0% | 0.0% | 0.0% | 1.000 |
| volume|test|XRP/USDT|buy-side | 63 | 7.9% | 6.3% | 5.3% | 0.175 |
| oi|test|XRP/USDT|sell-side | 63 | 0.0% | 0.0% | 0.5% | 1.000 |
| oi|test|XRP/USDT|buy-side | 63 | 3.2% | 3.2% | 3.3% | 0.619 |

## Interpretation gate

This report measures magnet behaviour, not trading PnL. A version bump requires out-of-sample OI improvement over both controls with directionally consistent symbol/side slices; data-path differences alone are not edge. Serially overlapping pool observations are avoided by the 2-day cadence, which exceeds the 24h outcome horizon.
