# Zonda Reversal — trigger-family baseline

- Data: Binance Futures archives, BTC/USDT, ETH/USDT, SOL/USDT, XRP/USDT, TF 5m, 15m, 1h
- Range: 2023-01-01..2026-07-29; split: 2025-01-01
- Entry convention: signal on closed bar, entry at its close; touch is an OHLC intrabar-proxy evaluated at close
- Round-trip cost: 0.10% of price
- Production defaults changed: **NO**

## Coverage

| Symbol | TF | Bars | From | To |
|---|---:|---:|---|---|
| BTC/USDT | 5m | 375840 | 2023-01-01 | 2026-07-28 |
| BTC/USDT | 15m | 125280 | 2023-01-01 | 2026-07-28 |
| BTC/USDT | 1h | 31320 | 2023-01-01 | 2026-07-28 |
| ETH/USDT | 5m | 375840 | 2023-01-01 | 2026-07-28 |
| ETH/USDT | 15m | 125280 | 2023-01-01 | 2026-07-28 |
| ETH/USDT | 1h | 31320 | 2023-01-01 | 2026-07-28 |
| SOL/USDT | 5m | 375840 | 2023-01-01 | 2026-07-28 |
| SOL/USDT | 15m | 125280 | 2023-01-01 | 2026-07-28 |
| SOL/USDT | 1h | 31320 | 2023-01-01 | 2026-07-28 |
| XRP/USDT | 5m | 375840 | 2023-01-01 | 2026-07-28 |
| XRP/USDT | 15m | 125280 | 2023-01-01 | 2026-07-28 |
| XRP/USDT | 1h | 31320 | 2023-01-01 | 2026-07-28 |

## Current baseline (outer/directional/mean, horizon 12)

- train: n=2991, net=-0.105%, med=-0.015%, win=49.181%, MFE=0.892%, MAE=-1.111%, t=-3.80
- test: n=2151, net=-0.199%, med=-0.068%, win=45.700%, MFE=0.836%, MAE=-1.104%, t=-5.80

## Ranked only by train mean net return, horizon 12

| # | Hypothesis | Train | Untouched test |
|---:|---|---|---|
| 1 | outer/touch/inner | n=3647, net=-0.051%, med=0.050%, win=52.838%, MFE=1.078%, MAE=-1.343%, t=-1.47 | n=2542, net=-0.211%, med=-0.037%, win=47.797%, MFE=0.947%, MAE=-1.346%, t=-6.29 |
| 2 | outer/touch/mean | n=2994, net=-0.068%, med=0.032%, win=52.204%, MFE=1.052%, MAE=-1.312%, t=-1.76 | n=2151, net=-0.207%, med=-0.033%, win=48.164%, MFE=0.914%, MAE=-1.244%, t=-5.85 |
| 3 | inner/touch/mean | n=8484, net=-0.101%, med=0.009%, win=50.636%, MFE=0.819%, MAE=-1.021%, t=-5.98 | n=6579, net=-0.104%, med=-0.036%, win=47.621%, MFE=0.785%, MAE=-0.903%, t=-6.33 |
| 4 | outer/directional/inner | n=3595, net=-0.102%, med=-0.001%, win=49.903%, MFE=0.915%, MAE=-1.142%, t=-3.95 | n=2535, net=-0.218%, med=-0.072%, win=45.523%, MFE=0.858%, MAE=-1.204%, t=-6.58 |
| 5 | outer/directional/mean | n=2991, net=-0.105%, med=-0.015%, win=49.181%, MFE=0.892%, MAE=-1.111%, t=-3.80 | n=2151, net=-0.199%, med=-0.068%, win=45.700%, MFE=0.836%, MAE=-1.104%, t=-5.80 |
| 6 | outer/reclaim-edge/mean | n=2991, net=-0.113%, med=-0.044%, win=47.409%, MFE=0.843%, MAE=-1.020%, t=-4.65 | n=2151, net=-0.159%, med=-0.078%, win=45.188%, MFE=0.806%, MAE=-1.009%, t=-5.02 |
| 7 | inner/touch/inner | n=43976, net=-0.117%, med=-0.028%, win=47.792%, MFE=0.785%, MAE=-0.965%, t=-17.65 | n=35709, net=-0.113%, med=-0.050%, win=46.459%, MFE=0.746%, MAE=-0.861%, t=-16.92 |
| 8 | inner/directional/mean | n=8474, net=-0.119%, med=-0.036%, win=46.955%, MFE=0.743%, MAE=-0.907%, t=-8.71 | n=6573, net=-0.110%, med=-0.058%, win=45.428%, MFE=0.739%, MAE=-0.846%, t=-7.05 |
| 9 | inner/directional/inner | n=33454, net=-0.119%, med=-0.043%, win=46.494%, MFE=0.762%, MAE=-0.917%, t=-16.63 | n=27501, net=-0.120%, med=-0.060%, win=45.627%, MFE=0.729%, MAE=-0.841%, t=-15.83 |
| 10 | inner/reclaim-edge/mean | n=8469, net=-0.120%, med=-0.052%, win=45.519%, MFE=0.715%, MAE=-0.838%, t=-9.54 | n=6570, net=-0.103%, med=-0.079%, win=43.729%, MFE=0.718%, MAE=-0.786%, t=-6.90 |
| 11 | inner/reclaim-edge/inner | n=27757, net=-0.123%, med=-0.050%, win=45.812%, MFE=0.741%, MAE=-0.882%, t=-16.30 | n=22573, net=-0.117%, med=-0.066%, win=45.089%, MFE=0.715%, MAE=-0.810%, t=-14.48 |
| 12 | outer/reclaim-edge/inner | n=3585, net=-0.127%, med=-0.028%, win=48.173%, MFE=0.856%, MAE=-1.068%, t=-5.32 | n=2529, net=-0.174%, med=-0.086%, win=45.117%, MFE=0.834%, MAE=-1.081%, t=-5.57 |
| 13 | outer/reclaim-inner/inner | n=3508, net=-0.156%, med=-0.113%, win=40.365%, MFE=0.759%, MAE=-0.873%, t=-7.71 | n=2470, net=-0.125%, med=-0.127%, win=41.012%, MFE=0.786%, MAE=-0.848%, t=-4.63 |
| 14 | outer/reclaim-inner/mean | n=2990, net=-0.162%, med=-0.117%, win=39.866%, MFE=0.740%, MAE=-0.858%, t=-7.63 | n=2151, net=-0.107%, med=-0.120%, win=41.516%, MFE=0.766%, MAE=-0.796%, t=-3.94 |

