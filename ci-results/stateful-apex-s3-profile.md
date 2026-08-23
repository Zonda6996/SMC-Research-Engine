# Stateful Apex S3 — resolved winners vs losers diagnostic profile

## Protocol / seal

- Inputs: frozen S1 manifest + S2 results; allowed raw splits: **train, validation only**.
- Untouched-OOS audit: **reveal=0**, files read=0, rows parsed=0, labels=0, features=0; 5 manifest OOS series excluded before I/O.
- Vendor Shapes: parser validation only; BUY/SELL fields discarded before detection. Never target, feature, match criterion, or selection input.
- State machine, splits, labels, costs (5 bps/side), and `src/core`: unchanged.
- `causalRelativeVolume`: **null**; no lookback or denominator invented.
- Primary inference: independent series at **>=15m**. Lower TFs appear only in the sensitivity appendix.
- No classifier, grid, v2 rule, or validation/holdout retest was performed.

## Sample

- Allowed files read: 32; resolved events: 5644; unresolved/invalid: 1003.
- Primary >=15m: n=2897 (1298 winners / 1599 losers), 17 series.
- Low-TF sensitivity: n=2747, 15 series.

## Primary feature profile

Effect is Cliff’s delta (winner minus loser ordering). CI resamples independent series. `q` is BH-adjusted matched-permutation p.

| feature | W med [q25,q75] | L med [q25,q75] | delta | CI95 | q | train / validation | class |
|---|---:|---:|---:|---:|---:|---:|---|
| barsSinceMean | 20.000 [10.000,33.000] | 20.000 [11.000,32.000] | -0.023 | [-0.049, 0.002] | 0.337 | -0.015 / -0.106 | no signal |
| barsSinceInner | 2.000 [2.000,3.000] | 3.000 [2.000,4.000] | -0.104 | [-0.155, -0.054] | 0.005 | -0.087 / -0.278 | unstable correlation |
| currentDepth | 0.830 [0.665,0.985] | 0.962 [0.810,1.169] | -0.336 | [-0.376, -0.292] | 0.005 | -0.336 / -0.345 | leakage/proxy risk |
| maxDepth | 1.150 [1.055,1.301] | 1.253 [1.101,1.500] | -0.249 | [-0.285, -0.209] | 0.005 | -0.244 / -0.319 | leakage/proxy risk |
| newAdverseExtremes | 1.000 [0.000,1.000] | 1.000 [0.000,2.000] | -0.161 | [-0.196, -0.125] | 0.005 | -0.150 / -0.266 | robust candidate |
| lastExtensionIncrementOverInner | 0.083 [0.033,0.160] | 0.109 [0.051,0.225] | -0.163 | [-0.195, -0.123] | 0.005 | -0.155 / -0.244 | robust candidate |
| previousExtensionIncrementOverInner | 0.090 [0.036,0.185] | 0.115 [0.046,0.216] | -0.105 | [-0.175, -0.041] | 0.021 | -0.103 / -0.171 | unstable correlation |
| recoveryFromExtremeOverInner | 0.338 [0.230,0.490] | 0.297 [0.205,0.419] | 0.140 | [0.107, 0.171] | 0.005 | 0.140 / 0.140 | unstable correlation |
| closeToMeanProgress | 0.112 [-0.033,0.247] | 0.025 [-0.153,0.142] | 0.265 | [0.221, 0.307] | 0.005 | 0.264 / 0.275 | leakage/proxy risk |
| sideAlignedBodyOverInner | 0.103 [0.053,0.175] | 0.091 [0.045,0.158] | 0.074 | [0.027, 0.117] | 0.005 | 0.076 / 0.044 | unstable correlation |
| rangeOverInner | 0.211 [0.160,0.305] | 0.212 [0.158,0.286] | 0.024 | [-0.020, 0.068] | 0.335 | 0.018 / 0.091 | no signal |
| upperWickOverInner | 0.044 [0.020,0.083] | 0.048 [0.022,0.086] | -0.041 | [-0.081, 0.002] | 0.091 | -0.054 / 0.088 | no signal |
| lowerWickOverInner | 0.045 [0.021,0.083] | 0.048 [0.021,0.085] | -0.023 | [-0.071, 0.023] | 0.335 | -0.029 / 0.041 | no signal |
| trueRangeOverInner | 0.211 [0.160,0.305] | 0.212 [0.158,0.286] | 0.024 | [-0.021, 0.066] | 0.335 | 0.018 / 0.091 | no signal |
| meanSlopeOverInner | -0.007 [-0.010,-0.004] | -0.008 [-0.011,-0.004] | 0.039 | [-0.004, 0.084] | 0.172 | 0.022 / 0.213 | no signal |
| innerWidthOverTrueRange | 4.742 [3.280,6.249] | 4.727 [3.491,6.340] | -0.024 | [-0.067, 0.019] | 0.335 | -0.018 / -0.091 | no signal |
| outerWidthOverTrueRange | 8.158 [5.644,10.771] | 8.064 [5.939,10.803] | -0.021 | [-0.065, 0.022] | 0.335 | -0.017 / -0.071 | no signal |
| innerWidthChangeOverTrueRange | 0.012 [-0.001,0.027] | 0.014 [-0.000,0.028] | -0.032 | [-0.077, 0.008] | 0.335 | -0.039 / 0.037 | no signal |
| outerWidthChangeOverTrueRange | 0.021 [-0.002,0.047] | 0.023 [-0.000,0.047] | -0.031 | [-0.076, 0.010] | 0.335 | -0.038 / 0.047 | no signal |

