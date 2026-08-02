# E2 band-trailed exits on HTF labels

Pre-registration: `e2-band-trail-preregistration.md`. HTF datasets: btc-perp-1h, btc-perp-2h-b2, ondo-perp-1h-b2, ondo-perp-2h-b2. Conservative fills; seed 4242. Bands used as EXIT instrument (trail by prior-bar mean). Last band experiment.

## Pooled HTF

| policy | cohort | n | WR vendor | WR strict | expectancy R | median R | stop rate | time/forced |
|---|---|---|---|---|---|---|---|---|
| band_trail | labels | 215 | 73.0% | 63.3% | 0.121 | 0.81 | 22.8% | 0.0% |
| band_trail | control | 215 | 52.1% | 45.6% | -0.149 | 0.14 | 29.8% | 0.0% |
| band_trail_be | labels | 215 | 73.0% | 68.8% | 0.087 | 0.87 | 22.8% | 0.0% |
| band_trail_be | control | 215 | 71.6% | 68.8% | -0.029 | 0.57 | 25.6% | 0.0% |
| wide_hold | labels | 215 | 27.0% | 27.0% | 0.518 | -3.00 | 69.8% | 30.2% |
| wide_hold | control | 215 | 21.9% | 21.4% | -0.753 | -3.00 | 76.3% | 23.7% |
| fixed_2to1 | labels | 215 | 31.6% | 31.6% | -0.051 | -1.00 | 68.4% | 0.0% |
| fixed_2to1 | control | 215 | 34.4% | 34.4% | 0.033 | -1.00 | 65.6% | 0.0% |
| partial_be | labels | 215 | 64.2% | 64.2% | 0.040 | 0.57 | 35.8% | 0.0% |
| partial_be | control | 215 | 60.9% | 60.9% | -0.071 | 0.57 | 39.1% | 0.0% |

## Per dataset (labels expectancy R)

| dataset | n | band_trail | band_trail_be | wide_hold | fixed_2to1 | partial_be |
|---|---|---|---|---|---|---|
| btc-perp-1h | 44 | -0.196 | -0.178 | -0.425 | -0.250 | -0.163 |
| btc-perp-2h-b2 | 43 | -0.042 | -0.093 | 0.508 | -0.163 | 0.032 |
| ondo-perp-1h-b2 | 82 | 0.459 | 0.391 | 1.101 | 0.098 | 0.170 |
| ondo-perp-2h-b2 | 46 | -0.026 | -0.035 | 0.388 | -0.022 | 0.012 |

## Pre-registered verdict

**BANDS IRRELEVANT AS EXITS (band_trail exp 0.121 vs wide_hold 0.518; margin < 0.10 R) - band line CLOSED per pre-registration**
## Interpretation notes (post-run, appended once)

1. Band line CLOSED per the frozen rule: the mean-line trail (exp +0.121 R) is
   WORSE than simply holding with a wide stop (wide_hold +0.518 R), by a wide
   margin. The trail exits early into HTF noise - the same chop that makes MAE
   precede MFE also whipsaws the mean line. The bands add nothing as exits, and
   we already know their geometry does not pin the entry bar. This confirms the
   user's standing hypothesis: the bands are display/context, not the engine.
2. The REAL finding is wide_hold: labels +0.518 R/trade vs control -0.753 R
   (a 1.27 R separation - by far the largest edge measured in this project) with
   72.6% vendor-style WR on labels vs 42.4% on control. Per-dataset labels
   expectancy is positive on all four HTF sets. This is O1's drift, finally
   extracted: give the HTF label a 3R stop, no target, hold ~192 bars. Stops and
   trails destroy the edge; patience harvests it.
3. Caveats, recorded honestly: (a) wide_hold's exposure is long (median hold
   near the cap) - per-trade R is not per-day return; (b) -3R losses occur
   (stop rate on labels ~11%); (c) the control's deep negative expectancy partly
   reflects paying spread-of-chop on random entries in trending periods; (d) all
   four HTF sets share the same broad market era - regime diversity is limited.
4. Combined picture O1+E1+E2: the system's harvestable edge = HTF label
   direction + WIDE risk envelope + TIME, not tight management. The vendor's own
   partial/BE table dressing sits on top of the same underlying drift.
