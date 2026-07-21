# SMC Research Engine — спецификация

**Статус:** действующая спецификация проекта

**Дата:** 21.07.2026

**Язык документа:** русский

**Источник истины:** этот файл и `src/strategy/battleConfig.ts`

> В этом документе хранится только действующая стратегия, подтверждённые исследования, текущие исследовательские версии и закрытые направления. Подробная история старых экспериментов вынесена в `docs/archive/` и не является действующей спецификацией.

---

## 1. Назначение проекта

Проект решает четыре задачи:

1. Каузально строит рыночную структуру и Fib-сетки без знания будущего.
2. Проверяет торговые правила на нескольких независимых временных окнах.
3. Ведёт честный paper-forward с разделением реальных наблюдений и исторического восстановления.
4. Визуально проверяет, что алгоритм распознал именно тот сетап, который имелся в виду.

Проект не считается доказанной прибыльной системой до накопления достаточного clean forward.

---

# Часть I. Действующая механическая стратегия

## 2. Версия battle

```text
battle-7.53-cost175
```

Forward-версия:

```text
battle-7.53-cost175-v5
```

Торгуются два независимых потока одной Fib-сетки:

| Поток | Entry | Stop | Take | Time-stop |
|---|---:|---:|---:|---:|
| Deep | 38.2 | 15 | 61.8 | нет |
| OTE | 78.6 | 61.8 | 100 | 20 HTF-свечей |

Направление сделки совпадает с направлением сетки.

## 3. Боевые таймфреймы и universe

Текущий forward:

```text
15m / 30m / 1h
```

Монеты:

```text
BTC ETH SOL XRP BNB DOGE ADA AVAX LINK SUI TON NEAR APT LTC
```

Исследовательские, но ещё не подключённые TF:

```text
45m / 2h / 3h / 4h
```

## 4. First-5 gate

Правило:

> Если entry впервые коснулись в первой закрытой 5m-свече нового HTF-бара, лимитка отменяется, риск равен нулю. Если первая 5m entry не коснулась, дальше лимитка разрешена.

Технические параметры:

```ts
entryGate: {
  timeframe: '5m',
  skipFirstBars: 1,
  cancelOnSkippedTouch: true
}
```

LTF-история обязана содержать свечу ровно с начала HTF-бара. Обрезанный ряд не имеет права считать первую доступную свечу `offset=0`.

Подтверждение на двух окнах:

```text
Без gate:  19 724 сделки, +2020.9R, avg ≈ +0.102R
С gate:    14 015 сделок, +2985.5R, avg ≈ +0.213R

Total R: +47.7%
Средняя сделка: примерно ×2.1
Количество сделок: −29%
```

## 5. Execution cost gate

Перед выставлением resting limit вычисляется полный плановый стоп:

```text
fullStopNetR =
−1R ценового риска
− maker-комиссия входа
− taker-комиссия и slippage стопа
```

Правило:

> Если `fullStopNetR < −1.75R`, лимитка вообще не выставляется.

Конфигурация:

```ts
executionCostGate: {
  enabled: true,
  maxFullStopLossR: 1.75
}
```

Подтверждение на трёх временных окнах:

```text
До gate:
21 298 сделок
+5069.354R
avg +0.238R

После gate:
20 976 сделок
+5165.835R
avg +0.246R

Удалено: 322 сделки и −96.483R
Total R: +1.9%
Avg R: +3.5%
```

Удалённая группа по окнам:

```text
−59.434R / −34.901R / −2.148R
```

Пример BTC:

```text
Entry 63989.09
Stop 63968.83
Stop distance 0.0317%
Плановый stop −3.842R
Решение: execution-cost SKIP
```

## 6. Сайзинг

### 6.1 Свежесть

```text
1–3 бара:   ×2.0
4–15 баров: ×1.0
16+ баров:  ×0.5
```

### 6.2 Компактность swing/ATR

```text
compact: ×1.4
wide:    ×0.7
```

### 6.3 Сессия

```text
15–20 UTC: ×1.2
enabled: false
```

### 6.4 Боевые benchmarks после first-5 и cost gate

```text
Deep: 0.253R
OTE:  0.209R
```

`weighted R` использует сырой `riskMult` и не является готовым портфельным PnL.

## 7. Bigbar

```text
bigbarFilter: false
bigbarDiagnostic: true
```

Bigbar свечи касания нельзя честно использовать для отмены заранее стоящей лимитки: тело становится известно после возможного fill. Поэтому bigbar остаётся только диагностикой.

