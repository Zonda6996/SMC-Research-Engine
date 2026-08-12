# Передача проекта: Zonda Reversal + Apex

**Назначение:** единая самодостаточная точка входа после очистки `docs/`.  
**Главная цель:** не копировать красивую витрину вендора, а повысить реальную чистую прибыльность Zonda Reversal + Apex и доказать её на невиданных данных.

## 0. Profitability cycle: frozen baseline → breadth → hypothesis

### Протокол

До запуска были известны только SOL runtime totals/WR; cross-asset net expectancy не измерялся. Зафиксированы HEAD `609ecfee2496f7b5083be7578857ac959943d63d`, Apex `apex-1.2-cross-oos-sigma-4`, OWN2 `signal-arrows-1.0-own2-extension`, replay `signal-arrows-replay-1.2-geo4-moving-close` и неизменённые Safe/Risk/Standard configs. Universe: Binance USDT-M futures cache, SOL/BTC/ETH/XRP/BNB × 30m/1h/2h, 20k bars на серию. Split: первые 65% календарного span каждой asset/TF — train, последние 35% — OOS; точные границы сохранены в JSON.

Cost canon: BingX VIP0 taker 5 bps + slippage 2 bps = 7 bps на каждую исполненную сторону; `costR = turnoverNotional × 0.0007 / oneR`. Gross служит sensitivity без costs. Funding в локальных OHLCV отсутствует и не выдумывался. Terminal Full/Partial/Stop взаимоисключающие; Open/Timeout отдельно. Correlation proxy: same-side 4h timestamp clusters. CI: deterministic trade-level bootstrap, 2,000 resamples, seed `20260807`; cluster count показывается отдельно, потому что bootstrap не снимает корреляцию.

Артефакты:

```bash
npx tsx temp/run-zonda-profitability-cycle.ts
node temp/summarize-zonda-cycle.cjs
```

Полный результат: `temp/zonda-profitability-cycle.json`; runner/preregistration: `temp/run-zonda-profitability-cycle.ts`.

### Frozen baseline aggregate

`F/P/S` = Full / terminal Partial / Stop. Gross mean без costs; остальные R после costs.

| Mode | Split | N | Finalized | F/P/S | Open/TO | Gross mean | Net mean | 95% CI | Net total | PF | Max DD | Hold mean/median | /month | Clusters | vendor WR |
|---|---|---:|---:|---|---|---:|---:|---|---:|---:|---:|---|---:|---:|---:|
| Safe | train | 807 | 807 | 294/358/155 | 0/0 | -0.089 | -0.104 | [-0.149,-0.056] | -83.54 | 0.670 | 86.12 | 140.7/101 | 16.36 | 589 | 80.8% |
| Safe | OOS | 404 | 398 | 151/182/65 | 6/0 | -0.049 | -0.063 | [-0.130,0.003] | -25.49 | 0.779 | 38.38 | 144.9/107 | 21.71 | 247 | 83.7% |
| Risk | train | 900 | 900 | 326/308/266 | 0/0 | -0.104 | -0.126 | [-0.181,-0.067] | -113.42 | 0.722 | 118.78 | 125.5/88 | 18.25 | 645 | 70.4% |
| Risk | OOS | 428 | 422 | 178/130/114 | 6/0 | +0.006 | -0.016 | [-0.100,0.072] | -6.97 | 0.961 | 32.11 | 137.7/106.5 | 22.91 | 251 | 73.0% |
| Standard | train | 757 | 757 | 344/0/413 | 0/0 | -0.014 | -0.036 | [-0.120,0.048] | -27.01 | 0.936 | 67.32 | 168.9/99 | 15.35 | 561 | 45.4% |
| Standard | OOS | 330 | 322 | 153/0/169 | 7/1 | +0.039 | +0.017 | [-0.105,0.133] | +5.64 | 1.032 | 33.51 | 196.2/131.5 | 17.66 | 214 | 47.5% |

Median net R OOS: Safe `+0.015`, Risk `+0.017`, Standard `-1.008`; positive-rate `55.2%/51.9%/48.2%`. Costs переводят Risk из gross `+0.006R` в net `-0.016R`.

### Breadth

| Mode | Worst asset | Worst TF | Worst side |
|---|---|---|---|
| Safe | BNB n=68, -0.145R | 2h n=171, -0.101R | long n=230, -0.157R |
| Risk | ETH n=101, -0.166R | 1h n=157, -0.050R | long n=245, -0.147R |
| Standard | BNB n=56, -0.222R | 1h n=117, -0.035R | long n=189, -0.128R |

Результат не держится на SOL: Safe SOL OOS `-0.034R`, Risk SOL `-0.064R`. Плюс концентрируется в XRP и short: Risk XRP `+0.207R`, но ETH `-0.166R`; long `-0.147R`, short `+0.159R`. OOS trades/clusters лишь `404/247`, `428/251`, `330/214`: много сигналов относятся к общим движениям.

