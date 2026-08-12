# H2/H3 falsification audit results

Pre-registration: `htf-gap-falsification-preregistration.md` (committed before this script existed). Seed 1337, 10,000 circular shifts, windows ±30m/±60m/±240m frozen.

## H2: gap distributions (descriptive)

| dataset | kind | n gaps | min | 0-53 | 54-57 | 58-69 | 70-99 | 100-199 | 200-399 | 400-799 | 800+ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| btc-perp-15m | global | 68 | 57 | 0 | 1 | 3 | 11 | 25 | 21 | 7 | 0 |
| btc-perp-15m | buy-buy | 37 | 61 | 0 | 0 | 1 | 4 | 7 | 13 | 8 | 4 |
| btc-perp-15m | sell-sell | 30 | 88 | 0 | 0 | 0 | 1 | 10 | 7 | 7 | 5 |
| btc-perp-1h | global | 43 | 58 | 0 | 0 | 4 | 6 | 12 | 15 | 6 | 0 |
| btc-perp-1h | buy-buy | 26 | 74 | 0 | 0 | 0 | 2 | 6 | 7 | 10 | 1 |
| btc-perp-1h | sell-sell | 16 | 69 | 0 | 0 | 1 | 1 | 0 | 2 | 9 | 3 |
| eth-perp-15m | global | 74 | 57 | 0 | 1 | 3 | 12 | 23 | 27 | 8 | 0 |
| eth-perp-15m | buy-buy | 45 | 73 | 0 | 0 | 0 | 5 | 4 | 20 | 14 | 2 |
| eth-perp-15m | sell-sell | 28 | 77 | 0 | 0 | 0 | 2 | 6 | 7 | 8 | 5 |
| sol-spot-15m | global | 62 | 60 | 0 | 0 | 4 | 6 | 16 | 20 | 15 | 1 |
| sol-spot-15m | buy-buy | 37 | 65 | 0 | 0 | 3 | 2 | 4 | 11 | 12 | 5 |
| sol-spot-15m | sell-sell | 24 | 85 | 0 | 0 | 0 | 1 | 3 | 4 | 9 | 7 |
| btc-perp-5m | global | 80 | 52 | 2 | 0 | 2 | 5 | 29 | 33 | 9 | 0 |
| btc-perp-5m | buy-buy | 43 | 53 | 1 | 0 | 1 | 1 | 8 | 17 | 7 | 8 |
| btc-perp-5m | sell-sell | 36 | 52 | 1 | 0 | 0 | 1 | 5 | 14 | 9 | 6 |
| btc-perp-4h | global | 37 | 56 | 0 | 3 | 2 | 3 | 14 | 13 | 2 | 0 |
| btc-perp-4h | buy-buy | 17 | 57 | 0 | 1 | 0 | 0 | 3 | 7 | 4 | 2 |
| btc-perp-4h | sell-sell | 19 | 56 | 0 | 1 | 1 | 1 | 5 | 3 | 7 | 1 |

**H2 verdict: not identifiable from label gaps alone.** No global gap violates any candidate global-cooldown constant <= the observed minimum, and absence of floor pile-up cannot discriminate cooldown vs rolling extremum vs sparse candidate stream without the unobserved candidate process. The earlier "soft floor => rolling window, explicit cooldown unlikely" inference is hereby RETRACTED as overreach.

## H3: cross-TF coincidence under circular-shift null

### P1: 15m(HTF) vs 5m(LTF) [pairwise-overlap]

Overlap 2026-05-25T08:50:00.000Z .. 2026-07-31T19:45:00.000Z; HTF events 34, LTF events 81.

| window | mode | obs hits | rate | null mean | q95 | q99 | p | enrich | 1:1 | LOO minEnr | LOO maxP |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ±30m | same | 5/34 | 14.7% | 0.86 | 3 | 3 | 0.0011 | 5.84x | 5 | 4.78 | 0.0076 |
| ±30m | opposite | 0/34 | 0.0% | 0.84 | 3 | 3 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |
| ±60m | same | 5/34 | 14.7% | 1.73 | 4 | 5 | 0.0309 | 2.89x | 5 | 2.37 | 0.0888 |
| ±60m | opposite | 0/34 | 0.0% | 1.67 | 4 | 5 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |
| ±240m | same | 11/34 | 32.4% | 6.83 | 11 | 13 | 0.0676 | 1.61x | 11 | 1.50 | 0.1214 |
| ±240m | opposite | 3/34 | 8.8% | 6.57 | 10 | 12 | 0.9735 | 0.46x | 3 | 0.31 | 0.9930 |

