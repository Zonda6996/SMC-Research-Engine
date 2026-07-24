# Контекст проекта SMC Research Engine для нового ИИ

> Обновлено: 2026-07-24, вечер (хэндофф после 9 раундов QA за день). Ветка: `liquidity-improvements-v1`, HEAD — docs-коммит хэндоффа поверх `9ffcb62`. Актуальный фронт работ — раздел 0.5, читать его ПЕРВЫМ; правила движков — SPEC §16.8–§16.17.
>
> Это файл быстрого восстановления контекста, **не замена `SPEC.md`**. `SPEC.md` — главный источник истории решений, результатов и отрицательного знания. Код, особенно `src/strategy/battleConfig.ts`, — источник истины о текущем боевом поведении.

## 0. Обязательный протокол нового чата

Перед любыми идеями, выводами или изменениями кода:

1. Открой актуальный репозиторий и выполни `git pull`/`git fetch`.
2. Прочитай **`SPEC.md` полностью**, от начала до конца. Не ограничивайся последними разделами: старые волны объясняют, что уже тестировалось и почему было отклонено.
3. Прочитай этот файл полностью.
4. Просмотри все tracked-файлы проекта как минимум через `git ls-files`; бинарные результаты можно инвентаризировать, но весь исходный код, тесты, конфиги и Markdown нужно прочитать.
5. Особенно внимательно прочитай:
   - `src/strategy/battleConfig.ts`;
   - `src/core/analysis/runAnalysis.ts`;
   - `src/core/fib/FibLifecycleEngine.ts`;
   - `src/core/analysis/entryModels.ts`;
   - `src/core/analysis/takeLadders.ts`;
   - `src/core/analysis/portfolioBacktest.ts`;
   - `src/core/analysis/regimeFilter.ts`;
   - `src/core/analysis/dedupFilter.ts`;
   - `tools/batch/runBatch.ts`;
   - `tools/forward/forwardRunner.ts`;
   - все тесты в `tests/`.
6. Посмотри последние коммиты и diff, а не исходи из того, что этот контекст всё ещё свежий.
7. Перед утверждением «работает» запусти:

```bash
npm install --package-lock=false --ignore-scripts --no-audit --no-fund
npm test
npx tsc --noEmit
```

На коммите `864895e` проходили 217/217 тестов. На текущей ветке (24.07.2026, вечер) — 287/287 (`npx tsx --test tests/*.test.ts`), `tsc --noEmit` чистый, `node --check` всех фронтовых модулей чистый (`tools/visualizer/public/**/*.mjs` + легаси-стаб app.js).

8. Не исправляй найденные логические проблемы молча. Сначала покажи проблему, экономический эффект, варианты решения и тест, который отличит варианты.
9. Не предлагай повторно уже убитые идеи без нового information set и явного объяснения, почему теперь результат может измениться.
10. Общайся с пользователем по-русски, прямо, плотно, с цифрами. Не выдумывай результаты и параметры.

---

## 0.5 Текущий фронт работ (24.07.2026, вечер): разбор стопов ETH + приёмка калибровки

Активная работа — liquidity-ветка (SPEC §14, §16.x). Canon/battle-пайплайн (разделы 2–8) — фоновый контекст, не трогать без явной просьбы.

### Состояние ветки (все запушено в liquidity-improvements-v1)

```text
39e50ee  v2.0: liquidity-first зоны от полок heatmap (SPEC §16.12)
7a8fbb7  v2.1: полки из провалов плотности, потолок 8% цены, свежесть 300 (SPEC §16.13)
20a050d  v2.2: родство стеков, сила полки stackShare + фильтр UI (SPEC §16.14)
60176b5  v2.3 + viz 2.0: замещение при удержании массы; полный редизайн фронта (SPEC §16.15)
2d0dbb4  v2.4: stack-consumed на закрытии бара снятия (SPEC §16.16)
c35fb73  viz: полировка 7-го QA — палитра мышью, heatmap вне 15m, зум без сбросов (SPEC §16.16)
9b15742  conf v1.7: weaknessFailLimit=3, конфиг-параметр detectPoiConfirmation (SPEC §16.17)
14bae42  viz: кэш данных на сервере, полный список монет, «чем кончилась зона», confConfig в UI (SPEC §16.17)
9ffcb62  viz: сортировка селектора — мейджоры universe сверху
поверх   docs: этот хэндофф
```