### Preregistered hypothesis

До расчёта допущена одна сопоставимая гипотеза без grid search: **H1 Apex contraction/regime**, existing G2 score `>=3/4` (failed continuation 8 bars; direction-adjusted Mean slope за 8 bars `>-0.25` среднего TR; range последних 8 bars меньше предыдущих 8; directional signal candle).

Fresh non-top 4h sweep заблокирован: доступная causal реализация использует STATIC2/FROZEN и несопоставима с current management. HTF/Fibonacci/POI заблокирован: нет валидированного causal adapter к current OWN2 runtime. Результаты не склеивались.

| H1 mode | Train n/mean | OOS n/mean | OOS 95% CI | PF | Total | Clusters | Decision |
|---|---|---|---|---:|---:|---:|---|
| Safe | 392 / -0.067R | 185 / -0.040R | [-0.133,0.056] | 0.858 | -7.36R | 122 | CLOSE |
| Risk | 409 / -0.129R | 186 / +0.076R | [-0.054,0.217] | 1.209 | +14.19R | 120 | HOLD |
| Standard | 356 / +0.024R | 168 / -0.049R | [-0.212,0.115] | 0.909 | -8.29R | 111 | CLOSE |

H1 Risk имеет OOS point estimate выше +0.05R и все asset means положительны (SOL +0.086, BTC +0.092, ETH +0.016, XRP +0.176, BNB +0.024), но train отрицателен, CI включает ноль, long остаётся отрицательным (`-0.034R`, short `+0.236R`). Это sign flip, не доказанное улучшение.

### Before → current / verdict

| State | Measurement | Decision |
|---|---|---|
| Before | SOL counts/WR; net breadth unknown | WR не считать edge |
| Current baseline | Safe -0.063R, Risk -0.016R, Standard +0.017R OOS; concentration | **CLOSE как trading edge**; runtime оставить frozen |
| Current H1 Risk | +0.076R OOS, но train -0.129R, CI через 0, long < 0 | **HOLD**, не production |
| H2/H3 | execution/data incompatibility | BLOCKED |

**Общий вердикт: HOLD research / NO-GO production.** Высокий vendor-style WR не компенсирует отрицательный expectancy.

**Следующий один шаг:** заморозить ровно H1 Risk как research-only candidate и собрать новый untouched paper-forward до 200 finalized trades с funding, cluster-equal метрикой и отдельным long/short gate; не менять score/parameters до checkpoint.

## 1. Почему возникло ощущение «что-то не то»

В интерфейсе одновременно смешались три разные вещи:

1. реконструированный сигнал OWN2 показывался рядом с цифрами вендора как будто это один и тот же генератор;
2. текущие moving-уровни Mean/Inner отображались как уже исполненные Partial/Full;
3. старый счётчик Partial был накопительным, тогда как vendor-style таблица использует взаимоисключающие terminal outcomes.

Из-за этого график выглядел убедительнее, чем позволяли данные, а высокий WR маскировал слабую экономику: Partial считался победой, хотя его вклад в R может быть мал или равен BE. Это была прежде всего проблема достоверности измерения и отображения, а не доказательство, что пороги OWN2 или формула Apex неверны.

## 2. Что именно реконструировано

### Apex

Apex — пять moving-рядов: Upper/Lower Outer, Upper/Lower Inner и Mean. Текущая причинная аппроксимация:

```text
mean  = ALMA(hlc3, 200, 0.85, 6)
s     = ALMA(trueRange / close, 122, 0.625, 4)
inner = mean × exp(±5.6 × s)
outer = mean × exp(±9.6 × s)
```

Версия `apex-1.2-cross-oos-sigma-4` переносилась на holdout лучше sigma 3.5; mean MAE был примерно 0.068–0.604%, width MAE — около 1.55–2.13% на разных holdout. Это подтверждает геометрическую близость, но **не точную приватную формулу и не прибыльность**. В последнем runtime bugfix-pass формула Apex не менялась.

### Reversal / OWN2

Zonda Reversal — наша реализация редких разворотных стрелок. Runtime сейчас использует OWN2 extension metrics и direction filters, а не старое правило «Outer touch → следующая противоположная свеча». OWN2 ранее объяснял около 71.7% vendor arrows на точных vendor bands; это реконструкция, не exact replica. Пороги OWN2 в исправлении runtime не менялись.

По GGI/vendor установлено: `Shape 0 = BUY`, `Shape 1 = SELL`; Safe и Risk используют общий поток labels, а различия статистики в основном создаёт management. Standard похож на отдельный stateful acceptance gate. Подтверждены приближённые геометрические отношения:

```text
RiskDistance ≈ 0.694 × SafeDistance
Add ≈ midpoint(Entry, Stop)
Standard target ≈ 1.14R без add и ≈ 2R после равного 50/50 add
```

