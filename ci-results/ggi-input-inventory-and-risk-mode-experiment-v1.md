# GGI input inventory and Risk Mode experiment v1

## Complete visible input inventory

The supplied screenshots show the complete settings surface of `GGI Buy/Sell`.

### Arguments

#### Risk settings

`Risk Mode` is the only visible parameter capable of changing the BUY/SELL calculation. It has exactly three choices:

1. `Safe mode` — current/default selection in the screenshots.
2. `Standard mode`.
3. `Risk mode`.

#### GGI zone

`Hide GGI Zone` is a boolean display control. Its name and placement indicate that it hides the zone visualization. It should not be assumed to change BUY/SELL logic. This can be verified once, but it is not a primary reconstruction parameter.

### Style

The Style tab exposes only presentation controls:

- GGI Mean visibility/style;
- GGI Upper Outer visibility/style;
- GGI Upper Inner visibility/style;
- GGI Lower Inner visibility/style;
- GGI Lower Outer visibility/style;
- first Shapes visibility/color/position;
- second Shapes visibility/color/position;
- GGI Upper Zone visibility/color;
- GGI Lower Zone visibility/color;
- panel labels, lines and tables;
- output precision;
- price-scale labels;
- status-line values;
- argument values in the status line.

These controls do not expose score, thresholds, lengths, smoothing, cooldown, timeframe or state-machine settings.

### Visibility

The Visibility tab controls only the chart intervals on which the indicator is displayed. It is not a hidden higher-timeframe input.

## Reconstruction implication

The private build intentionally reduces all numerical internals to a single categorical `Risk Mode`. Therefore parameter perturbation is not a large grid. There are only three meaningful computational black-box states:

```text
Safe mode
Standard mode
Risk mode
```

This is useful. Comparing exact signal sets across these modes can reveal whether Risk Mode primarily changes:

- an extremity/score threshold;
- confirmation strictness;
- cooldown/re-arm rules;
- or several bundled parameters.

## Minimal export experiment

Use the same symbol, market, timeframe, date range and loaded history for all files. Do not change Style, Visibility, Hide GGI Zone or chart timezone between exports.

Recommended first experiment:

```text
BINANCE BTCUSDT Spot 15m
Baseline range: exactly the same loaded history as the existing 5,520-row export
```

Exports required:

1. `BTCUSDT_15m_GGI_SAFE.csv`
2. `BTCUSDT_15m_GGI_STANDARD.csv`
3. `BTCUSDT_15m_GGI_RISK.csv`

The existing Safe-mode clean export may serve as file 1 if the chart history remains exactly identical. Export only the original GGI; the public-series probe is no longer required.

## Integrity requirements

For a valid comparison:

- same symbol and venue;
- same Spot/Futures market;
- same 15m timeframe;
- same first and last timestamp;
- same number of rows;
- same OHLC on every common timestamp;
- only Risk Mode changes;
- wait for the indicator to finish recalculating before export.

## Analysis to run

For each mode and side:

1. Exact BUY/SELL count.
2. Exact timestamp overlap with Safe mode.
3. Signals added and removed.
4. Nearest-bar displacement of unmatched signals.
5. Minimum, median and distribution of inter-signal gaps.
6. Same-side versus global gap behavior.
7. Distance from Mean normalized by Inner-band width.
8. Prior Inner/Outer-zone episode offset.
9. Whether less conservative modes form strict supersets of Safe signals.

## Interpretation matrix

### Nested signals, same timestamps

```text
Safe ⊂ Standard ⊂ Risk
```

If all Safe signals remain exact and additional signals are merely added, the mode likely relaxes an arm/score threshold while sharing confirmation and cooldown logic.

### Same episodes, shifted earlier/later

If Standard/Risk signals cluster around Safe signals but fire earlier, the mode likely changes confirmation or smoothing delay.

### Changed minimum inter-signal gap

If Risk produces closer adjacent signals than Safe, the mode changes cooldown/re-arm or bundles it with threshold changes.

### Large non-nested replacement

If many Safe signals disappear and different signals replace them, Risk Mode probably changes several internal parameters or regime filters together.

### Identical outputs

If all three modes are identical on this interval, repeat the three-mode experiment on a volatile dataset that already contains many labels, preferably BTC Futures 5m. Do not conclude the input is cosmetic from one calm sample.

## One optional control

After the three-mode exports, toggle only `Hide GGI Zone` and export a short duplicate in Safe mode. BUY/SELL should remain identical. This verifies that the checkbox is display-only; it is not required if TradingView exports Shapes unchanged with zones hidden.
