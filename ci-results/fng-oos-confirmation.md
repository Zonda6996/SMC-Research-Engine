# OOS confirmation run: volPressure on batch-2

Pre-registration: `fng-oos-confirmation-preregistration.md` (committed before this script existed). Single run; batch-2 is now hypothesis-SEEN for volume-derived ideas.

| dataset | new symbol | episodes | volPressure AUC | median case | median control | p (one-sided) | pass |
|---|---|---|---|---|---|---|---|
| btc-perp-15m-b2 | no | 69 | 0.618 | 0.90 | 0.67 | 0.0025 | PASS |
| btc-perp-1h-b2 | no | 27 | 0.720 | 1.67 | 0.71 | 0.0005 | PASS |
| btc-perp-2h-b2 | no | 32 | 0.757 | 1.56 | 0.77 | 0.0005 | PASS |
| ondo-perp-15m-b2 | yes | 48 | 0.689 | 1.29 | 0.72 | 0.0005 | PASS |
| ondo-perp-1h-b2 | yes | 63 | 0.719 | 1.55 | 0.78 | 0.0005 | PASS |
| ondo-perp-2h-b2 | yes | 32 | 0.724 | 1.67 | 0.79 | 0.0005 | PASS |
| bnb-perp-3m-b2 | yes | 40 | 0.693 | 1.47 | 0.54 | 0.0005 | PASS |
| sp500-cfd-1m-b2 | yes | 31 | 0.590 | 1.07 | 0.96 | 0.0465 | fail |

Passing datasets: **7 / 8** (frozen thresholds: AUC >= 0.60 and p <= 0.05; CONFIRMED needs >= 6). Significant reversals: none.
Fully new symbols (ONDO/BNB/SP500): **4 / 5** pass.

## Pre-registered verdict

**CONFIRMED**

## Diagnostics (exploratory, no confirmation weight)

Other-feature AUCs per dataset are in the JSON. Batch-2 first-look patterns there require fresh data to confirm.
## Interpretation notes (post-run, appended once)

- The effect strengthens on higher timeframes (2h: AUC 0.757/0.724) and holds on
  every crypto perp dataset including fully new symbols (ONDO x3, BNB 3m). The single
  failure is SP500 1m CFD (AUC 0.590, p 0.0465): direction correct and nominally
  significant, but below the frozen 0.60 AUC bar. Plausible moderators: CFD broker
  volume quality on 1m, session-gapped market. Recorded as an honest boundary of the
  claim, not explained away.
- Confirmation does NOT hinge on the overlapping BTC sets: new symbols pass 4/5.
- Status update: volPressure is now a CONFIRMED component of the GGI emission
  mechanism (label bars print on elevated relative volume within their stretch
  episode). It remains a component, not the mechanism: AUC ~0.6-0.76 within-episode
  cannot alone reach exact-bar precision gates.
- All batch-2 datasets are now hypothesis-SEEN for volume-derived ideas. Next
  detector-grade tests require: (a) a pre-registered N1 transform family on the
  ORIGINAL corpus with batch-2 as diagnostic only, then (b) fresh data for any
  final confirmation.