Базовый кандидат `SafeDistance ≈ 12.3 × SMA(TrueRange,55)` провалил независимую валидацию (ошибки доходили примерно до +33.6%) и не является private formula. Лучший простой modifier улучшил validation MAE лишь на 3.12% и также не валидирован.

## 3. Что исправлено в runtime, UI и statistics

- DTO разделён на:
  - `eventPrices.partial/full` — только реально случившиеся события;
  - `currentLevels.mean/oppositeInner/staticFull` — текущие management-уровни;
  - `trajectory[]` — moving Mean и opposite Inner бар за баром.
- Убран ложный fallback `partial <- signal.mean`.
- Safe/Risk Partial фиксируется только при фактическом wick-touch moving Mean.
- Safe/Risk Full фиксируется только при close beyond moving opposite Inner; точная vendor inclusive/exclusive граница пока не доказана.
- UI рисует фактические Partial/Full маркеры только из точных `events[].at` и `events[].price`; отсутствующее событие не подменяется текущим уровнем.
- Static scalar Partial/Full для moving Safe/Risk не возвращались; Standard остался в static-ветке.
- Terminal taxonomy теперь взаимоисключающая: `Partial | Stop | Full`; `Open` и `Timeout` отдельно.
- Vendor-style WR считается как `(Partial + Full) / (Partial + Stop + Full)`; при пустом знаменателе — 0% и на сервере, и в клиенте.
- В payload добавлена bar-by-bar диагностика OWN2: accepted/rejected, первая причина отказа, side, OHLC-derived metrics, Mean/Inner/Outer, ATR, RV, distance, penetration и агрегат `diagnosticReport.byReason`.
- Исправления покрыты focused-тестами event/current/trajectory semantics, close-beyond Full, marker fallback, diagnostics и fixture guard.

Остаётся реконструкцией: BE timing/price, порядок событий внутри OHLC-бара, strict/inclusive Full и связь research replay с runtime replay.

## 4. Текущие фактические SOL результаты

Текущий runtime на имеющихся SOL сериях показывает:

| TF | Signals | Full | terminal Partial | Stop | Open | WR |
|---|---:|---:|---:|---:|---:|---:|
| 30m | 75 | 28 | 38 | 8 | 1 | 89.2% |
| 1h | 90 | 33 | 45 | 11 | 1 | 87.6% |

Это внутренне согласованные **current runtime** итоги после исправления taxonomy. Они не доказывают vendor parity и сами по себе не доказывают положительный expectancy.

Исторические скриншоты давали ориентиры: vendor SOL 30m — 89 trades / 30 Partial / 9 Stop / 50 Full / 89.9% WR; vendor 1h — 90 / 29 / 8 / 53 / 91.1%. Старые наши числа были посчитаны с иной, накопительной Partial-семантикой и напрямую несопоставимы.

Exact comparison сейчас ограничен: отсутствуют vendor SOL 30m/1h CSV, exact arrow timestamps, точные окна, timezone/source candles и bar-level terminal labels. Сравнивать только totals нельзя: одинаковые totals могут состоять из совершенно разных баров. До получения golden-разметки запрещено менять OWN2/Apex ради совпадения агрегатов.

## 5. Важное отрицательное знание

### Reversal V1–V7

Не переоткрывать без нового observable information set:

- per-bar directional/Inner/RSI/distance baselines имели высокую полноту только ценой precision порядка единиц процента;
- V1 bounded state machine провалил holdout;
- V2 long-memory episode: sealed F1 упал примерно 12.77% → 3.70%;
- V3 recovery grammar: 16.39% → 5.48%;
- V4 global cooldown был лучшим из отвергнутых, но sealed F1 упал 21.92% → 7.69%;
- V5 OHLC fear/greed и V6 volume-aware score не пережили sealed/OOS;
- V7/V7′ episode-age + recovery/extremum/spacing дал лучший mean validation F1 лишь 3.03%; финальный sealed/holdout намеренно не открывался;
- ни один из 370 canonical labels не имел current/previous Outer touch;
- centered/backplotted pivots, Gemini EMA100/ATR100, duplicate non-overlap и повторный свободный ATR-grid отвергнуты.

V7 дал полезную отрицательную границу: episode grammar находит **регионы**, но не exact emission bar. Hazard peaks не совпадают в барах между TF, зато примерно сходятся во wall-clock; cross-TF same-direction labels кластеризовались выше случайного, но последующий H2/H3 аудит должен рассматриваться как проверка, а не доказательство hidden HTF state.

### Exact-bar information limit

Семь causal single-TF семейств на OHLC+bands воспроизводили частоту/области, но не точный бар. Наиболее вероятно, exact bar зависит от скрытого internal series, HTF/stateful condition или intrabar information, которых нет в текущем export. Новый перебор грамматик на том же information set имеет низкую ожидаемую ценность. Нужен новый различающий экспорт либо честный verdict «неидентифицируемо».

### FROZEN / IMP2

