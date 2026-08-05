# GGI signal-first audit v1

Дата: 2026-08-03

## Зачем изменён порядок исследования

Неудача попытки точно восстановить private Safe stop не является отрицательным verdict для BUY/SELL labels. Поэтому проверка разделена:

1. **Signal edge:** происходит ли после реального GGI label направленное движение лучше time-matched random-entry null.
2. **Management robustness:** остаётся ли gross expectancy положительным не в одной угаданной точке stop, а в заранее заданном диапазоне разумных volatility stops.
3. **Vendor fidelity:** точное восстановление private stop и BE остаётся отдельной задачей и не блокирует первые две.

## Данные и причинность

Использованы шесть длинных export:

| Dataset | Bars | Signals |
|---|---:|---:|
| BTC 2h | 8,822 | 42 |
| BTC 1h | 8,830 | 39 |
| BTC 15m | 20,527 | 85 |
| ONDO 2h | 11,070 | 46 |
| ONDO 1h | 16,920 | 81 |
| ONDO 15m | 14,672 | 62 |
| **Total** | **80,841** | **355** |

Правила:

- только реальные Shape0 BUY / Shape1 SELL;
- вход на следующем open;
- будущие Apex-значения не используются при входе или stop;
- fees, funding и slippage пока исключены;
- random null сохраняет dataset, число сигналов и фактические LONG/SHORT directions;
- 2,000 deterministic bootstrap replications.

## 1. Signal-only event study

Направленный return считается от next-bar open до close фиксированного горизонта, без stop и target.

| Horizon | N | Mean directional return | Positive | Random-null 5–95% | One-sided p |
|---|---:|---:|---:|---:|---:|
| 6h | 355 | +0.037% | 52.1% | -0.194% .. +0.189% | 0.372 |
| 12h | 355 | +0.275% | 56.3% | -0.258% .. +0.272% | 0.047 |
| 24h | 355 | +0.202% | 54.1% | -0.399% .. +0.350% | 0.169 |
| 48h | 354 | +1.049% | 56.8% | -0.538% .. +0.481% | 0.0005 |

### По dataset

Ключевой рисунок:

- BTC 2h: `+0.60%` at 24h (`p≈0.058`), `+0.92%` at 48h (`p≈0.030`);
- BTC 1h: слабый до 24h, `+0.66%` at 48h (`p≈0.070`);
- BTC 15m: `-0.18%` at 24h и `-0.14%` at 48h — directional edge не подтверждён;
- ONDO 2h: `+2.41%` at 48h (`p≈0.031`);
- ONDO 1h: `+0.84%` at 12h (`p≈0.027`), `+1.65%` at 48h (`p≈0.020`);
- ONDO 15m: смешанный результат, `+1.21%` at 48h (`p≈0.079`).

Это первая прямая положительная evidence для самих GGI labels, особенно на 2h/1h и горизонте около 48 часов. Она не универсальна: BTC 15m является явным отрицательным control внутри тех же реальных labels.

## 2. Stop robustness — не одна угаданная формула

Замороженная до запуска сетка:

```text
Safe stop = 8 / 10 / 12 / 14 / 16 × SMA(TrueRange,55)
Risk stop = 0.694 × соответствующий Safe stop
Add = midpoint(entry, stop)
Partial = 25% active position at moving Mean
BE = blended average, active from next bar
Full = moving opposite Inner
```

Проверены:

- no-add: полная позиция с entry;
- with-add: 50% initial + 50% midpoint add;
- stop-first и target-first OHLC boundary.

В этой сетке intrabar order не изменил результаты: конфликтующие target/stop events не оказались источником итоговой устойчивости.

### Aggregate по 355 signals