## Classification

### robust candidate

- **newAdverseExtremes**: Passes conservative effect, cluster-CI, matched-baseline, FDR, split, and breadth screens.
- **lastExtensionIncrementOverInner**: Passes conservative effect, cluster-CI, matched-baseline, FDR, split, and breadth screens.

### unstable correlation

- **barsSinceInner**: Absolute Cliff effect is below the conservative small-effect floor (0.147).
- **previousExtensionIncrementOverInner**: Absolute Cliff effect is below the conservative small-effect floor (0.147).
- **recoveryFromExtremeOverInner**: Absolute Cliff effect is below the conservative small-effect floor (0.147).
- **sideAlignedBodyOverInner**: Absolute Cliff effect is below the conservative small-effect floor (0.147).

### leakage/proxy risk

- **currentDepth**: Uses the same Apex geometry that defines target/stop distances; causal but may proxy payoff geometry.
- **maxDepth**: Uses the same Apex geometry that defines target/stop distances; causal but may proxy payoff geometry.
- **closeToMeanProgress**: Mechanically related to the frozen reversal-confirmation condition; causal but may be a trigger-strength proxy.

### no signal

- **barsSinceMean**: Absolute Cliff effect is below the conservative small-effect floor (0.147). Series-cluster bootstrap CI crosses zero. Matched-label permutation p-value does not survive Benjamini-Hochberg FDR 5%. Sign agreement is below 65% in at least one breadth dimension (symbol/series/TF/side/temporal fold).
- **rangeOverInner**: Absolute Cliff effect is below the conservative small-effect floor (0.147). Series-cluster bootstrap CI crosses zero. Matched-label permutation p-value does not survive Benjamini-Hochberg FDR 5%. Sign agreement is below 65% in at least one breadth dimension (symbol/series/TF/side/temporal fold).
- **upperWickOverInner**: Absolute Cliff effect is below the conservative small-effect floor (0.147). Series-cluster bootstrap CI crosses zero. Matched-label permutation p-value does not survive Benjamini-Hochberg FDR 5%. Sign is not stable across train and validation. Sign agreement is below 65% in at least one breadth dimension (symbol/series/TF/side/temporal fold).
- **lowerWickOverInner**: Absolute Cliff effect is below the conservative small-effect floor (0.147). Series-cluster bootstrap CI crosses zero. Matched-label permutation p-value does not survive Benjamini-Hochberg FDR 5%. Sign is not stable across train and validation. Sign agreement is below 65% in at least one breadth dimension (symbol/series/TF/side/temporal fold).
- **trueRangeOverInner**: Absolute Cliff effect is below the conservative small-effect floor (0.147). Series-cluster bootstrap CI crosses zero. Matched-label permutation p-value does not survive Benjamini-Hochberg FDR 5%. Sign agreement is below 65% in at least one breadth dimension (symbol/series/TF/side/temporal fold).
- **meanSlopeOverInner**: Absolute Cliff effect is below the conservative small-effect floor (0.147). Series-cluster bootstrap CI crosses zero. Matched-label permutation p-value does not survive Benjamini-Hochberg FDR 5%. Sign agreement is below 65% in at least one breadth dimension (symbol/series/TF/side/temporal fold).
- **innerWidthOverTrueRange**: Absolute Cliff effect is below the conservative small-effect floor (0.147). Series-cluster bootstrap CI crosses zero. Matched-label permutation p-value does not survive Benjamini-Hochberg FDR 5%. Sign agreement is below 65% in at least one breadth dimension (symbol/series/TF/side/temporal fold).
- **outerWidthOverTrueRange**: Absolute Cliff effect is below the conservative small-effect floor (0.147). Series-cluster bootstrap CI crosses zero. Matched-label permutation p-value does not survive Benjamini-Hochberg FDR 5%. Sign agreement is below 65% in at least one breadth dimension (symbol/series/TF/side/temporal fold).
- **innerWidthChangeOverTrueRange**: Absolute Cliff effect is below the conservative small-effect floor (0.147). Series-cluster bootstrap CI crosses zero. Matched-label permutation p-value does not survive Benjamini-Hochberg FDR 5%. Sign is not stable across train and validation. Sign agreement is below 65% in at least one breadth dimension (symbol/series/TF/side/temporal fold).
- **outerWidthChangeOverTrueRange**: Absolute Cliff effect is below the conservative small-effect floor (0.147). Series-cluster bootstrap CI crosses zero. Matched-label permutation p-value does not survive Benjamini-Hochberg FDR 5%. Sign is not stable across train and validation. Sign agreement is below 65% in at least one breadth dimension (symbol/series/TF/side/temporal fold).