Исторически единственный прибыльный кандидат IMP2/RELAXED был:

```text
OWN2 на 1h/2h
+ 4h liquidity pool rank < 2/3
+ pool swept не более 48h назад
+ entry в пределах ±25% ширины полосы
+ STATIC2: TP 2×step, stop 2×step, без partial/add
```

Он дал около `+0.18R train / +0.26R holdout`, но всего 26 сделок на 16 монетах. Голый сигнал был около нуля, просто «у пула» — около `−0.08R`; активный кандидат — свежий sweep нетопового пула. IMP1 показал, что 10 вариантов exit-management двигали результат лишь примерно на 0.04R: менеджмент не был сильным рычагом.

FROZEN-1 фиксировал OWN2 1h/2h, тот же 4h-контекст, STATIC2, 14-day timeout и реальные BingX VIP0 costs/funding. Менять его параметры после открытия breadth нельзя: изменение создаёт FROZEN-2 и сжигает старый holdout.

### BREADTH1 frequency mismatch

IMP2 пропускал около 26/711 сигналов (~4%, примерно одна сделка в месяц на корзину 28 монет), тогда как BREADTH1 получил 2175 сделок на 19 монетах за 2.5 года (~4 в месяц **на монету**). Расхождение примерно на два порядка означает вероятную несовместимость фильтров/реализации. Пока не доказана одинаковая стратегия по trade-level JSON, verdict BREADTH1 относится к другой реализации и статус FROZEN-1 — `INCOMPLETE`, а не PASS/FAIL. Это QA реализации, не повод тюнить пороги.

## 6. Cross-asset warning

Нельзя выбирать актив, TF или сторону после просмотра результата. BTC 15m, SOL 1h и другие отдельные серии могут вести себя противоположно; положительный aggregate может держаться на одном режиме рынка или коррелированном обвале. Один рыночный импульс, создавший 15 алертов, — примерно одно наблюдение, а не 15 независимых подтверждений.

Любая прибыльная версия должна заранее фиксировать universe, costs, side/TF, clustering, entry/exit и затем пройти asset/time OOS. Vendor fidelity, высокий WR и визуальная похожесть не заменяют cross-asset net expectancy.

## 7. Дорожная карта

### Фаза 0 — доверие к измерению (текущая)

Цель: доказать корректность runtime replay/UI/statistics без изменения торговой идеи.

**GO:** event markers совпадают с replay; terminal categories взаимоисключающие; counts воспроизводимы; нет fallback текущих уровней в события; tests/typecheck проходят.  
**STOP:** хотя бы один bar-level mismatch, скрытая смена семантики или различие server/client WR.

### Фаза 1 — golden parity и диагностика

Для SOL 30m и 1h получить точные vendor окна/CSV/timestamps и вручную разметить `bar + side + terminal outcome`; join с OWN2 diagnostics. Разнести mismatch на FN, FP, side mismatch и occupancy/replay mismatch.

**GO:** повторяемый класс mismatch объяснён causal полем и исправление улучшает обе golden-серии без деградации второй.  
**STOP:** есть только aggregate fit, один скриншот или post-hoc threshold.  
**Важно:** parity оценивается precision/recall/timing, не PnL.

### Фаза 2 — baseline profitability

Заморозить текущий causal runtime baseline и считать expectancy/R, PF, max drawdown, costs, funding, adverse same-bar ordering и trade clusters по заранее заданным asset/time splits.

**GO:** net expectancy > 0 и PF > 1 на frozen OOS, результат не зависит от одного актива/стороны/кластера и переживает разумную cost sensitivity.  
**STOP:** только высокий WR, gross-only плюс, один удачный asset/TF или выбор лучшей конфигурации по holdout.

### Фаза 3 — только 2–3 заранее заданные edge-гипотезы

После baseline выбрать максимум три механистические гипотезы, например:

1. свежий sweep нетопового 4h liquidity pool;
2. causal regime/slope/contraction guard;
3. absorption proxy, только если доступен достаточный volume/orderflow observable.

Для каждой заранее: механизм, данные, одна primary metric, малый search space, negative control и kill criterion. Не использовать устаревший `EDGE_HYPOTHESES.md` как готовую спецификацию.

**GO:** одна гипотеза улучшает development и заранее назначенную validation без развала частоты/сторон.  
**STOP:** свободный feature grid, выбор победителя после просмотра OOS или улучшение только WR.

### Фаза 4 — frozen OOS

Зафиксировать код, параметры, universe, costs и hash артефактов; один раз открыть unseen period/assets.

**GO:** заранее заданные net expectancy/PF/drawdown/frequency gates выполнены, нет критичного cross-asset collapse.  
**STOP:** любое изменение после открытия OOS, включая «малую» правку фильтра; новая версия требует нового holdout.

### Фаза 5 — paper-forward

