# Stateful Apex S4 — preregistration причинной диагностики источников отрицательного expectancy

> Статус: **DESIGN ONLY / NOT EXECUTED**. Этот артефакт задаёт только первый этап: измерить, где теряется expectancy. Он не меняет торговое правило, не строит PnL-grid, не выбирает отсечку и не раскрывает sealed данные.

## 1. Исследовательский вопрос и граница вывода

Цель — на development-данных разложить отрицательный `netR` замороженного Stateful Apex v1 на различимые механизмы:

1. качество и тайминг входа;
2. стоп и adverse/favorable path после входа;
3. комиссии;
4. зависимые повторные события/экспозиции внутри одного причинного рыночного движения;
5. концентрацию результата по независимым сериям и символам.

Это **диагностика причинного пайплайна**, а не поиск прибыльной руки. На этом этапе запрещены PnL-grid, оптимизация порогов, subgroup rescue, выбор актива/TF/стороны по доходности и изменение итогового verdict в docs.

## 2. Замороженный объект

Без изменений используются:

- manifest: `ci-results/stateful-apex-s1-manifest.json`;
- state machine: `ci/research/lib/statefulApexEvents.ts` (`apex-state-v1`);
- событие: `NEUTRAL → ARMED → EXTENDED → TRACKING → REVERSAL_CONFIRMED → COOLDOWN`;
- entry: open следующего бара после `REVERSAL_CONFIRMED`;
- target: Mean на баре confirmation;
- stop: same-side Outer на баре confirmation;
- same-bar collision: stop-first;
- расходы: **5 bps/side**, taker; funding не моделируется;
- primary population: все threshold-free confirmed events;
- warm-up: 210 баров;
- Vendor Shapes: запрещены как feature, target, matcher, episode boundary или критерий выбора.

Никакие файлы `src/core/` и никакие калибровочные константы не меняются.

## 3. Universe и split

### 3.1 Development universe

Берутся только series из S1 manifest, для которых одновременно:

- original split = `train`;
- timeframe >= 15 минут;
- symbol не принадлежит S1 `untouched-oos`;
- symbol не равен `ONDOUSDT` или `VIRTUALUSDT`.

Таким образом diagnostic development universe задаётся manifest-ом и на текущем frozen inventory содержит 15 независимых series по 6 символам: `ADAUSDT`, `BTCUSDT`, `DOGEUSDT`, `ETHUSDT`, `LDOUSDT`, `XRPUSDT`; фактический список runner обязан получить фильтрацией manifest, а не вручную. Если инвентарь manifest не совпадёт, runner падает до чтения raw CSV.

> Примечание: формулировка выше намеренно не использует S1 validation (`ONDO/VIRTUAL`): после S3 это сожжённый internal holdout, и он не может быть development-источником для новой диагностики/выбора.

### 3.2 Запрещённые данные и I/O boundary

До любого raw I/O runner обязан исключить:

- все S1 `untouched-oos` series; ожидаемый reveal count остаётся **0**;
- все `ONDOUSDT`/`VIRTUALUSDT` series, включая уже раскрытый S3 internal holdout;
- `buy`/`sell` Vendor Shapes: parser может валидировать схему, но поля немедленно destructure/discard до detection.

Runner публикует audit counters: forbidden files read, rows parsed, events detected, labels computed и features computed. Для обеих запрещённых групп все counters должны быть 0; иначе hard fail и результатов нет.

### 3.3 Внутренние development-срезы

Для проверки временной устойчивости, но не для подбора:

- каждая series делится по времени на три равных по числу eligible confirmation events fold: early/middle/late;
- primary estimate использует весь разрешённый development universe;
- fold estimates, symbol, series, TF, market и side — только breadth/sensitivity, не subgroup selection.

## 4. Causal feature timing

Все признаки фиксируются не позже `confirmationIndex` либо являются outcome после frozen `entryIndex` и явно маркируются как outcome.

### 4.1 До входа / на confirmation (допустимые объясняющие признаки)

Используются только уже определённые поля state machine:

- `barsSinceMean`, `barsSinceInner`;
- `currentDepth`, `maxDepth`;
- `newAdverseExtremes`;
- `lastExtensionIncrement`, `previousExtensionIncrement`;
- `recoveryFromExtreme`, `closeToMeanProgress`;
- candle body/range/wicks/true range;
- `meanSlope`, inner/outer widths и их однобарные изменения.

Нормировки — только contemporaneous `innerWidth`, `outerWidth`, `trueRange` с теми же null/validity правилами, что S3. `causalRelativeVolume` остаётся `null`: lookback/denominator не задан и не изобретается.

### 4.2 Entry-timing observables

Threshold-free измерения:

- `confirmationClose → nextOpen` signed gap в price, inner-width и frozen `oneR` units;
- distance от next-open entry до frozen Mean target и Outer stop;
- `rewardToRiskAtEntry = |target-entry| / |entry-stop|`;
- факт invalid label (`oneR <= 0`, stop не adverse, invalid row, no next bar) и его причина;
- доля событий, где target или stop уже пересечён entry-bar диапазоном; collision считается frozen stop-first.

