# GGI CSV signal match and Safe-stop diagnostics — v1

Дата: 2026-08-03

## 1. Четыре CSV точно попали в screenshots

Пользователь указал локальное время `По КЗ`, timezone `+05:00`. Во всех четырёх CSV найден row с точным временем и ожидаемым Shape:

| Asset | CSV | Time (+05:00) | Direction | Shape row | Signal OHLC |
|---|---|---|---|---|---|
| ONDOUSDT.P | BYBIT, 15m | 2026-08-03 08:45 | BUY | Shape0=1, Shape1=0 | 0.3704 / 0.3734 / 0.3685 / 0.3716 |
| AVAXUSDT.P | BYBIT, 1h | 2026-08-02 02:00 | BUY | Shape0=1, Shape1=0 | 6.145 / 6.188 / 6.143 / 6.183 |
| LTCUSDT.P | BYBIT, 2h | 2026-08-02 05:00 | BUY | Shape0=1, Shape1=0 | 44.21 / 44.67 / 44.10 / 44.54 |
| BNBUSDT | Binance Spot, 15m | 2026-08-03 03:45 | SELL | Shape0=0, Shape1=1 | 588.69 / 588.81 / 588.25 / 588.33 |

Это важный результат: уровни из screenshots можно теперь сравнивать с exact causal GGI lines на сигнальной свече без guessing timestamp.

## 2. Causal GGI geometry at signal

| Asset | Mean | Upper Inner | Upper Outer | Lower Inner | Lower Outer |
|---|---:|---:|---:|---:|---:|
| ONDO | 0.384931394 | 0.396337146 | 0.404690447 | 0.373853876 | 0.366137079 |
| AVAX | 6.430205356 | 6.724653261 | 6.943192715 | 6.148650245 | 5.955119296 |
| LTC | 45.851790154 | 48.181590797 | 49.917867011 | 43.634646045 | 42.116916972 |
| BNB | 583.551465127 | 589.286716327 | 593.417802449 | 577.872032840 | 573.849168804 |

The exact signal rows themselves have the expected label and the next-bar open is the natural market-entry candidate. Screenshot entry is approximately signal close / next open depending on platform state:

- ONDO screenshot entry 0.3715–0.3716;
- AVAX 6.184 vs signal close 6.183;
- LTC 44.54 = signal close;
- BNB 588.33 = signal close / next open.

## 3. Safe stop distances from screenshots

Using the first active setup screenshot batch:

```text
ONDO Safe: 0.3715 - 0.3459 = 0.0256
AVAX Safe: 6.184 - 5.563 = 0.621
LTC Safe: 44.54 - 39.45 = 5.09
BNB Safe: 600.02 - 588.33 = 11.69  (SELL)
```

## 4. Candidate formula checks

### ATR(55) diagnostic

A simple SMA true-range ATR with period 55 gives:

| Asset | ATR55 | Safe distance | Safe distance / ATR55 |
|---|---:|---:|---:|
| ONDO 15m | 0.00208909 | 0.0256 | 12.254 |
| AVAX 1h | 0.04978182 | 0.621 | 12.474 |
| LTC 2h | 0.40709091 | 5.09 | 12.503 |
| BNB 15m | 0.97945455 | 11.69 | 11.935 |

Mean multiplier is 12.292 and coefficient of variation is approximately 1.85% across this four-row sample.

A purely descriptive common fit is therefore:

```text
Safe stop distance ≈ 12.3 × SMA(True Range, 55)
```

Using 12.3 × ATR55, errors are approximately:

- ONDO +0.37%;
- AVAX -1.40%;
- LTC -1.63%;
- BNB +3.06%.

This is the first causal volatility candidate that transfers across the four supplied assets and both BUY/SELL directions. It is not yet the private formula: the sample has only four setups, screenshot levels are rounded, and the private indicator may use a different volatility definition or a smoothing state.

### Apex geometry

At the signal, distance from Entry to the opposite Outer line is not the Safe stop distance:

| Asset | Entry-to-opposite-Outer | Safe distance / it |
|---|---:|---:|
| ONDO | 0.00536292 | 4.774 |
| AVAX | 0.22888070 | 2.713 |
| LTC | 2.42308303 | 2.101 |
| BNB | 5.08780245 | 2.298 |

The ratio is not stable enough for the prior diagnostic `1.5 × entry-to-opposite-Outer` class to explain these active setup stops. That prior replay formula remains only a historical dashboard-fit diagnostic, not a stop formula conclusion.

Using the signal Mean-to-opposite-Outer band distance also does not produce a stable constant: Safe distance / half-zone-width is ONDO 1.362, AVAX 1.307, LTC 1.363, BNB 1.185.

### ATR + Apex combined fit

An unrestricted two-coefficient fit on only four observations is not evidence and is intentionally not accepted. It produced unstable coefficients and is retained only as a warning against overfitting. No combined formula is promoted.

## 5. Current verdict

This package materially advances the reconstruction:

1. All four screenshot timestamps are exact GGI label rows.
2. The Safe stop is strongly consistent with a long-horizon volatility distance on this sample; the cleanest simple candidate is `12.3 × SMA(TR,55)`.
3. Apex distance alone is falsified as the main Safe stop formula for these screenshots.
4. The 0.694 Risk/Safe multiplier from the screenshot-only matched pairs remains confirmed.
5. Next validation must use additional active setups and must compare the candidate without refitting:
   - at least 6–10 fresh setups;
   - both BUY and SELL;
   - preferably 2h/1h/15m;
   - exact timestamp and pre-management state.

No profitability claim is made at this stage. Funding, fees and slippage remain excluded.