Версии движков: `liquidity-poi-2.4-consumed-at-close`, `poi-confirmation-1.7-weakness-limit`, `liquidity-heatmap-2.0-oi-hybrid`. Тесты 287/287 (`npx tsx --test tests/*.test.ts`), `tsc --noEmit` чистый, `node --check` всех `tools/visualizer/public/**/*.mjs` чистый. Дисциплина коммитов: движок и визуализатор — ОТДЕЛЬНЫМИ коммитами («poi vX.Y: …» / «conf vX.Y: …» / «viz: …»); ветка одна, merge в main — только по явной просьбе.

### Как устроена система (карта для нового ИИ)

- **Зоны** (`src/core/confirmation/LiquidityPoiCalibration.ts`, v2.4, SPEC §16.12–§16.16): рождаются ОТ ЛИКВИДНОСТИ. Живые свежие пулы heatmap (кормились ≤ shelfFreshBars) склеиваются в супер-цепи (stackGapAtr), цепь режется на полки по ПРОВАЛАМ ПЛОТНОСТИ notional-профиля (shelfProfileBinPct/shelfValleyShare/shelfValleyMinBins); зону рождает полка из топ-N с долей ≥ shelfMinShare; near = wick невыметенного экстремума (nearTolAtr) или край полки, far = конец полки с потолком stackMaxPct от цены края. Смерти: провал телом за far / фитиль насквозь / снято ≥ stackConsumedShare стека (момент = ЗАКРЫТИЕ бара) / полка не кормилась shelfFreshBars. РОДСТВО СТЕКОВ (stackKinshipShare): зоны с ≥50% общего notional меньшего стека = один объект; тронутая старшая главнее (младшая — дубль), нетронутую ЗАМЕЩАЕТ свежее поколение, но только если удерживает ≥50% СТАРШЕГО стека (иначе сползшее окно = дубль). Дедуп: near ≤ dupNearAtr / перекрытие ≥ dupOverlapShare при высоте ≤ dupMaxHeightRatio. Метаданные stackNotional/stackShare — сила полки для UI-фильтра. Конфиг переопределяем через context.config.
- **Подтверждение** (`src/core/confirmation/PoiConfirmationEngine.ts`, v1.7, SPEC §16.8–§16.11, §16.17): 15m для 4h-зон; заход → остановка (тишина stopQuietBars у экстремума) → отскок (reboundMinBars) → пересвип невыметенного якоря → защита → тест слабости (объём возобновления > объёма отката; weaknessFailLimit=3 провалов подряд = weakness-failed) → вход (гард entryMaxRiskAtr); стоп за свипом или историей (stopLookbehindAtr), тейк tpR=2; смерть попытки: attemptIdleBars бездействия / пробой закрытиями / конец окна (со состоявшимся свипом — доигрывается). Конфиг переопределяем 4-м аргументом.
- **Визуализатор 2.0** (`tools/visualizer/`): сервер `server.ts` (порт 7788; кэш данных 90с live / 1ч historical — «Пересчитать» не перекачивает свечи; /api/analyze принимает poiConfig/hmConfig/confConfig — whitelist числовых ключей, дефолты в коде не мутируют; engineDefaults/appliedOverrides в ответе; символы: мейджоры сверху). Фронт: `index.html` + `styles.css` (токены shadcn/Vercel, Geist) + `app.mjs` + `lib/{state,format,chart,api,palette}.mjs` + `panels/{stats,heatmap,zones,confirmation,lab,config}.mjs`; старый `app.js` — стаб. Зоны — прямоугольниками (custom primitive, вне автошкалы; клик = фокус, hover-карточка), «Мои зоны» (ручная разметка, localStorage, экспорт), панель «Настройки движков» (все константы трёх движков), палитра ⌘K, пресеты, воронка в Обзоре, при zone-ended показывается «чем кончилась зона». Проверка фронта: `node --check` каждого .mjs.
- **Диагностика в песочнице** (`tmp/diag`, gitignored/не пушится): датасеты `btc|eth|sol-4h.json` (5000 баров до 23.07.2026) и `btc|eth|sol-15m.json` (80 000 баров, ПОЛНАЯ история 833 дня — в 4 раза глубже 208-дневного потолка API визуализатора); скрипты buildData*.ts / build15m.ts (сборка из CSV data.binance.vision), map.ts (карта зон + кейсы), profile.ts (профиль плотности vs ручная карта), confGrid2.ts (мультимонетная сетка калибровки, CSV), supersedeStats.ts, eth2030.ts.

