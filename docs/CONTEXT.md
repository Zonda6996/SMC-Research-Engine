# Контекст проекта SMC Research Engine для нового ИИ

> Обновлено: 2026-07-27, вечер. Ветка: **`simplified-mode-v1`** (liquidity-improvements-v1 слита в main 27.07, PR #7, merge 45a91f6 — 13 QA-раундов приняты). Актуальный фронт работ — раздел 0.5, читать его ПЕРВЫМ; правила движков — SPEC §16.8–§16.24.
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

## 0.5 Текущий фронт работ (28.07.2026): GGI-семантика метода → тренд-фильтр in-engine (упрощённый v0.3)

Активная ветка: **`simplified-mode-v1`** (упрощённый режим подтверждения). Прежняя liquidity-improvements-v1 слита в main 27.07 (PR #7, merge 45a91f6, 13 QA-раундов приняты пользователем). Canon/battle-пайплайн (разделы 2–8) — фоновый контекст, не трогать без явной просьбы.

### Состояние ветки simplified-mode-v1 (всё запушено)

```text
45a91f6  merge liquidity-ветки в main (зоны v2.4, уточнённое v1.8, визуализатор 2.0 со слоями)
935b9e9  simplified v0.1: движок упрощённого подтверждения (SPEC §16.24)
0c45155  docs: ветки
021889c  docs: SPEC §16.24 (v0.1 + train/test-сетка 16 вариантов)
3dbf1a9  ggi v0.1: аппроксимация GGI Zone по скринам пользователя (SPEC §16.25)
75dc979  docs: SPEC §16.25 (вклад фильтров: тренд/GGI)
поверх   docs: этот хэндофф
```

Гейт: **305/305** (`npx tsx --test tests/*.test.ts`), `tsc --noEmit` чистый, `node --check` всех .mjs чистый.

### Карта системы (все версии)

- **Зоны** `liquidity-poi-2.4-consumed-at-close` (src/core/confirmation/LiquidityPoiCalibration.ts, SPEC §16.12–§16.16): liquidity-first, полки из провалов плотности, родство стеков. Дефолты канона НЕ менялись. **Per-TF профили слоёв** — tools/shared/poiProfiles.ts (§16.21–§16.22, выведены из эталонных карт пользователя): 1h локальный {stackMaxPct 0.02, valley 0.4, minBins 2}, 1d свинг {valley 0.15, minShare 0.03, top8}, 4h = дефолты.
- **Уточнённое подтверждение** `poi-confirmation-1.8-sweep-dedup` (PoiConfirmationEngine.ts, §16.8–§16.18): невыметенный якорь, доигрывание за окном, weaknessFailLimit 3, дедуп «один свип = одна сделка» (duplicateEntryOf), пометки againstImpulse/impulseRet (маркер, НЕ фильтр; калиброван только на 4h→15m).
- **Упрощённое подтверждение** `simplified-confirmation-0.1` (SimplifiedConfirmationEngine.ts, §16.24): касание → первая направленная свеча упрощённого ТФ (1d→4h, 4h→1h, 1h→15m) → вход по закрытию; стоп far/pct (оба на тест); частичка 50% на +7.5% хода → БУ → фулл +17.5%; once/rearm. Все параметры конфигом.
- **GGI Zone аппроксимация** `ggi-zone-approx-0.1` (tools/shared/ggiZone.ts, §16.25): mean = EMA(EMA(close,80),20), dev = EMA(|close−mean|,40), красная зона mean+[2.68…6.65]×dev, зелёная зеркально. По якорям скрина BTC 1h — ошибка 0.01–0.04%; **на 4h полосы ~30% уже эталона** (нужны якоря пользователя с 4h для пер-ТФ подгонки).
- **Heatmap** `liquidity-heatmap-2.0-oi-hybrid` — не менялся (в песочнице volume-proxy, у пользователя OI-гибрид).
- **Визуализатор 2.0** (tools/visualizer/): слои карты 1D/4h/1h чипами с ЛЮБОГО вида лестницы на канонических окнах (§16.20–§16.23; 1h-слой всегда «только ближайшие»), полная история ТФ подтверждения из архивов (archiveKlines.ts: ZIP нативно, дисковый кэш tmp/viz-archive-cache, ретраи 5xx), связка-селектор в панели подтверждения, конфиги движков в UI (профили слоёв под overrides), data-end подаётся «живая у края данных».
- **Данные**: tools/shared/archiveKlines.ts — data.binance.vision (Binance API из песочницы гео-блокирован); tools/shared/candleFetcher.ts — CONFIRMATION_TF (лестница уточнённого: 1d→1h, 4h→15m, 1h→5m).

### Сводка знания (детали в SPEC §16.18–§16.25 — прочитать!)

1. **Дефолты движков не трогать**: большая сетка 8 монет train/test — комбинации констант НЕ переносятся (топ train +29.6R → test −0.9R; ρ(train,test)=0.11); stopBuffer не лечит стоп-раны; risk 2.5 — погоня; dupNear ≥1 хуже; stopLookbehind 1.0 — мёртвая ручка. Кандидаты fresh 320 / risk 2.0 закрыты решением пользователя: не фиксировать.
2. **Механика без режимного контекста не зарабатывает нигде** (уточнённое v1.8 и упрощённое v0.1, все лестницы, gross≈0, net<0 с комиссиями 0.1–0.2R или 0.10% цены на сделку).
3. **ТРЕНД-ФИЛЬТР — первый сигнал, улучшающий test на всех связках** (§16.25): «не против тренда», тренд = ≥2 BOS одного направления после последнего CHoCH (правило пользователя «bos-bos-choch-bos-bos»), регион меняется на баре подтверждения. Упрощённый режим: 1d→4h test −70→−11%, 4h→1h −59→**+38%**, 1h→15m +261→**+332%** (оба полупериода +351/+332, 7/8 монет в плюсе, минус только XRP). НО: 4h-связка по полугодиям качает (24H2 −162%), 1h помесячно 4+/3− — направление ценно, стабильность не доказана.
4. **GGI-фильтр в лоб ВРЕДИТ** (режет тейки сильнее стопов). Вероятная причина: применялся на ТФ связки, а по методу пользователя GGI смотрится на **1h в ТРЕНДЕ / 4h в БОКОВИКЕ** (независимо от связки). Не перетестировано.
5. Разбор 10 стопов ETH (§16.18): группы дубль/стоп-раны/контртренд-ножи/чоп; зомби-попытки оставлены осознанно (PnL за них).

### ЗАДАНИЯ (по порядку)

1. **Перетест GGI-фильтра по семантике метода**: в тренде — GGI на 1h, в боковике — на 4h (тренд-детектор уже есть, tmp/diag/simplifiedGrid2.ts — образец пайплайна); те же train/test-таблицы вклада. Если пользователь пришлёт якоря полос с 4h/1D (значения со шкалы на последнем баре) — пер-ТФ подгонка kInner/kOuter (tmp/diag/ggiFit.ts — образец).
2. **При подтверждении цифр — тренд-фильтр in-engine**: simplified v0.3 (конфиг-флаг, выкл по дефолту до решения пользователя), полный train/test (post-hoc фильтрация для rearm-цепочек занижает число входов — in-engine честнее), потом UI-режим упрощённого подтверждения в визуализаторе.
3. **Разобраться: 1h→15m окно дало входы только с 2025H1** (при 833-дневном окне зон 2024-й пуст — вероятно, дыра в данных/кэше 1h-архивов или в датировке; проверить до выводов о связке).
4. Форвард-наблюдение пометок v1.8 («против импульса», «дубль входа») на OI-карте пользователя; гейт-фильтр импульса — только после форвард-статистики.
5. Открытое: минус XRP на 1h-связке с тренд-фильтром; кейс «касание снизу» (скрин 7 второго QA) — ждёт деталей.

### Решения пользователя (свод; хронология в SPEC)

1. Дефолты движков не менять; профили слоёв (§16.21–22) — инструментальный слой по его эталонам; крутилки — через UI-overrides.
2. Иерархия карты: 1h локальные (этажи ≤2%, ближайшие, «по тренду, плыть по движению») / 4h среднесрок / 1D свинг («отчётливо видимая ликвидность»); слои одной карты (§12.2), 1W отложена.
3. Уточнённое: дедуп «один свип = одна сделка» и пометка импульса приняты; зомби-семантика оставлена; ETH в тесте.
4. Упрощённое (§16.24): вход = первая направленная свеча упрощённого ТФ после касания; стопы far/pct и повторы once/rearm — решать тестами; цели 7–8% → БУ → 15–20% (для локальных — локальнее, тестами); добор при уточнённом подтверждении после входа — v-next; пирамидинг отложен.
5. GGI Zone — приватный индикатор, воссоздаём аппроксимацией по скринам; «чем старше ТФ, тем лучше»; красная = перекуплен, зелёная = перепродан, синяя mean.
6. Тренд/боковик пользователь не формализует — «тестами проверим»; правило bos-bos-choch принято как механизация.
7. Ветка одна (simplified-mode-v1), коммиты движок/виз/docs раздельно, merge в main только по явной просьбе (последний: PR #7, 27.07).

### Рабочие заметки для нового ИИ (важно)

- Песочница: Binance API гео-блокирован; данные — data.binance.vision через tools/shared/archiveKlines.ts (ZIP нативно, дисковый кэш tmp/viz-archive-cache, микросекундные ts 2025+ нормализуются). Сетевые домены требуют одобрения пользователем (registry.npmjs.org, data.binance.vision). Движки исполняются и без npm (Node 24 нативно, импорты движков типовые), но полный гейт — через tsx.
- tmp/diag (не пушится, пересобирается по этому описанию): buildData.mjs (датасеты 8 монет: btc/eth/sol/xrp/bnb/doge/ada/link × 4h/15m, 2024-03→, gaps=0), run/extract/report*.mjs (разбор стопов), sweepRunner+configs+analyze (сетка 8 монет), gate.mjs (трендовый гейт уточнённого), simplifiedGrid.ts (16 вариантов упрощённого), simplifiedGrid2.ts (вклад GGI/тренд-фильтров), ggiFit.ts/ggiOverlay.ts (подгонка GGI). Срез «как в SPEC §16.17» = cutoffClose 2026-07-24T00:00Z, база сверялась бит-в-бит.
- Пуш — MCP github__push_files (owner Zonda6996, repo SMC-Research-Engine, **branch simplified-mode-v1**); после пуша git fetch + diff origin (пуст) + git reset --hard; тяжёлые payload — paramsFile. Merge в main — только по явной просьбе.
- Проверки после правок: `npx tsx --test tests/*.test.ts` (305/305), `npx tsc --noEmit`, `node --check tools/visualizer/public/*.mjs tools/visualizer/public/{lib,panels}/*.mjs`.
- **Методика анти-подгонки обязательна** для любых калибровок (урок §16.18/§16.24): train/test-разрез по времени входа (движки каузальны — прогон один), правило отбора фиксировать ДО взгляда на test, плато вместо пиков, всегда net с комиссиями, мультиактивно (одноактивная калибровка ломается — §16.22).
- QA-цикл: скрин пользователя = ТЗ; кейсы воспроизводить на данных ДО правок; предлагать → согласовывать → реализовывать с тестами → SPEC-секция → пуш. Пользователь смотрит слои на 4h limit 5000, у него OI-гибрид heatmap и приватный GGI (песочница — прокси/аппроксимации, свежие ~30 дней могут отличаться).
- Стиль: по-русски, плотно, с цифрами; термины пояснять в скобках; ЧЕСТНЫЙ ПУШБЕК (автосогласие = вред); магические числа не вводить без согласования; версии движков бампать при изменении правил; SPEC дополнять секцией в момент правки; gross всегда помечать как gross. **Пользователь не квант** — сложные выкладки переводить на простой язык (урок 10-го QA); отвечать на «что дальше по итогу» рекомендацией, а не меню.
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
