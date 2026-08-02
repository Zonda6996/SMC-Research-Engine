# Pre-registration: Fear&Greed case-control audit (exact-bar discriminability)

Branch: research/fng-case-control (from research/htf-gap-falsification @ ad83edf).
Committed BEFORE any computation. Features, controls, statistics, permutation
scheme, seed and kill criteria are FROZEN after this commit. No detector is
built. No profitability analysis. Production untouched.

## Motivation

External parameter-perturbation probe established that GGI labels do NOT move
when band inputs change (lookback 200->100, mult 5.6->4.0): labels are computed
from something OTHER than the bands. User reports the vendor describes the
trigger as a "simplified fear & greed" formula. If that formula uses only
OHLCV-computable components, the hidden series may be reconstructible from our
corpus. This audit asks the DIAGNOSTIC question (per the case-control design of
the coordinated next-steps doc): inside episodes that contain a label, does ANY
frozen OHLCV-computable F&G-style feature distinguish the label bar from
neighboring bars of the same episode? No detector; pure discriminability.

## Case/control design (FROZEN)

- Episode grammar: identical to chronology v2 / V7' (first inner-band breach
  starts a side episode; close through mean ends it; 256-bar cap).
- Cases: bars carrying a vendor label, restricted to labels that fall inside a
  same-side episode (labels outside any episode are counted and reported but
  excluded from AUC).
- Controls: all other bars of the SAME episode, excluding a +/-2-bar buffer
  around the case bar.
- Episodes with zero controls after exclusion are dropped (reported).

## Features (12, FROZEN; all causal, computed at bar i from data <= i)

f1  rsi14           RSI(close, 14)
f2  roc10           (close[i]/close[i-10] - 1)
f3  atrNorm14       ATR(14)/close
f4  atrRegime       ATR(14)/ATR(100)
f5  devSma50        (close - SMA(close,50))/SMA(close,50)
f6  volPressure     volume/SMA(volume,50)
f7  signedVolPress  sum_{k=i-9..i} sign(close_k - open_k)*vol_k / sum vol_k
f8  bandPos         (close - lowerInner)/(upperInner - lowerInner)
f9  stoch14         Stochastic %K (14)
f10 rangePos50      (close - min(low,50))/(max(high,50) - min(low,50))
f11 fngComposite    mean of causal 200-bar percentile ranks of {f1, f2, 1/f3(vol inverse), f6}
f12 recoveryHW      (close - episodeExtreme)/halfWidth, side-aware (V7' metric, as reference)

Side normalization (FROZEN): for SELL-side episodes, directional features are
mirrored so "extreme fear" aligns across sides: f1->100-f1, f2->-f2, f5->-f5,
f7->-f7, f8->1-f8, f9->100-f9, f10->1-f10, f11->1-f11. f3, f4, f6, f12 unchanged.

## Statistics (FROZEN)

- Primary: per-feature AUC (Mann-Whitney) cases vs controls, pooled across sides
  after mirroring, computed separately on each development dataset
  (btc-perp-15m, btc-perp-1h). Holdout datasets: same tables reported as
  consistency diagnostics only (corpus is hypothesis-seen; nothing here is OOS
  confirmation).
- Multiple-testing control: max-T permutation test. Within each case episode the
  case position is re-drawn uniformly from {case bar} + control bars; 2,000
  permutations; PRNG mulberry32, seed 4242. p-value for the observed maximum
  |AUC-0.5| across the 12 features.
- Secondary descriptive: median case vs control values per feature.

## Interpretation rules (FROZEN)

- F&G-SUPPORTED: some feature reaches AUC >= 0.70 (or <= 0.30) on BOTH dev
  datasets AND max-T p <= 0.05 on both. -> justifies a future pre-registered
  detector experiment (NOT built in this session).
- WEAK SIGNAL: max-T p <= 0.05 on both dev datasets but no feature reaches the
  0.70 threshold on both -> some information exists; report honestly; a detector
  is unlikely to hit exact-bar gates on such separation.
- KILL (information-insufficiency evidence): max-T p > 0.05 on at least one dev
  dataset, or all AUC in (0.30, 0.70) on at least one dev dataset -> no frozen
  OHLCV F&G-style feature distinguishes the exact bar inside its episode;
  strengthens "export is information-insufficient" as a POSITIVE finding.

## Explicitly out of scope (this session)

- Any detector or grid search; V8; profitability re-evaluation of the external
  backtest; stop/TP formula reverse-engineering (requires vendor trade exports
  with visible TP/stop levels which are NOT in this corpus - recorded as a data
  request for later); requesting new data.

## Gate at the end

npm run research:integrity; npm test; npx tsc --noEmit.
