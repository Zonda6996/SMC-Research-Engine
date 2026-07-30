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

## 16.16 Liquidity POI 2.4 — stack-consumed на закрытии бара; полировка терминала (24.07.2026, седьмой QA)

### v2.4: смерть «стек снят» наступает на ЗАКРЫТИИ бара снятия

Кейс седьмого QA (ETH 15m, зона LONG 1854.64–1876.96): попытка прошла заход → остановку → перезапуск → отскок, а на глубоком свипе к 1858 умерла `zone-ended`, «не увидев» пересвип. Механика: свип снял ≥ `stackConsumedShare` notional полки → зона spent/stack-consumed, но момент смерти брался из `sweptAt` пула = **НАЧАЛО** 4h-бара снятия — окно подтверждения обрезалось до событий, случившихся внутри того же бара. Для прохода насквозь эта же проблема решена ещё в §16.10 («момент = закрытие бара прохода»); stack-consumed оставался несогласованным. **Правка: `stackConsumedAt = sweptAt + tfMs`** (закрытие бара) — пересвип внутри бара снятия попадает в окно, попытка с состоявшимся свипом доигрывается за окном по §16.10. Смысл смерти не менялся, констант нет. Версия `liquidity-poi-2.4-consumed-at-close`, тесты 286/286 (ассерт момента обновлён).

### Полировка терминала по седьмому QA (viz)

Баги: командная палитра не кликалась мышью (ховер перерисовывал DOM под курсором и глотал клик — выбор перенесён на mousedown, ховер меняет только классы); полосы heatmap рисовались на 15m-свечи режима подтверждения (несовместимые шкалы времени клали график — в conf-режиме heatmap не рендерится); клик по шапке панели-режима не открывал её (теперь шапка = «Открыть/Закрыть»); зум/позиция графика сбрасывались при переключениях (fitContent убран из перерисовок; при уходе в conf/lab зум основного графика запоминается и восстанавливается). UX: все секции сайдбара свёрнуты по умолчанию; жёлтые справки заменены свёрнутым «? Справка» (details) с сокращёнными текстами; воронка/датасет/версии перенесены из шапки в «Обзор» (не помещались на 1920px); селектор символа — комбобокс с иконками монет (assets.coincap.io, фильтр, клавиатура); профиль плотности у ценовой шкалы выключен по умолчанию (чекбокс «профиль у шкалы»); фавикон; в списке/деталях зон статус «заменена» (supersededAt) отделён от «устарела»; отступы/границы/высоты приведены к более воздушной сетке. Открыто: кейс «зона 1992.67 устарела, хотя полка актуальна» (скрин 9) — точный разбор по JSON-экспорту пользователя (вероятна замена поколением либо цепочка смертей на его OI-данных).

## 16.17 POI Confirmation 1.7 — лимит тестов слабости, конфиг-параметризация, полная 15m-история (24.07.2026, восьмой QA)

### Правило (решение пользователя): weaknessFailLimit

«Если тест слабости три раза подряд не прошёл — отменяем сделку». В движке провал теста (возобновление после отката БЕЗ превышения объёма отката) раньше молча ждал дальше — попытка могла бесконечно жевать слабые возобновления. v1.7: событие `WEAKNESS_TEST_FAILED` в трейсе; `weaknessFailLimit = 3` подряд проваленных тестов → отбраковка `weakness-failed`. Счётчик обнуляют: успешный тест (даже с отменой входа по риску), RESTART, перенос якоря (ANCHOR_DEEPENED), новый пересвип (переход в protect). Конфиг подтверждения параметризован: `detectPoiConfirmation(pois, ltf, htf, config?)` — сетка калибровки и панель настроек UI работают без мутации дефолтов.

### Сетка калибровки на ПОЛНОЙ 15m-истории (данные data.binance.vision, песочница)

833 дня 15m (80 000 баров) вместо 208 дней потолка API — BTC: 348 попыток / 12 входов (было 28 попыток на неполной истории). Диагностика воронки gross (НЕ edge; batch/PnL по POI-ветке заморожены):

- **attemptIdleBars (бездействие)**: 48 душит (BTC входы 12→10, ETH 13→6 — пересвип не успевает прийти); 144/192 добавляют максимум +1-2 входа при падении WR (BTC 83→71%). **96 оставлен.**
- **entryMaxRiskAtr (гард входа)**: главный регулятор «количество ↔ качество»: BTC 1.0 → 4 входа (75%), 1.5 → 12 (83%), 2.0 → 19 (68%), 3.0 → 40 (45%); ETH аналогично по форме. Поздний вход = плохой вход — гипотеза §16.9 подтверждена данными. **1.5 оставлен** (теперь крутится в UI).
- **weaknessFailLimit**: разнонаправленный: BTC 3 → 12 входов 83% против «выкл» 14 входов 86% (режет два будущих tp); ETH 3 → 13 входов 23% против «выкл» 15 входов 13% (режет стопы, +10пп WR). **3 принят** (правило пользователя; экономит и время попыток: 41-66 ранних отбраковок).
- `timeout@sweep` — главный пожиратель попыток (BTC 184/348): пересвип так и не приходит. Ростом idle не лечится (144 → всё ещё 156) — это свойство метода (нет свипа = нет сетапа), не константа.

### Терминал (viz/server, тот же QA)

- **Кэш данных на сервере**: свечи/OI кэшируются по параметрам данных (TTL 90 сек live / 1 час historical) — «Пересчитать» с новыми конфигами движков больше НЕ качает 60k×5m заново: пересчёт за секунды вместо минут.
- **Конфиг подтверждения в панели настроек** (confConfig → whitelist числовых ключей, echo в engineDefaults/appliedOverrides).
- **«Чем кончилась зона»**: отказ zone-ended в панели подтверждения дополнен причиной смерти зоны (джойн с POI-кандидатом): провал/насквозь/стек снят/устарела/заменена поколением — «окно закрылось» без контекста бесило на QA (кейс VIRTUAL: зона умерла по снятию стека, попытка «кончилась вбок»).
- **Селектор монет**: полный список пар Binance USDT-M (не топ-100), фокус выделяет текст и открывает список без стирания, иконка обновляется/скрывается по вводу.
- Подсказки настроек переписаны «на эффект» («выше — режет чаще», «меньше — раньше устаревают»).

### Мультимонетная сетка BTC/ETH/SOL (9-й QA, 24.07.2026)

Полная история (5000×4h + 80 000×15m на монету), 51 строка CSV у пользователя. База (дефолты): **BTC 348 попыток → 12 входов, 10tp/2stop, WR 83%, gross +18R; ETH 417 → 13, 3tp/10stop, WR 23%, gross −4R; SOL 428 → 11, 5tp/6stop, WR 45%, gross +4R** (gross = tp×2R − stop, БЕЗ комиссий, volume-proxy, малые N — шумно). Выводы:

- **Подтверждение дышит на BTC, около нуля на SOL, систематически стопится на ETH** — приоритет не крутилки, а разбор 10 ETH-стопов по кейсам (возможно, OI-данные пользователя изменят картину).
- **entryMaxRiskAtr — главный рычаг**: BTC 1.0→+5R, 1.5→+18R, 2.0→+20R (19 вх), 3.0→+14R (WR 45%); SOL 2.0 → +14R против +4R. Кандидат 2.0 — пользователь тестирует в UI; 3.0 — погоня, WR разваливается.
- **weaknessFailLimit 3 — страховка**: BTC −4R относительно «выкл» (режет два будущих tp), ETH +5R (режет стопы), SOL нейтрально. Принято 3.
- **shelfFreshBars 320 (пользовательское) — лучший зонный вариант BTC** (+20R, 14 активных), ETH/SOL ровно. Кандидат в дефолт (сейчас 300).
- **dupNearAtr 2.0 (пользовательское)**: чистит карту, но BTC +18→+12R (свежие зоны прячутся за старшими), ETH WR 0%; SOL +6R. Дефолт 0.25 не меняем; 2.0 — осознанный вкус пользователя, цена известна.
- **shelfValleyMinBins 4/5 — везде равно или хуже** (SOL при 5: +4R→0R). Тройка подтверждена в третий раз.
- idle 96 ≈ 144, 48 душит везде. Оставлено 96.

Селектор монет: мейджоры universe (BTC, ETH, SOL, XRP, BNB, DOGE, ADA, AVAX, LINK, SUI, TON, NEAR, APT, LTC) закреплены сверху, остальное по объёму — суточный объём выносил мем-коины выше SOL.

Версии: `poi-confirmation-1.7-weakness-limit`, `liquidity-poi-2.4-consumed-at-close`. Тесты 287/287 (+1 weakness-failed с контролем через конфиг), tsc чистый, node --check чистый. Открыто: полная 15m-история в самом визуализаторе (подкачка архивов data.binance.vision сервером — roadmap; потолок API 208 дней остаётся), кейс ETH «нет зоны над 2030» на данных пользователя (ждём JSON-экспорт).

## 16.18 POI Confirmation 1.8 — дедуп входов «один свип = одна сделка», пометка «против импульса»; разбор 10 стопов ETH и сетка на 8 монетах (24.07.2026, десятый QA)

### Разбор 10 стопов ETH (задание §0.5; данные пересобраны, воронка §16.17 воспроизведена бит-в-бит)

Группы причин (BTC 348 попыток/12 входов/10tp/2stop/+18R gross, ETH 417/13/3/10/−4R, SOL 428/11/5/6/+4R):

- **A. Дубль-вход (системный дефект, −1R лишний + ×2 риска на событии).** ETH 25.06.2026: попытка зоны 1655→1578, умершей stack-consumed, после потери защиты перестроилась за окном (легитимно по §16.10+§16.11) и сошлась с попыткой свежей полки 1559→1522 в ИДЕНТИЧНЫЕ вход 1560.64/стоп 1528.84/тейк на одном баре. Дедуп существовал только на геометрии зон — на уровне попыток/входов его не было.
- **B. Стоп-раны «пересвип пересвипа» (3 события, −3R).** Прокол за стоп 0.35–0.57R (0.5–0.8 ATR15) за 0–4 бара, возврат к входу за 1–7 баров, тейк без стопа добирался. Стоп всегда лежал за свип-лоем (+0.05 ATR): историческая поправка stopLookbehindAtr §16.10 не сработала НИ В ОДНОМ из 10 стопов. Контраст BTC: у победителей максимальный ход против позиции ≤0.76R, у стопов 5–7.2R — бимодально, класса «на волоске» нет.
- **C. Контртренд-ножи (4 стопа, −4R).** Входы против 20-барного хода 4h в 8–21% (шорт 08.11.24 против +20.9%, лонг 07.04.25 против −19.7% и др.): минимальный выживающий стоп 2.5–12R или цена не вернулась. Полка ликвидности в сильном свежем движении — топливо продолжения (каскад ликвидаций), не разворот.
- **D. Чоп/сползание (2 стопа, −2R).** Несистемные (N=2).

**«Зомби-попытки»** (перестройка подтверждения после endAt зоны — следствие §16.10 «доигрывается» + §16.11 «перестройка»): ETH 5/13 входов (в т.ч. 2 из 3 тейков), BTC 0/12, SOL 2/11. PnL за них: +5R на трёх монетах; запреты («новый якорь после endAt = смерть» и «только свип до endAt») режут gross во всех ячейках сетки (база 18→16/14R, r20 32→23R). **Семантика оставлена осознанно**: попытка, начавшая пересвип-цикл в окне, может перестроиться за окном; вернуться к вопросу при МТФ или если OI-карта пользователя покажет другие тайминги смертей зон.

### Отрицательное знание (проверено и отвергнуто)

- **stopBufferAtr 0.15/0.3/0.5 не лечит стоп-раны группы B**: с ростом буфера растёт риск → тейк 2R отъезжает дальше → конвертации стопов в тейки нет, а BTC-победители отменяются риск-гардом (BTC 18→16/9/4R). 0.05 оставлен.
- **Большая сетка на 8 монетах** (BTC/ETH/SOL + XRP/BNB/DOGE/ADA/LINK; 5000×4h + 80 000×15m на монету; методика анти-подгонки: train = входы до 01.01.2026, ранжирование ТОЛЬКО по train, test 01.01–23.07.2026 — один взгляд на финалистах): **устойчивой «лучшей комбинации настроек» не существует.** Топ train-комбо fresh370×topN7×valley0.25×novelty0.4×risk2.0 = +29.6R net (7/8 монет в плюсе) → test −0.9R; risk2.0 в одиночку (+10.1R train) → test −8.0R; ранговая корреляция train↔test по 33 комбо ρ=0.11 ≈ 0; сдвиг ОДНОЙ ручки обваливает пик (topN 7→5: 29.6→0.0R). Диапазон test всех комбо: −8.0…+2.6R (медиана −2.8). По полугодовым корзинам даже база портфельно около нуля; топ-комбо заработал всё в 2025H1+H2 — ретроспективная горячая полоса. **Дефолты не меняются.** Частное: fresh 230–400 — шумное плато (320 остаётся UI-вкусом, PnL-нейтрально); dupNearAtr 0.5 — нулевой эффект, 1.0/2.0 монотонно хуже; risk 2.5 — погоня (−18.8R net train, WR 34%); minShare/nearTol/consumed/maxPct — в шуме; **stopLookbehindAtr 1.0 — мёртвая ручка** (ни одна сделка не изменилась). База на 8 монетах: train net −4.1R — «система дышит» была историей про BTC (+13.8R train); учёт net (taker×2 ≈ 0.1–0.2R/сделку) обязателен.
- **Кандидаты дефолтов из §0.5 закрыты**: shelfFreshBars 300→320 и entryMaxRiskAtr 1.5→2.0 НЕ фиксируются (не переносятся на test-период).

