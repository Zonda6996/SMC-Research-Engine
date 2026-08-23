# NEGATIVE-KNOWLEDGE — отвергнутое и утечки будущего

> **Что это:** единое место для всего, что проверено и **отвергнуто**, и для известных
> look-ahead утечек. Цель — не переоткрывать мёртвое и не наступать на те же грабли.
> **Как часто меняется:** по мере новых находок (только добавлять).
> **Правило:** отрицательный результат — это знание, его сохраняем, а не удаляем.

---

## D6 cascade reversion — первый GO проекта + важный разворот funding-sign (2026-08-22)

**GO (extension, symbol-fresh):** событие `ΔOI_8h≤−15% И ΔP_8h≤−3%` → LONG next-open (min-gap 8),
фикс-горизонт 24ч. На ПОЛНОЙ истории 11 никогда не открывавшихся перпов (prereg до скачивания их
метрик): N=194, **mean +1.90%/сделку net** (5bps taker + фактический funding), median +1.92%,
PF 1.885, WR 60.8%, UTC-day cluster CI95 [+0.15%; +3.63%] — нижняя граница выше нуля; события во
всех 11 символах (breadth 11/11). ARM CANON (стоп 2×step+добор+тейк канона) на тех же событиях:
+0.045R, CI через 0 ⇒ менеджмент канона это движение УБИВАЕТ — не добавлять тесный стоп/тейк к
каскадному входу (согласуется с RE15/16: откатные движения любят широкий выход). Ранее: reveal №1
на OOS 14 символов дал INCONCLUSIVE (N=54 — правило редкое ~0.3 события/1000 баров из-за gap-правила).
Оговорки: maxDD — heat перекрывающихся позиций; одна независимая репликация; перед деньгами —
paper-forward/третья вселенная. Артефакты: `ci-results/d6-cascade-*`.

**Funding-sign — НЕ универсален (разворот знака):** на каскадной long-популяции paired delta
**−1.64%/opportunity**, CI95 [−3.24%; −0.01] — вето «long после отрицательного funding» здесь
ВЫБРАСЫВАЕТ прибыльные сделки (retained-executed +1.07% против базовых +1.90%). Трижды
реплицированный положительный эффект фильтра подтверждён только внутри OWN2/Reversal-популяций;
переносить его на другие классы входов без отдельной проверки запрещено.

**D6-tp (2026-08-23) — тейки по R не улучшают; контроль НЕ реплицировался на третьей вселенной.**
Терминальный reveal (prereg заморожен до данных) на 12 новых symbol-fresh перпах, все листинги
2020–2024 (TLM/ONE/CTSI/PENDLE/ALICE/SEI/IOTX/JUP/STORJ/ZIL/CHZ/1000XEC — топ-80 ранга исчерпан
этими): 360 событий, по 359 сделок на руку. Руки co-primary: фулл-тейк +1R/+2R/+3R при структурном
стопе и таймауте 72ч. Все `KILL`: +0.55% [−0.72; +1.80], +0.64% [−0.69; +1.89], +0.42% [−0.94; +1.74].
Контроль C-H72 (= рука H72-stopStruct из d6-mgmt): **+0.01% [−1.41; +1.44]** при stop-rate 66.6% —
против +2.97% [+0.50; +5.46] на mgmt-вселенной. MFE-справка: до ≥1R доходит 43.5% сделок,
≥1.5R — 33.4%, ≥2R — 26.7%, ≥3R — 17.0%.
Уроки: (1) фиксированные тейки обрезают хвост, который платит за серию стопов, и ожидаемо не
добавляют — согласуется с CANON-рукой первого исследования; (2) **эдж не переносится на другую
популяцию автоматически**: простое объяснение «старые листинги» НЕ сходится (в mgmt-вселенной были
и старые ATOM/ALGO/DASH/GALA) — причина не-репликации неизвестна, вопрос популяции открыт.
Частички/безубыток — только будущая preregistration. Артефакты: `ci-results/d6-tp-*`,
`data/d6-tp/manifest.json`.

## OWN2-thinned big-corpus (2026-08-22) — ТЕРМИНАЛЬНЫЙ KILL: линия Reversal закрыта с адекватной мощностью

Конфирматорный тест последнего живого кандидата (thinning-рычаг RE24) на специально собранной
свежей вселенной: 25 никогда не исследовавшихся перпов USDT-M, ~1.08M баров 1h (до 6.6 лет на
символ), cutoff 2026-08-22. Протокол: preregistration + amendments 1–3 с SHA-256 до любых исходов;
рука = канонический safe без свободных параметров (стоп 2×step — ширина от ТФ/волатильности,
добор entry∓step ровно посередине entry↔стоп, частичка 25% у mean + тейк у противоположной
внутренней полосы), OWN2 relVol 1.4, spacing 180 баров, каждая стрелка = своя сделка.

**Результат:** N=3615 resolved; primary net@5bps+funding mean **−0.06367R/trade**, UTC-day cluster
bootstrap CI95 **[−0.09769; −0.02937]** — целиком ниже нуля; gross@0 −0.061R ⇒ минус НЕ от издержек;
breadth 3/25; reference без прореживания −0.073R × 16500 (консистентно).

**Что это закрывает:** вопрос мощности («вдруг RE24c просто мало N») — закрыт: большая выборка дала
ЗНАЧИМЫЙ минус, точечные плюсы RE24c были шумом. Вместе с B1/D/E/S/RE-линиями это исчерпывает все
ранее намеченные рычаги линии Reversal. Не переоткрывать: thinning/spacing, стоп-геометрию канона,
менеджмент-варианты, funding-sign как edge — без нового information set и новой preregistration.

**Единственный выживший факт:** funding-sign paired delta **+0.03851R/opportunity, CI95
[+0.01960; +0.05778]** — третий независимый реплицированный CI>0 (BTC/ETH/SOL → AVAX → 25 перпов).
Статус: durable risk-filter («разрешать long после отрицательного funding, short после
положительного» снижает потери), НЕ источник прибыли — retained-executed остаётся отрицательным
(−0.044R/trade). Применим поверх любой будущей руки этого класса.

Артефакты: `ci-results/own2-thin-bigcorpus-{preregistration.md,amendment-1.md,amendment-2.md,amendment-3.md,calibration.*,results.*}`,
`data/own2-thin-bigcorpus/manifest.json`. Нюанс: импорт калибровочного модуля reveal-раннером
перезапустил его main() — пересчёт детерминирован (значение то же), файл получил новый generatedAt;
на вердикт не влияет (Amendment №3 вывел калибровку из руки); добавлен direct-run гард.

## OWN2 + funding-sign BTC/ETH/SOL perpetual 1h (2026-08-20) — `INCONCLUSIVE DATA`, не edge

До outcomes заморожены канонический OWN2/Safe с явным `minimumRelativeVolume:1.4`, strict-prior funding-sign rule, 5 bps/side, actual direction-aware funding, общий 65/35 cutoff и UTC-day paired bootstrap. На protocol holdout baseline N=101, retained=56: оба N gate провалены. Filter улучшил paired результат (+0.12094R/opportunity, CI95 [0.00607; 0.23890], breadth 3/3), потому что vetoed counterfactual был особенно плохим (−12.21461R), но retained filtered рука всё равно отрицательна: −6.59726R, −0.11781R/trade, PF 0.68368. Поэтому это **не положительный edge** и не GO; frozen классификация `INCONCLUSIVE DATA` имеет приоритет из-за N<250/100.

**Не делать:** не ретюнить magnitude/z-score/age/side/symbol и не исключать проигравшие группы на раскрытом хвосте. Корпус честно отложен внутри нового запуска, но не гарантирован globally untouched из-за пересечения BTC/ETH/SOL и дат с прежними исследованиями. Артефакты: `ci-results/own2-funding-sign-btc-eth-sol-results.{md,json}`, `data/own2-funding-sign-btc-eth-sol/manifest.json`.

