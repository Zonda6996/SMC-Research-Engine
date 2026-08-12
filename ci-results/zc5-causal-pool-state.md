# ZC5 - causal pool state (prefix re-detection at every signal)

Symbols: BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, BNBUSDT, DOGEUSDT, ADAUSDT, LINKUSDT, LTCUSDT, AVAXUSDT, DOTUSDT, ATOMUSDT. 1h OWN1 trigger, 4h zones, machinery P25/S12. Total evaluated signals: 2113.
Pools recomputed on the 4h prefix closed before each signal - notional/status/rank are knowledge-at-T, no look-ahead.
SELECTIVE = rank < 2/3 (not heaviest) AND entry strictly in band AND pool swept within 24h.

| group | n | mean R | WR | P/S/F |
|---|---|---|---|---|
| in|SELECTIVE | 54 | 0.1789 | 98.1% | 16/1/37 |
| in|any | 852 | -0.0301 | 90.5% | 313/81/458 |
| in|w-low | 25 | 0.2674 | 96.0% | 5/1/19 |
| in|w-mid | 98 | 0.1652 | 94.9% | 27/5/66 |
| in|w-top | 729 | -0.0666 | 89.7% | 281/75/373 |
| out|any | 1261 | 0.0059 | 95.7% | 423/54/784 |

out-zone mean: 0.0059
bootstrap P(slice <= out): in|any=0.927, in|w-low=0.017, in|w-mid=0.009, in|SELECTIVE=0.026

## SELECTIVE trades (all)

| date | symbol | side | R | outcome | rank | alive pools |
|---|---|---|---|---|---|---|
| 2025-07-07T07:00 | BTCUSDT | S | -0.723 | Partial | 0.56 | 287 |
| 2025-12-03T15:00 | BTCUSDT | S | 0.587 | Full fix | 0.48 | 381 |
| 2026-03-10T04:00 | BTCUSDT | S | 0.454 | Full fix | 0.46 | 608 |
| 2026-06-21T12:00 | BTCUSDT | S | 0.584 | Full fix | 0.52 | 767 |
| 2025-12-08T16:00 | ETHUSDT | S | 0.330 | Full fix | 0.65 | 354 |
| 2026-01-28T15:00 | ETHUSDT | S | 0.551 | Full fix | 0.50 | 441 |
| 2026-07-10T15:00 | ETHUSDT | S | -0.764 | Partial | 0.21 | 774 |
| 2025-08-05T04:00 | SOLUSDT | S | -0.698 | Partial | 0.48 | 197 |
| 2025-10-14T05:00 | SOLUSDT | S | 0.645 | Full fix | 0.60 | 162 |
| 2026-02-21T17:00 | SOLUSDT | S | 0.607 | Full fix | 0.30 | 535 |
| 2026-05-21T06:00 | SOLUSDT | S | 0.508 | Full fix | 0.35 | 677 |
| 2026-01-14T05:00 | XRPUSDT | S | 0.567 | Full fix | 0.53 | 458 |
| 2026-02-25T23:00 | XRPUSDT | S | 0.694 | Full fix | 0.42 | 596 |
| 2026-03-04T23:00 | XRPUSDT | S | 0.573 | Full fix | 0.55 | 618 |
| 2026-03-13T12:00 | XRPUSDT | S | -0.699 | Partial | 0.14 | 640 |
| 2026-04-06T17:00 | XRPUSDT | S | -0.684 | Partial | 0.15 | 679 |
| 2026-06-15T22:00 | XRPUSDT | S | 0.880 | Full fix | 0.46 | 847 |
| 2026-07-21T21:00 | XRPUSDT | S | 0.660 | Full fix | 0.63 | 944 |
| 2025-12-03T15:00 | BNBUSDT | S | 0.670 | Full fix | 0.02 | 174 |
| 2025-12-08T12:00 | BNBUSDT | S | 0.551 | Full fix | 0.10 | 176 |
| 2026-01-17T17:00 | BNBUSDT | S | 0.645 | Full fix | 0.24 | 234 |
| 2026-02-14T13:00 | BNBUSDT | S | 0.596 | Full fix | 0.60 | 335 |
| 2026-02-21T16:00 | BNBUSDT | S | 0.638 | Full fix | 0.61 | 358 |
| 2026-04-18T04:00 | BNBUSDT | S | -0.698 | Partial | 0.50 | 468 |
| 2025-08-05T04:00 | DOGEUSDT | S | -0.702 | Partial | 0.42 | 251 |
| 2026-02-14T13:00 | DOGEUSDT | S | -1.000 | Stop | 0.52 | 623 |
| 2026-04-22T17:00 | DOGEUSDT | S | -0.711 | Partial | 0.42 | 753 |
| 2026-02-25T23:00 | ADAUSDT | S | 0.927 | Full fix | 0.47 | 697 |
| 2026-04-16T17:00 | ADAUSDT | S | -0.759 | Partial | 0.04 | 803 |
| 2025-07-03T15:00 | LINKUSDT | S | -0.693 | Partial | 0.66 | 354 |
| 2026-03-09T23:00 | LINKUSDT | S | -0.755 | Partial | 0.51 | 666 |
| 2026-04-06T17:00 | LINKUSDT | S | -0.660 | Partial | 0.62 | 717 |
| 2026-04-12T21:00 | LINKUSDT | L | 0.564 | Full fix | 0.49 | 543 |
| 2026-05-06T14:00 | LINKUSDT | S | 0.614 | Full fix | 0.54 | 768 |
| 2026-05-12T18:00 | LINKUSDT | L | -0.705 | Partial | 0.63 | 655 |
| 2026-02-21T10:00 | LTCUSDT | S | 0.586 | Full fix | 0.05 | 531 |
| 2026-06-24T06:00 | LTCUSDT | L | 0.713 | Full fix | 0.52 | 68 |
| 2025-12-08T16:00 | AVAXUSDT | S | 0.360 | Full fix | 0.61 | 576 |
| 2026-01-14T11:00 | AVAXUSDT | S | 0.692 | Full fix | 0.67 | 546 |
| 2026-05-09T15:00 | AVAXUSDT | S | 0.447 | Full fix | 0.38 | 821 |
| 2026-07-03T23:00 | AVAXUSDT | S | 0.654 | Full fix | 0.58 | 968 |
| 2025-07-04T23:00 | DOTUSDT | L | 0.513 | Full fix | 0.19 | 76 |
| 2026-01-19T17:00 | DOTUSDT | L | -0.770 | Partial | 0.54 | 127 |
| 2026-07-10T15:00 | DOTUSDT | S | 0.575 | Full fix | 0.39 | 1103 |
| 2026-07-21T21:00 | DOTUSDT | S | 0.504 | Full fix | 0.39 | 1139 |
| 2025-07-27T09:00 | ATOMUSDT | S | 0.573 | Full fix | 0.58 | 882 |
| 2025-08-04T02:00 | ATOMUSDT | S | -0.715 | Partial | 0.31 | 920 |
| 2026-01-10T14:00 | ATOMUSDT | S | 0.491 | Full fix | 0.59 | 1169 |
| 2026-04-25T17:00 | ATOMUSDT | S | 0.738 | Full fix | 0.48 | 1243 |
| 2026-04-28T17:00 | ATOMUSDT | L | 0.704 | Full fix | 0.41 | 178 |
| 2026-05-01T09:00 | ATOMUSDT | L | 0.664 | Full fix | 0.44 | 182 |
| 2026-06-09T00:00 | ATOMUSDT | S | -0.734 | Partial | 0.54 | 1248 |
| 2026-06-11T10:00 | ATOMUSDT | S | 0.454 | Full fix | 0.39 | 1234 |
| 2026-07-11T22:00 | ATOMUSDT | S | 0.612 | Full fix | 0.26 | 1277 |
## Interpretation notes (appended post-run)

