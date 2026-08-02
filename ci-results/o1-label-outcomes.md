# O1 post-label outcome statistics

Pre-registration: `o1-label-outcomes-preregistration.md`. R = ATR14 of label bar; horizon 96 bars; intrabar tie counted ADVERSE; random-bar control matched per dataset (seed 4242). NOT a backtest of vendor exit logic.

## Pooled (14 datasets, BTC-b2 overlap excluded)

| cohort | n | ft 0.5R | ft 1R | ft 1.14R | ft 1.5R | ft 2R | med MFE | med MAE | reached +1R | med bars to +1R | mean R@24 | mean R@96 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| labels | 692 | 48.7% | 52.9% | 51.2% | 51.0% | 51.7% | 4.24 | 4.05 | 87.7% | 5 | 0.231 | 0.245 |
| random control | 692 | 50.1% | 52.3% | 51.6% | 52.7% | 49.8% | 4.63 | 4.29 | 90.2% | 5 | -0.031 | -0.100 |
| labels LONG | 382 | 50.0% | 52.4% | 50.5% | 50.3% | 52.6% | 4.42 | 4.48 | 88.2% | 5 | 0.481 | 0.545 |
| labels SHORT | 310 | 47.1% | 53.5% | 51.9% | 51.9% | 50.6% | 3.82 | 3.71 | 87.1% | 5 | -0.078 | -0.121 |
| labels 1m-5m | 169 | 52.1% | 55.0% | 54.4% | 56.2% | 55.6% | 4.14 | 4.37 | 88.8% | 5 | 0.212 | 0.114 |
| labels 15m | 270 | 51.9% | 56.3% | 53.0% | 48.9% | 48.5% | 3.96 | 4.38 | 87.4% | 4 | -0.027 | 0.091 |
| labels 1h-2h | 253 | 43.1% | 47.8% | 47.0% | 49.8% | 52.6% | 4.43 | 3.70 | 87.4% | 5 | 0.518 | 0.497 |

## Per dataset (labels vs control)

| dataset | pool | n | ft 1R | ft 2R | med MFE | med MAE | ctrl ft 1R | ctrl ft 2R |
|---|---|---|---|---|---|---|---|---|
| btc-perp-15m | yes | 69 | 58.0% | 46.4% | 3.59 | 5.16 | 56.5% | 60.9% |
| btc-perp-1h | yes | 44 | 43.2% | 43.2% | 4.56 | 4.74 | 54.5% | 56.8% |
| eth-perp-15m | yes | 75 | 49.3% | 48.0% | 4.80 | 3.82 | 46.7% | 50.7% |
| sol-spot-15m | yes | 63 | 57.1% | 47.6% | 3.80 | 5.07 | 50.8% | 53.2% |
| btc-perp-5m | yes | 81 | 53.1% | 53.1% | 3.46 | 4.37 | 59.3% | 50.0% |
| btc-perp-4h | yes | 38 | 52.6% | 52.6% | 4.18 | 3.85 | 47.4% | 44.7% |
| btc-perp-15m-b2 | no | 85 | 60.0% | 47.1% | 4.05 | 4.81 | 52.9% | 44.4% |
| btc-perp-1h-b2 | no | 40 | 42.5% | 42.5% | 4.41 | 4.74 | 50.0% | 45.0% |
| btc-perp-2h-b2 | yes | 43 | 41.9% | 58.1% | 4.16 | 5.11 | 48.8% | 48.8% |
| ondo-perp-15m-b2 | yes | 63 | 61.9% | 52.4% | 4.42 | 3.76 | 44.4% | 42.9% |
| ondo-perp-1h-b2 | yes | 82 | 53.7% | 54.9% | 4.66 | 2.96 | 56.1% | 50.6% |
| ondo-perp-2h-b2 | yes | 46 | 43.5% | 52.2% | 4.52 | 3.54 | 56.5% | 47.8% |
| bnb-perp-3m-b2 | yes | 46 | 67.4% | 65.2% | 5.35 | 5.22 | 47.8% | 39.1% |
| sp500-cfd-1m-b2 | yes | 42 | 45.2% | 50.0% | 5.12 | 3.66 | 54.8% | 45.2% |
## Interpretation notes (post-run, appended once)

1. The symmetric firstTouch race (+kR vs -kR) shows NO edge at any k: labels
   52.9% vs control 52.3% at 1R, and similar throughout the ladder. In these
   markets a +-1R ATR race from any bar is close to a coin flip, and the label
   bars are no different. The vendor table's 80-96% "winrates" are therefore NOT
   explained by entry timing alone - they must be produced by the exit machinery
   (partial fix, break-even moves, trailing) riding on top of the properties below.
2. The REAL measurable edge is directional drift: mean terminal R@24 = +0.231 and
   R@96 = +0.245 for labels vs -0.031 / -0.100 for the random control (a ~0.26-0.35 R
   gap per signal). The label points in the right direction on average, but the
   path there is volatile (median MAE 4.05 R at horizon 96 - almost equal to median
   MFE 4.24 R). This is a drift signal, not a clean-run signal.
3. Splits: LONG labels carry most of the drift (+0.481/+0.545 R) while SHORT is
   slightly negative (-0.078/-0.121 R) over these mostly-rising sample periods; the
   1h-2h class has the best drift (+0.518/+0.497 R) and the LOWEST small-k touch
   rates, i.e. HTF labels are early and get chopped before moving - consistent with
   the author's own note about positions surviving noise to reach target.
4. Practical reading (not advice, measurement): the raw label at close is worth
   ~+0.2-0.5 R of drift depending on TF/side; any realized winrate above coin-flip
   levels must come from exit management. This closes the question "is the entry
   itself the magic?" - it is not; the entry is a modest directional bias plus the
   vendor's exit logic.
