# GGI active setup screenshots — v1

Дата обработки: 2026-08-03

## Результат

Оцифрован пакет из 11 активных GGI setup screenshots:

- ONDOUSDT.P 15m BUY: Safe / Risk / Standard;
- LTCUSDT.P 2h BUY: Safe / Risk;
- AVAXUSDT.P 1h BUY: Safe / Risk / Standard;
- BNBUSDT 15m SELL: Safe / Risk / Standard.

Значения распознаны с текущих PNG через локальный OCR и проверены по расположению ценовых меток и линий. Десятичные запятые приведены к точкам. Signal timestamp и current price не считаются надёжно извлечёнными: они не используются в формульных выводах этого отчёта.

## Машинный manifest

Полная запись находится в `ci-results/ggi-active-setups-v1.json`.

| ID | Mode | Entry | Stop | Add | Avg=(Entry+Add)/2 | Partial/Mean | Full target | Direction |
|---|---|---:|---:|---:|---:|---:|---:|---|
| ONDO 15m | Safe | 0.3715 | 0.3459 | 0.3588 | 0.36515 | 0.3795 | 0.3912 | BUY |
| ONDO 15m | Risk | 0.3715 | 0.3537 | 0.3629 | 0.36720 | 0.3795 | 0.3912 | BUY |
| ONDO 15m | Standard | 0.3714 | 0.3526 | 0.3607 | 0.36605 | — | 0.3935 | BUY |
| LTC 2h | Safe | 44.54 | 39.45 | 41.90 | 43.220 | 45.36 | 47.51 | BUY |
| LTC 2h | Risk | 44.54 | 41.01 | 42.78 | 43.660 | 45.36 | 47.51 | BUY |
| AVAX 1h | Safe | 6.184 | 5.563 | 5.874 | 6.029 | — | 6.738 | BUY |
| AVAX 1h | Risk | 6.184 | 5.754 | 5.970 | 6.077 | — | 6.738 | BUY |
| AVAX 1h | Standard | 6.184 | 5.723 | 5.919 | 6.0515 | — | 6.707 | BUY |
| BNB 15m | Safe | 588.33 | 600.02 | 594.18 | 591.255 | 585.79 | 579.92 | SELL |
| BNB 15m | Risk | 588.33 | 596.46 | 592.37 | 590.350 | 585.84 | 579.92 | SELL |
| BNB 15m | Standard | 588.33 | 597.02 | 593.31 | 590.820 | — | 578.39 | SELL |

### Dashboard totals

| Asset / TF | Mode | Trades | Winrate | Partial | Stop | Full fix | Standard Add | Standard Total R |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| ONDO 15m | Safe | 84 | 91.7% | 22 | 7 | 55 | — | — |
| ONDO 15m | Risk | 89 | 78.7% | 20 | 19 | 50 | — | — |
| ONDO 15m | Standard | 58 | 48.3% | 0 | 30 | 28 | 39 (67.2%) | -0.3R |
| LTC 2h | Safe | 84 | 90.5% | 24 | 8 | 52 | — | — |
| LTC 2h | Risk | 86 | 86.0% | 27 | 12 | 47 | — | — |
| AVAX 1h | Safe | 79 | 91.1% | 28 | 7 | 44 | — | — |
| AVAX 1h | Risk | 84 | 84.5% | 32 | 13 | 39 | — | — |
| AVAX 1h | Standard | 64 | 45.3% | 0 | 35 | 29 | 40 (62.5%) | -20.0R |
| BNB 15m | Safe | 81 | 90.1% | 30 | 8 | 43 | — | — |
| BNB 15m | Risk | 81 | 76.5% | 28 | 19 | 34 | — | — |
| BNB 15m | Standard | 54 | 42.6% | 0 | 31 | 23 | 37 (68.5%) | not reliably visible |

Dashboard arithmetic is internally consistent in all rows: `Trades = Partial + Stop + Full fix`, and `Winrate = (Partial + Full fix) / Trades`.

## Формульные проверки

