# GGI public-series probe result v1

## Inputs

- `BINANCE_BTCUSDT, 15 (3).csv`: original GGI plus public-series probe.
- `BINANCE_BTCUSDT, 15 (4).csv`: original GGI only.
- Market: Binance BTCUSDT Spot, 15m.
- Rows: 5,520 in each export.
- Exact common timestamps: 5,520.
- Export range: 2026-06-05 00:45 UTC through 2026-08-01 12:50 UTC.

Probe mapping supplied by the user:

```text
Probe 1 = GGI BUY
Probe 2 = GGI SELL
Probe 3 = first Shapes
Probe 4 = second Shapes
Probe 5 = GGI Mean
Probe 6 = GGI Upper Inner
```

## Integrity check

Across all 5,520 common rows, the two exports have zero differences in:

- timestamp;
- OHLC;
- GGI Mean;
- all four Apex bands;
- both original Shapes series.

Adding the probe did not alter or repaint the original indicator outputs.

## Signal-series result

Counts:

| Series | Non-zero rows |
|---|---:|
| First Shapes | 15 |
| Second Shapes | 15 |
| Probe 1 / BUY | 15 |
| Probe 2 / SELL | 15 |
| Probe 3 / first Shapes | 15 |
| Probe 4 / second Shapes | 15 |

Exact timestamp equality:

```text
Probe 1 / BUY          == first Shapes  == Probe 3   on all 5,520 rows
Probe 2 / SELL         == second Shapes == Probe 4   on all 5,520 rows
```

Every non-zero value in all four probe signal series is exactly `1`. No earlier raw condition, score, price payload, armed state or distinct pre-filter event is present.

## Conclusion

The selectable `BUY` and `SELL` outputs are aliases of the two final Shapes, not separate internal stages. The `input.source()` route is now exhausted for this build of GGI Buy/Sell.

The private indicator publicly exposes only:

- GGI Mean;
- four Apex bands;
- final BUY boolean;
- final SELL boolean.

It does not expose a score, threshold, oscillator, raw trigger, armed/pending state, cooldown counter or HTF component.

## Next informative black-box experiment

Do not request more exports with identical settings for extraction purposes. The next useful experiment is controlled perturbation of the original indicator's available Inputs:

1. Keep market, timeframe, date range and all other settings fixed.
2. Change exactly one GGI input.
3. Export the same range for baseline and altered value.
4. Diff exact BUY/SELL timestamps.
5. Classify each parameter by its effect on signal count, timing, distance from Apex and minimum inter-signal gap.

Before constructing the matrix, capture the complete GGI Inputs tab, including current values and every dropdown/range limit.
