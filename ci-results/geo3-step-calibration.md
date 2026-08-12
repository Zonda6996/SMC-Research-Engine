# GEO3 - step formula solved from 7 measured samples (2026-08-06)

Samples (Nikita's Bybit simulator, exact price tags): LINK 2h, SOL 1h,
BTC 1h, ETH 2h, TRX 5m, AVAX 5m, ONDO 15m. Safe-mode step measured as
|entry - add|. Metrics computed on Gate klines via our buildRows
reconstruction at the signal bar.

## Re-confirmed constants (now on 7 assets, 5m-2h, price 0.33..63k)

- stop = 2*step (safe AND risk): 1.98..2.01 everywhere
- standard: stop = 1.74-1.75*step_std, TP = 2*step_std static
- step_safe / step_risk = 1.43-1.44 everywhere
- step_safe / step_std = 1.17 everywhere
- => ALL THREE modes derive from ONE step value:
  step_risk = step_safe/1.43, step_std = step_safe/1.17

## Step formula (brute-force over 25 candidates, CV of k=step/metric)

| candidate | k | CV |
|---|---|---|
| **ATR(200) RMA** | **5.50** | **8.6%** |
| ATR(200) SMA | 6.08 | 11.2% |
| ATR(100) RMA | 5.81 | 12.7% |
| full inner channel width | 0.53 | 16.1% |
| mean-to-inner half width | 1.08 | 16.9% |

**step_safe ~= 5.5 * ATR(200, RMA/Wilder)** on the signal bar.
Per-sample k: 5.79, 6.01, 5.73, 5.60, 4.54(TRX 5m outlier), 5.07, 5.71.
Residual spread is consistent with (a) Gate-vs-Bybit kline differences,
(b) our band reconstruction != vendor's exact smoothing. The vendor's
step is most likely derived from his own band width (which is itself a
long-ATR construct - note channelFull k~=0.53, i.e. step ~= half the
full inner channel width).

## Full geometry now closed (one unknown left: none blocking)

entry = signal close/next open;
step = 5.5*ATR200 (safe), /1.43 (risk), /1.17 (standard);
add = entry -/+ step; stop = mirror 2*step (1.75 std);
safe/risk: fix25 = dynamic Mean, TP = dynamic opposite inner band;
standard: static TP = 2*step, no partial.

## Bonus vendor-side economics from these screenshots (Total R, std tables)

ETH 2h std: -1.8R total (WR 52%). ONDO 15m std: -0.3R (WR 48.3%).
AVAX 5m std: +6.5R (WR 53.2%, but LONG side -15.5R vs SHORT +22R).
With earlier DOGE 1h -23.3R and LINK 2h +28.3R: vendor's own simulator
shows per-series R swinging from deeply negative to positive - no
stable aggregate edge visible in his own numbers.

Next: GEO4 - re-run vendor-arrow replay with calibrated step and
risk-basis R (add-filled stop = -1R) => final true-economics verdict.
