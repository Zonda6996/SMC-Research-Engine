# Stateful Apex S4 v2 — immutable independent holdout universe freeze

- Status: **IMMUTABLE_HOLDOUT_UNIVERSE_FROZEN_NO_OHLCV_READ**.
- OHLCV/events/labels/PnL/metrics read or computed: **0/0/0/0/0/0**.
- S1 untouched OOS reveal: **0**; ONDO/VIRTUAL reuse: **0**.
- Venue: Binance USDT-M perpetual; timeframe: 1h; whole symbols: 3.
- UTC window: [2024-05-09T05:00:00.000Z, 2026-08-20T13:00:00.000Z); 20000 rows/symbol, then 210 frozen warmup bars.

## Frozen deterministic selection

Eligible active linear USDT-settled perpetuals with enough listing age and finite contemporaneous 24h quote volume were ranked descending by quote volume; canonical-symbol lexical ascending breaks exact ties. Every symbol present anywhere in S1 (including untouched OOS), S4 development, ONDO, and VIRTUAL is excluded symbol-wide. No post-selection replacement is allowed.

1. ZECUSDT — quoteVolume24h=1118872984.22
2. 1000PEPEUSDT — quoteVolume24h=482859103.092695
3. BOMEUSDT — quoteVolume24h=359674038.9021048

## Missing-data policy

zero missing/duplicate/off-grid/non-finite/invalid-OHLCV rows permitted; reject the entire frozen holdout and keep reveal=0; no symbol replacement or interpolation

## Snapshot and protocol hashes

- Freeze: `0f72ae18bfadef715bec8bfa7372f6551825f6c9b6256afafa2858ef71761c94`
- Metadata snapshot: `75f026222f3c25d22c24e9dd4d8fa90c6f22fa1b925e7e6169ccd3e7b182e682`
- Market snapshot: `54d0bd05585f19e282a032aa68e9d529ba054c27495c3b7d440c904306b70fff`
- 24h ticker snapshot: `04345670eddec3b42cb6bb6b9a30b5dba14df8ab6f877423bc5a35bb569acc7f`
- Eligibility ledger: `5657373f102b99206d9b63352cd29f7f5fd2ffae623de410880e201165697f0f`
- Frozen rule config: `6b5fa5c9de7f26ac3f71ba258065c5ab5a22fd4eb17b57d7634013acc42b765f`
- Frozen rule protocol: `b7119204cb71c3ccb3582e4dfd1c5cfc03943a46ff6e370cd5e8257ee8e7fc70`
- State machine: `5f82d45de35ede30e08599372e5cabd46bb04402ddc47de488fad1bfecb449c8`
- Apex engine: `0857b29aef879a3de56641f4a49cf405ffad8226df19f6e24e8ab91597cb2af7`