Запустить алерты без реальных ордеров и вести immutable ledger: signal-time inputs, intended fill, actual observable fill proxy, funding, slippage, outcome и runtime/version hash.

**GO:** достаточная заранее заданная выборка подтверждает ожидаемую частоту и net edge в допустимом доверительном диапазоне.  
**STOP:** drift сигналов/частоты, невоспроизводимые fills, drawdown breach или расхождение paper с frozen replay.

## 8. Жёсткое разделение целей

Никогда не смешивать:

- **vendor parity:** совпадают ли arrow timestamps/directions/state;
- **profitability:** зарабатывает ли causal стратегия после costs на OOS.

Можно точно скопировать убыточный индикатор и можно построить прибыльную стратегию, не совпадающую с вендором. Изменение ради parity не получает торговый статус; изменение ради PnL не объявляется реконструкцией private formula. Для каждой ветки исследования — отдельные метрики, артефакты и решение GO/STOP.

## 9. Карта кода и артефактов

```text
src/core/signals/ApexEngine.ts                 production Apex approximation и runtime Reversal baseline
src/core/signals/Reversal*Research.ts          отвергнутые research-only causal families
src/core/analysis/ZondaEdgeFeatures.ts         causal research features
ci/research/runOwn2ExtensionTrigger.ts         OWN2 extension reconstruction
ci/research/runImp2ContextSelection.ts         IMP2 liquidity-context candidate
ci/research/runImp3LtfHtfSelection.ts          LTF/HTF negative result
ci/research/runGeo3StepCalibration.ts          trade-step calibration
ci/research/runGeo4CalibratedEconomics.ts      calibrated vendor economics
ci/research/runGeo5VendorCsvReplay.ts          replay на vendor CSV
ci/research/lib/exactIndicatorExport.ts        exact CSV parsing/integrity
ci/research/lib/eventMetrics.ts                one-to-one directional matching
data/vendor-exports/                           canonical exact Reversal corpus
ci-results/                                    machine-readable результаты и отчёты
tools/visualizer/                              inspection UI, не execution engine
SPEC.md                                        корневая спецификация; не заменена этим handoff
```

Канонический исторический Reversal corpus: 86,420 строк, 370 labels (211 BUY, 159 SELL) на BTC development и ETH/SOL/BTC-TF holdouts. SOL Spot не смешивать с Futures aggregate.

## 10. Рабочие команды

```bash
npm test
npx tsc --noEmit --pretty false
npm run research:integrity
npm run viz
node --check tools/visualizer/public/*.mjs tools/visualizer/public/{lib,panels}/*.mjs
npx tsx --test tests/arrowSignalEngine.test.ts tests/arrowTradeReplay.test.ts tests/arrowResearchParity.test.ts tests/visualizerSignalArrows.test.ts tests/indicatorTimeframeRouting.test.ts
```

`research:integrity` проверяет hashes/schema/chronology/counts и Apex OOS regression. После изменения moving trade semantics обязательно прогонять focused arrow/replay/UI tests, затем полный gate.

## 11. Следующее конкретное действие

**Не менять формулы.** Сначала создать два golden fixtures для SOL 30m и SOL 1h:

1. зафиксировать symbol/feed, timezone, точный start/end и vendor settings со скриншотов;
2. получить vendor CSV либо вручную выписать каждый arrow `timestamp, side` и terminal `Partial|Stop|Full`;
3. экспортировать runtime diagnostics на тех же свечах;
4. сделать one-to-one join по exact bar+side;
5. сохранить четыре таблицы mismatch: FN, FP, side, replay/occupancy;
6. только после отчёта выбрать **один** повторяемый mismatch-класс для causal исправления и закрепить его golden-тестом.

Если exact timestamps получить нельзя, зафиксировать `INFORMATION LIMIT` и перейти к Фазе 2 с текущим OWN2 как независимым baseline — без попытки подогнать totals к скриншотам.

## 12. Временный файл edge-гипотез

`docs/EDGE_HYPOTHESES.md` сохранён по явному решению пользователя, но устарел: он описывает старую модель `Outer touch + next/opposite candle`, тогда как runtime использует OWN2 extension metrics и direction filters. Файл нельзя считать актуальной спецификацией; перед Фазой 3 его нужно переписать под текущий runtime, preregistration и frozen/OOS правила.

## 13. Сохранённый legacy-контекст платформы

Корневой `SPEC.md` остаётся нормативом для SMC-пайплайна. Критичные исторические уроки из удаляемого архива:

