# Pre-registration: E1 - mechanical exit policies over vendor labels

Branch: research/fng-case-control. Committed BEFORE any policy simulation.
Question: how much of the vendor table's reported winrate (80-96%) is
reproducible by SIMPLE mechanical exit policies applied to the raw labels?
O1 established the entry is a modest drift (+0.2-0.5R), so high winrates must
come from exit machinery. E1 quantifies that, with a random-bar control to
separate "policy inflates winrate on anything" from "policy + label edge".

## Corpus, entry, yardstick (FROZEN, inherited from O1)

- Same 14 datasets; pooled stats exclude btc-perp-15m-b2/1h-b2 (BTC overlap).
- Entry: close of label bar. R = ATR14(label bar), Wilder. Direction per label.
- Max holding: 192 bars (2x O1 horizon, exits need room); labels with < 48
  forward bars excluded. Warm-up rows excluded as before.
- Intrabar ambiguity rule (frozen, conservative): if a bar touches both a
  favorable and an adverse level, the ADVERSE fill is assumed.
- Random-bar control: matched count per dataset, uniform eligible bars,
  coin-flip direction, mulberry32 seed 4242 (fresh stream), same policies.

## Policy family (FROZEN - 6 policies, no optimization)

P1 fixed_1to1     SL -1R,   TP +1R
P2 fixed_2to1     SL -1R,   TP +2R
P3 wide_1to2      SL -2R,   TP +1R      (wide stop, near target - "winrate-shaped")
P4 partial_be     SL -2R; at +1.14R close 50% and move SL to entry (BE);
                  remaining 50% targets +2R; BE touch after partial = scratch
                  of remainder. (Mirrors the vendor's described mechanics with
                  the table's 1.14R partial constant.)
P5 be_only        SL -2R; at +1R move SL to entry (no partial); TP +3R
P6 time_stop      SL -2R,   TP +2R, force-close at bar 96 at close
All policies force-close any open position at min(label+192, data end) at close.

## Metrics (FROZEN)

Per policy x cohort (labels vs control; pooled + by direction + by TF class):
- winrate_vendorStyle: a trade counts as WIN if realized R > 0 (partial fix
  followed by BE scratch counts as WIN - this mirrors how the vendor table
  counts partial+BE outcomes as non-losses).
- winrate_strict: WIN only if realized R >= +0.5.
- expectancy: mean realized R per trade; median realized R; max drawdown of the
  cumulative R curve (trade-ordered within dataset, then pooled mean).
- stop rate, partial-then-BE rate (P4), time-exit rate.

## Reading rules (FROZEN)

- "Vendor-table reproduction" is declared if some policy reaches >= 80%
  winrate_vendorStyle on labels while the SAME policy on random control is
  >= 15 percentage points lower. If control is within 15pp, the winrate is a
  policy artifact, not label edge.
- Expectancy comparison labels-vs-control is the honest edge measure regardless
  of winrate shaping.
- No policy tuning, no additional policies after seeing results.

## Gate

npm run research:integrity; npm test; npx tsc --noEmit.
