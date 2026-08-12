# GGI gross dashboard reconciliation v1

Дата: 2026-08-03

## Scope

Это первый воспроизводимый replay реального приватного GGI Buy/Sell по предоставленным TradingView CSV. На этом этапе намеренно исключены funding, комиссии и slippage, поскольку их нет в показанной статистике автора.

Использованы реальные Shape labels:

- Shape 0 = BUY;
- Shape 1 = SELL;
- вход: проверены signal-close и next-open;
- Safe/Risk-подобные exits: moving Mean -> optional BE transition -> moving opposite Inner band;
- add: 50% initial + 50% add at midpoint between entry and stop;
- Standard: отдельный fixed-target режим, target = 1.14R without add; 2R with add requires a separate sizing convention;
- OHLC ambiguity: stop-first and target-first variants;
- startup-invalid Apex geometry не исправлялась и не синтезировалась.

## Input integrity

Все восемь оригинальных файлов из Downloads сохранены read-only как источник. SHA-256 и размеры записаны в `ggi-gross-replay-grid-v1.json`.

| Dataset | Rows | BUY | SELL | Chronology |
|---|---:|---:|---:|---|
| BTC 2h | 8,822 | 22 | 21 | continuous, exact 2h |
| BTC 1h | 8,830 | 25 | 15 | continuous, exact 1h |
| BTC 15m | 20,527 | 47 | 38 | continuous, exact 15m |
| ONDO 2h | 11,070 | 26 | 20 | continuous, exact 2h; first 134 rows have invalid startup band ordering |
| ONDO 1h | 16,920 | 47 | 35 | continuous, exact 1h |
| ONDO 15m | 14,672 | 32 | 31 | continuous, exact 15m |
| BNB 3m | 8,521 | 21 | 25 | four isolated 6m gaps |
| SP500 1m | 9,325 | 23 | 19 | session feed; daily/weekend closures are expected |

## Fully aligned dashboard cell: BTC 15m

Known dashboard cell:

```text
Trades:   85
Winrate:  80.0%
Partial:  24
Stop:     17
Full fix: 44
```

Best small preregistered stop-family candidate:

```text
entry:          next bar open
stop:           1.5 × distance from entry to opposite Outer band
partial:        moving Mean, 25% of initial position
full:           moving opposite Inner band
add:            optional 50% at midpoint entry-stop
BE:             not applied as a literal OHLC stop in this candidate
intrabar:       stop-first or target-first (same result in this cell)
```

Mutually exclusive replay result:

```text
Trades:   85
Partial:  20
Stop:     17
Full fix: 48
Winrate:  80.0%
```

The result is not a complete match, but the structure is highly informative:

- Trades match exactly: 85 = 85.
- Winrate matches exactly: 80.0% = 80.0%.
- Stop matches exactly: 17 = 17.
- Full fix is four higher in the replay: 48 vs 44.
- Exclusive Partial is four lower in the replay: 20 vs 24.
- Partial-reaching events are 68; `20 + 48 = 68`.
- Therefore the remaining discrepancy is a four-trade outcome-label rule, not a signal-count or basic target-count problem.

## Interpretation of Partial / Full fix

The most economical explanation is that the dashboard's `Partial` field is not simply the mutually exclusive terminal outcome used by the replay. It likely has a special BE/impulsive-target classification:

```text
replay terminal categories:
  Stop before Mean
  Mean reached, then stopped/BE
  Full reached

vendor dashboard categories:
  Stop
  Partial/BE
  Full fix
```

The author explicitly described a case where price impulsively reaches a target and the dashboard reports BE although the position should remain active and profitable. The four-count swap (`48 -> 44 Full`, `20 -> 24 Partial`) is consistent with this observation, but the exact condition is not identifiable from OHLC alone and must not be claimed as reconstructed Pine logic.

## Cross-dataset fixed candidate

Applying the BTC 15m candidate without refitting to all eight exports gives:

| Dataset | Trades | Partial | Stop | Full fix | WR |
|---|---:|---:|---:|---:|---:|
| BTC 2h | 42 | 12 | 6 | 23 | 83.3% |
| BTC 1h | 39 | 10 | 6 | 22 | 82.1% |
| BTC 15m | 85 | 20 | 17 | 48 | 80.0% |
| ONDO 2h | 46 | 10 | 8 | 28 | 82.6% |
| ONDO 1h | 81 | 17 | 12 | 50 | 82.7% |
| ONDO 15m | 62 | 13 | 9 | 40 | 85.5% |
| BNB 3m | 46 | 11 | 8 | 26 | 80.4% |
| SP500 1m | 41 | 10 | 1 | 30 | 97.6% |

The BNB and SP500 user percentages are not exact fractions of the supplied label counts, so their dashboard periods are not identical to the CSV windows. They are retained as directional checks only.

## Current verdict

1. The real GGI labels are reproducible from the supplied exports; the prior independent G1 result must not be applied to GGI.
2. A moving-target gross replay with a band-anchored volatility stop explains the BTC 15m dashboard counts unusually well.
3. The best current stop candidate is not evidence of the private stop formula; it is a falsifiable black-box approximation.
4. Standard fixed-target replay is represented separately and must not be mixed with Safe/Risk dynamic replay.
5. The four-count Partial/Full discrepancy has now been resolved by the follow-up causal ledger: `Partial = wick touch Mean`, while `Full = candle close beyond moving opposite Inner` gives an exact `24 / 17 / 44` match.
6. Literal same-bar/next-bar OHLC BE does not match the dashboard, but this does not refute the real BE rule; it means BE execution needs confirmed-state or lower-timeframe semantics.
7. No profitability claim is made yet. Exact terminal counts do not identify the private stop or precise BE exit prices.

## Follow-up completed

The requested vendor-style outcome ledger and limited semantic grid were implemented in:

- `ci/research/runGgiStateMachineFidelityV1.ts`;
- `ci-results/ggi-state-machine-fidelity-v1.json`;
- `ci-results/ggi-state-machine-fidelity-v1.md`.

The machine result contains all 85 BTC 15m records with Mean/Inner/Stop/Add touch indexes, same-bar ambiguity flags and provisional outcomes. It also transfers the selected semantic rule without refit to the five 5m datasets.
