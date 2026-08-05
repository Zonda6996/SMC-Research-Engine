# DM2 BTC.P 2h FULL-WINDOW dashboard-count match (20,130 bars)

Pre-registration: `dm2-2h-full-window-match-preregistration.md` (machinery inherited from DM1). Ground truth: vendor dashboard (LONG 50: 16/7/27, SHORT 40: 13/3/24, WR=non-stop share). Frozen v2 engine, 12xTR55, three BE semantics. End-mark trades excluded from closed buckets.

| semantics | closed L | Partial L | Stop L | Full L | closed S | Partial S | Stop S | Full S | End | D | model WR | mean R |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **dashboard** | 50 | 16 | 7 | 27 | 40 | 13 | 3 | 24 | - | 0 | 88.9% | - |
| optimistic-initial-stop | 50 | 8 | 5 | 37 | 39 | 4 | 1 | 34 | 2 | 20.01 | 93.3% | 0.1137 |
| next-bar-blended-be | 51 | 38 | 5 | 8 | 40 | 30 | 1 | 9 | 0 | 77.13 | 93.4% | 0.0732 |
| next-bar-entry-be | 51 | 38 | 5 | 8 | 40 | 30 | 1 | 9 | 0 | 77.13 | 93.4% | 0.0732 |

## Pre-registered verdict

**NO MATCH: best optimistic-initial-stop D=20.01 > 12**

## Interpretation notes (post-run, appended once)

1. NO MATCH per the frozen metric - but the window question is now CLOSED:
   model closed trades 50L / 39S vs dashboard 50L / 40S, with 2 still-open
   longs. Trade identification (Shape signals, warm-up, entry timing) is
   essentially EXACT on the full 4.6-year window. The remaining error is
   entirely in terminal classification.
2. The frozen prediction (no-BE matches) FAILED quantitatively while winning
   relatively: no-BE D=20 vs entry-BE D=77. Literal BE is now rejected on
   FULL-window counts (68 Partials vs dashboard 29), confirming Nikita's
   recollection that BE was removed. But pure no-BE produces too FEW partial
   terminals (12 vs 29), too MANY fulls (71 vs 51), too FEW stops (6 vs 10).
3. Directional diagnosis (recorded for the next pre-registration): the real
   exit machinery must (a) stop out slightly more often -> true stop is
   somewhat TIGHTER than 12xTR55 or is static-at-entry rather than recomputed,
   and (b) terminate more post-partial trades WITHOUT reaching full-fix ->
   full-fix is HARDER than close-beyond-moving-Inner. Nikita's XRP 3m
   screenshot shows STATIC horizontal TP / stop / add / fix25 lines frozen at
   entry time, while our v2 uses MOVING band levels. A static-TP variant
   (fewer fulls: price must reach the entry-time band level, no help from
   band contraction) with partial-then-timeout/stop counted as Partial moves
   every bucket in the observed direction simultaneously.
4. Next step (subject to Nikita approval): DM3 - a SMALL frozen family of
   static-level exit variants calibrated on this BTC 2h table, with the XRP
   3m dashboard (61 trades: 21 Partial / 8 Stop / 32 Full) as OUT-OF-SAMPLE
   confirmation once Nikita exports the matching XRP 3m CSV. Calibration and
   confirmation strictly separated.
5. Vendor facts recorded from Nikita: no BE in current version (older versions
   had it); add never triggers after a partial (matches our frozen no-add);
   fix25 line lingering on chart after partial is cosmetic.
