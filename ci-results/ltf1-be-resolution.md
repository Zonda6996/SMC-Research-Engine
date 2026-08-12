# LTF1 BE-resolution results

Pre-registration: `ltf1-be-resolution-preregistration.md`. Frozen v2 machinery; only the BE block varies; 15m sub-bar ordering inside 2h bars; conservative adverse-first within each 15m sub-bar.

## Pooled real trades (overlap subset)

| variant | n | WR | Stop | Partial | Full | End | mean R | median R |
|---|---|---|---|---|---|---|---|---|
| B0_none | 17 | 52.9% | 2 | 5 | 10 | 0 | -0.0766 | 0.2423 |
| B1_wick_avg | 17 | 64.7% | 2 | 13 | 2 | 0 | -0.0298 | 0.0458 |
| B2_wick_entry | 17 | 64.7% | 2 | 13 | 2 | 0 | -0.0298 | 0.0458 |
| B3_close_entry | 17 | 58.8% | 2 | 13 | 2 | 0 | -0.0649 | 0.0281 |

## OHLC-2h bounds on the SAME subset (v2 engine)

| bound | n | mean R |
|---|---|---|
| optimistic-initial-stop | 17 | -0.0766 |
| next-bar-blended-be | 17 | -0.0298 |
| next-bar-entry-be | 17 | -0.0298 |

W_ohlc = 0.0468 R; W_ltf = 0.0468 R; ambiguity share (B1 walk) = 0.0%; class changes: B1 vs OHLC entry-BE 0/17, B0 vs OHLC optimistic 0/17.

## Negative control (pseudo-signals, +37 bars, same side)

| variant | n | WR | mean R | Stop | Partial | Full | End |
|---|---|---|---|---|---|---|---|
| B0_none | 17 | 58.8% | -0.1071 | 3 | 3 | 11 | 0 |
| B1_wick_avg | 17 | 47.1% | -0.1274 | 3 | 13 | 1 | 0 |
| B2_wick_entry | 17 | 47.1% | -0.1274 | 3 | 13 | 1 | 0 |
| B3_close_entry | 17 | 35.3% | -0.1228 | 3 | 12 | 2 | 0 |

## Pre-registered verdict

**KILLED (ambiguity rate 0.0% < 15%: LTF resolves nothing material)**
## Interpretation notes (post-run, appended once)

1. KILLED per the frozen criterion, and the kill is INFORMATIVE: with the 12 x
   TR55 stop, not a single analyzed 2h bar contained a competing adverse-stop
   wick and favourable Partial/BE wick (ambiguity share 0.0%). The stop is so
   wide relative to 2h ranges that intra-bar ordering NEVER matters. The
   LTF-resolved B0 reproduced the OHLC optimistic bound EXACTLY (-0.0766, 0/17
   class changes) and B1/B2 reproduced next-bar-entry-be EXACTLY (-0.0298,
   0/17). Sub-bar data adds zero information at this stop width.
2. Consequence for the v2 expectancy interval: the BE-bounds spread (0.0468 R
   here) is NOT measurement uncertainty that finer data can shrink - it is a
   genuine SEMANTIC fork (does BE exist and at what trigger). Discriminating it
   requires vendor ground truth (dashboard outcome counts on a matched cell),
   not more granular candles. The planned 1m/3m export request is therefore
   POINTLESS for BE resolution on 2h and is withdrawn; a dashboard-matched 2h
   cell (like the BTC 15m 85/24/17/44 match) is the only discriminator.
3. Caveats: only 17/88 trades fully inside the 15m overlap window (the window
   covers the tail of the 2h range), so subset means (-0.03..-0.08 R) are noisy
   and NOT comparable to the full-window +0.0669 R headline; alignment gate
   passed cleanly (violations 0.04-0.05%).
4. B1 == B2 identity confirmed in production code (no-add). B3 (confirmed-close
   BE) sits between bounds (-0.0649) - a third semantics, still inside the
   interval, reinforcing point 2.