## Funding-only CONTRARIAN (2026-08-20) — frozen OOS `KILL`
Независимая линия без price-derived signal features: фактические Binance USD-M funding settlements, CONTRARIAN primary против paired CONTINUATION, strict-after-settlement execution, costs 0/5 bps, общий календарный 65/35 split. Общая история BTC/ETH/SOL: 2020-09-13 — 2026-07-31; OOS 2256 trades/symbol (6768 pooled), event gate пройден.

При 5 bps/side CONTRARIAN equal-symbol mean **−8.2786 bps/trade**, UTC-day joint cluster-bootstrap CI95 **[−14.1721; −2.5605]**, breadth **0/3**; paired CONTRARIAN−CONTINUATION CI пересекает ноль. Price-only +1.2488 bps и funding +0.4726 bps не покрывают 10 bps round-trip costs. Вердикт по frozen gates: **`KILL`**. Не ретюнить magnitude/side/symbol thresholds и не искать rescue-subgroups на раскрытом OOS. Артефакты: `ci-results/funding-only-preregistration.md`, `funding-only-results.{md,json}`, `data/funding-only/manifest.json`.

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

### RE4–RE7 (2026-08-18) — подтверждают лимит §3: чисто-OHLCV триггер стрелки НЕ восстановим
Таргет — самосогласованные CSV-shapes вендора (закрытые бары, `matchDirectionalEvents`, ±1 бар),
референс OWN2 (relVol 1.4). Fit/селекция — только на dev (btc-5m/15m), победитель отчитывается на
sealed(dev) и полном OOS. **Ни одна чисто-ценовая гипотеза не побила OWN2 на OOS:**
- **RE4** (порог глубины пробоя внутренней полосы) и **RE5** (экстремум волны + разворот): OOS recall ~10%
  против OWN2 ~26–31% (dev). Look-ahead-**потолок** RE5 лишь ~5% ⇒ shapes НЕ стоят на экстремуме крупной
  волны (вендор ставит несколько стрелок за заход). `ci-results/re4-*`, `re5-extreme-reversal-fit.*`.
- **RE6** (локальный свинг-пивот в зоне): causal OOS recall 17.5%, но look-ahead-потолок лишь ~16% ⇒ и
  локальная свинг-структура на OHLCV бар не определяет. `ci-results/re6-local-pivot-fit.*`.
- **RE7** (многокомпонентный Fear&Greed осциллятор, 6 причинных компонентов: RSI14 / стохастик-позиция /
  momentum ROC-z / volatility range-z / volume-z / позиция-в-зоне; grid **61442** конфига):
  на dev выглядел лучше OWN2 (validation F1 15.79% vs 11.21%; sealed F1 11.49% vs 6.35%), но на **полном OOS
  схлопнулся в паритет/ниже** — recall F&G **15.79%** vs OWN2 **20.55%**, F1 F&G **9.00%** vs OWN2 **9.01%**
  (±1 бар; exact ±0: F&G 3.10%/7.77% vs OWN2 5.14%/18.30%). **Победивший конфиг занулил
  momentum/volatility/volume** (веса mom=volrange=0, остались только osc+dist) ⇒ классический **overfit к dev**;
  «страх/жадность»-компоненты не несут сигнала сверх позиции-в-зоне. `ci-results/re7-fear-greed-csv-shapes.{md,json}`.
- **RE-recon** (`ci-results/re-recon-telegram-vs-shapes.*`): telegram-алерты и CSV-shapes — НЕ подмножество, а
  ДВЕ разные реализации сигнала того же порядка; совпадают лишь **~40–45%** по бару. ⇒ «потолок» соответствия
  любой обученной на CSV-shapes модели к живому сигналу ≈45% — часть «провала» есть сравнение разных корпусов.
- **Осознанный вывод:** exact-bar стрелки на чисто-OHLCV **не идентифицируем** (геометрия зоны при этом
  воспроизведена точь-в-точь — Apex = вендорская зона, medErr 0.05%, RE3). НЕ переоткрывать перебор грамматик на
  том же information set. Легитимные ветки — только различающий экспорт: не-OHLCV инфа (OI/funding/CVD/intrabar)
  либо контролируемый свежий alert для различения версии/repaint. Иначе — честный вердикт «неидентифицируемо» и возврат к вопросу edge (Трек D).

### RE19–RE21 (2026-08-19) — near-tick данные (1s/5s/10s + линии зоны вендора) НЕ вскрыли селектор стрелки
Автор прислал секундные CSV (ETH/BTC/BNB 1s/5s/10s/1m/5m) с РЕАЛЬНЫМИ линиями зоны вендора (cols 5-9: Mean/UpOuter/UpInner/LoInner/LoOuter) + shapes. Это лучший из возможных материалов (тик TradingView не отдаёт).
- **RE19** (`ci-results/re19-arrow-microstructure.*`): на баре стрелки фитиль касается ВНУТРЕННЕЙ полосы (f_wick≈0.6≈inner), а close её НЕ достигает (close≥inner 0–13%); «intrabar-poke» (фитиль≥inner, close вернулся) растёт 5m 28% → 1s **80%**; vol× ~2 на fine. Выглядело как разгадка: интрабар-касание inner + всплеск объёма.
- **RE20** (`ci-results/re20-intrabar-trigger-fit.*`): precision-тест УБИЛ гипотезу — **ловушка базовой ставки.** P(касание|стрелка)~80%, но P(стрелка|касание)~**1%**: фитиль касается inner в **5–47× чаще**, чем есть стрелки (density 1s 47×, 5s 11×), precision 1–7% на fine. На 1m/5m best F1 ~0.14–0.20 = как OWN2. Объём/направление precision не спасают.
- **RE21** (`ci-results/re21-feargreed-among-touches.*`): F&G-осциллятор (RSI/стохастик, свип периодов 7/14/21 × порогов) СРЕДИ касаний inner тоже НЕ разделяет — best F1 ~0.12–0.16 (precision 5–12%), на 1s фильтр → 0 срабатываний. Селектора «1 из ~50 касаний» не нашли.
- **Вывод (усиливает §3, ЗАКРЫВАЕТ генерацию стрелки на OHLCV):** даже near-tick + точные линии зоны + гейт касания + F&G НЕ воспроизводят стрелку выше уровня OWN2 (~F1 0.2). Точный бар стрелки на OHLCV+зона **не идентифицируем** — подтверждено на секундных данных. Секунды подтвердили ГЕОМЕТРИЮ и МЕХАНИКУ (касание внутр. полосы интрабар), но не дали ФОРМУЛУ-селектор. Остаётся: не-OHLCV / внутренняя серия индикатора, либо брать стрелку с его индикатора/алертов. НЕ переоткрывать OHLCV-перебор.

