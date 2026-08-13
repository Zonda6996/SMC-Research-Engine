# NEGATIVE-KNOWLEDGE — отвергнутое и утечки будущего

> **Что это:** единое место для всего, что проверено и **отвергнуто**, и для известных
> look-ahead утечек. Цель — не переоткрывать мёртвое и не наступать на те же грабли.
> **Как часто меняется:** по мере новых находок (только добавлять).
> **Правило:** отрицательный результат — это знание, его сохраняем, а не удаляем.

---

## 1. Look-ahead утечки

### Утечка #1 — `stackShare` нормирован на конец истории (ИСПРАВЛЕНО)
**Где:** `LiquidityPoiCalibration.consolidate()` — `stackShare = stackNotional / maxStack[dir]`,
где `maxStack` — сильнейший стек за **весь** ряд (включая будущее). Комментарий движка сам
называл это «дисплей-метрикой на конец истории для UI».
**Как проявилось:** `scratch/auditStackSize.ts` использовал `stackShare < minStack` как
фильтр сигнала → знаменатель из будущего.
**Артефакт:** заявленный «прирост от stack size» исчезает при причинной нормировке:
- ONDO 30m: leaky ≥20% +5.16R → causal +3.30R (= уровень обычного POI-касания);
- ETH 30m: leaky ≥30% +0.88R → causal −0.10R;
- ONDO 2h: порог только ухудшает (+2.00R → +1.27R).
**Исправлено:** `auditStackSize.ts` (причинный знаменатель на `signalAt`);
`ZondaEdgeFeatures.ts` → `zonda-edge-features-0.2-causal-stackshare` (отдавал не-причинный
`stackShare` как ML-фичу); над полем в `LiquidityPoiCalibration.ts` — ⚠ пометка UI-only;
ложный вывод в `ARROW_FILTERS_SPEC.md` отозван.

### Утечка #2 — `pool.notional` за всю жизнь пула (ИСПРАВЛЕНО, 2026-08-13)
**Где было:** `LiquidityHeatmapEngine` считал `notional` пула суммой за весь срок жизни
(`startIndex..lastContributionIndex`). В `detectLiquidityPoi` на баре `t` в `freshPools`
попадали пулы с `startAt < t`, но `notional` брался **полный** — включая объём после `t`.
Значит ранжирование полок (`shelfTopN`, `shelfMinShare`), решение «рождать зону» на баре
`t`, новизна, родство стеков и тай-брейк nearest частично опирались на будущий объём.
**Масштаб:** мягче #1 — геометрия краёв (`bandLow/bandHigh`) причинна; загрязнён был
**тайминг рождения** зон (и отбор в тонких периодах).
**Как исправлено (вариант B, `notional-as-of-t`):** движок теперь копит per-pool причинное
расписание вкладов и отдаёт `notionalSchedule` (prefix-суммы по времени свечи) + хелпер
`notionalAsOf(pool, t)`. `detectLiquidityPoi` на каждом баре клонирует свежие пулы с массой
`notionalAsOf(t)`, и всё дальше (`sideTotal`, профиль плотности/полки, топ-N, `shelfMinShare`,
новизна, снимок `shelfPools` → `stackNotional`, знаменатель stack-consumed) считается по массе,
известной на `t`. Геометрия краёв и тайминги (`startAt/sweptAt/lastContributionAt`) не тронуты.
Рукотворные пулы без расписания откатываются к полному `notional` (обратная совместимость тестов).
**Замер эффекта (leaky=полный notional vs causal=as-of-t, `tmp/a2LeakMeasure.ts`):** набор зон и
геометрия НЕ меняются (ONDO 15m 20k: born 819=819, active 4=4; BTC 4h 6k: born 789=789, active 5=5),
но **сдвигается время рождения** зон — ONDO 15m: 815/819 зон; BTC 4h: 47/789 (масштаб зависит от
ТФ/длины истории). Именно `knownAt` — вход гейта `liquidity/combo` (`zone.knownAt ≤ signal.signalAt`),
поэтому теперь эти фильтры причинны.
**Осознанные решения (по варианту B):** (1) `shelfPools` снимок = масса as-of-рождения → знаменатель
stack-consumed меряется от массы, известной на рождении зоны; (2) `stackShare` остаётся UI-only
(не-каузальный по определению, знаменатель на конец истории — см. пометку в коде). `notionalSchedule`
срезается из payload визуализатора (нужен только серверу).