### v1.8: дедуп входов «один свип = одна сделка» (правка дефекта A)

Попытки РАЗНЫХ зон, вошедшие с одного финального пересвип-бара в одну сторону, торгуют одну снятую ликвидность — в реале ×2 позиции на одном событии без ×2 эджа. Побеждает зона с сильнейшим stackNotional (при равенстве — старшая по knownAt); остальные получают `duplicateEntryOf`: **не торгуются и в статистике/воронке не считаются**, трейс сохранён для QA (в панели подтверждения — бейдж «ДУБЛЬ ВХОДА»). Жизненный цикл зон не пересматривается (tp-hit дубля остаётся диагностикой его зоны). Частота дублей растёт с гардом входа: база 1, risk2.0 — 5, risk2.5 — 8 (на 8 монетах, train+test). Констант нет — правило структурное.

### v1.8: пометка «против импульса» (маркер, НЕ фильтр)

`impulseRet` = каузальный ход за `impulseBars = 10` ЗАКРЫТЫХ баров ТФ зоны на момент входа (незакрытый бар не участвует — без look-ahead); `againstImpulse` = вход против хода сильнее `impulseGatePct = 0.10`. Значения валидированы train/test с заранее зафиксированным правилом отбора (plateau-score по соседям, а не одинокий пик): train Δ+6.6R (отфильтровано 6 входов — ВСЕ стопы, хуже 0/8 монет; замороженный гейт также улучшает risk2.0 +8.9R и r2.0×fresh320 +7.0R train), test — ни одна из трёх конфигураций не ухудшена, отфильтрованы только стопы (1–3 сделки: направление подтверждено, величина НЕ доказана — событий мало). Короткое окно ~1.7 суток — хребет эффекта; недельное окно (N=40) сигнал теряет: опасен вход против СВЕЖЕГО импульса, не против «тренда вообще». **Фильтр не включён** — сначала форвард-статистика пометки (в т.ч. на OI-карте пользователя); на базе 3 монет пометка легла на 3 входа — все три стопы (ETH 1, SOL 2). UI: бейдж «ПРОТИВ ИМПУЛЬСА» + строка «Импульс на входе» в деталях, воронка «N входов +K дубл.», подсказки констант в панели настроек (обе крутятся через confConfig-overrides).

Версии: `poi-confirmation-1.8-sweep-dedup`, `liquidity-poi-2.4-consumed-at-close` (зоны не менялись). Тесты 290/290 (+3: дедуп одного свипа с выбором сильнейшего стека, контроль разных свипов, маркер импульса с конфиг-порогом и null без HTF), tsc чистый, node --check чистый. Диагностика воспроизводима: tmp/diag (download.sh/buildData.mjs — 8 монет с data.binance.vision; run/extract/report/grid/combo/sweepRunner/analyze/gate.mjs; сверка базы со SPEC §16.17 бит-в-бит).

## 16.19 МТФ-подтверждение в визуализаторе; полная история ТФ подтверждения (25.07.2026, Задание №3)

### Часть 1 — полная история ТФ подтверждения (реализована и принята 25.07)

`tools/shared/archiveKlines.ts`: monthly+daily klines-архивы data.binance.vision; ZIP распаковывается нативным Node (zlib по central directory — без зависимостей и системного unzip, переносимо на ОС пользователя); CSV с нормализацией микросекундных таймстампов (2025+); дисковый кэш иммутабельных периодов `tmp/viz-archive-cache/`; 404 = молчаливый пропуск (до-листинговые месяцы детектятся пробами 1-го/15-го дня — без 30 лишних запросов), транзиентные 5xx ретраятся (3 попытки), стойкие — пропуск периода с предупреждением (один битый файл не роняет 80 хороших). В server.ts: ряд подтверждения = архивы от ПЕРВОГО бара загруженного окна зон + API-хвост из уже качаемых 5m (приоритет хвоста; дневной архив запаздывает ~сутки); глубина автоматическая, новых констант нет; fail-soft на API-глубину; `fullLtf=0` выключает (чекбокс «подтверждение: вся история», дефолт ВКЛ). Верификация: побайтовое совпадение 84 000×15m ETH с эталоном tmp/diag; воронка на склейке воспроизводит §16.17 бит-в-бит.

### Часть 2 — лестница связок (решения пользователя 25.07.2026)

1. **Связки** (SPEC §14.1, «ТФ зоны → ТФ уточнённого подтверждения»): включены **1D→1h**, **4h→15m** (исходная), **1h→5m** — константа `CONFIRMATION_TF` в candleFetcher. **1W→4h отложена**: недельных баров ~360 за всю историю фьючерсов — shelfFreshBars=300 недельных баров теряет смысл, N зон мизерный.
2. **Семантика констант: В БАРАХ своего ТФ, без пер-ТФ скейлинга.** Фазы метода (проторговка 4, отскок 6, бездействие 96) — структурная работа, а не время; соотношение conf-баров на бар зоны почти константно по лестнице (24:1 / 16:1 / 12:1) — время масштабируется с ТФ контекста естественно (96×1h = 4 суток для дневной зоны ≈ пропорция «суток» 4h-зоны). Ноль новых констант (урок сетки 8 монет).
3. **Оговорка калибровки**: пометка «против импульса» (`impulseBars=10`, `impulseGatePct=0.10`) валидирована ТОЛЬКО на связке 4h→15m (10×4h ≈ 1.7 суток); на 1D это 10 дней, на 1h — 10 часов. Маркер оставлен как есть (не фильтр); перевалидация по форвард-статистике, если маркер приживётся.

Реализация: движки НЕ менялись (TF-агностичны: бары своего ТФ + ATR), версии не бампались; сервер выбирает conf-ТФ по лестнице, ряд подтверждения строится из архивов conf-ТФ + агрегация уже качаемых 5m (новых API-путей нет); Decision Lab/реакция остаются на честном 15m (семантика не менялась); payload: `ltfConf`/`confTf` (бывший `ltf15m`), подписи UI динамические. Тесты 297/297 (+1 лестница §14.1, +1 ретраи 5xx).

### Диагностика связок на дефолтах (volume-proxy, дубли исключены, net с taker×2; НЕ edge — здоровье воронки)

- **1D→1h, 8 монет, вся история листинга (~6.5 лет)**: 1447 попыток → 24 входа (7tp/17stop, WR 29%), gross −3R, net −4.8R. XRP и BNB — 0 входов за всю историю; частота ~0.5 входа/монету/год. Дневная лестница на дефолтах и объём-прокси эджа из коробки НЕ даёт — ценность в визуальном QA на OI-карте пользователя и в снятом потолке истории.
- **1h→5m, BTC/ETH/SOL, окно 208 дней**: 5–10 входов/монету, gross −1…+2R, net −3.3…+0.1R. **Комиссионное трение на 5m-стопах жестокое** (~0.3–0.5R/сделку при riskPct ~0.2–0.3%): лестница 1h→5m тейкер-исполнением почти нерентабельна по построению — либо мейкер-вход, либо связка для визуального скальп-QA, не для автоторговли.
- Сквозной вывод консистентен сетке §16.18: на объём-прокси и дефолтах система портфельно около нуля на всех лестницах; поиск эджа — отбор режимов/монет и OI-данные, не константы.

## 16.20 Слои карты зон: свинговые 1D и локальные 1h на рабочем виде 4h (25.07.2026, поправка пользователя)

Поправка к §16.19 по замечанию пользователя: свинговые и локальные зоны — не отдельные экраны по кнопке ТФ, а **СЛОИ ОДНОЙ КАРТЫ** (§12.2: «Локальные и swing-зоны существуют одновременно. Нельзя удалять все локальные зоны только потому, что есть внешний экстремум»). На рабочем виде 4h сервер строит три связки одновременно:

- **Свинг 1D→1h**: дневные свечи агрегацией из загруженного 4h-окна (UTC-границы — идентичны нативным), подтверждение на 1h (архивы от начала окна + хвост из 5m-агрегации).
- **Базовый 4h→15m** — как был (§16.19 ч.1).
- **Локальный 1h→5m**: 1h-свечи агрегацией из 5m-окна API (~208 дней — локальные зоны свежие по своей природе), подтверждение на уже качаемых 5m. «Локальные ≠ мусорные»: слой проходит те же правила рождения/дедупа/родства и те же UI-фильтры (активность, сила стека ≥10% дефолт) — карта остаётся чистой; отдельные константы для слоя НЕ вводились (при необходимости — крутятся теми же overrides, решение по данным пользователя).

Движки и константы НЕ менялись (те же функции на других входах, версии не бампались); overrides из панели настроек применяются ко всем слоям одинаково. UI: чекбоксы «слой 1D свинг»/«слой 1h локальные» в панели зон (дефолт ВКЛ; слои в общем списке с бейджем ТФ, прямоугольники с префиксом 1D·СВИНГ / 1H·ЛОК), селектор связки в панели подтверждения (связка графика / свинг / локальная — трейсы каждой пачки на её conf-свечах), сводка слоёв в воронке Обзора. Кнопки ТФ (1d/1h) остаются одиночными видами (§16.19). Смоук (ETH, 4h limit 5000): свинг 186 зон (16 активных) → 3 входа; базовый 888 (10) → 12; локальный 537 (7) → 10 — активная карта не замусорена. Payload +~3-4МБ (1h-ряд свинга; 5m локального не дублируется — берётся из ltf5m).

## 16.21 Иерархия слоёв карты: per-TF профили зон от эталонных карт пользователя (26.07.2026, одиннадцатый QA)

Кейс одиннадцатого QA (три скрина пользователя = ТЗ, BTC ~64.8k): слои §16.20 не соответствовали иерархии метода — «локальная» 1h-зона 66–71k (7.5%!) при эталонных этажах 0.75–2%, дневная карта «непонятно по какому принципу», слоёные прямоугольники прилипали к левому краю, контекстные 4h-зоны не выключались. Иерархия пользователя: **1h локальные** — слабее, но быстрые, «по тренду, плыть по движению», этажи ≤2% цены у самой цены; **4h среднесрок** — ждать снятия ликвы у экстремума, ~4.5%; **1D свинговые** — «где много ликвидности накопилось, отчётливо видно на дневном ТФ», консолидированные области ~8%, зон мало.

### Эталонные боксы (26.07.2026, BTC, цена ~64.8k)

- 1D: SHORT 69 800→75 200 (7.7%) · LONG 58 500→53 800 (8.0%)
- 4h: SHORT 67 300→70 500 (4.6%) · LONG 62 000→59 300 (4.4%)
- 1h: SHORT 67 000→68 000 (1.5%) · SHORT 66 200→66 700 (0.75%) · LONG 63 500→62 200 (2.0%)

### Per-TF профили (`tools/shared/poiProfiles.ts`; дефолты движка НЕ менялись)

Подобраны IoU-сканом по эталонным боксам (tmp/diag/profileScan.ts), подаются сервером через context.config, UI-overrides ложатся поверх; применяются и в слоях §16.20, и в одиночных ТФ-видах; echo в ответе сервера (poiProfile).

- **1h (локальный)**: `stackMaxPct 0.02` (максимальный этаж эталона 2.0%), `shelfValleyShare 0.4`, `shelfValleyMinBins 2` — цепь лестницы режется на этажи по неглубоким провалам, а не остаётся куском 6–7%.
- **1d (свинг)**: `shelfValleyShare 0.15` (клеим шире — консолидированные области), `shelfMinShare 0.12`, `shelfTopN 3` — рождается только «отчётливо видимая» ликвидность.
- **4h**: {} — канон §16.13–§16.16 без изменений.

### Карта после калибровки vs эталон (BTC 26.07, стек ≥10%)

- 1h: LONG 63 410→62 142 (2.0%) ≈ эталонный лонг; SHORT 66 787→67 658 и 67 494→69 011 — этажи 1.3–2.2% у цены (эталонные два шорта покрыты со сдвигом ~300 п.).
- 1d: SHORT 68 488→73 968 ≈ эталон 69.8–75.2; эталонный единый лонг 53.8–58.5 покрыт двумя соседними зонами 58 992→56 129 + 55 574→51 128; у рынка всего 3 зоны — мусор ушёл.

### UI

Чекбокс «зоны текущего ТФ» (контекстный слой выключается — каждый слой можно смотреть отдельно, не уходя с 4h-вида); слоёные прямоугольники рисуются компактно (правая треть окна данных, фокус-зона — полной длиной) — «прилипание» к левому краю убрано.

### Диагностика слоёв с профилями (BTC/ETH/SOL, дефолт-подтверждение, net с taker×2 — НЕ edge)

1D→1h: BTC 7 вх (1tp/6st, −4.8R net), ETH 4 (1/3, −1.3), SOL 4 (1/3, −1.3). 1h→5m: BTC 4 (1/3, −3.3), ETH 6 (2/4, −1.1), SOL 11 (5/6, −0.1). Карта соответствует методу, но машина подтверждения без режимного контекста на слоях денег не печатает (консистентно §16.18–§16.19). Слова пользователя про 1h-слой — «по тренду, плыть по движению» — прямо указывают на недостающий контекст: направленный фильтр/режим для локального слоя (связан с валидированной пометкой «против импульса», §16.18) — кандидат следующей работы вместе с упрощённым режимом; правило метода, требует согласования.

Тесты 298/298 (+1 профили: значения, 4h пустой, ключи в конфиге движка, дефолты не тронуты), tsc чистый, node --check чистый.