## Admissible candidates for a future single-rule v2

- lastExtensionIncrementOverInner
- newAdverseExtremes

This list is diagnostic only. No rule, threshold, direction, or v2 implementation was formulated or tested.

## Sign stability details

### barsSinceMean

- symbol: agreement=0.625, estimable=8, +/−/0=3/5/0.
- independent-series: agreement=0.471, estimable=17, +/−/0=9/8/0.
- timeframe: agreement=0.667, estimable=6, +/−/0=2/4/0.
- side: agreement=0.750, estimable=4, +/−/0=1/3/0.
- temporal-fold: agreement=0.833, estimable=6, +/−/0=1/5/0.

### barsSinceInner

- symbol: agreement=0.875, estimable=8, +/−/0=1/7/0.
- independent-series: agreement=0.882, estimable=17, +/−/0=2/15/0.
- timeframe: agreement=0.833, estimable=6, +/−/0=1/5/0.
- side: agreement=1.000, estimable=4, +/−/0=0/4/0.
- temporal-fold: agreement=1.000, estimable=6, +/−/0=0/6/0.

### currentDepth

- symbol: agreement=1.000, estimable=8, +/−/0=0/8/0.
- independent-series: agreement=1.000, estimable=17, +/−/0=0/17/0.
- timeframe: agreement=1.000, estimable=6, +/−/0=0/6/0.
- side: agreement=1.000, estimable=4, +/−/0=0/4/0.
- temporal-fold: agreement=1.000, estimable=6, +/−/0=0/6/0.

### maxDepth

- symbol: agreement=1.000, estimable=8, +/−/0=0/8/0.
- independent-series: agreement=1.000, estimable=17, +/−/0=0/17/0.
- timeframe: agreement=1.000, estimable=6, +/−/0=0/6/0.
- side: agreement=1.000, estimable=4, +/−/0=0/4/0.
- temporal-fold: agreement=1.000, estimable=6, +/−/0=0/6/0.

### newAdverseExtremes

- symbol: agreement=1.000, estimable=8, +/−/0=0/8/0.
- independent-series: agreement=1.000, estimable=17, +/−/0=0/17/0.
- timeframe: agreement=1.000, estimable=6, +/−/0=0/6/0.
- side: agreement=1.000, estimable=4, +/−/0=0/4/0.
- temporal-fold: agreement=1.000, estimable=6, +/−/0=0/6/0.

### lastExtensionIncrementOverInner

