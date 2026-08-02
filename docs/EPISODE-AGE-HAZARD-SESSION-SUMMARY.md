# Session summary: branch research/episode-age-hazard

Date: 2026-08-02. Agent: v0. Base: research/apex-reversal-handoff @ a5c5af7.
Status at end of session: V7' FAILED at validation stage; sealed slices of both
development datasets remain UNCONSUMED. No further experiments started.

---

## 1. What was done, in order

1. Integrity baseline re-confirmed on the base branch: `npm run research:integrity`
   5/5 pass (manifest, SHA-256, counts, timestamps, band order, apex OOS regression,
   event matcher). Corpus arithmetic re-verified: 86,420 rows across 6 exact exports,
   211 BUY + 159 SELL = 370 vendor labels.
2. Branch `research/episode-age-hazard` created.
3. Three pre-detector descriptive audits implemented and committed
   (`ci/research/auditEpisodeAgeHazard.ts`, results in
   `ci-results/episode-age-hazard-audits-v1.{md,json}`).
4. V7' detector pre-registered BEFORE any run
   (`ci-results/reversal-v7prime-preregistration.md`).
5. V7' 18-config grid search executed on dev fit+validation only
   (`ci-results/reversal-v7prime-grid-search.{md,json}`).
6. Verdict recorded (`ci-results/reversal-v7prime-verdict.md`): FAIL at validation;
   the pre-registered final frozen run on sealed+holdouts was intentionally NOT
   executed because the winner already missed every gate threshold on validation.

## 2. Audit findings (descriptive, no parameters fitted)

### (a) Episode-age hazard - dev FIT slices only

Episode grammar: side episode starts at first inner-band breach, ends at close
through mean, 256-bar cap (identical to chronology v2). Hazard = first labels per
at-risk episode-bar, censored after first label.

- BTC.P 15m: hazard peak 2.51x overall (both sides) at age 24-31 bars
  (long 2.14x, short 2.74x, same bin).
- BTC.P 1h: peak only 1.80x (both) at age 8-15 bars; per side 2.23x / 2.21x
  at 0-7 / 8-15.
- KEY OBSERVATION: peak bins do NOT align in bars across timeframes (24-31 @15m
  vs 8-15 @1h) but roughly align in wall-clock time (~6-8h vs ~8-15h).
  This weakens any pure bar-based age rule and hints at a cross-TF/wall-clock state.

### (b) Global inter-label gap shape - all 6 datasets

Minimum global gaps: 57 / 58 / 57 / 60 / 52 / 56 bars. Mass at 53-56 is nearly
zero (0,0,0,0,1,1); sparse gradual rise through 57-70. This is a SOFT floor,
consistent with a rolling-window extremum mechanism (ta.highestbars-style), and
inconsistent with an explicit hard cooldown (which would pile mass at the floor).
Conclusion: the V4-style explicit `cooldownBars` model is likely wrong; the
~54-bar minimum gap is an emergent property, not a programmed lock.

### (c) Cross-TF coincidence of BTC.P labels (overlapping UTC ranges, +/-2 HTF bars)

- 15m vs 5m: observed 5/34 same-direction hits vs 0.85 expected -> 5.84x clustering.
- 4h vs 1h: observed 3/12 vs 0.47 expected -> 6.35x clustering.
- 1h vs 15m: 0/16 observed, but expectation was only ~0.6 hits -> underpowered,
  not a refutation.
Conclusion: vendor labels cluster across timeframes far above chance. A hidden
higher-timeframe (or timeframe-invariant) condition is plausible (H3 alive).

## 3. V7' experiment (pre-registered, failed)

Mechanism: episode-gated rolling-extremum. Candidate bar = inside an episode,
age >= minAge, recovery metric (fraction of half-width recovered from episode
extreme) >= threshold, and the metric is a strict maximum of its trailing
W-bar window, with endogenous W-bar same-side spacing.

Grid: W in {48,54,60} x minAge in {8,16,24} x threshold in {0.25,0.5} = 18 configs.
Selection on mean dev validation F1, exact matching (tolerance 0).

Result: best mean validation F1 = 3.03% (W=48, minAge=8, th=0.5).
BTC.P 15m validation: 0/16 exact TP. All 18 configs catastrophically below gates.
Final sealed/holdout run NOT executed; sealed budget preserved.

### Tolerance sweep diagnostic of the winner (dev fit+validation)