- проект — исследовательская платформа, не торговый бот; правила SMC нельзя додумывать без решения владельца;
- вычисления живут в чистом `runAnalysis(candles)`, I/O — отдельно; базовая цепочка: candles → pivots → swings → structure → market/legs → BOS/CHoCH → Fib;
- реальные дефекты уже включали невызываемый `MarketStructureEngine.update()`, устаревшие импорты после перемещения файлов, protected levels, look-ahead в BOS/CHoCH и молчащий в тренде `StructuralLegEngine`; поэтому typecheck недостаточен — нужны synthetic/regression tests;
- structural breach подтверждается двумя последовательными close за уровнем; wick сам по себе не breach;
- визуальный чек-лист BOS/CHoCH/Fib требовал смотреть сетапы подряд, без выбора «красивых», минимум 20 на блок, отдельно оценивать structure, impulse, timing и решение трейдера. Несогласие со структурой около 30% означало «чинить detector»; честная разметка при убытке означала отсутствие edge без фильтра, а не UI-баг.

Этот legacy-контекст не должен отвлекать текущий цикл Zonda от фаз 0–5 выше.

## 14. Правила работы

- Сначала данные и тест, затем интерпретация.
- Не придумывать числовые правила и не чинить смысловую неопределённость молча.
- Только causal features `<= current bar`; запрещены future pivots/outcomes/backplotting.
- UI, production, research и docs не смешивать в один логический change set.
- Failed result сохранять как отрицательное знание.
- Не удалять и не менять `SPEC.md` в рамках docs-cleanup.
- Визуализатор остаётся тёмным shadcn/Vercel/Geist UI; не возвращать альтернативные skins и не менять engine defaults ради картинки.
## Как реально проходит сделка

Источник истины: `src/core/signals/ArrowTradeReplay.ts` и `tests/arrowTradeReplay.test.ts`.

1. OWN2 принимает сигнал на закрытом signal bar, но entry = **open следующей свечи**, не signal close. `ATR200` Wilder/RMA фиксируется на signal bar. `stepSafe=5.5×ATR200`; Risk делит step на 1.43, Standard — на 1.17.
2. LONG: add=`entry-step`, SHORT зеркально; add добавляет одну исходную долю. Stop: Safe/Risk `2 step`, Standard `1.75 step`. `1R=2×|(entry+add)/2-stop|`, то есть риск полностью набранных двух долей; add-filled stop=`-1R`.
3. В каждом OHLC-баре порядок жёсткий: **add → stop → Partial → BE → Full**; same-bar stop+target всегда stop. Entry-бар тоже проверяется. Уровни исполняются ровно по level: отдельной gap-модели нет, поэтому gap через add/stop/target не ухудшает fill.
4. Safe/Risk: Mean и opposite Inner обновляются каждый бар. Partial срабатывает по favorable wick к moving Mean и закрывает 25% текущего веса (0.25 до add или 0.5 после add). BE не включается сразу: после Partial moving Mean должен перейти за текущий averageEntry в неблагоприятную сторону, затем favorable wick должен достичь averageEntry; остаток закрывается по averageEntry. До этого исходный stop активен. Full возможен без Partial, но только если close `>=` moving upper Inner для LONG / `<=` moving lower Inner для SHORT; fill записывается по Inner.
5. Standard: Partial/BE нет; moving Mean/Inner не участвуют. Static Full=`entry±2 step`, trigger — wick touch.
6. Timeout — 2000 holding bars с выходом по close последнего разрешённого бара. Если данных меньше, outcome=`open`, mark — последний close. После exit mode-slot блокируется до `exitIndex+3` включительно.
7. Costs — 7 bps на каждую реально исполненную сторону по turnover entry/add/partial/exit. Funding отсутствует в OHLCV cache и не выдумывается; сверх включённых 2 bps slippage отдельной модели нет.

**R/PnL audit.** Ручные cases покрывают add-stop, Partial→BE/Stop/Full, Full без Partial, Standard TP/stop и same-bar ambiguity. Side signs зеркальны через `directionalPnl`. Найден и исправлен production bug: при Partial **до** add код ошибочно ставил 50/50 average `(entry+add)/2`, хотя после продажи 25% оставались 0.75 исходной доли и добавлялась 1 новая. Теперь basis считается `(oldAverage×oldWeight+add)/(oldWeight+1)`; regression сверяет cash ledger. Это меняет экономику редкой последовательности, не taxonomy.

Важное расхождение с историческим описанием: «no-add stop = -2/3R» — только контрфактическая геометрия. В текущей level-fill OHLC модели stop расположен за add и add проверяется первым, поэтому terminal stop всегда сначала заполняет add. Неподтверждёнными остаются exact vendor BE и strict/inclusive boundary; adverse-first — намеренно консервативное допущение, level fills при gaps — оптимистичное.

## Было → стало: static vs dynamic

Audit-only runner/result: `temp/audit-static-vs-dynamic.ts`, `temp/static-vs-dynamic-audit.json`. Один протокол: Binance USDT-M cache; SOL/BTC/ETH/XRP/BNB × 30m/1h/2h × 20k bars; chronological 65/35 каждой серии; одинаковые raw OWN2 candidates, geometry, add/stop/BE/timeout/gate; 7 bps/side; funding omitted; no tuning.

