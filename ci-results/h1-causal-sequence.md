# H1 — causal liquidity sweep → reclaim → protection

## Protocol

- OOS assets fixed a priori: ADA,DOGE,LINK,ONDO,SOL,XRP entire files. Remaining assets: first 60% dev-early, next 20% dev-late selection, final 20% untouched oos-time.
- Selection: winner chosen only by dev-late ±1 F1, tie-break dev-early; OOS never used.
- Pooled inference: >=15m only; low-TF files retained in manifest/descriptive coverage but excluded due nested/dependent observations. Multiple TF of same asset remain reported, but bootstrap resamples asset/file units rather than bars..
- Loaded **37/37** vendor CSV; inferential series: **21**.

## Causality checks

- allPivotsDelayed: **PASS**
- allSequencesOrdered: **PASS**
- labelsStrippedBeforeFeatures: **PASS**

## Selected on dev only: **h1-l2r2-w6-rb0-rv0**

| arm | split | exact P/R/F1/density | ±1 P/R/F1/density |
|---|---|---|---|
| h1-l2r2-w6-rb0-rv0 | dev-early | 1.03% / 4.65% / 1.68% / ×4.53 | 1.94% / 8.80% / 3.18% / ×4.53 |
| h1-l2r2-w6-rb0-rv0 | dev-late | 0.96% / 4.11% / 1.55% / ×4.30 | 2.44% / 10.50% / 3.97% / ×4.30 |
| h1-l2r2-w6-rb0-rv0 | oos-asset | 1.13% / 4.80% / 1.83% / ×4.24 | 2.31% / 9.81% / 3.74% / ×4.24 |
| h1-l2r2-w6-rb0-rv0 | oos-time | 0.77% / 3.83% / 1.29% / ×4.95 | 1.64% / 8.13% / 2.73% / ×4.95 |
| h1-l2r2-w10-rb1-rv0 | dev-early | 0.72% / 4.65% / 1.24% / ×6.49 | 1.33% / 8.64% / 2.31% / ×6.49 |
| h1-l2r2-w10-rb1-rv0 | dev-late | 0.66% / 4.11% / 1.13% / ×6.27 | 1.67% / 10.50% / 2.89% / ×6.27 |
| h1-l2r2-w10-rb1-rv0 | oos-asset | 0.80% / 4.90% / 1.38% / ×6.10 | 1.63% / 9.91% / 2.79% / ×6.10 |
| h1-l2r2-w10-rb1-rv0 | oos-time | 0.56% / 3.83% / 0.98% / ×6.80 | 1.20% / 8.13% / 2.09% / ×6.80 |
| h1-l3r3-w10-rb0-rv0 | dev-early | 0.50% / 1.83% / 0.78% / ×3.67 | 1.27% / 4.65% / 1.99% / ×3.67 |
| h1-l3r3-w10-rb0-rv0 | dev-late | 0.62% / 2.28% / 0.98% / ×3.67 | 2.36% / 8.68% / 3.71% / ×3.67 |
| h1-l3r3-w10-rb0-rv0 | oos-asset | 0.63% / 2.20% / 0.98% / ×3.48 | 1.55% / 5.41% / 2.42% / ×3.48 |
| h1-l3r3-w10-rb0-rv0 | oos-time | 0.36% / 1.44% / 0.58% / ×3.97 | 1.33% / 5.26% / 2.12% / ×3.97 |
| h1-l3r3-w14-rb1-rv1.2 | dev-early | 0.41% / 1.66% / 0.66% / ×4.02 | 1.03% / 4.15% / 1.65% / ×4.02 |
| h1-l3r3-w14-rb1-rv1.2 | dev-late | 0.24% / 0.91% / 0.38% / ×3.86 | 1.42% / 5.48% / 2.25% / ×3.86 |
| h1-l3r3-w14-rb1-rv1.2 | oos-asset | 0.45% / 1.70% / 0.71% / ×3.78 | 1.11% / 4.20% / 1.76% / ×3.78 |
| h1-l3r3-w14-rb1-rv1.2 | oos-time | 0.11% / 0.48% / 0.18% / ×4.21 | 0.57% / 2.39% / 0.92% / ×4.21 |
| h1-l5r3-w14-rb0-rv1.2 | dev-early | 0.30% / 0.83% / 0.44% / ×2.75 | 0.85% / 2.33% / 1.24% / ×2.75 |
| h1-l5r3-w14-rb0-rv1.2 | dev-late | 0.34% / 0.91% / 0.50% / ×2.65 | 1.03% / 2.74% / 1.50% / ×2.65 |
| h1-l5r3-w14-rb0-rv1.2 | oos-asset | 0.27% / 0.70% / 0.39% / ×2.62 | 0.92% / 2.40% / 1.33% / ×2.62 |
| h1-l5r3-w14-rb0-rv1.2 | oos-time | 0.00% / 0.00% / 0.00% / ×2.88 | 0.67% / 1.91% / 0.99% / ×2.88 |
| h1-l5r5-w20-rb1-rv0 | dev-early | 0.24% / 0.66% / 0.35% / ×2.81 | 0.71% / 1.99% / 1.05% / ×2.81 |
| h1-l5r5-w20-rb1-rv0 | dev-late | 0.16% / 0.46% / 0.24% / ×2.82 | 1.13% / 3.20% / 1.67% / ×2.82 |
| h1-l5r5-w20-rb1-rv0 | oos-asset | 0.15% / 0.40% / 0.22% / ×2.65 | 0.64% / 1.70% / 0.93% / ×2.65 |
| h1-l5r5-w20-rb1-rv0 | oos-time | 0.00% / 0.00% / 0.00% / ×2.98 | 0.48% / 1.44% / 0.72% / ×2.98 |
| inner-excursion-touch | dev-early | 2.33% / 46.68% / 4.44% / ×20.00 | 2.72% / 54.49% / 5.19% / ×20.00 |
| inner-excursion-touch | dev-late | 2.12% / 40.18% / 4.02% / ×18.99 | 2.45% / 46.58% / 4.66% / ×18.99 |
| inner-excursion-touch | oos-asset | 2.37% / 40.54% / 4.47% / ×17.14 | 2.80% / 47.95% / 5.29% / ×17.14 |
| inner-excursion-touch | oos-time | 2.80% / 46.41% / 5.28% / ×16.58 | 3.26% / 54.07% / 6.15% / ×16.58 |
| own2-reference | dev-early | 6.35% / 35.22% / 10.76% / ×5.55 | 7.04% / 39.04% / 11.92% / ×5.55 |
| own2-reference | dev-late | 6.88% / 35.16% / 11.50% / ×5.11 | 7.59% / 38.81% / 12.70% / ×5.11 |
| own2-reference | oos-asset | 6.50% / 33.23% / 10.88% / ×5.11 | 7.17% / 36.64% / 11.99% / ×5.11 |
| own2-reference | oos-time | 6.24% / 30.62% / 10.37% / ×4.90 | 7.12% / 34.93% / 11.83% / ×4.90 |