### RE22 (2026-08-19) — интрабар-ПОСЛЕДОВАТЕЛЬНОСТЬ (совпадение объёма с касанием + счётчик касаний) НЕ добавляет precision
Мотивация: web-справка по Pine (2026-08-19) — вендор легально мог видеть интрабар через `request.security_lower_tf()`; funding напрямую в Pine НЕ тянется (вычеркнут). RE20/21 брали лишь агрегат coarse-бара; RE22 реконструирует путь ВНУТРИ coarse-бара по РЕАЛЬНЫМ младшим барам (пары в окне перекрытия) и тестирует селектор: касание внутр. полосы + объёмный всплеск на ТОМ ЖЕ суб-баре (`coincide`) + число касаний `nTouches` (rearm). Раннер `ci/research/runRE22IntrabarSequenceFit.ts` → `ci-results/re22-intrabar-sequence-fit.*`. Свип requireCoincide×maxTouches{∞,1,2,3}×minTouches{1,2}×tol, train/OOS 65/35, gate-референс = RE20.
- **Данные-лимит (сам по себе результат):** near-tick окна КОРОТКИЕ и вложены в правый конец coarse-файлов ⇒ стрелок в перекрытии мало. 1s-пары **underpowered**: ETH 1m×1s N=5, ETH 5m×1s N=1, BNB 1m×1s N=5 — статистики нет (ровно причина matched=0 в RE20/21 на 1s).
- **Где N достаточно — лифта над gate НЕТ или он in-sample:** ETH 5m×1m (N=24): gate F1 0.09 → best 0.11, **OOS 0.10** (≈gate). ETH 1m×5s (N=14): best F1 train **0.48 → OOS 0.00** (чистое переобучение). BNB 5m×1m (N=29): gate 0.06 → best 0.11, **OOS 0.00**. BNB 1m×10s (N=18): gate 0.15 → best 0.23, **OOS 0.12** (train 0.18).
- **`coincide` не помогает:** победивший cfg почти везде свёлся к `requireCoincide=false` (совпадение объёмного всплеска с касанием НЕ является отбором). Направление непостоянно: ETH 5m×1m у стрелок coincide 100% vs 81% на касаниях (nTouches 3 vs 2), но ETH 1m×5s наоборот 0% vs 50%.
- **Вывод:** интрабарная последовательность (порядок касания/объёма, повторность) НЕ воспроизводит селектор стрелки устойчиво — прирост живёт только in-sample и рушится на OOS, best-cfg игнорирует `coincide`, 1s underpowered. Согласуется с RE20/21. §3 усилен окончательно: механизм отбора стрелки не сидит ни в агрегате, ни в интрабар-последовательности OHLCV. Следующий рычаг — только НЕ-OHLCV (OI/funding-как-внешний-фид/внутренняя серия) или брать стрелку с индикатора. НЕ переоткрывать интрабар-OHLCV.

### H1 (2026-08-20) — упрощённый causal `local sweep → reclaim → protection` shapes НЕ отделяет
Визуальный лид возник на **10 скриншотах, точно сопоставленных с CSV**, но не перенёсся на полный OOS. Причинный протокол: 37/37 vendor CSV, 21 inferential series ≥15m, заранее фиксированные OOS-активы + untouched oos-time, выбор конфига только на dev; все causality checks — PASS. Лучший dev-конфиг `left2/right2/window6/no-rebound/no-relVol` на OOS хуже `inner-excursion-touch` по ±1 F1 на **−4.92 п.п.** (95% CI [−6.52; −3.43]) и OWN2 на **−10.60 п.п.** (95% CI [−12.74; −8.77]).
**Вывод:** локальная последовательность sweep→reclaim→protection без дополнительного information set не является селектором shapes; не переоткрывать её как замену baseline/OWN2 по тем же данным. Артефакты: `ci-results/h1-causal-sequence.{md,json}`.

### Track S1/S2 (2026-08-20) — stateful-память траектории edge не создала
Причинная Apex event machine проверена единственной preregistered threshold-free рукой
`primary-threshold-free-all-confirmed-events`; Shapes полностью игнорировались. Split/hash
integrity прошла. Train: N=4845, meanR −8.2535, CI95 [−14.0245; −0.0548]. Validation:
N=799, meanR −0.2001, CI95 [−0.5861; 0.0530], PF 0.7163, breadth 0/2 symbols и 1/5 series.
Verdict — **`KILL_VALIDATION_NO_EDGE`**. Это validation kill: OOS reveal count 0, untouched
OOS намеренно не вскрыт и остаётся sealed. Гипотеза «проблема только в stateless OWN2»
проверена в минимальной stateful форме и не подтвердилась. A0/A1 не тестировались и не winners.
Артефакты: `ci-results/stateful-apex-s1-manifest.*`, `ci-results/stateful-apex-s2-results.*`.

### Track S3 (2026-08-20) — «истощение расширения» улучшило risk profile, но edge не подтверждён
На primary >=15m diagnostic profile нашёл два candidate: `newAdverseExtremes` (Cliff delta
−0.161, CI95 [−0.196; −0.125], q=0.005) и `lastExtensionIncrementOverInner` (delta −0.163,
CI95 [−0.195; −0.123], q=0.005). До reveal заморожена ровно одна v2-рука
`newAdverseExtremes <= 1`; threshold 1 — label-free median по development, без PnL-grid.
Internal holdout ONDO/VIRTUAL раскрыт один раз.

При 5 bps/side v1: resolved 259, meanR −0.09033, CI95 [−0.24971; 0.05873], PF 0.84025,
WR 0.44788, maxDD 39.17770R. v2: admitted 187, resolved 184, meanR +0.00227,
CI95 [−0.15046; 0.13710], PF 1.00472, WR 0.52717, maxDD 22.85845R. Paired delta meanR
v2−v1 = +0.09260, CI95 [−0.02065; 0.20599]. Breadth: 1/2 positive symbols и 1/2 positive
series. Point estimate, PF, WR и DD улучшились, но CI и preregistered breadth gate не прошли.
Verdict — **`KILL`**, не edge.

**Не переоткрывать:** «истощение расширения» — полезный risk/filter lead, но статистически
не подтверждённый прибыльный индикатор. Holdout уже раскрыт; запрещены ретюн threshold,
subgroup search и любые дальнейшие rescue-подборы на ONDO/VIRTUAL. S1 untouched OOS остаётся
sealed (`reveal=0`). Возврат возможен только с новой заранее мотивированной информацией либо
новым независимым датасетом. Артефакты: `ci-results/stateful-apex-s3-profile.*`,
`stateful-apex-s3-v2-freeze.*`, `stateful-apex-s3-v2-holdout.*`.

### Track S4 (2026-08-20) — recovery filter улучшил point estimate, но независимый holdout дал `KILL`
Development loss-source diagnostic: gross meanR **−0.0146R** уже отрицателен; fee drag
**−0.0798R** — главный incremental drag, net meanR **−0.0944R**. **1434/1456** stop outcomes
были favorable-then-stop; repeats не являются причиной. Значит отвергнуты объяснения
«gross положительный, всё убивают только fees» и «убыток создают повторы событий».

Замороженная label-free рука `recoveryFromExtremeOverInner >= 0.3203983409316291` была
единожды раскрыта на новом whole-symbol holdout ZEC/1000PEPE/BOME. v1 meanR **−0.02205**,
CI95 [−0.14444; 0.09872]; v2 meanR **−0.00032**, CI95 [−0.19157; 0.23155]; paired delta
**+0.02173**, CI95 [−0.14912; 0.22548]; breadth 2/3 symbols и 2/3 series. Улучшение point
estimate незначимо; verdict **`KILL` — не edge**.

**Не переоткрывать:** эту recovery-фичу как очередной входной фильтр; ее cutoff/operator,
asset/TF/side subgroups или rescue-гриды. Новый holdout раскрыт и сожжён — запрещены reuse и
retune на нём. S1 untouched OOS остаётся sealed (`reveal=0`). Наблюдение favorable-then-stop
допускает только отдельную causal management-гипотезу о сохранении уже возникшего favorable
excursion: сначала development и новая preregistration, без выдумывания правила здесь.
Артефакты: `ci-results/stateful-apex-s4-loss-source-diagnostic.*`,
`stateful-apex-s4-v2-freeze.*`, `stateful-apex-s4-holdout-universe-freeze.*`,
`stateful-apex-s4-holdout-acquisition.*`, `stateful-apex-s4-v2-holdout-reveal.*`.

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