## 16.22 Двенадцатый QA (27.07.2026, DOGE): дневной свинг-профиль без глобального топа, локальный слой «только ближайшие», подача data-end

### Кейс «DOGE 5m: почему не засчитало подтверждение» — поведение корректно, подача сбивала

Трейс попытки (зона LONG 0.0711–0.0724, 27.07): заход → остановка → отскок → ПЕРЕСВИП 14:10 → защита НЕ состоялась (2 закрытия за якорем) → якорь перенесён глубже (ANCHOR_DEEPENED, правило пользователя §16.11 «этот фитиль становится тем хаем, который надо пересвипнуть») → подтверждение строится заново → ДАННЫЕ ЗАКОНЧИЛИСЬ (правый край графика). Отказа нет — попытка живая на краю данных (`data-end`), пересвип нового якоря ещё впереди. UI-правка: data-end теперь подаётся как «ЖИВАЯ У КРАЯ ДАННЫХ · ждёт продолжения» вместо пугающего «REJECTED · data-end».

### Дневной свинг-профиль: рождение без глобального топа (мультиактивная калибровка BTC+DOGE)

Кейс: на DOGE 1d ни одного шорта ближе 0.22 при цене 0.073 (эталон пользователя «хотя бы так»: SHORT ~0.095–0.101 и ~0.118–0.130). Корень: **69% свежего sell-нотионала DOGE стоит выше 0.14** (старые вершины кормятся в пределах свежести) — `shelfTopN 3` и `shelfMinShare 0.12` из §16.21 отдавали все места рождения старым гигантам, ближние полки не рождались. Это одноактивный оверфит §16.21 (профиль калибровался только на BTC). Правка профиля 1d: `shelfMinShare 0.12 → 0.03`, `shelfTopN 3 → 8` (valley 0.15 остаётся): рождение не душится глобальным топом, чистоту карты держат родство стеков, дедуп и UI-фильтр силы. Результат: DOGE — SHORT 0.0955→0.0994 и 0.1166→0.1259 (оба эталонных бокса), лонги без изменений (узкий 0.5%-лонг стал 1.5%); BTC — карта §16.21 сохранена 1-в-1 (S 68488→73968, эталонные лонги) + фоновый L 61388→59582 (стек 16%). Примечание пользователю: узкая дневная зона ≠ слабая (нотионал бывает жирным); дисплей-фильтр по высоте не вводился — по запросу.

### Локальный слой: «только ближайшие» и отрисовка от последнего вклада

- Кейс «зачем мне весь график в часовых зонах — вот ближайшая сверху/снизу, всё»: чекбокс «1h: только ближайшие» (дефолт ВКЛ) — из локальных зон показываются ближайшая над ценой, ближайшая под ценой и те, в которых цена сейчас; остальной локальный слой скрыт (фильтр дисплея, движок не менялся).
- Кейс «часовые зоны приклеены к левой части экрана»: «правая треть окна данных» из §16.21 на зуме в последние недели всё равно оставалась слева. Слоёные зоны теперь рисуются с ПОСЛЕДНЕГО ВКЛАДА в полку (max startAt пулов, семантика «с последней ре-аккумуляции»); фокус-зона — полной длиной.

Тесты 298/298 (профильный тест обновлён), tsc чистый, node --check чистый. Открыто: спека упрощённого режима подтверждения по ответам пользователя (GGI Zone = приватный индикатор перекупленности/перепроданности — воссоздаём аппроксимацией как heatmap; вход = закрытие свечи упрощённого ТФ в сторону зоны; цели 7–8% фикс части → БУ → 15–20% фулл; тренд/боковик формализуем тестами; пирамидинг отложен) — следующая итерация.

## 16.23 Слои: единая карта с любого ТФ, чипы вместо галочек (27.07.2026, тринадцатый QA)

Кейс: «галочек много, не работает часовая ближайшая на 1d-виде, хрен поймёшь что включать». Корень: слои §16.20 строились ТОЛЬКО на 4h-виде (на 1d/1h чекбоксы слоёв были мёртвыми), и управление разрослось до 4 галочек.

- **Слои строятся на любом виде лестницы (1h/4h/1d)** как остальные её ступени, каждый на своём КАНОНИЧЕСКОМ окне (1d — вся история листинга, 4h — 5000×4h, 1h — 5000×1h): карта слоя одинакова, с какого ТФ ни смотри. Данные слоя: архивы (дисковый кэш) + деривация из загруженного (агрегация вверх из свечей вида, вниз из 5m); fail-soft без архивов.
- **UI: три чипа «1D свинг · 4h · 1h лок»** вместо четырёх галочек (зоны текущего ТФ, слой 1D, слой 1h, 1h-ближайшие). Чип текущего ТФ управляет зонами графика. Поведение «1h: только ближайшие» ЗАШИТО в 1h-слой (ближайшая сверху/снизу + в игре; полная 1h-карта — на самом 1h-виде, там зоны контекстные).
- Селектор связки в панели подтверждения — по ТФ (1D→1h / 4h→15m / 1h→5m); сводка слоёв в воронке — генерическая.

Тесты 298/298, tsc чистый, node --check чистый.

## 16.24 Упрощённое подтверждение v0.1 + train/test-сетка вариантов (27.07.2026)

### Правила v0.1 (решения пользователя 27.07)

`simplified-confirmation-0.1` (SimplifiedConfirmationEngine, отдельная машина, уточнённый режим не тронут). Лестница §14.1, ПЕРВЫЙ ТФ пары: 1D-зона → 4h-свеча, 4h → 1h, 1h → 15m. Цикл: касание зоны (взведение rearmAtr — как в уточнённом) → **первая НАПРАВЛЕННАЯ свеча упрощённого ТФ после касания** (не важно, внутри или выше зоны — решение пользователя) → вход по закрытию → стоп (2 режима НА ТЕСТ: `far` — за дальней границей с буфером 0.25 ATR ТФ зоны; `pct` — фикс-доля цены 0.10 под «10 плечо изолированно») → ведение: частичка 50% на +partialAtMovePct хода → стоп в БУ → фулл на +fullAtMovePct; повторные входы НА ТЕСТ (`once`/`rearm`; фулл = зона отработана). Позиция доигрывается за endAt; входы после endAt не берутся; внутрибарная неоднозначность консервативно (стоп раньше цели). Результат — в % чистого хода И в R от начального риска. Тесты 303/303 (+5).

### Train/test-сетка вариантов: 16 вариантов × 3 связки × 8 монет (56 844 закрытых сделок)

Варианты: стоп {far, pct} × повторы {once, rearm} × цели {(3,8), (6,15), (7.5,17.5), (8,20)}% хода. Train = входы до 01.01.2026, ранжирование только по train; test 01.01–27.07 — один взгляд (топ-1 + заранее объявленный базовый far|rearm|7.5/17.5). Зоны — v2.4 с per-TF профилями §16.21–22.

- **1d→4h**: train-топ pct|rearm|8/20 = +470% хода net → test **−113%**. Базовый на тесте −70%.
- **4h→1h**: train-топ far|once|8/20 = +539% net → test **−83%**. Базовый −59%.
- **1h→15m**: train/test НЕВОЗМОЖЕН на этом окне (5000×1h ≈ 208 дней = весь сэмпл в 2026; train n=11). Заранее объявленный базовый вариант на всём сэмпле: 1269 сделок, 155 full/173 be/941 stop, net +238% хода (+134 netR), 6/8 монет в плюсе (XRP, BNB — минус), медианный стоп 2.3% цены, ~6 сделок/день портфельно. **НО помесячно: +44/−3/−67/+95/+237/+69/−138 — весь плюс это май-2026**; без мая ≈ ноль. Полоса, не эдж.

### Вывод (консистентен §16.18–§16.19)

Выбор вариантов упрощённого режима по бэктест-ранжированию НЕ переносится на будущее (та же картина, что с константами уточнённого). Механика «вход на каждое касание + направленная свеча» без РЕЖИМНОГО КОНТЕКСТА стабильно не зарабатывает ни на одной лестнице — что соответствует самому методу пользователя: он входит не на каждое касание, а при перепроданности/перекупленности (GGI Zone) и с учётом тренд/боковик. Недостающий блок — контекст: v0.2 = воссоздание GGI-аппроксимации (канал вокруг mean по скрину пользователя) + тренд/боковик, ОБА как фильтры поверх v0.1 с повторным train/test (вклад каждого фильтра отдельно). Для честного теста 1h-связки нужна глубокая история 1h-зон (60k×1h) — отдельный прогон.

## 16.25 v0.2: GGI-аппроксимация и тренд-фильтр — вклад контекста (27.07.2026, ночь)

### GGI Zone — воссоздание по скринам (ggi-zone-approx-0.1, tools/shared/ggiZone.ts)

Модель: mean = EMA(EMA(close, 80), 20); dev = EMA(|close − mean|, 40); красная зона (перекуплен) = mean + [2.68…6.65]×dev, зелёная зеркально. Подгонка численно по якорям скрина BTC 1h (27.07): mean 64642→64633, redLo 65709→65700, redHi 67292→67281, greenHi 63593→63566 (ошибка 0.01–0.04%), лаг пика mean — 1 час. На 4h полосы аппроксимации на ~30% уже эталона (his redLo 68094 vs 66683) — пер-ТФ подгонка по якорям пользователя при необходимости. НЕ канон движков: слой инструментов/фильтров.

### Тренд/боковик — механизация правила пользователя

«bos-bos = тренд, choch сбрасывает» (bos-bos-choch-bos-bos): события BosChochEngine на ТФ зоны; ≥2 BOS одного направления после последнего CHoCH → тренд этого направления, иначе боковик; регион меняется на баре ПОДТВЕРЖДЕНИЯ события (каузально). Фильтр: «не против тренда» (лонг блокируется в тренде вниз, шорт — вверх; боковик разрешает обоим).

### Вклад фильтров (базовый вариант far|rearm|7.5/17.5, 8 монет, post-hoc; netΣ в % хода)

| Связка | Без фильтров (train→test) | +GGI | +тренд | +GGI+тренд |
|---|---|---|---|---|
| 1d→4h | +885 → −70 | +42 → −12 | +658 → −11 | +53 → **+17** (n=14) |
| 4h→1h | +246 → −59 | −112 → +8 | +145 → **+38** | −118 → −12 |
| 1h→15m (окно 833д) | +556 → +261 | −72 → −186 | +351 → **+332** | −38 → −44 |

- **Тренд-фильтр — первый фильтр, улучшающий test на всех трёх связках**; на 1h→15m оба полупериода в плюсе (+351/+332), 7/8 монет в плюсе (кроме XRP), ~0.5% хода/сделку на 1342 сделках. НО: на 4h-связке полугодовые качели сохраняются (24H2 −162%, 25H1 −56%), на 1h помесячно 4+/3− — направление ценно, стабильность не доказана.
- **GGI-фильтр в текущей аппроксимации вредит** (режет тейки сильнее стопов на 4h/1h связках). Вероятные причины: (а) применение на ТФ связки вместо семантики метода пользователя — «GGI на 1h в ТРЕНДЕ / на 4h в БОКОВИКЕ»; (б) неточность полос вне 1h. Следующий шаг — перетест с семантикой метода и пер-ТФ якорями.
- Оговорки: post-hoc фильтрация (для rearm-цепочек in-engine даст чуть больше входов), 1h-окно фактически дало входы с 2025H1, комиссии 0.10% цены/сделку учтены, volume-proxy.

## 16.26 Упрощённое подтверждение v0.3: цели в R, фильтр «без погони», снятие потолка пулов; поиск высокого вин рейта (28.07.2026)

Задача пользователя: вин рейт 70–85% на монету **с положительной чистой экспектацией** (критерий согласован до работы: чистый WR без экспектации не принимается) и одной общей настройкой на все 8 монет (per-coin подгонка отклонена как самообман, CONTEXT §5). Разрешено менять дефолты; ограничение — основную логику подтверждения не трогать.

### Задание №3 закрыто: «пустой 2024» — не дыра в данных, а потолок выдачи heatmap

Архивы полные: 1h 57 504 бара с 2020-01 (0 пропусков), 15m 194 880 с 2021-01 (0 пропусков); единственные разрывы — реальные простои биржи 25.02.2022 и 31.03.2022 у SOL/XRP. Корень — `maxPools: 10_000` в LiquidityHeatmapEngine: это аварийный потолок ВЫДАЧИ (защита payload визуализатора), и обрезка оставляет самые свежие пулы по `lastContributionAt`. На 57 тыс. баров потолок выбирается за ~1.5 года, поэтому карта зон физически существовала только в хвосте истории, а «833-дневный» прогон §16.25 фактически считался на 2025–2026.

Снятие потолка для исследовательских прогонов (`maxPools: 5_000_000`; движок и дефолты не тронуты — параметр подаётся конфигом): BTC 1h — зон 819 → 6889, рождение равномерно 2020–2026, закрытых сделок 245 → 1436. По 8 монетам связка 1h→15m: 14 400 входов вместо ~2 500. **Это самое сильное анти-переобучающее изменение работы — выборка выросла в шесть раз без единой подогнанной константы.** Все прежние выводы по 1h-связке (в т.ч. «+332% с тренд-фильтром», §16.25) относятся к хвостовой выборке и не воспроизводятся на полной истории.

### Почему вин рейт v0.1 был 26% — ошибка единицы измерения, а не логики

