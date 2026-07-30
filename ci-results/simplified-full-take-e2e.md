# Simplified full-take end-to-end time-stop

- Identical entries/stops across variants; only post-entry exit changes.
- Train `< 2025-01-01`; test `>= 2025-01-01`.
- Net cost: 0.10% of entry price per trade.
- Selection: highest train mean after removing the best 1% trades; test was not used.

| variant | family | train n | train E | train E ex-top1% | test n | test E | test ex-top1% | test PF | test DD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| time-80-e2e | time | 3887 | 0.049R | 0.013R | 1463 | 0.082R | 0.041R | 1.358 | 14.748R |

## Train-selected family winners

- time: **time-80-e2e** — train 0.013R ex-top1%; test 0.082R, ex-top1% 0.041R.
