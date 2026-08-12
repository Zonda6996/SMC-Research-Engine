# Pre-registration: DM3 - static-level exit machinery, calibrate BTC 2h / confirm XRP 3m OOS

Branch: research/independent-reversal-edge. Committed BEFORE any computation.

## Motivation (from DM2)

DM2 proved trade identification is exact on the full 20k-bar window (50L/39S+2
open vs dashboard 50L/40S) and rejected literal BE. Residual error is terminal
classification only: no-BE model gives Partial 12 / Stop 6 / Full 71 vs
dashboard 29 / 10 / 51. Nikita's XRP 3m screenshot shows STATIC horizontal
TP / stop / add / fix25 lines frozen at entry, and the "partial fix" label
sits AT the TP line - suggesting exits reference ENTRY-TIME band levels, not
moving bands, and that Partial happens at the TP level itself.

## Data

- CALIBRATION: BYBIT_BTCUSDT.P_2h_full20k.csv vs dashboard LONG 50:16/7/27,
  SHORT 40: 13/3/24.
- OOS CONFIRMATION: BINANCE_XRPUSDT_3m.csv (21,328 rows, 2026-06-22..08-05,
  30 BUY / 33 SELL after warm-up) vs dashboard TOTAL 61: LONG 28: 12/3/13,
  SHORT 33: 9/5/19. CAVEAT recorded: CSV feed is BINANCE, dashboard screenshot
  was BYBIT.P - minor count drift possible (63 vs 61 signals); shares are the
  fallback comparison if counts diverge by feed.

## Frozen variant family (6 variants - fixed BEFORE seeing any result)

All: entry next bar open; stop static 12xTR55 at entry, stop-first; no BE, no
add; End-mark (open at data end) excluded. Static levels are frozen AT THE
SIGNAL BAR: TP_long = upperInner(signal), TP_short = lowerInner(signal);
MID = mean(signal).
- V1 baseline-v2: Partial = moving Mean wick; Full = close beyond moving
  opposite Inner. (DM2 reference, D=20.04)
- V2: Partial = moving Mean wick; Full = static TP WICK touch.
- V3: Partial = moving Mean wick; Full = static TP CLOSE beyond.
- V4: Partial = static MID wick; Full = static TP wick.
- V5: Partial = static MID wick; Full = static TP close beyond.
- V6: Partial AND Full both at static TP: Partial = TP wick touch (books 25%),
  Full = CLOSE beyond TP after partial (same level; matches the screenshot
  where "partial fix" printed at the TP line).
Terminal classification for all: stop hit -> 'Partial' if partial already
booked else 'Stop'; Full trigger -> 'Full fix'.

## Frozen protocol

1. Run all 6 on BTC calibration; rank by DM1 distance D. Winner = lowest D.
2. Winner (and ONLY the winner) is then run on XRP 3m against its dashboard.
   OOS CONFIRMED: D_xrp <= 8 AND every bucket within +-6 trades (or, if feed
   drift makes counts incomparable, all bucket SHARES within +-8pp).
   OOS REFUTED: D_xrp > 16 or any bucket off by > 12.
   Otherwise INCONCLUSIVE.
3. No new variants after seeing results. If all 6 calibrate worse than D=10,
   record NO MATCH and stop.

## Gate

npm test; npx tsc --noEmit; single run each phase, committed as-is.