- symbol: agreement=1.000, estimable=8, +/−/0=0/8/0.
- independent-series: agreement=0.941, estimable=17, +/−/0=1/16/0.
- timeframe: agreement=1.000, estimable=6, +/−/0=0/6/0.
- side: agreement=1.000, estimable=4, +/−/0=0/4/0.
- temporal-fold: agreement=1.000, estimable=6, +/−/0=0/6/0.

### previousExtensionIncrementOverInner

- symbol: agreement=1.000, estimable=7, +/−/0=0/7/0.
- independent-series: agreement=0.786, estimable=14, +/−/0=3/11/0.
- timeframe: agreement=0.833, estimable=6, +/−/0=1/5/0.
- side: agreement=1.000, estimable=3, +/−/0=0/3/0.
- temporal-fold: agreement=0.667, estimable=3, +/−/0=1/2/0.

### recoveryFromExtremeOverInner

- symbol: agreement=1.000, estimable=8, +/−/0=8/0/0.
- independent-series: agreement=0.941, estimable=17, +/−/0=16/1/0.
- timeframe: agreement=1.000, estimable=6, +/−/0=6/0/0.
- side: agreement=1.000, estimable=4, +/−/0=4/0/0.
- temporal-fold: agreement=1.000, estimable=6, +/−/0=6/0/0.

### closeToMeanProgress

- symbol: agreement=1.000, estimable=8, +/−/0=8/0/0.
- independent-series: agreement=1.000, estimable=17, +/−/0=17/0/0.
- timeframe: agreement=1.000, estimable=6, +/−/0=6/0/0.
- side: agreement=1.000, estimable=4, +/−/0=4/0/0.
- temporal-fold: agreement=1.000, estimable=6, +/−/0=6/0/0.

### sideAlignedBodyOverInner

- symbol: agreement=1.000, estimable=8, +/−/0=8/0/0.
- independent-series: agreement=0.765, estimable=17, +/−/0=13/4/0.
- timeframe: agreement=0.833, estimable=6, +/−/0=5/1/0.
- side: agreement=0.750, estimable=4, +/−/0=3/1/0.
- temporal-fold: agreement=0.833, estimable=6, +/−/0=5/1/0.

### rangeOverInner

- symbol: agreement=0.500, estimable=8, +/−/0=4/4/0.
- independent-series: agreement=0.529, estimable=17, +/−/0=9/8/0.
- timeframe: agreement=0.833, estimable=6, +/−/0=5/1/0.
- side: agreement=0.750, estimable=4, +/−/0=3/1/0.
- temporal-fold: agreement=0.833, estimable=6, +/−/0=5/1/0.

### upperWickOverInner

- symbol: agreement=0.625, estimable=8, +/−/0=3/5/0.
- independent-series: agreement=0.588, estimable=17, +/−/0=7/10/0.
- timeframe: agreement=0.667, estimable=6, +/−/0=2/4/0.
- side: agreement=0.500, estimable=4, +/−/0=2/2/0.
- temporal-fold: agreement=0.667, estimable=6, +/−/0=2/4/0.

### lowerWickOverInner

- symbol: agreement=0.625, estimable=8, +/−/0=3/5/0.
- independent-series: agreement=0.647, estimable=17, +/−/0=6/11/0.
- timeframe: agreement=0.500, estimable=6, +/−/0=3/3/0.
- side: agreement=0.750, estimable=4, +/−/0=1/3/0.
- temporal-fold: agreement=0.500, estimable=6, +/−/0=3/3/0.

### trueRangeOverInner

- symbol: agreement=0.500, estimable=8, +/−/0=4/4/0.
- independent-series: agreement=0.529, estimable=17, +/−/0=9/8/0.
- timeframe: agreement=0.833, estimable=6, +/−/0=5/1/0.
- side: agreement=0.750, estimable=4, +/−/0=3/1/0.
- temporal-fold: agreement=0.833, estimable=6, +/−/0=5/1/0.

### meanSlopeOverInner

- symbol: agreement=0.750, estimable=8, +/−/0=6/2/0.
- independent-series: agreement=0.588, estimable=17, +/−/0=10/7/0.
- timeframe: agreement=0.833, estimable=6, +/−/0=5/1/0.
- side: agreement=1.000, estimable=4, +/−/0=4/0/0.
- temporal-fold: agreement=1.000, estimable=6, +/−/0=6/0/0.