Не исполняются альтернативные входы на inner-touch/confirmation-close/произвольном баре: это изменило бы торговое правило и потребовало бы отдельно замороженной counterfactual execution semantics.

## 5. Outcomes и строгая декомпозиция expectancy

Единица результата — detected frozen event; realised economics считается только для valid resolved labels, censoring публикуется отдельно.

### 5.1 Алгебраическая декомпозиция

Для каждого resolved event:

- `grossR` — frozen target/stop payoff;
- `costR = (entry + exitPrice) × 0.0005 / oneR`;
- `netR = grossR - costR`.

Pooled mean раскладывается без модельных допущений:

`E[netR] = P(stop)×(-1) + P(target)×E[targetR | target] - E[costR]`.

Отдельно публикуются:

- вклад stop outcomes в meanR;
- вклад target outcomes;
- fee drag и доля gross expectancy, съеденная 5 bps/side;
- gross и net breakeven target probability, рассчитанная из наблюдаемого targetR/costR (не торговый порог);
- invalid/censored rate, без импутации PnL.

### 5.2 Adverse/favorable path

До первого frozen target/stop либо конца valid data:

- MFE_R, MAE_R;
- time-to-MFE, time-to-MAE, time-to-resolution;
- first-passage order target/stop/censored;
- same-bar target+stop collision rate;
- для stop outcomes: pre-stop MFE_R и доля, где был любой положительный favorable excursion (`MFE_R > 0`; это нулевая, не подбираемая граница);
- для target outcomes: pre-target MAE_R;
- joint empirical distribution `(MAE_R, MFE_R)` и non-parametric ECDF по каждой оси;
- path ordering: `timeToMAE < timeToMFE`, `=`, `>`.

Никакие горизонты, MFE/MAE-cutoffs или stop multipliers не свипаются. Полная event-defined path является primary; bar-by-bar survival/hazard публикуется как описательная кривая без выбора времени выхода.

### 5.3 Диагностические механизмы

Каждое событие получает не взаимоисключающие флаги, заданные без новых торговых порогов:

- `entry-gap-adverse` / `entry-gap-favorable` по знаку signed gap;
- `stop-before-target`, `target-before-stop`, `same-bar-collision`, `censored`;
- `never-favorable-before-stop` (`MFE_R <= 0`);
- `favorable-then-stop` (`MFE_R > 0` и stop-first);
- `fee-flip` (`grossR > 0 && netR <= 0`);
- `invalid-risk-geometry` с точной причиной.

Это таксономия измерения, не admission rule.

## 6. Повторные события и episode dependence

### 6.1 Что определено

Frozen v1 state machine после emission входит в `COOLDOWN` и re-arm происходит только через уже реализованный `mean-reset`. Поэтому primary causal episode ID — строго существующий интервал state machine от `episodeStartIndex` до reset/series-end; emission принадлежит этому episode.

Runner должен восстановить episode ledger из transitions и проверить инвариант:

- не более одного emitted primary event на frozen episode;
- event indices лежат внутри episode;
- episode boundaries не используют будущий outcome.

Если инвариант нарушен, hard fail.

### 6.2 Что не определено и не исполняется

Документы не задают новую семантику объединения соседних episodes в «одно рыночное движение», cooldown в барах/wall-clock или правило дедупликации cross-TF событий. Поэтому запрещено придумывать merge window или cooldown threshold.

Вместо этого выполняются threshold-free dependence measurements:

- число episodes и emissions per frozen episode (ожидается 0/1);
- run-length последовательных same-side frozen episodes между opposite-side episodes;
- exact timestamp overlap/coincidence между series одного symbol;
- pairwise lag distribution в wall-clock без cutoff/merge;
- доля pooled PnL и event count по symbol×calendar-month и по series×calendar-month;
- sensitivity inference с кластером symbol×calendar-month, который поглощает повторные/перекрывающиеся движения без объявления спорной episode equivalence.

**Unresolved TODO:** причинно объединять cross-TF/соседние episodes можно только после отдельного решения автора о boundary/cooldown semantics. До этого candidate, зависящий от такого объединения, не допускается.

## 7. Estimands и breadth

Primary estimands:

1. pooled mean `netR` и его алгебраические компоненты;
2. probabilities stop/target/censored/collision/fee-flip;
3. means/medians/ECDF MFE_R, MAE_R, timing и entry gap;
4. non-parametric association каждого pre-entry feature с каждым mechanism outcome;
5. contribution concentration по symbol и independent series.

Обязательно публикуются:

- per-symbol и per-series estimates;
- positive/negative sign breadth;
- max absolute symbol contribution к pooled net loss;
- leave-one-symbol-out estimates;
- market, TF, side и temporal-fold sign stability;
- effective sample sizes: events, frozen episodes, symbol×month clusters, independent series.

Pooled результат не считается широким, если знак держится менее чем в 60% estimable symbols или independent series; это критерий интерпретации breadth, не trading cutoff.

## 8. Inference, cluster bootstrap и multiple testing

### 8.1 Confidence intervals

