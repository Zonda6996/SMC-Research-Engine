# Reversal volatility geometry v0.1

- Author statement: stop is not very short and adapts to current volatility so market noise does not knock it out; position risk must then be sized correctly to avoid liquidation.
- This statement is about **trade geometry and position sizing**, not necessarily the BUY/SELL trigger.
- Feed: Binance Spot OHLCV; visible plan levels are only used where a screenshot/OCR observation exists.
- Production defaults changed: **NO**.

| ID | Mode | TF | Step | Stop from entry | Step/ATR14 | Stop/ATR14 | Step/Apex width | Stop/Apex width |
|---|---|---:|---:|---:|---:|---:|---:|---:|


## Interpretation

1. First test the already observed mirror identity stop ≈ 2×add − entry; this fixes geometry before guessing volatility.
2. Then compare the step with ATR14/ATR50, realized volatility and Apex width across modes/assets/TF.
3. If one normalized ratio is stable cross-symbol and cross-TF, it likely controls Safe/Risk step length.
4. Position size is a separate calculation: fixed account risk divided by stop distance. A volatility-adaptive wider stop must reduce position size; leverage does not repair risk.

The current screenshot set contains too few exact plan levels for a statistically reliable cross-asset ratio. Additional plan screenshots should show entry/add/stop and exact signal bar together.
