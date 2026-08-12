# REG1 - Full:Stop math comparison, GGI arrows vs OWN1 (descriptive)

Nikita's redefined quality criterion: the tool must have "good math" - Full
fixes must reliably outnumber Stops (author's own pitch: mathematical edge /
confluence tool for zones of interest). Comparison run on identical DM3 V2
machinery, all 5 datasets, split into time halves (H1/H2) to expose decay.
OWN1 rule fixed from the OWN1 study winner: body>=1.5x SMA20(body),
drought>=10 bars from Mean, cooldown 40/side.

## Result matrix (P/S/F, F:S ratio, mean gross R)

| dataset | window | ARROWS P/S/F | F:S | R | OWN1 P/S/F | F:S | R |
|---|---|---|---|---|---|---|---|
| btc-2h | H1 | 10/2/29 | 14.5 | +0.231 | 62/14/117 | 8.4 | +0.033 |
| btc-2h | H2 | 15/4/29 | 7.3 | +0.083 | 54/13/114 | 8.8 | +0.048 |
| xrp-3m | H2 | 13/4/25 | 6.3 | +0.045 | 71/14/119 | 8.5 | -0.002 |
| ondo-2h | ALL | 16/4/26 | 6.5 | +0.023 | 81/14/115 | 8.2 | -0.057 |
| ondo-15m | ALL | 18/3/39 | 13.0 | +0.136 | 91/11/172 | 15.6 | +0.050 |
| btc-15m | ALL | 32/10/42 | 4.2 | -0.093 | 140/37/202 | 5.5 | -0.084 |
(full matrix incl. H1/H2 of every dataset in run log; summarized here)

## Findings

1. By the Full:Stop criterion OWN1 already matches or BEATS the arrows on
   4 of 5 datasets (F:S 5.5..15.6 vs arrows 4.2..13.0 on ALL windows).
   Full fixes outnumber stops 5-15x everywhere - "good math" in the
   author's own sense is reproduced by our 3-condition rule.
2. OWN1 fires ~4.5x more often than the arrows (e.g. 374 vs 89 on BTC 2h).
   As a CONFLUENCE tool (Nikita's primary use case: confirmation inside a
   zone of interest) higher frequency with the same F:S math is a feature:
   more zones get a confirmation opportunity.
3. The arrows' H1->H2 decay on BTC 2h (F:S 14.5->7.3, R +0.231->+0.083) is
   confirmed with the half split too; OWN1 is stable across halves
   (8.4->8.8, +0.033->+0.048) and actually out-earns the arrows per trade
   nowhere except recent BTC 2h - but per-trade R comparisons at 4.5x
   different frequency are not like-for-like.
4. BTC 15m is toxic for both (negative R, worst F:S) - consistent with all
   prior findings that LTF on majors is where this signal class dies.

## Status

Descriptive study (no frozen thresholds - the question was "how does the
math compare", not a hypothesis test). OWN1 as a confluence layer is VIABLE
by the user's criterion; isolated-trading viability remains limited to the
same regimes where the arrows themselves earn (ondo-15m strongest).