### 1. Add

For 8 Safe/Risk observations, the add is essentially the midpoint between Entry and Stop:

```text
addFraction = abs(entry - add) / abs(entry - stop)
```

Observed fractions:

- ONDO Safe 0.4961; ONDO Risk 0.4831;
- LTC Safe 0.5187; LTC Risk 0.4986;
- AVAX Safe 0.4992; AVAX Risk 0.4977;
- BNB Safe 0.5004; BNB Risk 0.4969.

The mean is approximately 0.498. This is strong evidence for a midpoint add rule, not merely a visual approximation.

### 2. Safe/Risk stop relation

For all four matched Safe/Risk pairs:

```text
RiskStopDistance / SafeStopDistance
```

is:

- ONDO: 0.6953;
- LTC: 0.6935;
- AVAX: 0.6924;
- BNB: 0.6955.

Mean ratio: approximately 0.6942. The current evidence strongly supports:

```text
Risk stop distance ≈ 0.694 × Safe stop distance
```

or equivalently a Risk stop multiplier near `0.694` applied to the same underlying Safe risk distance. This identifies the Safe/Risk scaling relationship, but not the hidden base Safe volatility formula.

### 3. Standard stop relation

The observed Standard/Safe stop-distance ratios are approximately:

- ONDO: 0.734;
- AVAX: 0.742;
- BNB: 0.743.

This is consistent with a Standard stop distance near `0.74 × Safe stop distance`, but the sample is only three setups and the ONDO values are affected by screenshot rounding. Treat as a candidate scaling rule, not a final identification.

### 4. Standard target geometry

Using the visible initial entry and stop:

- ONDO Standard: target is approximately 1.18 initial R;
- AVAX Standard: approximately 1.13 initial R;
- BNB Standard: approximately 1.14 initial R.

After the 50/50 add, the blended target risk is close to 2R:

- ONDO: approximately 2.04R;
- AVAX: approximately 2.00R;
- BNB: approximately 2.00R.

This is strong cross-asset support for the previously observed Standard behavior:

```text
no add: approximately 1.14R
with 50/50 add: approximately 2R
```

The exact implementation may use rounded internal levels and a fixed target multiplier; screenshots alone do not distinguish whether the internal R is calculated before or after a stateful add gate.

## Важные оговорки

1. BNB screenshots are `BNBUSDT` on Binance Spot, while the supplied machine-readable BNB CSV is `BYBIT_BNBUSDT.P` 3m. They must not be merged into one replay dataset.
2. ONDO levels in this current screenshot batch are slightly different from the previously transcribed ONDO setup (`entry 0.3716`, `add 0.3605`, `stop 0.3459`, `fix25 0.3797`, `TP 0.3914`). This is consistent with the user’s note that Mean/bands and displayed management levels shifted. Both observations should remain separate setup snapshots.
3. The current images do not provide enough reliable information for signal timestamp, exact current price, candle OHLC, or causal ATR/swing features. Therefore they identify management geometry and mode scaling, not the base volatility formula.
4. The visible `fix25`/partial labels in AVAX and BNB indicate prior partial activity, but they do not by themselves prove whether the current stop was actually moved to BE or whether the add was filled.
5. The author’s hypothetical “hold to opposite zone without BE” statistic remains a separate accounting variant. It must not replace the confirmed actual rule `partial -> BE` in the primary replay.

## Текущий вывод

This package is a genuine advance. It does not yet recover the private stop formula, but it establishes two reusable black-box laws across 4 assets, 3 timeframes, both BUY and SELL directions:

1. `add ≈ midpoint(entry, stop)`;
2. `RiskDistance ≈ 0.694 × SafeDistance`.

It also independently confirms Standard target geometry near 1.14R without add and 2R with add. The next useful collection is not more screenshots of the same already-partial trade; it is 6–10 fresh setups before partial/add, ideally with exact signal timestamp and matching OHLC/CSV rows, so that the hidden Safe stop can be regressed against causal ATR/Apex/swing features.