В v0.1 цели заданы в долях ЦЕНЫ (частичка 7.5%, фулл 17.5%), а медианный стоп на 1h→15m — 2.15% цены. То есть частичка стоит на **3.5R**, фулл на **8.1R**: до частички доходит четверть сделок. Карта MFE (максимальный благоприятный ход до стопа), BTC 1h, 1404 входа: до +0.20R доходят 88.2%, до +0.30R — 81.8%, +0.40R — 77.0%, +0.50R — 72.2%, +1.0R — 55.1%, +2.0R — 36.8%. **Коридор 70–85% — это частичка 0.3–0.5R, и ничто другое.**

### v0.3 (`simplified-confirmation-0.3-r-targets`)

Дефолты движка сохраняют поведение v0.1 бит-в-бит (проверено: из 305 тестов упал только assert версии). Новое включается конфигом:

- `targetMode: 'pct' | 'r'` — цели в долях цены (v0.1) или в долях НАЧАЛЬНОГО РИСКА; `partialAtR`, `fullAtR`. Изменение структурное, не подгоночное: цели в R подстраиваются под фактический риск каждой сделки, поэтому одна настройка переносится между монетами и ступенями лестницы.
- `maxChaseAtr` — фильтр «без погони»: вход дальше N ATR зоны от её ближней границы пропускается (цикл зоны продолжается, перевзведение работает). 0 = выкл.
- `trendFilter: 'off' | 'notAgainst' | 'onlyWith'` + `trendMinBos` — правило пользователя «bos-bos-choch» внутри движка (Задание №2); события ТФ зоны подаются четвёртым аргументом `context.events`. Экспортированы `buildRegimeTimeline`/`regimeAt`.
- `SIMPLIFIED_HIGH_WR_PRESET` — найденная конфигурация как ИМЕНОВАННЫЙ ПРЕСЕТ, а не новые дефолты: канон v0.1 остаётся точкой отсчёта для сопоставимости со всей историей SPEC.

### Методика поиска (зафиксирована до прогонов, файл `selection.ts` отделён от скриптов поиска)

Разрез по времени входа: train до 01.01.2025, test с 01.01.2025 (на полной истории это 10 668 / 3 732 входа). Ранжирование только по train. Плато вместо пика (балл усредняется по соседям сетки). Порог принятия хода 2% — улучшения ниже считаются шумом. Комиссии 0.10% цены на сделку всегда. Стенд извлечения входов проверен на ПАРИТЕТ с движком: по всем 8 монетам и 3 связкам расхождений 0.

Два уточнения гейта сделаны ПОСЛЕ первых прогонов на train, но ДО единственного взгляда на test, оба по априорным основаниям, а не по результату:
1. `minTrades` 400 → 1200: цель заявлена «на монету», 400 сделок на 8 монет = 50 на монету за 4 года — мало для утверждения про монету.
2. Внутренний коридор отбора 73–82% при требовании 70–85%: конфигурация с train-WR ровно на границе выпадает наружу вне выборки примерно в половине случаев — это свойство оценки, а не рынка.
3. Требование устойчивости к хвосту: экспектация БЕЗ лучшего 1% сделок обязана оставаться положительной (введено после того, как первый финалист провалил test — см. ниже).

### Отрицательный результат: цель «максимум экспектации» не переносится

Финалист по максимуму экспектации на сделку — `trendOnly` + частичка 0.40R, фулл 25R: train n=1389, WR 75.8%, E=+0.211R, 8/8 монет в плюсе и в коридоре. **На тесте: WR 73.2%, E=−0.101R, 1/8 монет.** Механика провала видна в разрезе: у пяти монет ноль полных тейков и безубыточный порог ~95% — фулл 25R в train оплачивался редкими раннерами, в тесте ни один не дошёл, остались микро-частички против полных стопов. Это ровно та ловушка, о которой предупреждали пользователю на старте: высокий вин рейт при отрицательной экспектации. Отсюда критерий №3 выше.

### Принятый результат (пресет, связка 1h→15m, 8 монет)

Фильтр «без погони» ≤1 ATR; частичка **0.40R фиксирует 25% позиции** → стоп в БУ → фулл **12R**; стоп far (за дальней границей зоны +0.25 ATR); повторные входы rearm.

Прогон САМОГО ДВИЖКА v0.3 с пресетом (in-engine, не пост-фактум — цепочек перевзведения больше, чем у стенда):

| Период | Сделок | WR | БУ-порог | Экспектация | netΣ | PF |
|---|---|---|---|---|---|---|
| Всё (2021-01→2026-07) | 18 316 | 73.6% | 68.5% | +0.076R | +1389R | 1.28 |
| Train (→2024-12) | 13 347 | 73.6% | 68.6% | +0.074R | +986R | 1.28 |
| **Test (2025-01→2026-07)** | **4 969** | **73.6%** | 68.2% | **+0.081R** | **+403R** | **1.30** |

Вин рейт на тесте по монетам: ADA 72.8 · BNB 72.4 · BTC 75.1 · DOGE 74.1 · ETH 73.2 · LINK 73.7 · SOL 74.7 · XRP 72.7 — **8/8 в коридоре 70–85%**. Экспектация положительна у 6/8 (BTC −0.066R, XRP −0.004R). По полугодиям за всю историю 10/12 в плюсе (минус: 2024H2 −28R и неполное 2026H2 −36R на 170 сделках).

Жёсткий критик на train: концентрации нет (топ-10 сделок 11% итога, без них +748R из 839R; лучшая сделка 9.1R), 32/48 месяцев в плюсе, без лучшего месяца +754R из +839R. Плато широкое: частичка 0.30/0.40/0.50/0.60R → E +0.08/+0.09/+0.10/+0.09R; фулл 5/8/12/20/30R → +0.05/+0.07/+0.09/+0.09/+0.06R; доля частички 15–75% — везде плюс. Запас по комиссиям: при 0.20% (двойная модель) E=+0.049R, при 0.30% — +0.005R. Скользящий walk-forward (правило переприменяется в каждом окне, обучение 2 года, проверка 6 месяцев): 6/7 окон в плюсе, +657R на 6 755 сделках (+0.097R/сделку).

### Вклад фильтров (train, на выбранном профиле)

Тренд-фильтр в первых прогонах «не фильтровал ничего» из-за дефекта стенда: типы событий в `StructureEvent` строчные (`'bos'`/`'choch'`), сравнение шло с `'BOS'`/`'CHoCH'`, поэтому весь рынок считался боковиком. После починки (режимы 6154 боковик / 2742 вверх / 1772 вниз) тренд-фильтр стал сильнейшим одиночным фильтром по экспектации (`trendOnly`: E +0.065 → +0.211R), **но именно он и не пережил test** — из-за сокращения выборки и опоры на редкие раннеры. В пресет не включён; в движке доступен флагом, по умолчанию выключен.

GGI по семантике метода (в тренде смотреть 1h, в боковике 4h — Задание №1) проверен на исправленном режиме: n=354, E=−0.018R против базы +0.065R. GGI «в лоб» на 1h: n=879, E=−0.101R. **Вывод §16.25 подтверждается и уточняется: семантика метода заметно менее вредна, чем применение в лоб, но обе версии аппроксимации отбирают убыточное подмножество.** Причина, скорее всего, в самой аппроксимации, а не в идее: у пользователя приватный индикатор, в песочнице — восстановленный по скринам канал, и на 4h полосы уже эталона примерно на 30%. Пер-ТФ подгонка по якорям пользователя остаётся открытой.

Прочее: «не против свежего импульса» — E +0.064R (нейтрально); «только первая попытка зоны» — без эффекта; «сила стека выше медианы» — E +0.055R (хуже базы в одиночку); «риск ≤3% цены» — E +0.081R (слабый плюс, поглощается фильтром погони).

### Другие связки

4h→1h на том же протоколе: лучший train — тренд-фильтр + частичка 0.40R, фулл 25R, WR 70.1%, E +0.203R, но полугодия качает (2021H2 −29R, 2022H1 −70R, 2022H2 −30R, 2024H1 −29R; весь плюс — 2020 и 2023H2). Консистентно §16.25: 4h-связка нестабильна. 1d→4h не набирает выборку (895 train-входов при пороге 1200).

### Гейт

Тесты 316/316 (+6 на v0.3: цели в R, фильтр погони, таймлайн режима, тренд-фильтр в обоих режимах, неизменность дефолтов, +6 на новый модуль метрик — итого +11 к 305), `tsc --noEmit` чистый, `node --check` всех .mjs чистый. Новый модуль `tools/shared/tradeMetrics.ts` — единый судья результатов: победа = чистый результат ПОСЛЕ комиссий больше нуля (микро-частичка, съеденная трением, победой не считается), плюс «безубыточный вин рейт» как штатный детектор красивой, но убыточной настройки.

## 16.27 Сетка семейств выхода, правил стопа и карты зон; уточнённое подтверждение не набирает выборку (28.07.2026, вечер)

Задание пользователя: не ограничиваться одной связкой и одним профилем выхода — проверить фикс R:R, разные способы фиксации, разные стопы, регулировку heatmap (гипотеза «зон меньше → вин рейт выше») и уточнённое подтверждение; формат — как pool-оценки старой спеки (§7.26/§7.29/§7.31: один пул сделок, разные схемы выхода, разрезы train/test).

Стенд: входы извлекаются один раз, дальше любая схема выхода считается из предрасчитанных путей (`mfeR` — максимум хода до ИСХОДНОГО стопа; `afterX` — максимум хода после частички до возврата в БУ). Паритет с движками проверен, расхождений 0. Комиссии 0.10% цены на сделку всегда. Разрез: train до 01.01.2025, test с 01.01.2025.

### Семейства выхода на одних и тех же 14 400 входах (1h→15m, 8 монет)

| Схема | train WR / E | test WR / E |
|---|---|---|
| один тейк 1:1 | 54.1% / +0.036R | 54.0% / +0.033R |
| один тейк 1:2 | 37.0% / +0.062R | 37.9% / +0.089R |
| один тейк 1:3 | 27.9% / +0.071R | 29.0% / +0.113R |
| один тейк 1:5 | 19.0% / +0.095R | 20.3% / +0.172R |
| один тейк 1:6 | 16.7% / +0.124R | 17.6% / **+0.187R** |
| частичка 0.5R(50%) БЕЗ БУ → 3R | 27.9% / +0.046R | 29.0% / +0.060R |
| частичка 0.4R(25%) → БУ → 12R | 73.9% / +0.073R | **71.8%** / +0.090R |
| частичка 0.4R(25%) → БУ, БЕЗ дальней цели | 73.6% / −0.218R | 71.2% / −0.247R |

Три вывода. **Первый:** зависимость строго монотонна — чем дальше единственный тейк, тем выше экспектация и ниже вин рейт; выбор между «высокий вин рейт» и «больше денег» неустраним, это одна и та же кривая. **Второй:** частичка БЕЗ переноса стопа в БУ — худшее из двух миров (вин рейт остаётся низким, экспектация падает), что воспроизводит §7.31 старой спеки. **Третий и главный:** схема «частичка → БУ» БЕЗ дальней цели даёт −0.22…−0.25R. Значит вся прибыль системы сидит в дальней цели, а частичка с безубытком не зарабатывает — она конвертирует прибыль раннера в высокий вин рейт, отдавая за это часть денег.

### Другие связки

| Связка | один тейк 1:3 (test) | частичка 0.4R→БУ→12R (test) |
|---|---|---|
| 1h→15m | 29.0% / +0.113R | 71.8% / +0.090R |
| 4h→1h | 27.3% / +0.068R | 69.3% / **−0.057R** |
| 1d→4h | 27.4% / +0.012R | 66.8% / **−0.056R** |

Схема высокого вин рейта переносится ТОЛЬКО на 1h→15m; на 4h и 1d она вне выборки отрицательна, а чистый фикс R:R держится на 4h (1:2 +0.075R, 1:3 +0.068R) и на 1d при 1:5 (train +0.198 / test +0.127, n=280 — на грани значимости).

### Уточнённое подтверждение: воронка не даёт выборки

4h→15m, вся история 8 монет: **16 378 торгуемых зон → 7 841 попытка → 177 входов** (конверсия 1.08%; отказы: zone-ended 3478, timeout@sweep 3092, weakness-failed 659, broke-below-zone 389, timeout@entry 39). 1d→1h: **25 входов** (train 18 / test 7). На таких числах ни одна схема выхода не отличима от шума (train отрицателен во всех схемах, test случаен). **Уточнённый режим примерно в 100 раз селективнее упрощённого** — это свойство его цепочки (касание → остановка → отскок → пересвип → защита → вход), а не дефект. Сравнивать два режима по PnL нельзя; уточнённый остаётся инструментом визуального QA и точечной торговли, статистику по нему считать не на чем.

### Гипотеза «зон меньше → вин рейт выше» ОТВЕРГНУТА

Профиль выхода зафиксирован, менялась только карта (1h→15m, test):

| Карта | Зон | Входов | частичка→БУ→12R | один тейк 1:3 |
|---|---|---|---|---|
| **как есть** | 52 448 | 14 400 | 71.8% / **+0.090R** | **+0.113R** |
| heatmap minWeight 0→0.25 | 48 136 | 14 229 | 71.3% / +0.077R | +0.110R |
| heatmap minRelVolume 0.75→1.5 | 51 928 | 12 738 | 67.8% / −0.022R | −0.028R |
| heatmap minRelVolume 0.75→2.5 | 44 073 | 9 817 | 64.1% / −0.038R | −0.080R |
| heatmap minContributions 1→3 | 43 417 | 11 817 | 65.4% / +0.009R | −0.004R |
| POI shelfMinShare 0.15 + topN 3 | 23 472 | 7 782 | 69.6% / −0.024R | −0.006R |
| POI stackMaxPct 0.01 (узкие зоны) | 55 737 | 14 018 | 67.6% / −0.004R | +0.029R |