## 8. Модель исполнения

Текущая механическая стратегия использует resting limit.

Последовательность:

```text
SETUP   — лимитка подготовлена
AMEND   — размер ожидающей лимитки изменён
SIGNAL  — произошёл fill, позиция открыта
OUTCOME — TP / STOP / TIME-STOP
CANCEL  — лимитка отменена до fill
```

`execution-cost CANCEL` означает, что лимитка не выставлялась вообще.

Модель входа после закрытия 5m и reclaim проверена отдельно и отрицательна:

```text
Current: avg −0.205R
OOS:     avg −0.191R
```

Она не входит в battle.

---

# Часть II. Forward

## 9. Правила clean forward

Clean forward включает сделку только если:

1. Версия события совпадает с текущей forward-версией.
2. Setup и необходимый amend существовали до fill.
3. First-5 проверен по полному началу HTF-бара.
4. Execution cost gate пройден до выставления заявки.
5. Fill не восстановлен задним числом.

Исторические события после простоя относятся к `backfill` и не смешиваются с clean forward.

При смене версии state мигрируется автоматически. `signals.jsonl` не удаляется.

## 10. Контрольные точки

```text
50 закрытых clean-сделок  — техническая проверка
100 сделок                — первая оценка edge
200 сделок                — решение demo/live/закрытие проекта
```

Результат должен оцениваться с учётом корреляции по символам, TF и времени. Несколько одновременных сделок не считаются независимыми наблюдениями.

---

# Часть III. Уточнённая работа от POI

## 11. Статус исследования

```text
RESEARCH ONLY
не входит в battle
не входит в forward
batch и PnL запрещены до визуальной валидации детектора
```

Текущая версия POI-детектора:

```text
liquidity-poi-0.9-freshness-consumption
```

Текущая версия раннего confirmation-прототипа:

```text
refined-poi-0.2-ob-confirmed-fvg
```

Confirmation-прототип временно заморожен: сначала требуется правильно определить POI.

## 12. Ручное определение POI

### 12.1 Основная идея

POI строится вокруг значимого high/low и связанной с ним ликвидности.

Для LONG:

```text
ближняя верхняя граница = точный wick значимого low/фрактала
дальняя нижняя граница = место, где заканчиваются кластеры ликвидности
```

Для SHORT зеркально:

```text
ближняя нижняя граница = точный wick значимого high/фрактала
дальняя верхняя граница = конец кластеров ликвидности
```

Proprietary heatmap показывает предполагаемую ликвидность около значимых фракталов. Чем ярче кластер и чем дольше экстремум не снимали, тем выше ручная значимость.

### 12.2 Классы POI

```text
OUTER-SWING          — внешний swing high/low
PROTECTED-STRUCTURE  — HL/LH, после которого произошёл BOS
LOCAL-EQ             — объединённый EQH/EQL кластер внутри одного подтверждённого структурного сегмента
```

Локальные и swing-зоны существуют одновременно. Нельзя удалять все локальные зоны только потому, что есть внешний экстремум.

### 12.3 Дополнительный confluence

Записывается как характеристика, но пока не является обязательным фильтром:

```text
FVG
OTE
Fib retracement
Fib extension / 141
снятие PDH/PDL/PWH/PWL
```

### 12.4 Калибровка ширины

BTC visual calibration v0.3:

```text
19 оценок
13 wrong-zone
4 LONG выбрали 1.0 ATR
2 SHORT выбрали 0.5 ATR
Density 20/30/40 выбраны 0 раз
```

Текущие диагностические границы:

```text
LONG:  exact low wick → 1.0 ATR ниже
SHORT: exact high wick → 0.5 ATR выше
```

Это не финальное торговое правило. Граница требует визуального OOS на других символах.

## 13. Структурный lifecycle POI

Произвольного ограничения «N свечей» нет.

Структурный leg строится только если в загруженной истории уже существует подтверждённое предыдущее событие противоположного направления. Если его нет, начало leg неизвестно и кандидат пропускается. Запрещено подставлять начало датасета: именно это в v0.5.1 ошибочно растягивало зоны от 2024 до 2026 года.

### 13.1 LOCAL-EQ

```text
knownAt → первый sweep near-wick → зона consumed
```

### 13.2 PROTECTED-STRUCTURE

Зона заканчивается:

```text
4h close за защищаемым near-extreme
или
следующий same-direction BOS создал новый protected level
```

