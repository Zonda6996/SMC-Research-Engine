# Reversal timing and recovery diagnosis v3

## btc-perp-15m

- Labels: 69; direction alternation share 50.0%.
- Any-signal gap bars min/p10/p25/median/p75/p90/max: 57 / 77 / 103 / 163 / 275 / 390 / 696.
- BUY same-side gap: 61 / 89 / 163 / 297 / 494 / 765 / 1511.
- SELL same-side gap: 88 / 126 / 175 / 282 / 522 / 948 / 2140.
- Signal close distance from mean in Inner-halfwidths: 0.255 / 0.497 / 0.584 / 0.739 / 0.879 / 0.963 / 1.126.
- One-bar recovery delta: 0.058 / 0.074 / 0.104 / 0.155 / 0.244 / 0.329 / 0.539.

## btc-perp-1h

- Labels: 44; direction alternation share 65.1%.
- Any-signal gap bars min/p10/p25/median/p75/p90/max: 58 / 71 / 102 / 192 / 294 / 417 / 540.
- BUY same-side gap: 74 / 130 / 191 / 336 / 497 / 635 / 873.
- SELL same-side gap: 69 / 71 / 312 / 467 / 692 / 844 / 1732.
- Signal close distance from mean in Inner-halfwidths: 0.385 / 0.474 / 0.546 / 0.661 / 0.832 / 0.942 / 1.082.
- One-bar recovery delta: 0.010 / 0.031 / 0.085 / 0.154 / 0.189 / 0.249 / 0.452.

## eth-perp-15m

- Labels: 47; direction alternation share 50.0%.
- Any-signal gap bars min/p10/p25/median/p75/p90/max: 57 / 80 / 119 / 197 / 289 / 336 / 787.
- BUY same-side gap: 76 / 85 / 217 / 293 / 456 / 645 / 817.
- SELL same-side gap: 90 / 134 / 186 / 389 / 522 / 1142 / 1979.
- Signal close distance from mean in Inner-halfwidths: 0.272 / 0.412 / 0.549 / 0.732 / 0.823 / 0.933 / 1.054.
- One-bar recovery delta: 0.017 / 0.063 / 0.083 / 0.163 / 0.225 / 0.355 / 0.587.

## sol-spot-15m

- Labels: 37; direction alternation share 41.7%.
- Any-signal gap bars min/p10/p25/median/p75/p90/max: 60 / 83 / 138 / 227 / 401 / 489 / 669.
- BUY same-side gap: 65 / 83 / 161 / 279 / 471 / 1227 / 1868.
- SELL same-side gap: 111 / 136 / 400 / 559 / 845 / 940 / 1770.
- Signal close distance from mean in Inner-halfwidths: 0.346 / 0.453 / 0.617 / 0.738 / 0.836 / 0.920 / 1.174.
- One-bar recovery delta: 0.013 / 0.079 / 0.113 / 0.184 / 0.225 / 0.240 / 0.601.

## btc-perp-5m

- Labels: 81; direction alternation share 47.5%.
- Any-signal gap bars min/p10/p25/median/p75/p90/max: 52 / 94 / 125 / 206 / 290 / 423 / 794.
- BUY same-side gap: 53 / 117 / 167 / 332 / 619 / 848 / 1888.
- SELL same-side gap: 52 / 105 / 223 / 319 / 597 / 1017 / 1817.
- Signal close distance from mean in Inner-halfwidths: 0.397 / 0.525 / 0.622 / 0.739 / 0.863 / 0.925 / 1.327.
- One-bar recovery delta: 0.015 / 0.054 / 0.095 / 0.146 / 0.217 / 0.362 / 0.611.

## btc-perp-4h

- Labels: 38; direction alternation share 48.6%.
- Any-signal gap bars min/p10/p25/median/p75/p90/max: 56 / 64 / 108 / 192 / 268 / 338 / 443.
- BUY same-side gap: 57 / 173 / 259 / 338 / 443 / 644 / 1555.
- SELL same-side gap: 56 / 64 / 120 / 376 / 479 / 524 / 1244.
- Signal close distance from mean in Inner-halfwidths: 0.241 / 0.464 / 0.552 / 0.722 / 0.903 / 1.009 / 1.237.
- One-bar recovery delta: 0.033 / 0.045 / 0.063 / 0.112 / 0.195 / 0.325 / 0.594.

The focused v3 search should model a recovery-level crossing after an earlier Inner/Outer visit, with independent one-shot and same-side re-arm.
