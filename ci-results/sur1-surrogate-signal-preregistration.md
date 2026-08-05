# Pre-registration: SUR1 - surrogate signal generator, evaluated in R

Branch: research/independent-reversal-edge. Committed BEFORE any computation.
Approved by Nikita. Goal changed from replication to VALUE CAPTURE: can a
simple rule on OBSERVABLE features (volume spike + band stretch) capture a
meaningful share of the arrows' monetary edge, so Nikita's own engine can
generate signals without TradingView?

## Prior knowledge used (all previously confirmed)

- Arrow bars carry elevated volume (5+ assets); volume alone cannot pinpoint
  the exact bar (hidden state) - SUR1 does NOT try to match bars.
- Exit machinery identified in DM3 (OOS confirmed): entry next bar open,
  Partial 25% at moving Mean wick, Full = static signal-bar TP (opposite
  Inner) wick touch, stop static 12xTR55 stop-first, no BE, no add.
- Arrows' reference: BTC 2h full window +0.154R gross mean (DM3 V2).

## Data

- CALIBRATION: BYBIT_BTCUSDT.P_2h_full20k.csv (91 arrows).
- OOS (winner rule only, ZERO changes): BINANCE_XRPUSDT_3m.csv (63 arrows),
  BYBIT_BTCUSDT.P_15m.csv (85), BYBIT_ONDOUSDT.P_2h.csv (46),
  BYBIT_ONDOUSDT.P_15m.csv (63).

## Frozen surrogate family (9 rules = 3 stretch x 3 volume; NO additions later)

A surrogate BUY fires on bar i (entry i+1 open) when ALL hold:
1. STRETCH (direction): one of
   - S1: low_i <= lowerOuter_i (wick beyond Outer)
   - S2: close_i <= lowerOuter_i (close beyond Outer)
   - S3: min(low_i, low_{i-1}) <= lowerOuter at the respective bar AND
         close_i < mean_i (two-bar stretch, still below Mean)
   (SELL mirrored with high / upperOuter / close > mean.)
2. VOLUME: volume_i >= k x SMA50(volume), k in {1.25, 1.75, 2.5}.
3. COOLDOWN: no surrogate same-side signal in the previous 40 bars (arrows
   are sparse: ~1 per 220 bars; cooldown frozen, not tuned).
4. Warm-up 100 bars; invalid-band bars skipped (as everywhere).

## Benchmarks on IDENTICAL machinery (DM3 V2 exits)

- ARROWS: vendor arrows on the same file.
- RANDOM: 200 seeded draws (mulberry32, seed 1337) of N bars uniformly from
  eligible bars (post-warm-up, valid band, cooldown-respecting), N = surrogate
  signal count; report mean of draw-means and its 5th-95th percentile band.

## Frozen metrics and criteria

Per rule on calibration: n signals, mean grossR, WR, capture ratio
C = (meanR_surrogate - meanR_random) / (meanR_arrows - meanR_random).
Sanity gate: rule must produce 0.4x..3x the arrow count (37..273 signals);
rules outside are DISQUALIFIED (degenerate frequency).
Winner = highest C among qualified rules.
- SUCCESS: winner C >= 0.6 on calibration AND pooled OOS C >= 0.5 (pooled
  across the 4 OOS datasets, per-dataset reported).
- PARTIAL: calibration C >= 0.6 but pooled OOS C in 0.2..0.5 -> feature is
  real but unstable; record which datasets fail.
- FAILURE: calibration C < 0.6 for all rules, or pooled OOS C < 0.2 ->
  hidden state carries the bulk of the arrows' value; alerts remain the only
  live path. This is a valid, recorded outcome.

## Gate

npm test; npx tsc --noEmit; single run per phase, committed as-is.
