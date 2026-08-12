# ZC4 - heatmap iteration 2: 1h trigger, 1h+4h zone profiles, causal weight terciles

Symbols: BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, BNBUSDT, DOGEUSDT, ADAUSDT, LINKUSDT, LTCUSDT, AVAXUSDT, DOTUSDT, ATOMUSDT. Window: last ~9900 1h bars (~14 months, Gate history cap).
Trigger OWN1 bk1.5/M10/cd40 on 1h. Zones: heatmap 60m + 240m profiles, age >= 1d/2d, active or swept <= 24h, band tol 50%. Machinery P25/S12.
Weight tercile = causal rank of rawStrength among same-side pools alive at signal time.

| group | n | mean R | WR | P/S/F |
|---|---|---|---|---|
| in|any | 1486 | -0.0124 | 92.7% | 529/109/848 |
| in|z240 | 859 | -0.0271 | 90.7% | 315/80/464 |
| in|z240|strict | 571 | -0.0393 | 90.0% | 216/57/298 |
| in|z240|top5strict | 135 | -0.1937 | 90.4% | 66/13/56 |
| in|z240|w-low | 25 | 0.3291 | 96.0% | 4/1/20 |
| in|z240|w-mid | 97 | 0.1459 | 94.8% | 28/5/64 |
| in|z240|w-top | 737 | -0.0620 | 90.0% | 283/74/380 |
| in|z60 | 1361 | 0.0017 | 92.9% | 474/96/791 |
| in|z60|strict | 1127 | 0.0061 | 92.4% | 390/86/651 |
| in|z60|top5strict | 243 | -0.0438 | 92.2% | 94/19/130 |
| in|z60|w-low | 51 | -0.0279 | 92.2% | 17/4/30 |
| in|z60|w-mid | 78 | 0.0962 | 96.2% | 23/3/52 |
| in|z60|w-top | 1232 | -0.0031 | 92.8% | 434/89/709 |
| out|any | 627 | 0.0003 | 95.9% | 207/26/394 |

Bootstrap P(in-any mean <= out-any mean): 0.7643

## Sample in-zone trades (first 300)

