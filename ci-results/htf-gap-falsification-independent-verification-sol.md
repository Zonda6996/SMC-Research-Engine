# Independent verification: H2/H3 falsification audit

Date: 2026-08-02  
Reviewer: Sol  
Reviewed branch: `research/htf-gap-falsification`  
Research result commit: `89b41a8`  
Remote HEAD at verification: `ad83edf` (CI-only gate artifact after the research commit)

## Verdict

Claude Fable 5 completed the corrective assignment correctly. The branch is reproducible, the preregistration genuinely precedes the implementation and results, production was not modified, and the stated decisions follow the frozen rules.

Independent verdicts:

- **H2: not identifiable from label gaps alone — ACCEPTED.**
- **Broad H3 used to justify V8: rejected / not advanced — ACCEPTED.**
- **V8 must not be started from the current H3 evidence.**

The two isolated pair-level coincidences remain real descriptive observations, but they do not establish one continuous hidden-HTF mechanism and are not valid grounds for a detector search on the same hypothesis-seen corpus.

## 1. Provenance and scope

Verified linear ancestry from Sol's review base `55529db`:

1. `f1e8b65` — preregistration only;
2. `933c403` — audit implementation and tests;
3. `89b41a8` — generated results and methodology addendum;
4. `ad83edf` — CI gate report only.

The preregistration commit contains no result data or executable implementation. Fixed before computation:

- windows ±30m, ±60m, ±240m;
- circular-shift null;
- seed 1337;
- 10,000 shifts;
- H2 bins and interpretation rule;
- H3 K1–K5 kill criteria;
- adjacent-pair survival rule.

Diff scope is appropriate: one research script, one test file, preregistration, JSON/Markdown results, methodology addendum and CI gate artifact. No production Reversal, Apex, UI or strategy code changed.

## 2. Reproduction

Re-run locally with managed Node 22:

- integrity baseline: 5/5 pass;
- full suite: 376/376 pass, 22 suites;
- TypeScript `--noEmit`: clean;
- audit script: regenerated JSON and Markdown with zero Git diff;
- branch after reproduction: clean.

The branch's CI artifact independently reports 376/376 and TypeScript/frontend checks clean.

## 3. Code review

Confirmed:

- one common circular shift is applied to the entire LTF event stream;
- counts, directions, circular gaps and within-stream clustering are preserved;
- near-zero and near-full-cycle shifts are excluded;
- wall-clock windows are identical across TF pairs;
- same-direction is primary and opposite-direction is a control;
- per-HTF hit statistic is binary;
- one-to-one timestamp pairs are separately recorded and do not reuse events;
- leave-one-HTF-event-out recalculates observed and null hit counts from the same stored shift/event matrix;
- four-TF common-overlap results are diagnostic only;
- K1–K5 and adjacent-pair survival are applied mechanically as preregistered;
- generated artifacts include exact timestamp pairs and dataset hypothesis-status.

The ten new tests cover deterministic shifts, gap/direction preservation, matching non-reuse, frozen windows/constants, planted and independent fixtures, prefix stability and LOO presence.

## 4. Independent robustness check

The committed null samples continuous millisecond shifts. As an independent sensitivity check, I recalculated all pairwise same-direction cells using every practical LTF-grid-aligned shift outside ±240m instead of the PRNG sample:

| pair | window | observed | aligned shifts | null mean | empirical p |
|---|---:|---:|---:|---:|---:|
| P1 15m↔5m | ±30m | 5 | 19,331 | 0.94 | 0.0023 |
| P1 15m↔5m | ±60m | 5 | 19,331 | 1.80 | 0.0377 |
| P1 15m↔5m | ±240m | 11 | 19,331 | 6.88 | 0.0698 |
| P2 1h↔15m | ±30m | 0 | 14,647 | 0.19 | 1.0000 |
| P2 1h↔15m | ±60m | 0 | 14,647 | 0.35 | 1.0000 |
| P2 1h↔15m | ±240m | 2 | 14,647 | 1.27 | 0.3690 |
| P3 4h↔1h | ±30m | 0 | 9,750 | 0.03 | 1.0000 |
| P3 4h↔1h | ±60m | 1 | 9,750 | 0.09 | 0.0868 |
| P3 4h↔1h | ±240m | 3 | 9,750 | 0.27 | 0.0009 |

The exact p-values move slightly, as expected, but the substantive pattern and the preregistered K1 rejection remain unchanged:

- P1 has a short-window isolated effect;
- P2 is null at every window;
- P3 has a long-window isolated effect;
- no common window has two adjacent significant pairs.

This supports the stability of the branch-level verdict.

## 5. Statistical interpretation

### H2

The corrected conclusion is sound. Output-label gaps cannot identify whether spacing came from:

- an explicit cooldown;
- a rolling extremum;
- one-shot episode consumption/re-arm;
- a sparse or clustered latent candidate stream.

The earlier “soft floor implies rolling window” claim is properly retracted.

### H3

K1 is triggered exactly as preregistered. The broad hypothesis needed for a coherent V8 — a hidden state propagating across adjacent TF levels — does not survive:

- P2, the central 15m↔1h link, is null;
- P1 and P3 are significant at different wall-clock scales;
- there is no adjacent-pair survival window;
- the current corpus is hypothesis-seen and therefore cannot confirm a revised H3 post hoc.

The isolated P1/P3 effects should not be erased. They may reflect common volatility regimes, timeframe-specific alignment or chance structure. They are retained as descriptive leads only. Circular-shift significance by itself does not prove the private indicator reads HTF state: both TF streams can co-cluster around the same underlying market regimes.

## 6. Minor limitations that do not change the verdict

1. The committed null uses continuous millisecond shifts, while TradingView labels live on bar grids. The aligned-shift sensitivity above confirms that this does not change the decision.
2. The synthetic independent test is one deterministic fixture, not a repeated type-I calibration study. This is sufficient for code regression but not a proof of universal null calibration.
3. Pairwise sample sizes remain small, especially P3. LOO helps, but no pair-level result should be promoted without hypothesis-unseen replication.
4. The common four-TF overlap is underpowered for P2/P3 (7 and 2 HTF events), correctly treated as diagnostic rather than a gate.

## 7. Final research decision

### Closed now

- Do not build V8 from the old hidden-HTF story.
- Do not treat the 52–60 bar minimum as evidence for either cooldown or rolling lock.
- Do not claim pure episode age was disproved; it remains untested in isolation, but the existing corpus is now exploratory for any such follow-up.
- Do not change production Reversal.

### What this means for the main goal

The current observable information set — OHLC plus five Apex bands and final BUY/SELL Shapes — has not identified the original exact-bar trigger after V1–V7 and the corrected H2/H3 audit. Continuing to enumerate detector grammars on the same labels has poor expected value and increasing researcher degrees of freedom.

The vendor-fidelity track should now be considered **blocked by identifiability**, not merely awaiting a better grid.

The next rational project decision is between:

1. acquire genuinely new observable information from the indicator/source or a hypothesis-unseen controlled dataset tied to a specific new mechanism; or
2. stop claiming source reconstruction and begin a separately preregistered independent-edge replacement study using causal features and trading outcomes.

No further V8/V9 vendor-formula search is recommended on the current six-dataset corpus.