Каждое ограничение ухудшило И вин рейт, И экспектацию; нейтрален только minWeight (дисплей-ранг, почти ничего не удаляет). Урезание карты вдвое (52 → 23 тыс. зон) уронило экспектацию с +0.090 до −0.024R. Сильнее всего вредит требование объёмного всплеска для рождения полки — прямое подтверждение §7.43 («объёмные фильтры не работают»). **Текущая карта уже стоит в хорошей точке; «чистка» карты теряет сделки, не выигрывая в качестве.**

### Правила стопа: важен размер, не способ

1h→15m, входы те же (вход от стопа не зависит), меняется только правило стопа:

| Правило | Медиана стопа | частичка→БУ→12R (test) | 1:3 (test) | 1:5 (test) |
|---|---|---|---|---|
| за far зоны +0 ATR | 2.25% | 69.6% / +0.043R | +0.096R | +0.168R |
| за far +0.25 ATR (текущий) | 2.56% | 71.8% / +0.090R | +0.113R | +0.172R |
| за far +0.5 ATR | 2.87% | 72.4% / +0.099R | +0.117R | +0.174R |
| за far +1 ATR | 3.51% | train **−0.094R** ⚠ | — | — |
| 1 ATR 15m от входа | 0.66% | всё в минусе | −0.083R | +0.039R |
| 2 ATR 15m | 1.40% | 47.5% / +0.036R | +0.110R | +0.175R |
| 3 ATR 15m | 2.18% | 65.2% / +0.048R | **+0.146R** | **+0.182R** |
| фикс 1% цены | 1.00% | 42.5% / +0.062R | +0.106R | +0.135R |
| фикс 2% цены | 2.00% | 73.9% / +0.091R | +0.102R | +0.160R |
| фикс 3% цены | 3.00% | 73.1% / **+0.109R** | +0.142R | +0.187R |

**Стоп должен быть 2–3% цены; внутри этого диапазона все правила эквивалентны в пределах шума — это широкое плато, а не пик.** Стоп тоньше 1% схему убивает: комиссия 0.10% при стопе 0.66% забирает 0.15R с каждой сделки. Вариант «за far +1 ATR» отброшен несмотря на хороший test: у него ОТРИЦАТЕЛЬНЫЙ train, а такое расхождение знака — признак нестабильности, а не находки (урок §16.18).

### Два финалиста как явный выбор пользователя

| | Максимум вин рейта | Максимум денег |
|---|---|---|
| Стоп | фикс 3% цены либо за far +0.5 ATR | 3×ATR ТФ подтверждения (≈2.2%) |
| Выход | частичка 0.40R (25%) → БУ → фулл 12R | один тейк 1:5, без частички |
| test WR | **73%** | 20% |
| test экспектация | +0.109R | **+0.182R** |
| test netΣ | +387R | **+739R** |

Вариант «максимум денег» приносит примерно вдвое больше при психологически тяжёлом вин рейте 20%. Оба остаются пресетами; дефолты движков не меняются.

### Не покрыто

Трейлинг-стоп и тайм-стоп требуют полного пути цены, а стенд хранит сжатую статистику пути (`mfeR`/`afterX`) — единственное непроверенное семейство выходов. Связка 1h→5m уточнённого не проверена: 5m-архивов в песочнице нет.

## 16.28 Реверс-инжиниринг приватного индикатора GGI Buy/Sell; динамические цели проверены и отклонены (28.07.2026, вечер)

Задание пользователя: понять, как работает приватный индикатор автора, воссоздать и по возможности превзойти, в т.ч. в связке с нашими зонами/фибами/heatmap. Материал: расшифровка видео автора, гайд, скрины настроек и сделок, сообщение автора «в GGI Buy/Sell внедрена формула упрощённая страха и жадности, так как комплексная там учитывает и все твиты и куча много информации».

### Точные параметры полос (скрин «Аргументы» индикатора GGI Zone)

Источник цены `(МАКС+МИН+ЗАКР)/3` = hlc3 · `Lookback Period 200` · `Inner Mutiplier 5.6` · `Outer Amplitude 9.6`. Вкладка «Стиль» перечисляет ровно пять линий: Mean, Upper Zone Upper/Lower Line, Lower Zone Upper/Lower Line — структура совпадает с нашей моделью.

Структура проверена по четырём одновременным live-якорям BTC (28.07, интервал захвата <1 мин, подтверждено остатками таймеров баров 04:54 / 14:09 / 13:49 / 3:13:34):

| ТФ | mean | redLo | greenHi | dev = (redLo−mean)/5.6 | симметрия greenHi |
|---|---|---|---|---|---|
| 5m | 63 413.9 | 63 746.8 | 63 082.7 | 59.4 | 59.1 (−0.5%) |
| 15m | 63 985.3 | 64 864.7 | 63 117.7 | 157.0 | 154.9 (−1.3%) |
| 1h | 64 575.8 | 65 871.4 | 63 305.7 | 231.4 | 226.8 (−2.0%) |
| 4h | 64 816.2 | 68 053.7 | 61 732.8 | 578.1 | 550.6 (−4.8%) |

Симметрия относительно mean держится в пределах 0.5–4.8% (расхождение растёт с ТФ — mean успевает сместиться между отрисовкой линий). Ширина внешней полосы проверена визуально: на 4h расчётный redHi = 70 366 при видимой верхней границе красной зоны ≈70–71 тыс. ✓

**Мера отклонения — семейство ATR.** `STDEV(200)` исключён: ошибается в 2.4–6.5 раза (на 5m 0.607% против якоря 0.094%). ATR(RMA,200), ATR(SMA,200) и SMA(high−low,200) дают 0.76–1.56 от якоря — в пределах сдвига данных (архивы заканчиваются 27.07T23:55, якоря 28.07 ≈13:00). **Средняя — EMA(200)**: ближе всех к якорям на 1h (+0.30%) и 4h (−0.78%); SMA (+0.75% / −2.79%), RMA (−0.23% / +1.59%), WMA (+0.50% / −1.23%) хуже.

Реализация: `tmp/diag/ggiZone2.ts` (не канон — исследовательский слой). Канонический `tools/shared/ggiZone.ts` (EMA-от-EMA, kInner 2.68, kOuter 6.65) — устаревшая аппроксимация по одному скрину BTC 1h; **новые данные её опровергают**, структура другая.

### Геометрия сделки — подтверждена трижды

TRX 2h, ОДИН И ТОТ ЖЕ сигнал в двух режимах (прямое A/B от пользователя):

| Режим | entry | add | stop | entry−add | add−stop |
|---|---|---|---|---|---|
| risk | 0.32430 | 0.31959 | 0.31484 | 0.00471 | 0.00475 |
| safe | 0.32425 | 0.31743 | 0.31049 | 0.00682 | 0.00694 |

**Стоп ЗЕРКАЛЕН добору: stop = 2×add − entry** (расхождение <3%, три независимых образца: VIRTUAL 5m, TRX 2h risk, TRX 2h safe). Средняя цена входа = (entry+add)/2, риск от неё = 1.5 шага. Вход от режима НЕ зависит (0.32430 vs 0.32425); **safe/risk различаются только длиной шага, отношение 0.00682/0.00471 = 1.46** — подтверждает слова автора «в risk-моде добор короче и стоп короче, что позволяет брать большее соотношение».

**Цели ДИНАМИЧЕСКИЕ и совпадают с линиями индикатора точно**: на TRX 2h `fix25` = 0.32931 = метка средней линии, `TP` = 0.33459 = метка нижней линии красной зоны. Обе метки идентичны в safe и risk. Пересчитываются каждой закрытой свечой; если уровень частички ушёл под вход — выход в безубыток при первой возможности (правило автора).

### Как считается заявленный вин рейт — подтверждено на ОТРИЦАТЕЛЬНОМ примере

ADA 45m risk (единственный минусовой пример, который пользователь смог найти): Trades 20 · Winrate 60% · Partial 7 (35%) · Stop 8 (40%) · Full fix 5 (25%). Проверка: (7+5)/20 = **60% — частичка считается ПОБЕДОЙ наравне с полным тейком**. Сам автор в видео: «не буду обращать внимание на частичные фиксации в таблице, я смотрю стопы и фулфиксы». То есть корректное чтение его таблицы — сравнение Stop против Full fix, а цифра Winrate декоративна. Это ровно тот механизм накрутки вин рейта, который независимо описан в §16.27 (частичка + БУ конвертирует прибыль раннера в вин рейт).

Разброс доли стопов по его же примерам: AAVE 45m 9% · TRX 2h safe 9% · TRX 2h risk 15% · ADA 45m risk **40%**. Рабочий процесс из гайда — «открыть монету, посмотреть таблицу, если фулфиксов больше стопов торговать, иначе пропустить» — это выбор инструмента и ТФ ПОСЛЕ просмотра результата, то есть закрытая практика (CONTEXT §5, легаси §7: «выбор лучшего TF после просмотра результата», «удаление монет по observed PnL»). Выборки 14–34 сделки.

### Упрощённый индекс страха и жадности

Классический индекс: волатильность 25% + импульс/объём 25% + соцсети 15% + опросы 15% + доминация BTC 10% + Google Trends 10%. Pine Script не делает произвольных HTTP-запросов — только `request.security` по символам TradingView, поэтому твиты/опросы/тренды **технически недостижимы**; доминация (`CRYPTOCAP:BTC.D`), общая капитализация и открытый интерес по многим перпам — достижимы. Максимум реализуемого в Pine ≈ 60% веса классической формулы. Реализация двухкомпонентной версии (волатильность 50% + импульс/объём 50%, каузальная z-нормировка по бегущему окну, логистика в 0..100): `simplifiedFearGreed()` в tmp/diag/ggiSystem.ts.

### Результат воссоздания (8 монет, БЕЗ отбора монет и ТФ, train до 01.01.2025 / test после)

Полосы v2 по фактическим настройкам, вход по касанию внутреннего края, добор, зеркальный стоп, частичка 25% на средней, фулл на противоположной полосе:

| Ширина полос | Частота | train | test |
|---|---|---|---|
| ×0.6 | 1 сигнал/144 бара | WR 48.7% E −0.056R | WR 48.6% E −0.039R |
| ×0.8 | 1/204 | WR 49.1% E −0.093R | WR 48.2% E +0.008R |
| **×1.0 (как в настройках)** | **1/261** | **WR 53.9% E +0.047R** | **WR 55.5% E +0.063R** |
| ×1.2 | 1/331 | WR 53.3% E −0.107R | WR 53.6% E −0.065R |
| ×1.5 | 1/468 | WR 53.4% E −0.147R | WR 57.7% E −0.077R |

**Ширина ровно 1.0 — локальный оптимум, и он НЕ подогнан: значение взято из скрина настроек, соседи по сетке хуже с обеих сторон.** Частота 1 сигнал на 261 бар совпадает с его таблицами (20–34 сделки на загруженной истории ≈ 1 на 250 баров). Распределение исходов на 1h test (24.5% фулл / 31% частичка / 44.5% стоп) практически совпадает с его ОТРИЦАТЕЛЬНЫМ примером ADA (25/35/40) — то есть реконструкция попадает в его же статистическое семейство, а рекламные цифры соответствуют благоприятному концу разброса по инструментам.

Старая модель полос (v1, kInner 2.68) на тех же прогонах давала WR 61–66% при отрицательной экспектации на всех ТФ (15m −0.070R, 1h −0.084R, 4h −0.153R) — то есть завышала вин рейт и занижала качество; после уточнения параметров картина изменилась качественно.

### ОТКЛОНЕНО: динамические цели индикатора в нашей системе

Главная гипотеза («украсть динамическую цель — она адаптивна к волатильности, в отличие от нашего статичного 12R») проверена на НАШИХ входах (зоны ликвидности, связка 1h→15m, 8 монет, комиссии 0.05% на сторону по факту исполнений):

| Профиль выхода | train | test | монет+ |
|---|---|---|---|
| **наш пресет: частичка 0.4R (25%) → БУ → фикс 12R** | WR 74.3% E +0.078R | **WR 73.2% E +0.092R Σ+342R** | **8/8** |
| частичка на средней линии + фикс 12R | WR 42.3% E +0.071R | WR 42.0% E +0.092R | 7/8 |
| частичка 0.4R + фулл на полосе | WR 74.1% E +0.025R | WR 72.9% E +0.032R | 8/8 |
| оба уровня динамические (метод автора) | WR 49.5% E +0.026R | WR 51.2% E +0.044R | 7/8 |
| оба динамические + ворота страха 40 | WR 48.2% E +0.015R | WR 48.7% E −0.002R | 4/8 |
| оба динамические + ворота страха 30 | WR 47.6% E +0.018R | WR 46.2% E +0.005R | 5/8 |
| фулл на полосе ×1.5 (дальше) | WR 74.2% E +0.030R | WR 73.1% E +0.033R | 8/8 |

**Динамическая цель проигрывает фиксированному 12R в три раза по экспектации** (+0.032R против +0.092R). Причина прямо следует из §16.27: вся прибыль системы сидит в ДАЛЬНЕЙ цели, а противоположная полоса расположена ближе 12R и обрезает раннер; расширение полосы в 1.5 раза улучшает результат (+0.033R), что подтверждает механизм. Перенос частички на среднюю линию рушит вин рейт с 73% до 42% (средняя далеко, частичка перестаёт срабатывать рано). Ворота страха/жадности на зонных входах вредят (в отличие от их эффекта на касаниях полосы, где они улучшали монотонно) — контекст применения меняет знак, как и с GGI-фильтром в §16.25–16.26.