Текущий replay не tracked в git, поэтому exact старый checkout невозможен. BEFORE восстановлен по DM3 artifacts: signal-bar static Mean Partial по wick + signal-bar static opposite Inner Full по wick. Отдельно проверен реально существовавший intermediate: moving Mean Partial + moving opposite Inner Full по wick. AFTER: moving Mean Partial + Full только по close beyond moving opposite Inner. Standard одинаков во всех вариантах.

### Aggregate OOS

| Variant | Mode | N | net mean R | total R | PF | max DD | F/P/S | hold mean/median |
|---|---|---:|---:|---:|---:|---:|---|---|
| BEFORE static | Safe | 193 | -0.089 | -17.25 | 0.825 | 36.54 | 73/26/78 | 395.8/231 |
| BEFORE static | Risk | 246 | -0.061 | -14.96 | 0.896 | 45.48 | 74/43/113 | 297.0/151.5 |
| BEFORE static | Standard | 330 | +0.017 | +5.64 | 1.032 | 34.52 | 153/0/169 | 196.2/131.5 |
| Intermediate moving-wick | Safe | 430 | -0.041 | -17.74 | 0.845 | 35.31 | 175/183/66 | 127.4/99 |
| Intermediate moving-wick | Risk | 456 | -0.002 | -1.08 | 0.994 | 36.28 | 199/137/114 | 120.7/98 |
| Intermediate moving-wick | Standard | 330 | +0.017 | +5.64 | 1.032 | 34.52 | 153/0/169 | 196.2/131.5 |
| AFTER moving-close | Safe | 403 | -0.059 | -23.61 | 0.794 | 36.63 | 153/179/65 | 145.4/106 |
| AFTER moving-close | Risk | 425 | -0.010 | -4.09 | 0.977 | 31.76 | 179/128/112 | 139.0/107 |
| AFTER moving-close | Standard | 330 | +0.017 | +5.64 | 1.032 | 34.52 | 153/0/169 | 196.2/131.5 |

### SOL OOS

| Variant | Mode | N | net mean R | total R | PF | max DD | F/P/S | hold mean/median |
|---|---|---:|---:|---:|---:|---:|---|---|
| BEFORE static | Safe | 35 | -0.045 | -1.58 | 0.907 | 11.61 | 13/5/13 | 458.8/256 |
| BEFORE static | Risk | 54 | -0.107 | -5.79 | 0.822 | 20.44 | 16/12/24 | 298.3/175.5 |
| Intermediate moving-wick | Safe | 97 | -0.017 | -1.66 | 0.924 | 8.17 | 40/44/11 | 126.4/96 |
| Intermediate moving-wick | Risk | 104 | -0.060 | -6.27 | 0.851 | 17.61 | 47/26/29 | 121.3/99.5 |
| AFTER moving-close | Safe | 90 | -0.028 | -2.56 | 0.881 | 8.53 | 36/43/9 | 145.0/108.5 |
| AFTER moving-close | Risk | 95 | -0.044 | -4.20 | 0.895 | 15.01 | 44/24/26 | 143.6/110 |
| Standard (all) | Standard | 61 | +0.176 | +10.71 | 1.362 | 11.14 | 31/0/29 | 256.0/177 |

### Attribution

Raw detector stream идентичен; accepted trades — нет из-за occupancy. Total accepted Safe/Risk: static `661/882`, moving-wick `1278/1402`, current `1206/1323`; OOS `193/246`, `430/456`, `403/425`. Static levels держали сделки дольше и блокировали больше кандидатов. Moving levels резко сократили holding. Close confirmation против wick сделал Full строже, увеличил holding и снова снизил N.

Поэтому static→moving improvement (Safe `-0.089→-0.041R`, Risk `-0.061→-0.002R`) включает moving-level exit **и** новый occupancy mix, а не paired-exit-only effect. Moving-wick→moving-close ухудшил Safe до `-0.059R` и Risk до `-0.010R`, уменьшив Full. Taxonomy PnL не меняет; detector не менялся. Safe/Risk OOS edge после costs не доказан; Standard буквально идентичен.
 


## Текущий план: paired-аудит exit-механики

Funding намеренно исключён: сейчас проверяется общая логика сделки, а не финальная биржевая экономика.

1. Зафиксировать один и тот же набор OWN2-входов независимо от длительности предыдущих сделок и occupancy gate.
2. Для каждого входа парно проиграть три механики: static Mean/Inner по wick; moving Mean/Inner по wick; moving Mean + Full только по close за moving Inner.
3. Сравнить paired delta R, Full/Partial/Stop, holding и adverse/favorable excursion на абсолютно одинаковых входах.
4. Отдельно разложить эффект moving levels и эффект close-confirmation, не смешивая их с изменением количества принятых сигналов.
5. Проверить результаты aggregate, по активам/TF/side и отдельно SOL; параметры не подбирать.
6. Выбрать механику Full только если результат повторяется между train/OOS и не держится на одном активе или стороне.
7. После решения повторно включить occupancy и показать итог в формате «было → стало».

