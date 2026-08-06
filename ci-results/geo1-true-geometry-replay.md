# GEO1 - real telegram arrows replayed through the CONFIRMED spec geometry

Geometry: stop = 2*add - entry; safe/risk step ratio 1.46; fix25 = dynamic Mean; TP = dynamic opposite inner band; BE rule after partial when fix25 crosses entry; avg entry (entry+add)/2, planned risk 1.5*step. Step choice (the one unknown): add at midpoint of entry-side outer zone.
Vendor table semantics (proved in DOGE 5m simulator): Partial row = took fix25 then stopped/BE, counted as WIN; Stop row = clean stops only.

| mode | closed | Partial% | Stop% | Full fix% | vendor-WR | true mean R | add fill% |
|---|---|---|---|---|---|---|---|
| safe | 661 | 39.9% | 26.0% | 34.0% | 74.0% | -0.1599 | 63% |
| risk | 663 | 37.7% | 30.2% | 32.1% | 69.8% | -0.1734 | 68% |

Vendor references (Nikita tables): LINK-series WR 89.4 / Stop 10.6 / Partial 42.4 / Full 47.1; DOGE 5m WR 86.6 / Stop 13.4 / Partial 37.8 / Full 48.8; AAVE 5m WR 88.7 / Stop 11.3 / Partial 30.2 / Full 58.5; risk tables WR 84.1 and 73.5.

## Per series (n >= 5 arrows)

