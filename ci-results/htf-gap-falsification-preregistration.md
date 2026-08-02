# Pre-registration: H2/H3 falsification audit

Branch: research/htf-gap-falsification (from research/episode-age-hazard @ 55529db).
This file is committed BEFORE any computation. After this commit, windows, bins,
null model, seed, and kill criteria are FROZEN. No windows or metrics may be added
after seeing results. No detector is built. V8 is NOT started in this session.

Corpus status acknowledged up front: all six datasets are hypothesis-SEEN for
H2/H3 (the original audits consumed all 370 labels). Everything below is
exploratory/development-grade evidence for any H2/H3-derived model; it can kill
H3 but cannot confirm it as out-of-sample truth.

## Audit H2: gap mechanism identifiability

Question: can inter-label gap shape alone distinguish (i) explicit global
cooldown, (ii) same-side cooldown, (iii) rolling-window extremum,
(iv) sparse/clustered base candidate stream?

Frozen outputs per dataset (all 6):
- GLOBAL gap distribution (any-side consecutive labels, bars).
- SAME-SIDE gap distributions (BUY->BUY, SELL->SELL, bars).
- Fixed descriptive bins (bars): [0,54), [54,58), [58,70), [70,100), [100,200),
  [200,400), [400,800), [800,inf). No other bins will be reported.
- Post-minimum survival: empirical P(gap > g) at g = min+0, +5, +10, +20 (descriptive).

Frozen interpretation rule: absence of pile-up at the floor is NOT evidence
against a hard cooldown (depends on unobserved candidate stream intensity).
H2 verdict must be one of:
- "not identifiable from label gaps alone" (expected default);
- "evidence inconsistent with a specific lock family" (only with a formally
  stated discriminating observation, defined here: a lock family is inconsistent
  only if observed gaps VIOLATE a hard constraint it implies, e.g. a global
  cooldown of C bars is inconsistent iff some global gap < C);
- "robust evidence for a mechanism" (not expected; requires simulation-based
  falsification which is out of scope here).
No detector, no F1 usage.

## Audit H3: cross-TF coincidence falsification

Pairs (BTC.P futures only, common pairwise UTC overlap):
- P1: 5m (LTF) vs 15m (HTF)
- P2: 15m (LTF) vs 1h (HTF)
- P3: 1h (LTF) vs 4h (HTF)
Plus a four-TF common-overlap diagnostic (all four series' intersection), same
windows, reported for each pair restricted to that intersection (diagnostic only,
not a selection axis).

Windows (wall-clock, FROZEN, identical for all pairs): +/-30 min, +/-60 min, +/-240 min.
Match rule: |t_LTF - t_HTF| <= window, direction-aware.
- Primary: same-direction (BUY-BUY, SELL-SELL).
- Negative control: opposite-direction, same windows.
- Per-HTF-event binary hit (primary statistic = number of HTF events with >= 1 hit).
- Also reported: one-to-one greedy matching (sorted by |dt|, each LTF event used
  at most once) with exact matched timestamp pairs in the JSON artifact.

Null model (FROZEN): circular shift of the ENTIRE LTF label stream in wall-clock
milliseconds within the pairwise overlap [T0, T1), L = T1 - T0:
  t'_j = T0 + ((t_j - T0 + s) mod L), one common s for all LTF events (preserves
  inter-label gaps, sides, clustering; directions untouched).
- N = 10,000 deterministic shifts: s_k = offsets drawn from mulberry32 PRNG,
  seed = 1337, s_k = E + u_k * (L - 2E), u_k in [0,1), where E = 240 min
  (the maximum test window), excluding trivial near-zero and near-L shifts.
- Empirical one-sided p-value = (1 + #{null_hits >= observed_hits}) / (1 + N).
- Reported per pair x window x direction-mode: observed hits/rate, null mean,
  null quantiles (50/90/95/99%), p-value, enrichment = observed / null mean
  (with null mean floored at 1e-9 for reporting only).

Leave-one-HTF-event-out (FROZEN): for each HTF event, remove it, recompute
observed hits and empirical p against the same stored null (per-shift per-event
hit matrix); report min/max enrichment and max p across removals.

## Kill criteria for H3 (FROZEN, any one triggers "H3 rejected / not advanced")

K1. Same-direction empirical p > 0.05 on >= 2 of 3 TF pairs in ALL THREE windows.
K2. In every pair that shows p <= 0.05, the effect is lost after removing a single
    HTF event (LOO max p > 0.10 or LOO min enrichment < 1.5).
K3. Opposite-direction control shows comparable enrichment (control enrichment
    >= 0.8 * same-direction enrichment in the same pair and window, for every
    pair/window where same-direction is significant).
K4. Effect exists only at +/-240m and is absent (p > 0.05) at both +/-30m and
    +/-60m in every significant pair (no pre-specified mechanism predicts this).
K5. Every significant pairwise result disappears (p > 0.10) on the four-TF
    common overlap despite a non-degenerate sample there (>= 8 HTF events).

"H3 survives falsification" requires ALL of: same-direction enrichment with
p <= 0.05 in at least two adjacent TF pairs in at least one common window,
robust to single-event removal (LOO max p <= 0.10 and min enrichment >= 1.5),
and not mirrored by the opposite-direction control. Survival does NOT prove the
vendor mechanism and does NOT authorize V8.

## Code and tests (to be added after this commit)

- ci/research/auditHtfGapFalsification.ts (script, modes: run)
- tests/htfGapFalsification.test.ts (deterministic shifts; shift preserves
  counts/directions/gaps; one-to-one matching no-reuse; identical wall-clock
  windows across pairs; synthetic planted-coincidence positive fixture;
  synthetic independent fixture no systematic false enrichment; prefix/no-future
  stability of event-stream preparation).

## Gate to run at the end

npm run research:integrity; npm test; npx tsc --noEmit.

## Prohibited in this session

V8 development or any detector run; profitability analysis; production changes;
adding windows/bins/criteria after seeing results; requesting new data.
