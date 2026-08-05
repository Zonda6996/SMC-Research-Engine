# GGI black-box reconstruction — next verdict v1

Дата: 2026-08-03

## Verdict

На текущем наборе данных задача разделилась на две части:

1. **Signal fidelity** — подтверждена: CSV содержит реальные приватные GGI labels, а mapping `Shape0 = BUY`, `Shape1 = SELL` воспроизводится точно.
2. **Dashboard replay** — частично восстановлен: для полностью совмещённой ячейки BTC 15m получено точное число сделок, win rate и stop count, но не доказана полная внутренняя логика классификации `Partial/Full fix`.

Это уже не «план на будущее», а рабочий falsifiable baseline.

## Что воспроизведено

Для BTC 15m (20,527 баров, 85 labels) следующий gross-only baseline даёт:

```text
entry:       next bar open
stop:        1.5 × distance from entry to opposite Outer band
Mean:        moving Mean
partial:     25% event
full:        moving opposite Inner band
add:         optional 50% at midpoint entry-stop
fees:        excluded
funding:     excluded
slippage:    excluded
```

Результат:

```text
Trades:   85 / 85 exact
Winrate:  80.0% / 80.0% exact
Stop:     17 / 17 exact
Partial:  20 / 24
Full fix: 48 / 44
```

Четыре лишних `Full fix` и четыре недостающих `Partial` образуют точный swap. Поэтому оставшееся расхождение не выглядит ошибкой в BUY/SELL timestamps или в базовом moving-target потоке.

## Что нельзя утверждать

Нельзя утверждать, что приватный stop буквально равен `1.5 × distance to Outer`. Это только лучший black-box candidate на одной полностью совмещённой ячейке. Наиболее правдоподобный класс — volatility/geometry stop, возможно ATR плюс Apex/swing component. Ограниченный поиск комбинированных формул получил близкие, но не точные варианты, например `44 Full / 18 Stop / 23 Partial`; это подтверждает класс формулы, но не идентифицирует параметры.

Нельзя утверждать и буквальное немедленное BE на той же OHLC-свечи, где достигнут Mean. При таком правиле число Full fix резко падает и плохо совпадает с dashboard. Возможные объяснения:

- BE ставится только со следующей свечи;
- BE использует другой fill/trigger condition;
- dashboard считает отдельную Partial/BE категорию, а не терминальный replay outcome;
- импульсное касание target классифицируется отдельно, как предупреждал автор.

## Cross-dataset transfer

Один и тот же BTC 15m-кандидат без refit дал:

| Dataset | Trades | Partial | Stop | Full | WR |
|---|---:|---:|---:|---:|---:|
| BTC 2h | 42 | 12 | 6 | 23 | 83.3% |
| BTC 1h | 39 | 10 | 6 | 22 | 82.1% |
| BTC 15m | 85 | 20 | 17 | 48 | 80.0% |
| ONDO 2h | 46 | 10 | 8 | 28 | 82.6% |
| ONDO 1h | 81 | 17 | 12 | 50 | 82.7% |
| ONDO 15m | 62 | 13 | 9 | 40 | 85.5% |
| BNB 3m | 46 | 11 | 8 | 26 | 80.4% |
| SP500 1m | 41 | 10 | 1 | 30 | 97.6% |

Это не сравнение с dashboard-таблицами один к одному: BNB и SP500 user-provided percentages не являются точными дробями от текущих 46 и 42 labels, значит окно dashboard шире/иное. Но переносимость геометрического baseline выглядит рабочей гипотезой, особенно на 2h/1h/15m.

## Standard mode

Standard теперь реализован отдельно от Safe/Risk:

- без dynamic Mean partial;
- fixed full target `1.14R` без add;
- add accounting оставлен отдельным параметром, поскольку пользовательская формулировка `2R with add` требует уточнить, считается ли R по initial risk или по blended average risk.

Safe/Risk и Standard нельзя смешивать в одном fit.

## Следующий эксперимент

Следующий шаг — не расширять сетку параметров бесконтрольно. Нужно записать outcome ledger для каждого BTC 15m trade:

```text
meanReached
fullTargetReached
stoppedBeforeMean
stoppedAfterMean
fullTargetReachedAfterMean
mean/full same-bar collision
next-bar BE hit
impulsive target touch
```

Затем проверить ровно три заранее заданных vendor-classification hypotheses:

- **H1 delayed-BE:** Mean event переводит stop в BE только со следующей свечи;
- **H2 dashboard taxonomy:** `Partial` = Mean reached but terminal dashboard category, а `Full fix` учитывается только при отдельном confirmed full event;
- **H3 impulsive-target exception:** same-bar/impulsive touch through moving target maps to Partial/BE rather than Full fix.

Критерий продвижения: правило должно улучшить BTC 15m и не разрушить перенос на BTC 1h/2h и ONDO. Если правило работает только на этих 4 записях BTC 15m, его следует считать подгонкой и не принимать.

## Финальный статус этапа

- GGI labels: confirmed real, not random.
- ISO parser: implemented and tested.
- Input hashes/chronology: recorded.
- Gross Safe/Risk-style replay: implemented.
- Standard fixed-target replay: separated and tested.
- BTC 15m dashboard: near-reconciled, exact Trades/WR/Stop.
- Exact vendor stop formula: not identified.
- Exact dashboard Partial/BE taxonomy: not identified.
- Net profitability: intentionally not evaluated yet.
