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
liquidity-poi-2.0-liquidity-first
```

Текущая версия движка подтверждения:

```text
poi-confirmation-1.6-quiet-reanchor
```

Ранний прототип refined-poi-0.2 выведен из визуализатора и не развивается. Правила движков — §16.8–§16.12 (поверх §13–§15).

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

## 16.5 Liquidity heatmap indicator v1.0 (diagnostic layer)

Standalone module `src/core/liquidity/LiquidityHeatmapEngine.ts`, version `liquidity-heatmap-1.0-staggered-starts`. Coinglass-style potential-liquidation heatmap approximated from OHLCV only (no open interest / funding data). Reconstruction of the reference private TradingView "GGI Liquidity Heatmap" ("denser cluster = more liquidations", volume-prioritized).

- candles with relative volume >= 0.75 x SMA20 open positions (only truly dead bars are skipped: the 1.25x gate erased liquidity accumulated by the calm recent range, e.g. bands right above/below current price; walls are prevented by event windows + freshness filter instead) (entry = hlc3, sized by volume x price); this makes bands discrete events instead of a continuous wall of stripes;
- liquidation levels at entry x (1 +/- 1/L) for leverage tiers 5x/10x/25x/50x/100x with configurable shares; volume is the primary intensity driver;
- levels accumulate in logarithmic price bins (0.4%); adjacent bins alive at overlapping times merge into single cluster bands (max 3 bins tall) -> real densities instead of parallel duplicated stripes; cluster merging compares ACCUMULATION WINDOWS, not alive spans, so different eras of the same bin never merge;
- accumulation event windows: a contribution arriving more than 12 bars after the previous one opens a NEW band in the same bin (the old band stays alive and is swept together with the bin); bands therefore start where liquidity was actually accumulated instead of stretching from the bin birth across the whole chart;
- consumption: when price trades into a bin after formation, its liquidity is taken at that bar; later volume re-accumulates a NEW segment (no resurrection); swept segments that lived < 12 bars are dropped as near-price noise (active fresh ones are kept);
- brightness: rank-based per side, weight = (rank / count)^1.5 over clusters sorted by notional; guarantees a visible strength gradient (top clusters dark and thick, weak ones pale and thin) regardless of the notional distribution shape; clusters below weight 0.05 dropped, output capped at top-2000 (the old top-600 cap silently discarded fresh small clusters near price); renderer recomputes strength CLIENT-SIDE as a rank inside the currently visible window (side/age/swept filters): weight = rank/count per side, so the min-weight filter removes exactly that share of visible bands at any threshold (engine-global weights made the visible subset cluster above 0.55 and the filter felt dead until 0.75), and changing the age window never silently drops densities via a weight-sorted cap; bands are drawn from their TRUE accumulation start, so starts stagger naturally along price history like on TV (clamping old bands to the age-window edge produced an artificial vertical fence of aligned starts); together with the tighter 12-bar event-window gap, re-accumulation after an absence opens a NEW band at its own birth point instead of extending a months-old one; flat TV-like colors, one hue per side, strength expressed only by opacity 0.1-0.85 (quadratic) and thickness 2-8 px; default UI min-weight 0.35; all coefficients live in `LIQUIDITY_HEATMAP_CONFIG` and are display-only, NOT battle logic;
- visualizer: red = short-liquidation density above price, green = long-liquidation density below; band drawn from formation to consumption; age filter (500/1000/2000 bars / full history, default 500) hides stale liquidity by band BIRTH (`startAt >= cutoff`), matching the TV limited-lookback look: with 12-bar event windows any fresh re-accumulation births a NEW band, so filtering by birth cannot hide current liquidity, while continuously-fed multi-month bands from the deep past leave the default view; swept bands are hidden by default and available via the "show swept" toggle (their aligned right edges at a single sweep candle formed a fence of stale info);
- TF profiles (engine default when no explicit config is passed; timeframe inferred from median candle spacing): sub-4h -> minRelVolume 1.0, binPct 0.005, maxClusterBins 6; 4h -> minRelVolume 1.0, binPct 0.006, maxClusterBins 6; 1d and above -> minRelVolume 1.25, binPct 0.01, maxClusterBins 6 (v1.3: full-depth output exposed thousands of weak pools the old whole-history trim used to hide, so every tf now groups them into wide bands instead of a picket fence). weekly (>= 1w) -> minRelVolume 1.25, binPct 0.009, maxClusterBins 5 (half a step back per user feedback). Version `liquidity-heatmap-1.4-shelf-grouping`;
- v1.4 shelf view: a cluster counts as swept once price has consumed the MAJORITY (>= 50% of notional) of its bins, so tall bands no longer lie across the chart as active while price already trades inside them (previously ALL bins had to be swept); the visualizer gains a display-side grouping knob (off / 0.1% / 0.25% default / 0.5% / 1.2% price-gap merge of adjacent visible bands into shelves, no refetch needed), and display weight blends per-window rank with notional share (rank * (0.5 + 0.5*sqrt(notional/max))) so fat shelves are visibly fatter at any threshold;
- v1.5 honest shelves (bugfix of v1.4): display merge now requires TIME OVERLAP and same status (price-only chaining collapsed whole sides into one mega-shelf across epochs) and caps shelf height at 5x the merge gap; a pool is also swept as soon as price touches the bin of its DRAWN level (weighted mean != median: the 50%-mass rule could leave the line lying across candles). Version `liquidity-heatmap-1.5-honest-shelves`;
- v1.6 user-calibrated per-timeframe viewer defaults (viewer-only, engine untouched): switching the timeframe button presets the heatmap min-weight and merge knobs from user-tested combinations — sub-4h and 1w: all pools + normal merge; 4h: weight >= 0.55 + weak merge; 1d: weight >= 0.35 + weak merge. Values remain user-overridable after load;
- v2.0 oi-hybrid (accuracy pack): engine accepts optional aux series — open interest (contribution = positive OI delta normalised to the volume scale; covered bars without OI growth open no positions; Binance keeps ~30 days of OI history, so the older tail stays a volume proxy) and taker buy/sell ratio (per-candle long/short split instead of 50/50); liquidation distance now includes maintenanceMarginRate 0.004 (Binance BTC tier-1); pools expose remainingNotional (notional minus swept bins) and the viewer ranks active shelves by the remainder, so partially consumed shelves dim. Viewer: right-edge liquidity profile histogram, hover tooltip (size/remainder/age/contributions), magnet metric in the status line (nearest strong active shelf above/below with distance), OI/taker coverage badge. tools/research/validateHeatmap.ts backtests the magnet hypothesis walk-forward (strongest-shelf hit-rate vs weak-shelf and permuted-distance controls). Aux fetching is fail-soft; fixture/offline runs keep the volume proxy. Version 'liquidity-heatmap-2.0-oi-hybrid';
- full-depth output: the engine no longer trims pools by whole-history rank (minWeight default 0.05 -> 0, maxPools 2000 -> 10000 as a pure payload safety cap). Ranking by the entire loaded history starved the recent window: with 15k 1h candles the top-2000 slots went to fat 2024 pools and the fresh window drew ~3x fewer bands than with a 5k load. The only visual cuts are renderer-side: per-window rank threshold and the top-400 draw cap; when the payload safety cap binds, the engine keeps the NEWEST pools (by lastContributionAt), not the heaviest, so loaded history depth never changes what the fresh window shows;
- v0.7 replaced; the layer does not feed battle/PnL/confirmation and is intentionally not yet a POI source (POI integration requires separate approval after visual QA).

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

## 16.6 Visualizer QoL (22.07.2026)

- timeframes 1d and 1w added to the TF switch (TF_MS extended with `1w`); heatmap and analysis params are bar-based and apply unchanged;
- no auto-load on page open: the user picks symbol/TF/limit and presses Load (BTC/USDT stays the default symbol);
- candle fetching is parallel: page windows are precomputed from the fixed since..end range and fetched in batches of 6 with timestamp dedup (short histories return the same left edge on early pages), replacing strictly sequential pagination — main win on the 10k-30k 5m context fetch.

## 16.7 POI Confirmation 1.1/1.2 (23.07.2026)

Правки поверх §14 после визуального QA пользователя (BTC 4h → 15m):

- **Causality / geometryKnownAt.** Окно подтверждения начинается с `max(knownAt, geometryKnownAt)`: у консолидированных областей `knownAt` наследуется от самой ранней компоненты, а итоговые границы становятся известны позже. Сканирование от старого `knownAt` было look-ahead — зона «отрабатывала» за недели до того, как её геометрия существовала.
- **Touch = вход со стороны сделки после re-arm.** Касание засчитывается только когда цена, полностью отойдя от зоны (LONG: `low > near + 0.25*ATR` confirmation TF), входит в неё. Бар рождения зоны, фитильный спам у границы и вход с противоположной стороны (снизу для LONG после прошива зоны на confirmation TF) касаниями не являются. После каждой попытки требуется новый re-arm.
- **Zone-extreme anchoring.** Динамический экстремум попытки инициализируется самым глубоким экстремумом зоны, накопленным по всем барам внутри зоны за всё окно, а не экстремумом бара касания. Повторный заход с более мелким локальным экстремумом строит stopping вокруг исходного экстремума зоны (обобщение правила §14.5 «более глубокий low заменяет старый»).
- **Исход позиции.** После entry позиция доигрывается до stop/TP по всей доступной истории, даже если окно зоны (`endAt`) закончилось. Раньше такие сделки помечались `open`, хотя визуально позже получали стоп вне окна.
- **Nearest tie-break (Liquidity POI).** При равной дистанции до цены (перекрывающиеся зоны с общей near-границей) nearest получает зона с far по реальной ликвидности (`liquidity-cluster`), затем более старший класс.

Версия: `poi-confirmation-1.2-armed-touch` (промежуточная 1.1-zone-extreme в бой не выходила). Буфер re-arm `0.25*ATR` — диагностический, менять только по итогам визуального QA.

Открыто: `sweptNear` для outer-swing (сейчас false — зона не становится consumed); судьба ATR-fallback far-границ (в визуализаторе скрыты по умолчанию как не основные, но движок их создаёт и confirmation их обсчитывает).

## 16.8 Liquidity POI 1.1 + POI Confirmation 1.3 — унификация v1.7 (23.07.2026)

Решения пользователя от 23.07.2026 поверх §13/§14/§15/§16.7. Мотивация: диагностика v1.0/1.2 на реальных BTCUSDT (2000×4h, 333 дня + 10 752×15m, 112 дней) показала мёртвую воронку — 399 зон → 48 попыток → 1 вход; все 188 local-зон дали 0 попыток, потому что consumed-правила §13.1/13.2 закрывали окно торговли в момент первого касания.

### Зоны (liquidity-poi-1.1-causal-liquidity)

- **Единое окно торговли для всех классов.** Класс зоны (outer-swing / protected-structure / local-eq / local-swing) — метаданные происхождения, на подтверждение не влияет. Окно: `[max(knownAt, geometryKnownAt), endAt)`, где endAt — самое раннее из: **failed** (4h close телом за far, §14.6 — единственная ценовая смерть), **retired** (только outer: противоположный CHoCH / более крайний same-side экстремум, §13.3), **spent** («зона отработала», ниже). Правила смерти из §13.1 (local: первый свип near) и §13.2 (protected: close за near) ОТМЕНЕНЫ.
- **Consumed — информационная пометка**, не состояние lifecycle: `consumedAt` = первый фитиль сквозь near после взведения, одинаково для всех классов (закрывает открытый вопрос sweptNear для outer из §16.7). Состояния: forming / fresh / in-play / spent / failed / retired.
- **«Зона отработала» (spent)** — замена лимита попыток (MAX_ATTEMPTS_PER_POI=6 удалён по согласованию): **ran-away** — после касания цена ушла от near в сторону реакции на `spentDistanceAtr = 3.0` ATR зоны по close (POI-движок, состояние spent); **tp-hit** — попытка дошла до тейка 2R (фиксирует confirmation, дальше зону не торгует, endAt результата обрезается по тейку). Нетронутые зоны не экспирируются (§16.3 сохраняется).
- **Каузальный far.** Вес пула = (rank/count)^1.5 по notional среди пулов, ЖИВЫХ на knownAt зоны и находящихся В ПОЛОСЕ ПОИСКА (near ± `farLookbackAtr = 2.0` ATR); порог `farMinWeight = 0.4`. Глобальный вес heatmap-движка ранжирует по всей загруженной истории, включая будущие пулы, — от него геометрия зон зависела от limit (36% зон, в среднем 0.87 ATR). Проверка после фикса: у зон последних 600 баров far идентичен при загрузке 1200 и 2000 баров (0% различий); остаток различий у старых зон — покрытие пулов историей (грузить достаточную глубину), не логика.
- **knownAt локальных пивотов** = закрытие подтверждающего бара i+2 (+tfMs). Раньше брался его open — зоны были известны на бар раньше возможного (63% local-зон); теперь 0%.
- **SPEC §13 латентный фикс:** CHoCH без подтверждённого предыдущего противоположного события пропускается (якорь от начала датасета не строится).
- **Кросс-классовая склейка** перекрывающихся одновременно ОТКРЫТЫХ зон одной стороны (§12.2 уточнён: такие области — торгово одна зона; componentClasses сохраняют происхождение). Склейка по пересечению времени жизни проверена и ОТКЛОНЕНА: цепочки поглощений строят мега-зоны, каждое поглощение сдвигает geometryKnownAt вперёд и съедает окно подтверждения (воронка падала до 19 попыток / 0 входов).
- ATR-fallback ширины (LONG 1.0 / SHORT 0.5 ATR) остались только для карты.
- Все константы — в `LIQUIDITY_POI_CONFIG` с комментариями; менять только по согласованию.

### Подтверждение (poi-confirmation-1.3-unified-window)

Единая последовательность для любой зоны (15m для 4h POI, §14.1); fallback-зоны (`boundarySource !== 'liquidity-cluster'`) не торгуются:

1. Взведение/re-arm `rearmAtr = 0.25` ATR — без изменений (v1.6).
2. Заход. Диагностика `arrivalVolumeRatio` = объём 4h-бара захода / SMA20 предыдущих — пометка «пришли на объёме», НЕ фильтр. Требование volume spike из §14.2 шаг 3 УДАЛЕНО (пользователь его не вводил).
3. Остановка: первая close по направлению. **Лой попытки = экстремум ТЕКУЩЕГО захода** (динамический до остановки, §14.5 в пределах захода). Наследование экстремума всей зоны (v1.5 zone-extreme anchoring) отменено; вместо него QA-пометка `sweptZoneExtreme` (снял ли пересвип самый глубокий экстремум зоны за окно).
4. Отскок ≥ `reboundAtr = 0.5` ATR от лоя без его снятия; минимум «2 бара» удалён.
5. **Катящиеся перезапуски (RESTART):** новый лой до отскока — не отбраковка, а более глубокий заход (лой обновляется, ждём новую остановку). Две подряд close ниже лоя, но внутри зоны (≥ far) — перезапуск от нового экстремума; две close ЗА far — отбраковка `broke-below-zone` (уточнённая реализация §14.2 шаг 9).
6. Пересвип лоя попытки → защита: close обратно выше лоя на свип-свече или следующих. Фитиль глубже свип-экстремума до входа — новый пересвип (защита заново), не смерть.
7. **Тест слабости (§14.4 заменён):** вход на первой close по направлению, у которой предыдущая свеча откатная и объём свечи ВОЗОБНОВЛЕНИЯ ВЫШЕ объёма последней откатной (пример: откаты 80/60/40, возобновление 50 → 50 > 40 → вход). Объём возобновления сам по себе не ограничен; «не тест» — просто ждём дальше.
8. **Отмена входа:** риск (entry→stop) > `entryMaxRiskAtr = 1.5` ATR — ENTRY_CANCELLED в трейсе, попытка ждёт следующий тест ближе.
9. Стоп за минимальным экстремумом всей пересвип-последовательности + `stopBufferAtr = 0.05` ATR; тейк `tpR = 2`; позиция доигрывается за endAt (v1.6). Один таймаут попытки `attemptTimeoutBars = 96` (окна 30/20/60/30/20 из 1.2 удалены). Лимита попыток нет.
10. Причины отбраковки (заменяют список §15 для confirmation 1.3): `timeout@{stopping|rebound|sweep|protect|entry}`, `broke-below-zone`, `zone-ended`; ENTRY_CANCELLED — событие трейса внутри живой попытки.
11. `ltfCoverage` (none/partial/full) в результате: при none попыток нет из-за ДАННЫХ; partial сканируется с начала 15m-истории (взведение с нуля, консервативно).

Все константы — в `POI_CONFIRMATION_CONFIG`; значения 96 / 1.5 / 3.0 — стартовые, калибруются по визуальному QA.

### Диагностический прогон (не PnL)

BTCUSDT 2000×4h + 10 752×15m, heatmap на volume-proxy (без OI/taker): v1.0/1.2 — 399 зон, 48 попыток, 1 вход (стоп); v1.1/1.3 — 393 зоны, 213 попыток, 28 входов (15 tp / 13 stop, gross). Это здоровье воронки для визуального QA, НЕ оценка edge: batch и PnL по POI-ветке остаются замороженными до визуальной приёмки. Отбраковки: timeout@sweep 85, zone-ended 53, timeout@entry 30, broke-below-zone 15. 66% зон родились до начала 15m-истории (серые «нет 15m данных» в визуализаторе).

### Открыто после v1.7

- Историческая дедупликация умерших перекрывающихся зон (склейка сейчас только для одновременно открытых; семантика «обе открыты» оценивается на конец загруженной истории — карта может отличаться при загрузке в разные дни; принятый компромисс до отдельного решения).
- Калибровка стартовых значений 96 / 1.5 / 3.0 и порога «пришли на объёме» (пока показывается коэффициент без порога) по визуальному QA.
- Telegram-уведомления с пометкой объёма прихода (пользователь упоминал как желаемое).

## 16.9 v1.8: невыметенный якорь, проторговка, дедупликация (23.07.2026, после визуального QA)

Правки поверх §16.8 по итогам первого визуального QA пользователя (6 скринов, BTC 4h → 15m). Диагноз по данным: медиана «касание → остановка» и «остановка → отскок» была 1 бар 15m — машина состояний работала на скорости свечного шума и штамповала циклы внутри одного движения; подтверждение строилось вокруг мелких свежих экстремумов, игнорируя невыметенные фитили с реальными стопами; local-swing плодил зоны в пустынях ликвидности; 45% торгуемых зон имели near-дубль.

### Подтверждение (poi-confirmation-1.4-unswept-anchor)

- **Якорь пересвипа = самый глубокий НЕВЫМЕТЕННЫЙ экстремум зоны.** Суть стратегии (формулировка пользователя): ритейл влетает в позицию у зоны, их стопы — за лоем; мы не участвуем в отскоке и ждём снятие ИМЕННО ЭТИХ стопов. Якорь копится по всем барам внутри зоны, переживает отбраковки и повторные заходы, и «тратится» свипом — после свипа новый якорь копится с этого момента (выметенный экстремум не возвращается: стопов под ним больше нет). Отменяет «лой текущего захода» из §16.8 (решение №9): свежий мелкий заход больше не прячет верхний фитиль. Абсолютный экстремум окна остаётся отдельной QA-пометкой sweptZoneExtreme.
- **Остановка = проторговка, а не первая направленная свеча:** направленное закрытие засчитывается, только если экстремум попытки не обновлялся ≥ `stopQuietBars = 4` бара. Для старого невыметенного якоря тишина считается давно выполненной — остановка на первом направленном закрытии (проторговка у того лоя уже была).
- **Отскок = время:** ≥ `reboundMinBars = 6` баров от остановки без нового экстремума; порог расстояния `reboundAtr = 0.5` ATR остаётся нижней планкой (диапазон одной средней свечи покрывал его мгновенно — расстояние без времени неинформативно).
- **Смерть попытки по БЕЗДЕЙСТВИЮ:** `attemptIdleBars = 96` баров подряд без единого события трейса (вместо будильника «96 от касания» из §16.8 — тот убивал попытку за 1 бар до реального пересвипа при живой структуре). Перезапуски и события продлевают жизнь; пробой зоны вниз и конец окна зоны работают как раньше.
- Результат на диагностике: медианы «касание → остановка» 1 → 4 бара, «остановка → отскок» 1 → 6; мгновенных отскоков (≤2 баров) 89% → 0%; попыток с ≥3 пересвипами 27% → 13%. Воронка сжалась осознанно: 213 попыток / 28 входов → 94 / 5 — меньше, но по правилам пользователя. Открытый калибровочный вопрос: после валидного свипа и теста слабости входы часто отменяются гардом `entryMaxRiskAtr = 1.5` (цена уже далеко от стопа) — на следующем QA решить: поднять порог, входить лимиткой на ретесте или оставить строгим.

### Зоны (liquidity-poi-1.2-deduped)

- **local-swing удалён** (решение пользователя): экстремум каждого внутреннего колена плодил «мелкосопочные» зоны без заметной ликвидности (кейс скрина: LOCAL-SWING 65505 при всей ликвидности на 63.5–64.3k). Класс давал 57 зон / 47 попыток / 8 входов шума. Классы зон наружу больше не разделяются: фильтр по классу убран из визуализатора, происхождение — строка в деталях.
- **Подавление near-дублей (§16.9, решение №20):** зоны одной стороны с near в пределах `dupNearAtr = 0.25` ATR и пересекающимися окнами — одна область: остаётся старшая (сначала реальная ликвидность на far, затем класс, затем возраст), младшие получают `duplicateOf` и не торгуются/не показываются. Геометрия НЕ мутирует — окна подтверждения стабильны (в отличие от отклонённой в §16.8 склейки по времени жизни). На BTC-диагностике подавлено 122 дубля, торгуемых первичных зон 188.
- Склейка одновременно открытых зон (§16.8) сохранена и работает до подавления.

Версии: `liquidity-poi-1.2-deduped`, `poi-confirmation-1.4-unswept-anchor`. Тесты 283/283, tsc чистый. Batch/PnL по POI-ветке остаются замороженными до визуальной приёмки.

Открыто после v1.8: калибровка гарда входа (1.5 ATR) против лимитки на ретесте; пороги 4/6/96 по следующему QA; порог «пришли на объёме» для UI/уведомлений; merge-семантика «обе открыты» зависит от момента оценки (принятый компромисс).

## 16.10 v1.9: непрерывность пересвипа, сквозной проход, условная отставка, стековый far (23.07.2026)

Правки поверх §16.8/§16.9 по второму визуальному QA (9 скринов). Все кейсы воспроизведены на данных до правок и перепроверены после.

### Подтверждение (poi-confirmation-1.5-persistent-sweep)

- **Потеря защиты не перезапускает последовательность.** Две close за якорем внутри зоны переносят якорь на новый экстремум (событие ANCHOR_DEEPENED) и попытка ждёт ЕГО пересвип — остановка и отскок уже состоялись. Раньше полный RESTART требовал новую остановку+отскок и «сжигал» идеальные пересвипы (кейс: спайк 15.07 15:00 к 65600 не засчитался пересвипом). RESTART остаётся только для снятия лоя до отскока.
- **Тест слабости и отмена входа не продлевают жизнь попытки** (не сбрасывают idle-таймер): попытка умирает через attemptIdleBars после последнего СТРУКТУРНОГО события. Кейс: попытка на зоне 55451–58388 жила 4 дня с 33 отменами входа — растущий рынок бесконечно кормил её слабыми тестами; теперь смерть через сутки после защиты (71 событие → 19).
- **Попытка с состоявшимся пересвипом доигрывается за концом окна зоны** (симметрично «позиция доигрывается за endAt»): окно нужно для поиска сетапа, а не для обрыва его развязки. Попытка без пересвипа обрезается как раньше (`zone-ended`). Новая причина `data-end` — край данных при живой попытке со свипом.
- **Стоп за структурой, а не за фитилём:** если исторический экстремум окна глубже свип-экстремума в пределах `stopLookbehindAtr = 0.5` ATR — стоп ставится за ним. Кейс: вход со стопом 74206.38 под свип-фитилём 74218 при историческом лое 74203.6 — рынок дошёл до 74206.4, выбил и развернулся; со стопом за 74203.6 сделка бы жила.

### Зоны (liquidity-poi-1.3-stack-far)

- **Проход насквозь = отработана (swept-through).** Фитиль за far снимает весь стек — зона отработана; момент = ЗАКРЫТИЕ бара прохода (+tfMs), чтобы подтверждение доиграло сам бар прохода на 15m. Отменяет для торговли часть §14.6 («фитиль за far не инвалидирует», v0.8): провал по close остаётся отдельным состоянием failed. Кейс: зона 64497–65562 пережила сквозной спайк 15.07 и собрала мусорные заходы 18–19.07.
- **Противоположный CHoCH ретирит только УЖЕ ТРОНУТУЮ outer-зону** (правка §13.3, v0.9): нетронутый экстремум с живыми стопами структурный флип не хоронит — зона ждёт цену. Кейс: outer short 67255→68366 (вершина 16.06) был ретирнут 02.07 при 0 касаний и 11.5B живой ликвидности над ним; ближайшим шортом становился огрызок 74293 в 8k пунктов. Отставка по новому более крайнему same-side экстремуму — без изменений.
- **Far тянется по СТЕКУ ликвидности** («конец кластеров», §12.1 буквально): к базовым пулам стартовой полосы (2 ATR, каузальный вес) присоединяются более глубокие пулы, если (а) перекрытие или разрыв ≤ `stackGapAtr = 0.5` ATR, (б) пул НЕ СЛАБЕЕ медианы базовых по notional (стек идёт к жирным полкам, а не по шумовой лестнице ликвидаций), (в) итоговая ширина ≤ `stackMaxAtr = 6` ATR (без потолка far утаскивало на +128% от цены: лестница ликвидаций непрерывна почти всегда). Кейс 67255: far 68366 (обрезался жёстким окном 2 ATR) → 70442, зона накрывает полки 67976 (7.6B) и 69363 (11.5B) и становится корректным ближайшим шортом.
- Визуализатор: линия текущего якоря (жёлтый пунктир от остановки/переноса до следующего события), причина отказа по-русски, свёртка серий тест/отмена в трейсе, статусы «прошли насквозь».

### Диагностика (BTCUSDT 2000×4h + 10 848×15m, не PnL)

v1.8 → v1.9: 94 попытки / 5 входов → 100 / 12 (8 stop / 4 tp gross — диагностика воронки). Ширина зон: 1.4–1.7 ATR (жёсткое окно) → 2.4–3.3 ATR (стек с медианным фильтром). Подавлено 119 near-дублей. Открыто: калибровка гарда входа (1.5 ATR) — часть валидных сетапов после глубокого свипа отменяется по риску (три отмены в кейсе 64497–65562 при снятой вершине); альтернатива — лимитка на ретесте; решить после следующего QA. Значимость зон по силе ликвидности за near — кандидат v2.0.

Версии: `liquidity-poi-1.3-stack-far`, `poi-confirmation-1.5-persistent-sweep`. Тесты 289/289, tsc чистый.

## 16.11 v1.10: проторговка после переноса якоря, дедуп по перекрытию (23.07.2026, третий QA)

- **Потеря защиты → якорь переносится И подтверждение строится заново** (проторговка stopQuietBars у нового экстремума + отскок reboundMinBars). Мгновенный пересвип нового якоря (v1.9/§16.10) давал входы «одним движением»: свип-защита-тест-вход за час без отката (QA скрины 1-2: «этот фитиль должен стать тем хаем, который надо пересвипнуть; нужен хоть какой-то откат, плюс проторговка»). Возврат к строгой перестройке безопасен: смерть по будильнику (из-за которой её ослабляли) уже устранена idle-таймером и доигрыванием за окном (§16.9/§16.10).
- **Дедуп по перекрытию:** зоны одной стороны с пересечением диапазонов ≥ `dupOverlapShare = 0.6` меньшей зоны — дубль (в дополнение к близости near ≤ 0.25 ATR). QA скрин 3: два стопа «по факту в одной зоне», у которой near чуть выше/чуть ниже.
- Диагноз без правки (ждёт v2.0): на 5000 барах «важные» шорты — древние нетронутые вершины 84.6k/97.9k/116.4k (условная отставка §16.10 оставляет их свежими навсегда); зоны «в воздухе» — far от старых пулов, невидимых в heatmap-вьюере с фильтром возраста 500 баров; исчезновение зоны 67255→70442 у пользователя — вероятно касание 23.07 + падение на 2k → ran-away (правило «3 ATR от near» преждевременно хоронит широкие стековые зоны с живыми полками). Всё это решается переходом к значимости/жизни зон ОТ ЛИКВИДНОСТИ (v2.0): зона жива, пока жив её стек; значимость = сила и свежесть полок.

Версии: `liquidity-poi-1.4-overlap-dedup`, `poi-confirmation-1.6-quiet-reanchor`. Тесты 289/289.

## 16.12 Liquidity POI 2.0 — «зоны от ликвидности» (утверждено 23.07.2026, к реализации)

Решение третьего визуального QA: генерация зон от структурных записей (protected/EQ/outer) исчерпана — три раунда подряд карта системы расходится с ручной картой пользователя, у которого каждая зона = жирная полка heatmap + ближайший экстремум. Утверждён разворот: **зоны рождаются от ликвидности, структура — пометка**.

### Правила v2.0

1. **Полка** = стек живых пулов одной стороны (перекрытие или разрыв ≤ 0.5 ATR — механика §16.10).
2. **Значимость полки = сила × свежесть.** Зону рождает только полка из топовых по notional на свою сторону, кормившаяся недавно (окно свежести согласовать с age-фильтром heatmap-вьюера, по умолчанию 500 баров ТФ зоны по последнему пополнению). Древние нетронутые вершины (84k/97k/116k) и невидимая пользователю старая ликвидность зон больше не рождают.
3. **Границы:** far = дальний край стека. near = точный wick ближайшего невыметенного 4h-экстремума непосредственно перед полкой (в пределах ~0.5 ATR от ближнего края — §12.1 «точный фитиль значимого экстремума»); если такого экстремума нет — near = ближний край полки (зоны «обрамляют полку», как ручные зоны 1/5 пользователя).
4. **Направление** — сторона полки: buy-side ниже цены → LONG, sell-side выше → SHORT. Контртрендовые локальные зоны отдельно не фильтруются (сторона полки уже задаёт смысл); pdAligned остаётся диагностической пометкой.
5. **Жизнь зоны = жизнь её стека:** смерть — 4h close телом за far (провал), фитиль насквозь (swept-through), снятие большинства объёма стека (по remainingNotional пулов), tp-hit. Правило ran-away «3 ATR от near» ОТМЕНЯЕТСЯ (преждевременно хоронило широкие стековые зоны с живыми полками — кейс 67255→70442 после касания 23.07). Отставка по CHoCH не применяется (жизнь определяет ликвидность).
6. Геометрия замораживается на knownAt (пулы, живые на момент рождения); рост стека после рождения зоны не мутирует её — новый кандидат от выросшей полки подавляется дедупом (§16.9/§16.11), пока старшая зона жива, и живёт после её смерти.
7. Классы outer/protected/local-eq перестают рождать зоны; в кандидате остаётся пометка «на структуре» (совпадение near с невыметенным структурным экстремумом). Дедуп (near 0.25 ATR / перекрытие 0.6), склейка открытых, PD-поля, ltfCoverage, версии/интерфейс LiquidityPoiCandidate — сохраняются, чтобы подтверждение 1.6 и визуализатор работали без изменений.
8. Same-bar защита в подтверждении подтверждена пользователем (свип-свеча, закрывшаяся обратно, — валидная защита; §14.2 без изменений).
9. Честная оговорка: notional пула в heatmap-движке — финальный накопленный; на момент t полка могла быть тоньше. Для визуального QA приемлемо (research-only), перед batch — доработать пер-временной notional в heatmap-движке (v2.1).

### Статус реализации (23.07.2026, вечер): ядро v2.0 реализовано

`liquidity-poi-2.0-liquidity-first`: сканирование полок по времени (живые пулы стороны, кластеризация stackGapAtr 0.5, значимость = топ-N по notional И доля ≥ shelfMinShare от свежей стороны), рождение зоны на закрытии бара (строгие границы жизни пулов), near = wick невыметенного фрактала в пределах nearTolAtr от края полки / иначе край, far = конец стека (потолок stackMaxAtr 6), эмиссия один раз на поколение пулов — перерождение при обновлении ≥ shelfNoveltyShare notional (re-accumulation), смерти: провал (close за far) / насквозь (swept-through, close бара прохода) / стек снят (stack-consumed ≥ stackConsumedShare по sweptAt пулов) / устарела (retired: стек не кормился shelfFreshBars — выключает древние вершины, которых пользователь не видит в heatmap с age-фильтром). Ran-away и CHoCH-отставка удалены. Дедуп near/overlap сохранён; подтверждение 1.6 работает без изменений (интерфейс кандидата сохранён; makePoi-легаси классы в типах).

Диагностика на 5000×4h: активная карта уже близка к ручной карте пользователя — лонги 59.2–61.0k и 61.5–63.6k (его синяя/фиолетовая), шорт 65.6–74.1k in-play (накрывает его зону 4: 67.8–70.3k), дальние шорты 78.9–86.2k; всего зон 231, активных 7.

### Параметры к калибровке следующим QA (все в LIQUIDITY_POI_CONFIG)

shelfTopN (сейчас 5), shelfMinShare (0.05), shelfFreshBars (500 — окно свежести великовато: майские мега-полки конкурируют с текущими), shelfNoveltyShare (0.5), nearTolAtr (0.5), stackConsumedShare (0.5), stackGapAtr (0.5 — зона 65.6–74.1k слиплась широковато), stackMaxAtr (6).

### Редизайн визуализатора (утверждено, отдельная работа)

Строгий минимализм в стиле shadcn/ui + Vercel (их компоненты можно использовать): аккуратная типографика, тёмная строгая тема, больше настроек/кастомизации (конфиги движков в UI). Сохранить: запуск npx tsx tools/visualizer/server.ts, отсутствие автозагрузки, панели Heatmap / POI / Confirmation / Decision Lab, «Зоны на 4h», русские подписи. Не сломать сценарий «склонировал и запустил» (вариант без сборки или закоммиченный dist — согласовать).

## 16.13 Liquidity POI 2.1 — полки из провалов плотности, потолок в % цены (24.07.2026, четвёртый QA)

Калибровка v2.0 → v2.1 по скринам четвёртого визуального QA (BTC 4h, limit 5000, цена ~65.4k). Все кейсы воспроизведены на данных до правок (5000×4h до 22.07.2026 включительно, архивы data.binance.vision, volume-proxy без OI/taker — гео-блок песочницы): карта v2.0 совпала с диагностикой §16.12 один в один (231 зона / 7 активных).

### Диагноз (воспроизведён)

- **Зоны-гиганты = потолок 6 ATR на мега-цепях склейки по краям полос.** SHORT 65563→74051 h=8489 — ровно 6.0×ATR(1415), полка из 189 пулов (склейка протащила цепь 65.9k→98k); LONG 63631→61473 h=2158 — ровно 6.0×ATR(360), 132 пула; гигант пользователя 58900→48323 h=10623 ≈ 6×1770 — тот же механизм при высоком ATR рождения.
- **«Шортовой зоны нет»** — единственная in-play зона и была ближайшим шортом; её прятал дефолт фильтра «Fresh — готова».
- **Столбы фиолетовых P** — pivotTimes v2.0-зоны = startAt всех пулов полки (у монстра 189 маркеров при фокусе).

### Отрицательное знание: кластеризация по ядрам отвергнута

Согласованный планом вариант «ядра (extremePrice) + gap 0.25 ATR» проверен на реальных полках и не работает в обе стороны: 0.25 ATR дробит волатильную полку на 47 осколков; 0.5 ATR дробит спокойную на 42 осколка (ATR 360, шаг соседних ядер ~370 п. > 180) И оставляет мега-цепь 74.5–98k из 177 пулов (шаг 400–700 п. < 707). Причина фундаментальная: шаг лестницы ликвидаций задан бинами heatmap в % от цены, а не в ATR — дистанция между ядрами полки не разделяет. Полки разделяют ПРОВАЛЫ МАССЫ: профиль notional свежих пулов показал, что все 5 ручных зон эталона = горбы, все пустоты между ними = провалы ниже ~25% пика.

### Правила v2.1 (утверждены 24.07.2026)

- **Полка = супер-цепь, разрезанная по провалам плотности.** Супер-цепь — склейка полос §16.10 (stackGapAtr 0.5 без изменений). Профиль цепи: notional пула размазывается по лог-корзинам `shelfProfileBinPct = 0.004` (= бин heatmap 4h); провал = ≥ `shelfValleyMinBins = 3` корзин подряд с массой < `shelfValleyShare = 0.25` × пик профиля цепи; разрез по середине провала, пулы распределяются по ядрам. Тонкие хвосты цепи отрезаются теми же правилами и умирают о значимость.
- **Потолок высоты: `stackMaxAtr` (6) УДАЛЁН → `stackMaxPct = 0.08` от цены ближнего края.** ATR-потолок нестабилен между режимами: 6 ATR при рождении в волатильность = 9–11k (гиганты), а рассматривавшийся min(3 ATR, 8%) в спокойном режиме (ATR 360–1050) резал бы эталонные ручные зоны 4.5k/3.5k ногой 1.1–3.2k. Самая высокая ручная зона 53.5–58k = 4.5k ≈ 7.8% от края 58k.
- **`shelfFreshBars` 500 → 300** (50 дней на 4h): майские мега-полки перестают конкурировать в топ-N и в знаменателе shelfMinShare; та же константа раньше гасит устаревшие зоны (retired) — короче линии «через весь график».
- **`shelfMinShare` 0.05 → 0.03**: после разреза цепей нотионалы полок упали — 0.05 убивал эталонную полку 63–64.2k (6.7B при поле 7.5B).
- **Дедуп: гард сопоставимой высоты `dupMaxHeightRatio = 2.0`** для правила перекрытия (§16.11 писалось под «два стопа в одной зоне»): полка, выросшая после ре-аккумуляции сильнее 2× вокруг старой узкой зоны, — не дубль, живёт рядом отдельным объектом; геометрия и окна подтверждения не мутируют (заморозка §16.12 п.6 сохранена). Кейс: 12B на 56–57.5k оставались без активной зоны — старшая узкая 54792→52860 гасила выросшую 53.2–57.4k (перекрытие 0.83 меньшей). Вариант «выросшая ОТСТАВЛЯЕТ старую» отклонён пользователем: каждый рост сбрасывал бы окно подтверждения (риск мёртвой воронки §16.8). Известный остаток: цепочка поколений с шагом ≤2× всё ещё может маскировать верх выросшей полки (57446→53197 — дубль промежуточной 55515→52545, ratio 1.43) — решение по следующему QA.
- **`LiquidityPoiContext.config`**: Partial-переопределение констант движка (диагностика вариантов, конфиги движков в UI визуализатора); дефолты и правило «менять только по согласованию» без изменений.

### Карта после калибровки vs эталон (5000×4h, close 66082, volume-proxy)

Эталон пользователя (при 65033): лонги 53.5–58 / 59.5–61.5 / 63–64.2, шорты 67.8–70.3 / 72.8–76.3. Движок (активные, 14 шт, max h 3516 ≈ 4.9% цены — гигантов нет): ближайший шорт 67553→70022 (≈ зона 4), 68777→71718 + 71718→75233 (накрывают зону 5, near ниже на ~1.1k), ближайший лонг 64397→62874 (≈ зона 3, живёт при minShare 0.03), 60657→59578 (зона 2, far в точности эталонный), 55515→52545 + 54792→53496 (низ зоны 1; верх 55.5–58 — известный остаток дедупа выше). Фон: мелкие 62874→61756 и 58870→58170 (реальная масса в прокси-данных), глубокие лонги 46.9–51.9, дальний шорт 78.6–81.3. Оговорка: у пользователя OI-гибрид — состав свежих пулов может отличаться, финальная сверка по его скринам.

### UI-фиксы (вне редизайна)

P-маркеры не рисуются для зон liquidity-shelf; дефолт фильтра статуса — новая опция «Открытые — готова или в игре» (value=open); справка панели зон переписана под v2.1; заголовок панели — Liquidity POI 2.1.

Версии: `liquidity-poi-2.1-valley-shelves`, `poi-confirmation-1.6-quiet-reanchor` (подтверждение не менялось). Тесты 284/284 (+4 новых: разрез по провалу, потолок 8%, свежесть 300, гард высоты), tsc чистый, node --check чистый. Batch/PnL по POI-ветке остаются замороженными до визуальной приёмки.

## 16.14 Liquidity POI 2.2 — родство стеков, сила полки (24.07.2026, пятый QA)

Кейсы пятого QA (BTC + ETH, скрины пользователя): пары «одинаковых» зон (BTC 67553→70022 / 68776→71718; 79394→81317 / 77517→79871), тройка вложенных лонгов на ETH с одним far 1655.38 (1767.97 / 1705.64 / 1675.31), мизерные зоны (ETH 1358→1350.72 высотой 0.5% из ОДНОГО пула 560M), зона без видимой ликвидности (BTC 48888→47749 из бледных пулов, скрытых фильтром веса heatmap-вьюера), лаги и «пропадание» графика при фильтре «любой статус». Все кейсы воспроизведены на данных до правок (BTC + ETH 5000×4h до 22.07, volume-proxy).

### Диагноз

- **Пары = «близнецы» одного стека.** Окно полки сползает за день (у цены копятся новые пулы), рождается новое поколение: пара BTC делит **71% notional** (11.5B общих пулов) при перекрытии ЦЕН всего 50% < dupOverlapShare 0.6 — ценовой дедуп слеп к родству. Вложенные тройки ETH — то же самое при росте полки вверх (гард высоты §16.13 отпускал каждую ступень > 2×).
- **Мизеры** — одно-пульные полки тонких периодов: проходят относительные фильтры рождения (topN, minShare от свежей суммы стороны), но их стек — единицы процентов от сильнейшей полки стороны.
- **«График пропадает»** — зоны с far на 30k/98k участвовали в автошкале цены: свечи сплющивались в линию; лаги — полная перезаливка свечей на каждое переключение фильтра.

### Отрицательное знание (проверено и отвергнуто)

- **Пик-фильтр рождения** (полка ≥ доли сильнейшей полки бара): выбивал ранние мелкие эмиссии-«прививки» реестра поколений — выросшие полки позже рождались гигантами одним куском (LONG 58870→54160 из 50 пулов), а мизеры тонких периодов выживали (при их рождении они сами были пиком стороны).
- **Реестр эмиссий по пулам на ВСЮ сторону** (вместо геометрической идентичности): эмиссии замораживались на первом пересечении новизны, карта застывала на старых широких поколениях (SHORT 65171→70385 из 125 пулов). Идентичность полки при эмиссии остаётся геометрической (shelfIdentityShare 0.6); родство решается на уровне consolidate.

### Правила v2.2 (утверждены 24.07.2026)

- **Родство стеков (`stackKinshipShare = 0.5`):** зоны одной стороны с пересекающимися окнами, у которых общий notional стеков ≥ 50% МЕНЬШЕГО стека, — один объект ликвидности. Победитель: если старшая **тронута до рождения младшей** (firstTouchAt < junior.knownAt — окно подтверждения в работе) — младшая становится `duplicateOf` старшей; иначе — **младшая побеждает** (свежая геометрия), старшая получает `supersededAt = junior.knownAt`, окно обрезается, состояние retired. Проверяется ДО ценовых правил дедупа (near 0.25 ATR / перекрытие 0.6 с гардом высоты 2× — остаются страховкой для неродственных стеков). Семантика §16.12 п.6 уточнена: геометрия зон по-прежнему не мутирует — обновление карты идёт заменой целых зон, и только пока место «не в работе».
- **Сила полки (`stackNotional`, `stackShare`)** — дисплей-метаданные кандидата: суммарный notional стека и его доля от сильнейшего АКТИВНОГО стека той же стороны на конец истории. Слабость — НЕ правило рождения (см. отрицательное знание), а фильтр отображения: селект «Сила стека» в панели зон, дефолт «≥ 10% сильнейшего» (мизеры уходят, сильный одинокий пул BTC 58870 с весом 0.84 остаётся и виден пользователю в heatmap).
- **UI-фиксы производительности:** нефокусные линии зон исключены из автошкалы цены (autoscaleInfoProvider → null; фокусная зона шкалу тянет — центрирование работает); свечи перезаливаются только при реальной смене набора (кэш mainShown).

### Диагностика (5000×4h, volume-proxy)

BTC: активных 14 → 11; пара у цены схлопнута (свежайшее поколение стека 66750→70865 при полном родственном покрытии пар пользователя), «остаток §16.13» закрыт — LONG 57446→53197 (46 пулов, 52.9B) активна и накрывает жирный верх 55.5–57.4k. ETH: активных 18 → 11; тройка 1767/1705/1675→1655.38 схлопнута к 1767.97→1655.38; мизеры 1384→1350 (1 пул) поглощены поколениями или ушли под фильтр силы. Отставлено поколениями: BTC 275, ETH 391; дублей при тронутой старшей: 88 / 91 (окна подтверждения сохранены там, где в них вложились). Чувствительность разреза по провалам (shelfValleyShare 0.25→0.3/0.35, minBins 3→2): каждый вариант чинит ширину ближнего шорта ХУЖЕ, чем ломает лонги (склейка 63–64.2 с 61.8 или возврат старых широких поколений) — пороги оставлены 0.25/3, обе ручки уходят в UI-конфиг редизайна для подбора на данных пользователя (OI-гибрид ≠ volume-proxy песочницы).

### Ответы пятого QA (зафиксировано)

- Зоны не мутируют со временем (§16.12 п.6); карта обновляется поколениями, и с v2.2 — только пока зону не тронули.
- «28 попыток и на 5k, и на 25k свечей» — потолок 15m-истории: MAX_CANDLES_LTF = 60 000×5m ≈ 208 дней ≈ 1250 4h-баров; зоны старше — ltfCoverage none («нет 15m данных»). Лечится либо ростом потолка (время загрузки), либо МТФ-подтверждением (roadmap).
- Связки ТФ пользователя (контекст → подтверждение): 1W→1D/4h, 1D→4h/1h, **4h→1h/15m (текущая)**, 1h→15m/5m; упрощённое подтверждение = закрытая свеча в сторону зоны на 1h (сильный тренд) / 4h (боковик) + перепроданность/перекупленность по GGI ZONE. В SPEC до сих пор не было; записано в CONTEXT §0.5 как roadmap после редизайна (движок зон уже принимает конфиг через context.config — задел готов).

Версии: `liquidity-poi-2.2-stack-kinship`, `poi-confirmation-1.6-quiet-reanchor` (подтверждение не менялось). Тесты 285/285 (переписаны 2 на семантику родства, +1 «тронутая старшая главнее», + ассерты stackShare), tsc чистый, node --check чистый.

## 16.15 Liquidity POI 2.3 — удержание массы при замещении; визуализатор 2.0 (24.07.2026, шестой QA)

### v2.3: замещение поколения только при удержании массы

Кейс шестого QA (ETH, скрины пользователя): «нет зоны над огромной полкой 2030, ближайший шорт 2096–2150». Механизм воспроизведён на данных: поколения полки сползают (2077→2115 → 2053→2090 → 1992→2115 → …), и правило §16.14 отдавало место СВЕЖАЙШЕМУ родственнику, даже если его окно уже и роняет массу старшей — сползшая вверх генерация 2096–2150 отставляла старшую 1992→2115, а осиротевшая масса 2030 новых зон не рождала (её пулы не «новые» для novelty). **Правка (без новых констант): младшая ЗАМЕЩАЕТ нетронутую старшую, только если удерживает ≥ `stackKinshipShare` (0.5) СТАРШЕГО стека** (рост/обновление места, как BTC-кейс 67553: 76% старшей); сползшее вбок окно становится дублем — место держит старшая, накрывающая полку. На свежих данных (до 23.07 20:00) ближайший ETH-шорт — 1958.8→2113.8 (73 пула, 100% силы), накрывает полку 2030 и совпадает с ручной зоной пользователя 2000–2120.

По остальным скринам шестого QA: ручная карта BTC пользователя (3 лонга / 2 шорта) совпала с активной картой v2.2/v2.3 почти 1-в-1; последовательные зоны SOL (82–86 / 86.5–91.5 / 91–93.7 / 95.4–100) — сегменты непрерывной лестницы ликвидаций, разделённые провалами < 25% пика: это свойство ликвидности инструмента, фильтруется силой стека и решением пользователя, правкой движка не является.

Версия: `liquidity-poi-2.3-cover-supersede`. Тесты 286/286 (+1: сползшее окно — дубль). Подтверждение (1.6) не менялось.

### Визуализатор 2.0 — редизайн (утверждён вариант «ванильная дизайн-система»)

Полный редизайн фронта в духе shadcn/Vercel без сборки: «склонировал и запустил» сохранён (`npx tsx tools/visualizer/server.ts`, порт 7788, без автозагрузки).

- **Архитектура вместо файла-простыни:** `index.html` (семантика, без inline-стилей) + `styles.css` (дизайн-токены: палитра/типографика Geist/радиусы/тени, компоненты) + ES-модули `app.mjs`, `lib/{state,format,chart,api,palette}.mjs`, `panels/{stats,heatmap,zones,confirmation,lab,config}.mjs`. Каждый модуль проходит `node --check` (.mjs = модульный синтаксис для Node). Старый `app.js` — стаб с указателем.
- **Зоны — ПРЯМОУГОЛЬНИКАМИ** (custom series primitive lightweight-charts v5): заливка с градацией по силе стека, near — сплошная граница цветом стороны, far — пунктир; hover-карточка зоны, клик по прямоугольнику — фокус; примитив не участвует в автошкале цены (кроме сфокусированной зоны) — «сплющивание» графика невозможно по построению. «Зоны на 4h» подтверждения — тоже прямоугольники.
- **Панель «Настройки движков»:** все числовые константы LIQUIDITY_POI_CONFIG и heatmap-конфига редактируются в UI и применяются кнопкой «Пересчитать» — сервер принимает `poiConfig`/`hmConfig` (JSON, whitelist числовых ключей по дефолтам) и передаёт в движки через config-override; дефолты в коде не меняются, ответ сервера отдаёт `engineDefaults` + `appliedOverrides`. Пресеты (фильтры + конфиги) в localStorage.
- **«Мои зоны»:** ручная разметка пользователя (сторона + границы + заметка, localStorage по символу, голубой пунктир поверх движковых зон, экспорт вместе с зонами) — сверка своей карты с движковой без правок кода.
- **Командная палитра (Cmd/Ctrl+K):** загрузка, символы (топ-100), ТФ, панели, экспорт, пресеты. Горячие клавиши: ⌘K, ←/→ (навигация в активной панели), ↑/↓ (сделки), Esc.
- **Прочее:** воронка в шапке (зоны → активные → попытки → входы), фильтр «Сила стека», сворачиваемые секции, единый тултип (сделки/полосы heatmap/зоны), Decision Lab перенесён без изменений логики и ключа localStorage (решения пользователя сохранены), русские подписи и переписанные компактные справки в каждой панели.

Проверки: 286/286 тестов, `tsc --noEmit` чистый, `node --check` всех 12 JS-модулей чистый, смоук сервера (статика с подпапками, fixture-аналайз, echo дефолтов, отсев мусорных ключей оверрайдов).
