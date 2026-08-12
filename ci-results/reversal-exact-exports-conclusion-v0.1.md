# Reversal exact exports — conclusion v0.1

Дата: 2026-08-01

## Dataset

TradingView original GGI Buy/Sell + built-in GGI Zone, Bybit BTCUSDT perpetual:

| TF | Rows | BUY | SELL | Exact negative directional labels |
|---|---:|---:|---:|---:|
| 15m | 8426 | 26 | 16 | 16,810 minus positives |
| 1h | 5266 | 15 | 8 | 10,509 minus positives |
| Total | 13,692 | 41 | 24 | 27,319 directional row-label pairs |

Shapes mapping is user-confirmed: Shape 0 = BUY, Shape 1 = SELL.

## First honest reconstruction baseline

A time split was applied independently on each TF: first 70% train, last 30% untouched test.

Naive rules are decisively rejected:

- directional candle: 100% recall but only 0.44% train / 0.56% test precision;
- directional + inside own side of GGI mean: 100% recall, 0.95% / 1.22% precision;
- directional + inner touch current/previous bar: 54.8% / 43.5% recall, 2.89% / 2.46% precision;
- directional + inner touch + RSI recovery: 50.0% / 39.1% recall, 3.13% / 2.75% precision;
- distance from mean thresholds also remain around 1–2% precision.

Therefore Reversal is not a per-bar threshold classifier. It must include a rare state and/or side cooldown/re-arm that suppresses thousands of otherwise identical directional bars.

## Strongest structural clues now supported by exact data

1. All 65 labels are directly available; screenshots are no longer required for basic direction/timestamp.
2. Both 15m and 1h can be used jointly, so fitting to one TF is avoidable.
3. BUY and SELL frequency is asymmetric: 41 vs 24 in this date range.
4. Current/previous inner touch explains only part of signals, not all.
5. The likely missing mechanism is a state transition:

```text
extreme/visit/displacement state
→ delayed directional confirmation
→ emit once
→ lock side
→ re-arm only after neutral/mean/opposite condition
```

The next detector search should optimize event matching, not bar classification, and should preserve entire state-machine chronology.

## Apex/GGI Zone

Using exact exported GGI lines on both TF, the current width family remains strong. Cross-TF grid result:

- best candidate: devLookback 122, offset 0.625, sigma 4;
- average width MAE: 1.93%;
- 15m: 2.21%;
- 1h: 1.66%.

Current sigma 3.5 gives 2.16% average. Improvement is modest, so production defaults should not change until tested on another symbol or 4h/5m export.

## Recommendation

1. Keep these BTC 15m/1h exports as train/validation source.
2. Build one event-state reconstruction search with explicit re-arm/cooldown.
3. Hold out the final 30% and report event precision/recall/timing by TF.
4. After selecting one family, request one additional symbol export (ETH or SOL, preferably 15m) as true OOS.
5. Only then implement production Reversal.
6. Apex sigma 4 stays a candidate, not a default change.

The parallel redesign branch was not touched.