| date | symbol | layer | side | R | outcome | causal rank |
|---|---|---|---|---|---|---|
| 2025-07-01T14:00 | BTCUSDT | z60 | L | 0.428 | Full fix | 0.96 |
| 2025-07-01T14:00 | BTCUSDT | z240 | L | 0.428 | Full fix | 1.00 |
| 2025-07-02T21:00 | BTCUSDT | z60 | S | -0.716 | Partial | 0.96 |
| 2025-07-02T21:00 | BTCUSDT | z240 | S | -0.716 | Partial | 1.00 |
| 2025-07-05T20:00 | BTCUSDT | z60 | L | 0.508 | Full fix | 1.00 |
| 2025-07-05T20:00 | BTCUSDT | z240 | L | 0.508 | Full fix | 1.00 |
| 2025-07-07T07:00 | BTCUSDT | z60 | S | -0.723 | Partial | 1.00 |
| 2025-07-07T07:00 | BTCUSDT | z240 | S | -0.723 | Partial | 0.56 |
| 2025-07-11T16:00 | BTCUSDT | z60 | S | 0.700 | Full fix | 0.99 |
| 2025-07-11T16:00 | BTCUSDT | z240 | S | 0.700 | Full fix | 0.97 |
| 2025-07-13T22:00 | BTCUSDT | z60 | S | 0.693 | Full fix | 0.71 |
| 2025-07-13T22:00 | BTCUSDT | z240 | S | 0.693 | Full fix | 1.00 |
| 2025-07-15T14:00 | BTCUSDT | z60 | L | 0.360 | Full fix | 1.00 |
| 2025-07-22T06:00 | BTCUSDT | z60 | L | 0.426 | Full fix | 1.00 |
| 2025-07-25T10:00 | BTCUSDT | z60 | L | 0.624 | Full fix | 1.00 |
| 2025-07-25T10:00 | BTCUSDT | z240 | L | 0.624 | Full fix | 1.00 |
| 2025-07-26T21:00 | BTCUSDT | z60 | S | 0.420 | Full fix | 0.99 |
| 2025-07-28T14:00 | BTCUSDT | z60 | S | 0.539 | Full fix | 0.99 |
| 2025-08-01T12:00 | BTCUSDT | z60 | L | 0.533 | Full fix | 0.99 |
| 2025-08-01T12:00 | BTCUSDT | z240 | L | 0.533 | Full fix | 1.00 |
| 2025-08-05T04:00 | BTCUSDT | z240 | S | -0.745 | Partial | 1.00 |
| 2025-08-07T17:00 | BTCUSDT | z60 | S | -0.831 | Partial | 1.00 |
| 2025-08-07T17:00 | BTCUSDT | z240 | S | -0.831 | Partial | 1.00 |
| 2025-08-09T12:00 | BTCUSDT | z60 | S | -0.805 | Partial | 1.00 |
| 2025-08-11T08:00 | BTCUSDT | z60 | S | 1.016 | Full fix | 1.00 |
| 2025-08-11T08:00 | BTCUSDT | z240 | S | 1.016 | Full fix | 1.00 |
| 2025-08-14T06:00 | BTCUSDT | z60 | S | 0.611 | Full fix | 1.00 |
| 2025-08-14T06:00 | BTCUSDT | z240 | S | 0.611 | Full fix | 1.00 |
| 2025-08-15T23:00 | BTCUSDT | z60 | L | -0.730 | Partial | 1.00 |
| 2025-08-15T23:00 | BTCUSDT | z240 | L | -0.730 | Partial | 1.00 |
| 2025-08-18T13:00 | BTCUSDT | z60 | L | -0.855 | Partial | 1.00 |
| 2025-08-18T13:00 | BTCUSDT | z240 | L | -0.855 | Partial | 1.00 |
| 2025-08-20T09:00 | BTCUSDT | z60 | L | 0.475 | Full fix | 1.00 |
| 2025-08-20T09:00 | BTCUSDT | z240 | L | 0.475 | Full fix | 1.00 |
| 2025-08-22T03:00 | BTCUSDT | z60 | L | 0.473 | Full fix | 1.00 |
| 2025-08-23T14:00 | BTCUSDT | z60 | S | 0.440 | Full fix | 0.99 |
| 2025-08-25T15:00 | BTCUSDT | z60 | L | 0.575 | Full fix | 0.97 |
| 2025-08-25T15:00 | BTCUSDT | z240 | L | 0.575 | Full fix | 1.00 |
| 2025-08-28T16:00 | BTCUSDT | z60 | S | 0.527 | Full fix | 1.00 |
| 2025-08-28T16:00 | BTCUSDT | z240 | S | 0.527 | Full fix | 0.99 |
| 2025-08-29T22:00 | BTCUSDT | z60 | L | 0.650 | Full fix | 1.00 |
| 2025-08-29T22:00 | BTCUSDT | z240 | L | 0.650 | Full fix | 1.00 |
| 2025-08-31T16:00 | BTCUSDT | z60 | L | 0.529 | Full fix | 0.98 |
| 2025-08-31T16:00 | BTCUSDT | z240 | L | 0.529 | Full fix | 1.00 |
| 2025-09-02T12:00 | BTCUSDT | z60 | S | -0.719 | Partial | 0.99 |
| 2025-09-07T01:00 | BTCUSDT | z60 | L | 0.516 | Full fix | 0.47 |
| 2025-09-08T20:00 | BTCUSDT | z60 | S | -0.692 | Partial | 1.00 |
| 2025-09-08T20:00 | BTCUSDT | z240 | S | -0.692 | Partial | 0.74 |
| 2025-09-11T16:00 | BTCUSDT | z60 | S | 0.484 | Full fix | 0.99 |
| 2025-09-11T16:00 | BTCUSDT | z240 | S | 0.484 | Full fix | 1.00 |
| 2025-09-13T17:00 | BTCUSDT | z60 | S | 0.454 | Full fix | 0.93 |
| 2025-09-17T04:00 | BTCUSDT | z60 | S | 0.426 | Full fix | 0.99 |
| 2025-09-17T04:00 | BTCUSDT | z240 | S | 0.426 | Full fix | 1.00 |
| 2025-09-20T08:00 | BTCUSDT | z60 | L | -1.000 | Stop | 0.97 |
| 2025-09-20T08:00 | BTCUSDT | z240 | L | -1.000 | Stop | 1.00 |
| 2025-09-22T04:00 | BTCUSDT | z60 | L | -1.000 | Stop | 1.00 |
| 2025-09-22T04:00 | BTCUSDT | z240 | L | -1.000 | Stop | 1.00 |
| 2025-09-23T21:00 | BTCUSDT | z60 | L | 0.573 | Full fix | 0.99 |
| 2025-09-25T15:00 | BTCUSDT | z60 | L | 0.427 | Full fix | 0.97 |
| 2025-09-27T23:00 | BTCUSDT | z240 | L | 0.507 | Full fix | 1.00 |
| 2025-09-29T02:00 | BTCUSDT | z60 | S | -1.000 | Stop | 0.99 |
| 2025-09-29T02:00 | BTCUSDT | z240 | S | -1.000 | Stop | 0.92 |
| 2025-09-30T22:00 | BTCUSDT | z60 | S | -1.000 | Stop | 0.99 |
| 2025-09-30T22:00 | BTCUSDT | z240 | S | -1.000 | Stop | 1.00 |
| 2025-10-02T15:00 | BTCUSDT | z60 | S | -1.000 | Stop | 1.00 |
| 2025-10-02T15:00 | BTCUSDT | z240 | S | -1.000 | Stop | 1.00 |
| 2025-10-04T15:00 | BTCUSDT | z60 | S | 0.557 | Full fix | 1.00 |
| 2025-10-04T15:00 | BTCUSDT | z240 | S | 0.557 | Full fix | 0.99 |
| 2025-10-08T09:00 | BTCUSDT | z60 | L | -0.721 | Partial | 1.00 |
| 2025-10-08T09:00 | BTCUSDT | z240 | L | -0.721 | Partial | 0.98 |
| 2025-10-10T09:00 | BTCUSDT | z60 | L | -0.731 | Partial | 1.00 |
| 2025-10-14T16:00 | BTCUSDT | z60 | L | -0.735 | Partial | 0.99 |
| 2025-10-16T17:00 | BTCUSDT | z60 | L | -0.783 | Partial | 0.99 |
| 2025-10-16T17:00 | BTCUSDT | z240 | L | -0.783 | Partial | 0.99 |
| 2025-10-20T00:00 | BTCUSDT | z60 | S | -0.706 | Partial | 0.99 |
| 2025-10-20T00:00 | BTCUSDT | z240 | S | -0.706 | Partial | 0.93 |
| 2025-10-27T08:00 | BTCUSDT | z60 | S | 1.005 | Full fix | 1.00 |
| 2025-10-27T08:00 | BTCUSDT | z240 | S | 1.005 | Full fix | 0.99 |
| 2025-10-29T18:00 | BTCUSDT | z60 | L | -0.777 | Partial | 0.99 |
| 2025-10-29T18:00 | BTCUSDT | z240 | L | -0.777 | Partial | 1.00 |
| 2025-11-02T13:00 | BTCUSDT | z60 | S | 0.602 | Full fix | 1.00 |
| 2025-11-03T12:00 | BTCUSDT | z60 | L | -1.000 | Stop | 1.00 |
| 2025-11-03T12:00 | BTCUSDT | z240 | L | -1.000 | Stop | 0.89 |
| 2025-11-10T02:00 | BTCUSDT | z60 | S | 0.790 | Full fix | 0.95 |
| 2025-11-10T02:00 | BTCUSDT | z240 | S | 0.790 | Full fix | 0.91 |
| 2025-11-12T09:00 | BTCUSDT | z60 | L | -0.740 | Partial | 0.87 |
| 2025-11-14T15:00 | BTCUSDT | z60 | L | -0.762 | Partial | 1.00 |
| 2025-11-14T15:00 | BTCUSDT | z240 | L | -0.762 | Partial | 1.00 |
| 2025-11-18T08:00 | BTCUSDT | z60 | L | -0.702 | Partial | 1.00 |
| 2025-11-18T08:00 | BTCUSDT | z240 | L | -0.702 | Partial | 1.00 |
| 2025-11-21T17:00 | BTCUSDT | z60 | L | 0.583 | Full fix | 0.98 |
| 2025-11-21T17:00 | BTCUSDT | z240 | L | 0.583 | Full fix | 1.00 |
| 2025-11-24T00:00 | BTCUSDT | z60 | S | -0.720 | Partial | 0.97 |
| 2025-11-24T00:00 | BTCUSDT | z240 | S | -0.720 | Partial | 0.76 |
| 2025-11-30T18:00 | BTCUSDT | z60 | S | 0.480 | Full fix | 0.95 |
| 2025-12-01T22:00 | BTCUSDT | z60 | L | 0.715 | Full fix | 1.00 |
| 2025-12-01T22:00 | BTCUSDT | z240 | L | 0.715 | Full fix | 0.98 |
| 2025-12-03T15:00 | BTCUSDT | z60 | S | 0.587 | Full fix | 1.00 |
| 2025-12-03T15:00 | BTCUSDT | z240 | S | 0.587 | Full fix | 0.48 |
| 2025-12-05T20:00 | BTCUSDT | z60 | L | 0.558 | Full fix | 1.00 |
| 2025-12-05T20:00 | BTCUSDT | z240 | L | 0.558 | Full fix | 1.00 |
| 2025-12-08T15:00 | BTCUSDT | z60 | S | 0.450 | Full fix | 0.90 |
| 2025-12-08T15:00 | BTCUSDT | z240 | S | 0.450 | Full fix | 0.78 |
| 2025-12-10T11:00 | BTCUSDT | z60 | S | 0.494 | Full fix | 0.51 |
| 2025-12-11T19:00 | BTCUSDT | z60 | L | 0.418 | Full fix | 0.97 |
| 2025-12-16T11:00 | BTCUSDT | z60 | L | 0.532 | Full fix | 0.97 |
| 2025-12-16T11:00 | BTCUSDT | z240 | L | 0.532 | Full fix | 1.00 |
| 2025-12-22T14:00 | BTCUSDT | z60 | S | -0.663 | Partial | 0.99 |
| 2025-12-22T14:00 | BTCUSDT | z240 | S | -0.663 | Partial | 0.95 |
| 2025-12-23T16:00 | BTCUSDT | z60 | L | 0.447 | Full fix | 1.00 |
| 2025-12-23T16:00 | BTCUSDT | z240 | L | 0.447 | Full fix | 0.88 |
| 2025-12-29T10:00 | BTCUSDT | z60 | S | -0.733 | Partial | 0.80 |
| 2025-12-30T09:00 | BTCUSDT | z60 | L | 0.310 | Full fix | 1.00 |
| 2025-12-31T15:00 | BTCUSDT | z240 | S | -0.731 | Partial | 0.99 |
| 2026-01-02T19:00 | BTCUSDT | z60 | S | -1.000 | Stop | 0.99 |
| 2026-01-02T19:00 | BTCUSDT | z240 | S | -1.000 | Stop | 0.99 |
| 2026-01-04T12:00 | BTCUSDT | z60 | S | -0.796 | Partial | 0.99 |
| 2026-01-04T12:00 | BTCUSDT | z240 | S | -0.796 | Partial | 0.99 |
| 2026-01-06T08:00 | BTCUSDT | z60 | S | 0.593 | Full fix | 0.99 |
| 2026-01-08T08:00 | BTCUSDT | z60 | L | 0.574 | Full fix | 1.00 |
| 2026-01-08T08:00 | BTCUSDT | z240 | L | 0.574 | Full fix | 1.00 |
| 2026-01-11T01:00 | BTCUSDT | z60 | L | 0.523 | Full fix | 0.97 |
| 2026-01-14T23:00 | BTCUSDT | z60 | S | 0.717 | Full fix | 0.99 |
| 2026-01-14T23:00 | BTCUSDT | z240 | S | 0.717 | Full fix | 0.94 |
| 2026-01-17T12:00 | BTCUSDT | z240 | L | -0.735 | Partial | 0.97 |
| 2026-01-21T01:00 | BTCUSDT | z60 | L | -0.713 | Partial | 1.00 |
| 2026-01-21T01:00 | BTCUSDT | z240 | L | -0.713 | Partial | 0.99 |
| 2026-01-25T11:00 | BTCUSDT | z60 | L | -0.744 | Partial | 0.93 |
| 2026-01-25T11:00 | BTCUSDT | z240 | L | -0.744 | Partial | 0.93 |
| 2026-01-28T15:00 | BTCUSDT | z60 | S | 0.508 | Full fix | 0.99 |
| 2026-01-28T15:00 | BTCUSDT | z240 | S | 0.508 | Full fix | 0.98 |
| 2026-01-30T19:00 | BTCUSDT | z60 | L | -0.882 | Partial | 1.00 |
| 2026-01-30T19:00 | BTCUSDT | z240 | L | -0.882 | Partial | 1.00 |
| 2026-02-01T23:00 | BTCUSDT | z60 | L | -0.707 | Partial | 0.53 |
| 2026-02-03T20:00 | BTCUSDT | z60 | L | -1.000 | Stop | 1.00 |
| 2026-02-05T17:00 | BTCUSDT | z60 | L | 0.797 | Full fix | 0.98 |
| 2026-02-05T17:00 | BTCUSDT | z240 | L | 0.797 | Full fix | 1.00 |
| 2026-02-08T17:00 | BTCUSDT | z60 | S | 0.555 | Full fix | 0.92 |
| 2026-02-14T13:00 | BTCUSDT | z60 | S | 0.657 | Full fix | 0.96 |
| 2026-02-19T15:00 | BTCUSDT | z60 | L | 0.561 | Full fix | 0.98 |
| 2026-02-19T15:00 | BTCUSDT | z240 | L | 0.561 | Full fix | 0.99 |
| 2026-02-21T17:00 | BTCUSDT | z60 | S | 0.527 | Full fix | 0.98 |
| 2026-02-21T17:00 | BTCUSDT | z240 | S | 0.527 | Full fix | 0.96 |
| 2026-02-23T10:00 | BTCUSDT | z60 | L | 0.562 | Full fix | 1.00 |
| 2026-02-23T10:00 | BTCUSDT | z240 | L | 0.562 | Full fix | 0.98 |
| 2026-02-28T08:00 | BTCUSDT | z60 | L | 0.811 | Full fix | 0.73 |
| 2026-03-05T08:00 | BTCUSDT | z60 | S | -0.707 | Partial | 0.98 |
| 2026-03-05T08:00 | BTCUSDT | z240 | S | -0.707 | Partial | 0.98 |
| 2026-03-07T21:00 | BTCUSDT | z60 | L | 0.790 | Full fix | 0.99 |
| 2026-03-10T04:00 | BTCUSDT | z60 | S | 0.454 | Full fix | 0.98 |
| 2026-03-10T04:00 | BTCUSDT | z240 | S | 0.454 | Full fix | 0.46 |
| 2026-03-13T15:00 | BTCUSDT | z60 | S | 0.634 | Full fix | 0.99 |
| 2026-03-13T15:00 | BTCUSDT | z240 | S | 0.634 | Full fix | 0.99 |
| 2026-03-15T13:00 | BTCUSDT | z60 | S | 0.429 | Full fix | 0.27 |
| 2026-03-19T10:00 | BTCUSDT | z60 | L | 0.678 | Full fix | 1.00 |
| 2026-03-19T10:00 | BTCUSDT | z240 | L | 0.678 | Full fix | 1.00 |
| 2026-03-22T03:00 | BTCUSDT | z60 | L | 0.637 | Full fix | 1.00 |
| 2026-03-26T21:00 | BTCUSDT | z60 | L | 0.475 | Full fix | 0.96 |
| 2026-03-26T21:00 | BTCUSDT | z240 | L | 0.475 | Full fix | 0.94 |
| 2026-03-30T14:00 | BTCUSDT | z60 | S | -0.716 | Partial | 1.00 |
| 2026-04-01T18:00 | BTCUSDT | z60 | S | -0.725 | Partial | 1.00 |
| 2026-04-02T15:00 | BTCUSDT | z60 | L | 0.429 | Full fix | 1.00 |
| 2026-04-06T22:00 | BTCUSDT | z60 | S | -0.665 | Partial | 0.94 |
| 2026-04-06T22:00 | BTCUSDT | z240 | S | -0.665 | Partial | 0.97 |
| 2026-04-08T15:00 | BTCUSDT | z60 | S | -0.801 | Partial | 0.99 |
| 2026-04-08T15:00 | BTCUSDT | z240 | S | -0.801 | Partial | 0.88 |
| 2026-04-10T16:00 | BTCUSDT | z60 | S | -0.740 | Partial | 0.96 |
| 2026-04-13T01:00 | BTCUSDT | z60 | L | 0.673 | Full fix | 0.99 |
| 2026-04-14T15:00 | BTCUSDT | z60 | S | -0.697 | Partial | 0.97 |
| 2026-04-14T15:00 | BTCUSDT | z240 | S | -0.697 | Partial | 0.96 |
| 2026-04-16T08:00 | BTCUSDT | z60 | S | -0.715 | Partial | 0.62 |
| 2026-04-18T11:00 | BTCUSDT | z60 | S | -0.723 | Partial | 0.92 |
| 2026-04-18T11:00 | BTCUSDT | z240 | S | -0.723 | Partial | 0.97 |
| 2026-04-20T07:00 | BTCUSDT | z60 | L | 0.618 | Full fix | 1.00 |
| 2026-04-20T07:00 | BTCUSDT | z240 | L | 0.618 | Full fix | 0.98 |
| 2026-04-22T17:00 | BTCUSDT | z60 | S | 0.710 | Full fix | 0.98 |
| 2026-04-22T17:00 | BTCUSDT | z240 | S | 0.710 | Full fix | 0.88 |
| 2026-05-01T15:00 | BTCUSDT | z60 | S | 0.580 | Full fix | 0.97 |
| 2026-05-01T15:00 | BTCUSDT | z240 | S | 0.580 | Full fix | 0.99 |
| 2026-05-04T00:00 | BTCUSDT | z60 | S | -0.732 | Partial | 0.90 |
| 2026-05-04T00:00 | BTCUSDT | z240 | S | -0.732 | Partial | 0.86 |
| 2026-05-05T22:00 | BTCUSDT | z60 | S | 0.538 | Full fix | 0.99 |
| 2026-05-05T22:00 | BTCUSDT | z240 | S | 0.538 | Full fix | 0.95 |
| 2026-05-08T11:00 | BTCUSDT | z60 | L | -0.730 | Partial | 1.00 |
| 2026-05-08T11:00 | BTCUSDT | z240 | L | -0.730 | Partial | 1.00 |
| 2026-05-10T19:00 | BTCUSDT | z60 | S | 0.704 | Full fix | 0.81 |
| 2026-05-10T19:00 | BTCUSDT | z240 | S | 0.704 | Full fix | 0.51 |
| 2026-05-13T02:00 | BTCUSDT | z60 | L | -0.750 | Partial | 0.94 |
| 2026-05-13T02:00 | BTCUSDT | z240 | L | -0.750 | Partial | 1.00 |
| 2026-05-17T03:00 | BTCUSDT | z60 | L | -0.788 | Partial | 1.00 |
| 2026-05-17T03:00 | BTCUSDT | z240 | L | -0.788 | Partial | 1.00 |
| 2026-05-18T20:00 | BTCUSDT | z60 | L | -0.728 | Partial | 1.00 |
| 2026-05-18T20:00 | BTCUSDT | z240 | L | -0.728 | Partial | 0.99 |
| 2026-05-21T10:00 | BTCUSDT | z60 | S | 0.463 | Full fix | 0.96 |
| 2026-05-23T14:00 | BTCUSDT | z60 | L | -0.655 | Partial | 1.00 |
| 2026-05-23T14:00 | BTCUSDT | z240 | L | -0.655 | Partial | 1.00 |
| 2026-05-25T23:00 | BTCUSDT | z60 | S | 0.457 | Full fix | 0.98 |
| 2026-05-27T16:00 | BTCUSDT | z60 | L | -0.827 | Partial | 1.00 |
| 2026-05-27T16:00 | BTCUSDT | z240 | L | -0.827 | Partial | 0.97 |
| 2026-06-01T17:00 | BTCUSDT | z60 | L | -1.000 | Stop | 0.99 |
| 2026-06-01T17:00 | BTCUSDT | z240 | L | -1.000 | Stop | 0.99 |
| 2026-06-03T22:00 | BTCUSDT | z60 | L | -0.871 | Partial | 1.00 |
| 2026-06-03T22:00 | BTCUSDT | z240 | L | -0.871 | Partial | 1.00 |
| 2026-06-10T13:00 | BTCUSDT | z60 | L | 0.543 | Full fix | 1.00 |
| 2026-06-11T15:00 | BTCUSDT | z60 | S | 0.371 | Full fix | 0.96 |
| 2026-06-13T17:00 | BTCUSDT | z60 | S | 0.592 | Full fix | 0.86 |
| 2026-06-16T03:00 | BTCUSDT | z60 | S | 0.512 | Full fix | 0.97 |
| 2026-06-18T13:00 | BTCUSDT | z60 | L | -0.778 | Partial | 1.00 |
| 2026-06-18T13:00 | BTCUSDT | z240 | L | -0.778 | Partial | 1.00 |
| 2026-06-21T12:00 | BTCUSDT | z60 | S | 0.584 | Full fix | 0.79 |
| 2026-06-21T12:00 | BTCUSDT | z240 | S | 0.584 | Full fix | 0.52 |
| 2026-06-24T01:00 | BTCUSDT | z60 | L | -1.000 | Stop | 1.00 |
| 2026-06-24T01:00 | BTCUSDT | z240 | L | -1.000 | Stop | 0.99 |
| 2026-06-25T22:00 | BTCUSDT | z60 | L | 0.527 | Full fix | 0.54 |
| 2026-06-29T03:00 | BTCUSDT | z60 | L | 0.601 | Full fix | 0.57 |
| 2026-07-01T03:00 | BTCUSDT | z60 | L | 0.416 | Full fix | 1.00 |
| 2026-07-08T17:00 | BTCUSDT | z60 | L | 0.467 | Full fix | 1.00 |
| 2026-07-13T15:00 | BTCUSDT | z60 | L | 0.662 | Full fix | 0.97 |
| 2026-07-13T15:00 | BTCUSDT | z240 | L | 0.662 | Full fix | 0.95 |
| 2026-07-17T16:00 | BTCUSDT | z60 | L | 0.527 | Full fix | 0.97 |
| 2026-07-17T16:00 | BTCUSDT | z240 | L | 0.527 | Full fix | 0.97 |
| 2026-07-19T04:00 | BTCUSDT | z60 | S | 0.636 | Full fix | 0.99 |
| 2026-07-19T04:00 | BTCUSDT | z240 | S | 0.636 | Full fix | 0.85 |
| 2026-07-21T18:00 | BTCUSDT | z60 | S | 0.545 | Full fix | 0.99 |
| 2026-07-21T18:00 | BTCUSDT | z240 | S | 0.545 | Full fix | 0.98 |
| 2026-07-27T01:00 | BTCUSDT | z60 | S | 0.810 | Full fix | 0.76 |
| 2026-07-27T01:00 | BTCUSDT | z240 | S | 0.810 | Full fix | 0.54 |
| 2026-07-31T03:00 | BTCUSDT | z240 | S | 0.357 | Full fix | 0.98 |
| 2025-07-03T15:00 | ETHUSDT | z240 | S | -0.690 | Partial | 1.00 |
| 2025-07-10T19:00 | ETHUSDT | z240 | S | -0.896 | Partial | 0.99 |
| 2025-07-14T15:00 | ETHUSDT | z240 | S | -0.707 | Partial | 1.00 |
| 2025-07-17T02:00 | ETHUSDT | z240 | S | -1.000 | Stop | 1.00 |
| 2025-07-21T16:00 | ETHUSDT | z240 | S | 0.707 | Full fix | 1.00 |
| 2025-07-24T08:00 | ETHUSDT | z240 | L | 0.529 | Full fix | 0.88 |
| 2025-08-02T21:00 | ETHUSDT | z240 | L | 0.717 | Full fix | 0.98 |
| 2025-08-05T01:00 | ETHUSDT | z60 | S | -0.652 | Partial | 1.00 |
| 2025-08-05T01:00 | ETHUSDT | z240 | S | -0.652 | Partial | 0.96 |
| 2025-08-07T15:00 | ETHUSDT | z60 | S | -1.000 | Stop | 1.00 |
| 2025-08-07T15:00 | ETHUSDT | z240 | S | -1.000 | Stop | 0.99 |
| 2025-08-09T14:00 | ETHUSDT | z60 | S | -0.762 | Partial | 1.00 |
| 2025-08-09T14:00 | ETHUSDT | z240 | S | -0.762 | Partial | 0.99 |
| 2025-08-14T01:00 | ETHUSDT | z60 | S | 0.744 | Full fix | 1.00 |
| 2025-08-14T01:00 | ETHUSDT | z240 | S | 0.744 | Full fix | 0.96 |
| 2025-08-19T18:00 | ETHUSDT | z60 | L | 0.594 | Full fix | 1.00 |
| 2025-08-19T18:00 | ETHUSDT | z240 | L | 0.594 | Full fix | 1.00 |
| 2025-08-26T02:00 | ETHUSDT | z60 | L | -0.677 | Partial | 0.85 |
| 2025-08-26T02:00 | ETHUSDT | z240 | L | -0.677 | Partial | 0.97 |
| 2025-08-29T13:00 | ETHUSDT | z60 | L | -0.738 | Partial | 0.99 |
| 2025-08-29T13:00 | ETHUSDT | z240 | L | -0.738 | Partial | 0.94 |
| 2025-08-31T20:00 | ETHUSDT | z60 | S | 0.473 | Full fix | 0.97 |
| 2025-09-04T03:00 | ETHUSDT | z60 | S | 0.424 | Full fix | 0.98 |
| 2025-09-04T03:00 | ETHUSDT | z240 | S | 0.424 | Full fix | 1.00 |
| 2025-09-13T14:00 | ETHUSDT | z60 | S | 0.720 | Full fix | 1.00 |
| 2025-09-13T14:00 | ETHUSDT | z240 | S | 0.720 | Full fix | 0.96 |
| 2025-09-16T16:00 | ETHUSDT | z60 | L | -0.694 | Partial | 0.90 |
| 2025-09-18T20:00 | ETHUSDT | z60 | S | 0.431 | Full fix | 1.00 |
| 2025-09-18T20:00 | ETHUSDT | z240 | S | 0.431 | Full fix | 1.00 |
| 2025-09-20T15:00 | ETHUSDT | z60 | L | -1.000 | Stop | 1.00 |
| 2025-09-22T21:00 | ETHUSDT | z60 | L | 0.680 | Full fix | 0.99 |
| 2025-09-22T21:00 | ETHUSDT | z240 | L | 0.680 | Full fix | 1.00 |
| 2025-09-30T10:00 | ETHUSDT | z60 | S | -0.713 | Partial | 0.16 |
| 2025-10-02T08:00 | ETHUSDT | z60 | S | 0.566 | Full fix | 0.98 |
| 2025-10-02T08:00 | ETHUSDT | z240 | S | 0.566 | Full fix | 0.74 |
| 2025-10-06T21:00 | ETHUSDT | z60 | S | 0.714 | Full fix | 0.99 |
| 2025-10-06T21:00 | ETHUSDT | z240 | S | 0.714 | Full fix | 0.94 |
| 2025-10-11T03:00 | ETHUSDT | z60 | L | -0.692 | Partial | 0.98 |
| 2025-10-11T03:00 | ETHUSDT | z240 | L | -0.692 | Partial | 0.97 |
| 2025-10-13T12:00 | ETHUSDT | z60 | S | 0.527 | Full fix | 0.93 |
| 2025-10-13T12:00 | ETHUSDT | z240 | S | 0.527 | Full fix | 0.71 |
| 2025-10-16T07:00 | ETHUSDT | z60 | L | -0.740 | Partial | 0.95 |
| 2025-10-20T00:00 | ETHUSDT | z60 | S | 0.640 | Full fix | 0.97 |
| 2025-10-23T00:00 | ETHUSDT | z60 | L | 0.529 | Full fix | 1.00 |
| 2025-10-27T08:00 | ETHUSDT | z60 | S | 1.055 | Full fix | 0.95 |
| 2025-10-27T08:00 | ETHUSDT | z240 | S | 1.055 | Full fix | 0.99 |
| 2025-10-29T18:00 | ETHUSDT | z60 | L | -0.823 | Partial | 1.00 |
| 2025-10-29T18:00 | ETHUSDT | z240 | L | -0.823 | Partial | 1.00 |
| 2025-10-31T12:00 | ETHUSDT | z60 | L | -0.747 | Partial | 1.00 |
| 2025-11-03T12:00 | ETHUSDT | z60 | L | -1.000 | Stop | 0.99 |
| 2025-11-03T12:00 | ETHUSDT | z240 | L | -1.000 | Stop | 0.97 |
| 2025-11-05T16:00 | ETHUSDT | z60 | L | -0.757 | Partial | 1.00 |
| 2025-11-05T16:00 | ETHUSDT | z240 | L | -0.757 | Partial | 1.00 |
| 2025-11-07T15:00 | ETHUSDT | z60 | L | -0.709 | Partial | 0.80 |
| 2025-11-08T12:00 | ETHUSDT | z60 | S | 0.443 | Full fix | 0.96 |
| 2025-11-10T15:00 | ETHUSDT | z60 | S | 0.562 | Full fix | 0.97 |
| 2025-11-12T02:00 | ETHUSDT | z60 | L | -0.711 | Partial | 0.99 |
| 2025-11-12T02:00 | ETHUSDT | z240 | L | -0.711 | Partial | 0.90 |
| 2025-11-14T15:00 | ETHUSDT | z60 | L | -0.737 | Partial | 0.90 |
| 2025-11-14T15:00 | ETHUSDT | z240 | L | -0.737 | Partial | 0.93 |
| 2025-11-17T01:00 | ETHUSDT | z60 | L | -0.723 | Partial | 0.93 |
| 2025-11-20T20:00 | ETHUSDT | z60 | L | 0.636 | Full fix | 0.95 |
| 2025-11-20T20:00 | ETHUSDT | z240 | L | 0.636 | Full fix | 1.00 |
| 2025-11-25T02:00 | ETHUSDT | z60 | S | -0.807 | Partial | 1.00 |
| 2025-11-27T13:00 | ETHUSDT | z60 | S | 0.470 | Full fix | 0.58 |
| 2025-11-27T13:00 | ETHUSDT | z240 | S | 0.470 | Full fix | 0.79 |
| 2025-12-01T22:00 | ETHUSDT | z60 | L | 0.823 | Full fix | 1.00 |
| 2025-12-01T22:00 | ETHUSDT | z240 | L | 0.823 | Full fix | 0.95 |
| 2025-12-04T15:00 | ETHUSDT | z60 | S | 0.612 | Full fix | 0.91 |
| 2025-12-06T15:00 | ETHUSDT | z60 | L | 0.490 | Full fix | 0.82 |
| 2025-12-06T15:00 | ETHUSDT | z240 | L | 0.490 | Full fix | 0.94 |
| 2025-12-08T16:00 | ETHUSDT | z60 | S | 0.330 | Full fix | 0.76 |
## Interpretation notes (appended post-run)

