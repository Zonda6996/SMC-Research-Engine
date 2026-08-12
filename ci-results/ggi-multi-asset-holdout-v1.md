# GGI multi-asset holdout v1 — frozen protocol

Дата анализа: 2026-08-03

## Краткий вывод

Новый независимый пакет из ETH, SOL, XRP, AAVE и BNB на 1h/2h не подтвердил прежний pooled fixed-horizon directional edge BTC/ONDO: направление BUY/SELL само по себе не дало положительного среднего результата на 6h/12h/24h/48h против matched-random контроля.

Однако заранее зафиксированный moving-management replay остался gross-положительным во всех 20 основных stop-first конфигурациях Safe/Risk × 5 stop-множителей × no-add/with-add. Это не сводится к одному активу: при исключении по очереди любого из пяти активов все конфигурации сохраняют положительный equal-dataset mean и PF > 1.

Главное ограничение результата — резкая асимметрия timeframe:

- **2h:** устойчиво положительный результат почти по всей сетке;
- **1h:** слабый и неоднородный результат, часто около нуля или ниже;
- **XRP 1h:** устойчиво отрицательный;
- **SOL 1h:** устойчиво положительный и является исключением среди 1h.

Поэтому корректный вердикт сейчас: **GGI ещё не доказан как готовая прибыльная система, но 2h moving-target management прошёл сильный gross holdout значительно лучше, чем ожидалось по fixed-horizon event study. 1h в целом пока не прошёл.**

## 1. Замороженный протокол

Holdout был запущен без подбора параметров по ETH/SOL/XRP/AAVE/BNB.

Зафиксированные правила:

```text
Entry: next-bar open
Safe stop: 8 / 10 / 12 / 14 / 16 × SMA(TrueRange,55)
Risk stop: 0.694 × соответствующий Safe stop
Add: 50% initial + 50% midpoint add
Partial: 25% active position на moving Mean
BE: blended average, активен со следующего бара после partial
Full target: moving opposite Inner
Intrabar ambiguity: stop-first и target-first
Costs: fees/funding/slippage исключены
```

Важно: сетка является sensitivity envelope, а не поиском лучшего множителя. Нельзя выбирать `16×TR55` только потому, что он оказался сильнее внутри этого holdout.

## 2. Данные

| Dataset | Bars | BUY | SELL | Labels |
|---|---:|---:|---:|---:|
| ETH 2h | 20,111 | 41 | 41 | 82 |
| ETH 1h | 22,701 | 43 | 50 | 93 |
| SOL 2h | 20,111 | 40 | 50 | 90 |
| SOL 1h | 22,701 | 50 | 50 | 100 |
| XRP 2h | 20,111 | 42 | 36 | 78 |
| XRP 1h | 22,701 | 49 | 39 | 88 |
| AAVE 2h | 20,111 | 51 | 43 | 94 |
| AAVE 1h | 22,701 | 53 | 54 | 107 |
| BNB 2h | 20,111 | 37 | 48 | 85 |
| BNB 1h | 22,701 | 39 | 53 | 92 |
| **Всего** | **214,060** | **445** | **464** | **909 raw labels / 908 replay trades** |

Разница между raw labels и replay trades связана с последним сигналом, для которого отсутствует пригодный next-bar entry/полный replay.

## 3. Signal-only event study

Это тест только BUY/SELL направления без stop и target. Измеряется direction-adjusted return от next-bar open через фиксированный горизонт.

### Pooled holdout

| Горизонт | N | Mean return | Positive rate | Matched-random mean | One-sided p для положительного edge |
|---|---:|---:|---:|---:|---:|
| 6h | 908 | -0.110% | 47.8% | -0.002% | 0.9385 |
| 12h | 908 | -0.111% | 48.2% | -0.001% | 0.8726 |
| 24h | 908 | -0.248% | 45.8% | +0.000% | 0.9600 |
| 48h | 907 | -0.060% | 48.3% | -0.006% | 0.6137 |

Вывод: прежние pooled BTC/ONDO результаты `+0.275%` на 12h и `+1.049%` на 48h **не реплицировались** на пяти новых активах.

### 48h по dataset

