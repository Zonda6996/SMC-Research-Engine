# Preregistration: Independent Reversal Edge G1

Branch: `research/independent-reversal-edge`.

This file and `ci-results/independent-reversal-preregistration.json` are created **before the first profitability computation**. Signal families, central constants, development periods, execution assumptions and promotion/kill gates are frozen for generation `independent-reversal-edge-g1`.

## Objective

Build a proprietary causal Reversal indicator and select it by net trading profitability after realistic fees, slippage, funding and portfolio constraints. Vendor BUY/SELL labels are not an optimization target and V8 reconstruction is not started.

## Frozen causal episode

- Long arms at the first `low <= lowerInner`; short at the first `high >= upperInner`.
- Episode keeps the first arm, adverse extreme, normalized penetration, volume peak and only information known by each bar close.
- Core recovery requires a favorable-direction close back inside Inner and recovery of at least `0.50` Inner half-width from the episode extreme.
- At most one signal per side episode.
- Episode ends at its side's mean recovery, opposite Inner breach, or 96-bar expiry.
- Distances are normalized by Apex Inner half-width or ATR; time is measured in bars.

## Frozen candidate families

- **P:** core recovery + penetration >= 0.25 Inner half-width + favorable body >= 0.20 ATR.
- **L:** core recovery + touch/sweep of a liquidity POI known before the touch within 0.75 ATR, or a causally confirmed structure event indicating the opposite side was swept.
- **S:** core recovery plus favorable CHoCH confirmed after the episode extreme; emit no earlier than the CHoCH confirmation bar.
- **V:** core recovery + episode peak relative volume >= 1.50 + confirmation volume <= 1.00 or <= 70% of the episode peak.
- **C:** P and at least one of L/S/V.

Controls: unconditional core recovery, direction flip, count/direction-matched circular time shift, and age-matched random Inner episodes. Holm-Bonferroni covers P/L/S/V/C.

## Frozen neutral trade replay

- Signal is final at bar close; entry is the next bar open worsened by 0.02% adverse slippage.
- Market entry fee 0.05%; target maker fee 0.02%; stop/time exit 0.05% plus 0.02% slippage.
- Stop is episode extreme plus 0.15 ATR adverse buffer.
- Valid entry risk is 0.50–3.00 ATR.
- Full target is 2R; time exit is 48 completed bars.
- Same-bar stop/target conflict is stop-first.
- Gap through stop fills at the worse open/stop price plus adverse slippage.
- Actual signed funding payments strictly between entry and exit are included.
- No partial, BE, trail, pyramid, re-entry or same-signal-bar fill during family selection.

## Frozen staged data protocol

Development, 15m only:

- BTC/ETH/SOL/XRP perpetuals;
- fit: 2021-01-01 to 2023-01-01;
- signal-family validation: 2023 calendar year;
- management validation: 2024 calendar year, untouched until signal freeze.

Portability:

- frozen model on 5m and 1h, same four assets, 2021–2024;
- no timeframe-specific retuning.

Sealed:

- BNB/DOGE/ADA/LINK/AVAX/SUI/NEAR/APT/LTC perpetuals;
- 5m/15m/1h;
- from 2025-01-01 to a right boundary frozen before sealed execution;
- opened once after full signal and management config freeze.

## Frozen central gates

Signal validation requires, among other detailed gates in the approved plan:

- at least 200 resolved aggregate trades;
- expectancy >= +0.08R;
- PF >= 1.15;
- Holm-adjusted one-sided evidence versus matched null;
- positive expectancy after removing best 1%;
- parameter-neighborhood robustness;
- no single development asset supplies more than 50% of total R.

Final sealed promotion requires:

- expectancy >= +0.08R and PF >= 1.15;
- 95% calendar-block-bootstrap lower expectancy bound > 0;
- base and stress-cost profitability;
- best-1%-removed expectancy > 0;
- >=70% eligible symbol×TF cells non-negative;
- no cell with >=30 trades below -0.10R;
- at least two of 5m/15m/1h positive in aggregate;
- no single symbol >35% of total R;
- portfolio max drawdown <=15% at 1% risk/trade and 3% open-risk cap.

## Prohibited before gate passage

- vendor-label optimization or V8/V9 reconstruction;
- adding post-hoc signal families or a Cartesian parameter grid;
- timeframe-specific constants in G1;
- opening sealed outcomes before the config hash is frozen;
- modifying production `detectReversals()`, Apex veto, visual defaults or battle strategy.

End gate for each implementation stage: `npm test`, `npx tsc --noEmit`, and `npm run research:integrity`.
