# E1 mechanical exit policies over labels

Pre-registration: `e1-exit-policies-preregistration.md`. Conservative intrabar rule (both-touch -> adverse). Vendor-style win = realized R > 0 (partial+BE counts as win). Control = matched random bars (seed 4242).

## Pooled

| policy | cohort | n | WR vendor | WR strict | expectancy R | median R | stop rate | partial->BE | time/forced |
|---|---|---|---|---|---|---|---|---|---|
| fixed_1to1 | labels | 689 | 53.0% | 53.0% | 0.060 | 1.00 | 47.0% | 0.0% | 0.0% |
| fixed_1to1 | control | 692 | 50.9% | 50.9% | 0.017 | 1.00 | 49.1% | 0.0% | 0.0% |
| fixed_2to1 | labels | 689 | 35.3% | 35.3% | 0.058 | -1.00 | 64.7% | 0.0% | 0.0% |
| fixed_2to1 | control | 692 | 35.1% | 35.1% | 0.053 | -1.00 | 64.9% | 0.0% | 0.0% |
| wide_1to2 | labels | 689 | 68.1% | 68.1% | 0.042 | 1.00 | 31.9% | 0.0% | 0.0% |
| wide_1to2 | control | 692 | 67.8% | 67.8% | 0.033 | 1.00 | 32.2% | 0.0% | 0.0% |
| partial_be | labels | 689 | 65.0% | 65.0% | 0.044 | 0.57 | 35.0% | 27.7% | 0.0% |
| partial_be | control | 692 | 64.2% | 64.2% | 0.022 | 0.57 | 35.8% | 26.9% | 0.0% |
| be_only | labels | 689 | 23.5% | 23.5% | 0.067 | 0.00 | 31.9% | 0.0% | 0.0% |
| be_only | control | 692 | 22.3% | 22.3% | 0.023 | 0.00 | 32.2% | 0.0% | 0.0% |
| time_stop | labels | 689 | 51.8% | 51.8% | 0.073 | 2.00 | 48.2% | 0.0% | 0.0% |
| time_stop | control | 692 | 50.7% | 50.6% | 0.030 | 2.00 | 49.0% | 0.0% | 0.4% |

## Splits (labels only, pooled)

| policy | LONG WR/exp | SHORT WR/exp | 1m-5m WR/exp | 15m WR/exp | 1h-2h WR/exp |
|---|---|---|---|---|---|
| fixed_1to1 | 52.6% / 0.05 | 53.4% / 0.07 | 54.8% / 0.10 | 56.7% / 0.13 | 47.8% / -0.04 |
| fixed_2to1 | 34.7% / 0.04 | 35.9% / 0.08 | 39.3% / 0.18 | 35.4% / 0.06 | 32.4% / -0.03 |
| wide_1to2 | 67.1% / 0.01 | 69.3% / 0.08 | 72.0% / 0.16 | 67.2% / 0.01 | 66.4% / -0.01 |
| partial_be | 63.7% / 0.01 | 66.7% / 0.09 | 70.2% / 0.22 | 62.3% / -0.07 | 64.4% / 0.05 |
| be_only | 24.5% / 0.08 | 22.3% / 0.06 | 22.6% / 0.12 | 23.1% / 0.04 | 24.5% / 0.06 |
| time_stop | 52.9% / 0.12 | 50.5% / 0.02 | 55.4% / 0.21 | 48.9% / -0.04 | 52.6% / 0.10 |
## Pre-registered verdict

**NOT REPRODUCED.** No policy reaches the 80% vendor-style winrate bar on labels,
and on EVERY policy the random control is within ~1-2pp of the labels (frozen rule
required >= 15pp separation). The winrate level is a POLICY ARTIFACT: wide_1to2
manufactures 68% on random bars, partial_be manufactures 64% on random bars.

## Interpretation notes (post-run, appended once)

1. Winrate shaping confirmed quantitatively: stop width + partial/BE accounting
   sets the winrate almost by itself, regardless of entry quality. The vendor
   table's 80-96% therefore cannot be reproduced by these six simple mechanical
   exits under our conservative fill rule; the vendor's exit machinery must be
   richer (trailing via bands, re-entry/add logic, the "add" second 50%, or
   intrabar sequencing more favorable than our adverse-first rule). The GGI table
   also counts per its own fill assumptions, which we cannot audit without trade
   logs.
2. The honest edge after stops is small: label expectancy 0.04-0.07 R/trade vs
   control 0.02-0.05 R/trade. Stops CONSUME most of the O1 drift (+0.23 R at 24
   bars unstopped): every frozen policy loses most of the drift to MAE-driven
   stopouts. This matches O1's finding (median MAE ~ median MFE): the signal's
   value is direction, and tight mechanical risk control around a noisy path
   destroys it.
3. Splits align with O1: SHORT+scalp TFs benefit most from mechanical exits;
   1h-2h labels (best raw drift) are HURT worst by stops (fixed_1to1 exp -0.04)
   because their MAE comes before the move - the vendor's partial/BE approach on
   HTF only works because the wide effective stop survives that MAE.
4. Consistent overall picture across O1+E1: entry = modest directional bias;
   realized performance is dominated by exit design; high winrates are an
   accounting property of exits, not evidence of entry precision.
