# Stateful Apex S2 — preregistered economics and one OOS gate

- Frozen manifest config: `a0b6fab77ef278b1b264beee35c6032fa81241b775b76328b1146980d3fe839e`
- Frozen state-machine hash: `5f82d45de35ede30e08599372e5cabd46bb04402ddc47de488fad1bfecb449c8`
- Arm: `primary-threshold-free-all-confirmed-events` (no thresholds, no train selection)
- Vendor Shapes used as target/feature: **no**
- Validation decision: **KILL_V1_NO_OOS_REVEAL**
- Untouched-OOS reveal count: **0**
- Final verdict: **KILL_VALIDATION_NO_EDGE**

## Train

- Events / valid / resolved / censored: 5822 / 4847 / 4845 / 2
- Net meanR: **-8.2535**; CI95: [-14.0245, -0.0548]
- PF / WR / max DD: 0.0418 / 0.3465 / 39988.0848R
- Mean future MFE / MAE: 1.3488R / 1.3456R
- Target / stop / censored: 2183 / 2662 / 2
- Positive symbols: 1/7; positive series: 3/27
- Random matched baseline meanR: -5.8583 (N=4930)

| symbol | N | meanR | PF | WR | DD |
|---|---:|---:|---:|---:|---:|
| ADAUSDT | 345 | -0.1366 | 0.7682 | 0.4348 | 47.1258 |
| BNBUSDT | 1168 | -12.8757 | 0.0136 | 0.2312 | 15038.8236 |
| BTCUSDT | 973 | -12.0712 | 0.0348 | 0.3957 | 11746.1150 |
| DOGEUSDT | 421 | -0.0416 | 0.9273 | 0.4584 | 44.9888 |
| ETHUSDT | 1252 | -10.4756 | 0.0269 | 0.2979 | 13115.4966 |
| LDOUSDT | 334 | 0.1222 | 1.2341 | 0.5030 | 15.0527 |
| XRPUSDT | 352 | -0.1838 | 0.7096 | 0.3977 | 73.8028 |

| series | N | meanR | PF | WR | DD |
|---|---:|---:|---:|---:|---:|
| csv/BINANCE_ADAUSDT.P, 15.csv | 138 | -0.0705 | 0.8723 | 0.4783 | 16.5753 |
| csv/BINANCE_ADAUSDT.P, 45.csv | 207 | -0.1806 | 0.7059 | 0.4058 | 37.3942 |
| csv/BINANCE_BNBUSDT, 1.csv | 250 | -3.1048 | 0.0432 | 0.2280 | 776.3898 |
| csv/BINANCE_BNBUSDT, 10S.csv | 234 | -18.0591 | 0.0001 | 0.0043 | 4225.8188 |
| csv/BINANCE_BNBUSDT, 1S.csv | 134 | -56.5428 | 0.0000 | 0.0000 | 7576.7301 |
| csv/BINANCE_BNBUSDT, 5.csv | 170 | -0.3470 | 0.5452 | 0.4706 | 60.1065 |
| csv/BINANCE_BNBUSDT.P, 1.csv | 219 | -10.7237 | 0.0137 | 0.2603 | 2349.4735 |
| csv/BINANCE_BNBUSDT.P, 5.csv | 161 | -0.3265 | 0.5665 | 0.4658 | 52.5742 |
| csv/BINANCE_BTCUSDT, 15.csv | 169 | -0.3353 | 0.5918 | 0.4497 | 62.3589 |
| csv/BINANCE_BTCUSDT, 5S.csv | 125 | -92.6776 | 0.0000 | 0.0000 | 11584.6994 |
| csv/BINANCE_BTCUSDT, 60.csv | 172 | -0.0501 | 0.9172 | 0.4535 | 21.3660 |
| csv/BINANCE_BTCUSDT.P, 15.csv | 164 | -0.1751 | 0.7418 | 0.4695 | 41.9622 |
| csv/BINANCE_BTCUSDT.P, 5.csv | 176 | -0.3585 | 0.5186 | 0.4489 | 66.7834 |
| csv/BINANCE_BTCUSDT.P, 60.csv | 167 | -0.0207 | 0.9650 | 0.4491 | 18.6897 |
| csv/BINANCE_DOGEUSDT, 30.csv | 203 | -0.0950 | 0.8354 | 0.4631 | 34.3113 |
| csv/BINANCE_DOGEUSDT, 45.csv | 218 | 0.0081 | 1.0143 | 0.4541 | 29.6439 |
| csv/BINANCE_ETHUSDT, 1.csv | 242 | -1.8282 | 0.0866 | 0.2438 | 442.9124 |
| csv/BINANCE_ETHUSDT, 120.csv | 136 | -0.1958 | 0.7007 | 0.3676 | 30.9758 |
| csv/BINANCE_ETHUSDT, 15.csv | 160 | -0.1458 | 0.7613 | 0.4437 | 27.6884 |
| csv/BINANCE_ETHUSDT, 1S.csv | 113 | -79.2198 | 0.0000 | 0.0000 | 8951.8340 |
| csv/BINANCE_ETHUSDT, 30.csv | 218 | -0.0596 | 0.8976 | 0.4771 | 37.6116 |
| csv/BINANCE_ETHUSDT, 5.csv | 180 | -0.2812 | 0.5802 | 0.4889 | 55.6828 |
| csv/BINANCE_ETHUSDT, 5S.csv | 203 | -17.7717 | 0.0001 | 0.0049 | 3607.6612 |
| csv/BINANCE_LDOUSDT, 15.csv | 173 | 0.1286 | 1.2589 | 0.5376 | 16.9158 |
| csv/BINANCE_LDOUSDT.P, 60.csv | 161 | 0.1154 | 1.2100 | 0.4658 | 15.0527 |
| csv/BINANCE_XRPUSDT, 30.csv | 188 | -0.2126 | 0.6691 | 0.3936 | 43.9591 |
| csv/BINANCE_XRPUSDT, 60.csv | 164 | -0.1509 | 0.7575 | 0.4024 | 32.2359 |

