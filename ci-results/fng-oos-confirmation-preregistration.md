# Pre-registration: OOS confirmation of the volPressure discriminator (batch-2 corpus)

Branch: research/fng-case-control. Committed BEFORE any feature/AUC computation on
batch-2 data and BEFORE the run script exists. Everything below is FROZEN.

## Hypothesis under test (single, primary)

H-VOL: within label-carrying episodes, the vendor label bar has systematically
HIGHER relative volume (volPressure = volume / SMA(volume, 50)) than other bars of
the same episode. Direction is fixed a priori (AUC > 0.5); this is one-sided.

Discovered on the original 6-dataset corpus (fng-case-control-audit.md: top feature
on all 6, AUC 0.618-0.708). Batch-2 (manifest-batch2.json, 8 datasets, 98,687 rows,
447 labels) is hypothesis-unseen for this hypothesis and is consumed by THIS single
pre-registered run. After this run, batch-2 becomes hypothesis-seen for volume ideas.

## Method (identical to the discovery audit, frozen)

- Episode grammar, case/control definition, ±2-bar buffer, 256-bar cap, side
  mirroring: exactly as in fng-case-control-preregistration.md. volPressure is
  side-symmetric (not mirrored).
- Analysis starts at warmupRows per manifest-batch2.json (listing artifacts).
- Volume source: inline Volume column of the batch-2 CSVs.
- Primary statistic per dataset: volPressure AUC (cases vs pooled controls) +
  one-sided within-episode permutation p (case position re-drawn uniformly inside
  each episode; 2,000 permutations; mulberry32 seed 4242; p = P(perm AUC >= observed)).
- The other 11 features from the discovery audit are computed and reported as
  DIAGNOSTICS ONLY; they carry no confirmation weight (batch-2 is their first look,
  so any pattern there is exploratory).

## Confirmation criteria (frozen; primary = 8 batch-2 datasets)

- CONFIRMED: volPressure AUC >= 0.60 AND one-sided p <= 0.05 on >= 6 of 8 datasets,
  and NO dataset shows significant reversal (AUC <= 0.40 with p_reversed <= 0.05).
- PARTIAL: criteria met on 4-5 of 8 -> effect real but unstable across
  assets/timeframes; report per-dataset moderators honestly; no detector yet.
- REFUTED: criteria met on <= 3 of 8 -> the discovery-corpus result is treated as
  a development artifact; volume line is closed absent new data.

Note: btc-perp-15m-b2 / btc-perp-1h-b2 partially overlap the discovery period.
They count toward the tally as pre-registered, but the report must additionally
show ONDO/BNB/SP500 (fully new symbols) separately; if confirmation hinges ONLY on
overlapping BTC sets, the verdict text must say so explicitly.

## Out of scope (this run)

No detector, no grid, no exit-logic analysis, no HTF cross-checks, no use of
batch-2 for any other hypothesis. One run, results committed as-is.

## Gate

npm run research:integrity; npm test; npx tsc --noEmit.