### RE12c (2026-08-19) — vendor-WR на 2h воспроизведён точно, но expectancy ≈0/минус (WR≠деньги)
ETH/SOL 2h, входы = vendor CSV shapes, `safe`, `fullFixAtMean:false` + добор, каноничные Apex-полосы,
`replayAdmittedArrowSignals`. N/WR/Stop совпали с вендором почти точно (ETH 84/81.0%/19.0%; SOL 87/88.5%/11.5%),
но деньги: ETH **−4.2R gross** (PF 0.84), SOL **≈0** (−0.05R, PF 1.00) → минус на 5 bps.
**Прямое 2h-подтверждение §7 «vendor parity ≠ profitability».** Две методологические грабли (зафиксировать):
- **Таксономия исходов движка ≠ вендорские ярлыки.** Движок берёт частичку (`partialTaken`), но НЕ присваивает
  `partial-be` (БУ-хвост удалён, `INDICATOR §6`). Считать вендорский Partial как `partial-be` → всегда 0%.
  У вендора `partial-stop` (частичка→стоп) = **Partial/WIN**, НЕ Stop; иначе stop-rate раздувается и не
  калибруется (RE12b: ETH 38%/SOL 33% против вендорских 19%/11.4%).
- **Occupancy вендора уже зашита в набор shapes.** CSV-стрелки непересекающиеся (следующая только после
  стопа/фулла предыдущей). Повторная occupancy при реплее (`replayArrowSignals`) дропает ~28-34% стрелок,
  т.к. наш выход по времени позже вендорского → ложное перекрытие. Для воспроизведения таблицы считать каждую
  стрелку своей сделкой (`replayAdmittedArrowSignals`). ⚠ Выброс стрелок искажает и деньги: SOL казался +1.45R
  на 60 сделках, но ≈0 на всех 87 — **селекционный артефакт**.
Артефакты: `ci-results/re12b-partial-add-safe.*`, `ci-results/re12c-vendor-raw-taxonomy.*`.

