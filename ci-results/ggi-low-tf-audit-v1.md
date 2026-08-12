# GGI low-timeframe audit v1

Дата: 2026-08-04

## Цель

Проверить, является ли вывод о преимуществе 2h доказательством слабости всех TF ниже 1h. Использован тот же frozen management envelope, что в multi-asset holdout, без нового подбора параметров.

## Данные

| Dataset | Bars | Labels |
|---|---:|---:|
| BTC 15m | 20,527 | 85 |
| ONDO 15m | 14,672 | 63 |
| BNB 3m | 8,521 | 46 |
| SP500 1m | 9,325 | 42 |
| **Всего** | **53,045** | **236 raw labels / 234 replay trades** |

BNB 3m и SP500 1m являются короткими samples. SP500 имеет session gaps и не должен напрямую смешиваться с непрерывным crypto market.

## Frozen result

По 20 stop-first конфигурациям Safe/Risk × `8/10/12/14/16 × TR55` × no-add/with-add:

- pooled positive mean и PF > 1: **17/20**;
- BTC 15m: **0/20** положительных конфигураций;
- ONDO 15m: **19/20**;
- BNB 3m: **20/20**;
- SP500 1m: **20/20**.

Средний результат dataset по всей сетке:

| Dataset | Mean across grid | PF range |
|---|---:|---:|
| BTC 15m | -0.088% | 0.61–0.95 |
| ONDO 15m | +0.412% | 0.94–3.18 |
| BNB 3m | +0.048% | 1.35–2.83 |
| SP500 1m | +0.041% | 3.93–39.47 |

Central frozen cell Safe 12 no-add, pooled:

```text
Trades: 234
Mean: +0.183%
PF: 1.604
Positive-PnL rate: 69.7%
Dashboard-like WR: 92.7%
```

## Signal-only fixed horizons

Pooled endpoint return:

```text
6h   +0.020%, p≈0.415
12h  +0.205%, p≈0.069
24h  -0.032%, p≈0.549
48h  +0.244%, p≈0.178
```

Это не является статистически подтверждённым общим directional edge. Как и на старших TF, moving management выглядит сильнее простого endpoint return.

## Dashboard screenshots пользователя

Новые Safe dashboard:

| Dataset | Trades | Partial | Stop | Full | WR | Full/Stop |
|---|---:|---:|---:|---:|---:|---:|
| BNB 2h | 82 | 19 | 13 | 50 | 84.1% | 3.85 |
| BNB 1h | 78 | 20 | 16 | 42 | 79.5% | 2.63 |
| BNB 5m | 100 | 26 | 14 | 60 | 86.0% | 4.29 |
| XRP 1h | 76 | 32 | 11 | 33 | 85.5% | 3.00 |

Эти counts действительно визуально сильны, включая BNB 5m. Даже если Partial считать нулевым исходом, средний Full должен быть больше только `0.233R` на BNB 5m, чтобы перекрыть 14 полных `-1R` stops. Но dashboard не сообщает фактический R каждого Full/Partial, поэтому counts всё равно недостаточны для доказательства expectancy.

## Почему dashboard trades меньше raw labels

Сопоставление экспортов и screenshots:

```text
BNB 2h: raw labels 37 BUY + 48 SELL = 85; dashboard 34 LONG + 48 SHORT = 82
BNB 1h: last-20k labels 36 BUY + 45 SELL = 81; dashboard 33 LONG + 45 SHORT = 78
XRP 1h: last-20k labels 44 BUY + 34 SELL = 78; dashboard 42 LONG + 34 SHORT = 76
```

SHORT counts совпадают точно во всех трёх случаях; dashboard исключает 2–3 LONG. Это сильный признак, что таблица не является простым счётчиком всех Shapes. Возможные причины:

1. несколько BUY ещё активны и не являются завершёнными trades;
2. warmup/state eligibility исключает первые labels;
3. dashboard имеет mode-specific acceptance;
4. используется внутреннее окно/лимит, близкий к доступным 20k bars;
5. одновременно действуют окно и state machine.

Простой non-overlap на текущем proxy stop не воспроизвёл разницу BNB 1h/XRP 1h. Это означает, что нужен stateful replay с management, ближе к реальному GGI, а не просто запрет одновременных позиций поверх неверного stop.

## Вердикт

Вывод `2h сильнее 1h` нельзя переводить в `TF < 1h не работают`.

Текущие данные показывают:

- low-TF edge неоднороден по asset;
- ONDO 15m и BNB 3m положительны в frozen envelope;
- BTC 15m стабильно отрицателен в proxy replay несмотря на 80% dashboard WR;
- пользовательский BNB 5m dashboard выглядит сильным, но matching 5m CSV пока отсутствует;
- на малых TF gross edge может быть слишком мал после fees/slippage: особенно BNB 3m `~+0.048%` на сделку в среднем по grid;
- точное различие dashboard trades и raw labels требует восстановления eligibility/active-state accounting.

## Следующий тест

1. Получить maximum-length 5m CSV для BNB и ещё 3–4 crypto assets.
2. Для тех же asset получить Safe dashboard screenshot в тот же момент; желательно также Risk.
3. Заморозить low-TF группу отдельно: 15m/5m/3m, не смешивать с 1h/2h.
4. Добавить одну активную позицию и mode-specific acceptance в replay.
5. Сравнивать не только WR/counts, но gross expectancy, holding time, overlap и return per hour.
6. После gross проверки low-TF добавить комиссии/slippage раньше, чем для 2h: на 3m/5m издержки критичнее.