1. THE INVERSION SURVIVES FULL CAUSALITY. With pools recomputed on the
   4h prefix before every signal (zero look-ahead), the ranking is
   monotonic and significant: w-low +0.267R (p=0.017), w-mid +0.165R
   (p=0.009), w-top -0.067R; in|any -0.030R vs out 0.006R (p=0.927).
   Same shape as ZC3 (global rank) and ZC4 (final-notional rank) -
   three ranking schemes, one conclusion: heaviest pools get sliced,
   light/mid pools reverse.
2. SELECTIVE rule (fixed a priori: rank<2/3 + strictly in band + swept
   <= 24h): n=54 of 2113 signals = 2.6% pass rate - REAL selectivity,
   comparable to vendor hand zones (52 of 736). Result +0.179R,
   WR 98.1%, ONE stop in 54 trades, p=0.026. This is the first
   automated zone rule in the series that both selects and earns.
3. Caveats before anyone gets excited:
   - n=54, single 14-month window, 12 majors, gross R (no fees);
     at 1h TP distances fees bite less than 15m but still bite;
   - alive-pool counts grow over the window (287 -> 767 on BTC) -
     the engine accumulates pools; rank is relative so the filter
     self-adjusts, but absolute pool bookkeeping needs the production
     causal engine anyway;
   - the SELECTIVE definition uses the same grace window (24h) twice
     (eligibility + sweep-recency), so it is really "signal within
     24h of a sweep of a non-heavy pool, entered in-band".
4. NEXT: port this exact rule into a small causal pool-state module
   (incremental, O(1) per bar) + OWN1 + P25/S12 machinery = the
   engine module Nikita asked about. Validate on fresh months as they
   arrive before any capital.
