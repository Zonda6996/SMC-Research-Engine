# SIG1 - Arrow anatomy (descriptive study, no pre-registration required)

Purpose: Nikita's goal is approximate SIGNAL replication (bar-level), not
value capture. SUR1 (closed) tested money capture; SIG1 characterizes what
arrow bars actually ARE, to find any deterministic gate worth confirming.
Datasets: BTC.P 2h full20k (vol re-export, 50 BUY / 41 SELL) and XRP 3m
(vol re-export, 30 BUY / 33 SELL). All numbers below hold on BOTH datasets.

## Finding 1 - the old "outer-band stretch" belief is FALSIFIED

Arrow bars touch the OUTER band 0% of the time (both sides, both datasets).
Median distance from an arrow to the nearest same-side outer-band stretch is
~350-660 bars. The SUR1 rule family was anatomically wrong from the start -
consistent with its uniformly negative capture.

## Finding 2 - two exact invariants (100% on both datasets, both sides)

1. The arrow bar CLOSES IN THE SIGNAL DIRECTION (bullish close for BUY,
   bearish for SELL).
2. The arrow bar's close is ON THE SIGNAL SIDE OF THE MEAN (below Mean for
   BUY, above for SELL).
Median wick reaches ~0.55 of the Mean->Outer span (slightly past Inner);
wick beyond Inner only 37-52%. Big body: median ~1.8x previous bar's body.
Arrow bars are strong REVERSAL candles printed mid-channel after a prolonged
one-sided phase (median 23-41 bars since last Mean touch).

## Finding 3 - no OHLCV-derived gate separates arrow bars from lookalikes

Tested and failed (precision on exact bar match, target base ~90 arrows):
- State machines (first directional close after Inner-touch setup, with
  Mean-cross reset; close-beyond-prev-extreme trigger variants): prec <= 9%,
  recall <= 15%.
- Conjunctions body-size x volume x prev-extreme break: best prec 7% at
  recall 30%; recall 73% costs prec 2%.
- Oscillator signatures (RSI14 at bar and at prev bar, Stoch14): arrow vs
  lookalike distributions overlap heavily (e.g. BUY prev-bar RSI median 33
  vs 40); no threshold exists.
For every rule, hundreds of anatomically identical candles carry no arrow.

## Conclusion

The arrow trigger is not a function of OHLCV + bands at bar scale. Combined
with SUR1's final failure (arrow VALUE also not extractable from these
features), approximate bar-level replication from TradingView exports is
NOT ACHIEVABLE with the data classes available to us. The trigger plausibly
depends on state we cannot export (lower-TF structure, volume delta, or a
proprietary compound oscillator). Honest paths that remain: (a) TV alert
webhooks while a plan allows; (b) obtaining the Pine source; (c) a single
pooled ML attempt on interaction features - LOW prior given every marginal
distribution overlaps, offered only with expectations set accordingly.
