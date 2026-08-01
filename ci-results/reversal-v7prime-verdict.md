# V7' verdict: FAIL at validation stage (sealed slices NOT consumed)

Pre-registration: `reversal-v7prime-preregistration.md` (committed before any run).
Grid results: `reversal-v7prime-grid-search.{md,json}`.

## Outcome

All 18 configurations fail catastrophically on dev validation under exact matching:
best mean validation F1 = 3.03% (W=48, minAge=8, threshold=0.5); BTC.P 15m validation TP = 0/16.
The final frozen run was NOT executed: burning sealed slices on a candidate that already
misses every gate threshold on validation would spend the sealed budget for no information.
Sealed slices of both development datasets remain untouched by V7'.

## Diagnostic (dev fit+validation only, winner config)

Tolerance sweep, one-to-one directional matching:

- btc-perp-15m (98 preds / 48 truth): tol0 p=2.0% r=4.2%; tol10 p=14.3% r=29.2%; tol20 p=25.5% r=52.1%; tol40 p=35.7% r=72.9%
- btc-perp-1h  (66 preds / 33 truth): tol0 p=3.0% r=6.1%; tol10 p=15.2% r=30.3%; tol20 p=28.8% r=57.6%; tol40 p=42.4% r=84.8%

Matched deltas at tol40 are broadly scattered in both directions (-40..+39 bars,
15m; -24..+30 bars, 1h) with no fixed offset. Interpretation:

1. The episode grammar localizes the right REGIONS: within +/-20-40 bars the detector
   covers 52-85% of vendor labels at 2-4x overprediction. Region-level structure is real.
2. The exact bar choice inside a region is NOT explained by the rolling-extremum of the
   half-width recovery metric, nor (from V1-V6) by oscillator composites, distance bands,
   explicit cooldowns, or age thresholds. The scatter is wide and two-sided, so no
   constant-lag correction can rescue exact matching.

## Status of hypotheses

- H1 (age as primary variable): effectively dead as an exact-bar mechanism; age hazard
  separation (2.1-2.7x) is region-level information only.
- H2 (rolling-window lock): the soft gap floor observation stands, but this specific
  recovery-metric extremum is not the vendor's trigger.
- H3 (hidden HTF condition): still open; cross-TF clustering (5.8-6.4x) remains the
  strongest unexplained observation and is consistent with the exact bar being chosen
  by a state visible across timeframes.

## Honest conclusion

Six single-TF families (V1-V6) plus V7' all reproduce label FREQUENCY and REGIONS but
not exact bars. The accumulated evidence now favors: the exact-bar trigger depends on
information not present in the OHLC+bands export (an internal intermediate series, or a
higher-timeframe state). The next cheapest information gain is NOT another single-TF
grammar; it is either (a) a vendor export that includes any intermediate plot series the
indicator style settings expose, or (b) an explicitly pre-registered HTF-conditioned
variant driven by the H3 clustering result.