### RE13–RE17 (2026-08-19) — рычаг ПЕЙОФФА (выход/риск) проверен и НЕ даёт OOS-edge
После RE12c (вендор воспроизведён, но WR≠деньги) проверили единственный оставшийся рычаг — геометрию
выхода/риска — на всех 12 вендор-CSV (входы = shapes, admitted-реплей, safe, 5 bps taker).
- **RE13** (`ci-results/re13-expectancy-decomposition.*`): payoff (avgWin/avgLoss) ≈ **0.5 универсально**
  (avgWin~0.4R, avgLoss~0.85R) → breakeven-WR ~66%; денежный WR ~65% (ярлычный 80% раздут `partial-stop`'ами).
  Gross-плюс только на альтах-фаворитах (AVAX/ONDO/VIRTUAL), мажоры (BTC/ETH/SOL) минус; после 5 bps плюс
  только AVAX/ONDO/VIRTUAL; 1m убит издержками. Это и есть причина «WR≠деньги».
- **RE14** (`ci-results/re14-management-matrix.*`): static-full (фикс 2×step, без частички) — лучший payoff
  (~0.90); mean-fix — худший в агрегате (payoff 0.22), НО лучший на быстрых шумных ТФ (BNB-1m, BTC-5m/15m).
  Ни одна рука не даёт агрегат-плюс на 5 bps.
- **RE15/RE16** (`ci-results/re15-static-stop-sweep.*`, `re16-static-stop-risk.*`): чем ШИРЕ стоп, тем лучше;
  static-full стоп~3 — первый агрегат-плюс (+42R, meanR +0.041). Это **плато** (стоп 2.5–5 в плюс, не убегает),
  худшая сделка ~1R (в R хвостовой иллюзии нет), НО edge тонкий, ret/DD ~0.35 (просадка ~10R на портфель).
- **RE17 (СТРОГИЙ OOS, `ci-results/re17-oos-validation.*`):** хронo-split 65/35, static-full стоп=3 a-priori,
  bootstrap 3000. Pooled OOS meanR **+0.024, CI [−0.065, +0.107]** — CI пересекает 0 ⇒ **edge НЕ подтверждён**.
  Train-selected стоп ХУЖЕ на OOS (0.024→0.007, переобучение). Per-series — монетка (SOL-2h +0.237, VIRTUAL перп
  +0.205 держатся; ONDO +0.231→−0.193, ETH-2h −0.178, BNB-1m −0.270 разваливаются).
- **Вывод:** рычаг пейоффа (стоп/частичка/mean-fix/ширина стопа) НЕ создаёт устойчивого edge после taker-издержек.
  NO-GO подтверждён и со стороны выхода/риска (раньше — со стороны входа, §8/B1/D). «Широкий стоп в плюс» — это
  in-sample-плато, размывается в ноль на OOS (ещё один кейс §7). Не переоткрывать стоп/частичку/mean-fix как edge
  без нового information set.
- **НЕ тестировано (открыто, автор держит линию открытой):** стоп-в-БУ после частички (в движке нет, INDICATOR §6);
  `targetSteps` > 2×step (цель захардкожена — правка src/core); свип `stepDivisor` (масштаб step-юнита); сравнение
  нашего heatmap/POI vs вендорский GGI Heatmap + Fibonacci-конфлюэнс; не-OHLCV информация (OI/funding/CVD);
  maker-исполнение (RE11: edge существует как maker/низкая комиссия).

---

## 8. Фильтры ВХОДА на текущем information set (B1, 2026-08-14) — нет OOS-edge
Причинный filter-benchmark (`tools/research/filterBenchmark.ts` → `ci-results/filter-benchmark-b1.json`):
5 активов (SOL/BTC/ETH/XRP/BNB) × 3 ТФ (30m/1h/2h) × 3 режима × 7 фильтров
(off/slope/reversal/contraction/exhaustion/liquidity/combo), причинный A1-допуск, издержки 7 bps,
train/OOS 65/35, bootstrap CI seed 20260807, 19 698 сделок.
- **0 из 21** ячеек filter×mode имеют OOS net mean > 0 при CI-low > 0. Все net mean отрицательны.
- Целиком отрицательны (CI не включает 0): `slope/risk` [−0.223, −0.030], `liquidity/risk` [−0.164, −0.009].
  Risk-режим стабильно худший из трёх.
- **`liquidity/safe` ≡ `off/safe`** (−0.053, N=466 обе) и **`combo` ≡ `exhaustion`** (−0.048, N=439):
  фильтры ликвидности на safe ничего не отсеивают и ничего не добавляют. Подтверждает §7
  (POI-touch — risk-filter, не edge) уже на 5 активах с CI.
- Breadth: long убыточен на всех активах; short «менее плохой» (~0). Единственные плюсы — XRP
  (off +0.010, contraction/safe +0.043) и short отдельных ячеек — изолированы, в пределах шума.
- **Вывод:** отбор ВХОДА фильтрами на OHLC+bands исчерпан. Высокий vendor-WR (~0.83 safe) при
  meanR≈0 указывает: утечка R — в **геометрии выхода/риска**, а не в селекции входа. Харнесс
  переиспользуем — любую новую гипотезу гнать через него (train/OOS + CI + breadth).

### D1/D1.2/D-lead — выход и сторона (2026-08-14)
- **D1 exit-benchmark** (`ci-results/exit-benchmark-d1.json`): static-тейк (фикс 2×step) > dynamic (mean-revert
  у Apex-mean) на всех 3 геометриях — dynamic-выход закрывался слишком рано (holdBars 182 vs 302) и резал
  победителей. safe/static: −0.011R (PF 0.98) против safe/dyn+partial −0.053 (PF 0.84). Partial вкл чуть ЛУЧШЕ,
  чем выкл. Но 0/9 вариантов с OOS net>0 при CI-low>0 — static лишь поднимает к безубытку, edge нет.
- **D1.2 target-sweep** (`ci-results/exit-target-sweep-d1_2.json`): цели 2×/2.5×/3× (решение автора). Target —
  НЕ рычаг: на safe плоско (T2 −0.011, T3 −0.007), на standard/risk дальше = хуже. Валидация: safe/T2 = D1 safe/static.
- **D-lead — short/safe НЕ прошёл walk-forward** (`ci-results/short-static-walkforward.json`): OOS-плюс short
  (+0.094 на последних 35%) оказался **свойством конкретного окна**. На ПОЛНОЙ истории short safe/static/T2:
  N=651, meanR **−0.009**, CI [−0.090, 0.071], PF 0.98. По кварталам (N≥10): плюсовых лишь **10/18 (56%)** —
  монетка, знак прыгает (2023-Q4 −0.72, 2025-Q3 −0.45 против 2022-Q1 +0.81, 2025-Q4 +0.52). Безусловная
  сторона edge НЕ имеет.
- **Полезная находка (мотивирует D4):** long и short **в противофазе** по кварталам — когда short убыточен,
  long прибылен, и наоборот (2023-Q4 short −0.72 / long +0.99; 2025-Q1 short +0.34 / long −0.62; 2025-Q4
  short +0.52 / long −0.28). Сигнал стреляет в обе стороны; выигрывает та, что совпала с режимом рынка.
  Безусловный сигнал ≈ 0 именно потому, что прав и неправ в чередующихся режимах → edge (если есть) в
  **выборе активной стороны по режиму**, а не в фикс-стороне/выходе.

### D4 — макро-гейт BTC-тренда НЕ восстанавливает противофазу (2026-08-14)
Первый заранее-заданный **нейтральный** прокси режима (`tools/research/regimeGateD4.ts` → `ci-results/regime-gate-d4.json`):
рыночное состояние = знак BTC-2h `close` vs трейлинг-SMA600 (≈50 дней), строго причинно (SMA только по прошлому +
последний BTC-бар с `ts ≤ signalAt`). Гейт активной стороны на том же допущенном наборе (safe/static/T2, 5 активов ×
3 ТФ, net 7bps, 1292 сделки; окно SMA **не свипалось** — §2.1).
- **Ключевой тест aligned vs anti провален:** `regime_aligned` (long в up-режиме / short в down) meanR **−0.049**
  CI [−0.147, +0.056] ≈ `regime_anti` (зеркало) **−0.059** [−0.131, +0.012] ≈ `baseline` (обе стороны) **−0.056**
  [−0.116, 0.000]. Если бы тренд BTC выбирал верную сторону, aligned был бы плюсовым, а anti симметрично минусовым.
  Они **неразличимы**, все CI пересекают 0.
- **OOS (65/35 по времени):** aligned OOS −0.030 [−0.187, +0.135], train −0.060 — оба минус, широкие CI. На отложенном окне ничего.
- **Breadth не когерентен:** aligned vs baseline по meanR — XRP +0.093, BNB +0.036, НО ETH **−0.330** (baseline −0.074),
  BTC −0.070 (−0.028). Выравнивание по BTC-тренду системно не помогает — разнобой по активам.
- **Кварталы aligned (N≥10):** плюсовых 3/10 (30%) — хуже монетки, хуже безусловного baseline.
- **Вывод:** квартальная противофаза long/short (D-lead) **реальна**, но **не объясняется** знаком макро-тренда BTC.
  Этот простейший нейтральный прокси режима — отвергнут. D4 как трек не закрыт: остаются др. заранее-регистрируемые
  экзогенные прокси (перцентиль реализованной волы BTC, кросс-активный breadth) — но каждый новый прокси = новая
  гипотеза, НЕ подбор окна на этих же данных.

### D4b — режим по реализованной воле BTC: directional провал, но vol-MAGNITUDE лид (2026-08-14)
Второй прокси (`tools/research/regimeGateD4Vol.ts` → `ci-results/regime-gate-d4b-vol.json`): BTC-2h realized-vol
(std лог-доходностей, окно 120 ≈10 дней) vs трейлинг-медиана (окно 1000), high/low, строго причинно. Окна **не
свипались** (§2.1). Пул тот же (safe/static/T2, 5 активов × 3 ТФ, net 7bps, 1282 сделки).
- **Directional-гипотеза (long в low-vol / short в high-vol) ОТВЕРГНУТА:** `vol_aligned` −0.057 [−0.146, +0.028]
  ≈ `vol_anti` −0.073 [−0.150, +0.006] ≈ `baseline` −0.065 [−0.121, −0.010]. Вола НЕ выбирает сторону (как trend в D4a).
- **Настоящая структура — про ВЕЛИЧИНУ, не сторону:** в **low-vol** сигнал значимо теряет — `low_all` **−0.135**
  CI **[−0.214, −0.053]** (не включает 0), `low_long` −0.181 [−0.303, −0.064] (не включает 0), `low_short` −0.096.
  В **high-vol** ≈ безубыток — `high_all` +0.017 [−0.071, +0.103], `high_short` +0.091 [−0.034, +0.209], `high_long` −0.045.
  Direction-aligned плохой именно потому, что худшая ячейка (low-vol-long −0.181) попадает в aligned.
- **Интерпретация:** вола — не селектор стороны, а **фильтр участия/риска**: тихий рынок (low-vol) стабильно
  сливает R; вся «жизнь» сигнала в high-vol (но лишь до ≈0, не плюс). Согласуется с §7 (причинный контекст = risk-filter).
- **Осторожно — это ЛИД, не edge (цифры full-history):** `2025-Q4` aligned +0.81 PF 9.2 — одно окно доминирует
  (капкан D-lead short); кварталов aligned плюсовых 4/14 (29%) — монетка. low-vol-минус подтверждается на OOS
  отдельным гейтом «high-vol-only on/off» (обе стороны, без флипа) — см. запись ниже.

### D4b-OOS — гейт «high-vol-only on/off»: low-vol-вето ПОДТВЕРЖДЕНО OOS; high-vol-плюс = лид (2026-08-14)
Честный отложенный тест того же прокси воли (`tools/research/regimeGateD4bHighVolOos.ts` → `ci-results/regime-gate-d4b-highvol-oos.json`),
БЕЗ новых порогов (§2.1). Три набора (обе стороны) × {full / train 65% / OOS 35% по времени}, bootstrap CI.
- **low-vol = устойчивый дренаж R (ПОДТВЕРЖДЕНО OOS):** `low_only` full −0.135 [−0.211, −0.059], OOS **−0.214 [−0.337, −0.084]**
  — CI не включает 0 и в full, и в OOS (OOS даже хуже). По активам OOS минусовой на 4/5 (BTC −0.323, XRP −0.297,
  BNB −0.198, SOL −0.218; ETH ≈0). Это **первый причинный OOS-устойчивый эффект в проекте** — но это **risk-filter**
  («в тихом рынке не торговать»), а не источник плюса. Согласуется с §7.
- **high-vol-плюс = ЛИД на свежем окне, НЕ edge:** `high_only` OOS +0.174 [+0.045, +0.318] PF 1.45 (CI-low>0 — единственная
  ячейка в проекте, прошедшая планку B1), НО **train −0.068** (минус!) и full лишь +0.017 [−0.070, +0.101]. Весь плюс сидит
  в свежем окне (2025-Q4…2026-Q2); кварталов high_only плюсовых 7/15 (47%). Это ровно капкан D-lead short (плюс на последних
  35% → ноль на всей истории). breadth OOS шире, чем у D4a (BTC +0.412, SOL +0.209, BNB +0.252; ETH/XRP ≈0), но train-минус
  не даёт назвать это edge.
- **Итог:** надёжный, зафиксированный вывод — **low-vol-вето** (снять просадку). «high-vol → плюс» проверен ниже (D4b-temporal) и ОТВЕРГНУТ.

### D4b-temporal — high-vol-плюс ОТВЕРГНУТ; low-vol-вето = durable risk-filter (2026-08-14, ЗАКРЫВАЕТ D4a/D4b)
Временна́я устойчивость high-vol-плюса (`tools/research/regimeGateD4bTemporal.ts` → `ci-results/regime-gate-d4b-temporal.json`),
тот же прокси, без новых порогов (§2.1): meanR по полугодиям + кумулятив + per-asset×TF (full/OOS).
- **high-vol-плюс = ОТВЕРГНУТ (не структурный, не edge):** знак `high_only` **осциллирует** по полугодиям
  (2022-H1 −0.34, 2022-H2 +0.88, 2023-H1 +0.37, 2023-H2 −0.10, 2024-H1 +0.18, 2024-H2 −0.20, 2025-H1 −0.15, 2025-H2 +0.02,
  2026-H1 +0.16, 2026-H2 −0.10) — устойчивого плюсового хвоста нет, последнее полугодие в минусе. **Кумулятив приходит к ~+0.017**
  (плоский ноль, не разворот). OOS-плюс (+0.174) собран из свежего батча 2026-H1 (N=132) + концентрации на **BTC** (пул OOS
  +0.412; сильны лишь BTC 30m +0.592 и XRP 1h +0.503; ETH/XRP пуленые плоские). Не широко, не персистентно → тот же капкан D-lead.
- **low-vol-вето = ПОДТВЕРЖДЁННЫЙ durable risk-filter:** `low_only` минусовой в **7/10 полугодий**, и в свежих подряд
  (2025-H1 −0.16, 2025-H2 −0.17, 2026-H1 **−0.176 CI [−0.317, −0.029]** — исключает 0). Причинный, OOS-персистентный.
  Применение: **не торговать сигнал в low-vol режиме** (BTC-2h realized-vol ниже трейлинг-медианы) — снижает просадку, плюса НЕ даёт.
- **Вывод по треку D4 (ЗАКРЫТ на trend+vola):** ни trend (D4a), ни vola (D4b) не выбирают сторону и не создают положительный edge.
  Квартальная противофаза long/short (D-lead) экзогенным режимом НЕ объяснена. Единственный durable выход D4a/D4b — low-vol-вето
  (risk-filter, §7). Остаются непройденными: **D4c** (кросс-активный breadth), **D5** (кросс-секция/relative-value).

### D5 — кросс-секция / relative-value (variant A): нет edge (2026-08-16)
Раннер `tools/research/crossSectionD5Rank.ts` → `ci-results/cross-section-d5-rank.json`. Сила = относительный импульс
(past-H-bar return, H=2000, причинно); long лидер / short аутсайдер (топ-1 vs топ-1); две руки — `signal-gated-top1`
(наш сигнал задаёт сторону/актив) и `momentum-only` (контроль, без сигнала); издержки 4×7bps (2 ноги), метрика return%/сделку,
train/OOS 65/35, bootstrap seed 20260807. Окно импульса/определение силы/top-k НЕ свипались (§2.1).
- **signal-gated-top1:** OOS N=68, meanR **−0.93%** CI [−2.75, +0.95] (задевает 0, сделок мало); full −2.04%, train −2.63%.
- **momentum-only (контроль):** OOS N=402, meanR **−1.05%** CI [−1.86, −0.25] (устойчивый минус, CI не включает 0).
- **Breadth OOS — плюс ТОЛЬКО BTC** (gated +1.44 N29 / momo +2.19 N165), остальные 4 актива в минусе в обеих руках →
  «прибыль» = бета BTC, не заслуга сигнала.
- **Вывод:** relative-value momentum (сильный↑ / слабый↓) на нашем горизонте убыточен (крипта откатывает); сигнал добавляет
  лишь ~0.1% над контролем — в пределах шума. Кросс-секция edge не создаёт, момент даже вредит. НЕ проверено: зеркальная
  mean-reversion версия (fade momentum: long аутсайдер / short лидер) — по сути класс D2.

### D3 — структурный контекст на входе: нет edge, один OOS-лид (2026-08-16)
Раннер `tools/research/structureContextD3.ts` → `ci-results/structure-context-d3.json`. Разметка допущенного пула
(safe/static-full/T2, тот же пул D4, 1307 сделок) структурной позицией НА ВХОДЕ, причинно (knownAt ≤ entryTs):
(1) контр-тренд к HTF; (2) premium/discount 4h-диапазона; (3) дистанция от BOS. HTF-якорь = 4h, pivotWindow=2, P/D и тренд —
готовый look-ahead-free `src/core/analysis/htfContext.ts`. Сплит BOS — медиана `barsSinceBos` по train (=4 бара). Нога импульса
НЕ реализована (правило не задано автором, §2.1 — TODO в артефакте). Дефолты корзин нейтральные, НЕ свипались (⚠ финал — автор).
- **8/9 корзин не проходят** (OOS meanR≤0 или CI задевает 0): baseline −0.03, trend_aligned −0.14, trend_counter +0.09 [−0.06,+0.24],
  pd_aligned −0.04, pd_discount −0.09, bos_near +0.02 [−0.12,+0.14], bos_far −0.06.
- **Единственный «выживший» — `pd_premium`** (OOS meanR **+0.17** CI [+0.04, +0.30], N=231, PF 1.43), НО full **−0.02** и train **−0.13**
  (минус!) → весь плюс в свежем OOS-окне; breadth некогерентен, кварталов aligned плюсовых 9/19. **Тот же капкан свежего окна**
  (D-lead / high-vol D4b) → это ЛИД, НЕ edge.
- Любопытно: сработала корзина **против** учебникового P/D (premium для лонга = «плохой» вход) — перекликается с §6
  «сигнал помечает худшие входы» и **мотивирует D2 (fade)**, но само по себе — шум (широкий CI, отрицательная история).
- **Вывод:** структурный контекст входа устойчивого edge не даёт. Закрыт последний дешёвый рычаг ОТБОРА ВХОДА на текущем
  information set.

### E1+E2 — критичные баги замерочной линейки ИСПРАВЛЕНЫ; low-vol-вето ОТВЕРГНУТ после перепрогона (2026-08-17)
Внешний адверсариальный ревью (`AI Edge/`, Prompt A: Opus 5 + GPT 5.6 xHigh с доступом к коду) нашёл два бага, которые
инвалидируют часть D-выводов. Оба ПОДТВЕРЖДЕНЫ в коде и ИСПРАВЛЕНЫ (§2.2: показано до правки).
- **E1 — relVol-фильтр был ВЫКЛЮЧЕН.** Раннеры B1/D1/D3/D4/D4b звали `detectArrowSignalCandidates(candles, APEX_PARAMS)`
  без 3-го аргумента → движок брал дефолт `minimumRelativeVolume=0.0` (`DEFAULT_ARROW_SIGNAL_CONFIG`), а НЕ frozen `≥1.4`
  (`zonda-reversal.md`) → гонялись на другой, низкообъёмной популяции сигналов. Фикс: явно передавать
  `{ minimumRelativeVolume: 1.4 }` (const `FROZEN_REL_VOL`). Движок НЕ тронут (§2.3).
- **E2 — look-ahead в режиме BTC-2h.** `regimeAsOf` брал последний BTC-бар с `timestamp ≤ signalAt` и читал его `close`.
  Но `timestamp` свечи = время ОТКРЫТИЯ бара → для сигнала ВНУТРИ 2h-окна это `close` ещё НЕ закрытого бара (будущее).
  Подтверждено семантикой репо: ресемплинг `bucket=floor(ts/2h)*2h`; forward-аудит `signalOpen=closeTime−tfMs`. Фикс:
  брать последний ПОЛНОСТЬЮ ЗАКРЫТЫЙ бар (`openTs + barMs ≤ signalAt`) в `regimeGateD4.ts` + `regimeGateD4Vol.ts`. `tsc` чист, тесты зелёные.
- **Перепрогон D4b с ОБОИМИ фиксами (2026-08-17): low-vol-вето НЕ выживает.** Ключевой бакет `low_all`: БЫЛО
  −0.135 CI [−0.214, −0.053] (значимо минус, обосновывал вето) → СТАЛО **−0.023 CI [−0.105, +0.058]** (CI пересекает 0;
  пул 1101 против 1282). `low_long` −0.181 → −0.005; `low_short` −0.096 → −0.038. Эффект «в тихом рынке сигнал сливает R» ИСЧЕЗ.
- **Вывод:** запись «D4b-temporal: low-vol-вето = durable causal risk-filter» (выше) **ОТМЕНЕНА** — это был артефакт
  look-ahead (E2) + низкообъёмной популяции (E1), а не реальный эффект. После честной линейки экзогенный режим (D4a trend +
  D4b vola) НЕ даёт НИ выбора стороны, НИ risk-filter. baseline остался ≈0 (−0.022) → NO-GO production не меняется. Прежние
  D-выводы, завязанные на relVol/режим, читать с этой поправкой. ZC5/pd_premium под тем же подозрением (short-beta) → проверяются в **E3**.

### E3 — плацебо-нормированный NET-ре-замер ZC5 SELECTIVE и pd_premium: ОБА KILLED (2026-08-17)
Раннер `ci/research/runE3PlaceboNet.ts` → `ci-results/e3-placebo-net.{json,md}`. Каждому реальному сигналу (symbol,side,t) —
K=20 плацебо (тот же символ+сторона, случайный бар ±30 дней, единственное условие допуска — valid-band); `excess = netR(real) −
mean(netR по K плацебо)`. 5 обязательных фиксов внутри `replayE3Trade`: (1) per-mode gate OFF (1 сигнал=1 сделка); (2) End-mark
НЕ выбрасываем → mark-to-market + timestop; (3) partial по `mean_{i-1}`; (4) невалидный band не пропускает проверку стопа;
(5) net 7bps (`costR=turnover*0.0007/oneR`). Cluster-bootstrap (кластер = side×4h-bucket), seed 20260807. Kill если ЛЮБОЕ:
excess<+0.05R (in) ИЛИ p>0.0167 ИЛИ excess<0 (OOS).
⚠ **Выборка урезана по решению автора ради времени** (Leg A ~O(сигналы×префикс), ~5-6 мин/актив; побитово-идентичного
ускорения без правки замороженного heatmap-движка нет — иначе вернётся look-ahead #2): in-sample = BTC/ETH/SOL/XRP/BNB/DOGE (6),
OOS = 1000PEPE/AAVE/ARB/ENA/OP/SUI (6). **ТФ: оба лега — 1h** (пулы/HTF 4h); pd_premium (D3) исходно 30m/1h/2h — здесь только 1h.
- **ZC5 SELECTIVE — KILLED (все 3 условия):** IN n=53 netR −0.043 placebo −0.047 **excess +0.005** p=0.48; OOS n=116 netR −0.087
  **excess −0.020** p=0.64. excess≈0 ⇒ **чистая short-beta** (реальный ≈ случайный шорт того же символа). shortShare 89%/80%.
  Прежние «+0.18R» = gross + бета шорта. Per-asset дисперсия огромна (SOL +0.15, XRP +0.13, 1000PEPE OOS +0.20 против DOGE −0.19,
  ARB −0.15, AAVE −0.11), но агрегат ≈0.
- **pd_premium (D3) — KILLED (excess<0.05 in-sample И p>0.0167):** IN n=225 netR −0.040 placebo −0.075 **excess +0.034** p=0.22;
  OOS n=203 netR +0.021 placebo −0.062 **excess +0.083** p=0.044. Отличие от ZC5: excess **положительный на 10/12 активов**
  (все 6 OOS в плюсе: ENA +0.21, ARB +0.13, OP +0.08, 1000PEPE +0.07) ⇒ **НЕ чистая short-beta** — сверх беты остаётся маленький,
  но широкий остаток; НО ниже экономического порога +0.05R (in-sample топит DOGE −0.074) и не значим при строгом барьере 0.0167.
  DOGE — стабильно худший в обеих ногах.
- **End-mark rate ~51-63%:** половина+ сделок закрывалась mark-to-market по таймстопу (эффект фикса №2) — включение прежде
  выбрасываемого хвоста садит доходность к нулю/минусу.
- **Каветаты:** (1) OOS всего 6 активов → kill-условие «excess<0 на невиданных» ослаблено (для ZC5 сработало, у pd_premium OOS был
  плюсовым); (2) только 1h; (3) **mean-фиксация выхода (E5) в этом прогоне НЕ тестировалась** — гонялся только BASE (partial 25% +
  static-TP + stop 12×TR55).
- **Вывод:** оба «плюса ВХОДА» не переживают net+плацебо-нормировку. ZC5 = short-beta; pd_premium = слабый суб-пороговый остаток,
  не значим ⇒ не edge по пред-регистрации. NO-GO production не меняется. Легитимные незакрытые ветки: **B3** (кондиционирование по
  классу активов с a-priori правилом + OOS — учитывая per-asset дисперсию), **E5/mean-fix**, **D2 (fade)**, **E6 (E-BAR)**,
  и полный OOS + мульти-ТФ повтор pd_premium.

### E5 (попытка 1) — mean-fix на pd_premium НЕВАЛИДНА для идеи автора + дивергенция линии управления (2026-08-17)
Раннер `ci/research/runE5MeanFixPaired.ts` (форк E3) → `ci-results/e5-meanfix-paired.{json,md}`. Гонял pd_premium × {5m,15m,30m,1h} ×
{BASE, MEANFIX=фикс 100% у `mean_{i-1}`}, net+плацебо. Формально 7/8 ячеек KILLED; «выжила» лишь 15m MEANFIX — **но теряет деньги
на ОБОИХ сплитах** (Result IN −2.39R, OOS −8.37R), а excess>0 только потому, что случайный шорт теряет ЕЩЁ больше. **Этот прогон
НЕВАЛИДЕН как тест идеи автора** — тестировал не тот объект:
- **Не тот сигнал:** pd_premium (D3) = premium-4h-гейт + relVol → **95–99% ШОРТ**, а не сырой GGI Buy/Sell (лонг+шорт, WR~63%).
- **Не та геометрия:** `replayE3Trade` (форк `replayVar1Trade`) — стоп **12×TR55**, static-inner TP (BASE) / фикс у `prevMean`
  (MEANFIX), **БЕЗ добора**, 1 сигнал=1 сделка. Это НЕ канонический `ArrowTradeReplay`.
- **Не те активы:** BTC/ETH/… — ни одного из авторских (LDO/AVAX/ONDO/VIRTUAL).

**⚠ ГЛАВНЫЙ УРОК — в репо ДВЕ линии управления, их путали:**
1. **Канон `ArrowTradeReplay`/`replayArrowSignals`** (боевой frozen-рантайм; baseline `zonda-reversal.md §3`; B1/D3/D4): `step=5.5·atr200/stepDivisor`,
   стоп `stopSteps·step` (Safe 2×), **добор** `entry∓step`, тейки **движущиеся** (mean partial + противоположный inner), occupancy+`postExitBars`.
2. **Форк `replayVar1Trade`→`replayE3Trade`** (research-линия `runVar1ExitSweep`→E3→E5): стоп 12×TR55, static-inner TP, БЕЗ добора,
   1 сигнал=1 сделка. **Никогда не сверялся с каноном.** Значит вердикты E3/pd_premium/ZC5 валидны ТОЛЬКО для вопроса «есть ли эдж у
   ОТБОРА СИГНАЛА под этим упрощённым управлением», и **НЕ являются вердиктом** по каноническому GGI Buy/Sell + фикс-у-mean.
   Ядро `ArrowTradeReplay` при этом целое; дивергенция — в исследовательских раннерах.

**Дыра в kill-критерии (найдена, §2.2 — показать, не патчить молча):** E3/E5 KILL/SURVIVES считают по `excess` (real − placebo) без
условия «net Result R > 0». Поэтому убыточная в деньгах рука (15m MEANFIX) формально «SURVIVES», просто «проигрывая случайному шорту
меньше». ⚠ Добавить обязательное условие «net Result R > 0 на OOS» — решает автор.

**Подводный камень канона:** `partialFraction=1.0` в `replayArrowTrade` НЕ закрывает сделку чисто — слот остаётся живым, а `add` может
пере-открыть позицию после «100% выхода» и словить полный стоп. Честный фикс-у-mean требует, чтобы сделка ЗАВЕРШАЛАСЬ на касании mean
(тейк-или-стоп) → это флаг движка (`fullFixAtMean`), а не костыль через `partialFraction`. Корректный reproduce-план — `ROADMAP E5`.

### E5-reproduce (попытка 2, канон) — фид/окно/стоп НЕ сводят; расхождение = сигнальная СТРЕЛКА (2026-08-17)
Прогон канонического GGI Buy/Sell (`replayArrowSignals`, OWN2 relVol1.4, mode=safe) против ТОЧНЫХ таблиц вендора.
Раннеры: `ci/research/runE5GgiLdoSpotReproduce.ts`, `runE5GeomSweepLdoSpot.ts`, `measureLdoGeometryScale.ts`,
`runE5AvaxSpotReproduce.ts` → `ci-results/e5-ggi-ldo-spot.*`, `e5-geom-sweep-ldo-spot.*`, `e5-geom-measure-ldo-spot.*`, `e5-avax-spot-reproduce.*`.
Движок/детектор НЕ тронуты; геометрия крутилась только через override (§2.1/2.2/2.4).

**Эталоны вендора (Binance spot):** LDO 15m — 89 сделок, WR 62.9%, avgStop −1.86%, +15.25R.
AVAX 5m (полная фиксация у mean, без частичек/доборов), две точки стопа: A «оптимальный» 67 сделок / WR 91% / avgStop −1.7% / +12.62R; B «стоп короче» 68 / WR 47.1% / avgStop −0.35% / +26.25R.

Последовательно отвергнуто:
1. **Фид (spot).** LDO 15m spot-20k BASE −13.61R — ХУЖЕ perp −5.54R. Смена биржи гипотезу не спасает.
2. **Окно (40k).** spot-40k BASE −21.35R, сигналов вдвое больше, глубже минус. «Дело в окне» отклонено.
3. **Масштаб стопа.** «Avg stop» вендора = средний % убытка на стоп-сделке (ПОДТВЕРЖДЕНО его же парой таблиц AVAX: короче стоп ⇒ −1.7%→−0.35%, WR 91%→47%, ResultR ↑). Наш канон-стоп `2·5.5·atr200` ≈ −11%/6.6% (вход→stop), у вендора ~1.86% → в ~3.6× шире. НО geom-свип (`stepDivisor×stopSteps`) под −1.86% только УХУДШАЕТ R: WR валится 80%→38%, ResultR −16…−40R. Ни одна комбинация сетки не даёт плюс.
4. **Тейк-логика ВЕРНА** (подтвердил автор: partial@mean, full@GGI Inner). Замер LDO 15m: вход→mean 3.41%, вход→Inner (фулл-тейк) 6.79%, вход→stop 6.60% → у нас RR≈1:1; у вендора при том же Inner 6.8% и стопе 1.86% RR≈3.6:1 → его +15R математически согласован.

**Корень (по трём сигнатурам):** расхождение — в СИГНАЛЬНОЙ СТРЕЛКЕ (входе), не в тейке/стопе/фиде/окне.
- **Плотность:** AVAX 5m ~2мес — наш OWN2 даёт 296 кандидатов (118–203 сделок) против его 67. Стрелок в ~3–4× больше.
- **Счётчик инвариантен у вендора** (67↔68 при смене стопа), у нас растёт (136→203): у него 1 стрелка=1 сделка, у нас occupancy плодит сделки при узком стопе.
- **Качество входа:** при ЕГО стопе наш WR всегда сильно ниже — AVAX −1.7%: 70.6% vs 91%; −0.35%: 20% vs 47%; LDO −1.86%: 38% vs 62.9%. Наши стрелки заходят там, где цена чаще ретрейсит против входа до тейка.

**Вывод:** reproduce упирается в детектор входа. Пересмотр прежней формулировки «косой стоп» → **косая стрелка** (частота + тайминг/качество входа). Формула стопа вендора нам неизвестна и §2.1 её выдумывать запрещает. Сверка стрелок ВЫПОЛНЕНА (2026-08-17, `ci/research/runE5ArrowVsVendorScalp.ts` → `ci-results/e5-arrow-vs-vendor-scalp.*`; источник `tg_topic_16293_scalp.json` — 1692 сырых алерта 30.05–06.08.2026, перп .P, БЕЗ цены входа; фид futures, OWN2 relVol1.4, матч ±1 бар). Агрегат: **5m** (Σvendor 254) наш OWN2 957 (**×3.8**), **recall 22%**, **precision 6%**; **15m** (Σvendor 87) наш 181 (**×2.1**), **recall 10%**, **precision 5%**; **dirAgree 100%** (где совпало по времени — сторона всегда та же). Итог: направление НЕ проблема; проблема — сам ТРИГГЕР: наш OWN2 переполнен (шлёт в 2–4× больше, 92–97% стрелок не соответствуют его алертам) И ловит лишь 10–22% его сигналов. Наша стрелка — принципиально более шумный детектор, чем его GGI. Reproduce заблокирован на уровне ДЕТЕКТОРА ВХОДА; двигаться — только по правилу стрелки/стопа вендора (§2.1). Детали — `ROADMAP E5`.

### Статус поиска edge (2026-08-16) — HOLD, НЕ «закрыт навсегда»
Исчерпан класс **«та же информация (OHLC + полосы одного индикатора) + дешёвые преобразования»**: вход-фильтры (B1), выход/цель
(D1/D1.2), сторона (D-lead), экзогенный режим trend/vola (D4a/D4b), кросс-секция (D5), структурный контекст (D3). Ни один не дал
причинного OOS-устойчивого плюса. (⚠ Обновление 2026-08-17: прежний «единственный durable результат — low-vol-вето»
ОТМЕНЕН — после исправления E1+E2 эффект схлопнулся, см. запись «E1+E2 …» ниже. Durable-результатов не осталось.) Перебрано НЕ всё — остаются
заранее-зарегистрированные непройденные рычаги (гипотезы, не тупик):
- **D2 — fade известного отрицательного фактора** (§6; вход против сигнала / fade momentum). Дёшево, НЕ прогонялся; D3(`pd_premium`)
  и D5(момент вредит) косвенно мотивируют. **Наиболее приоритетный оставшийся кандидат.**
- **D4c — кросс-активный breadth-режим** (экзогенный; окна НЕ свипать, §2.1).
- **D6 — новая информация извне** (intrabar/OI/funding, §3). Дорого, инфраструктурный рычаг.

Итог: вердикт — **HOLD (пауза)**, а не «edge нет никогда». Дешёвая ветка на текущих данных исчерпана; D2/D4c/D6 открыты.
