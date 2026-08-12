# ZC1 - zone confluence: vendor forward signals inside his own interest zones

Zones parsed 181, usable after price-scale resolution 85.
Rules: direction-matched, zone age <= 45d, entry within zone +- 25% of width. Base machinery (P25/S12) R from FWD1.

| group | n | mean R | WR | P/S/F |
|---|---|---|---|---|
| in-zone | 52 | 0.1535 | 96.2% | 16/2/34 |
| out-zone | 684 | 0.0036 | 87.6% | 208/85/391 |
| no-zone-data | 0 | - | - | - |

## In-zone trades (every one, no selection)

| date | symbol | tf | side | R | outcome | zone (raw) | zone age h |
|---|---|---|---|---|---|---|---|
| 2026-02-24T16:00 | AVAXUSDT | 60 | L | 0.621 | Full fix | AVAXUSDT Зона покупок 8.43 | 39 |
| 2026-02-24T17:00 | BTCUSDT | 60 | L | 0.558 | Full fix | BTCUSDT Зона покупок(локально) 65000-64000 | 40 |
| 2026-03-09T07:00 | TRXUSDT | 60 | S | -0.687 | Partial | TRXUSDT Зона продаж 0.2885-0.295 | 372 |
| 2026-03-09T08:00 | TRXUSDT | 120 | S | -0.688 | Partial | TRXUSDT Зона продаж 0.2885-0.295 | 373 |
| 2026-03-11T18:00 | TRXUSDT | 60 | S | -0.684 | Partial | TRXUSDT Зона продаж 0.2885-0.295 | 431 |
| 2026-03-12T03:00 | TRXUSDT | 60 | S | -0.701 | Partial | TRXUSDT Зона продаж 0.2885-0.295 | 440 |
| 2026-03-12T06:00 | TRXUSDT | 120 | S | -1.000 | Stop | TRXUSDT Зона продаж 0.2885-0.295 | 443 |
| 2026-03-13T15:00 | BTCUSDT | 60 | S | 0.634 | Full fix | BTCUSDT Зона продаж 73500-80000 | 214 |
| 2026-03-16T08:00 | BTCUSDT | 60 | S | 0.737 | Full fix | BTCUSDT Зона продаж 73500-80000 | 279 |
| 2026-03-27T22:00 | BTCUSDT | 120 | L | 0.674 | Full fix | BTCUSDT Зона покупок(локально) 65800-64500 | 1033 |
| 2026-03-30T01:00 | ALGOUSDT | 60 | L | 0.487 | Full fix | ALGOUSDT Зона покупок 0.08-0.07 | 2 |
| 2026-03-30T02:00 | ATOMUSDT | 120 | L | 0.680 | Full fix | ATOMUSDT Зона покупок(риск) 1.65-1.54 | 16 |
| 2026-03-30T04:00 | SOLUSDT | 120 | L | 0.582 | Full fix | SOLUSDT Зона покупок(локально) 85-83 | 67 |
| 2026-03-30T04:00 | ATOMUSDT | 240 | L | 0.722 | Full fix | ATOMUSDT Зона покупок(риск) 1.65-1.54 | 18 |
| 2026-03-30T04:00 | AVAXUSDT | 120 | L | 0.626 | Full fix | AVAXUSDT Зона покупок(локально) 8.9-8.5 | 735 |
| 2026-03-30T12:00 | AVAXUSDT | 240 | L | 0.544 | Full fix | AVAXUSDT Зона покупок(локально) 8.9-8.5 | 743 |
| 2026-04-01T16:00 | ALGOUSDT | 240 | S | -0.774 | Partial | ALGOUSDT Зона продаж 0.105-0.11 | 10 |
| 2026-04-07T09:00 | AVAXUSDT | 60 | L | 0.601 | Full fix | AVAXUSDT Зона покупок(локально) 8.9-8.5 | 932 |
| 2026-04-14T15:00 | BTCUSDT | 60 | S | -0.697 | Partial | BTCUSDT Зона продаж 73500-80000 | 982 |
| 2026-04-14T20:00 | BTCUSDT | 120 | S | -0.770 | Partial | BTCUSDT Зона продаж 72900-74000 | 118 |
| 2026-04-17T10:00 | BTCUSDT | 60 | S | -0.742 | Partial | BTCUSDT Зона продаж 76000-79000 | 1 |
| 2026-04-27T04:00 | BTCUSDT | 60 | S | 0.805 | Full fix | BTCUSDT Зона продаж 76000-79000 | 235 |
| 2026-05-03T17:00 | JTOUSDT | 60 | S | -0.693 | Partial | JTOUSDT Зона продаж 0.4-0.44 | 1 |
| 2026-05-03T18:00 | JTOUSDT | 120 | S | -0.663 | Partial | JTOUSDT Зона продаж 0.4-0.44 | 2 |
| 2026-05-03T20:00 | JTOUSDT | 240 | S | -0.645 | Partial | JTOUSDT Зона продаж 0.4-0.44 | 4 |
| 2026-05-04T07:00 | BTCUSDT | 60 | S | 0.827 | Full fix | BTCUSDT Зона продаж 80000-83000 | 5 |
| 2026-05-10T20:00 | ASTERUSDT | 60 | S | 0.575 | Full fix | ASTERUSDT Зона продаж 0.712-0.73 | 39 |
| 2026-05-16T14:00 | SUIUSDT | 60 | L | -0.724 | Partial | SUIUSDT Зона покупок 1.06-1 | 7 |
| 2026-05-17T13:00 | ATOMUSDT | 60 | S | 0.555 | Full fix | ATOMUSDT Зона продаж(локально) 2.1-2.25 | 147 |
| 2026-05-22T08:00 | ATOMUSDT | 60 | S | 0.692 | Full fix | ATOMUSDT Зона продаж(локально) 2.1-2.25 | 262 |
| 2026-05-22T22:00 | XRPUSDT | 60 | L | -0.717 | Partial | XRPUSDT Зона покупок 1.385-1.35 | 607 |
| 2026-05-24T14:00 | ASTERUSDT | 60 | S | 0.739 | Full fix | ASTERUSDT Зона продаж 0.712-0.73 | 369 |
| 2026-05-26T18:00 | ATOMUSDT | 60 | S | 0.499 | Full fix | ATOMUSDT Зона продаж(локально) 2.1-2.25 | 368 |
| 2026-05-26T20:00 | ATOMUSDT | 120 | S | 0.505 | Full fix | ATOMUSDT Зона продаж(локально) 2.1-2.25 | 370 |
| 2026-05-28T22:00 | BTCUSDT | 120 | L | -1.000 | Stop | BTCUSDT Зона покупок 74800-72000 | 134 |
| 2026-06-06T00:00 | GRASSUSDT | 120 | L | 0.667 | Full fix | GRASSUSDT Зона покупок 0.386-0.35 | 36 |
| 2026-06-10T02:00 | DYDXUSDT | 60 | L | 0.523 | Full fix | DYDXUSDT Зона покупок 0.127-0.117 | 10 |
| 2026-06-24T06:00 | LTCUSDT | 60 | L | 0.713 | Full fix | LTCUSDT Зона покупок 45-40 | 484 |
| 2026-06-24T15:00 | LDOUSDT | 60 | L | 0.507 | Full fix | LDOUSDT Зона покупок 0.25-0.22 | 465 |
| 2026-06-24T22:00 | SOLUSDT | 120 | L | 0.577 | Full fix | SOLUSDT Зона покупок 67-60 | 500 |
| 2026-06-25T02:00 | ONDOUSDT | 120 | L | 0.592 | Full fix | ONDOUSDT Зона покупок 0.34-0.32 | 953 |
| 2026-06-25T16:00 | SPXUSDT | 120 | L | 0.706 | Full fix | SPXUSDT Зона покупок 0.34-0.3 | 797 |
| 2026-07-14T00:00 | SUIUSDT | 60 | L | 0.521 | Full fix | SUIUSDT Зона покупок 0.788-0.7 | 959 |
| 2026-06-19T10:00 | OPUSDT | 15 | L | 0.923 | Full fix | OPUSDT Зона покупок(локально) 0.102-0.098 | 6 |
| 2026-06-19T13:00 | SOLUSDT | 60 | L | 0.658 | Full fix | SOLUSDT Зона покупок 67-60 | 371 |
| 2026-06-20T14:45 | ONDOUSDT | 15 | L | -0.691 | Partial | ONDOUSDT Зона покупок 0.34-0.32 | 845 |
| 2026-06-22T00:30 | OPUSDT | 15 | L | 0.652 | Full fix | OPUSDT Зона покупок(локально) 0.102-0.098 | 68 |
| 2026-06-25T19:45 | OPUSDT | 15 | L | 0.595 | Full fix | OPUSDT Зона покупок(локально) 0.102-0.098 | 160 |
| 2026-07-08T16:00 | OPUSDT | 15 | L | 0.588 | Full fix | OPUSDT Зона покупок(локально) 0.102-0.098 | 468 |
| 2026-07-13T03:30 | OPUSDT | 15 | L | 0.630 | Full fix | OPUSDT Зона покупок(локально) 0.102-0.098 | 575 |
| 2026-07-16T10:30 | OPUSDT | 15 | L | -0.898 | Partial | OPUSDT Зона покупок(локально) 0.102-0.098 | 654 |
| 2026-07-17T10:15 | OPUSDT | 15 | L | -0.758 | Partial | OPUSDT Зона покупок(локально) 0.102-0.098 | 678 |
## Statistical note (appended post-run)

- in-zone n=52 mean +0.1535R vs out-zone n=684 mean +0.0036R.
- Bootstrap P(in-zone mean <= out-zone mean) ~ 0.053; matched-size random
  draw from all forward trades beats the in-zone mean ~8% of the time.
  Suggestive (~p 0.05-0.08), NOT conclusive - n=52 with clustered episodes
  (e.g. 5 correlated TRX shorts in one zone) inflates effective n.
- Effect direction matches the vendor's own framing ("бот подсвечивает
  вероятности, дальше все зависит от работы внутри зоны") and Nikita's
  confluence thesis: arrows alone ~0R, arrows inside a hand-drawn zone
  positive with 96% WR and 34 full fixes vs 2 stops.
- Caveats: zones are hand-drawn and sparsely broadcast (85 usable);
  price-scale resolution excluded 96 zones; TTL/tolerance were fixed a
  priori but only one configuration was run (no sweep - deliberately).
