# REV1 - what separates GGI-confirmed bars from OWN1-only bars (the secret gate)

Ground truth: FWD1 telegram arrows on 1h/2h. Groups: BOTH n=142, OWNONLY n=4223, GGIONLY n=550.
OWN1 recall of GGI arrows = BOTH / (BOTH + GGIONLY). GGI acceptance of OWN1 = BOTH / (BOTH + OWNONLY).

| feature | BOTH mean (med) | OWNONLY mean (med) | GGIONLY mean (med) |
|---|---|---|---|
| pen | -0.242 (-0.261) | -0.532 (-0.624) | -0.306 (-0.325) |
| bwPctl | 0.510 (0.527) | 0.496 (0.488) | 0.500 (0.499) |
| dry | 1.127 (0.000) | 2.027 (1.000) | 0.889 (0.000) |
| bodyMult | 2.336 (2.143) | 2.221 (2.004) | 1.434 (1.236) |
| rsi | 50.645 (49.910) | 49.390 (49.375) | 51.326 (50.991) |
| volRatio | 2.121 (1.600) | 1.476 (1.134) | 1.952 (1.287) |
| consecOut | 1.620 (0.000) | 0.788 (0.000) | 1.151 (0.000) |
| distMeanPct | 5.991 (4.968) | 3.517 (2.359) | 5.225 (4.340) |
| barsSincePrev | 54.993 (52.000) | 74.523 (49.000) | 999.000 (999.000) |

## Single-feature separation scan (BOTH vs OWNONLY, balanced accuracy)

| feature | best threshold | direction | bal.acc | TPR | TNR |
|---|---|---|---|---|---|
| pen | -0.537 | > | 74.9% | 90% | 60% |
| bwPctl | 0.358 | > | 53.0% | 70% | 36% |
| dry | 2.000 | < | 58.7% | 76% | 41% |
| bodyMult | 1.879 | > | 55.8% | 71% | 40% |
| rsi | 58.321 | > | 61.0% | 37% | 85% |
| volRatio | 1.392 | > | 60.9% | 59% | 63% |
| consecOut | 0.000 | > | 55.9% | 20% | 92% |
| distMeanPct | 3.120 | > | 70.5% | 80% | 61% |
| barsSincePrev | 50.000 | > | 53.9% | 54% | 54% |
## Interpretation notes (appended post-run)

1. Recall check: OWN1 catches only 142 of 692 forward GGI arrows (20.5%)
   at +-2 bars. GGIONLY bodyMult median 1.24 - the vendor's RAW condition
   is NOT "body > 1.5x bodySMA20"; our earlier high match rates were on
   repainted history. OWN1 is a valid independent trigger (ZC2/ZC5 prove
   it earns in zones) but it is NOT a replica of GGI.
2. The GATE dimension is clear regardless: among OWN1 bars, the ones GGI
   also fired are (a) DEEPER extended - pen best single separator,
   bal.acc 74.9% (BOTH -0.24 vs OWNONLY -0.53 half-widths; less negative
   = closer to/через полосу), (b) further from Mean (6.0% vs 3.5%,
   bal.acc 70.5%), (c) on volume spikes (2.1x vs 1.5x avg volume).
   RSI/band-width/dryness barely separate. So the secret sauce ~
   "extension depth + displacement + volume", not an oscillator.
3. GGIONLY group shows the same signature (pen -0.31, distMean 5.2%,
   volRatio 2.0) with SMALL bodies - suggesting the raw GGI condition
   is about price extension relative to bands, and the big-body pattern
   OWN1 keys on is just one way extension happens.
4. Next iteration (OWN2): trigger = close beyond X of band half-width +
   distMean >= ~3% + volRatio >= ~1.4, no body condition; measure recall
   of forward arrows and re-run zone confluence with it.
