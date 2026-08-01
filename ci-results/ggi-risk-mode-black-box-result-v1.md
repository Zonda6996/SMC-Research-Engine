# GGI Risk Mode black-box result v1

## Datasets

| Mode | File | Rows | BUY | SELL | UTC range |
|---|---|---:|---:|---:|---|
| Safe | `BINANCE_BTCUSDT, 15 (4).csv` | 5,520 | 15 | 15 | 2026-06-04 23:45 — 2026-08-01 11:30 |
| Risk | `BINANCE_BTCUSDT, 15 (6).csv` | 6,998 | 23 | 16 | 2026-05-20 14:45 — 2026-08-01 12:00 |
| Standard | `BINANCE_BTCUSDT, 15 (7).csv` | 7,031 | 12 | 15 | 2026-05-20 06:30 — 2026-08-01 12:00 |

All files have strict 15-minute chronology. Risk and Standard share 6,998 exact rows and identical OHLC/Apex values. All three share 5,520 rows. Safe differs from the newer exports only on the last still-updating candle; the historical comparison is otherwise feed-identical.

## Safe versus Risk

On all 5,520 common rows:

```text
Safe BUY  == Risk BUY  exactly:  15 / 15
Safe SELL == Risk SELL exactly:  15 / 15
```

Every timestamp is identical. Counts, nearest timing and gaps are therefore identical.

This rejects the hypothesis that Safe and Risk change signal sensitivity, entry threshold, confirmation timing, cooldown or re-arm. In this build and sample, Safe/Risk select the same entries.

The dashboard difference between Safe and Risk must consequently come from downstream trade management and outcome classification, not from different BUY/SELL labels.

User-provided management semantics:

- Safe/Risk use dynamic exits.
- Partial: 25% fixed at Mean.
- Full fix: near the beginning of the corresponding GGI band/zone.
- Safe and Risk show different win rates despite identical entries, consistent with different stop/exit risk management.

## Standard versus Risk on 6,998 common rows

### BUY

```text
Risk BUY:       23
Standard BUY:   12
Exact shared:   12
Risk-only:      11
Standard-only:   0
```

For BUY:

```text
Standard BUY ⊂ Risk BUY
```

Standard is an exact filter of Risk BUY entries, not an earlier/later timing variant.

### SELL

```text
Risk SELL:      16
Standard SELL:  14
Exact shared:   13
Risk-only:       3
Standard-only:   1
```

The one Standard-only SELL occurs at `2026-06-10 17:15 UTC`. The nearest Risk SELL is 108 bars later at `2026-06-11 20:15 UTC`. This is consistent with a different candidate being selected within an episode, potentially because trade geometry invalidated the later/earlier setup under one mode.

### Aggregate

```text
Risk signals:      39
Standard signals:  26
Exact shared:      25
Risk-only:         14
Standard-only:      1
```

Standard preserves 25 of its 26 signals exactly. It primarily filters Risk entries rather than shifting them.

## Cooldown evidence

On the shared Safe range:

| Mode | Minimum global gap | Median global gap |
|---|---:|---:|
| Safe | 54 bars | 151 bars |
| Risk | 54 bars | 151 bars |
| Standard | 88 bars | 210 bars |

The larger Standard gap is mostly explained by signal filtering. It does not prove that Standard has a longer internal cooldown.

## Dashboard evidence

The screenshots show mode-specific trade outcome tables.

Observed examples:

- one table: 59 trades, 42.4% win rate, 25 full fixes, 34 stops, total `-6.5R`;
- another table: 89 trades, 80.9% win rate, 47 full fixes, 25 partials, 17 stops.

The dashboard counts are not equal to the 30–39 labels in the current CSV range, so the table likely covers a different loaded/history window or counts trade-management events under its own scope. It must not be used as direct evidence of signal counts until the exact table period is controlled.

User-provided Standard semantics:

- fixed target logic;
- approximately `1.14R` without an add;
- approximately `2R` with an add;
- entries may be rejected when the required reward/risk geometry is not available.

This explanation is consistent with the CSV result: Standard mostly keeps a subset of Risk signals at identical timestamps.

## Revised architecture hypothesis

Risk Mode should not be modeled as three unrelated Reversal generators.

A more defensible architecture is:

```text
base reversal candidate/state machine
  -> mode-specific trade-feasibility gate
  -> final BUY/SELL label
  -> mode-specific stop/add/partial/full-fix management
  -> dashboard outcomes
```

Likely mode behavior:

- Safe and Risk: same entry generator in this sample, different risk/trade management.
- Standard: mostly the same base candidates, with an additional fixed-R feasibility filter and possibly different candidate selection inside rare episodes.

## Reconstruction consequence

For vendor signal fidelity:

1. Treat Risk (or Safe) labels as the least-filtered observable approximation of the base Reversal generator.
2. Treat Standard as a downstream filter task, not as the primary label source.
3. Do not mix dashboard win rate with entry-signal fidelity.
4. Reconstruct in two stages:
   - Stage A: base candidate/state-machine matching against Risk/Safe labels.
   - Stage B: Standard acceptance/rejection model using causal trade geometry.

Candidate Standard gate features to test causally:

- available reward to Mean and zone boundary;
- stop distance to recent swing or zone invalidation;
- fixed target / stop ratio;
- feasibility of add-on entry before invalidation;
- side-specific geometry;
- collision ordering between stop, partial, add and full-fix levels.

## Next data

No additional Safe export is needed. For the next mode experiment, use existing long exact datasets and export only Standard and Risk on one high-signal Futures dataset with identical loaded history, preferably BTC Futures 5m. This checks whether the Standard-subset relationship generalizes across market type and timeframe.
