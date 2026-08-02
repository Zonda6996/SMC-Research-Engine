# Pre-registration: O1 - post-label outcome statistics

Branch: research/fng-case-control. Committed BEFORE any outcome computation.
The question changes: not "what triggers the label" (closed: hidden state +
confirmed volume component) but "what does price do AFTER the label" - signal
QUALITY measurement, independent of the vendor's own GGI stats table.

## Corpus (FROZEN)

All 14 datasets (6 original + 8 batch-2), volumes where available. Labels after
warm-up only. BTC overlap between corpora: btc-perp-15m-b2 / btc-perp-1h-b2 are
EXCLUDED from pooled aggregates (original btc-perp-15m/1h retained) to avoid
double counting; they are still reported per-dataset.

## Definitions (FROZEN; all in R-units per label)

- Entry: close of the label bar (the earliest realistically actionable price).
- Risk unit R: 1 * ATR(14) of the label bar (Wilder). No claim this is the
  vendor's stop; it is OUR pre-declared, indicator-independent yardstick.
- Direction: BUY = long, SELL = short.
- Horizon: 96 bars after the label bar (or until data end; labels with < 24
  bars of forward data are excluded from horizon-dependent stats).
- Tracked per label:
  - MFE/MAE: max favorable / adverse excursion in R within horizon.
  - firstTouch(k): which of +k R (favorable) or -k R (adverse) is touched first,
    for k in {0.5, 1.0, 1.14, 1.5, 2.0} (1.14 and 2.0 = the constants reported
    by the vendor's table per the third AI's account; intrabar tie -> counted
    as ADVERSE, conservative).
  - barsToFavorable(1R): bars until +1R first touched (if ever, within horizon).
  - terminal R at bars 24 and 96 (close-based).

## Statistics (FROZEN)

- Per dataset: n, firstTouch win rates per k, median MFE/MAE, median barsTo+1R,
  mean terminal R@24/@96.
- Pooled (excluding overlap duplicates): same, plus split BUY vs SELL and split
  by timeframe class {1m-5m, 15m, 1h-2h}.
- Baseline control: identical statistics on RANDOM bars (matched per dataset:
  same count, uniform over eligible bars, direction assigned by coin flip;
  mulberry32 seed 4242) to show what a no-skill signal yields under the same
  measurement. One draw of 200 resamples for the pooled win-rate CI band.
- NO optimization of k, horizon, R definition, or any parameter. Numbers are
  reported as-is against the frozen definitions.

## What this is NOT

Not a backtest of the vendor's exit logic (unknown), not a trading system, no
claims about partial fixes/BE logic. It measures raw post-label price behavior
against a neutral yardstick, with a random-bar control.

## Gate

npm run research:integrity; npm test; npx tsc --noEmit.