### 13.3 OUTER-SWING

Зона заканчивается:

```text
противоположный CHoCH
или
новый более экстремальный same-side outer swing
или
4h close за дальней границей
```

Для зоны хранятся:

```text
knownAt
supersededAt
invalidatedAt
endAt
active
```

Исторический прямоугольник обязан заканчиваться на `endAt`, а не тянуться через весь график.

## 14. Уточнённое подтверждение

### 14.1 Связки таймфреймов

Формат:

```text
POI TF → упрощённое подтверждение / уточнённое подтверждение
```

```text
1W → 1D / 4h
1D → 4h / 1h
4h → 1h / 15m
1h → 15m / 5m
```

Первый механический тест после POI QA:

```text
4h POI → 15m уточнённое подтверждение
```

После отдельной проверки:

```text
1h POI → 5m уточнённое подтверждение
```

### 14.2 Последовательность LONG

1. Цена приходит внутрь bullish POI. Первое касание не обязано быть stopping.
2. Цена может пройти глубже и торговаться внутри зоны.
3. В конце прихода появляется всплеск объёма.
4. Первая закрытая bullish-свеча на confirmation TF подтверждает stopping.
5. `stopLow` = минимальный low от POI arrival до этой bullish close включительно.
6. Происходит отскок; на первом отскоке входа нет.
7. Цена повторно снимает `stopLow`.
8. Sweep-свеча или следующая свеча закрывается обратно выше `stopLow` — защита.
9. Две свечи закрепились ниже — попытка failed.
10. После защиты формируется импульс вверх.
11. Затем появляется test: 1–2 bearish-свечи с объёмом ниже последней bullish impulse-свечи.
12. Первая закрытая bullish-свеча после успешного test — entry.
13. Stop ставится за sweep-extreme с диагностическим буфером.
14. Выходы первого теста:
    - полный TP 2R;
    - 50% на 1R и 50% на 2R.

Для SHORT всё зеркально.

### 14.3 Stopping

Volume spike и stopping confirmation — не одно и то же:

```text
ARRIVAL_VOLUME_SPIKE
→ первая close-свеча по направлению сделки
→ STOP_CONFIRMED
```

Для LONG stopping подтверждает первая bullish close, для SHORT — первая bearish close.

Экстремум остаётся динамическим до `STOP_CONFIRMED`.

### 14.4 Low-volume test

Для LONG:

```text
последняя bullish impulse-свеча задаёт reference volume
следующие 1–2 bearish test-свечи должны иметь volume ниже reference
```

Если объём test выше или равен reference:

```text
HIGH_VOLUME_TEST → попытка пропускается
```

### 14.5 Несколько попыток внутри одной POI

Failed confirmation не всегда уничтожает POI.

Пока HTF-зона активна:

```text
poiId
  attempt-1 → failed
  attempt-2 → failed
  attempt-3 → entered
```

Новый более глубокий low внутри bullish POI заменяет старый локальный экстремум до подтверждения stopping. Для SHORT зеркально.

### 14.6 Invalidation POI

Фитиль за границу POI не инвалидирует зону.

Для 4h POI достаточно одной 4h-свечи, закрывшейся телом за дальней границей.

## 15. Причины отказа confirmation

```text
no-stopping
no-rebound
no-second-sweep
failed-protection
second-extreme-break
high-volume-test
no-low-volume-test
no-resumption
poi-invalidated
```

Текущие названия диагностические и могут уточняться только после визуальной проверки.

## 16. Порядок дальнейшей разработки POI

1. Визуально проверить active/superseded lifecycle.
2. Проверить, что internal protected HL/LH отображаются.
3. Проверить, что EQH/EQL объединяются в одну зону.
4. Проверить, что промежуточные pivots одного structural leg не создают отдельные POI.
5. Заморозить POI-детектор.
6. Провести визуальный OOS на новых символах без перенастройки.
7. Вернуть refined confirmation с несколькими attempts.
8. Только после совпадения детектора запускать batch и временной OOS.

---

## 16.1 POI anchor/profile v0.6

Текущая реализация разделяет structural anchor и дальнюю границу. PROTECTED-STRUCTURE строится из causal history фактически назначенных protected levels. При отсутствии данных приватной TradingView heatmap дальняя граница является только OHLCV proxy по устойчивым wick/pivot bands; она не выдаётся за восстановленную ликвидационную карту. В visualizer добавлена ручная ground-truth разметка near/far, класса, источника, confidence и полностью пропущенных зон. Confirmation остаётся замороженным до visual OOS anchor detector.

