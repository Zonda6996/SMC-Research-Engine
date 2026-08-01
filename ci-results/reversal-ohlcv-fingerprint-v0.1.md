# Reversal OHLCV fingerprint v0.1

- Only standard chart OHLCV is used: no external data, no outcome, no future bars.
- Feed: Binance Spot archives.
- Positive events matched: 11.
- This is a feature fingerprint, not a fitted detector.

## Signal-bar feature table

| ID | Dir | Mode | RSI14 | Stoch14 | MFI14 | CCI20 | ROC12 | VolZ50 | Apex mean dist | Long outer pen | Short outer pen |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| btc-12 | short | safe | 48.9 | 0.570 | 58.7 | 48.5 | 0.0034% | -38.4138 | 0.3443% | -1.222% | -0.4696% |
| btc-13-buy | long | safe | 30.4 | 0.172 | 17.4 | -93.0 | -0.8394% | 41.973 | -1.2059% | -0.629% | -3.1165% |
| btc-13-sell | short | safe | 65.8 | 0.707 | 81.4 | 178.0 | 0.3527% | 262.1384 | 0.7524% | -2.7238% | -1.0502% |
| btc-14 | long | safe | 48.3 | 0.779 | 32.4 | 25.9 | 0.0603% | -73.4505 | -1.4864% | -2.4886% | -5.809% |
| btc-15 | short | safe | 67.1 | 0.795 | 78.8 | 57.2 | 1.318% | -61.3327 | 1.955% | -6.3271% | -2.4534% |
| btc-16 | long | safe | 60.3 | 0.653 | 34.5 | -14.7 | 0.0508% | 249.2056 | null% | null% | null% |
| btc-17-safe | long | safe | 55.7 | 0.737 | 47.5 | -42.2 | 0.3736% | 110.6074 | -1.686% | -1.0621% | -5.1049% |
| btc-18-risk | long | risk | 55.7 | 0.737 | 47.5 | -42.2 | 0.3736% | 110.6074 | -1.686% | -1.0621% | -5.1049% |
| eth-safe-sell | short | safe | 50.0 | 0.467 | 62.0 | 78.3 | 0.1581% | 320.2877 | 1.653% | -7.2997% | -3.6543% |
| sol-safe-sell-30m | short | safe | 50.8 | 0.548 | 42.9 | 43.8 | -0.0386% | -3.4411 | 1.8678% | -6.8126% | -2.832% |
| sol-safe-sell-5m | short | safe | 59.0 | 0.633 | 54.7 | 82.9 | 0.2027% | -78.5603 | 0.3016% | -1.408% | -0.7383% |

## Candidate families to test next

1. **Momentum recovery:** prior RSI/Stoch/MFI extreme followed by recovery and directional candle.
2. **Exhaustion candle:** body contraction, wick asymmetry and close location after a 6–24 bar impulse.
3. **Rolling-range reversal:** signal near a 20–50 bar extreme, but not necessarily at Apex outer edge.
4. **Volume confirmation:** volume spike or volume contraction during a failed continuation.
5. **Divergence:** price extreme versus oscillator extreme using only confirmed prior swings; no future pivot labels.
6. **Delayed pivot family:** explicit separation between a causal signal and a visually back-shifted Pine label.

No candidate is promoted without matched no-signal bars and OOS validation.
