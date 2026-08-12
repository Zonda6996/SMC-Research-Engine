# SUR1 Amendment 1 - first run VOID (missing volume column), calibration re-based

Committed after the first run produced n=0 for all 9 rules and BEFORE seeing
any substantive result (nothing to see: all rules were frequency-DQ'd at zero).

## What happened

BYBIT_BTCUSDT.P_2h_full20k.csv and BINANCE_XRPUSDT_3m.csv contain NO volume
column (header: time,OHLC,5 bands,Shapes,Shapes). parseExactIndicatorCsv sets
volume=0, so the frozen volume condition (vol >= k x SMA50) is unsatisfiable.
Outer-band stretches are plentiful in the same files (353/449 wick touches on
BTC 2h), confirming the stretch leg works. The run tested nothing: VOID, not
FAILURE.

## Amended data plan (everything else in the pre-registration unchanged)

- CALIBRATION: BYBIT_BTCUSDT.P_15m.csv (has volume; 85 arrows).
- OOS: BYBIT_ONDOUSDT.P_2h.csv (46 arrows), BYBIT_ONDOUSDT.P_15m.csv (63).
- DEFERRED OOS: BTC 2h and XRP 3m re-run when Nikita re-exports them WITH the
  volume column (request recorded). Their arrows/random benchmarks remain
  valid; only the surrogate needs volume.
- Frozen family, cooldown, benchmarks, capture metric, thresholds: UNCHANGED.
  Pooled-OOS success threshold now applies to the 2 available OOS datasets.

No result from the void run informs this amendment (all cells were zero).