### Свежие результаты: сетка BTC/ETH/SOL (полная история; детали SPEC §16.17)

База (текущие дефолты): **BTC 12 входов, 10tp/2stop, WR 83%, gross +18R · ETH 13 входов, 3tp/10stop, WR 23%, gross −4R · SOL 11 входов, 5tp/6stop, WR 45%, +4R** (gross = tp×2R − stop; БЕЗ комиссий; volume-proxy без OI; N малые — только большие расхождения значимы). Ручки: risk (entryMaxRiskAtr) — главный рычаг (2.0: BTC +20R/19вх, SOL +14R/28вх; 3.0 — погоня); weak=3 — страховка (ETH +5R, BTC −4R к «выкл»); свежесть 320 — лучший вариант BTC (+20R), остальным ровно; near-дубль 2.0 — минус BTC/ETH, плюс SOL; нарезка провалов 3 подтверждена трижды.

### ГЛАВНОЕ ЗАДАНИЕ №1: разбор 10 стопов ETH по кейсам

Подтверждение на ETH систематически стопится (3tp/10stop при 83% WR на BTC). До любых крутилок — понять ПОЧЕМУ: вытащить каждый entered+stop кейс ETH из tmp/diag-прогона (трейс попытки: зона, заход, пересвип, вход, стоп) на график, сгруппировать причины (кривая зона volume-proxy? свип-нож? вход поздний? стоп short?), показать пользователю скринами/разбором, предложить правку ТОЛЬКО если увидим системный дефект. Помнить: у пользователя OI-гибрид — его карта может отличаться; сверять кейсы с его визуализатором.

### ЗАДАНИЕ №2: кандидаты изменений дефолтов (только по явному согласию пользователя)

- `shelfFreshBars` 300 → 320 (BTC +2R, остальным ровно; пользователь уже так играет в UI) — предложить зафиксировать.
- `entryMaxRiskAtr` 1.5 → 2.0 — пользователь тестирует в UI на своих картах; решение после его скринов.
- `dupNearAtr` — пользователь играет с 2.0 (чистая карта), цена известна (BTC −4…−6R gross); дефолт 0.25 не трогать без его решения.

### ЗАДАНИЕ №3 (roadmap, по команде пользователя)

- **Полная 15m-история в самом визуализаторе**: сервер подкачивает архивы data.binance.vision (сейчас потолок API ≈ 208 дней 15m; полная история уже работает в tmp/diag-прогонах).
- **МТФ-подтверждение** — связки ТФ пользователя (контекст → подтверждение): 1W→1D/4h, 1D→4h/1h, **4h→1h/15m (текущая)**, 1h→15m/5m; снимет и потолок истории (1h в 4 раза глубже).
- **Упрощённое подтверждение** (метод пользователя): перепроданность/перекупленность по GGI ZONE на 1h (тренд) / 4h (боковик); вход от возобновления — ЗАКРЫТАЯ свеча в сторону зоны на 1h/4h; риск 1–3% (ред. 5%), ≤2–3 сделок в день; на альтах +6–8% хода — бу и/или частичная фиксация 25–50%, полная по целям или 15–20%; доборы после бу; изолированная маржа, плечо ≤×10 (волатильные ≤×5); стоп = ликвидация −1%. Реализация: альтернативная машина состояний + отметка тренд/боковик.

