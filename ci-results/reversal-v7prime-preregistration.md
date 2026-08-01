# V7' pre-registration: episode-gated rolling-extremum detector

Branch: research/episode-age-hazard. This document is committed BEFORE any detector run.
Motivated by audits in `episode-age-hazard-audits-v1.md`: soft gap floor (H2 alive),
cross-TF clustering 5.8-6.4x (H3 alive), weak-but-real age hazard peak 2.1-2.7x (H1 weak).

## Mechanism (fixed, not searched)

Per side (long/short), causal over bars i in chronological order:

1. Episode: starts at first bar whose extreme breaches the inner band
   (long: low <= lowerInner; short: high >= upperInner); episode extreme tracked
   causally (long: min low so far; short: max high so far); ends at close through mean
   (long: close >= mean; short: close <= mean) or a 256-bar cap. Same grammar as
   chronology v2 and the audits.
2. Recovery metric, defined only inside an episode:
   long: (close - episodeLow) / (mean - lowerInner); short: (episodeHigh - close) / (upperInner - mean).
   Outside episodes the metric is -Infinity.
3. Candidate bar: all of
   a. inside an episode with age (bars since episode start) >= minAge;
   b. recovery >= threshold;
   c. recovery is a strict rolling-window maximum: recovery[i] > max(recovery[i-W+1 .. i-1])
      over the same side's metric series (ta.highestbars-style, offset 0);
   d. endogenous spacing: no same-side emission within the last W bars.
4. Emission: signal at bar i close, direction = episode side.

## Search space (18 configurations, exhaustive, no other knobs)

- W (rolling window, bars): {48, 54, 60}
- minAge (bars): {8, 16, 24}
- threshold (fraction of half-width): {0.25, 0.5}

## Selection rule (mechanical)

- Detector computed causally on dev rows [0, floor(0.75 n)) only; sealed slices never touched during search.
- Metric: exact one-to-one directional matching, tolerance 0 bars (`matchDirectionalEvents`).
- Choose the configuration with the highest MEAN validation F1 across the two development
  datasets (BTC.P 15m, BTC.P 1h). Tie-break: higher mean validation precision, then smaller W.
- Exactly ONE configuration advances. No second pick, no post-hoc adjustment.

## Final frozen run (single execution)

- Dev datasets: full series, evaluated on the sealed-test slice only.
- Futures holdouts (ETH.P 15m, BTC.P 5m, BTC.P 4h): full series, gated.
- SOL Spot 15m: reported, NOT gated (market-kind holdout, known regime differences).

## Pass/fail criteria (pre-registered)

- FAIL if sealed F1 (either dev dataset) < 50% of that dataset's validation F1.
- FAIL if ANY futures holdout misses: precision >= 15%, recall >= 40%, count ratio in [0.5, 2.0].
- Secondary diagnostics reported but not gated: tolerance-2 matching, per-side breakdown.
- If FAIL: the honest conclusion is recorded; no retuning on sealed/holdouts under this pre-registration.