1. HEADLINE unchanged from ZC3: in-zone overall does NOT beat out-zone
   (bootstrap p=0.76 - if anything in-zone is worse). The heatmap as
   currently parameterised is not a confluence filter: it covers ~70%
   of all OWN1 signals (in|any 1486 vs out|any 627), and a filter that
   passes almost everything filters nothing.
2. WEIGHT INVERSION CONFIRMED, now monotonic and on a notional-ranked
   (causal-ish) scale, 4h zones:
     w-low  +0.33R (n=25), w-mid +0.15R (n=97), w-top -0.06R (n=737);
     top5-by-notional strict hit: -0.19R (n=135) - the WORST slice.
   Heaviest pools are where price slices through; light/mid pools are
   where it actually reverses. Same direction as ZC3, cleaner ranking.
   Combined light+mid 4h: n=122, ~+0.18R - the only positive slice, but
   small n and notional rank has mild look-ahead (final accumulation,
   not value-at-T).
3. 1h-profile zones: no useful structure (w-mid +0.10 n=78 at best).
4. Honest conclusion for Nikita: heatmap-as-display != tradable zones.
   The vendor's HAND zones separated (ZC2 +0.121 vs +0.048); the
   automated heatmap does not - yet. The one lead worth engineering:
   a causal pool-state engine (notional accumulated UP TO time T, not
   final) + "avoid the heaviest cluster, trade the mid/light ones".
   That requires an engine change (incremental state), not a rerun.
