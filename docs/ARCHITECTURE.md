# ARCHITECTURE — движок и структура проекта

> **Что это:** карта платформы — пайплайн данных, структура папок, реестр модулей
> (что реализовано и по каким правилам). **Как часто меняется:** редко — при добавлении
> нового модуля или переносе файлов. **Что можно менять:** дополнять реестр новыми
> модулями; не переписывать описания живых модулей без задачи (см. `AGENTS.md` §2).
>
> Глубокая логика индикаторов/сигналов — в `docs/INDICATOR.md`. Правила стратегий —
> в `docs/strategies/`. Здесь — только «что есть и как связано».

---

## 1. Два слоя проекта

1. **Базовый SMC-слой** (`Pivot → Swing → Structure → MarketStructure → Legs →
   BOS/CHoCH → Fib`). Исторический фундамент, описан ещё в легаси-спеке. **Живой, но
   заморожен** — активно не разрабатывается.
2. **Индикаторный/сигнальный слой** (`Apex → ArrowSignal → ArrowTradeReplay`) +
   **ликвидность/POI** + **research-обвязка**. **Активная линия** (Zonda Reversal + Apex).

Разделение «посчитать» (в `core/`) vs «показать» (точка входа/визуализатор) — сознательное
и не пересматривается: чистые функции `core/` переиспользуют бэктест, визуализатор и раннеры.

---

## 2. Пайплайн данных (базовый SMC-слой)

```
Candle[] (Binance, ccxt)
   │
   ▼ PivotDetector      → Pivot[]            (строгий экстремум ±window, window=2)
   ▼ SwingEngine        → Swing[]            (схлопывание соседних пивотов одного типа)
   ▼ StructureEngine    → StructurePoint[]   (метки HH/HL/LH/LL относительно прошлой точки того же типа)
   │
   ├─ MarketStructureEngine → protected-уровни, тренд (two-candle confirmation, гистерезис)
   ├─ StructuralLegEngine   → Leg[] между HH/LL (молчит внутри тренда)
   └─ SwingLegEngine        → Leg[] между каждой парой соседних точек
                                   │
                                   ▼ LegContextEngine (prev/next/isLast, вложенность)

Candle[] → ATREngine → ATRPoint[] → LegStrengthEngine (strength = leg.range / средний ATR)

StructurePoint[] + Candle[]
   ▼ BosChochEngine     → StructureEvent[]   (BOS/CHoCH)
   ▼ FibGridEngine      → FibGrid[]          (сетки по событиям, якоря local/global)
   ▼ FibLifecycleEngine → FibSetupOutcome[]  (симуляция сценариев входа)
```

Оркестрация — чистая функция `core/analysis/runAnalysis.ts` (`runAnalysis(candles):
AnalysisSnapshot`, без `console.log`). `src/index.ts` — только I/O: тянет свечи через
`BinanceService`, зовёт `runAnalysis`, печатает результат.

`AnalysisSnapshot` (`models/analysis/`) — единая структура одного прогона. Новые модули
добавляют поля; старые не переименовываются, чтобы не ломать потребителей.

> **⚠ При переносе файла — сразу проверять все импорты и гонять `npx tsc --noEmit` по
> всему проекту.** Устаревшие пути импорта после переезда — реальный источник багов в истории.

---

## 3. Структура папок

```
src/
  models/                — только описание данных (без логики)
    analysis/  events/  fib/  indicators/  legs/  price/  structure/
  core/                  — вся расчётная логика
    analysis/            — производные метрики, реплеи, фильтры, оркестрация (runAnalysis)
    builders/            — построение структуры из сырых свечей
    confirmation/        — POI-подтверждение (simplified / refined / liquidity)
    events/              — BOS/CHoCH
    fib/                 — Fibonacci-движок и издержки
    legs/                — Leg / LegContext
    liquidity/           — карта ликвидности (heatmap)
    signals/             — Apex, Arrow-сигналы/реплей, Reversal-research
  services/              — BinanceService (ccxt)
  strategy/              — battleConfig (боевые пресеты)
  config.ts  index.ts    — конфиг и точка входа (I/O)
tools/
  visualizer/            — веб-визуализатор (см. docs/DESIGN-SYSTEM.md)
  forward/               — paper-forward раннер (вывод в tmp/forward/, gitignored)
  shared/                — candleFetcher и общие утилиты
  batch/                 — батч-раннер статистики
scripts/                 — save-fixture (генератор фикстур), auditReversalBenchmark (⚠ сломан, чинить)
ci/research/             — исследовательские раннеры (воспроизводят ci-results/)
tests/                   — node:test, офлайн-фикстуры в tests/fixtures/
```

---

## 4. Реестр модулей

### 4.1 Базовый SMC-слой (`core/builders`, `core/legs`, `core/events`, `core/fib`) — заморожен

