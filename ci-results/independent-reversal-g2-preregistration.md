# Preregistration: Independent Reversal G2

Branch: `research/independent-reversal-edge`.

This document freezes G2 before its first profitability computation. ZC5 and OWN2b results are explicitly treated as development observations, not holdout evidence.

## Objective

Build a selective causal reversal indicator that may abstain. Promotion depends on net expectancy, PF, cost robustness, matched-null advantage, transfer consistency and portfolio drawdown. Dashboard win rate and vendor-arrow overlap are descriptive only.

## Frozen variants

- `EXT`: broad extension trigger.
- `EXT_POOL`: extension trigger inside a recently swept, non-heavy causal 4h liquidity pool.
- `OWN1_POOL`: OWN1 timing under the same pool context.
- `EXT_POOL_SEQ`: EXT_POOL plus a compact causal failed-continuation/sequence gate.
- `G1`: unchanged rejected G1 baseline.
- `MATCHED_NULL`: count/side/month/volatility/regime-matched causal control.

No variants may be added after results are inspected.

## Frozen causal trigger and context

- Signal inputs are finalized closed bars only.
- Extension: close on the signal side of Mean, penetration at least `-0.35` Inner half-width, distance from Mean at least `3%`, relative volume at least `1.4` versus the prior 20 bars.
- OWN1 control: body at least `1.5 × SMA20(body)`, at least 10 bars since Mean touch and 40-bar same-side cooldown.
- Context uses only 4h candles fully closed before the 1h decision.
- Pool must be at least 48h old, same-side, entry strictly inside its raw band, swept in the prior 24h and below the top notional tercile (`rank < 2/3`) among causal alive same-side pools.
- Prefix output must be invariant to appending future data.

## Frozen common economics

- Entry: next-bar open.
- Stop: `12 × causal SMA(TR,55)`.
- Partial: 25% at moving Mean wick.
- BE: remaining position moves to entry from the next bar.
- Full: close-confirmed beyond moving opposite Inner.
- Same-bar ambiguity: stop first.
- Primary arm: no add, max holding 2,000 bars.
- Costs: 6 bps one-way primary, 9 and 12 bps stress.

## Validation

Discovery symbols already seen in ZC5 are not sealed. Frozen transfer symbols are BCH, ETC, UNI, FIL, NEAR and APT USDT perpetuals, 1h trigger with 4h context, half-open interval `2024-01-01`–`2026-08-01`. Selection uses rolling month-block validation; final sealed data cannot select the winner.

If unseen coverage cannot be obtained, the result must be `INSUFFICIENT_SEALED_COVERAGE`, not promotion.

## Promotion gates

- at least 100 aggregate OOS trades;
- mean net R at least `+0.05R`, PF at least `1.20`;
- positive stress mean and stress PF at least `1.05`;
- best-1%-removed mean positive;
- advantage over matched null at least `+0.04R`;
- at least 70% eligible symbol×TF cells non-negative and at least 3 positive transfer cells;
- no symbol above 35% of total positive R;
- portfolio max drawdown at most 15% at 1% risk/trade and 3% open-risk cap.

A result below 100 OOS trades can only be `PROMISING_NOT_PROVEN`.

Production Apex/Reversal behavior remains unchanged until full promotion.