## OOS lift (cluster bootstrap over file/split units, ±1 F1)

- vs inner-excursion/touch: **-4.92%**, 95% CI [-6.52%, -3.43%].
- vs OWN2-reference: **-10.60%**, 95% CI [-12.74%, -8.77%].

## Exclusions from pooled inference

- BINANCE_AVAXUSDT, 5: low-TF (<15m): included descriptively, excluded from pooled inference because nested/dependent with higher-TF series (rows=20609, shapes=68).
- BINANCE_BNBUSDT, 1: low-TF (<15m): included descriptively, excluded from pooled inference because nested/dependent with higher-TF series (rows=23846, shapes=106).
- BINANCE_BNBUSDT, 10S: low-TF (<15m): included descriptively, excluded from pooled inference because nested/dependent with higher-TF series (rows=22032, shapes=47).
- BINANCE_BNBUSDT, 1S: low-TF (<15m): included descriptively, excluded from pooled inference because nested/dependent with higher-TF series (rows=30447, shapes=8).
- BINANCE_BNBUSDT, 5: low-TF (<15m): included descriptively, excluded from pooled inference because nested/dependent with higher-TF series (rows=20897, shapes=94).
- BINANCE_BNBUSDT.P, 1: low-TF (<15m): included descriptively, excluded from pooled inference because nested/dependent with higher-TF series (rows=22178, shapes=107).
- BINANCE_BNBUSDT.P, 5: low-TF (<15m): included descriptively, excluded from pooled inference because nested/dependent with higher-TF series (rows=20533, shapes=92).
- BINANCE_BTCUSDT, 5S: low-TF (<15m): included descriptively, excluded from pooled inference because nested/dependent with higher-TF series (rows=26824, shapes=15).
- BINANCE_BTCUSDT.P, 5: low-TF (<15m): included descriptively, excluded from pooled inference because nested/dependent with higher-TF series (rows=20532, shapes=82).
- BINANCE_ETHUSDT, 1: low-TF (<15m): included descriptively, excluded from pooled inference because nested/dependent with higher-TF series (rows=23844, shapes=116).
- BINANCE_ETHUSDT, 1S: low-TF (<15m): included descriptively, excluded from pooled inference because nested/dependent with higher-TF series (rows=30205, shapes=10).
- BINANCE_ETHUSDT, 5: low-TF (<15m): included descriptively, excluded from pooled inference because nested/dependent with higher-TF series (rows=20897, shapes=89).
- BINANCE_ETHUSDT, 5S: low-TF (<15m): included descriptively, excluded from pooled inference because nested/dependent with higher-TF series (rows=26336, shapes=40).
- BINANCE_ONDOUSDT, 5: low-TF (<15m): included descriptively, excluded from pooled inference because nested/dependent with higher-TF series (rows=20610, shapes=95).
- BINANCE_VIRTUALUSDT, 5: low-TF (<15m): included descriptively, excluded from pooled inference because nested/dependent with higher-TF series (rows=20593, shapes=107).
- BINANCE_VIRTUALUSDT.P, 5: low-TF (<15m): included descriptively, excluded from pooled inference because nested/dependent with higher-TF series (rows=20533, shapes=100).

_Features were computed after removing BUY/SELL fields; labels were joined only for scoring._
