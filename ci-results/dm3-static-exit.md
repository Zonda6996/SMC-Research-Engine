# DM3 static-exit results

Pre-registration: `dm3-static-exit-preregistration.md`. 6 frozen variants; static levels frozen at the signal bar (TP = opposite Inner, MID = mean); stop 12xTR55 static, stop-first, no BE, no add.

## Phase 1: calibration - BTC.P 2h full window (dashboard 50L: 16/7/27, 40S: 13/3/24)

| variant | closed L | P L | S L | F L | closed S | P S | S S | F S | End | D | WR | mean R |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| V1_moving_moving | 50 | 8 | 5 | 37 | 39 | 4 | 1 | 34 | 2 | 20.01 | 93.3% | 0.1137 |
| V2_movP_staticTPwick | 50 | 14 | 5 | 31 | 39 | 11 | 1 | 27 | 2 | 3.43 | 93.3% | 0.1540 |
| V3_movP_staticTPclose | 50 | 14 | 5 | 31 | 39 | 11 | 1 | 27 | 2 | 3.43 | 93.3% | 0.1540 |
| V4_statP_staticTPwick | 50 | 9 | 10 | 31 | 39 | 8 | 4 | 27 | 2 | 7.57 | 84.3% | 0.1733 |
| V5_statP_staticTPclose | 50 | 9 | 10 | 31 | 39 | 8 | 4 | 27 | 2 | 7.57 | 84.3% | 0.1733 |
| V6_tp_partial_then_close | 50 | 0 | 19 | 31 | 39 | 0 | 12 | 27 | 2 | 77.54 | 65.2% | 0.1874 |

Winner: **V2_movP_staticTPwick** (D=3.43; next: V3_movP_staticTPclose D=3.43). Calibration accepted.

## Phase 2: OOS - XRP 3m (dashboard 28L: 12/3/13, 33S: 9/5/19; feed caveat BINANCE vs BYBIT.P)

| variant | closed L | P L | S L | F L | closed S | P S | S S | F S | End | D | WR | mean R |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| V2_movP_staticTPwick | 29 | 11 | 2 | 16 | 33 | 11 | 3 | 19 | 1 | 2.35 | 91.9% | 0.0193 |

## Pre-registered verdict

**OOS CONFIRMED (D=2.35)**
## Interpretation notes (post-run, appended once)

1. OOS CONFIRMED under the frozen protocol, on a dataset (XRP 3m, BINANCE feed)
   and timeframe the calibration never saw. XRP counts: model 11/2/16 L +
   11/3/19 S vs dashboard 12/3/13 + 9/5/19 - every bucket within 3 trades,
   D=2.35 (threshold 8). The static-TP hypothesis came directly from Nikita's
   chart observation (horizontal TP/stop/add/fix25 lines frozen at entry).
2. Identified exit machinery (working model of the indicator's accounting):
   Partial = 25% at MOVING Mean wick; Full = STATIC TP (opposite Inner frozen
   at the signal bar), wick touch; stop static ~12xTR55; no BE; no add-trigger
   after partial. V2 vs V3 (wick vs close at TP) are observationally identical
   on both datasets - that residual fork is immaterial for counts.
3. V6 (partial at TP) is refuted (D=77) - the "partial fix" label printing at
   the TP line in Nikita's screenshot reflects the line's position at that
   MOMENT, not the trigger level. V4/V5 (static mid partial) over-produce
   stops (14 vs 10) - the partial trigger really does track the moving Mean.
4. Corrected expectancy reference UPDATED: mean gross R on BTC 2h full window
   +0.154R (V2) vs +0.114R under the old moving-Inner model; WR 93.3% closed.
   On XRP 3m OOS: +0.019R gross, WR 91.9% - the 3m edge is far thinner per
   trade, consistent with earlier findings that LTF labels are weakest.
5. Remaining unknowns after DM3: exact stop formula (12xTR55 still an envelope
   proxy - model stops 6 vs dashboard 10 on BTC suggests slightly tighter),
   and the +-1..3 residual per bucket (feed differences, still-open trades,
   boundary ties). The exit machinery question is otherwise CLOSED.
