# Stateful Apex S4 v2 — holdout acquisition

- Status: **HOLDOUT_ACQUIRED_VALIDATED_NOT_REVEALED**.
- Reveal count: **0**; events/labels/PnL/metrics: **0/0/0/0**.
- S1 untouched OOS reveal: **0**; ONDO/VIRTUAL reuse: **0**.
- Mechanism: existing project paginated candle fetcher using ccxt Binance USDT-M.
- Blocker: none

| symbol | rows | first UTC | last UTC | SHA-256 |
|---|---:|---|---|---|
| ZECUSDT | 20000 | 2024-05-09T05:00:00.000Z | 2026-08-20T12:00:00.000Z | `d28460d5aef1bb3168b6da5f9701314a23530c53ae78b795223ec237ad89fc08` |
| 1000PEPEUSDT | 20000 | 2024-05-09T05:00:00.000Z | 2026-08-20T12:00:00.000Z | `ce80063f7281e9648836c7a9a34b872f789bc3087c10b2003d3a1115fed5efda` |
| BOMEUSDT | 20000 | 2024-05-09T05:00:00.000Z | 2026-08-20T12:00:00.000Z | `72e8218ec60bbd9511d9fa1b0ed865bfd18409701c7b4f49c2f91df239227c28` |

Frozen missing-data policy was applied exactly: no interpolation, no fallback, no replacement.