### Открытые кейсы/вопросы

1. ETH «нет зоны над полкой 2030» на данных пользователя (у меня на свежих данных зона есть: 1958.8→2113.8) — ждём его JSON-экспорт для разбора цепочки поколений.
2. Кейс «касание снизу» (скрин 7 второго QA) — так и ждём деталей.
3. Merge-семантика «обе открыты» оценивается на конец загрузки — принятый компромисс.
4. Пометка «пришли на объёме» в Telegram — хотелка на будущее.

### Решения пользователя (сводка; детали в SPEC §16.8–§16.17)

1. Последовательность подтверждения одна для всех зон: заход → остановка (4 тихих бара) → отскок (6 баров) → пересвип невыметенного якоря → защита (same-bar валидна) → тест слабости (объём возобновления > отката; 3 провала подряд = отбраковка) → вход (гард 1.5 ATR15); стоп за историей в 0.5 ATR; тейк 2R; попытка умирает по бездействию 96 баров.
2. Зоны — от ликвидности (полки heatmap), не от структуры; полки режутся по провалам плотности, а НЕ по дистанции (ядерная кластеризация отвергнута данными); потолок высоты — % от цены (ATR-потолок отвергнут); свежесть — та же константа для рождения и устаревания.
3. Родство стеков: тронутая старшая держит место; нетронутую заменяет только поколение, удерживающее её массу.
4. Слабые полки не режутся правилом рождения (два кандидата отвергнуты данными) — фильтр отображения «Сила стека».
5. ATR-fallback зоны не торгуются; дубли не торгуются и не показываются.
6. Все константы в LIQUIDITY_POI_CONFIG / POI_CONFIRMATION_CONFIG с русскими комментариями; менять только по согласованию; в UI крутятся через overrides без мутации дефолтов.
7. Ветка одна (liquidity-improvements-v1), коммиты движок/виз раздельно, merge в main только по явной просьбе.
8. Визуализатор: без сборки, чистая модульная архитектура, стиль shadcn/vercel; без автозагрузки; русские подписи; «склонировал и запустил».

### Рабочие заметки для нового ИИ (важно)

- Песочница: Binance API гео-блокирован; данные — data.binance.vision (архивы klines futures/um, monthly+daily CSV, ts в ms; дневной архив появляется с задержкой ~сутки). npm работает после запроса сетевого доступа (registry.npmjs.org, data.binance.vision).
- Пуш — MCP-действие github__push_files (owner Zonda6996, repo SMC-Research-Engine, branch liquidity-improvements-v1); после пуша git fetch + diff origin (пуст) + git reset --hard origin/…; тяжёлые payload — через paramsFile.
- Проверки после правок: `npx tsx --test tests/*.test.ts` (287/287), `npx tsc --noEmit`, `node --check tools/visualizer/public/*.mjs tools/visualizer/public/{lib,panels}/*.mjs`.
- QA-цикл: скрин пользователя = ТЗ; каждый кейс воспроизводить на данных ДО правок; предлагать → согласовывать → реализовывать с тестами → SPEC-секция → пуш. Пользователь смотрит 4h limit 5000; у него heatmap с OI-гибридом (песочница — volume-proxy, свежие ~30 дней могут отличаться).
- Стиль: по-русски, плотно, с цифрами; термины пояснять в скобках; честный пушбек (автосогласие = вред); версии движков бампать при каждом изменении правил; SPEC дополнять новой секцией; gross-цифры всегда помечать как gross.

---

## 1. Что это за проект

SMC Research Engine — TypeScript/Node.js research-платформа для проверки авторской SMC/Fibonacci-логики на крипто-фьючерсах. Это не классический ICT, не готовый торговый бот и не лицензия придумывать новые правила структуры.

Основной pipeline:

```text
Candles
→ PivotDetector
→ SwingEngine
→ StructureEngine / MarketStructureEngine
→ BosChochEngine
→ FibGridEngine
→ FibLifecycleEngine
→ batch/replay/portfolio/forward tooling
```

