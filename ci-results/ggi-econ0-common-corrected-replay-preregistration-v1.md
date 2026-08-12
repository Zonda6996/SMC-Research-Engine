# Pre-registration: ECON0 common corrected replay v1

Date: 2026-08-06

## Question

Do GGI, OWN1 and OWN2 candidate streams retain different economic value when every signal is evaluated by the same corrected moving-management replay, cost assumptions and opportunity-matched null?

ECON0 is a measurement reconciliation study. It does not tune a new signal generator and does not promote any production indicator.

## Frozen datasets and roles

Development / chronology source:

- `btc-2h`: `data/vendor-exports/incoming-2026-08/BYBIT_BTCUSDT.P_2h_full20k_vol.csv`.

Available transfer diagnostics:

- `xrp-3m`;
- `ondo-2h`;
- `ondo-15m`;
- `btc-15m`.

These files have been used by prior research. They are transfer diagnostics, not fresh sealed OOS. The ten historical ETH/SOL/XRP/AAVE/BNB 1h/2h source CSVs are not in the repository, so ECON0 v1 must report partial input coverage and must not claim full holdout validation.

## Frozen signal streams

1. `GGI`: exported BUY/SELL Shapes, no additional gating.
2. `OWN1`: frozen `body >= 1.5 x causal SMA20(body)`, drought >= 10 bars from Mean, 40-bar per-side cooldown.
3. `OWN2_BROAD`: frozen broad OWN2 causal candidates followed by the existing 20-bar per-side cooldown, with no economic score filter.
4. `OWN2_SELECTED`: the already preregistered OWN2 v1 ranker. Model fit uses the first 50% of BTC 2h, retention winner uses the next 20%, and the absolute cutoff is then applied to the final 30% and transfer datasets. ECON0 may consume the already-run frozen OWN2 winner but may not change features, bins, prior, retention levels or cutoff.
5. `MATCHED_NULL`: deterministic draws at each real stream count, matched in priority order by dataset, direction, calendar month, signal-side Mean state and causal expanding ATR55 quintile. Fallback tiers must be reported. Null draws use no GGI labels and no future outcomes.

GGI is a comparator, not a label target. Exact/near arrow overlap is not a promotion metric.

## Frozen common management

Every signal stream uses the same corrected replay:

- signal final on candle close;
- entry at next-bar open;
- static initial stop = `12 x causal SMA(TrueRange,55)` from the signal bar;
- no add;
- Partial = 25% at wick touch of the moving Mean;
- after Partial, break-even becomes active from the next bar at initial entry;
- Full = close-confirmed crossing of the moving opposite Inner boundary;
- adverse stop wick has priority within a bar;
- maximum holding = 2,000 bars, then End mark at close;
- costs = 6 bps per one-way fill, applied to actual turnover;
- funding is excluded because venue-aligned settlements are unavailable for all local exports.

The existing GGI wrapper must remain behaviorally compatible. ECON0 adds an arbitrary causal side signal API; it does not change production code.

## Windows

BTC 2h is reported as:

- full available window;
- fit: first 50%;
- validation: next 20%;
- test: final 30%.

Transfers are reported on their full available windows. Signals whose trade extends beyond a window boundary are excluded from that window to prevent cross-window outcome leakage. Full-window results may use the full future path available in that dataset.

## Primary metrics

For every dataset, window and stream:

- signals and closed trades;
- terminal Partial / Stop / Full / End counts;
- dashboard/vendor WR = `(Partial + Full) / closed`, descriptive only;
- true positive-net-return rate;
- mean and median gross/net R;
- net profit factor;
- average net R and total net-R contribution by terminal outcome;
- best 1% removed mean net R;
- turnover;
- mean holding bars;
- time-in-market bars;
- net R per 1,000 source bars;
- stream-minus-matched-null mean net R.

Aggregate transfer results use both closed-trade weighting and equal-dataset weighting. No pooled headline may hide the per-dataset signs.

## Frozen interpretation gates

ECON0 is diagnostic, not a new model promotion. Conclusions are classified as:

- `MEASUREMENT_EXPLAINS_GAP`: OWN1/OWN2 improve materially versus their DM3 results and approach GGI under common corrected management.
- `SELECTIVITY_GAP_CONFIRMED`: GGI remains positive and ahead of matched null while OWN streams remain non-positive or do not beat null.
- `TEACHER_INVALID_IN_CELL`: GGI does not beat matched null in a dataset/window; that cell cannot train or validate GGI-adjacent selection.
- `INCONCLUSIVE_PARTIAL_COVERAGE`: signs are inconsistent or local inputs are insufficient.

A material stream advantage is frozen as >= +0.03 mean net R with PF >= 1.10 and positive best-1%-removed mean. Full:Stop and dashboard WR can never override failed economic gates.

## Integrity requirements

- prefix-stable arbitrary-signal replay;
- existing GGI replay regression remains unchanged;
- no future row may enter signal construction, matching strata or score computation;
- OWN2 fit/validation roles remain exactly those in its preregistration;
- no parameters may change after ECON0 results are viewed;
- production signal defaults remain unchanged;
- generated report must state partial coverage prominently.

## Next-step rule

- If `SELECTIVITY_GAP_CONFIRMED`, proceed to a separately preregistered shallow interaction/sequence ranker.
- If `MEASUREMENT_EXPLAINS_GAP`, stop building new generators and first reconcile execution/management.
- If GGI is invalid in a cell, retain that cell only as hostile transfer, never as teacher development data.