**Вывод: наш пресет из §16.26 остаётся лучшим (test WR 73.2%, E +0.092R, 8/8 монет). Из индикатора взято знание, а не механика.**

### Открытые пункты по индикатору

1. Точная мера отклонения не идентифицирована (ATR-семейство подтверждено, конкретный вариант — нет): архивы на 13 ч старше live-скринов. Закрывается одним скрином строки статуса индикатора на ЛЮБОМ историческом баре внутри нашего окна данных (в «Стиле» уже включены «Значения в строке статуса»).
2. Привязка entry/add/stop к полосам не выведена: эти уровни заморожены на баре сигнала, а метки полос на скринах — текущие. Нужны значения полос НА баре сигнала.
3. Не проверено: спот против фьючерсов и разные биржи (пользователь отмечает, что на Bybit-фьючерсах статистика лучше) — у нас данные только Binance USDT-M.

## 16.29 ИНВЕРТИРОВАННЫЙ GGI-фильтр: сигнал индикатора помечает худшие входы; упрощённое v0.4 и режим в визуализаторе (28.07.2026, ночь)

Идея пользователя: «есть зона интереса, там появляется сигнал на покупку/продажу как доп-фактор, что повышает вероятность». Проверено — и знак оказался ОБРАТНЫМ.

### Постановка

Раньше GGI проверялся в двух ролях и обе провалились: как фильтр по СОСТОЯНИЮ полос (§16.25–16.26) и как источник ДИНАМИЧЕСКИХ ЦЕЛЕЙ (§16.28). Третья роль — сам СИГНАЛ индикатора (касание внутреннего края с перевзведением по средней) как признак у зонного входа — не проверялась. Полосы взяты по фактическим параметрам вендора (§16.28: hlc3, окно 200, 5.6/9.6, EMA-средняя, ATR-отклонение). Связка 1h→15m, 8 монет, профиль выхода зафиксирован (частичка 0.40R 25% → БУ → фулл 12R), комиссии всегда net.

### Результат: фактор сильный и ОТРИЦАТЕЛЬНЫЙ

Разрез «есть сигнал GGI рядом» против «нет сигнала» (test, профиль зафиксирован):

| Подмножество | n | WR | Экспектация | Σ |
|---|---|---|---|---|
| все входы (эталон) | 3541 | 71.8% | +0.090R | +320R |
| есть сигнал на 15m ≤50 баров | 1042 | 66.1% | **−0.094R** | −98R |
| НЕТ сигнала | 2499 | 74.1% | **+0.167R** | +418R |
| есть сигнал на 4h в тот же бар | 50 | 46.0% | **−0.507R** | −25R |
| есть сигнал на 1h в тот же бар | 24 | 62.5% | −0.357R | −9R |
| вход ВНУТРИ полосы | 1476 | 66.7% | +0.026R | +39R |
| вход ВНЕ полосы | 2065 | 75.4% | +0.136R | +281R |

Эффект монотонен по размеру окна, воспроизводится на ТРЁХ ТФ независимо (15m, 1h, 4h) и виден на train отдельно (+0.079 → +0.122R), то есть найден бы и без взгляда на test. Чем «свежее» и старше ТФ сигнала — тем хуже подмножество: сигнал на 4h в тот же бар даёт −0.507R.

**Экономический смысл прямой и совпадает с §16.18.** Сигнал полос означает «цена растянута к экстремуму». Разбор 10 стопов ETH выделил группу C — контртренд-ножи: полка ликвидности в свежем сильном движении это топливо продолжения (каскад ликвидаций), а не разворот. GGI-сигнал — количественный маркер именно этого состояния. Поэтому правильное использование индикатора на зонных входах — не «подтверждение», а **вето**.

### Отбор окна и верификация

Окно выбрано ТОЛЬКО по train (максимум экспектации при выборке ≥3000 сделок): 200 баров ТФ подтверждения. Затем один взгляд на test.

Прогон САМОГО ДВИЖКА (пресеты v0.3 против v0.4, 1h→15m, 8 монет):

| | v0.3 (без фильтра) | v0.4 (с фильтром) |
|---|---|---|
| train | n=13 347 · WR 73.6% · E +0.074R · Σ +986R · PF 1.28 | n=6073 · WR 74.8% · E **+0.103R** · Σ +627R · PF 1.40 |
| **test** | n=4969 · WR 73.6% · E +0.081R · Σ +403R · PF 1.30 · DD 148.8R | n=2352 · WR **75.8%** · E **+0.143R** · Σ +337R · PF **1.58** · DD **95.3R** |
| полугодий в плюсе | 10/12 | **11/12** |
| полугодий с WR в коридоре 70–85% | 12/12 | **12/12** |

Вин рейт на тесте по монетам вырос НА ВСЕХ: ADA 73→76 · BNB 72→76 · BTC 75→79 · DOGE 74→77 · ETH 73→74 · LINK 74→74 · SOL 75→78 · XRP 73→73. Экспектация положительна у 7 из 8 (BTC перевернулся из −0.07R в +0.06R; минус остался только у XRP −0.03R). Максимальная просадка сократилась почти вдвое.

Цена: выборка режется больше чем вдвое (4969 → 2352 сделки на тесте). Суммарный результат немного ниже (+403 → +337R), но качество сделки, вин рейт, профит-фактор и просадка лучше по всем разрезам.

### Реализация

- **`src/core/signals/GgiZoneEngine.ts`** (`ggi-zone-2.0-vendor-params`) — полосы и сигналы по фактическим параметрам вендора; `computeGgiBands`, `detectGgiSignals`, `ggiStateAt`. Канонический `tools/shared/ggiZone.ts` (EMA-от-EMA, 2.68/6.65) остаётся для истории, но структурно опровергнут (§16.28).
- **Упрощённое подтверждение v0.4** (`simplified-confirmation-0.4-ggi-exclusion`): конфиг-поле `ggiExcludeBars` (0 = ВЫКЛ по умолчанию, канон не тронут) + `ggiParams`; пресет `SIMPLIFIED_HIGH_WR_PRESET_V4` = v0.3 плюс `ggiExcludeBars: 200`.
- **Визуализатор**: селектор «Уточнённое / Упрощённое v0.4» в панели подтверждения — упрощённый режим рисует зону, вход, стоп, частичку и фулл линиями с подписями в % цены и в R, события PARTIAL/BE/FULL/STOP маркерами, статус с исходом и результатом. Чекбокс «полосы GGI» рисует среднюю, внутренние края красной и зелёной зон и сигналы жёлтыми метками с подписью «растянуто вверх/вниз» — видно, отброшен ли вход фильтром и почему. Полосы доступны в обоих режимах. Сервер отдаёт `ggi` (параметры, ряд полос, сигналы) и `simplifiedConfirmation` (пресет v0.4).

Гейт: тесты **323/323** (+7: параметры вендора зафиксированы буквально, симметрия и порядок полос, источник hlc3 вместо close, один сигнал на заход в зону с перевзведением по средней, зеркальность шорта, состояние на баре, флаг фильтра выключен по умолчанию и включён в пресете v4), `tsc --noEmit` чистый, `node --check` всех .mjs чистый.

### Состояние веток (инвентаризация 28.07)

