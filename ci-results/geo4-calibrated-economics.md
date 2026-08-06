# GEO4 - final economics with calibrated geometry (step=5.5*ATR200, R: add-filled stop = -1R)

## Arm A: vendor telegram arrows (~660 fwd, 1h/2h)

- **safe**: closed 660 | WR(vendor) 88.2% | Stop 11.8% | Partial 51.2% | Full 37.0% | mean R -0.0618 | total R -40.6 | add 45%
- **risk**: closed 660 | WR(vendor) 80.9% | Stop 19.1% | Partial 41.8% | Full 39.1% | mean R -0.0535 | total R -35.2 | add 58%
- **std**: closed 588 | WR(vendor) 47.6% | Stop 52.4% | Partial 0.0% | Full 47.6% | mean R 0.0072 | total R 4.2 | add 61%

## Arm B: OUR extension signals (own2Raw + per-mode gate), same series

- **safe**: closed 1250 | WR(vendor) 86.4% | Stop 13.6% | Partial 42.9% | Full 43.5% | mean R 0.0087 | total R 10.9 | add 47%
- **risk**: closed 1399 | WR(vendor) 77.6% | Stop 22.4% | Partial 33.6% | Full 44.0% | mean R 0.0205 | total R 28.7 | add 61%
- **std**: closed 908 | WR(vendor) 48.2% | Stop 51.8% | Partial 0.0% | Full 48.2% | mean R 0.0229 | total R 20.8 | add 63%

Vendor reference tables: safe WR 86-89 / Stop 11-13; his own std Total R per series: -23.3R (DOGE1h), +28.3R (LINK2h), -1.8R (ETH2h), -0.3R (ONDO15m), +6.5R (AVAX5m).
## Verdict (appended post-run)

1. CALIBRATION VALIDATED: replayed safe-mode stats on his own arrows
   now match his tables almost exactly - WR 88.2% vs his 86-89%, Stop
   11.8% vs his 11-13%. GEO1's 26% stop rate is fixed by the correct
   step (5.5*ATR200). The machinery is now fully reproduced end-to-end.
2. FINAL ECONOMICS of vendor arrows: mean R -0.06 (safe), -0.05 (risk),
   +0.007 (std). Total over ~660 forward trades: -40.6R / -35.2R /
   +4.2R. The 88% winrate machine earns ~ZERO-to-negative R before
   fees. The headline WR is real - and it does not pay.
3. OUR extension signals through the same machinery: +0.009..+0.023
   mean R - also ~zero. Confirms Sol's point: the vendor exit machinery
   adds no edge; whatever edge exists must come from timing + context
   (ZC5 line: +0.18R with OUR exits), not from this management wrapper.
4. Chapter closed. GGI is fully reverse-engineered: signal (extension),
   cadence (per-mode gates), geometry (one ATR step, three multipliers),
   stats semantics (partial=win), and now economics (~zero). Nothing
   left to extract - all further effort goes to our own line.
