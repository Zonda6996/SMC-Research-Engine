# Reversal OHLCV combination scan v0.1

- Standard chart OHLCV only; no external series/outcome/future values.
- Positive exact sample: 11.
- This is exploratory recall, not a fitted vendor formula.

| Combination | Hit | n | Recall |
|---|---:|---:|---:|
| directional | 11 | 11 | 100.0% |
| stochRecovery | 6 | 11 | 54.5% |
| bodyContract | 6 | 11 | 54.5% |
| directional + stochRecovery | 6 | 11 | 54.5% |
| directional + bodyContract | 6 | 11 | 54.5% |
| mfiExtreme | 5 | 11 | 45.5% |
| volumeBelowMean | 5 | 11 | 45.5% |
| directional + mfiExtreme | 5 | 11 | 45.5% |
| directional + volumeBelowMean | 5 | 11 | 45.5% |
| rsiRecovery | 3 | 11 | 27.3% |
| stochRecovery + bodyContract | 3 | 11 | 27.3% |
| bodyContract + mfiExtreme | 3 | 11 | 27.3% |
| stochRecovery + volumeBelowMean | 3 | 11 | 27.3% |
| mfiExtreme + volumeBelowMean | 3 | 11 | 27.3% |
| directional + rsiRecovery | 3 | 11 | 27.3% |
| bodyContract + rsiRecovery | 3 | 11 | 27.3% |
| directional + stochRecovery + bodyContract | 3 | 11 | 27.3% |
| directional + bodyContract + mfiExtreme | 3 | 11 | 27.3% |
| directional + stochRecovery + volumeBelowMean | 3 | 11 | 27.3% |
| directional + mfiExtreme + volumeBelowMean | 3 | 11 | 27.3% |
| directional + bodyContract + rsiRecovery | 3 | 11 | 27.3% |
| wick | 2 | 11 | 18.2% |
| stochRecovery + mfiExtreme | 2 | 11 | 18.2% |
| bodyContract + volumeBelowMean | 2 | 11 | 18.2% |
| directional + wick | 2 | 11 | 18.2% |
| directional + stochRecovery + mfiExtreme | 2 | 11 | 18.2% |
| stochRecovery + bodyContract + mfiExtreme | 2 | 11 | 18.2% |
| directional + bodyContract + volumeBelowMean | 2 | 11 | 18.2% |
| bodyContract + mfiExtreme + volumeBelowMean | 2 | 11 | 18.2% |
| directional + stochRecovery + bodyContract + mfiExtreme | 2 | 11 | 18.2% |

## Interpretation

Combinations are only useful after precision is measured on matched no-signal windows and a held-out symbol/TF. No combination is promoted to production.