| Dataset | Mean return | One-sided p |
|---|---:|---:|
| ETH 2h | +0.036% | 0.466 |
| ETH 1h | -0.259% | 0.671 |
| SOL 2h | +1.006% | 0.087 |
| SOL 1h | +0.800% | 0.087 |
| XRP 2h | -1.027% | 0.942 |
| XRP 1h | -1.012% | 0.947 |
| AAVE 2h | -0.025% | 0.541 |
| AAVE 1h | -0.327% | 0.667 |
| BNB 2h | +0.287% | 0.237 |
| BNB 1h | -0.245% | 0.695 |

SOL выглядит наиболее перспективным, XRP — наиболее слабым. Но ни один отдельный результат нельзя использовать для нового post-hoc выбора активов без следующей независимой проверки.

## 4. Frozen moving-management envelope

Ниже приведён stop-first вариант. Target-first дал практически тот же итог: максимальная разница aggregate mean между порядками составила около `0.0059 п.п.`, максимальная разница одного dataset — около `0.0625 п.п.`. Следовательно, общий holdout-вывод не создан одной только OHLC intrabar неоднозначностью.

### 4.1 Pooled результаты по 908 replay trades

| Mode | Stop multiplier | Add | Equal-dataset mean | Trade-weighted mean | PF | Positive datasets / 10 |
|---|---:|---|---:|---:|---:|---:|
| Safe | 8.000 | no | +0.422% | +0.418% | 1.233 | 5 |
| Safe | 8.000 | yes | +0.242% | +0.242% | 1.185 | 6 |
| Risk | 5.552 | no | +0.209% | +0.198% | 1.100 | 7 |
| Risk | 5.552 | yes | +0.214% | +0.204% | 1.138 | 7 |
| Safe | 10.000 | no | +0.546% | +0.542% | 1.325 | 8 |
| Safe | 10.000 | yes | +0.231% | +0.234% | 1.195 | 6 |
| Risk | 6.940 | no | +0.306% | +0.300% | 1.157 | 5 |
| Risk | 6.940 | yes | +0.192% | +0.192% | 1.136 | 5 |
| Safe | 12.000 | no | +0.756% | +0.751% | 1.509 | 9 |
| Safe | 12.000 | yes | +0.354% | +0.352% | 1.340 | 6 |
| Risk | 8.328 | no | +0.425% | +0.420% | 1.235 | 5 |
| Risk | 8.328 | yes | +0.217% | +0.217% | 1.167 | 6 |
| Safe | 14.000 | no | +0.805% | +0.795% | 1.556 | 9 |
| Safe | 14.000 | yes | +0.315% | +0.312% | 1.314 | 6 |
| Risk | 9.716 | no | +0.512% | +0.509% | 1.299 | 8 |
| Risk | 9.716 | yes | +0.217% | +0.222% | 1.181 | 6 |
| Safe | 16.000 | no | +0.892% | +0.893% | 1.670 | 9 |
| Safe | 16.000 | yes | +0.314% | +0.316% | 1.348 | 7 |
| Risk | 11.104 | no | +0.623% | +0.622% | 1.388 | 8 |
| Risk | 11.104 | yes | +0.256% | +0.258% | 1.226 | 7 |

Факты, которые выдержали весь pooled envelope:

1. Все 20 основных конфигураций имеют положительный equal-dataset и trade-weighted mean.
2. Все 20 имеют pooled PF > 1.
3. No-add чаще имеет более высокий raw mean/PF; add улучшил одновременно mean и PF только на самом коротком `Risk 5.552`.
4. Это **не доказывает**, что add хуже: add-ветка держит только 50% позиции до adverse add, поэтому raw return сравнивает неодинаковую фактическую экспозицию. Нужна отдельная risk-normalized оценка.
5. Рост no-add результата при расширении stop требует проверки holding time, capital lock и overlap; выбирать широкий stop по этому holdout нельзя.

## 5. Ключевая асимметрия 2h против 1h

### 2h

- Все 20 aggregate 2h конфигураций положительны и имеют PF > 1.
- Из 100 ячеек `dataset × configuration` положительны 91.
- No-add Safe envelope:
  - equal-dataset mean: от `+0.947%` до `+1.393%`;
  - PF: от `1.496` до `1.905`.
- No-add Risk envelope:
  - equal-dataset mean: от `+0.592%` до `+1.169%`;
  - PF: от `1.261` до `1.672`.

### 1h

- Из 100 ячеек `dataset × configuration` положительны только 44.
- По строгому equal-dataset критерию положительны лишь 6 из 20 aggregate 1h конфигураций.
- No-add Safe envelope:
  - equal-dataset mean: от `-0.103%` до `+0.436%`;
  - PF: от `0.947` до `1.418`.
