# Pre-registration: OWN1 - our own reversal signal generator

Branch: research/independent-reversal-edge. Committed BEFORE any computation.
Goal REDEFINED by Nikita: not replicating GGI arrows (SIG1 proved bar-level
replication unachievable; web check confirms no public predecessor scripts by
GGICRYPTO), but building OUR OWN generator that produces sane, positive
results under the SAME accounting (DM3 V2 exits) so it can live in his engine
with no TradingView dependency.

## Design basis (from SIG1 anatomy - descriptive, now used constructively)

Arrow bars are: large reversal candles (body ~1.8x prev), closing in signal
direction, close on the signal side of the Mean, after a prolonged one-sided
phase (median 23-41 bars since last Mean touch). OWN1 operationalizes exactly
this shape - no volume leg (SUR1 showed volume adds nothing here), no
outer-band leg (falsified).

## Frozen rule family (6 rules = 2 body-k x 3 drought-M; NO additions later)

OWN1 BUY fires on bar i (entry i+1 open) when ALL hold (SELL mirrored):
1. close_i < mean_i (signal side of Mean)
2. close_i > open_i (directional/reversal close)
3. body_i >= bk x SMA20(body), bk in {1.5, 2.0}
4. bars since last Mean-touch (low<=mean<=high) >= M, M in {10, 20, 30}
5. cooldown 40 bars per side; warm-up 100; invalid-band bars skipped.

## Machinery and benchmarks (all FROZEN, inherited)

DM3 V2 exits (partial 25% at moving Mean wick, full at static signal-bar TP
wick, stop 12xTR55 static stop-first, no BE/add). Benchmarks per dataset:
GGI arrows and seeded random (200 draws, mulberry32 seed 1337) at matched n.

## Data split (FROZEN)

- TRAIN: BYBIT_BTCUSDT.P_2h_full20k_vol.csv, FIRST 70% of bars (i < 14091).
- TEST (time-forward, same asset): last 30% of the same file.
- OOS (winner only): XRP 3m vol, ONDO 2h, ONDO 15m, BTC 15m (full files).
Winner = highest train meanR among rules with n in [30, 400] on train
(frequency sanity; arrows ~64 in train window).

## Frozen success criteria (absolute, in R - no capture ratio this time)

- SUCCESS: test meanR >= +0.05R AND pooled-OOS meanR >= +0.03R AND test WR
  >= 75% (sanity that the accounting table "looks sane" per Nikita's ask).
- PARTIAL: test meanR > 0 but OOS pooled <= +0.03R (asset-specific edge).
- FAILURE: test meanR <= 0. Recorded and OWN1 closed; any OWN2 would need a
  structurally different design, not parameter tweaks.
Reference points: arrows +0.154R / random ~0.00R / SUR1 rules -0.11..-0.24R.

## Gate

npm test; npx tsc --noEmit; single run, committed as-is.