### innerWidthOverTrueRange

- symbol: agreement=0.500, estimable=8, +/−/0=4/4/0.
- independent-series: agreement=0.529, estimable=17, +/−/0=8/9/0.
- timeframe: agreement=0.833, estimable=6, +/−/0=1/5/0.
- side: agreement=0.750, estimable=4, +/−/0=1/3/0.
- temporal-fold: agreement=0.833, estimable=6, +/−/0=1/5/0.

### outerWidthOverTrueRange

- symbol: agreement=0.500, estimable=8, +/−/0=4/4/0.
- independent-series: agreement=0.471, estimable=17, +/−/0=9/8/0.
- timeframe: agreement=0.833, estimable=6, +/−/0=1/5/0.
- side: agreement=0.750, estimable=4, +/−/0=1/3/0.
- temporal-fold: agreement=0.667, estimable=6, +/−/0=2/4/0.

### innerWidthChangeOverTrueRange

- symbol: agreement=0.750, estimable=8, +/−/0=2/6/0.
- independent-series: agreement=0.588, estimable=17, +/−/0=7/10/0.
- timeframe: agreement=0.500, estimable=6, +/−/0=3/3/0.
- side: agreement=0.750, estimable=4, +/−/0=1/3/0.
- temporal-fold: agreement=0.667, estimable=6, +/−/0=2/4/0.

### outerWidthChangeOverTrueRange

- symbol: agreement=0.625, estimable=8, +/−/0=3/5/0.
- independent-series: agreement=0.529, estimable=17, +/−/0=8/9/0.
- timeframe: agreement=0.500, estimable=6, +/−/0=3/3/0.
- side: agreement=0.750, estimable=4, +/−/0=1/3/0.
- temporal-fold: agreement=0.667, estimable=6, +/−/0=2/4/0.

## Low-TF sensitivity appendix (excluded from inference)

| feature | low-TF W median | low-TF L median | low-TF delta | primary delta |
|---|---:|---:|---:|---:|
| barsSinceMean | 16.000 | 12.000 | 0.224 | -0.023 |
| barsSinceInner | 2.000 | 3.000 | -0.144 | -0.104 |
| currentDepth | 0.841 | 1.043 | -0.400 | -0.336 |
| maxDepth | 1.174 | 1.315 | -0.281 | -0.249 |
| newAdverseExtremes | 0.000 | 1.000 | -0.097 | -0.161 |
| lastExtensionIncrementOverInner | 0.095 | 0.136 | -0.174 | -0.163 |
| previousExtensionIncrementOverInner | 0.093 | 0.148 | -0.174 | -0.105 |
| recoveryFromExtremeOverInner | 0.367 | 0.271 | 0.222 | 0.140 |
| closeToMeanProgress | 0.136 | 0.032 | 0.211 | 0.265 |
| sideAlignedBodyOverInner | 0.122 | 0.098 | 0.107 | 0.074 |
| rangeOverInner | 0.209 | 0.169 | 0.187 | 0.024 |
| upperWickOverInner | 0.024 | 0.000 | 0.291 | -0.041 |
| lowerWickOverInner | 0.027 | 0.000 | 0.301 | -0.023 |
| trueRangeOverInner | 0.211 | 0.185 | 0.132 | 0.024 |
| meanSlopeOverInner | -0.007 | -0.005 | -0.134 | 0.039 |
| innerWidthOverTrueRange | 4.749 | 5.393 | -0.132 | -0.024 |
| outerWidthOverTrueRange | 8.138 | 9.235 | -0.132 | -0.021 |
| innerWidthChangeOverTrueRange | 0.010 | 0.008 | 0.038 | -0.032 |
| outerWidthChangeOverTrueRange | 0.018 | 0.013 | 0.038 | -0.031 |

## Interpretation boundary

- Correlation at the already-frozen confirmation bar is not a trading rule.
- Geometry features are explicitly flagged when they may proxy the same target/stop geometry used by labels.
- Validation is used once here only to assess descriptive sign stability; it was not used to tune or retest a candidate.
