# Reversal SOL 5m no-signal window sensitivity v0.1

- User statement: no Reversal signals on the shown SOL 5m segment around 20–21 July 2026.
- Screenshot boundaries are not exact; therefore two plausible windows are reported separately.
- Every counted trigger would be a false positive if the whole respective window truly had no vendor signal.
- Standard chart OHLCV only; no external data.

## 20–21 July, Kazakhstan calendar days

- Bars: 576

| Candidate | Fires | Per 100 bars |
|---|---:|---:|
| directional | 558 | 96.88 |
| directional + stochRecovery | 87 | 15.10 |
| directional + bodyContract | 234 | 40.63 |
| directional + mfiExtreme | 106 | 18.40 |
| directional + volumeBelowMean | 356 | 61.81 |
| directional + rsiRecovery | 50 | 8.68 |
| directional + stochRecovery + bodyContract | 32 | 5.56 |
| directional + stochRecovery + volumeBelowMean | 50 | 8.68 |
| directional + bodyContract + mfiExtreme | 46 | 7.99 |

## Approximate chart-visible segment 19 July 12:00 → 20 July 21:00 Kazakhstan

- Bars: 397

| Candidate | Fires | Per 100 bars |
|---|---:|---:|
| directional | 386 | 97.23 |
| directional + stochRecovery | 49 | 12.34 |
| directional + bodyContract | 158 | 39.80 |
| directional + mfiExtreme | 82 | 20.65 |
| directional + volumeBelowMean | 247 | 62.22 |
| directional + rsiRecovery | 34 | 8.56 |
| directional + stochRecovery + bodyContract | 21 | 5.29 |
| directional + stochRecovery + volumeBelowMean | 24 | 6.05 |
| directional + bodyContract + mfiExtreme | 39 | 9.82 |

## Interpretation

Any single-bar family that fires dozens of times in this no-signal window is structurally too weak, regardless of positive recall. The next viable detector must add a rarer multi-bar state: prior displacement/extreme, oscillator recovery, expiry/re-arm, and directional confirmation. Exact screenshot boundaries are still needed before declaring precision numerically.