- No-add Risk envelope:
  - equal-dataset mean: от `-0.181%` до `+0.077%`;
  - PF: от `0.901` до `1.074`.
- Все Risk-with-add 1h aggregates имеют отрицательный equal-dataset mean и PF < 1.

Итог: общий pooled плюс нельзя трактовать как одинаково переносимый edge на обоих timeframe. Основное подтверждение сейчас относится к **2h**.

## 6. Устойчивость каждого dataset по frozen grid

В таблице показано, в скольких из 10 конфигураций одного add-режима dataset имел одновременно `mean > 0` и `PF > 1`.

| Dataset | No-add | With-add | Средний no-add return по grid | Средний with-add return по grid |
|---|---:|---:|---:|---:|
| ETH 2h | 10/10 | 10/10 | +1.158% | +0.466% |
| ETH 1h | 6/10 | 1/10 | +0.019% | -0.148% |
| SOL 2h | 10/10 | 9/10 | +1.152% | +0.662% |
| SOL 1h | 10/10 | 10/10 | +0.868% | +0.403% |
| XRP 2h | 7/10 | 5/10 | +0.361% | +0.011% |
| XRP 1h | 0/10 | 2/10 | -0.678% | -0.240% |
| AAVE 2h | 10/10 | 10/10 | +1.771% | +1.187% |
| AAVE 1h | 6/10 | 4/10 | +0.066% | -0.014% |
| BNB 2h | 10/10 | 10/10 | +0.898% | +0.505% |
| BNB 1h | 4/10 | 1/10 | -0.118% | -0.281% |

Сильные переносимые ячейки: ETH 2h, SOL 2h, SOL 1h, AAVE 2h, BNB 2h.

Слабые ячейки: XRP 1h, BNB 1h, ETH 1h с add. XRP 2h — пограничный, но не полностью провальный.

## 7. Representative Safe 12 no-add

`12×TR55` приведён только как центральная точка заранее заданной сетки, не как новая оценка private stop.

| Dataset | Trades | Mean | PF | Dashboard-like WR | Positive-PnL rate | Sequential DD | Full / Partial / Stop |
|---|---:|---:|---:|---:|---:|---:|---:|
| ETH 2h | 82 | +1.430% | 1.869 | 89.0% | 72.0% | -30.7% | 25 / 48 / 9 |
| ETH 1h | 92 | +0.134% | 1.094 | 84.8% | 66.3% | -46.1% | 20 / 58 / 13 |
| SOL 2h | 90 | +1.339% | 1.669 | 92.2% | 80.0% | -109.8% | 21 / 62 / 7 |
| SOL 1h | 100 | +1.103% | 2.188 | 95.0% | 72.0% | -29.4% | 23 / 72 / 5 |
| XRP 2h | 78 | +0.619% | 1.321 | 91.0% | 73.1% | -39.0% | 19 / 52 / 7 |
| XRP 1h | 88 | -0.668% | 0.604 | 87.5% | 63.6% | -88.0% | 12 / 65 / 11 |
| AAVE 2h | 94 | +2.246% | 2.902 | 94.7% | 74.5% | -34.7% | 20 / 69 / 4 |
| AAVE 1h | 107 | +0.218% | 1.154 | 91.6% | 61.7% | -61.9% | 15 / 83 / 9 |
| BNB 2h | 85 | +1.068% | 1.798 | 89.4% | 61.2% | -35.0% | 25 / 51 / 9 |
| BNB 1h | 92 | +0.074% | 1.054 | 87.0% | 65.2% | -52.9% | 22 / 58 / 12 |

XRP 1h демонстрирует, почему высокий dashboard-like WR не равен прибыльности: `87.5% WR`, но mean `-0.668%` и PF `0.604`.

## 8. Concentration и leave-one-asset-out

Для каждой из 20 stop-first конфигураций каждый актив по очереди исключался целиком вместе с 1h и 2h.

Результат:

- все `20 × 5 = 100` leave-one-asset-out агрегатов сохранили положительный equal-dataset mean;
- все 100 сохранили PF > 1;
- худший случай: `Risk 5.552 no-add` без SOL:
  - equal-dataset mean `+0.062%`;
  - trade-weighted mean `+0.045%`;
  - PF `1.022`;