Канонический оркестратор — `runAnalysis()` в `src/core/analysis/runAnalysis.ts`. Он чистый: считает snapshot без вывода и сетевого исполнения.

Рынок исследования: Binance USDT-M candles. Пользователь торгует/оценивает исполнение под BingX. Модель costs:

- maker: 0.02%;
- taker: 0.05%;
- дополнительный stop slippage allowance: 0.02%;
- входы и тейки предполагаются maker, стоп и time-stop — taker+slippage.

Исторический основной universe последних исследований:

- 14 активов: BTC, ETH, SOL, XRP, BNB, DOGE, ADA, AVAX, LINK, SUI, TON, NEAR, APT, LTC;
- таймфреймы: 15m, 30m, 1h;
- Binance USDT-M futures;
- H1/H2, asset/TF-разрезы и rolling walk-forward применяются как защита от подгонки.

---

## 2. Текущий боевой source of truth

Источник истины — `BATTLE_CONFIG` в `src/strategy/battleConfig.ts`. Не копируй его числовые параметры в другие модули.

### Canon stream

#### Deep

- направление: по сетке;
- touch entry: 38.2;
- stop: 15;
- full take: 61.8;
- time-stop: нет;
- историческое ожидание после costs: около `+0.358R` на сделку.

#### OTE

- направление: по сетке;
- touch entry: 78.6;
- stop: 61.8;
- full take: 100;
- time-stop: 20 баров;
- историческое ожидание после costs: около `+0.244R` на сделку.

Для canon включён bigbar-фильтр, но его исполнимость для resting touch-limit сейчас является открытым критическим вопросом — см. раздел 7.

### Canon sizing

`canonRiskMultiplier()` перемножает:

- freshness: `≤3 → 2.0`, `4–15 → 1.0`, `16+ → 0.5`;
- swing compactness относительно rolling median: compact `1.4`, wide `0.7`;
- session 15–20 UTC `1.2`, но session layer сейчас выключен.

Исторический research-результат sizing stack: около `0.280 → 0.362 R/unit`, то есть +29% к качеству аллокации. Это не означает, что production budget normalization уже корректно реализована.

### Reverse stream после исправления SPEC 7.45

Текущий reverse — **только mirror**:

- активируется после canon OTE entry;
- направление против сетки;
- entry 100;
- stop 120;
- take 78.6;
- cancelBeyond 0;
- честное ожидание: `+0.172R`, WR 60.5%, H1 `+0.169`, H2 `+0.175`, n=3515.

`fade141` удалён из `BATTLE_CONFIG` и новых forward-сигналов.

### Reverse sizing

`reverseRiskMultiplier()` использует свежесть canon-касания:

- `≤3 → 1.5`;
- `4–15 → 1.0`;
- `16+ → 0.7`.

На исправленном mirror-only пуле avgR по этим бакетам: `0.268 / 0.178 / 0.138`. Compactness для reverse не прошла и не используется.

---

## 3. Важнейшее исправление SPEC 7.45: fade141 был look-ahead

Ранее reverse состоял из `mirror@100` и `fade141@141` с first-fill-wins и показывал `+0.347R`.

Проблема: fade оценивался на OTE-сетках, где canon **впоследствии вошёл**, хотя fade-заявка стартовала при создании сетки, когда будущий canon entry ещё неизвестен. Это selection look-ahead.

Unconditional проверка дала:

- все OTE-сетки: n=5625, avgR `−0.130`;
- canon вошёл: n=2983, avgR `+0.205`;
- canon не вошёл: n=2642, avgR `−0.508`, WR 19.2%;
- отрицательный результат устойчив на H1/H2.

После переноса fade activation на момент после canon OTE entry выяснилось:

- цена не может дойти от 78.6 до 141, не пройдя 100;
- mirror на 100 всегда заполняется раньше;
- fade-only n=0;
- first-fill-wins вырождается в mirror-only.

