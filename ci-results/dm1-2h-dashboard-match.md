# DM1 BTC.P 2h dashboard-count match

Pre-registration: `dm1-2h-dashboard-match-preregistration.md`. Ground truth: vendor dashboard (LONG 50: 16/7/27, SHORT 40: 13/3/24, WR=non-stop share). Frozen v2 engine, 12xTR55, three BE semantics. End-mark trades excluded from closed buckets.

| semantics | closed L | Partial L | Stop L | Full L | closed S | Partial S | Stop S | Full S | End | D | model WR | mean R |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **dashboard** | 50 | 16 | 7 | 27 | 40 | 13 | 3 | 24 | - | 0 | 88.9% | - |
| optimistic-initial-stop | 20 | 4 | 2 | 14 | 20 | 4 | 1 | 15 | 2 | 29.77 | 92.5% | 0.0646 |
| next-bar-blended-be | 21 | 16 | 2 | 3 | 21 | 17 | 1 | 3 | 0 | 45.84 | 92.9% | 0.0435 |
| next-bar-entry-be | 21 | 16 | 2 | 3 | 21 | 17 | 1 | 3 | 0 | 45.84 | 92.9% | 0.0435 |

## Pre-registered verdict

**NO MATCH: best optimistic-initial-stop D=29.77 > 12**
## Interpretation notes (post-run, appended once)

1. NO MATCH stands per the frozen count-based metric, but the FIRST divergence
   is structural, not semantic: our CSV window contains 42 signals (21L/21S)
   while the dashboard counts 90 (50L/40S). The dashboard aggregates a window
   roughly 2x longer than the export (TradingView export depth limit). Absolute
   counts are therefore incomparable; shares are the honest exploratory view.
2. Shares (exploratory, no confirmation weight):
   dashboard: Partial 32.2% / Stop 11.1% / Full 56.7% / WR 88.9%
   no-BE:     Partial 20.0% / Stop  7.5% / Full 72.5% / WR 92.5%
   entry-BE:  Partial 78.6% / Stop  7.1% / Full 14.3% / WR 92.9%
   The dashboard sits BETWEEN the semantics but far closer to no-BE, consistent
   with DM1's frozen prediction (S-A closest). A literal move-to-entry BE is
   REJECTED even by shares (78.6% vs 32.2% Partial is not window-explainable).
   The residual gap (Partial 20 vs 32, Stop 7.5 vs 11.1) plausibly reflects the
   longer dashboard window including regimes with more stops, and/or a rare
   conditional BE.
3. Model WR 92.5-92.9% vs dashboard 88.9%: same accounting (non-stop share),
   difference consistent with window mismatch direction (older data had more
   stops).
4. To close DM1 properly ONE of: (a) dashboard counts filtered to the export's
   exact date range, or (b) 2h export chunks covering the dashboard's full
   window (two overlapping CSVs concatenate cleanly - the parser dedupes by
   timestamp). Until then, working conclusion: NO literal entry-BE on 2h;
   v2 grossR reference = optimistic-initial-stop bound.