## Top-5 train candidates across horizons

### outer/touch/inner
- 4 bars — train: n=3647, net=-0.029%, med=0.028%, win=52.290%, MFE=0.777%, MAE=-0.944%, t=-1.07; test: n=2543, net=-0.149%, med=-0.044%, win=46.559%, MFE=0.648%, MAE=-0.890%, t=-5.02
- 12 bars — train: n=3647, net=-0.051%, med=0.050%, win=52.838%, MFE=1.078%, MAE=-1.343%, t=-1.47; test: n=2542, net=-0.211%, med=-0.037%, win=47.797%, MFE=0.947%, MAE=-1.346%, t=-6.29
- 24 bars — train: n=3647, net=-0.057%, med=0.084%, win=53.523%, MFE=1.357%, MAE=-1.665%, t=-1.46; test: n=2542, net=-0.205%, med=-0.058%, win=47.364%, MFE=1.232%, MAE=-1.724%, t=-4.62

### outer/touch/mean
- 4 bars — train: n=2994, net=-0.027%, med=0.029%, win=52.472%, MFE=0.757%, MAE=-0.906%, t=-0.95; test: n=2152, net=-0.115%, med=-0.049%, win=46.097%, MFE=0.616%, MAE=-0.814%, t=-4.80
- 12 bars — train: n=2994, net=-0.068%, med=0.032%, win=52.204%, MFE=1.052%, MAE=-1.312%, t=-1.76; test: n=2151, net=-0.207%, med=-0.033%, win=48.164%, MFE=0.914%, MAE=-1.244%, t=-5.85
- 24 bars — train: n=2994, net=-0.058%, med=0.084%, win=53.574%, MFE=1.325%, MAE=-1.614%, t=-1.40; test: n=2151, net=-0.194%, med=-0.061%, win=47.048%, MFE=1.189%, MAE=-1.590%, t=-4.32

### inner/touch/mean
- 4 bars — train: n=8484, net=-0.085%, med=-0.023%, win=47.324%, MFE=0.539%, MAE=-0.686%, t=-7.32; test: n=6579, net=-0.097%, med=-0.045%, win=45.220%, MFE=0.506%, MAE=-0.584%, t=-9.13
- 12 bars — train: n=8484, net=-0.101%, med=0.009%, win=50.636%, MFE=0.819%, MAE=-1.021%, t=-5.98; test: n=6579, net=-0.104%, med=-0.036%, win=47.621%, MFE=0.785%, MAE=-0.903%, t=-6.33
- 24 bars — train: n=8484, net=-0.086%, med=0.032%, win=51.839%, MFE=1.094%, MAE=-1.313%, t=-4.14; test: n=6577, net=-0.108%, med=-0.039%, win=48.122%, MFE=1.062%, MAE=-1.214%, t=-4.72

### outer/directional/inner
- 4 bars — train: n=3595, net=-0.099%, med=-0.044%, win=45.591%, MFE=0.602%, MAE=-0.719%, t=-5.87; test: n=2536, net=-0.187%, med=-0.084%, win=40.615%, MFE=0.540%, MAE=-0.735%, t=-8.43
- 12 bars — train: n=3595, net=-0.102%, med=-0.001%, win=49.903%, MFE=0.915%, MAE=-1.142%, t=-3.95; test: n=2535, net=-0.218%, med=-0.072%, win=45.523%, MFE=0.858%, MAE=-1.204%, t=-6.58
- 24 bars — train: n=3595, net=-0.109%, med=0.025%, win=51.210%, MFE=1.208%, MAE=-1.530%, t=-3.29; test: n=2535, net=-0.198%, med=-0.088%, win=46.233%, MFE=1.149%, MAE=-1.587%, t=-4.77

### outer/directional/mean
- 4 bars — train: n=2991, net=-0.087%, med=-0.045%, win=45.303%, MFE=0.591%, MAE=-0.684%, t=-5.09; test: n=2152, net=-0.167%, med=-0.084%, win=41.078%, MFE=0.518%, MAE=-0.653%, t=-8.72
- 12 bars — train: n=2991, net=-0.105%, med=-0.015%, win=49.181%, MFE=0.892%, MAE=-1.111%, t=-3.80; test: n=2151, net=-0.199%, med=-0.068%, win=45.700%, MFE=0.836%, MAE=-1.104%, t=-5.80
- 24 bars — train: n=2991, net=-0.112%, med=0.023%, win=51.220%, MFE=1.183%, MAE=-1.469%, t=-3.12; test: n=2151, net=-0.177%, med=-0.071%, win=47.001%, MFE=1.113%, MAE=-1.457%, t=-4.27

## Interpretation rules

- Names above are research hypotheses, **not** claimed mappings to vendor Safe/Standard/Risk.
- A candidate is actionable only if sign and useful magnitude survive untouched test, long/short and TF slices.
- Multiple horizons share signals; t-stat is descriptive, not a final significance claim.
- Next step: robustness slices and mode mapping only after this baseline.