Поэтому fade удалён, старые `+0.347R` признаны завышенными. Новый ИИ не должен ссылаться на `0.347` как на актуальное ожидание reverse, даже если эта цифра осталась в более раннем разделе `SPEC.md` или legacy journal report.

Методологическое правило, добавленное после этой находки:

> Любое условие отбора universe должно быть проверяемо в момент постановки заявки. Если eligibility зависит от будущего входа/исхода другой leg, это look-ahead.

---

## 4. Forward runner после последних изменений

Файл: `tools/forward/forwardRunner.ts`.

Архитектура: stateless replay последних 3000 свечей на каждом `symbol|tf`, состояние дедупликации в `tmp/forward/state.json`, журнал в `tmp/forward/signals.jsonl`, опциональные Telegram-уведомления.

Добавлены события:

- `setup` — сетка создана, нужно заранее поставить canon limit;
- `cancel` — снять незаполненную заявку;
- `signal` — fill;
- `outcome` — tp/stop/timestop.

`--report` считает статистику только по signal/outcome, но показывает число setup/cancel. Legacy fade141-записи читаются для совместимости, новые не создаются.

Это улучшило старую проблему «сигнал-некролог», когда пользователь узнавал о touch только после закрытия свечи. Но implementation ещё не полностью исполнима — см. открытые вопросы.

---

## 5. Что уже исследовано и закрыто

Не предлагай это как новую идею:

- close/candle confirmations;
- MTF CHoCH confirmation;
- partial exits и runners;
- break-even management;
- trailing по уровням;
- re-entry после стопа;
- scale-in/усреднение;
- динамическая переподгонка stop/take cells;
- per-symbol/per-TF cherry-picking;
- HTF trend/alignment filter;
- deep-mirror;
- fade241;
- подход к зоне `approachAtr` и wick fraction;
- equity-streak sizing;
- fixed R:R для OTE;
- дальние цели 141/241 вместо магнитных 61.8/100.

Причины подробно описаны в `SPEC.md`: подтверждения опаздывают, runners разбавляют edge после магнитного уровня, BE/trailing выбивают будущих победителей, re-entry торгует уже сломанный уровень, scale-in получает adverse selection, MTF теряет V-развороты и платит худшей ценой.

### Проверенные и принятые результаты

- full single take лучше partial/BE/runners;
- оптимальные fixed cells: deep `15×61.8`, OTE `61.8×100`;
- OTE entry 78.6 подтверждён полным entry×stop×take sweep;
- freshness и compactness работают как sizing, не hard filters;
- OTE time-stop 20 даёт небольшой плюс;
- rolling walk-forward подтвердил стабильность fixed cells;
- pessimistic intrabar почти не искажает результат для stop/take conflicts;
- volume spike `volRatio≥2` ухудшает OTE, но эффект признан слишком слабым/немонотонным для production layer;
- текущий reverse — только mirror, не fade.

---

## 6. Архитектурный разрыв, который ещё не закрыт

`src/core/analysis/portfolioBacktest.ts` не является portfolio backtest текущего `BATTLE_CONFIG`.

Он исторически собирает lifecycle-сценарии `ote/deep/breaker`, использует одинаковый `riskPct`, `netBeR()` старого lifecycle и tie-break:

```text
entryAt → symbol → timeframe → scenario → id
```

Он не моделирует полноценно:

- новые stop/take cells battleConfig;
- raw/normalized canon sizing;
- mirror activation как parent-child lifecycle;
- reverse sizing;
- единый parent setup risk;
- реальную приоритизацию при max concurrent risk.

Поэтому его equity/DD/Monte Carlo нельзя автоматически называть портфелем текущей canon+mirror системы.

Будущий правильный слой должен строить единый chronological family ledger непосредственно из `BATTLE_CONFIG` и использовать один и тот же replay в batch и forward.

---

## 7. Forward runner v2 (сделано после ревью 864895e)

Текущая версия журнала: `battle-7.45-exec-v2`. Детали и принятые решения — SPEC 7.46.

Исправлено:

