# Pre-registration: DM1 - BTC.P 2h dashboard terminal-count match

Branch: research/independent-reversal-edge. Committed BEFORE running the
comparison. Ground truth supplied by Nikita (dashboard screenshot, BTCUSDT.P 2h):

| side  | Trades | Winrate | Partial    | Stop      | Full fix  |
|-------|--------|---------|------------|-----------|-----------|
| LONG  | 50     | 86%     | 16 (32%)   | 7 (14%)   | 27 (54%)  |
| SHORT | 40     | 92.5%   | 13 (32.5%) | 3 (7.5%)  | 24 (60%)  |
| TOTAL | 90     | 88.9%   | 29 (32.2%) | 10 (11.1%)| 51 (56.7%)|

Winrate = (Partial + Full) / Trades exactly (80/90 = 88.9%), confirming the
vendor counts Partial as a win and uses exactly three terminal buckets.

## Question

Which BE semantics (and terminal-classification rule) reproduces these counts
when the frozen corrected-v2 engine replays every Shape signal on our
BYBIT_BTCUSDT.P_2h.csv? LTF1 proved intra-bar ordering is irrelevant at the
12xTR55 stop, so OHLC replay is exact; the remaining fork is SEMANTIC and this
table is the discriminator.

## Frozen machinery

Corrected v2 exactly as in ggi-corrected-gross-audit-v2: Shape signals after
100-bar warm-up, entry next 2h open, Safe stop 12xTR55 stop-first, Partial=25%
at moving Mean wick, Full=close beyond moving opposite Inner, no add,
allowInvalidBandOrder parse, maxHoldingBars 20000.

## Candidate semantics (FROZEN - 3, from the v2 beBounds; no new variants)

- S-A optimistic-initial-stop (no BE): terminal buckets Stop / Partial(=partial
  then initial stop later... in v2 this bound classifies partial-then-stop as
  Partial) / Full / End.
- S-B next-bar-entry-be: after Partial, stop moves to entry next bar; BE touch
  -> terminal Partial.
- S-C next-bar-blended-be: v2's blended bound.

## Frozen predictions (from LTF1 subset behavior, stated before the run)

S-A (no BE) leaves most post-partial trades to reach Full: predicted Full share
HIGH (~50-60%), Partial share LOW (~10-20%). S-B converts most post-partial
trades to Partial scratches: predicted Full share LOW (~10-25%), Partial HIGH
(~40-60%). The dashboard shows Full 56.7% / Partial 32.2% -> we PREDICT S-A
(no literal BE, or BE so rarely hit it does not reclassify) is the closest
match, contradicting the vendor's own description of moving stop to BE. If S-B
matches instead, the LTF1 subset was unrepresentative.

## Match metric (FROZEN)

Per semantics: chi-square-style distance D = sum over 6 cells (side x bucket,
End folded into Full... NO: End folded into its OWN exclusion - trades still
open at data end are DROPPED from the comparison, since the dashboard only
shows closed buckets) of (model - dashboard)^2 / max(dashboard,1), plus trade-
count check: model closed trades per side must be within +-10% of 50/40.
- MATCHED: one semantics has D <= 6 (avg ~1 per cell) AND every bucket within
  +-6 trades of dashboard AND beats the next-best semantics by factor >= 2 in D.
- PARTIAL MATCH: best D <= 12 but secondary conditions fail.
- NO MATCH: best D > 12 -> our Shape/stop/partial/full reconstruction is wrong
  on 2h in some structural way; record which bucket diverges most.

## Gate

npm test; npx tsc --noEmit; single run, committed as-is.