- btc-perp-15m (98 preds / 48 truth): tol0 2.0%/4.2%; tol10 14.3%/29.2%;
  tol20 25.5%/52.1%; tol40 35.7%/72.9% (precision/recall).
- btc-perp-1h (66 preds / 33 truth): tol0 3.0%/6.1%; tol10 15.2%/30.3%;
  tol20 28.8%/57.6%; tol40 42.4%/84.8%.
- Matched deltas at tol40 scatter widely in BOTH directions (-40..+39 bars @15m,
  -24..+30 @1h) with no constant offset -> no lag correction can rescue exact match.

Two-level interpretation:
1. REGIONS are real: the episode grammar localizes label neighborhoods
   (52-85% coverage within +/-20-40 bars at 2-4x overprediction).
2. The EXACT BAR inside a region is not explained by this recovery-extremum,
   nor by anything tried in V1-V6.

## 4. Hypothesis status after this session

- H1 (episode age as primary exact-bar variable): DEAD as an exact mechanism.
  Age carries region-level information only (2.1-2.7x hazard separation).
- H2 (rolling-window emergent lock): the soft-floor observation STANDS and
  explains the gap distribution shape, but this particular recovery metric is
  not the vendor trigger. Any future exact-bar model should still prefer an
  emergent (windowed-extremum) spacing over an explicit cooldown.
- H3 (hidden HTF condition): ALIVE and now the strongest unexplained signal
  (5.8-6.4x cross-TF clustering). Consistent with the wall-clock alignment of
  hazard peaks in audit (a).

## 5. Cumulative conclusion (V1-V6 + V7')

Seven pre-registered single-TF grammar families reproduce vendor label FREQUENCY
and REGIONS but never the exact bar. The accumulated evidence favors: the exact-bar
trigger depends on information NOT present in the OHLC+bands export - either an
internal intermediate series of the indicator, or a higher-timeframe state.
Continuing to enumerate single-TF grammars over the same information set has
strongly diminishing returns.

## 6. Agreed next steps (NOT started; recorded for the next session)

Priority 1 - new information set (cheapest expected gain):
  Ask the vendor-indicator user to re-export from TradingView with ALL intermediate
  plot series enabled in the Data Window / style settings (any internal oscillator,
  smoothed series, or state plot the indicator exposes beyond the 5 bands). Even one
  internal series could resolve the exact-bar question. Keep the same export
  discipline: exact timestamps, full precision, manifest + SHA-256, one file per
  symbol/TF, appended to data/vendor-exports/ with manifest update.

Priority 2 - V8, the last single-corpus attempt (only if/while new data is pending):
  Pre-registered HTF-conditioned detector driven by the H3 result:
  - Region candidates from the episode grammar (as in V7', which finds regions).
  - Exact-bar selection conditioned on the 4x-higher-TF state (e.g. position of the
    HTF close relative to HTF mean/inner bands), using the BTC 5m/15m/1h/4h overlap
    already in the corpus for development, ETH 15m as the (single-TF) holdout note.
  - MUST be pre-registered with a fixed search space (comparable to V7': <= ~20
    configs), same gates, same sealed discipline. Note the structural limitation:
    holdouts other than BTC lack HTF companions in the corpus, so gating logic will
    need a pre-registered adaptation (e.g. resampling LTF rows to synthesize HTF
    bands) - decide and freeze BEFORE running.

Rules that remain in force:
  - Never touch sealed slices during any search.
  - Pre-register spec + search space + kill criteria in ci-results/ BEFORE running.
  - Exact one-to-one directional matching, tolerance 0, is the primary criterion.
  - Gates: precision >= 15%, recall >= 40%, count ratio 0.5-2.0 on every futures
    holdout; sealed F1 collapse > 50% vs validation = FAIL.
  - SOL Spot 15m is reported, never gated.
  - Vendor fidelity and independent-edge research stay strictly separated.

## 7. Artifacts in this branch (commit order)

1. ci/research/auditEpisodeAgeHazard.ts + ci-results/episode-age-hazard-audits-v1.{md,json}
2. ci-results/reversal-v7prime-preregistration.md (committed before any run)
3. ci/research/runReversalV7RollingExtremum.ts (search + final modes; final never invoked)
4. ci-results/reversal-v7prime-grid-search.{md,json}
5. ci-results/reversal-v7prime-verdict.md
6. docs/EPISODE-AGE-HAZARD-SESSION-SUMMARY.md (this file)
