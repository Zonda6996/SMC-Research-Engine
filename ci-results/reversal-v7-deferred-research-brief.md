# Reversal v7 deferred research brief

Status: recorded only. Do not run until the user explicitly resumes the cycle.

## Why this brief exists

New black-box mode exports and external review sharpened the next hypotheses. They should be preserved without starting another broad search prematurely.

## Stream A — vendor-fidelity reconstruction

### A1. Pure episode-age ablation

Test episode duration as an explicit state variable, independently of oscillator composites.

Definition per side:

```text
episode starts: first entry/touch into the side's Inner/extremity zone
episode age: current bar index - episode start index
repeat Inner touches: do not reset age
episode ends: causal return to Mean or a defined neutral zone
signal: candidate accepted inside an age eligibility/hazard window
```

Important distinction:

```text
episode age != bars since last Inner touch
```

Existing `ReversalEpisodeResearch.ts` partially implements this: `state.start` is set once and repeated touches do not reset it. However, the prior V2 search did not isolate episode age cleanly because:

- oscillator `armedExtreme` was required;
- confirmation was oscillator/directional/recovery-based;
- episodes expired at `maxEpisodeBars`;
- `minDwellBars` was only one parameter inside a large coupled grammar;
- no pure age-bin/hazard analysis was used as the main classifier.

Required clean analysis before any grid:

1. Construct episodes with reset only at Mean and, separately, a causal neutral-zone definition.
2. Compare label versus no-label episode-age distributions.
3. Estimate per-age-bin event hazard by side, asset and timeframe.
4. Test fixed age windows without oscillator or volume.
5. Add confirmation families only after age provides stable sealed/OOS separation.

### A2. Candidate stream with global bar lock

Risk minimum global gaps now show:

```text
3m: 54 bars
5m: 53 bars
15m: 54 bars
other corpus slices: approximately 52–60 bars
```

Search a narrow lock family, not a broad cooldown grid:

```text
52, 53, 54, 55, 56, 60 bars
```

The lock is global across BUY and SELL unless contradicted by a targeted ablation.

Architecture:

```text
active episode
→ causal candidate stream
→ first accepted candidate
→ emit once
→ global bar-count lock
→ re-arm after lock plus valid episode state
```

### A3. Volume-conditioned episode candidates

Volume must be tested on episode features, not as another weighted composite score.

Available volume:

- Official Bybit V5 Kline alignment: 100% timestamp coverage on all six exact datasets.
- New native TradingView Binance BTCUSDT Spot 15m export: 7,442 rows, no missing/zero Volume, 23 BUY and 17 SELL.

Candidate causal volume features:

- relative volume versus rolling median/EMA;
- volume z-score within the current episode;
- cumulative episode volume normalized by episode length;
- volume at episode extreme;
- volume contraction after extreme;
- expansion on recovery candidate;
- signed volume proxy using candle direction;
- volume percentile conditional on episode age.

Ablation order:

```text
episode age only
→ episode age + price recovery
→ episode age + one volume feature family
→ episode age + recovery + volume
```

Do not repeat V6's many-component score search.

### A4. Stateful Standard acceptance gate

Controlled comparisons across Spot 15m and Futures 3m/5m:

```text
Risk signals:     151
Standard signals:  97
Exact shared:      88
Risk-only:         63
Standard-only:      9
```

Model Standard before episode consumption:

```text
base candidate
→ Standard feasibility test
   accepted: emit, consume episode, start lock
   rejected: remain armed, evaluate later candidate
```

This is necessary to explain rare Standard-only later replacements.

Candidate causal feasibility features:

- reward available to Mean;
- reward available to target band/zone boundary;
- stop distance to episode extreme, zone invalidation or causal swing;
- reward/risk ratio under fixed target rules;
- add-entry feasibility;
- same-bar ordering among stop/add/partial/full-fix levels.

Do not use future realized outcome to decide whether a signal exists.

## Stream B — independent edge research

### B1. Outer-touch directional strategy

Keep completely separate from vendor-trigger reconstruction.

Externally reported hypothesis:

```text
BUY: Outer touch + bullish candle
forward horizon: 10–20 bars
reported BTC 15m win rate: 66–77%, n=62
with cooldown around 55–100 bars: 68–80%, n=15–19
```

This does not contradict zero current/previous Outer touch on vendor label bars. It proposes an independent strategy the vendor apparently does not use.

Before accepting it:

1. Reproduce exact entry and exit definitions.
2. Use one-to-one trades and adverse same-bar ordering.
3. Include fees, slippage and funding where applicable.
4. Report expectancy and R distribution, not win rate alone.
5. Run chronological fit/validation/sealed and asset/TF holdouts.
6. Compare no-cooldown versus predeclared cooldowns without selecting on test data.

## Data integrity note — native Binance Volume export

`BINANCE_BTCUSDT, 15 (9).csv`:

```text
rows: 7,442
range: 2026-05-16 00:15 UTC — 2026-08-01 12:30 UTC
BUY: 23
SELL: 17
Volume coverage: 100%
Volume zero rows: 0
```

It contains the previous 5,520-row Binance Spot 15m export as an exact historical subset:

- label differences: 0;
- OHLC/Apex differences: only the last candle that was still updating in the older export.

The file is suitable as a native-volume development slice. It must remain separate from Bybit Futures and from profitability claims.

## Exit condition for the next cycle

A V7 candidate may advance only if it improves sealed/OOS event matching over V4 without count inflation and passes the existing production gate. Otherwise production Reversal remains unchanged.