| Модуль | Роль / правило |
|---|---|
| `PivotDetector` | Pivot High/Low: строгий экстремум против `window` свечей слева и справа (`window=2`). Без ZigZag/ATR/процентов. |
| `SwingEngine` | Схлопывает подряд идущие пивоты одного типа в один экстремум. Результат строго чередуется high/low. |
| `StructureEngine` | Метит каждую точку HH/HL/LH/LL относительно **прошлой точки того же типа**. Первая точка типа — `UNKNOWN`. ⚠ не путать с BOS/CHoCH. |
| `MarketStructureEngine` | Инкрементальный `update(point, candles)`. **Two-candle confirmation:** слом уровня = два последовательных закрытия тела (`close`) за уровнем; одно = кандидат (`pending`); закрытие обратно = защита. Прокол фитилём — не пробой. Тренд — из последовательности меток (bullish=HH+HL, bearish=LH+LL, иначе range) с гистерезисом. |
| `StructuralLegEngine` | `Leg[]` между HH/LL; внутри тренда молчит. |
| `SwingLegEngine` | `Leg[]` между каждой соседней парой точек. |
| `buildLeg` / `LegContextEngine` | Общая сборка ноги + контекст (prev/next/isLast, вложенность). |
| `ATREngine` / `LegStrengthEngine` | ATR по свечам; сила ноги = `range / средний ATR` за время ноги. |
| `BosChochEngine` (`core/events`) | Детектор BOS/CHoCH → `StructureEvent[]`. |
| `FibGridEngine` / `FibLifecycleEngine` / `MultiTfEntryEngine` / `fibCosts` (`core/fib`) | Fib-сетки по событиям, симуляция сценариев входа, мультитаймфрейм-вход, издержки в EV. Справка — `docs/strategies/fibonacci.md`. |

### 4.2 Индикаторный/сигнальный слой (`core/signals`) — активный

| Модуль | Роль |
|---|---|
| `ApexEngine` | ALMA-конверт (Mean/Inner/Outer полосы). Причинно чистый (трейлинговое окно). Детали — `docs/INDICATOR.md`. |
| `ArrowSignalEngine` | Триггер Zonda Reversal (OWN2): relVol, дистанция от Mean, penetration Inner, направленная свеча. Считает `arrowAtr200`, `relativeVolume`. |
| `ArrowTradeReplay` | Реплей сделки: режимы Safe/Risk/Standard, moving/статичные цели, порядок внутри бара `add→stop→partial→full` (неоднозначность = стоп). |
| `IndependentReversalG2*`, `Reversal*Research`, `IndependentReversalProtocol` | Исследовательская обвязка вокруг сигнала (G2-детектор состояния, эпизоды, cooldown, recovery, state-machine). Ветки research, не боевой рантайм. |

### 4.3 Ликвидность / POI (`core/liquidity`, `core/confirmation`) — заморожен

| Модуль | Роль |
|---|---|
| `LiquidityHeatmapEngine` | Профиль плотности лимитных ордеров (notional depth) по бинам цены. |
| `LiquidityPoiCalibration` | Объединяет пулы в зоны `[near, far]`, lifecycle (`knownAt`/`spent`). ⚠ поле `stackShare` — UI-only, не причинно (см. NEGATIVE-KNOWLEDGE, утечка #1). |
| `PoiConfirmationEngine` / `RefinedPoiEngine` / `SimplifiedConfirmationEngine` | Подтверждение входа от POI (уточнённое / упрощённое). Справка — `docs/strategies/poi-confirmation.md`. |

### 4.4 Анализ / research-хелперы (`core/analysis`)

`runAnalysis` (оркестратор), `reversalTradeReplay`, `takeLadders` (лестницы тейков),
`entryModels`, `setupFilters`, `dedupFilter`, `regimeFilter`/`regimeMetrics`,
`htfContext`, `CausalLiquidityPoolState` (причинное состояние пула), `ZondaEdgeFeatures`
(⚠ содержала утечку #1, исправлено), `IndependentReversalG2Metrics`,
`reversalResearchMetrics`, `portfolioBacktest`.

### 4.5 Данные и конфиг
`services/BinanceService` (ccxt), `strategy/battleConfig` (боевые пресеты), `config.ts`.

---

## 5. Известные хвосты (актуально на 2026-08-12)
- `scripts/auditReversalBenchmark.ts` — сломан (регистр импорта `ArrowTradeReplay` + поле
  `meanNetR`), чинить.
- Утечка #2 (`pool.notional` за всю жизнь пула) — не исправлена, см. NEGATIVE-KNOWLEDGE.
- Консолидация папок (`scratch→ci/research`, часть `temp→ci-results/data`) — в процессе уборки.
