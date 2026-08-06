# GEO2 - geometry calibration from Nikita's Bybit simulator screenshots (2026-08-06)

Samples: LINK 2h BUY @8.377 (safe/risk/standard, full level set), SOL 1h BUY
@74.09 (safe/risk), DOGE 1h (mode-timing observations). All levels read off
simulator screenshots with price tags - exact, not eyeballed.

## Confirmed EXACTLY (measured, both assets)

| relation | LINK 2h | SOL 1h |
|---|---|---|
| stop dist / step, safe | 2.002 | 2.000 |
| stop dist / step, risk | 1.986 | 1.987 |
| step safe / step risk | 1.431 | 1.430 |

- stop = 2*add - entry holds to 3 decimal places on safe AND risk.
- safe/risk step ratio is a CONSTANT 1.43 (refined from TRX estimate 1.46).

## Standard mode geometry SOLVED (LINK sample)

- step_std between safe and risk: safe/std = 1.173, std/risk = 1.22
- stop = entry - 1.75 * step_std (measured 1.747)
- TP = entry + 2 * step_std (measured 2.000), STATIC
- TP/stop = 1.145 -> Nikita's "1.14R without add" CONFIRMED
- RR with add filled = 2.005 -> "1:2 always with add" CONFIRMED
- no partial fix; table shows Add count + Total R (true R economics)

## Step SIZING still open (the one unknown left)

Not constant vs ATR14 (4.85 LINK vs 7.66 SOL), not vs TR55 (6.58 vs 7.23),
not % of price (6.30% vs 4.40%), not a fixed fraction of MY reconstructed
zones (SOL add sits BELOW my zone entirely - band reconstruction diverges
from vendor's on SOL). Likely keyed to vendor's own band geometry.

## Mode-specific signal timing (DOGE 1h observation)

SELL appeared on RISK first, on SAFE a couple bars later, on STANDARD not
at all (previous std trade still open). Supports PER-MODE state gates:
risk stops are nearer -> trades resolve faster -> slot frees earlier.
Signal engine shared, gate per mode.

## Vendor's own Total R display (standard tables)

LINK 2h std: WR 63.8%, Total +28.3R. DOGE 1h std: WR 39.6%, Total -23.3R.
The vendor's own simulator shows NEGATIVE aggregate R on DOGE 1h standard -
first direct vendor-side evidence that R economics vary wildly by series
and can be deeply negative despite the flagship WR headlines elsewhere.
