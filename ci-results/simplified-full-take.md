# Simplified full-take replay

- Identical entries/stops across variants; only post-entry exit changes.
- Train `< 2025-01-01`; test `>= 2025-01-01`.
- Net cost: 0.10% of entry price per trade.
- Selection: highest train mean after removing the best 1% trades; test was not used.

| variant | family | train n | train E | train E ex-top1% | test n | test E | test ex-top1% | test PF | test DD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline-12R | baseline | 3856 | 0.076R | -0.016R | 1449 | 0.104R | 0.010R | 1.457 | 49.410R |
| trail-2atr | trail | 3856 | 0.034R | 0.010R | 1449 | 0.075R | 0.051R | 1.328 | 12.098R |
| trail-4atr | trail | 3856 | 0.048R | 0.011R | 1449 | 0.089R | 0.046R | 1.391 | 13.274R |
| trail-6atr | trail | 3856 | 0.056R | 0.010R | 1449 | 0.092R | 0.044R | 1.406 | 13.325R |
| time-96 | time | 3856 | 0.059R | 0.016R | 1449 | 0.093R | 0.049R | 1.408 | 13.362R |
| time-192 | time | 3856 | 0.059R | 0.001R | 1449 | 0.078R | 0.030R | 1.344 | 14.615R |
| time-384 | time | 3856 | 0.067R | -0.007R | 1449 | 0.074R | 0.015R | 1.324 | 22.873R |
| partial2-2R | partial2 | 3856 | 0.071R | 0.005R | 1449 | 0.101R | 0.034R | 1.445 | 33.421R |
| partial2-4R | partial2 | 3856 | 0.076R | 0.004R | 1449 | 0.108R | 0.035R | 1.472 | 36.921R |
| partial2-6R | partial2 | 3856 | 0.075R | -0.002R | 1449 | 0.100R | 0.022R | 1.439 | 40.410R |
| opposite-zone | opposite-zone | 3856 | 0.041R | 0.012R | 1449 | 0.084R | 0.057R | 1.369 | 11.440R |
| opposite-choch | structure | 3856 | 0.089R | -0.003R | 1449 | 0.075R | -0.010R | 1.328 | 28.062R |

## Train-selected family winners

- baseline: **baseline-12R** — train -0.016R ex-top1%; test 0.104R, ex-top1% 0.010R.
- trail: **trail-4atr** — train 0.011R ex-top1%; test 0.089R, ex-top1% 0.046R.
- time: **time-96** — train 0.016R ex-top1%; test 0.093R, ex-top1% 0.049R.
- partial2: **partial2-2R** — train 0.005R ex-top1%; test 0.101R, ex-top1% 0.034R.
- opposite-zone: **opposite-zone** — train 0.012R ex-top1%; test 0.084R, ex-top1% 0.057R.
- structure: **opposite-choch** — train -0.003R ex-top1%; test 0.075R, ex-top1% -0.010R.
