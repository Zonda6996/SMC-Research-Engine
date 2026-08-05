# GGI independent validation batch v2

Дата: 2026-08-03

## Пакет

Получены 19 screenshots и 8 CSV для AAVE, LINK, DASH, 1000PEPE, DOGE, INJ и TAO. После получения недостающего 1000PEPE 1h CSV exact GGI labels найдены для всех основных screenshots:

- AAVE 2h BUY — 2026-08-02 05:00 +05;
- LINK 2h BUY — 2026-08-02 05:00 +05;
- LINK historical Standard BUY — 2026-07-28 19:00 +05;
- DASH 1h SELL — 2026-08-01 14:00 +05;
- 1000PEPE 15m BUY — 2026-08-03 12:15 +05;
- 1000PEPE 1h SELL — 2026-08-02 13:00 +05;
- DOGE 30m SELL — 2026-08-03 05:00 +05;
- INJ 1h current Safe SELL — 2026-08-03 01:00 +05;
- TAO 15m BUY — 2026-08-03 09:15 +05.

## Validation of the frozen Safe candidate

Frozen candidate from v1:

```text
SafeDistance = 12.3 × SMA(TrueRange,55)
```

No coefficient or period was refitted for this table.

| Setup | Observed multiplier D/ATR55 | Fixed candidate error |
|---|---:|---:|
| AAVE 2h BUY | 10.43 | +17.90% |
| LINK 2h BUY | 11.73 | +4.85% |
| DASH 1h SELL | 12.52 | -1.77% |
| PEPE 15m BUY | 13.06 | -5.81% |
| PEPE 1h SELL | 10.68 | +15.14% |
| DOGE 30m SELL | 13.56 | -9.26% |
| INJ 1h SELL | 9.21 | +33.58% |
| TAO 15m BUY | 13.44 | -8.45% |

### Verdict on Safe formula

The v1 formula is **not identified as the private Safe stop formula**. It transfers well on LINK/DASH and remains direction/timeframe-normalized, but independent errors on AAVE, DOGE, INJ and TAO are too large. Therefore:

- `12.3 × SMA(TR,55)` remains a useful volatility baseline;
- it must not be used as the final GGI reconstruction;
- a second causal factor or state-dependent multiplier is required;
- no new unrestricted fit should be accepted from only this batch.

The errors are structured rather than random: AAVE/INJ/PEPE 1h need a materially shorter distance than the frozen baseline; DOGE/TAO need a longer distance. The same PEPE asset sits on opposite sides of the baseline on 15m and 1h, which is direct evidence that a fixed cross-timeframe ATR multiplier is insufficient. This may indicate regime/state, band context, or another causal volatility normalization rather than one universal fixed ATR multiplier.

## What held up strongly

### Risk/Safe stop ratio

Matched same-signal ratios:

| Setup | Risk / Safe |
|---|---:|
| LINK 2h | 0.6924 |
| DASH 1h | 0.6948 |
| PEPE 15m | 0.6954 |
| PEPE 1h | 0.6939 |
| DOGE 30m | 0.6954 |
| TAO 15m | 0.6945 |

This independently confirms:

```text
RiskDistance ≈ 0.694 × SafeDistance
```

AAVE produces 0.715 and an abnormal add fraction, so that screenshot is retained as an anomaly/state issue rather than used to overturn five clean validations plus the original four.

### Safe/Risk add midpoint

Matched fractions `abs(entry-add)/abs(entry-stop)`:

- LINK 0.4976;
- DASH 0.5014;
- PEPE 15m 0.5033;
- PEPE 1h Safe 0.5000, Risk 0.4978;
- DOGE 0.5029;
- TAO 0.5025.

The midpoint rule is independently confirmed:

```text
Add ≈ midpoint(Entry, Stop)
```

TAO screenshot also visibly confirms that Risk add was actually filled (`add 2x` state). After that event the position must use blended average.

## Mode discrepancies

### INJ

The user's observation is correct: the current Risk SELL shown near 2026-07-31 06:00 is not the current Safe SELL at 2026-08-03 01:00. The CSV contains a SELL label at 2026-08-03 01:00, but the Safe/Risk screenshots are centered on different signals.

This is not yet proven to be a bug. Plausible explanations:

1. mode-specific state/gating affects whether a label remains active/displayed;
2. an unresolved earlier Risk trade blocks or supersedes the later candidate;
3. visual active-position rendering is not the same thing as raw label history;
4. the dashboard/mode implementation maintains different trade state even when the underlying exported raw labels are common.

Conclusion: Risk and Safe cannot be assumed to expose identical active labels in every state, despite usually sharing the same raw candidates.

### LINK Standard

The current Safe/Risk setup is the 2026-08-02 05:00 BUY. Standard did not accept/display it. The Standard screenshot instead shows the earlier 2026-07-28 19:00 BUY, which is visible historically in Safe/Risk and has already completed there.

This supports the existing conclusion that Standard is a stateful feasibility/acceptance gate rather than a simple alternate stop applied to every Safe/Risk label.

### PEPE 1h

Недостающий 1h CSV получен. Скриншоты точно соответствуют SELL label `2026-08-02 13:00 +05`:

```text
Entry       0.002912
Safe stop   0.003242
Risk stop   0.003141
Safe add    0.003077
Risk add    0.003026
Partial     0.002811
Full target 0.002649
```

Получено `Risk/Safe = 0.6939`, Safe add fraction `0.5000`, Risk add fraction `0.4978`. Это ещё одна чистая независимая репликация двух устойчивых management-правил. Однако Safe multiplier равен только `10.68 × ATR55`, и baseline `12.3 × ATR55` переоценивает stop distance на `15.14%`. Поэтому PEPE 1h усиливает отрицательный verdict для универсальной ATR55-формулы, но не является отрицательным verdict для самих SELL-сигналов.

## Dashboard consistency

All visible Safe/Risk rows continue to satisfy:

```text
Trades = Partial + Stop + Full fix
Winrate = (Partial + Full fix) / Trades
```

Standard rows have `Partial = 0`, plus separate Add and Total R counters. PEPE 15m Standard has negative total R despite 46.7% full-fix rate, reinforcing that win rate alone is not profitability.

## Current model status

Confirmed with strong multi-asset evidence:

```text
RiskDistance ≈ 0.694 × SafeDistance
Safe/Risk Add ≈ midpoint(Entry, Stop)
Standard is a stateful acceptance/management mode
```

Not identified:

```text
Base Safe stop formula
Exact mode-specific signal/display state
Exact BE activation semantics
```

Next research should focus on explaining the Safe-distance residual relative to the volatility baseline using a small preregistered set of causal state features, not by searching arbitrary periods and coefficients.