### P2: 1h(HTF) vs 15m(LTF) [pairwise-overlap]

Overlap 2026-02-28T23:15:00.000Z .. 2026-07-31T21:00:00.000Z; HTF events 16, LTF events 69.

| window | mode | obs hits | rate | null mean | q95 | q99 | p | enrich | 1:1 | LOO minEnr | LOO maxP |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ±30m | same | 0/16 | 0.0% | 0.15 | 1 | 2 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |
| ±30m | opposite | 0/16 | 0.0% | 0.14 | 1 | 1 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |
| ±60m | same | 0/16 | 0.0% | 0.31 | 1 | 2 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |
| ±60m | opposite | 0/16 | 0.0% | 0.30 | 1 | 2 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |
| ±240m | same | 2/16 | 12.5% | 1.24 | 3 | 4 | 0.3557 | 1.62x | 2 | 0.86 | 0.6907 |
| ±240m | opposite | 0/16 | 0.0% | 1.17 | 3 | 4 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |

### P3: 4h(HTF) vs 1h(LTF) [pairwise-overlap]

Overlap 2025-06-20T02:00:00.000Z .. 2026-07-31T16:00:00.000Z; HTF events 12, LTF events 44.

| window | mode | obs hits | rate | null mean | q95 | q99 | p | enrich | 1:1 | LOO minEnr | LOO maxP |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ±30m | same | 0/12 | 0.0% | 0.03 | 0 | 1 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |
| ±30m | opposite | 0/12 | 0.0% | 0.02 | 0 | 1 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |
| ±60m | same | 1/12 | 8.3% | 0.06 | 1 | 1 | 0.0577 | 17.01x | 1 | 0.00 | 1.0000 |
| ±60m | opposite | 0/12 | 0.0% | 0.04 | 0 | 1 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |
| ±240m | same | 3/12 | 25.0% | 0.24 | 1 | 2 | 0.0004 | 12.66x | 3 | 9.23 | 0.0168 |
| ±240m | opposite | 0/12 | 0.0% | 0.19 | 1 | 2 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |

### P1: 15m(HTF) vs 5m(LTF) [four-tf-overlap]

Overlap 2026-05-25T08:50:00.000Z .. 2026-07-31T16:00:00.000Z; HTF events 34, LTF events 81.

| window | mode | obs hits | rate | null mean | q95 | q99 | p | enrich | 1:1 | LOO minEnr | LOO maxP |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ±30m | same | 5/34 | 14.7% | 0.89 | 3 | 3 | 0.0013 | 5.60x | 5 | 4.60 | 0.0064 |
| ±30m | opposite | 0/34 | 0.0% | 0.83 | 2 | 3 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |
| ±60m | same | 5/34 | 14.7% | 1.77 | 4 | 5 | 0.0291 | 2.83x | 5 | 2.32 | 0.0876 |
| ±60m | opposite | 0/34 | 0.0% | 1.68 | 4 | 5 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |
| ±240m | same | 11/34 | 32.4% | 6.84 | 11 | 13 | 0.0630 | 1.61x | 11 | 1.50 | 0.1116 |
| ±240m | opposite | 3/34 | 8.8% | 6.58 | 10 | 12 | 0.9763 | 0.46x | 3 | 0.31 | 0.9897 |

### P2: 1h(HTF) vs 15m(LTF) [four-tf-overlap]

Overlap 2026-05-25T08:50:00.000Z .. 2026-07-31T16:00:00.000Z; HTF events 7, LTF events 34.

| window | mode | obs hits | rate | null mean | q95 | q99 | p | enrich | 1:1 | LOO minEnr | LOO maxP |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ±30m | same | 0/7 | 0.0% | 0.09 | 1 | 1 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |
| ±30m | opposite | 0/7 | 0.0% | 0.06 | 1 | 1 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |
| ±60m | same | 0/7 | 0.0% | 0.17 | 1 | 2 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |
| ±60m | opposite | 0/7 | 0.0% | 0.12 | 1 | 1 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |
| ±240m | same | 2/7 | 28.6% | 0.68 | 2 | 3 | 0.1625 | 2.92x | 2 | 1.71 | 0.4389 |
| ±240m | opposite | 0/7 | 0.0% | 0.50 | 2 | 2 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |

