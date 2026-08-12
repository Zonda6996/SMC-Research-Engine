# GGI Risk vs Standard low-timeframe generalization v1

## Scope

Two exact Risk/Standard pairs were supplied for Bybit BTCUSDT perpetual:

| Timeframe | Rows per mode | UTC range |
|---|---:|---|
| 3m | 13,874 | 2026-07-03 14:57 — 2026-08-01 12:36 |
| 5m | 10,789 | 2026-06-25 01:35 — 2026-08-01 12:35 |

Within each timeframe, Risk and Standard exports have:

- exactly the same timestamps;
- strict uninterrupted chronology;
- exactly identical OHLC;
- exactly identical Mean and all four Apex bands.

Therefore every signal difference is caused by Risk Mode, not by feed/history drift.

Profitability is intentionally not evaluated here. BTC suitability for trading on 3m/5m and the number of stops do not affect the vendor-mechanism comparison.

## 3m result

| Side | Risk | Standard | Exact shared | Risk-only | Standard-only |
|---|---:|---:|---:|---:|---:|
| BUY | 33 | 23 | 20 | 13 | 3 |
| SELL | 32 | 16 | 15 | 17 | 1 |
| Total | 65 | 39 | 35 | 30 | 4 |

Interpretation:

- 35 of 39 Standard signals, or 89.7%, occur on the exact same bar and side in Risk.
- Standard retains 35 of 65 Risk signals, or 53.8%.
- Four Standard-only events show that Standard is not a mathematically strict subset on 3m.
- Some mode-only events occur near each other inside the same broad episode, but many are separated by hundreds of bars. Standard is predominantly a filter with occasional candidate reselection, not a simple fixed timing shift.

Signal gaps:

| Mode | Minimum global gap | Median global gap |
|---|---:|---:|
| Risk | 54 bars | 148.5 bars |
| Standard | 54 bars | 300 bars |

## 5m result

| Side | Risk | Standard | Exact shared | Risk-only | Standard-only |
|---|---:|---:|---:|---:|---:|
| BUY | 22 | 12 | 12 | 10 | 0 |
| SELL | 25 | 20 | 16 | 9 | 4 |
| Total | 47 | 32 | 28 | 19 | 4 |

Interpretation:

- 28 of 32 Standard signals, or 87.5%, occur on the exact same bar and side in Risk.
- Standard retains 28 of 47 Risk signals, or 59.6%.
- Standard BUY is a strict subset of Risk BUY on this sample.
- Four Standard-only SELL events again show occasional candidate reselection rather than a pure set filter.
- Two 5m SELL pairs are close mode-dependent replacements: 26 bars and 7 bars apart. Other replacements are much farther away.

Signal gaps:

| Mode | Minimum global gap | Median global gap |
|---|---:|---:|
| Risk | 53 bars | 191.5 bars |
| Standard | 67 bars | 292 bars |

## Combined with Binance BTC Spot 15m

The previously analyzed Spot 15m pair had:

```text
Risk:          39 signals
Standard:      26 signals
Exact shared:  25
Risk-only:     14
Standard-only:  1
```

Across all three controlled mode comparisons:

| Sample | Risk | Standard | Exact shared | Risk-only | Standard-only | Standard exact-share |
|---|---:|---:|---:|---:|---:|---:|
| Spot 15m | 39 | 26 | 25 | 14 | 1 | 96.2% |
| Futures 5m | 47 | 32 | 28 | 19 | 4 | 87.5% |
| Futures 3m | 65 | 39 | 35 | 30 | 4 | 89.7% |
| Combined | 151 | 97 | 88 | 63 | 9 | 90.7% |

Combined conclusions:

1. Standard emits substantially fewer signals: 97 versus 151 Risk signals.
2. 90.7% of Standard signals occur on the exact same timestamp and side in Risk.
3. Standard keeps 58.3% of Risk signals exactly.
4. Standard-only events are rare but real: 9 of 97 Standard signals.
5. Therefore Standard is not a strict subset globally, but it is overwhelmingly a downstream acceptance/filtering mode with occasional state-dependent candidate reselection.

## Strong new cooldown evidence

Risk minimum global gaps:

```text
3m: 54 bars
5m: 53 bars
15m: 54 bars
```

Earlier vendor datasets showed approximately 52–60 bars across other assets/timeframes. The new result is important because the minimum is stable in bars, not wall-clock time:

```text
3m × 54 bars  = 162 minutes
5m × 53 bars  = 265 minutes
15m × 54 bars = 810 minutes
```

This strongly supports an internal bar-count lock/cooldown or a construction that behaves equivalently. It argues against a fixed real-time timeout.

Standard minimum gaps are less stable because filtering removes events:

```text
3m: 54 bars
5m: 67 bars
15m: 88 bars
```

This does not require a separate Standard cooldown.

## Revised mode architecture

The evidence across Spot/Futures and 3m/5m/15m supports:

```text
shared long-memory reversal process
  -> first eligible base candidate under approximately 53–54-bar lock
  -> mode-specific feasibility/state gate
       Risk: accepts more candidates
       Standard: accepts roughly 58% exactly
       Standard: occasionally selects a different candidate within the evolving episode
  -> final BUY/SELL
  -> mode-specific trade management and dashboard outcomes
```

The occasional Standard-only signal means the gate cannot be implemented as a stateless boolean mask applied after all Risk labels are finalized. Mode likely participates before final one-shot selection: rejecting one candidate can leave the episode armed, allowing a later candidate that Risk cannot emit because Risk already consumed or locked the episode.

A more precise state interpretation is:

```text
base candidate stream
  -> mode-specific acceptance test
  -> if accepted: emit and consume/lock episode
  -> if rejected: remain armed and evaluate later candidates
```

This explains both dominant exact overlap and rare Standard-only replacements.

## Research consequence

For reconstructing vendor behavior:

1. Continue using Risk/Safe as the richer observable target for the hidden base process.
2. Explicitly impose/search a global bar-count lock around 53–54 bars, while validating 52–60 across datasets.
3. Model Standard as a stateful acceptance gate, not a post-hoc static filter.
4. Use rejected Risk-only and rare Standard-only events to infer trade-feasibility features.
5. Keep profitability separate: these 3m/5m exports are valuable mechanism data even if BTC performance on those timeframes is poor.

Candidate causal gate features remain:

- reward available to Mean and target band;
- stop distance to zone invalidation or recent swing;
- fixed target/stop ratio;
- add-entry feasibility;
- intrabar ordering among stop/add/partial/full-fix levels;
- whether rejection leaves the episode armed for a later candidate.
