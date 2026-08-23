# Stateful Apex Track S4 v2 — frozen rule; holdout blocked without reveal

- Status: **RULE_FROZEN_HOLDOUT_BLOCKED_NO_REVEAL**.
- Exactly one candidate, one scalar cutoff, and one operator. No PnL grid, operator search, or subgroup search.
- New holdout raw files/rows/events/features/labels/PnL/metrics read or computed: **0/0/0/0/0/0/0**.
- S1 untouched OOS reveal count: **0**. ONDO/VIRTUAL reuse count: **0**.

## Causal timing and exact feature

`recoveryFromExtremeOverInner` is captured on the `REVERSAL_CONFIRMED` bar, before entry at the next bar open. For long episodes it is `(confirmation close - adverse low extreme) / contemporaneous innerWidth`; for short episodes it is `(adverse high extreme - confirmation close) / contemporaneous innerWidth`. On that bar the state machine first checks for a new adverse extreme; confirmation is allowed only when there is none and the close moved closer to Mean. The payload is then captured before emission. It is therefore causal at admission time and does not use the later outcome.

## Frozen rule

`admit = (recoveryFromExtremeOverInner >= 0.3203983409316291)`

Cutoff **0.3203983409316291** is the deterministic empirical median (q=0.5, linear interpolation) of 2770 development feature values. Only the feature column of the already-published diagnostic ledger was projected; labels and PnL read for cutoff selection: **0**.

The operator is fixed by the preregistered direction, not PnL: the selected association with `favorableThenStop` is negative, so larger recovery corresponds to less of that adverse mechanism; the upper half is admitted.

## Holdout blocker

No new independent internal-holdout universe was specified by the preregistration or another pre-existing selection rule. The remaining local CSV inventory mixes previously used research series and potential candidates; choosing among them now would require subjective post-diagnostic selection. No raw candidate holdout file was opened.

Excluded: S1 untouched OOS, ONDO/VIRTUAL, S4 development series, and any Vendor-Shape-derived universe. No local candidate series was opened.

Acceptable ways forward (freeze exact universe before acquisition/opening):
1. Before download, freeze a venue/market, fixed symbol list from an external label-free rule, timeframe(s), UTC start/end, bar schema, and missing-data policy; then acquire a future non-overlapping period.
2. Before download, freeze a deterministic label-free universe rule from a dated exchange listing snapshot (for example rank by contemporaneous quote volume with fixed exclusions), plus fixed N, timeframe(s), and UTC window.
3. Use an author-supplied new export only if its exact symbol/market/timeframe/window list is declared in writing before any file is opened and none of the exclusions apply.

## Frozen evaluation

- Costs: **5 bps/side**, taker; funding not modeled.
- Bootstrap: 10,000 hierarchical symbol→symbol-month resamples, seed `20260821`, percentile CI95; paired v1 baseline on identical events.
- Minimum breadth before reveal: >=3 previously unused whole symbols and >=3 independent series.
- PROMOTE only if all gates pass: v2 mean netR>0; CI95 low>0; paired delta>0 with CI95 low>0; >=60% positive symbols; >=60% positive series. Otherwise KILL.

After reveal it is forbidden to retune the cutoff/operator/rule/execution/costs/bootstrap/gates, reuse the holdout, run PnL/operator/subgroup rescue, exclude losers, read S1 OOS, reuse ONDO/VIRTUAL, or use Vendor Shapes.

## Hashes

- Config SHA-256: `6b5fa5c9de7f26ac3f71ba258065c5ab5a22fd4eb17b57d7634013acc42b765f`
- Protocol SHA-256: `b7119204cb71c3ccb3582e4dfd1c5cfc03943a46ff6e370cd5e8257ee8e7fc70`
- Upstream diagnostic JSON: `859f7423a5ad48995eaeaea00ed3499b88bce8590babe0ffb2436d2ac8dfcf12`
- Upstream diagnostic MD: `0d1bb7783ac9102c83824b118cd15f784dfe58ec0231df5afa49c018c6f380e9`
- Preregistration: `751fcedb42cf05d02ec480ce052abb7db813759a60651060da752661daf45464`
- Manifest: `1eafaf72b8a5efd571a680e497f90c1416bd346eae543857c891a87d6bbb30ba`
- State machine: `5f82d45de35ede30e08599372e5cabd46bb04402ddc47de488fad1bfecb449c8`
- Diagnostic runner: `d73bc8d8cd61009542abb5e9f084a234c4fef6b2aedf33924060ea649a85ad10`
- Freeze runner: `94c204d0d372e6c6aded2c2033ccbbc62c48bc61796bdcdfc23fa02332ca879c`