- Safe 12 no-add без AAVE:
  - equal-dataset mean `+0.637%`;
  - PF `1.415`;
- Safe 12 no-add без SOL:
  - equal-dataset mean `+0.640%`;
  - PF `1.423`.

Следовательно, pooled плюс не объясняется только AAVE или только SOL. Но он всё ещё сильно зависит от присутствия 2h группы как класса: удаление всех 2h данных разрушает большую часть сетки.

Equal-asset weighting здесь совпадает с equal-dataset weighting, потому что каждый актив представлен ровно двумя dataset: 1h и 2h.

## 9. Почему fixed-horizon edge отрицательный, а moving management положительный

Это не логическое противоречие. Два теста отвечают на разные вопросы.

Fixed-horizon event study спрашивает:

> Выше или ниже цена через ровно 6/12/24/48 часов после сигнала?

Moving-management replay спрашивает:

> Коснулась ли траектория адаптивного Mean/Inner раньше, чем volatility stop, с partial и последующим BE?

Положительный management result при нулевом fixed-horizon drift возможен, если:

1. сигнал чаще даёт ранний favourable excursion, но к фиксированному горизонту движение откатывается;
2. moving Mean/Inner приближаются к цене и фиксируют path-dependent движение, которое теряется в endpoint return;
3. partial + BE создают асимметрию: много малых положительных/нулевых исходов и меньше полных stop;
4. 2h траектории работают лучше, а pooled fixed-horizon test разбавлен слабыми 1h и XRP;
5. широкий volatility stop разрешает долго ждать adaptive target.

Но остаются альтернативные объяснения, которые необходимо исключить до финального вывода:

- historical Apex lines или labels могут repaint; CSV не доказывает, что историческое значение линии было таким же в реальном времени;
- текущий replay разрешает независимую сделку на каждый label и не блокирует overlapping active positions;
- не измерены holding time, capital occupancy и return per unit time;
- sequential drawdown суммирует trade returns, но пока не является реалистичным portfolio equity;
- no-add и with-add имеют различную фактическую экспозицию и пока не приведены к одинаковому риску;
- stop — frozen robustness proxy, а не восстановленная private GGI формула;
- gross результат не включает fees, slippage и funding.

## 10. Исследовательский вердикт

### Что подтверждено

1. Первоначальный простой directional edge BTC/ONDO не перенёсся на пять новых активов как pooled fixed-horizon эффект.
2. Moving Mean/Inner management сохранил положительный pooled gross результат по всей заранее заданной stop-сетке.
3. Результат не исчезает при исключении одного любого актива.
4. 2h является устойчиво сильным timeframe в текущем holdout.
5. 1h в целом не подтверждён; SOL 1h — сильное исключение, XRP 1h — устойчивый провал.
6. Высокий dashboard-like win rate сам по себе не гарантирует положительное ожидание.
7. Midpoint add в raw-return сравнении обычно снижает mean/PF, но это ещё не честный risk-normalized verdict об add.

### Что пока нельзя утверждать

- нельзя утверждать, что GGI уже доказанно прибыльный net;
- нельзя выбирать `Safe 16` или конкретный актив по этому holdout;
- нельзя считать текущий proxy stop точной формулой автора;
- нельзя переносить 2h вывод автоматически на 1h/15m;
- нельзя считать overlapping per-signal replay готовой портфельной стратегией;
- нельзя добавлять комиссии и объявлять итог до проверки holding/overlap/repaint/risk normalization.

### Следующий обязательный шаг

Не нужен новый свободный подбор стопа. Следующий этап должен проверить достоверность именно management edge:

1. добавить holding time и time-in-market;
2. запустить non-overlap state machine: одна активная позиция на dataset/mode;
3. показать equal-risk результаты no-add и with-add;
4. проверить rolling/live snapshots Apex на repaint, если TradingView позволяет;
5. провести clustered bootstrap по времени и сигналам;
6. сохранить 2h как отдельную preregistered гипотезу для следующего holdout, а не смешивать её с 1h;
7. только после этого возвращать fees/slippage/funding.

## Артефакты

- Machine-readable result: `ci-results/ggi-multi-asset-holdout-v1.json`
- Frozen runner: `ci/research/runGgiHoldoutAuditV1.ts`
- Initial BTC/ONDO audit: `ci-results/ggi-signal-first-audit-v1.md/.json`