- 10,000 resamples; deterministic seed `20260821`.
- Primary hierarchical cluster bootstrap: outer resample symbols; внутри выбранного symbol resample calendar-month clusters; внутри cluster сохранять все события всех series целиком.
- Sensitivity A: resample independent series целиком.
- Sensitivity B: symbol×calendar-month cluster bootstrap без outer symbol stage.
- Paired decompositions (`net-gross = -cost`, mechanism contributions) сохраняют event pairing в каждом resample.
- CI: percentile 95%.

### 8.2 Associations

Continuous vs binary mechanism outcome: Cliff’s delta. Continuous vs continuous path outcome: Spearman rank correlation. Для каждого признака direction не используется для торгового решения на этом этапе.

Семейства multiple testing раздельны:

1. entry/timing outcomes;
2. stop/path outcomes;
3. fee outcome;
4. episode/dependence outcomes.

Внутри семейства Benjamini–Hochberg FDR 5%. Публикуются raw p, q, effect и cluster CI; значимость без breadth не делает candidate.

## 9. Candidate criteria

Диагностический mechanism может стать **ровно одним** будущим candidate только если одновременно:

1. economic identity показывает ненулевой вклад в отрицательный pooled meanR (для fee — deterministic contribution; для stop/entry/path — cluster CI эффекта не пересекает 0);
2. association использует feature, известную к confirmation;
3. BH `q <= 0.05` в своём семействе;
4. effect sign совпадает минимум в 60% estimable symbols и 60% independent series;
5. знак совпадает в early/middle/late folds и в leave-one-symbol-out sensitivity;
6. это не target/stop geometry proxy, не outcome leakage и не Vendor Shape;
7. механизм не требует unresolved episode/cooldown semantics;
8. заранее формулируется экономическая причинная связь, а не только корреляция.

Если кандидатов несколько, выбирается один по иерархии, зафиксированной **до результатов**:

1. entry timing/quality;
2. stop/adverse-path;
3. fee drag;
4. repeated-event dependence.

Внутри первого непустого класса — максимальная нижняя граница абсолютного cluster-CI эффекта; tie-break: выше symbol breadth, затем series breadth, затем лексикографическое имя feature. Никакой PnL победившей руки на этом этапе не считается.

## 10. План ровно одной отсечки

На текущем этапе отсечка **не выбирается** и не исполняется.

Если один candidate пройдёт §9 и для последующей admission-руки действительно нужна scalar cutoff, следующий freeze обязан создать ровно одну степень свободы:

- direction берётся только из preregistered economic mechanism;
- cutoff = deterministic empirical median (q=0.5, linear interpolation) feature по всем eligible **development-train events**, без labels/PnL;
- если feature не имеет содержательной label-free median semantics, допускается один train-only cutoff, выбранный по заранее заданному single objective и только из заранее перечисленных unique observed values; в этом случае никакой validation/holdout не читается до freeze;
- label-free median имеет приоритет; train-only вариант требует отдельного preregistration до исполнения;
- ровно один feature, один operator, один cutoff; никаких взаимодействий, subgroup thresholds, asset/TF/side cutoffs или PnL-grid.

Если candidate не сводится к одной идентифицируемой scalar cutoff без спорной семантики, verdict этапа — `DIAGNOSTIC_ONLY / NO_ARM`.

## 11. Integrity gates

Runner должен завершиться ошибкой до публикации результатов при любом из условий:

- hash S1 manifest/state machine/S1 runner/tests не совпал с freeze;
- S1 OOS reveal count не 0;
- прочитан raw path S1 untouched OOS;
- прочитан raw path ONDO/VIRTUAL;
- Vendor Shapes попали дальше parser discard boundary;
- изменены state machine, labels, entry, target, stop, collision order или 5 bps/side;
- встретился неизвестный timeframe/invalid manifest assignment;
- попытка сформировать PnL grid, alternate entry, stop sweep, episode merge или cutoff.

Output обязан содержать hashes входов/runner, точный inventory разрешённых файлов, forbidden-I/O audit и `designArtifactSha256`.

## 12. Следующий runner

Реализовать **только**:

`ci/research/runStatefulApexS4LossSourceDiagnostic.ts`

Он должен записать:

- `ci-results/stateful-apex-s4-loss-source-diagnostic.json` — полный machine-readable ledger/metrics/integrity audit;
- `ci-results/stateful-apex-s4-loss-source-diagnostic.md` — краткий отчёт без выбора торговой руки.

Runner не должен изменять `docs/HANDOFF.md`, `docs/ROADMAP.md`, `docs/strategies/zonda-reversal.md`, `docs/NEGATIVE-KNOWLEDGE.md`, `src/core/` или существующие S1–S3 artifacts.

## 13. Seals после design stage

- S1 untouched OOS: **SEALED, reveal=0**.
- S3 ONDO/VIRTUAL internal holdout: **BURNED, read/reuse for tuning=forbidden**.
- Vendor Shapes: **FORBIDDEN**.
- PnL-grid/cutoff selection: **NOT RUN**.
- Итоговый project verdict в docs: **UNCHANGED**.
