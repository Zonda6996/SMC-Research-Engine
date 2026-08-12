# INDICATOR — логика индикаторов и сигналов от А до Я

> **Что это:** справочник по логике Apex и Zonda Reversal — чтобы не объяснять заново
> «почему не переводим в безубыток» или «как работают динамические тейки». Всё ниже
> сверено с кодом (`src/core/signals/`). **Как часто меняется:** редко.
> **Что можно менять:** только вслед за реальной правкой движка; числовые константы —
> калибровочные, не трогать без cross-symbol проверки (см. `AGENTS.md` §2).
>
> Разобранные ранее неоднозначности (пороги, безубыток) — в §8.
> Экономика/вердикты — в `docs/strategies/zonda-reversal.md`. Причинность — в
> `docs/NEGATIVE-KNOWLEDGE.md`.

---

## 1. Apex — полосы экстремумов (ALMA-конверт)

Файл: `ApexEngine.ts`. Версия: `apex-1.2-cross-oos-sigma-4`.
Восстановлен по 14 историческим якорям (Binance Spot BTC 5m/15m/4h, ETH 1h).

**Средняя:** `mean = ALMA(source, lookback=200, offset=0.85, sigma=6)`, `source = hlc3` (канон).

**Относительный разброс:** `s = ALMA(trueRange/close, lookback=122, offset=0.625, sigma=4)`
— безразмерный (0.001 = 0.1% цены).

**Полосы** (экспоненциальные, симметрично от средней):
```
redLo   = mean * exp(+kInner * s)   // ближняя верхняя (inner)
redHi   = mean * exp(+kOuter * s)   // дальняя верхняя (outer)
greenHi = mean * exp(-kInner * s)   // ближняя нижняя (inner)
greenLo = mean * exp(-kOuter * s)   // дальняя нижняя (outer)
kInner = 5.6, kOuter = 9.6
```

**Причинность:** ALMA-окно строго трейлинговое (`values[i-(n-1)..i]`), бар `i` использует
только свечи `<= i`. Утечки будущего нет.

> Константы `APEX_PARAMS` зафиксированы измерениями. `signalMode='outer'` — наблюдаемый
> канон (внешний край взводит сигнал); `'inner'` — только диагностический режим.

---

## 2. Zonda Reversal — два детектора сигнала

В коде есть **два** родственных детектора. Не путать.

### 2.1 `detectReversals` (ApexEngine) — «Reversal v1», минимальная логика
Версия `reversal-1.0-directional-candle`. Логика, которую подтверждают скрины вендора:
1. **внешний** край Apex взводит сторону (long — `greenLo`, short — `redHi`);
2. BUY фиксируется только **бычьей** свечой (`close > open`), SELL — только **медвежьей**;
3. после сигнала сторона перевзводится только возвратом цены **к средней**;
4. касание может произойти на предыдущей свече (метка появляется внутри бара).
Никаких доп. фильтров здесь не выдумано.

### 2.2 `detectArrowSignalsFromBands` (ArrowSignalEngine) — OWN2-триггер (АКТИВНЫЙ)
Версия `signal-arrows-1.0-own2-extension`. Это триггер боевого/research-рантайма.
Для каждого бара и стороны (`long`/`short`) сигнал принимается, если проходит **все** гейты:

| Гейт | Условие (из кода) |
|---|---|
| relative volume | `rv >= minimumRelativeVolume`. Движок `ArrowSignalEngine` намеренно state-free → дефолт **0.0**; **каноничный OWN2-порог = 1.4**, задаётся вызывающим: `runOwn2ExtensionTrigger.ts` (`VOL_MIN = 1.4`) и `IndependentReversalG2Protocol.extensionRelativeVolumeMin = 1.4` |
| distance from mean | `|close-mean|/mean*100 >= minDistancePct`, где `minDistancePct = min(3, max(0.15, s*100*0.8))`. **Адаптивный; исторически был фиксированный порог 3%**, теперь `3` — это потолок (см. §8.2) |
| candle direction | long: `close>open`; short: `close<open` |
| geometry | половина ширины inner `> 0` |
| side of mean | long: `close < mean`; short: `close > mean` |
| penetration inner | `penetrationInner >= minimumPenetrationInner` (дефолт **-0.35**) |

где `penetrationInner` = насколько close зашёл за inner относительно полуширины
(`half = |mean - inner|`). `relativeVolume` = `volume[i] / среднее(volume, i-period..i-1)`,
`period=20`. `atr200` — RMA true range (`arrowAtr200`), причинный.

**Вход = открытие следующего бара** (`signalIndex + 1`).

---

## 3. Геометрия сделки и реплей (`ArrowTradeReplay`)