| Mode | Stop multiplier | Add | Vendor WR | Mean gross return / signal | PF | Positive PnL |
|---|---:|---|---:|---:|---:|---:|
| Safe | 8 | no | 84.5% | +0.583% | 1.49 | 70.1% |
| Safe | 8 | yes | 84.5% | +0.349% | 1.40 | 78.0% |
| Safe | 10 | no | 89.9% | +0.815% | 1.84 | 70.7% |
| Safe | 10 | yes | 89.9% | +0.493% | 1.71 | 78.3% |
| Safe | 12 | no | 91.5% | +0.883% | 1.98 | 70.7% |
| Safe | 12 | yes | 91.5% | +0.385% | 1.61 | 77.5% |
| Safe | 14 | no | 93.5% | +0.944% | 2.12 | 70.7% |
| Safe | 14 | yes | 93.5% | +0.436% | 1.76 | 76.3% |
| Safe | 16 | no | 94.4% | +0.907% | 2.03 | 70.7% |
| Safe | 16 | yes | 94.4% | +0.493% | 1.82 | 74.1% |
| Risk | 5.552 | no | 75.8% | +0.559% | 1.46 | 69.0% |
| Risk | 5.552 | yes | 75.8% | +0.462% | 1.51 | 74.1% |
| Risk | 6.94 | no | 81.1% | +0.534% | 1.43 | 70.1% |
| Risk | 6.94 | yes | 81.1% | +0.275% | 1.30 | 77.5% |
| Risk | 8.328 | no | 84.5% | +0.536% | 1.43 | 70.1% |
| Risk | 8.328 | yes | 84.5% | +0.276% | 1.30 | 77.5% |
| Risk | 9.716 | no | 89.3% | +0.822% | 1.85 | 70.7% |
| Risk | 9.716 | yes | 89.3% | +0.501% | 1.73 | 79.2% |
| Risk | 11.104 | no | 91.0% | +0.903% | 2.02 | 70.7% |
| Risk | 11.104 | yes | 91.0% | +0.438% | 1.71 | 78.3% |

Все 20 preregistered mode/stop/add combinations имеют положительную pooled gross expectancy и PF > 1. Это существенно сильнее, чем одна подогнанная stop-точка.

## 3. Но результат неоднороден

Representative `Safe 12 × TR55`:

| Dataset | No-add mean | No-add PF | With-add mean | With-add PF |
|---|---:|---:|---:|---:|
| BTC 2h | +0.843% | 2.10 | +0.440% | 1.81 |
| BTC 1h | -0.121% | 0.87 | -0.239% | 0.65 |
| BTC 15m | -0.075% | 0.85 | -0.106% | 0.70 |
| ONDO 2h | +2.634% | 2.22 | +1.203% | 1.79 |
| ONDO 1h | +1.540% | 2.48 | +0.648% | 1.91 |
| ONDO 15m | +0.700% | 2.71 | +0.465% | 2.77 |

Следовательно:

- pooled result не означает, что GGI прибыльный на каждом активе и timeframe;
- основная сила текущего sample находится в ONDO и BTC 2h;
- BTC 15m остаётся слабым при высоком dashboard-style WR;
- высокий WR сам по себе действительно недостаточен;
- add повышает долю положительных PnL outcomes, но в этом gross model снижает mean return/PF, потому что увеличивает экспозицию на adverse excursion. Его нельзя автоматически считать улучшением.

## 4. Ограничения

1. В данных пока только два основных crypto assets с длинной историей: BTC и ONDO. Это 355 signals, но кластеризация по asset/timeframe сильная.
2. Stop grid является robustness envelope, а не private GGI formula.
3. Exact BE/dashboard taxonomy ещё не восстановлена.
4. Moving bands могут быть path-sensitive; replay causal, но vendor state machine может отличаться.
5. Нет fees/funding/slippage.
6. Return измеряется как процент nominal position; сравнивать стратегии с разными stop distances также нужно в risk-normalized R.
7. Overlapping fixed-horizon returns не являются независимыми наблюдениями; bootstrap здесь random-entry benchmark, не окончательная confidence interval для live expectancy.

## Verdict

Текущий результат **не поддерживает вывод «стоп не повторили — значит индикатор плохой»**.

Более точный verdict:

- у реальных GGI labels есть предварительная направленная evidence, особенно на 2h/1h и 48h;
- gross management остаётся положительным по широкой preregistered stop-сетке на pooled sample;
- edge неоднороден и не подтверждается на BTC 15m;
- exact stop нужен для fidelity и окончательной оценки, но уже не нужен, чтобы утверждать, что исследование имеет рациональный шанс на успех;
- вероятность успеха нельзя честно выразить одним числом до multi-asset holdout. На текущем этапе статус — **promising but not validated**.

## Следующий решающий тест

1. Добавить длинные exact exports ещё минимум для 4–6 активов, предпочтительно 2h и 1h, с 50+ labels на dataset.
2. Заморозить management envelope из этого отчёта; не выбирать лучший multiplier по новым данным.
3. Для каждого нового asset/timeframe посчитать signal-only event study и management PF/expectancy.
4. Критерий продолжения: положительный 48h directional return и PF > 1 на большинстве holdout datasets, без зависимости от одной монеты.
5. Параллельно продолжать stop/BE reconstruction, но не использовать его для блокировки holdout-проверки сигналов.
