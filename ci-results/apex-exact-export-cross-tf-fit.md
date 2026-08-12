# Apex exact export cross-TF fit v0.1

- Exact original GGI lines on Bybit BTCUSDT.P 15m and 1h.
- Mean parameters remain current ALMA defaults; grid tests only width ALMA(TR/close) family.
- Candidate selected by average 15m+1h width error, not a single TF.
- No production defaults changed.

| # | devLookback | offset | sigma | Avg width MAE | 15m | 1h |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 122 | 0.625 | 4 | 1.93% | 2.21% | 1.66% |
| 2 | 150 | 0.75 | 4 | 2.14% | 2.26% | 2.02% |
| 3 | 122 | 0.625 | 3.5 | 2.16% | 2.50% | 1.82% |
| 4 | 100 | 0.625 | 3 | 2.54% | 2.40% | 2.68% |
| 5 | 150 | 0.75 | 3.5 | 2.81% | 3.04% | 2.59% |
| 6 | 122 | 0.75 | 3 | 2.88% | 2.90% | 2.86% |
| 7 | 122 | 0.625 | 3 | 2.90% | 3.24% | 2.56% |
| 8 | 100 | 0.5 | 3 | 3.01% | 3.33% | 2.69% |
| 9 | 200 | 0.75 | 6 | 3.12% | 3.42% | 2.82% |
| 10 | 100 | 0.625 | 3.5 | 3.23% | 2.99% | 3.46% |
| 11 | 100 | 0.5 | 3.5 | 3.36% | 3.65% | 3.07% |
| 12 | 122 | 0.75 | 3.5 | 3.45% | 3.25% | 3.65% |
| 13 | 150 | 0.85 | 3 | 3.64% | 3.74% | 3.55% |
| 14 | 200 | 0.85 | 4 | 3.75% | 3.92% | 3.57% |
| 15 | 200 | 0.85 | 6 | 3.81% | 3.55% | 4.06% |
| 16 | 150 | 0.85 | 3.5 | 3.88% | 3.79% | 3.97% |
| 17 | 150 | 0.75 | 3 | 3.92% | 4.10% | 3.75% |
| 18 | 150 | 0.75 | 6 | 3.93% | 3.67% | 4.19% |
| 19 | 100 | 0.5 | 4 | 4.02% | 4.29% | 3.75% |
| 20 | 100 | 0.625 | 4 | 4.12% | 3.83% | 4.40% |

This grid only tests the current width family. A low error is a calibration candidate, not proof of vendor internals.
