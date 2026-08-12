# Look-ahead аудит POI/stackShare (Zonda Reversal) — 2026-08-12

Заметка-память по разбору утечек будущего. Повод: подозрительно хорошие цифры
POI-фильтров в `docs/ARROW_FILTERS_SPEC.md` (ONDO 30m +5.20R, ETH 30m +0.86R),
появившиеся уже ПОСЛЕ замороженного вердикта NO-GO (`docs/HANDOFF.md`).

## TL;DR
- Ядро сигнала (Apex/сигнал/реплей) — **причинно чистое**, утечки нет.
- Утечка была в **POI-слое** и в её потребителях, где не-причинную UI-метрику
  `stackShare` использовали как торговый/бэктест-фильтр и как ML-фичу.
- Заявленный «прирост от stack size» — **артефакт**. При причинной нормировке
  исчезает (ONDO 30m → +3.30R = уровень обычного POI-касания; ETH 30m → ≈−0.10R).

---

## Проверено и признано ПРИЧИННЫМ (утечки нет)
- **Apex ALMA** (`src/core/signals/ApexEngine.ts`): окно строго трейлинговое
  `values[i-(n-1)..i]`, `offset` смещает веса только внутри прошлого.
- **ATR200** (`ArrowSignalEngine.arrowAtr200`) — RMA по прошлым барам.
- **relativeVolume** — среднее по `index-period..index-1`.
- **Вход** = `open` следующего бара (`signalIndex+1`).
- **Реплей** (`ArrowTradeReplay`) консервативен: внутри бара порядок
  `add → stop → partial → full`; неоднозначность «стоп/тейк в одном баре» = стоп.
  Moving-таргеты берут `bands[index]` того же бара; Partial требует реального
  касания фитилём. Оптимистичного сдвига нет.
- **POI-тайминги**: `knownAt`, `geometryKnownAt`, `spentAt`, fractal `sweptAt` —
  используются причинно (только для исключения уже-снятого/будущего).

---

## Утечка #1 — `stackShare` нормирован на КОНЕЦ истории (ИСПРАВЛЕНО)
**Где:** `LiquidityPoiCalibration.ts → consolidate()`:
```
for (const x of fresh) maxStack[dir] = Math.max(maxStack[dir], stackTotal(x))
... stackShare = stackNotional / maxStack[dir]
```
`fresh` = зоны, валидные на КОНЕЦ ряда; `maxStack` — сильнейший стек за весь ряд
(включая будущее). Комментарий движка сам называет это «дисплей-метрикой … на
конец истории … для UI».

**Как проявилось:** `scratch/auditStackSize.ts` использовал
`zone.stackShare < minStack` как фильтр сигнала → знаменатель из будущего.

**Доказательство:** `scratch/auditStackSizeCausal.ts` печатает leaky vs causal.
Причинная нормировка (знаменатель = сильнейший стек, известный и живой на
`signalAt`) убирает прирост:
- ONDO 30m: leaky ≥20% +5.16R → causal +3.30R (= ≥0%, порог не добавляет);
- ETH 30m: leaky ≥30% +0.88R → causal −0.10R;
- ONDO 2h: порог только ухудшает (+2.00R → +1.27R).

**Что сделано:**
- `scratch/auditStackSize.ts` — знаменатель пересчитывается причинно на `signalAt`.
- `src/core/analysis/ZondaEdgeFeatures.ts` — «causal-snapshot» отдавал не-причинный
  `stackShare` как ML-фичу (тихая утечка в любую модель/ранкер). Теперь считается
  причинно; версия → `zonda-edge-features-0.2-causal-stackshare`.
- `src/core/confirmation/LiquidityPoiCalibration.ts` — над полем `stackShare`
  добавлено ⚠️-предупреждение (не-причинно, только UI). Логика/калибровка НЕ тронуты.
- `docs/ARROW_FILTERS_SPEC.md` — ложный вывод отозван (⛔).

---

## Утечка #2 — `pool.notional` за всю жизнь пула (НЕ ИСПРАВЛЕНО, задокументировано)
**Где:** `LiquidityHeatmapEngine` считает `notional` пула суммой за весь срок его
жизни (`startIndex..lastContributionIndex`). В `detectLiquidityPoi` на баре `t` в
`freshPools` попадают пулы с `startAt < t`, но их `notional` берётся ПОЛНЫЙ —
включая объём, пришедший после `t`. Значит ранжирование значимости полок
(`shelfTopN`, `shelfMinShare`) и решение «рождать ли зону» на баре `t` частично
опираются на будущий объём.

**Масштаб:** мягче #1. Геометрия краёв зоны (`bandLow/bandHigh`) причинна;
загрязнён отбор/тайминг рождения зон. Числитель `stackNotional` тоже несёт #2.

**Почему пока не чиним:** это правка в калиброванном ядре POI (285 тестов,
визуальная калибровка зон). Делать отдельно, осознанно, с прогоном тестов и QA.
Возможный подход: пулу нужен notional-as-of-t (частичная сумма до бара `t`),
а не единый скаляр за всю жизнь.

---

## Визуализатор — НЕ затронут утечкой
- `tools/visualizer/server.ts`: статистика сделок использует `evaluateFilterMode`
  (`off/slope/reversal/contraction/exhaustion/liquidity/combo`). **`stackShare` там
  не используется** — `liquidity/combo` проверяют только POI-touch + relativeVolume
  (причинные). Торговые netR/WR в визуализаторе чистые.
- `stackShare` в `public/panels/zones.mjs` — только косметика: визуальный фильтр
  `poiMinStack`, прозрачность, полоска «Сила стека». На PnL/статистику не влияет.
- Оговорка для человека: не делать глазами вывод «зоны ≥20% торгуются лучше» —
  это та же ловушка, просто визуальная.

---

## Методологические флаги (независимо от утечки)
- Порог выбирался ПОСТ-фактум как лучший из {0,10,20,30%} — selection bias, нет
  OOS-сплита.
- «Плюс» концентрируется в 1–2 ячейках (ONDO/ETH 30m); BTC/остальное в минусе —
  агрегат отрицательный (совпадает с `HANDOFF §6`).
- Аудит гоняет только `safe`, `maxHoldingBars:1000` (frozen = 2000) и дефолтный
  сигнал-конфиг (`minimumRelativeVolume=0.0`) — несопоставимо с frozen baseline.

## Что реально уцелело
Причинный POI-touch (`off → ≥0%`) снижает просадку (ONDO 30m −8.34→+3.30,
BTC 30m −7.48→+0.22), но НЕ создаёт устойчивого положительного ожидания. Это
risk-filter, а не edge.

## Артефакты
- `scratch/auditStackSizeCausal.ts` — leaky vs causal сравнение (доказательство).
- `scratch/auditStackSize.ts` — исправлен на причинный знаменатель.
