# Archive OI heatmap — data-layer validation

- Source: Binance USD-M daily metrics archives (monthly metrics do not exist)
- Window: 2026-05-01..2026-07-29, TF 15m
- Alignment: last metric at or before candle; expires after two native 5m metric intervals
- Heatmap production defaults changed: **NO**

| Symbol | Candles | Metric points | Coverage | Metrics range | Pools fallback → OI | Active fallback → OI |
|---|---:|---:|---:|---|---:|---:|
| BTC/USDT | 8544 | 25630 | 99.99% | 2026-05-01..2026-07-28 | 4897 → 5093 | 2542 → 2526 |
| ETH/USDT | 8544 | 25630 | 99.99% | 2026-05-01..2026-07-28 | 5747 → 5511 | 2457 → 2254 |
| SOL/USDT | 8544 | 25630 | 99.99% | 2026-05-01..2026-07-28 | 6207 → 5688 | 2616 → 2321 |
| XRP/USDT | 8544 | 25631 | 99.99% | 2026-05-01..2026-07-28 | 5734 → 5550 | 2589 → 2385 |

## Decision gate

- PASS requires ≥90% aligned OI coverage and non-empty OI-hybrid output for every symbol.
- This run validates the archive data path and causal alignment; it does not claim predictive edge.
- Next: wire archive aux into visualizer/research path, then compare magnet hit-rate against distance-matched controls before changing the engine version.