### Визуализатор — утечкой НЕ затронут
`tools/visualizer/server.ts` считает торговую статистику через `evaluateFilterMode`
(`off/slope/reversal/contraction/exhaustion/liquidity/combo`) — `stackShare` там не
используется, netR/WR чистые. `stackShare` в `public/panels/zones.mjs` — только косметика.
⚠ Не делать **глазами** вывод «зоны ≥20% торгуются лучше» — та же ловушка, визуальная.

---

## 2. Reversal V1–V7 (не переоткрывать без нового observable information set)
Per-bar directional/Inner/RSI/distance baselines имели высокую полноту только ценой
precision порядка единиц процента. По sealed/holdout:
- **V1** bounded state machine — провалил holdout;
- **V2** long-memory episode: sealed F1 ≈ 12.77% → 3.70%;
- **V3** recovery grammar: 16.39% → 5.48%;
- **V4** global cooldown (лучший из отвергнутых): 21.92% → 7.69%;
- **V5** OHLC fear/greed и **V6** volume-aware score — не пережили sealed/OOS;
- **V7/V7′** episode-age + recovery/extremum/spacing: лучший mean validation F1 лишь 3.03%;
  финальный sealed намеренно не открывался.
- Ни один из 370 canonical labels не имел current/previous Outer touch.
- Отвергнуты: centered/backplotted pivots, Gemini EMA100/ATR100, duplicate non-overlap,
  повторный свободный ATR-grid.

**Полезная граница (V7):** episode grammar находит **регионы**, но не exact emission bar.
Hazard-пики не совпадают в барах между TF, но примерно сходятся во wall-clock.

## 3. Exact-bar information limit
Семь causal single-TF семейств на OHLC+bands воспроизводили частоту/области, но **не точный
бар**. Вероятно, exact bar зависит от скрытого internal series / HTF-stateful / intrabar
информации, которых нет в текущем экспорте. Новый перебор грамматик на том же information
set имеет низкую ожидаемую ценность — нужен различающий экспорт либо честный вердикт
«неидентифицируемо».

## 4. FROZEN / IMP2 — единственный исторически прибыльный кандидат (с оговорками)
```text
OWN2 на 1h/2h + 4h pool rank < 2/3 + pool swept <= 48h + entry в ±25% ширины полосы
+ STATIC2: TP 2×step, stop 2×step, без partial/add
```
≈ `+0.18R train / +0.26R holdout`, но всего **26 сделок** на 16 монетах. Голый сигнал ≈ 0;
«просто у пула» ≈ −0.08R; активный фактор — свежий sweep нетопового пула. IMP1: 10 вариантов
exit-management двигали результат лишь ~0.04R (менеджмент — не сильный рычаг).
Менять параметры FROZEN-1 после открытия breadth **нельзя** — это новый FROZEN-2 и сожжённый holdout.

## 5. BREADTH1 frequency mismatch (QA реализации, не тюнинг)
IMP2 пропускал ~26/711 сигналов (~1 сделка/мес на корзину 28 монет), BREADTH1 — 2175 сделок
на 19 монетах за 2.5 года (~4/мес **на монету**). Расхождение ~2 порядка → вероятная
несовместимость реализаций. До доказательства одинаковой стратегии по trade-level JSON
статус FROZEN-1 = `INCOMPLETE`.

## 6. Отвергнутое из истории SPEC (POI/подтверждение/индикатор)
- **Динамические цели** приватного индикатора в нашей системе — ОТКЛОНЕНЫ.
- **Инвертированный GGI-фильтр:** сигнал индикатора помечает **худшие** входы — фактор
  сильный и отрицательный (использовать как вето на заход в зону, не как вход).
- Гипотеза «**зон меньше → вин рейт выше**» — ОТВЕРГНУТА.
- **Кластеризация полок по ядрам** — отвергнута.
- **Потолок цели в % цены** — отвергнут.
- Правила стопа: важен **размер**, не способ.

## 7. Общие методологические грабли
- Не выбирать порог/актив/TF/сторону **пост-фактум** (selection bias без OOS).
- «Плюс» в 1–2 ячейках при отрицательном агрегате — не edge.
- Vendor parity ≠ profitability. Высокий WR ≠ положительный expectancy (Partial может быть ≈ BE).
- Один импульс на N алертов ≈ одно наблюдение.
- Причинный POI-touch — это **risk-filter** (снижает просадку), а не edge.