### P3: 4h(HTF) vs 1h(LTF) [four-tf-overlap]

Overlap 2026-05-25T08:50:00.000Z .. 2026-07-31T16:00:00.000Z; HTF events 2, LTF events 7.

| window | mode | obs hits | rate | null mean | q95 | q99 | p | enrich | 1:1 | LOO minEnr | LOO maxP |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ±30m | same | 0/2 | 0.0% | 0.01 | 0 | 0 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |
| ±30m | opposite | 0/2 | 0.0% | 0.00 | 0 | 0 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |
| ±60m | same | 1/2 | 50.0% | 0.01 | 0 | 1 | 0.0132 | 76.34x | 1 | 0.00 | 1.0000 |
| ±60m | opposite | 0/2 | 0.0% | 0.00 | 0 | 0 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |
| ±240m | same | 1/2 | 50.0% | 0.06 | 1 | 1 | 0.0560 | 17.89x | 1 | 0.00 | 1.0000 |
| ±240m | opposite | 0/2 | 0.0% | 0.01 | 0 | 1 | 1.0000 | 0.00x | 0 | 0.00 | 1.0000 |

## Kill criteria (pre-registered)

- K1: TRIGGERED
- K2: not triggered
- K3: not triggered
- K4: not triggered
- K5: not triggered
- Adjacent-pair survival windows: none

## H3 verdict

**H3 rejected / not advanced (kill criteria triggered)**

## Dataset status table

| dataset | execution status | hypothesis status for H2/H3 | permitted future use |
|---|---|---|---|
| btc-perp-15m | sealed slices unconsumed by V7-prime final (never run); full series consumed by earlier full-corpus diagnostics | hypothesis-SEEN (all labels used in H2/H3 audits and this falsification audit) | reproduction of V1-V7 results; development/exploratory for H2/H3-derived models; NOT valid as final OOS confirmation for them |
| btc-perp-1h | sealed slices unconsumed by V7-prime final (never run); full series consumed by earlier full-corpus diagnostics | hypothesis-SEEN (all labels used in H2/H3 audits and this falsification audit) | reproduction of V1-V7 results; development/exploratory for H2/H3-derived models; NOT valid as final OOS confirmation for them |
| eth-perp-15m | sealed slices unconsumed by V7-prime final (never run); full series consumed by earlier full-corpus diagnostics | hypothesis-SEEN (all labels used in H2/H3 audits and this falsification audit) | reproduction of V1-V7 results; development/exploratory for H2/H3-derived models; NOT valid as final OOS confirmation for them |
| sol-spot-15m | sealed slices unconsumed by V7-prime final (never run); full series consumed by earlier full-corpus diagnostics | hypothesis-SEEN (all labels used in H2/H3 audits and this falsification audit) | reproduction of V1-V7 results; development/exploratory for H2/H3-derived models; NOT valid as final OOS confirmation for them |
| btc-perp-5m | sealed slices unconsumed by V7-prime final (never run); full series consumed by earlier full-corpus diagnostics | hypothesis-SEEN (all labels used in H2/H3 audits and this falsification audit) | reproduction of V1-V7 results; development/exploratory for H2/H3-derived models; NOT valid as final OOS confirmation for them |
| btc-perp-4h | sealed slices unconsumed by V7-prime final (never run); full series consumed by earlier full-corpus diagnostics | hypothesis-SEEN (all labels used in H2/H3 audits and this falsification audit) | reproduction of V1-V7 results; development/exploratory for H2/H3-derived models; NOT valid as final OOS confirmation for them |

## Future OOS specification (NOT requested now)

Either (a) appended future period after a fixed cutoff date on the same symbols/TFs, or (b) a new futures symbol with TF companions (e.g. 5m+15m+1h, ideally 4h), Risk mode, continuous UTC range, closed candles only, OHLC + all five Apex lines + Shape0/Shape1, manifest with counts and SHA-256. The period/symbol must be hypothesis-unseen for any H2/H3-derived model.