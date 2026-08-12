# Pine-compatible OHLCV trigger scan v0.1

- Inputs: chart OHLCV only; no external series and no trade outcomes.
- Positive sample: 11 exact matched events.
- This scan tests individual features only; it is not a fitted multi-factor detector.
- No production defaults changed.

| Family | Hit | n | Recall |
|---|---:|---:|---:|
| directional candle | 11 | 11 | 100.0% |
| Stochastic14 recovery | 6 | 11 | 54.5% |
| body contraction vs previous | 6 | 11 | 54.5% |
| MFI14 extreme | 5 | 11 | 45.5% |
| volume below mean | 5 | 11 | 45.5% |
| RSI14 recovery | 3 | 11 | 27.3% |
| 12-bar impulse reversal | 3 | 11 | 27.3% |
| volume z-score > 2 | 3 | 11 | 27.3% |
| RSI14 extreme | 2 | 11 | 18.2% |
| rolling range20 extreme | 2 | 11 | 18.2% |
| counter-wick > 50% | 2 | 11 | 18.2% |
| Stochastic14 extreme | 1 | 11 | 9.1% |
| CCI20 extreme | 1 | 11 | 9.1% |

## Caveat

A high recall feature is not sufficient: it may fire everywhere. Precision and matched no-signal false positives are the next gate. Thresholds here are broad diagnostic thresholds, not vendor claims.
