# Reversal state-machine negative check v0.1

- Negative window: approximate visible SOLUSDT Spot 5m segment 2026-07-19 12:00 → 2026-07-20 21:00 Kazakhstan.
- Exact screenshot boundaries are not available; this is sensitivity analysis, not a confirmed precision score.
- Positive events: 11; no outcomes or external data used.

| n | move | body ratio | expiry | positive hits | recall | total generated | generated in no-signal window |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 48 | 1.0% | 1 | 8 | 1 | 9.1% | 225 | 8 |
| 48 | 1.0% | 1 | 16 | 1 | 9.1% | 228 | 8 |
| 48 | 0.6% | 1 | 8 | 3 | 27.3% | 349 | 15 |
| 48 | 0.6% | 1 | 16 | 3 | 27.3% | 353 | 15 |

## Conclusion

The state machine removes most raw OHLCV noise, but it is not accepted: even a candidate with useful positive recall must produce zero or very few signals in the confirmed no-signal area and then pass an untouched symbol/TF check. The current window is approximate, so exact screenshot boundaries remain necessary for a final precision judgment.
