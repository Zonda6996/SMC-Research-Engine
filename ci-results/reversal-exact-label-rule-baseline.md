# Exact-label Reversal rule baseline

- Data: original TradingView labels, Bybit BTCUSDT.P 15m + 1h.
- Split: first 70% of each TF train, last 30% test.
- Every zero Shape row is an exact negative for its direction.
- Simple rules only; no production changes.

| Rule | Split | TP | FP | FN | Precision | Recall | F1 |
|---|---|---:|---:|---:|---:|---:|---:|
| directional | train | 42 | 9438 | 0 | 0.44% | 100.00% | 0.88% |
| directional | test | 23 | 4084 | 0 | 0.56% | 100.00% | 1.11% |
| dir+inside | train | 42 | 4365 | 0 | 0.95% | 100.00% | 1.89% |
| dir+inside | test | 23 | 1861 | 0 | 1.22% | 100.00% | 2.41% |
| dir+touch2 | train | 23 | 772 | 19 | 2.89% | 54.76% | 5.50% |
| dir+touch2 | test | 10 | 396 | 13 | 2.46% | 43.48% | 4.66% |
| dir+inside+rsiRecover | train | 37 | 3306 | 5 | 1.11% | 88.10% | 2.19% |
| dir+inside+rsiRecover | test | 20 | 1422 | 3 | 1.39% | 86.96% | 2.73% |
| dir+inside+stochRecover | train | 41 | 4143 | 1 | 0.98% | 97.62% | 1.94% |
| dir+inside+stochRecover | test | 23 | 1769 | 0 | 1.28% | 100.00% | 2.53% |
| dir+touch2+rsiRecover | train | 21 | 649 | 21 | 3.13% | 50.00% | 5.90% |
| dir+touch2+rsiRecover | test | 9 | 318 | 14 | 2.75% | 39.13% | 5.14% |
| dir+touch2+stochRecover | train | 23 | 755 | 19 | 2.96% | 54.76% | 5.61% |
| dir+touch2+stochRecover | test | 10 | 390 | 13 | 2.50% | 43.48% | 4.73% |
| dir+meanDist>.2 | train | 41 | 2057 | 1 | 1.95% | 97.62% | 3.83% |
| dir+meanDist>.2 | test | 21 | 997 | 2 | 2.06% | 91.30% | 4.03% |
| dir+meanDist>.4 | train | 19 | 736 | 23 | 2.52% | 45.24% | 4.77% |
| dir+meanDist>.4 | test | 6 | 403 | 17 | 1.47% | 26.09% | 2.78% |

## Meaning

This table finally separates reconstruction recall from false positives. A plausible vendor family must improve precision by orders of magnitude while retaining useful recall on both TF and untouched time holdout.
