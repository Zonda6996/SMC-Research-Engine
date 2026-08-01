# Reversal OHLCV state-machine scan v0.1

- Standard chart OHLCV only; no external series/outcome/future values.
- Positive exact events: 11.
- The state machine requires prior displacement + rolling extreme, then recovery/directional/body condition within bounded memory.
- Results are research-only; no production defaults changed.

| n | move | tol | body ratio | expiry | Stoch | RSI | hit | recall | generated |
|---:|---:|---:|---:|---:|---|---|---:|---:|---:|
| 48 | 1.0% | 0.0% | 1 | 8 | N | N | 7 | 63.6% | 506 |
| 48 | 1.0% | 0.0% | 1 | 16 | N | N | 7 | 63.6% | 514 |
| 48 | 0.6% | 0.0% | 1 | 8 | N | N | 7 | 63.6% | 673 |
| 48 | 0.6% | 0.0% | 1 | 16 | N | N | 7 | 63.6% | 682 |
| 48 | 1.0% | 0.0% | 0.85 | 8 | N | N | 6 | 54.5% | 497 |
| 48 | 1.0% | 0.0% | 0.85 | 16 | N | N | 6 | 54.5% | 506 |
| 48 | 0.6% | 0.0% | 0.85 | 8 | N | N | 6 | 54.5% | 654 |
| 48 | 0.6% | 0.0% | 0.85 | 16 | N | N | 6 | 54.5% | 667 |
| 24 | 0.6% | 0.0% | 1 | 8 | N | N | 6 | 54.5% | 844 |
| 24 | 0.6% | 0.0% | 1 | 16 | N | N | 6 | 54.5% | 864 |
| 24 | 1.0% | 0.0% | 0.85 | 8 | N | N | 5 | 45.5% | 506 |
| 24 | 1.0% | 0.0% | 1 | 8 | N | N | 5 | 45.5% | 518 |
| 24 | 1.0% | 0.0% | 0.85 | 16 | N | N | 5 | 45.5% | 520 |
| 24 | 1.0% | 0.0% | 1 | 16 | N | N | 5 | 45.5% | 531 |
| 24 | 0.6% | 0.0% | 0.85 | 8 | N | N | 5 | 45.5% | 811 |
| 24 | 0.6% | 0.0% | 0.85 | 16 | N | N | 5 | 45.5% | 835 |

## Interpretation

The key next comparison is generated signal count on the SOL 20–21 July no-signal window. Positive recall alone is not enough. A candidate must retain recall while producing no or very few signals inside that window, then survive an untouched symbol/TF check.
