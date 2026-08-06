# GGI / OWN1 path and regime audit v1

## Purpose

The project goal is now a causal proprietary signal with positive, transferable trading mathematics. Exact bar-for-bar GGI replication is diagnostic only. This audit checks whether OWN1 captures the same *tradable path* as GGI arrows, whether either survives across time regimes, and whether Full:Stop is misleading without expectancy.

## Frozen comparison

- GGI arrows: exact `buy` / `sell` rows from the export.
- OWN1: frozen winner `body >= 1.5 x SMA20(body)`, at least 10 bars since Mean touch, close on signal side of Mean, directional close, 40-bar same-side cooldown.
- No retuning per dataset or window.
- Execution: DM3 V2: next-bar open; 25% at moving Mean wick; static signal-bar opposite Inner target wick; static `12 x SMA(TR,55)` stop; stop-first; no BE; no add.
- Random null: same dataset, timeframe, side counts and signal count as the compared signal set; eligible causal bars sampled deterministically with same-side cooldown.

## Windows

For every available exact export: full history plus chronological first-half and second-half windows. Window boundaries are descriptive regime diagnostics, not parameter-selection opportunities.

## Primary metrics

- gross R mean, profit factor, Full:Stop, Partial/Stop/Full counts;
- fixed path MFE_R and MAE_R at 1/2/3/6/12/24 bars after next-open entry, normalized by entry-time `12 x SMA(TR,55)` risk;
- share of signals with MFE_R >= 0.5 and MAE_R <= -0.5;
- OWN1 proximity to nearest GGI arrow within +/-3 bars.

## Interpretation gates

- Full:Stop alone is never treated as success.
- A candidate must have positive mean R and PF > 1 after the same frozen DM3 accounting on more than one independent dataset/window.
- A result that only appears in one historical half is regime-specific, not a universal signal.
- Path similarity without positive expectancy is not a trading edge.
- A positive random-null result invalidates causal attribution to the signal family.

## Required conclusion

The report must distinguish: (1) regime existence, (2) GGI path behavior, (3) OWN1 transfer, (4) whether the next signal generation should target the GGI path, a regime filter, or both.
