# Reversal observations matched to Binance Spot

- Dataset: ci-results/reversal-observed-events-2026-07-31.json
- Timezone: Kazakhstan / UTC+5; all exact event times converted to UTC before matching.
- Feed: Binance Spot archive; this is a feed match attempt, not proof that TradingView used an identical internal series.
- Production defaults changed: **NO**.

## Summary

- Observations: 16
- Exact matched bars: 11
- Unresolved: 5
- Positive exact events: 11
- H0 baseline exact direction hits: 0
- Exact hit rate: 0.0%
- Negative/window observations matched: 0

## Coverage

| Symbol | TF | Bars | From | To |
|---|---:|---:|---|---|
| BTCUSDT | 15m | 3456 | 2026-06-25T00:00:00.000Z | 2026-07-30T23:45:00.000Z |
| BTCUSDT | 1h | 864 | 2026-06-25T00:00:00.000Z | 2026-07-30T23:00:00.000Z |
| ETHUSDT | 1h | 864 | 2026-06-25T00:00:00.000Z | 2026-07-30T23:00:00.000Z |
| ETHUSDT | 45m | 0 | — | — |
| SOLUSDT | 30m | 1728 | 2026-06-25T00:00:00.000Z | 2026-07-30T23:30:00.000Z |
| SOLUSDT | 5m | 10368 | 2026-06-25T00:00:00.000Z | 2026-07-30T23:55:00.000Z |

## Interpretation

The current H0 detector is only a control. A miss does not prove the vendor formula is wrong: the screenshot may use a different feed, the label may be intrabar, or the current Apex width may be inaccurate. A hit does not prove the formula is correct. The next detector candidates must be scored against these rows plus matched no-signal windows, without using outcome fields.

## Event table

| ID | Status | Expected | Mode | Baseline | Candle | Notes |
|---|---|---|---|---|---|---|
| btc-12 | matched | short | safe | — | bearish | direction mismatch |
| btc-13-buy | matched | long | safe | — | bullish | direction mismatch |
| btc-13-sell | matched | short | safe | — | bearish | direction mismatch |
| btc-14 | matched | long | safe | — | bullish | direction mismatch |
| btc-15 | matched | short | safe | — | bearish | direction mismatch |
| btc-16 | matched | long | safe | — | bullish | direction mismatch |
| btc-17-safe | matched | long | safe | — | bullish | direction mismatch |
| btc-18-risk | matched | long | risk | — | bullish | direction mismatch |
| eth-safe-sell | matched | short | safe | — | bearish | direction mismatch |
| eth-safe-buy | unresolved | signal | — | — | — | exact timestamp is outside archive coverage or feed has no matching bar |
| sol-safe-sell-30m | matched | short | safe | — | bearish | direction mismatch |
| sol-safe-buy-active | unresolved | signal | — | — | — | exact timestamp is outside archive coverage or feed has no matching bar |
| sol-risk-buy-active | unresolved | signal | — | — | — | exact timestamp is outside archive coverage or feed has no matching bar |
| sol-standard-buy-active | unresolved | signal | — | — | — | exact timestamp is outside archive coverage or feed has no matching bar |
| sol-5m-no-signal-window | unresolved | no signal | — | — | — | window-only observation; no exact timestamp |
| sol-safe-sell-5m | matched | short | safe | — | bearish | direction mismatch |