- state и события версионированы; старый state не открывается молча;
- FORWARD определяется по заявке/размеру, известным до fill, а не по времени outcome;
- carry-in и catch-up навсегда остаются backfill;
- mutable `swingPool` удалён, median строится по прошлым 200 уникальным сеткам;
- freshness исполняется через `SETUP` и заранее отправленные `AMEND` перед барами 4/16;
- touch fill важнее bigbar свечи касания; post-close bigbar не отменяет уже исполненную лимитку;
- mirror получает setup после OTE fill и торгуется только со следующего бара;
- structural cancel получает реальный confirmIndex противоположного события;
- отчёт показывает clean forward, backfill, pending orders и open trades;
- добавлены тесты median/report/idempotency.

После изменения execution semantics старые цифры `deep 0.358`, `OTE 0.244`, `mirror 0.172` в forward-report — только старые benchmarks. Нужен отдельный batch-пересчёт с теми же исполнимыми правилами.

Перед запуском v2 старую `tmp/forward` обязательно архивировать или удалить.

### Что ещё проверить

1. Запустить полный `--eval-entry`: блок SPEC 7.47 уже сравнивает old/executable bigbar и old/next-bar mirror; fixture прошла, но статистикой не является.
2. По полному TXT+CSV установить новые честные benchmarks deep/OTE/mirror.
3. Добавить более прямой синтетический тест exact cancel index.
4. Построить единый battle-family portfolio ledger; legacy `portfolioBacktest.ts` всё ещё не равен текущему battleConfig.

---

## 8. Приоритет следующей работы

1. Запустить чистый forward v2 после удаления старой папки.
2. Доделать визуализатор так, чтобы он использовал тот же battle execution layer.
3. Пересчитать old-vs-executable bigbar и mirror next-bar.
4. Проверить fade141 только после stop mirror.
5. Затем family sizing/allocator и остальные новые идеи.

---

## 9. Важные команды и файлы результатов

Основные команды:

```bash
npm test
npx tsc --noEmit
npm run batch -- --eval-entry
npm run forward -- --once
npm run forward -- --report
npm run forward -- --fixture
npm run portfolio -- ...
```

Перед реальным длинным прогоном изучить CLI-шапку и `parseArgs()` в `tools/batch/runBatch.ts`.

Forward state/journal:

```text
tmp/forward/state.json
tmp/forward/signals.jsonl
```

Batch results генерируются research runner; не делай вывод по одному summary без CSV-разрезов H1/H2, symbol, TF и проверок одинакового universe.

---

## 10. Стиль работы с пользователем

- Ответы только на русском, если пользователь не попросил иначе.
- Без мотивационной воды.
- Сначала факт из кода/SPEC, затем интерпретация.
- Любую оценку помечать как оценку.
- Если результат плохой — говорить прямо. История fade141 показывает, что пользователь предпочитает честное удаление красивого edge его защите.
- Не считать большой totalR доказательством без проверки universe eligibility на момент решения.
- Не менять архитектурные правила без согласования.
- После любой правки: тест, `tsc`, fixture/synthetic regression, затем описание diff.
- Коммит/пуш — только если пользователь явно попросил или подтвердил.
- Архивы с правками отдавать структурно (пути от корня репо), чтобы файлы можно было просто заменить; к архиву — SHA256 и готовый блок git-команд без пояснений.
- По зонам/логике давать честное трейдерское мнение и пушбек на плохие идеи; автоматическое согласие пользователь считает вредом.

---

## 11. Короткая формула текущего состояния

```text
Боевой кандидат:
canon deep 38.2 → stop15 → take61.8
canon OTE 78.6 → stop61.8 → take100, time-stop20
+ canon freshness×compact sizing
+ mirror reverse 100 → stop120 → take78.6
+ mirror freshness sizing 1.5/1.0/0.7
− fade141 удалён как look-ahead/non-executable

Но перед деньгами ещё проверить:
bigbar executability
risk quantity до fill
causal rolling median
точный cancel timestamp
pre-touch mirror setup
единый battle-family portfolio ledger
```
