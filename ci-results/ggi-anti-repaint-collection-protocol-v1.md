# GGI anti-repaint / live stability collection protocol v1

## Зачем это нужно

Все текущие backtests используют historical TradingView exports. Самая весомая оставшаяся проверка — убедиться, что уже закрытые BUY/SELL Shapes и Apex series не исчезают и не пересчитываются после появления новых свечей.

Создан инструмент:

```text
ci/research/compareGgiExportSnapshots.ts
```

Он сравнивает два CSV одного symbol/timeframe по timestamp и отдельно считает:

- historical Shape changes;
- historical Mean/Inner/Outer changes;
- historical OHLC changes;
- изменения только последних открытых свечей;
- строки, добавленные/выпавшие из-за rolling TradingView window.

## Что собрать

Нужны две независимые серии.

### Серия A — 2h, основной кандидат

Выбрать один ликвидный perpetual: BTC, ETH или SOL.

Сохранить 5–10 CSV одного и того же symbol/timeframe:

1. когда появился новый BUY/SELL;
2. сразу после закрытия signal candle;
3. после следующей закрытой свечи;
4. через 3 свечи;
5. через 10 свечей;
6. после add, если случился;
7. после Partial;
8. после Full или Stop.

### Серия B — 5m или 15m

Повторить тот же процесс на одном низком timeframe. Здесь особенно важно сохранить экспорт сразу после появления сигнала и через 1/3/10 закрытых свечей.

## Имена файлов

Не перезаписывать предыдущие CSV. Использовать:

```text
GGI_BTCUSDT_2h_2026-08-04_1400+05.csv
GGI_BTCUSDT_2h_2026-08-04_1605+05.csv
GGI_BTCUSDT_2h_2026-08-04_1805+05.csv
```

Рядом записать:

```text
Symbol/feed:
Timeframe:
Export timestamp + timezone:
Current candle open/closed:
Latest visible signal timestamp:
Mode shown in dashboard screenshot: Safe / Risk
State: new / active / add / partial / full / stop
```

CSV Shapes общие для Safe/Risk, поэтому один CSV на момент достаточно. Safe/Risk screenshots нужны только для сравнения management state.

## Команда сравнения

Пример для 2h:

```text
node + tsx ci/research/compareGgiExportSnapshots.ts \
  --older "path/to/older.csv" \
  --newer "path/to/newer.csv" \
  --timeframe-ms 7200000 \
  --ignore-newest-bars 1 \
  --out "ci-results/ggi-snapshot-diff-btc-2h-01.json"
```

Для 5m `timeframe-ms = 300000`, для 15m `900000`, для 1h `3600000`.

`--ignore-newest-bars 1` исключает последнюю общую открытую/только что закрывающуюся свечу из historical verdict. Если экспорт сделан точно после закрытия свечи и известно, что обе последние общие свечи закрыты, можно отдельно проверить с `0`.

## Verdict

Инструмент выдаёт одно из трёх состояний:

```text
no-historical-change-detected-in-this-pair
historical-band-recalculation-detected
historical-shape-repaint-detected
```

Интерпретация:

- historical Shape repaint на закрытых свечах — сильное отрицательное evidence для historical backtest;
- только band recalculation — требует проверки, меняет ли оно historical targets и outcomes;
- отсутствие изменений в 5–10 snapshots повышает доверие, но не доказывает абсолютное отсутствие repaint во всех режимах.

## Минимальный полезный пакет

Если времени мало, достаточно начать с:

1. один 2h актив, 4 последовательных CSV;
2. один 5m/15m актив, 4 последовательных CSV;
3. Safe/Risk dashboard screenshot на первом и последнем snapshot каждой серии.

Это уже даст первую прямую live-проверку, которой сейчас полностью не хватает.