Слиты в main и могут быть удалены: feat/bos-choch-engine, feat/leg-context-enclosing-legs, feat/market-trend-hysteresis, feature/multi-tf, feature/portfolio-research, fix/bug3-two-candle-confirmation, liquidity-improvements-v1 (PR #7), poi-structural-areas-v08, v0/context-and-spec-b162dbe7, v0/spec-update-and-test-fix, v0/zonda6996-30c2076c. НЕ слиты: simplified-mode-v1 (рабочая, 10 коммитов над main) и v0/nekit0440-4504-665bfbbe (1 коммит от 14.07 — проверить и закрыть). Удаление и merge — только по явной просьбе пользователя.

## 16.30 Поправка по сигналу вендора: сигнал — ВНЕШНИЙ край, а полезное вето — ЗАХОД в зону (28.07.2026, ночь)

Пользователь указал на две ошибки в §16.29: подпись «растянуто вверх/вниз» на графике непонятна, и сигналы в визуализаторе появляются не там, где у вендора («на м15 от каждого касания сигнал не появляется»). Прислал эталон BTC 15m 12–16.07.2026. Обе ошибки подтвердились.

### Полосы подтверждены численно

Мои значения на BTC 15m 14.07 06:00 против эталонного скрина: средняя 62979 против ~62950 (+0.05%), внутренний край зелёной 62124 против ~62150 (−0.04%), внутренний край красной 63834 против ~63750 (+0.11%). **Модель полос (hlc3, окно 200, 5.6/9.6, EMA-средняя, ATR-отклонение) верна** — расхождение в десятые доли процента.

### Ошибка в сигнале: был внутренний край вместо внешнего

В расшифровке видео зафиксировано «сигнал = касание ВНЕШНЕЙ полосы», а в §16.29 реализовано касание внутреннего края. Проверка на эталоне: абсолютный минимум окна — 13.07 18:15, low 61806 (у пользователя на шкале «Мин. 61 824,97» — та же точка, другая биржа), и **именно на этом баре цена достала ВНЕШНИЙ край** зелёной зоны (61883). До минимума цена провела 46 баров ВНУТРИ зоны, не давая сигнала — что и означает «от каждого касания сигнал не появляется». Частота: внешний край 1 сигнал на 475 баров 15m (2 сигнала в окне эталона — ровно как на скрине), внутренний 1 на 204. Дополнительная деталь из скрина «Стиль»: у вендора `Upper Zone Upper Line` и `Lower Zone Lower Line` ОТКЛЮЧЕНЫ — внешние края на его графике не нарисованы и видны только по заливке, поэтому визуально полоса кажется уже, чем она есть.

`GgiZoneEngine` → `ggi-zone-2.2-outer-edge-signal`, параметр `signalMode: 'outer' | 'inner' | 'exit'`, дефолт **'outer'** (канон вендора). Вариант 'exit' (закрытие обратно за внутренним краем) проверен и отвергнут: даёт 1 сигнал на 110 баров и 4 сигнала в окне эталона вместо 2.

### Переверификация §16.29: находка выжила, но смысл другой

Тот же протокол (окно выбрано ТОЛЬКО по train, профиль выхода зафиксирован, 8 монет, связка 1h→15m):

| Вето | train | test | монет+ | полугодий+ | WR в коридоре |
|---|---|---|---|---|---|
| нет (эталон) | WR 73.9% · +0.073R | WR 71.8% · +0.090R | — | — | — |
| ВНЕШНИЙ край, окно 50 | WR 74.4% · +0.097R | WR 73.2% · **+0.115R** | 6/8 | 9/12 | 11/12 |
| внутренний край, окно 200 | WR 76.3% · +0.137R | WR 75.5% · **+0.177R** | 6/8 | **11/12** | 11/12 |

**Полезен нашей системе не «сигнал вендора», а СОСТОЯНИЕ «цена недавно заходила в зону экстремума».** Внутренний край — это заход в зону (состояние), внешний — редкое событие у экстремума (сигнал). Как вето состояние сильнее события: +0.177R против +0.115R. Экономический смысл §16.29 не меняется (группа C §16.18: полка в свежем сильном движении — топливо продолжения), но формулировка уточняется: важна не метка BUY/SELL, а сам факт растянутости.

### Итог по движку

`simplified-confirmation-0.5-zone-visit-veto`. Поле `ggiExcludeBars` (0 = ВЫКЛ, канон не тронут) + `ggiParams`. Два пресета:

- **`SIMPLIFIED_HIGH_WR_PRESET_V4`** — вето по ЗАХОДУ в зону (`signalMode: 'inner'`, окно 200). Прогон движка: train n=6073 WR 74.8% E +0.103R; **test n=2352 WR 75.8% E +0.143R Σ +337R PF 1.58 DD 95.3R**; полугодий в плюсе 11/12, с WR в коридоре 12/12, монет в плюсе 7/8. Максимум качества сделки.
- **`SIMPLIFIED_VENDOR_SIGNAL_PRESET`** — вето по НАСТОЯЩЕМУ сигналу вендора (`'outer'`, окно 50). train n=11 829 WR 73.8% E +0.085R; **test n=4449 WR 74.5% E +0.098R Σ +435R**; полугодий 10/12, WR в коридоре 12/12, монет 6/8. Сделок вдвое больше, суммарный результат ВЫШЕ (+435R против +337R), качество сделки ниже. Точнее воспроизводит индикатор.

Против v0.3 (test WR 73.6% E +0.081R Σ +403R, полугодий 10/12, монет 6/8) оба пресета лучше по качеству; выбор между ними — качество сделки против суммарного результата.

### Визуализатор

Подпись «растянуто вверх/вниз» убрана — метки называются `GGI BUY` / `GGI SELL`, как у вендора; объяснение перенесено в панель деталей строкой «Полосы GGI»: метки ставятся по внешнему краю (канон вендора), а вето пресета v4 работает по заходу в зону с окном 200 баров. Пунктирные линии на графике — внутренние края, сплошная синяя — средняя.

Гейт: тесты **324/324** (+1: внешний край не может срабатывать чаще внутреннего), `tsc --noEmit` чистый, `node --check` всех .mjs чистый.

## 16.31 Потолок цели в % цены — ОТВЕРГНУТ; четыре бага визуализатора исправлены (28.07.2026, ночь)

### Гипотеза «дефект цели в 47% хода» проверена и ОТВЕРГНУТА

На скрине пользователя в панели упрощённого режима стояло: фулл 34 101 при входе 64 156, то есть цель на 46.85% ниже цены. Механика: цель задана в стопах (12R), а стоп в той сделке 3.90% цены → 12 × 3.90 = 47%. Гипотеза: такая цель недостижима, надо ограничить её сверху ещё и в % цены. Проверка (связка 1h→15m, 8 монет, частичка 0.4R/25%, эффективная цель = min(12R, потолок% / стоп%)):

| Потолок | train E | test E | доля фуллов (test) |
|---|---|---|---|
| 6% | +0.036R | +0.031R | 14.7% |
| 8% | +0.040R | +0.038R | 11.4% |
| 10% | +0.043R | +0.052R | 9.6% |
| 15% | +0.054R | +0.063R | 6.8% |
| 20% | +0.059R | +0.070R | 5.3% |
| 25% | +0.064R | +0.081R | 4.6% |
| 30% | +0.074R | +0.086R | 4.1% |
| **без потолка** | **+0.073R** | **+0.090R** | 3.7% |

**Зависимость монотонная: любое ограничение цели ухудшает результат.** Вин рейт при этом НЕ меняется вообще (73.9% train / 71.8–72.0% test на всех потолках) — его задаёт частичка, а не дальняя цель. Проверка при разных целях в стопах (6/8/12/20/40R) даёт ту же картину: чем выше потолок, тем лучше.

Вывод: 47%-я цель — не дефект, а лотерейный билет, который стоит своих денег. Это прямое подтверждение §16.27: вся прибыль системы сидит в дальней цели, и редкие сделки, проходящие десятки процентов, оплачивают массу безубытков. Обрезать хвост нельзя. Гипотеза закрыта, в отрицательное знание.

### Баг 1: «график пропадает» — наложения растягивали шкалу цены

Линии-наложения (`line()` в chart.mjs) добавлялись обычными LineSeries на общую правую шкалу и участвовали в автомасштабе. Далёкий уровень — например та самая цель на 47% хода — растягивал шкалу, и свечи сплющивались в тонкую полоску: визуально график пропадал. Исправление: `autoscaleInfoProvider: () => null` по умолчанию для всех наложений (нужна линия, влияющая на масштаб — передать `autoscale: true`). Дополнительно в упрощённом режиме цель дальше 12% хода рисуется не линией, а подписью у входа с указанием, на сколько процентов она ушла.

### Баг 2: переключение режимов не возвращало основной ряд свечей

`activateMode` возвращал основные свечи только через рендер конкретной панели, а зум восстанавливался лишь в `deactivateMode`. Переход «подтверждение → зоны» оставлял на графике ряд ТФ подтверждения, и прямоугольники зон ложились на чужую шкалу времени — пустой экран. Исправление: при входе в режимы, рисующие по основному ряду (боевой вид и зоны), ряд и зум восстанавливаются ДО отрисовки; в `deactivateMode` добавлена страховка — если после возврата видимый диапазон оказался вне данных, вызывается fitContent.

### Баг 3: локальные зоны по-прежнему прилипали к левому краю

§16.22 объявил, что слоёные зоны рисуются «с последнего вклада в полку (max startAt пулов)», но в коде брался `Math.max(...pivotTimes)` — пивоты бывают старыми, поэтому прямоугольник всё равно тянулся от левого края. Настоящего поля в кандидате не было. Исправление: движок зон выставляет наружу новое диагностическое поле **`lastContributionAt`** (максимум `lastContributionAt` по пулам стека; на логику зон не влияет, 0 при отсутствии данных), визуализатор рисует слой с него, фокус-зона — по-прежнему полной длиной от рождения. Оставлен откат на прежнее поведение по пивотам для старых ответов сервера.

### Баг 4: сайдбар — одновременно раскрытые панели разных режимов

Активен всегда ровно один режим, но секции остальных оставались раскрытыми и путали. Теперь при входе в режим секции других режимов сворачиваются автоматически.

Гейт: тесты **325/325** (+1: зона выставляет наружу время последнего вклада), `tsc --noEmit` чистый, `node --check` всех .mjs чистый.

## 16.32 Точные якоря полос на историческом баре: формула отклонения НЕ из семейства ATR (29.07.2026)

Пользователь снял строку статуса индикатора на баре **20 июля 2026, 12:00 UTC** на двух ТФ — это первый замер внутри окна наших данных, без сдвига по времени.

| ТФ | его O/H/L/C | mean | redLo | greenHi | dev = (redLo−mean)/5.6 | асимметрия |
|---|---|---|---|---|---|---|
| 1h | 65002.00 / 65002.83 / 64599.89 / 64640.00 | 64281.12 | 65639.90 | 62950.47 | **240.13** | 2.1% |
| 15m | 65002.00 / 65002.85 / 64716.57 / 64750.00 | 64526.70 | 65520.74 | 63547.75 | **176.16** | 1.5% |

**Первое: бар определён ВЕРНО, но фид смещён.** Поиск по OHLC подтвердил: на обоих ТФ ближайший бар — именно 2026-07-20 12:00 UTC (то есть 17:00 при UTC+5, сопоставление времени правильное). Мой бар (Binance USDT-M): 1h O 64970.8 H 64982 L 64571 C 64627.2; 15m O 64970.8 H 64982 L 64668.1 C 64729.6. Его цены систематически на ~30 пунктов (0.05%) ВЫШЕ на обоих ТФ. Пользователь уточнил, что скрины с Binance — значит это НЕ другая биржа, а скорее всего спот против USDT-M фьючерсов (типичный базис). **Постоянное смещение цены на отклонение не влияет**, поэтому расхождение отклонения им не объясняется — формула действительно другая.

**Второе, важное: средняя ложится хорошо, отклонение — нет.**

Средняя (ошибка к якорю): 1h — WMA −0.16%, EMA −0.41%, SMA −0.46%, RMA −1.09%; 15m — WMA −0.05%, SMA −0.07%, EMA −0.21%, RMA −0.41%. **Лучший кандидат теперь WMA(200), а не EMA** (был выбран по live-якорям с 13-часовым сдвигом, §16.28).

Отклонение (ошибка к якорю):

| Мера | 1h | 15m |
|---|---|---|
| ATR rma(200) | **+36.4%** | **−20.2%** |
| ATR sma(200) | +27.3% | −28.6% |
| ATR ema(200) | +25.0% | −15.9% |
| среднее (H−L, 200) | +27.3% | −28.6% |
| MAD sma/ema | +207% | +86% |
| MAD ema/ema | +204% | +75% |

**Ни одна мера не подходит: на 1h моя оценка систематически ЗАВЫШЕНА, на 15m ЗАНИЖЕНА.** Знак ошибки противоположный и воспроизводится на двух датах независимо: live-якоря 28.07 давали 1h +25.9% и 15m −19.7%, исторические якоря 20.07 дают +36.4% и −20.2%. Это не шум фида и не сдвиг времени — это другая формула.

Диагностика соотношений: его dev на 1h / его dev на 15m = 240.13/176.16 = **1.363**. У ATR(200) то же соотношение = 327.42/140.60 = **2.329**. То есть его отклонение растёт с таймфреймом ГОРАЗДО медленнее, чем ATR — примерно как время в степени 0.22 вместо 0.5. Гипотезы для следующей итерации (ни одна не проверена): период отклонения отличается от периода средней; отклонение считается на фиксированном старшем ТФ и подмешивается; используется размах highest/lowest окна вместо ATR; нормировка на корень из числа баров.

**Задача поставлена численно: подобрать (мера × период) так, чтобы одновременно попасть в 240.13 на 1h и 176.16 на 15m при mean = WMA(200) от hlc3.**

Прогон сетки (8 мер × 11 периодов) по всем четырём точкам: ни одна пара не даёт максимальную ошибку ниже 26%. НО опорные точки неравноценны: якоря 20.07 сняты со СТРОКИ СТАТУСА (точные числа), якоря 28.07 прочитаны с ценовой шкалы по пикселям (грубые). **Если доверять только точным якорям 20.07, лучший кандидат — ATR(sma) с периодом 75: ошибка +6% на 1h и +4% на 15m.** Второй по качеству — ATR(sma,50): +8% и +23%.

**Ведущая гипотеза: «Lookback Period 200» из настроек относится к СРЕДНЕЙ, а у отклонения свой период порядка 50–75.** Проверить на новых точных якорях (нужны замеры строки статуса ещё на 2–3 датах и на 5m/4h) и на скрине настроек СИГНАЛЬНОГО индикатора — он отдельный от «GGI Zone» и его входы ещё не видели, там может быть период отклонения в явном виде.

Пока не решено — полосы в визуализаторе показывать с пометкой «калибровка не завершена».

### Наблюдения пользователя по сигнальному индикатору (важные правила, не реализованы)

1. **BUY появляется ТОЛЬКО на бычьей свече, SELL только на медвежьей.** В оригинале не бывает SELL на зелёной свече. У нас на сливе рисуется BUY на красной свече — это прямая ошибка правила. Отсюда следует, что сигнал требует РАЗВОРОТНОЙ свечи, а не просто касания края: BUY = цена в зоне перепроданности И бар закрылся выше открытия; SELL зеркально. Это же объясняет, почему метка садится у самого экстремума.
2. **В ОРИГИНАЛЕ (TradingView, не у нас) сигнал может появиться на незакрытом баре и исчезнуть по его закрытию.** Пользователь уточнил, что это поведение ЕГО индикатора, а не нашего. Значит оригинал считается вживую на текущем баре, а окончательное состояние определяется закрытием — постфактум он не рисует, look-ahead нет. Наш движок считает только по закрытым барам, то есть строже; при сверке с оригиналом это надо учитывать (у него на живом баре метка может мигать).
3. Расхождения с оригиналом «довольно сильные» — ожидаемо, пока не решена задача калибровки отклонения (см. выше).

Из кода и интерфейса убираются все упоминания «GGI» — это приватный индикатор пользователя, наши модули должны называться своими именами. Предложены и приняты рабочие названия:


### Настройки СИГНАЛЬНОГО индикатора (скрин 29.07): числовых входов нет

Вкладка «Аргументы» индикатора GGI Buy/Sell содержит РОВНО два элемента: `RISK SETTINGS → Risk Mode` (Safe mode / Risk mode / Standard mode) и `GGI ZONE → Скрыть GGI Zone` (чекбокс). Больше ничего.

Три следствия:

1. **Формула полностью зашита в код** — периодов и множителей в интерфейсе нет, значит калибровка возможна только численно, по замерам строки статуса. Скриншотом настроек эту задачу не закрыть.
2. **Сигнальный индикатор СОДЕРЖИТ полосы внутри себя** (иначе не было бы чекбокса «скрыть GGI Zone»), то есть использует те же полосы с теми же дефолтами 200 / 5.6 / 9.6 и источником hlc3. Калибровка полос закрывает оба индикатора сразу.
3. **Три режима — единственный пользовательский параметр**, что совпадает с реализованными в `tmp/diag/ggiSystem.ts` safe / risk / standard.

### Новая ведущая гипотеза по отклонению: окно фиксировано во ВРЕМЕНИ, а не в барах

Наблюдение, которое надо объяснить: его отклонение почти не растёт с таймфреймом. Соотношение 1h/15m у него **1.363**, у ATR на одинаковом числе баров — **2.329** (то есть примерно корень из отношения времён). Если бы окно отклонения задавалось в барах, соотношение обязано быть около 2.

Гипотеза: **окно отклонения задано во времени (например 200 часов), а не в барах** — тогда на 1h это 200 баров, на 15m уже 800 баров, и величина отклонения между ТФ почти не меняется. Это объясняет и плоское соотношение, и почему ATR(200) на 15m у меня ЗАНИЖЕН (короткое окно), а на 1h ЗАВЫШЕН.

Проверка для следующей итерации: посчитать ATR с периодом, приведённым к общему времени (period = 200 × (базовый ТФ / текущий ТФ)) и сверить с четырьмя опорными точками; отдельно проверить вариант с нормировкой на корень из числа баров в окне. Также добавить замеры строки статуса на 5m и 4h — на крайних ТФ гипотеза «фиксированное время» и «фиксированные бары» расходятся сильнее всего, и одно измерение их разделит.

### Решения по терминологии

Названия выбрал пользователь (29.07). Первые два набора от ассистента отклонены («Растяжка»/«Разворот» — слишком официальные; «Резинка»/«Щелчок» — не подошли). Принято окончательно:

- **Zonda Apex** — индикатор экстремумов (перекупленность/перепроданность), то что раньше называлось полосами. Короткое имя в коде и файлах: **`Apex`**.
- **Zonda Reversal** — индикатор Buy/Sell сигналов. Короткое имя: **`Reversal`**.

Все упоминания «GGI» из кода, интерфейса и полей ответа сервера удаляются — это приватный индикатор пользователя, наши модули носят свои имена. Схема переименования (делать механически, одним проходом):

| Было | Стало |
|---|---|
| `src/core/signals/GgiZoneEngine.ts` | `src/core/signals/ApexEngine.ts` |
| `GGI_ZONE_ENGINE_VERSION` = `ggi-zone-2.2-outer-edge-signal` | `APEX_VERSION` = `apex-1.0-vendor-params` |
| `GgiZoneParams`, `GGI_ZONE_PARAMS` | `ApexParams`, `APEX_PARAMS` |
| `GgiBand`, `computeGgiBands` | `ApexBand`, `computeApexBands` |
| `GgiSignal`, `detectGgiSignals`, `ggiStateAt` | `ReversalSignal`, `detectReversals`, `apexStateAt` |
| поле конфига `ggiExcludeBars` | `apexVetoBars` |
| поле конфига `ggiParams` | `apexParams` |
| блок ответа сервера `ggi` | `apex` (полосы) и `reversal` (сигналы) — разнести на два, они станут отдельными слоями |
| метки на графике `GGI BUY` / `GGI SELL` | `BUY` / `SELL` (панель подписывается «Zonda Reversal») |
| чекбокс «полосы GGI» | «Zonda Apex» |
| `tools/shared/ggiZone.ts` (устаревшая аппроксимация) | удалить, структурно опровергнута §16.28 |
| `tmp/diag/ggiZone2.ts`, `tmp/diag/ggiSystem.ts` | `tmp/diag/apex.ts`, `tmp/diag/reversal.ts` |

Версии движков после переименования бампаются: `apex-1.0-vendor-params`, `reversal-1.0-outer-edge`. В `SimplifiedConfirmationEngine` версия становится `simplified-confirmation-0.6-apex-veto`, пресеты — `SIMPLIFIED_APEX_VETO_PRESET` (бывший `..._V4`, вето по заходу в зону) и `SIMPLIFIED_REVERSAL_VETO_PRESET` (бывший `..._VENDOR_SIGNAL_PRESET`, вето по сигналу).


## 16.33 Zonda Apex и Zonda Reversal — разделение движков и калиброванные полосы (29.07.2026)

Приватное имя удалено из исполняемого кода и интерфейса. Полосы называются **Zonda Apex**, сигналы — **Zonda Reversal**; это два независимо включаемых слоя и два отдельных блока payload.

### Apex: apex-1.0-calibrated-log-alma

По 14 историческим якорям Binance Spot BTC 5m/15m/4h и ETH 1h установлено: mean = ALMA(hlc3, 200, 0.85, 6); границы логарифмические: mean × exp(±k×s), где k=5.6/9.6. Средняя переносится на внешние BTC 15m / ETH 1h с ошибкой 0.024% / 0.269%. Закрытая мера ширины восстановлена устойчивой аппроксимацией s = ALMA(TR/close, 122, 0.625, 3.5); максимальная наблюдаемая cross-symbol ошибка ширины около 4%, поэтому это не объявляется точной формулой вендора.

### Reversal: reversal-1.0-directional-candle

Reversal больше не равен касанию полосы. Край Apex взводит ожидание, после чего BUY разрешён только на бычьей свече (close>open), SELL — только на медвежьей (close<open). После сигнала сторона перевзводится возвратом к средней. Это минимальная модель по наблюдениям пользователя; дополнительные фильтры не вводились без данных. Результаты §16.29–16.30 подлежат повторной проверке, потому что прежняя реализация ставила метку непосредственно по касанию края.

### Совместимость

Временный GgiZoneEngine.ts удалён после перевода потребителей. SimplifiedConfirmationEngine получил поля apexVetoBars/apexParams, версию simplified-confirmation-0.6-apex-veto и пресеты SIMPLIFIED_APEX_VETO_PRESET / SIMPLIFIED_REVERSAL_VETO_PRESET. Дефолт вето остаётся выключенным; дефолты POI, heatmap и подтверждений не менялись.


## 16.34 TV-настройки Zonda Apex / Reversal (29.07.2026)

Apex и Reversal имеют независимые слои. Apex получает реальные server-side входы source/lookback/kInner/kOuter; канон остаётся hlc3/200/5.6/9.6. Стиль каждой из пяти линий, двух заливок и меток ценовой шкалы меняется без пересчёта и хранится локально. Reversal отдельно управляет BUY/SELL и режимом Safe/Standard/Risk; режим пока не меняет триггер до отдельной калибровки. Боковая панель 420 px, при узком desktop не меньше 400 px.


## 16.35 Независимые слои Apex/Reversal и дизайн-система (30.07.2026)

Apex/Reversal вынесены из Подтверждения в самостоятельную TV-style секцию. Inputs пересчитываются явно, Style применяется сразу; пять линий имеют отдельные видимость, системный цвет и толщину. Общий renderer восстанавливает слои после trades/zones/heatmap. Safe/Standard/Risk до калибровки не меняет триггер.


## 16.36 Снап MTF-зон к шкале отображаемых свечей (30.07.2026)

Визуальные t1/t2 слоёных зон снапаются к ближайшим существующим timestamps текущей candle series: начало вперёд, конец назад. Модельные времена и торговая логика не изменяются.


### §16.37 — Индикаторы на фактическом ряду графика

- Zonda Apex и Zonda Reversal считаются отдельно для основного ряда, ряда текущего подтверждения и каждого MTF-слоя.
- Renderer получает payload именно того ряда свечей, который сейчас показан; перенос сигналов между ТФ запрещён.
- Пользовательские Apex overrides едины для всех рядов и применяются одновременно к полосам и Reversal.
- Timestamp каждой полосы и сигнала обязан принадлежать исходному ряду соответствующего payload.


### §16.38 — Порядок сделок от текущих зон

- Навигация уточнённого и упрощённого подтверждения показывает сначала открытые сделки, живые попытки и сделки активных валидных зон.
- Внутри этой группы порядок: минимальная дистанция текущей цены до диапазона зоны → более свежее последнее пополнение полки → более новое событие сделки → стабильный идентификатор зоны.
- Закрытые исторические зоны не скрываются и идут после актуальных; порогов расстояния и иных новых magic numbers нет.


### §16.39 — Явные таймфреймы зон

- Каждая движковая зона показывает ТФ зоны в списке, подписи прямоугольника и карточке деталей, включая контекстные зоны текущего графика.
- Уточнённое и упрощённое подтверждение показывают пару «ТФ зоны → ТФ подтверждения» в статусе, прямоугольнике и деталях сделки.
- Формат TF единый и заметный: 1D, 4H, 1H, 15M, 5M; геометрия и логика движков не меняются.


## 16.40 Archive OI: полная история heatmap без Binance API (30.07.2026)

- Binance USD-M `daily/metrics` доступен через `data.binance.vision`; `monthly/metrics` отсутствует (404).
- Добавлен `tools/shared/archiveMetrics.ts`: parser по именам колонок, дневной дисковый кэш, retry/fail-soft и каузальное выравнивание последней точки `<=` времени свечи. Нативный шаг metrics — 5m; перенос протухает после двух шагов.
- CI на 2026-05-01..2026-07-29, 15m: BTC/ETH/SOL/XRP получили 99.99% покрытия (8543/8544 свечи каждый). OI-hybrid изменил число полос относительно volume fallback на всех активах.
- В visualizer свежий API-ряд имеет приоритет на перекрытии, архив заполняет остальную историю; ошибка архива сохраняет API/volume fallback. Формула и дефолты `liquidity-heatmap-2.0-oi-hybrid` пока не менялись.
- Это доказательство data path, не predictive edge. До bump 2.1 нужен magnet hit-rate против distance-matched control.

## 16.41 Zonda Reversal baseline: edge не подтверждён (30.07.2026)

- Архивы Futures 2023-01-01..2026-07-29; BTC/ETH/SOL/XRP; 5m/15m/1h; split 2025-01-01; round-trip cost 0.10%.
- Проверены 14 комбинаций inner/outer edge, touch/directional/reclaim confirmation и mean/inner re-arm. Отбор только по train.
- Все 14 комбинаций отрицательны net уже на train и остаются отрицательными на untouched test. Текущий `outer/directional/mean`, horizon 12: train −0.105% (n=2991), test −0.199% (n=2151).
- Лучший train-вариант `outer/touch/inner`: train −0.051%, test −0.211%. Safe/Standard/Risk не маппить и production defaults не менять: точная vendor-формула неизвестна, исследовательский edge отсутствует.


## 16.42 Post-partial time-stop: exit-only edge подтверждён, включение отложено (30.07.2026)

- Протокол: BTC/ETH/SOL/XRP/BNB/DOGE/ADA/LINK; 1h зоны → 15m simplified; 2021–2024 train, 2025–2026 untouched test; 5305 одинаковых входов и стопов; cost 0.10% цены; same-bar stop раньше цели.
- Baseline 12R зависит от хвоста: train E +0.076R, но ex-top1% −0.016R; test +0.104R, ex-top1% +0.010R; DD 49.410R.
- После исправления семантики таймер считается от бара PARTIAL. Train выбрал 80 полных 15m-баров: train +0.063R, ex-top1% +0.020R; untouched test +0.089R, ex-top1% +0.046R, PF 1.389, DD 13.424R. Диапазон 64–128 остаётся положительным, поэтому результат не является одиночным пиком.
- Движок v0.7 поддерживает postPartialTimeStopBars и outcome/event TIME. 0 выключает механику; существующие дефолты и пресеты не изменены.
- Включение в SIMPLIFIED_APEX_VETO_PRESET отложено: exit-only replay замораживал входы, а более ранний выход при reentry может породить дополнительные входы. Сначала нужен отдельный end-to-end replay с реальным жизненным циклом зоны.


## 16.43 Post-partial time-stop включён в Apex-пресет после end-to-end проверки (30.07.2026)

- End-to-end replay включил postPartialTimeStopBars=80 непосредственно в SimplifiedConfirmationEngine, поэтому раннее освобождение позиции могло создавать дополнительные re-entry. Число сделок изменилось с 3856/1449 до 3887/1463 (train/test).
- Результат с реальным lifecycle: train E +0.049R, ex-top1% +0.013R; untouched test E +0.082R, ex-top1% +0.041R, PF 1.358, DD 14.748R.
- Против baseline 12R raw test mean и PF ниже (+0.104R, PF 1.457), но tail-robust test mean выше (+0.041R против +0.010R), а DD ниже в 3.35 раза (14.748R против 49.410R). Train ex-top1% меняет знак с −0.016R на +0.013R.
- SIMPLIFIED_APEX_VETO_PRESET включает 80 баров. Для канонической связки 1h→15m это 20 часов после PARTIAL. SIMPLIFIED_CONFIRMATION_CONFIG остаётся с 0, а SIMPLIFIED_HIGH_WR_PRESET не изменён.
- Версия: simplified-confirmation-0.8-time-stop-preset.

## 16.44 Раздельный routing simplified/refined по §14.1 (30.07.2026)

- Исправлена архитектурная ошибка: один `CONFIRMATION_TF` использовался одновременно для обоих движков. Теперь `SIMPLIFIED_CONFIRMATION_TF` содержит первый TF после `/`, `REFINED_CONFIRMATION_TF` — второй: 1W→1D/4h, 1D→4h/1h, 4h→1h/15m, 1h→15m/5m.
- Visualizer server строит раздельные candle series, results и indicator payload для simplified/refined; панель выбирает их по `confEngine`. Тесты фиксируют все четыре строки и server/UI wiring.
- Старый end-to-end результат 1h-зон на 15m confirmation воспроизведён только как контроль старого протокола: train n=3887, E +0.049R, ex-top1% +0.013R; test n=1466, E +0.082R, ex-top1% +0.041R, PF 1.359, DD 14.748R. Небольшое отличие test n от прежних 1463 связано с правой границей данных 30.07.2026, а не с новым TF routing.
- Этот контроль НЕ является новым результатом corrected 1h→15m simplified ladder на общей логике проекта — он как раз соответствует этой строке. Для 4h→1h, 1D→4h и 1W→1D нужны отдельные replay; 80 баров означают соответственно 80 часов, 320 часов и 80 дней после partial. До этих replay переносить старую оценку time-stop на другие строки запрещено.
- Browser QA: Deep/OTE markers выключены по умолчанию, BOS/CHoCH включён, protected отдельно; duplicate DOM id и JS errors отсутствуют. TIME проверен на синтетической сделке с реальной подменой ряда.
- Баг последовательности Zones→Heatmap→Confirmation→закрыть Heatmap→закрыть Confirmation формализован. На fixture и синтетическом LTF текущая версия корректно вернула `mainShown=true` и исходный range; реальный визуальный дефект не объявлен исправленным и требует сохранённого payload, на котором проявляется.

## 16.45 Восстановление chart range, Heatmap primitive и новые наблюдения Apex/Reversal (30.07.2026)

- Исправлена сопутствующая ошибка: до подмены candle series сохранялся logical range в индексах баров, а после Confirmation те же индексы применялись к main series другого размера/TF. Теперь сохраняется timestamp visible range; browser regression 500 main bars → 2000 confirmation bars → main дал drift 0. Однако повторный пользовательский QA на реальных данных показал, что визуальный Б1 остался. Следовательно, это не полный root cause; Б1 остаётся открытым и по просьбе пользователя временно отложен.
- Heatmap больше не создаёт до 400 отдельных `LineSeries`; все полосы рисуются одним canvas primitive. На fixture 38 bands не увеличили overlay-series count (14→14), headless rAF показал 62 кадра за секунду. Это исправляет архитектурный источник лагов, но не является гарантией FPS для любой машины/истории.
- Новый BTC Spot TV anchor: 27.07.2026 01:00 Казахстан = 26.07 20:00 UTC, одинаковый bar-open на 4h/1h/15m/5m. Текущая Apex approximation дала mean error −0.205% / +0.058% / +0.002% / +0.017%, width error +1.45% / +5.53% / +7.98% / −0.95%. Feed сравнен spot-to-spot, поэтому futures basis здесь исключён. Defaults не меняются по одной дате.
- Гайд автора подтверждает менеджмент Reversal: Safe/Risk используют dynamic partial на Apex mean, BE после partial и dynamic full на противоположной Apex zone; Risk сокращает add/stop. Standard фиксирует entry/add/stop/take и не двигает уровни. Эти правила относятся к trade plan/position manager и не раскрывают signal formula; detector остаётся отдельной задачей.