Версия `signal-arrows-replay-1.2-geo4-moving-close`. Единица шага:
```
step = 5.5 * atr200 / stepDivisor
entry     = open следующего бара
add       = entry ∓ step            (усреднение, 1 доп. юнит; long: entry - step)
stop      = entry ∓ stopSteps*step
staticFull= entry ± 2*step          (цель Standard)
oneR      = |averageFullEntry - stop| * 2,  averageFullEntry = (entry + add)/2
```

**Порядок внутри одного бара (консервативный):** `add → stop → partial → full`.
Неоднозначность «стоп и цель в одном баре» = **стоп**. `add`/`stop` срабатывают по фитилю
(`adverseWick`), финальный full по dynamic — по `close` за целью.

**Occupancy:** одна сделка на режим за раз; после выхода — тишина `postExitBars = 3` бара.

---

## 4. Режимы Safe / Risk / Standard

| Режим | stepDivisor | stopSteps | management | partialFraction |
|---|---:|---:|---|---:|
| Safe | 1 | 2 | dynamic-partial | 0.25 |
| Standard | 1.17 | 1.75 | static-full | 0 |
| Risk | 1.43 | 2 | dynamic-partial | 0.25 |

`maxHoldingBars = 2000`, `oneWayCostBps = 7` для всех. Больший `stepDivisor` → меньше
`step` → плотнее сетка (Risk агрессивнее заходит).

---

## 5. Динамические тейки

**Standard (static-full):** единственная фиксированная цель `staticFull = entry ± 2*step`.
Partial нет. Full-TP по касанию фитилём.

**Safe / Risk (dynamic-partial) — цели ДВИЖУТСЯ каждый бар от полос Apex:**
- **Partial** (доля `partialFraction = 0.25`): снимается на **средней** (`band.mean`),
  но только когда средняя уже «в прибыли» относительно `averageEntry` и фитиль её коснулся.
  Это и есть «moving Mean partial».
- **Full**: цель — **противоположный inner** (`long → band.redLo`, `short → band.greenHi`),
  пересчитывается на каждом баре. Full-TP когда `close` заходит за эту движущуюся цель.

То есть в Safe/Risk и частичная, и полная цели — не фиксированные уровни, а функции
текущих полос Apex.

---

## 6. Почему НЕ переводим стоп в безубыток

**Стоп фиксирован на весь трейд** — `stop` считается один раз при входе и в реплее
никогда не трейлится (в т.ч. не двигается к безубытку после Partial). После частичной
фиксации на средней остаток позиции по-прежнему защищён **исходным** стопом.

> В типах есть `outcome: 'partial-be'` и событие `'breakeven'`, но в текущем
> `replayArrowTrade` они **не присваиваются** — это, вероятно, остатки старой логики.
> Фактические исходы: `full-tp`, `partial-stop` (был partial, затем стоп), `stop`,
> `timeout`, `open`. **На текущий момент (подтверждено автором) стоп в БУ не переносится
> и не трейлится** — если менять, это осознанное решение, а не «доделка».

---

## 7. Причинность (кратко)
Apex ALMA, `arrowAtr200` (RMA), `relativeVolume` (окно `i-period..i-1`), вход = next open,
реплей (порядок add→stop→partial→full) — **причинно чистые**. Известная не-причинная
метрика `stackShare` в POI-слое — UI-only, как фильтр не использовать. Подробности и
утечка #2 — в `docs/NEGATIVE-KNOWLEDGE.md`.

---

## 8. Разобранные неоднозначности (зафиксировано 2026-08-12)

1. **Порог relative volume — РАЗОБРАНО ПО КОДУ.** Движок `ArrowSignalEngine` намеренно
   state-free (дефолт `minimumRelativeVolume = 0.0`); каноничный OWN2-порог **1.4** задаётся
   вызывающим — `ci/research/runOwn2ExtensionTrigger.ts` (`VOL_MIN = 1.4`) и
   `IndependentReversalG2Protocol.extensionRelativeVolumeMin = 1.4`. Автор происхождение
   значения не помнит — фиксируем как есть по коду.
2. **Distance-from-mean — оставлен адаптивным** (решение автора). Формула
   `min(3, max(0.15, s*100*0.8))`. Пометка для истории: **раньше был фиксированный порог 3%**,
   сейчас `3` работает как верхний потолок.
3. **Два детектора — подтверждено.** Активная линия = OWN2 (`detectArrowSignalsFromBands`);
   `detectReversals` — исторический/диагностический.
4. **Безубыток — подтверждено.** На текущий момент стоп в БУ не переносится и не трейлится;
   `partial-be`/`breakeven` — вероятно остатки старой логики.