В этом цикле funding, новые signal-фильтры и liquidity/HTF-гипотезы не добавляются.

## Результат paired-аудита exit-механики

Артефакты: runner `temp/run-paired-exit-audit.ts`, machine-readable результат `temp/paired-exit-audit.json`, log `temp/paired-exit-audit.log`. Протокол исполнен без tuning: SOL/BTC/ETH/XRP/BNB × 30m/1h/2h × 20k, chronological 65/35, 7 bps/side, funding полностью исключён. Raw OWN2 set заморожен; occupancy отключён: каждый candidate/mode независимо проигран с одного next-bar-open entry, одинаковой geometry/cost model. Common inclusion rule: candidate включён, если существует next-bar entry и конечна geometry; достигший края данных replay включается во все варианты как `open` с common final-close mark. Поэтому N строго равен A=B=C: train `2830`, OOS `1417` для каждого mode.

Во всех A/B/C включён исправленный Partial→Add basis: `(oldAverage × remainingWeight + add) / (remainingWeight + 1)`. Новых replay bugs аудит не выявил; production/taxonomy/UI не менялись. Standard — unchanged control, delta ровно `0` на всех `2830/1417` парах.

### Было → стало: paired net R

| Mode | Split | N A=B=C | A static | B moving-wick | C moving-close | B−A mean / median / cluster 95% CI | C−B mean / median / cluster 95% CI |
|---|---|---:|---:|---:|---:|---|---|
| Safe | train | 2830 | -0.0414 | -0.0555 | -0.0709 | -0.0141 / 0 / [-0.0465,+0.0228] | -0.0153 / 0 / [-0.0234,-0.0078] |
| Safe | OOS | 1417 | +0.0323 | -0.0022 | -0.0010 | -0.0346 / -0.0248 / [-0.0811,+0.0135] | +0.0013 / 0 / [-0.0069,+0.0090] |
| Risk | train | 2830 | -0.0586 | -0.0872 | -0.1049 | -0.0286 / 0 / [-0.0653,+0.0073] | -0.0177 / 0 / [-0.0278,-0.0088] |
| Risk | OOS | 1417 | +0.0341 | +0.0200 | +0.0162 | -0.0141 / 0 / [-0.0644,+0.0398] | -0.0038 / 0 / [-0.0171,+0.0081] |

Детерминированный paired bootstrap ресемплирует 4h timestamp+side clusters, 2000 итераций, seed `20260809`. Полные outcome transition matrices, train/OOS asset/TF/side/SOL slices, holding и MAE/MFE находятся в JSON.

### Attribution без occupancy

**Moving-level effect B−A.** Safe OOS improved/worsened/equal `438/767/212`, holding delta mean/median `-192.6/-51` bars, MAE/MFE delta mean `-0.099/-0.159R`. Risk: `430/655/332`, `-110.8/-1` bars, `-0.084/-0.155R`. Знак не устойчив: CI включает ноль; Safe asset means SOL/BTC/ETH/XRP/BNB = `-0.076/-0.038/+0.030/-0.133/+0.058R`, sides long/short `+0.010/-0.106R`; Risk = `-0.073/-0.038/-0.001/+0.014/+0.038R`, sides `+0.030/-0.084R`. SOL не подтверждает improvement. Значит прежнее occupancy-сравнение `-0.089→-0.041` / `-0.061→-0.002R` не было чистым moving-level эффектом.

**Close-confirmation effect C−B.** Safe OOS improved/worsened/equal `340/50/1027`, holding `+20.2/0` bars, MAE/MFE `+0.010/+0.026R`; Risk `358/54/1005`, `+20.3/0`, `+0.012/+0.038R`. OOS эффект около нуля и CI включает ноль, а train значимо отрицателен. Breadth неоднородна: Safe OOS asset means `+0.004/-0.023/+0.010/+0.012/-0.003R`, Risk `+0.003/-0.026/-0.006/+0.003/+0.003R`; TF 30m положителен (`+0.016/+0.029R`), 1h/2h не подтверждают; SOL `+0.004/+0.003R` с CI через ноль. Это отдельный эффект trigger, не taxonomy/UI.

### Точное решение

Preregistered gate не выполнен ни для B−A, ни для C−B: OOS CI пересекают ноль, знак зависит от asset/side/TF, а close-confirmation train резко хуже OOS. **HOLD current C как frozen runtime reference; NO production change.** Это не выбор C как лучшей механики и не разрешение торговать: paired-аудит не доказал преимущество A, B или C. Production replay уже current C, поэтому откат к post-hoc лучшему A запрещён.

**Следующий один шаг:** оставить exit-код и параметры замороженными и провести новый untouched paper-forward checkpoint на current C; до checkpoint не включать occupancy-переоптимизацию, funding, новые filters/liquidity/HTF и не выбирать asset/TF/side по этому OOS.