| symbol | tf | mode | closed | P% | S% | F% | WR | mean R |
|---|---|---|---|---|---|---|---|---|
| AAVEUSDT | 120m | safe | 5 | 20.0 | 20.0 | 60.0 | 80.0 | 1.0289 |
| AAVEUSDT | 120m | risk | 5 | 20.0 | 20.0 | 60.0 | 80.0 | 1.2304 |
| AAVEUSDT | 60m | safe | 12 | 41.7 | 41.7 | 16.7 | 58.3 | -0.7452 |
| AAVEUSDT | 60m | risk | 12 | 33.3 | 41.7 | 25.0 | 58.3 | -0.2795 |
| ALGOUSDT | 120m | safe | 7 | 28.6 | 14.3 | 57.1 | 85.7 | 0.6311 |
| ALGOUSDT | 120m | risk | 7 | 28.6 | 14.3 | 57.1 | 85.7 | 1.6658 |
| ALGOUSDT | 60m | safe | 8 | 37.5 | 37.5 | 25.0 | 62.5 | -0.7629 |
| ALGOUSDT | 60m | risk | 8 | 37.5 | 37.5 | 25.0 | 62.5 | -0.5410 |
| APEUSDT | 60m | safe | 6 | 50.0 | 16.7 | 33.3 | 83.3 | 0.5777 |
| APEUSDT | 60m | risk | 6 | 50.0 | 16.7 | 33.3 | 83.3 | 0.7624 |
| APTUSDT | 120m | safe | 5 | 80.0 | 20.0 | 0.0 | 80.0 | -0.7742 |
| APTUSDT | 120m | risk | 4 | 75.0 | 25.0 | 0.0 | 75.0 | -0.9588 |
| APTUSDT | 60m | safe | 18 | 55.6 | 27.8 | 16.7 | 72.2 | -0.6243 |
| APTUSDT | 60m | risk | 18 | 38.9 | 38.9 | 22.2 | 61.1 | -0.3735 |
| ASTERUSDT | 120m | safe | 4 | 25.0 | 25.0 | 50.0 | 75.0 | -0.3232 |
| ASTERUSDT | 120m | risk | 4 | 25.0 | 25.0 | 50.0 | 75.0 | 0.0000 |
| ASTERUSDT | 60m | safe | 12 | 33.3 | 16.7 | 50.0 | 83.3 | 0.8760 |
| ASTERUSDT | 60m | risk | 13 | 46.2 | 15.4 | 38.5 | 84.6 | 1.8927 |
| ATOMUSDT | 120m | safe | 8 | 0.0 | 50.0 | 50.0 | 50.0 | -0.3058 |
| ATOMUSDT | 120m | risk | 8 | 0.0 | 50.0 | 50.0 | 50.0 | -0.1639 |
| ATOMUSDT | 60m | safe | 21 | 57.1 | 38.1 | 4.8 | 61.9 | -1.7588 |
| ATOMUSDT | 60m | risk | 21 | 57.1 | 38.1 | 4.8 | 61.9 | -1.6407 |
| AVAXUSDT | 60m | safe | 13 | 46.2 | 7.7 | 46.2 | 92.3 | 0.1826 |
| AVAXUSDT | 60m | risk | 13 | 38.5 | 15.4 | 46.2 | 84.6 | 0.3593 |
| AXSUSDT | 60m | safe | 15 | 46.7 | 6.7 | 46.7 | 93.3 | 0.2475 |
| AXSUSDT | 60m | risk | 15 | 40.0 | 13.3 | 46.7 | 86.7 | 0.6157 |
| BATUSDT | 60m | safe | 6 | 16.7 | 50.0 | 33.3 | 50.0 | -0.8605 |
| BATUSDT | 60m | risk | 6 | 16.7 | 50.0 | 33.3 | 50.0 | -0.7956 |
| BTCUSDT | 120m | safe | 5 | 60.0 | 20.0 | 20.0 | 80.0 | -0.0580 |
| BTCUSDT | 120m | risk | 5 | 60.0 | 20.0 | 20.0 | 80.0 | -0.2623 |
| BTCUSDT | 60m | safe | 9 | 44.4 | 11.1 | 44.4 | 88.9 | 0.4196 |
| BTCUSDT | 60m | risk | 9 | 33.3 | 22.2 | 44.4 | 77.8 | 0.1971 |
| DOGEUSDT | 60m | safe | 4 | 50.0 | 0.0 | 50.0 | 100.0 | 0.8777 |
| DOGEUSDT | 60m | risk | 4 | 50.0 | 0.0 | 50.0 | 100.0 | 1.0992 |
| DOTUSDT | 60m | safe | 8 | 37.5 | 25.0 | 37.5 | 75.0 | -0.3414 |
| DOTUSDT | 60m | risk | 8 | 25.0 | 37.5 | 37.5 | 62.5 | -0.5364 |
| DYDXUSDT | 60m | safe | 6 | 83.3 | 16.7 | 0.0 | 83.3 | -0.9181 |
| DYDXUSDT | 60m | risk | 6 | 66.7 | 33.3 | 0.0 | 66.7 | -1.2728 |
| ENSUSDT | 60m | safe | 5 | 40.0 | 20.0 | 40.0 | 80.0 | 0.0840 |
| ENSUSDT | 60m | risk | 5 | 40.0 | 20.0 | 40.0 | 80.0 | 0.1887 |
| ETCUSDT | 120m | safe | 5 | 60.0 | 20.0 | 20.0 | 80.0 | -0.5008 |
| ETCUSDT | 120m | risk | 5 | 60.0 | 20.0 | 20.0 | 80.0 | -0.4344 |
| ETCUSDT | 60m | safe | 16 | 31.3 | 31.3 | 37.5 | 68.8 | -0.4895 |
| ETCUSDT | 60m | risk | 16 | 31.3 | 31.3 | 37.5 | 68.8 | -0.4963 |
| ETHUSDT | 60m | safe | 10 | 10.0 | 60.0 | 30.0 | 40.0 | -0.6038 |
| ETHUSDT | 60m | risk | 10 | 10.0 | 70.0 | 20.0 | 30.0 | -1.0841 |
| FILUSDT | 120m | safe | 3 | 33.3 | 0.0 | 66.7 | 100.0 | 0.9509 |
| FILUSDT | 120m | risk | 4 | 50.0 | 0.0 | 50.0 | 100.0 | 1.1890 |
| FILUSDT | 60m | safe | 18 | 44.4 | 16.7 | 38.9 | 83.3 | -0.3114 |
| FILUSDT | 60m | risk | 18 | 38.9 | 22.2 | 38.9 | 77.8 | -0.2423 |
| GRASSUSDT | 60m | safe | 6 | 33.3 | 16.7 | 50.0 | 83.3 | 0.2571 |
| GRASSUSDT | 60m | risk | 6 | 33.3 | 16.7 | 50.0 | 83.3 | 0.4074 |
| GRTUSDT | 120m | safe | 9 | 44.4 | 33.3 | 22.2 | 66.7 | -0.4361 |
| GRTUSDT | 120m | risk | 9 | 44.4 | 33.3 | 22.2 | 66.7 | -0.2926 |
| GRTUSDT | 60m | safe | 12 | 25.0 | 41.7 | 33.3 | 58.3 | 1.1506 |
| GRTUSDT | 60m | risk | 12 | 25.0 | 41.7 | 33.3 | 58.3 | -0.1632 |
| INJUSDT | 120m | safe | 6 | 33.3 | 16.7 | 50.0 | 83.3 | 0.3687 |
| INJUSDT | 120m | risk | 6 | 33.3 | 16.7 | 50.0 | 83.3 | 0.4959 |
| INJUSDT | 60m | safe | 16 | 43.8 | 37.5 | 18.8 | 62.5 | -0.9728 |
| INJUSDT | 60m | risk | 16 | 43.8 | 43.8 | 12.5 | 56.3 | -1.3170 |
| JTOUSDT | 120m | safe | 9 | 66.7 | 22.2 | 11.1 | 77.8 | -1.1605 |
| JTOUSDT | 120m | risk | 10 | 60.0 | 30.0 | 10.0 | 70.0 | -1.2617 |
| JTOUSDT | 60m | safe | 13 | 38.5 | 15.4 | 46.2 | 84.6 | 0.5657 |
| JTOUSDT | 60m | risk | 13 | 46.2 | 15.4 | 38.5 | 84.6 | 0.4742 |
| JUPUSDT | 120m | safe | 6 | 83.3 | 0.0 | 16.7 | 100.0 | -0.7676 |
| JUPUSDT | 120m | risk | 6 | 66.7 | 16.7 | 16.7 | 83.3 | -1.1367 |
| JUPUSDT | 60m | safe | 11 | 36.4 | 36.4 | 27.3 | 63.6 | -0.5891 |
| JUPUSDT | 60m | risk | 11 | 45.5 | 27.3 | 27.3 | 72.7 | -0.4086 |
| KAITOUSDT | 120m | safe | 8 | 50.0 | 25.0 | 25.0 | 75.0 | -0.9217 |
| KAITOUSDT | 120m | risk | 9 | 33.3 | 44.4 | 22.2 | 55.6 | -0.8366 |
| KASUSDT | 60m | safe | 8 | 12.5 | 25.0 | 62.5 | 75.0 | 0.4984 |
| KASUSDT | 60m | risk | 8 | 12.5 | 25.0 | 62.5 | 75.0 | 0.7204 |
| LDOUSDT | 120m | safe | 5 | 60.0 | 20.0 | 20.0 | 80.0 | -0.5561 |
| LDOUSDT | 120m | risk | 5 | 40.0 | 20.0 | 40.0 | 80.0 | -0.4745 |
| LDOUSDT | 60m | safe | 7 | 28.6 | 71.4 | 0.0 | 28.6 | -1.7047 |
| LDOUSDT | 60m | risk | 7 | 14.3 | 85.7 | 0.0 | 14.3 | -1.9962 |
| LINKUSDT | 120m | safe | 3 | 33.3 | 0.0 | 66.7 | 100.0 | 0.9005 |
| LINKUSDT | 120m | risk | 3 | 33.3 | 0.0 | 66.7 | 100.0 | 0.3572 |
| LINKUSDT | 60m | safe | 8 | 37.5 | 25.0 | 37.5 | 75.0 | -0.2491 |
| LINKUSDT | 60m | risk | 8 | 37.5 | 25.0 | 37.5 | 75.0 | -0.2817 |
| LTCUSDT | 120m | safe | 4 | 50.0 | 0.0 | 50.0 | 100.0 | 0.2904 |
| LTCUSDT | 120m | risk | 4 | 50.0 | 0.0 | 50.0 | 100.0 | 0.3308 |
| LTCUSDT | 60m | safe | 24 | 41.7 | 20.8 | 37.5 | 79.2 | -0.0180 |
| LTCUSDT | 60m | risk | 24 | 41.7 | 20.8 | 37.5 | 79.2 | 0.0324 |
| ONDOUSDT | 120m | safe | 6 | 66.7 | 33.3 | 0.0 | 66.7 | -0.6636 |
| ONDOUSDT | 120m | risk | 6 | 66.7 | 33.3 | 0.0 | 66.7 | -0.6631 |
| ONDOUSDT | 60m | safe | 11 | 36.4 | 18.2 | 45.5 | 81.8 | -0.0364 |
| ONDOUSDT | 60m | risk | 11 | 27.3 | 18.2 | 54.5 | 81.8 | 0.5379 |
| ORDIUSDT | 60m | safe | 7 | 42.9 | 28.6 | 28.6 | 71.4 | 0.0590 |
| ORDIUSDT | 60m | risk | 7 | 28.6 | 57.1 | 14.3 | 42.9 | -1.0672 |
| POLUSDT | 60m | safe | 13 | 53.8 | 15.4 | 30.8 | 84.6 | -0.3667 |
| POLUSDT | 60m | risk | 13 | 61.5 | 15.4 | 23.1 | 84.6 | -0.3338 |
| QNTUSDT | 120m | safe | 7 | 42.9 | 28.6 | 28.6 | 71.4 | -0.2362 |
| QNTUSDT | 120m | risk | 7 | 42.9 | 28.6 | 28.6 | 71.4 | -0.3805 |
| QNTUSDT | 60m | safe | 13 | 23.1 | 30.8 | 46.2 | 69.2 | 0.1917 |
| QNTUSDT | 60m | risk | 13 | 30.8 | 30.8 | 38.5 | 69.2 | -0.0664 |
| SOLUSDT | 120m | safe | 5 | 20.0 | 0.0 | 80.0 | 100.0 | 1.0619 |
| SOLUSDT | 120m | risk | 5 | 40.0 | 0.0 | 60.0 | 100.0 | 1.7898 |
| SOLUSDT | 60m | safe | 14 | 35.7 | 35.7 | 28.6 | 64.3 | -0.1059 |
| SOLUSDT | 60m | risk | 14 | 35.7 | 42.9 | 21.4 | 57.1 | -0.7705 |
| SUIUSDT | 120m | safe | 8 | 50.0 | 37.5 | 12.5 | 62.5 | -0.5942 |
| SUIUSDT | 120m | risk | 7 | 42.9 | 42.9 | 14.3 | 57.1 | -0.5704 |
| SUIUSDT | 60m | safe | 18 | 50.0 | 16.7 | 33.3 | 83.3 | 0.1756 |
| SUIUSDT | 60m | risk | 18 | 38.9 | 27.8 | 33.3 | 72.2 | -0.1575 |
| TRXUSDT | 120m | safe | 9 | 11.1 | 33.3 | 55.6 | 66.7 | -0.1045 |
| TRXUSDT | 120m | risk | 9 | 11.1 | 33.3 | 55.6 | 66.7 | -0.0008 |
| TRXUSDT | 60m | safe | 9 | 77.8 | 11.1 | 11.1 | 88.9 | -0.9470 |
| TRXUSDT | 60m | risk | 9 | 77.8 | 11.1 | 11.1 | 88.9 | 1.9092 |
| VIRTUALUSDT | 60m | safe | 10 | 10.0 | 50.0 | 40.0 | 50.0 | 0.1818 |
| VIRTUALUSDT | 60m | risk | 10 | 10.0 | 50.0 | 40.0 | 50.0 | 0.6571 |
| WLDUSDT | 60m | safe | 17 | 41.2 | 35.3 | 23.5 | 64.7 | -0.2804 |
| WLDUSDT | 60m | risk | 17 | 41.2 | 47.1 | 11.8 | 52.9 | -1.0108 |
| XLMUSDT | 120m | safe | 4 | 0.0 | 0.0 | 100.0 | 100.0 | 3.1323 |
| XLMUSDT | 120m | risk | 4 | 0.0 | 50.0 | 50.0 | 50.0 | 0.0230 |
| XPLUSDT | 60m | safe | 7 | 42.9 | 0.0 | 57.1 | 100.0 | 0.6815 |
| XPLUSDT | 60m | risk | 7 | 42.9 | 14.3 | 42.9 | 85.7 | -0.0652 |
| XRPUSDT | 60m | safe | 10 | 50.0 | 10.0 | 40.0 | 90.0 | 0.0826 |
| XRPUSDT | 60m | risk | 10 | 40.0 | 10.0 | 50.0 | 90.0 | 0.2889 |
| ZECUSDT | 60m | safe | 12 | 25.0 | 41.7 | 33.3 | 58.3 | -0.5173 |
| ZECUSDT | 60m | risk | 12 | 25.0 | 41.7 | 33.3 | 58.3 | -0.4419 |
## Interpretation notes (appended post-run)

1. Direction is right, level is off: risk shows MORE stops than safe
   (30.2% vs 26.0%) as the 1.46 step ratio predicts, and the Partial
   share (~38-40%) is in the vendor's range. But our absolute stop rate
   (26% safe) is ~2.4x the vendor's 10.6-13.4%.
2. Prime suspect: the STEP GUESS (add at midpoint of the entry-side
   outer zone). If the vendor's step is wider, stops move further and
   the stop rate falls. Second suspect: our reconstructed bands (EMA200
   approx) - fix25/TP/add all key off them; band error compounds.
   Third: entry at next-bar-open vs vendor's possible signal-close.
3. TRUE economics of his own arrows, replayed with his own confirmed
   machinery shape: -0.16R both modes gross. Even if the stop rate
   halved to match his table, the R math stays around zero: the
   structure (partial 25% at mean + BE + far 2-step stop with 2x add)
   trades small frequent wins against rare large losses (stop with
   doubled position costs ~ -2R-plus). The vendor-WR headline is
   cosmetic; the money shape is thin at best.
4. What would sharpen this: 2-3 exact add/stop price samples from
   ACTIVE signals (like the TRX A/B) on 1h/2h to calibrate the step
   fraction properly, replacing the midpoint guess.
