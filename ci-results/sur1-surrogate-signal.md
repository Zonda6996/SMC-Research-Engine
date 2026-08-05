# SUR1 surrogate signal results

Pre-registration: `sur1-surrogate-signal-preregistration.md`. DM3 V2 exits everywhere; capture C = (sur - rand) / (arrows - rand).

## Calibration - BTC.P 2h (arrows: n=84, meanR=-0.0934, WR=88.1%; random @ arrow-n: -0.1007 [-0.1863..0.0047])

| rule | n | mean R | WR | capture C |
|---|---|---|---|---|
| S1_wick_outer/k1.25 | 64 | -0.0386 | 84.4% | 6.922 |
| S1_wick_outer/k1.75 | 64 | -0.0401 | 84.4% | 10.365 |
| S1_wick_outer/k2.5 | 63 | -0.0274 | 84.1% | 8.708 |
| S2_close_outer/k1.25 | 46 | -0.0389 | 84.8% | 4.503 |
| S2_close_outer/k1.75 | 44 | -0.0390 | 84.1% | 5.810 |
| S2_close_outer/k2.5 | 41 | -0.0264 | 82.9% | 7.409 |
| S3_twobar_outer/k1.25 | 64 | -0.0386 | 84.4% | 9.737 |
| S3_twobar_outer/k1.75 | 64 | -0.0401 | 84.4% | 6.987 |
| S3_twobar_outer/k2.5 | 63 | -0.0274 | 84.1% | 10.339 |

## OOS (winner only)

| dataset | sur n | sur mean R | sur WR | arrows n | arrows mean R | random | C |
|---|---|---|---|---|---|---|---|
| ondo-2h | 28 | -0.2156 | 82.1% | 46 | 0.0228 | -0.0450 | -2.517 |
| ondo-15m | 30 | 0.1572 | 80.0% | 60 | 0.1363 | -0.0013 | 1.152 |

Pooled OOS capture: **-0.004**

## Pre-registered verdict

**FAILURE (calib C=10.365 but pooled OOS C=-0.004 < 0.2)**
## Interpretation notes (post-run, appended once)

1. FAILURE stands per the frozen protocol. But the run also exposed a METRIC
   DEGENERACY that must be recorded: on the amended calibration set (BTC 15m)
   the ARROWS themselves earn -0.0934R mean vs random -0.1007R - a denominator
   of 0.007R. Capture C values of 4..10 are therefore noise amplification, and
   the "winner" selection among the 9 rules was effectively random. The report
   header mislabels the calibration as "BTC.P 2h" - it was BTC.P 15m per
   amendment 1; recorded here rather than editing the generated section.
2. What is still informative: (a) surrogate WR 82-85% with meanR -0.03..-0.04
   on BTC 15m - stretch+volume DOES produce arrow-like accounting shapes but
   no money on LTF, same as the arrows themselves there; (b) OOS split is the
   real signal: ondo-15m surrogate BEAT the arrows (+0.157R vs +0.136R,
   C=1.15) while ondo-2h surrogate badly lost (-0.216R vs +0.023R, C=-2.5).
   The surrogate is not uniformly worthless - it is UNSTABLE across assets/TFs.
3. The pre-registered question - can a surrogate capture the arrows' edge WHERE
   THE ARROWS ACTUALLY EARN (BTC 2h, +0.154R) - remains UNTESTED, because both
   datasets where arrows earn meaningfully on HTF lack a volume column.
   Deferred per amendment 1: re-run needs BTC.P 2h and XRP 3m re-exports WITH
   volume. No new rules will be added for that run; same 9, same thresholds.
4. Recorded conclusion so far: hidden-state contribution cannot be dismissed;
   stretch+volume alone does not transfer reliably. SUR1 final verdict waits
   on the volume re-exports; if the deferred run also fails, surrogate
   direction is closed and TV alerts remain the only live-signal path.