Версия:

```text
liquidity-poi-0.9-freshness-consumption
```

## 16.2 POI structural areas v0.7

User review of 10 current-v0.6 BTC candidates: 1 correct, 3 too narrow, 6 wrong-zone. The OHLCV scoring boundary is rejected as an active rule; it often operated but did not repair wrong anchor selection.

Approved clarification from manual boxes:

- a POI is a significant structural area, not every protected/pivot record;
- important local zones may survive without a structure change when they represent a causal pullback in the aligned premium/discount half;
- nearby same-side anchors that describe the same liquidity area should be consolidated rather than displayed as duplicate zones;
- consolidation is causal: the old area exists until the newer component is known;
- no BTC-dollar distance is hardcoded. Connectivity uses overlap of the already approved diagnostic ATR boxes inside the same confirmed structural segment;
- the more external low (LONG) / high (SHORT) is the dominant near anchor; component ids/classes remain auditable;
- v0.6 wick/pivot scoring constants and the 240-candidate cap are removed;
- width remains the earlier diagnostic calibration (LONG 1.0 ATR, SHORT 0.5 ATR) until enough manual boxes freeze another boundary rule.

Version: `liquidity-poi-0.9-freshness-consumption`. Research-only; confirmation and PnL remain frozen.

## 16.3 POI validity/priority v0.8

Approved lifecycle correction after v0.7 visual QA:

- final invalidation for every POI class is one closed 4h candle beyond the far boundary; a wick does not invalidate;
- LOCAL-EQ remains valid after its first sweep and is invalidated only by the same far-close rule;
- assignment of a newer protected level is lineage supersession, not zone invalidation;
- validity, priority and interaction are independent fields;
- current map shows the nearest valid LONG, nearest valid SHORT and all valid OUTER areas; other unswept areas remain secondary/dormant and can become nearest again when price returns;
- matching overlapping areas may consolidate across an event-segment boundary while their validity windows overlap;
- canonical areas are emitted once. Historical geometry changes remain component metadata rather than hundreds of separate candidates;
- local areas become armed only after price closes away on the reaction side. Touch/retest is diagnostic and does not kill the area;
- no arbitrary time expiry is introduced. Old outer areas remain visible as outer context.

Version: `liquidity-poi-0.9-freshness-consumption`. Research-only; confirmation and PnL remain frozen.

## 16.4 POI freshness/consumption v0.9

Approved correction after v0.8 visual QA:

- structural failure and liquidity consumption are separate;
- after a zone is armed by a close away on the reaction side, the first later wick through near marks `CONSUMED`; it is no longer a fresh trading POI even without a far close;
- one closed 4h candle beyond far marks `FAILED`;
- `FORMING`, `FRESH`, `IN_PLAY`, `CONSUMED`, `FAILED`, `RETIRED` are explicit states;
- merged areas preserve component interaction history instead of restarting at the latest geometryKnownAt;
- a 4h OUTER is `RETIRED` on opposite CHoCH or a newer more-extreme same-side outer, preventing multi-year 4h boxes;
- new candidate class `LOCAL-SWING`: one confirmed outer high and low of each internal structural leg. It restores meaningful standalone local pivots without emitting every raw 2+2 fractal;
- consolidation is limited to simultaneously open areas; consumed/failed/retired history cannot contaminate a fresh zone;
- current map contains nearest fresh LONG, nearest fresh SHORT and current fresh OUTER;
- visual QA has current, captured-visible-history and full-audit modes. No N-bar expiry or absolute BTC distance is introduced.

Version: `liquidity-poi-0.9-freshness-consumption`. Research-only; confirmation and PnL remain frozen.

## 16.5 Liquidity heatmap indicator v0.6 (diagnostic layer)

Standalone module `src/core/liquidity/LiquidityHeatmapEngine.ts`, version `liquidity-heatmap-0.6-event-windows`. Coinglass-style potential-liquidation heatmap approximated from OHLCV only (no open interest / funding data). Reconstruction of the reference private TradingView "GGI Liquidity Heatmap" ("denser cluster = more liquidations", volume-prioritized).

