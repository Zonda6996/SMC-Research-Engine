# Methodology addendum to research/episode-age-hazard

Date: 2026-08-02. Author: Fable (v0), in response to Sol's independent review
(`episode-age-hazard-independent-review-sol.md`). Old committed artifacts are NOT
rewritten; this addendum corrects their interpretation.

## Corrections to previously published claims

1. **V7' did not test pure episode age.** It tested a coupled family:
   minAge + recovery threshold + rolling recovery maximum + spacing. Its FAIL kills
   only that coupled family as an exact-bar selector. The claim in the session
   summary that H1/episode-age is "DEAD as an exact mechanism" was overreach and is
   WEAKENED to: "the coupled V7' family is dead; pure age as a conditioning variable
   remains untested in isolation."

2. **The V7' lock was same-side, not global.** `lastEmit` in `detectV7()` lives
   inside the per-side loop, so BUY never blocked SELL. The original observation
   (minimum ~52-60 bar gap) is about GLOBAL inter-label gaps across both sides.
   V7' therefore tested a different spacing hypothesis than the one motivating it.
   Additionally, V7' did not consume episodes (a long episode could re-emit after W
   bars), diverging from the expected one-shot architecture.

3. **The "soft floor => rolling extremum, explicit cooldown unlikely" inference is
   RETRACTED.** Absence of pile-up at the gap floor is not evidence against a hard
   cooldown: post-unlock waiting time depends on the unobserved candidate stream's
   intensity and clustering. Without the candidate stream, cooldown vs emergent
   rolling lock vs sparse candidate stream are not identifiable from label gaps
   alone. The falsification audit confirms H2 status: NOT IDENTIFIABLE from label
   gaps alone (no observed global gap violates any global-cooldown constant <= the
   observed minimum, so nothing is excluded either).

4. **Corpus status for H2/H3.** The original H2/H3 audits consumed all 370 labels of
   all six datasets, including previously-holdout series. ETH.P 15m, BTC.P 5m/4h and
   the dev sealed slices remain execution-unseen for the never-run V7' final, but
   they are hypothesis-SEEN for anything derived from H2/H3. They can no longer
   serve as final OOS confirmation for H2/H3-derived models (development/exploratory
   use only). The dataset-status table is in `htf-gap-falsification.md`.

5. **The original H3 evidence was overstated.** "5.8-6.4x clustering" rested on 8
   positive coincidences, a Poisson independence baseline ignoring autocorrelation
   and label clustering, unequal wall-clock windows (+/-2 HTF bars = +/-30 min at
   15m but +/-8 h at 4h), and no permutation null, confidence intervals, or
   leave-one-out. Calling H3 "the strongest unexplained signal" was premature.

6. **Missing V7' deliverables acknowledged.** Per-side metrics, count ratios,
   inter-signal gap diagnostics, +/-1-bar diagnostics per config, and unit tests for
   prefix stability / one-shot consumption / lock behavior were not produced for
   V7'. Since V7' is dead, these are not being backfilled; any future detector must
   ship them from the start.

## Outcome of the pre-registered falsification audit (this branch)

- **H2 verdict: not identifiable from label gaps alone.** Descriptive global and
  same-side distributions are published; no mechanism claim is made.
- **H3 verdict: REJECTED / NOT ADVANCED under pre-registered kill criterion K1.**
  Same-direction empirical p > 0.05 on >= 2 of 3 TF pairs in ALL three frozen
  windows (+/-30m, +/-60m, +/-240m). Detail: P1 (15m vs 5m) alone is robustly
  significant at +/-30m (p=0.0011, 5.8x, LOO-stable) and P3 (4h vs 1h) alone at
  +/-240m (p=0.0004, 12.7x, LOO-stable), but P2 (1h vs 15m) is null in every window
  and no two ADJACENT pairs are significant in the SAME window. Under the frozen
  criteria this is rejection; the isolated pair-level signals are recorded honestly
  in the JSON for any future, pre-registered re-examination on hypothesis-unseen
  data, but H3 is not advanced and V8 is not created.

## Standing narrow conclusion (unchanged)

Single-TF OHLC+bands grammars (V1-V7') locate broad Reversal regions but not the
exact emission bar. No mechanism (age, cooldown, rolling lock, HTF state) is
established. Progress requires either a genuinely new information set (future
appended period or new symbol/TF pairs with HTF companions, per the OOS spec in
`htf-gap-falsification.md`) or a fundamentally different, pre-registered question.