## Validation

- Events / valid / resolved / censored: 825 / 802 / 799 / 3
- Net meanR: **-0.2001**; CI95: [-0.5861, 0.0530]
- PF / WR / max DD: 0.7163 / 0.5006 / 174.4229R
- Mean future MFE / MAE: 1.1488R / 1.3494R
- Target / stop / censored: 400 / 399 / 3
- Positive symbols: 0/2; positive series: 1/5
- Random matched baseline meanR: -0.0013 (N=803)

| symbol | N | meanR | PF | WR | DD |
|---|---:|---:|---:|---:|---:|
| ONDOUSDT | 328 | -0.0138 | 0.9748 | 0.4909 | 26.9447 |
| VIRTUALUSDT | 471 | -0.3298 | 0.5950 | 0.5074 | 162.3426 |

| series | N | meanR | PF | WR | DD |
|---|---:|---:|---:|---:|---:|
| csv/BINANCE_ONDOUSDT, 5.csv | 171 | 0.0191 | 1.0348 | 0.5146 | 18.6026 |
| csv/BINANCE_ONDOUSDT.P, 60.csv | 157 | -0.0497 | 0.9096 | 0.4650 | 26.9447 |
| csv/BINANCE_VIRTUALUSDT, 5.csv | 193 | -0.6937 | 0.4203 | 0.5285 | 149.3602 |
| csv/BINANCE_VIRTUALUSDT.P, 5.csv | 176 | -0.0332 | 0.9369 | 0.5341 | 19.0057 |
| csv/BINANCE_VIRTUALUSDT.P, 60.csv | 102 | -0.1529 | 0.7405 | 0.4216 | 18.7264 |

## Untouched OOS

Not revealed (validation kill).

## Success gate

- net meanR > 0: false
- CI95 low > 0: false
- ≥60% positive assets: false
- ≥2 positive series: false
- no asset >50% pooled net R: false
- leave-one-asset-out stays positive: false

## Protocol notes / limitations

- Censored outcomes are published and excluded from realised meanR/PF/WR because no realised target/stop R exists.
- Pooled drawdown orders simultaneous cross-series events by timestamp then series name; per-series drawdowns are also published.
- Funding is unavailable in OHLCV and is not invented; futures results therefore omit funding.
- A0/A1 were not run because the frozen docs name them but do not fully freeze independent episode/cooldown semantics.
- Cluster CI is hierarchical percentile bootstrap with outer symbol and inner symbol×calendar-month clusters, 10,000 resamples, seed 20260820.
- Frozen OWN2 baseline is included in JSON as contextual comparison only; it is not like-for-like (7 bps/side and a different universe/execution).
