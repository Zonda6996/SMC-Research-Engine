# Pre-registration: E2 - band-trailed exits on HTF labels

Branch: research/fng-case-control. Committed BEFORE any simulation.
E1 showed: mechanical fixed exits destroy the O1 drift (HTF worst hit: MAE
precedes the move), and winrate is exit-accounting. E2 tests ONE focused
reduction: on HTF (1h/2h) labels, does a WIDE stop plus trailing by the
indicator's own MEAN line (bands used as an EXIT instrument, first time)
preserve the drift better than fixed exits and better than random entries?

User's standing hypothesis, recorded: the bands likely play only a partial
role in entry and are NOT the core of the mechanism. E2 is the LAST band
experiment; if it fails to separate from control, the band line closes
entirely and the search moves elsewhere.

## Corpus (FROZEN)

HTF datasets only: btc-perp-1h, btc-perp-2h(*), ondo-perp-1h-b2, ondo-perp-2h-b2,
btc-perp-1h-b2 EXCLUDED (overlap with btc-perp-1h), btc-perp-2h-b2 INCLUDED as
the only BTC 2h source. (*) btc-perp-2h refers to the original corpus 2h dataset
if present; the run script resolves the actual available HTF ids from both
manifests and lists them in the report - resolution rule frozen: all datasets
with timeframe in {1h, 2h}, dropping batch-2 BTC ids that overlap an original
dataset of the same timeframe.

Entry: close of label bar; R = ATR14(label bar); warm-up excluded; labels with
< 48 forward bars excluded; max hold 192 bars; conservative both-touch ->
adverse fill, as in E1. Random control: matched count, coin-flip direction,
seed 4242 fresh stream.

## Policies (FROZEN - 3, plus two E1 anchors for comparison)

T1 band_trail: initial SL -3R; no fixed TP. Once favorable excursion reaches
   +1R, exit switches to a trail: close the position when price crosses the
   GGI mean line against the trade (long: bar low < mean of PRIOR bar; short:
   bar high > mean of prior bar). Prior-bar mean avoids lookahead.
T2 band_trail_be: same as T1, plus at +1.14R close 50% and move stop to entry
   (vendor-style partial), remainder trails the mean line.
T3 wide_hold: initial SL -3R, no TP, force-close at bar 192 at close
   (pure "give the drift room" benchmark - no bands).
Anchors (from E1, same code path): fixed_2to1, partial_be.

## Metrics & reading rules (FROZEN)

Same metrics as E1 (vendor-style WR, strict WR, expectancy, median R, rates,
trade-ordered max drawdown), labels vs control, pooled HTF + per dataset.
- SUCCESS (bands matter as exit): T1 or T2 expectancy on labels >= +0.25 R/trade
  AND exceeds the SAME policy on control by >= 0.15 R/trade AND exceeds T3
  (band-free) on labels by >= 0.10 R/trade. The last clause is what actually
  tests the BANDS, not just the wide stop.
- BANDS IRRELEVANT: T1/T2 fail to beat T3 by 0.10 R/trade -> whatever value
  exists is the wide stop + drift, bands add nothing as exits; band line CLOSED.
- NO VALUE: nothing separates from control -> HTF drift is not extractable by
  these means either.
No tuning; single run; results committed as-is.

## Gate

npm run research:integrity; npm test; npx tsc --noEmit.
