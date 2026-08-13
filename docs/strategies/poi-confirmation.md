# Стратегия: POI / подтверждение входа — ЗАМОРОЖЕНА

> **Что это:** краткая справка по слою зон ликвидности (POI) и подтверждению входа.
> Живая, но сейчас не разрабатывается (приоритет — Zonda Reversal). Source of truth —
> код `src/core/liquidity/` и `src/core/confirmation/`. **Как часто меняется:** редко.

---

## Слой зон (liquidity POI)
- `LiquidityHeatmapEngine` — профиль плотности лимитных ордеров (notional depth) по бинам цены.
- `LiquidityPoiCalibration` — объединяет близкие пулы в динамические зоны `[near, far]`,
  ведёт lifecycle (`knownAt` / `geometryKnownAt` / `spentAt`). Живые зоны: `knownAt <= signalAt`
  и `lifecycleState !== 'spent'`.
- ⚠ Поле `stackShare` — **UI-only, не причинно** (нормировано на конец истории). Как
  торговый/бэктест-фильтр или ML-фичу не использовать (утечка #1, см. `docs/NEGATIVE-KNOWLEDGE.md`).

### POI как фильтр сигнала (гео-касание)
Сигнал валиден, если фитиль свечи коснулся живой зоны: long — `candle.low <= max(near,far)`,
short — `candle.high >= min(near,far)`. Отсекает часть «сигналов в воздухе», но слепо к
реакции цены (закрытие внутри vs агрессивный отскок).

## Подтверждение входа
- `PoiConfirmationEngine` / `RefinedPoiEngine` — уточнённое подтверждение (структурные
  правила захода/слабости, невыметенный якорь, проторговка, таймаут по бездействию — SPEC §16.x).
- `SimplifiedConfirmationEngine` — упрощённое подтверждение. По внутреннему тесту
  (2025-01→2026-07, не в отборе): ~3064 сделки, WR 73.4%, +0.124R, PF 1.46.

## Статус
Заморожено. В активной линии Zonda Reversal POI/HTF/Fib проходят как **H3 (BLOCKED)** —
нет валидированного causal-adapter к текущему OWN2-runtime; старые результаты переносить нельзя.
Детали правил v1.x/v2.x — в архиве SPEC (`docs/archive/`).