- ONLY candles with significant relative volume (>= 1.25 x SMA20) open positions (entry = hlc3, sized by volume x price); this makes bands discrete events instead of a continuous wall of stripes;
- liquidation levels at entry x (1 +/- 1/L) for leverage tiers 5x/10x/25x/50x/100x with configurable shares; volume is the primary intensity driver;
- levels accumulate in logarithmic price bins (0.4%); adjacent bins alive at overlapping times merge into single cluster bands (max 3 bins tall) -> real densities instead of parallel duplicated stripes; cluster merging compares ACCUMULATION WINDOWS, not alive spans, so different eras of the same bin never merge;
- accumulation event windows: a contribution arriving more than 24 bars after the previous one opens a NEW band in the same bin (the old band stays alive and is swept together with the bin); bands therefore start where liquidity was actually accumulated instead of stretching from the bin birth across the whole chart;
- consumption: when price trades into a bin after formation, its liquidity is taken at that bar; later volume re-accumulates a NEW segment (no resurrection); swept segments that lived < 12 bars are dropped as near-price noise (active fresh ones are kept);
- brightness: per-side robust normalization, weight = min(1, (notional / ref)^0.5) where ref is the 90th percentile of that side cluster notionals (max when < 10 clusters); prevents one giant accumulation cluster from dimming the rest of the map (e.g. fresh liquidity under local lows); clusters below weight 0.18 dropped, output capped at top-600; renderer draws bands 2-8 px thick by cluster height + weight; all coefficients live in `LIQUIDITY_HEATMAP_CONFIG` and are display-only, NOT battle logic;
- visualizer: red = short-liquidation density above price, green = long-liquidation density below; band drawn from formation to consumption; age filter (500/1000/2000 bars / full history, default 500) hides stale liquidity by FRESHNESS: last accumulation time for active clusters (`lastContributionAt`) and sweep time for swept ones -- a bin born long ago but re-fed recently (e.g. 10x levels under fresh lows fed by entries at prices the market also visited months earlier) stays visible;
- v0.5 replaced; the layer does not feed battle/PnL/confirmation and is intentionally not yet a POI source (POI integration requires separate approval after visual QA).

# Часть IV. Подтверждённые расширения, ещё не включённые в forward

## 17. Новые таймфреймы

Подтверждены на двух окнах:

```text
45m / 2h / 3h / 4h
```

Они добавляют примерно `+41.6% opportunity R`, но требуют автоматического order manager и общей модели риска.

## 18. Touch-phase sizing

Исследовательский кандидат:

```text
first-5 skip: 0
early:        0.5
middle:       1.0
late:         1.5
```

Средний uplift R/unit по четырём выборкам около `+33.5%`.

Не включён в battle: размер resting limit должен изменяться до fill внутри HTF-бара. Применение multiplier после fill является look-ahead.

---

# Часть V. Закрытые направления

## 19. Не возвращать без новой информации

Отрицательны или нестабильны:

```text
mirror/reverse
fade141
повторный OTE cycle
механический 141/200/241 reaction
5m close confirmation entry
hard cutoff старых сеток
regime hard filters
local/global confluence filter
last-trade streak filter
win-streak sizing
удаление монет по observed PnL
выбор лучшего TF после просмотра результата
```

Полный автоматический аудит 141/241:

```text
141: 4404 сделки, −444.85R, avg −0.101R
241: 1192 сделки, −191.74R, avg −0.161R
устойчивых положительных вариантов: 0
```

Streak overlays не входят в план: causal same-symbol streak требует exit-time, кластеризации одновременных сделок и заранее заданного reset/cooldown. Историческое увеличение R без этих условий считается недоказанным.

---

# Часть VI. Правила исследовательского процесса

## 20. Обязательные требования

1. Все решения принимаются только по информации, известной в момент действия.
2. Новая идея сначала идёт в research runner, затем discovery/OOS, и только потом в battle.
3. Нельзя выбирать монеты, TF или параметры после просмотра их PnL.
4. Same-bar конфликт Stop/TP разрешается консервативно в пользу Stop.
5. Визуальная проверка детектора предшествует статистике.
6. Параметры и структурные предположения сначала предлагаются пользователю, затем фиксируются в SPEC, и только после этого реализуются.
7. Устаревшие версии не дописываются бесконечно в основной документ. Они заменяются новой действующей формулировкой, а подробности переносятся в архив.
8. `docs/CONTEXT.md` изменяется только по прямому запросу пользователя.

---

## 21. Архив

Подробная история прежнего монолитного SPEC сохранена здесь:

```text
docs/archive/SPEC-legacy-2026-07-21.md
```

Архив не является источником текущих правил и не должен использоваться для реализации без повторной проверки актуальности.
