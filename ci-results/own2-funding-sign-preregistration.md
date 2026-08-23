# Immutable preregistration — OWN2 + funding-sign filter

**Статус фиксации:** FROZEN BEFORE OOS REVEAL. Этот документ создан до чтения каких-либо результатов нового OOS-прогона. Если coverage-аудит не подтвердит сопоставимый причинный funding для замороженного корпуса, reveal запрещён, а итог автоматически `INCONCLUSIVE DATA`.

## 1. Проверяемая гипотеза

Baseline — текущий канонический OWN2. Filtered — строгое подмножество тех же baseline candidate events:
- LONG допускается только если последнее причинно доступное **settled funding < 0**;
- SHORT допускается только если последнее причинно доступное **settled funding > 0**;
- funding = 0 или отсутствует — veto/no trade.

Запрещены magnitude thresholds, z-score, окна, ретюн, отбор symbol/side/timeframe и любые rescue-подгруппы после reveal.

## 2. Замороженный baseline

- Apex: `apex-1.2-cross-oos-sigma-4`; `source=hlc3`, ALMA mean 200/0.85/6, dispersion 122/0.625/4, `kInner=5.6`, `kOuter=9.6`.
- OWN2: `signal-arrows-1.0-own2-extension`; `relativeVolumePeriod=20`, `minimumRelativeVolume=1.4`, адаптивный distance gate `min(3,max(0.15,s*100*0.8))`, `minimumPenetrationInner=-0.35`, directional candle, correct side of Mean; entry = next-bar open.
- Primary execution/management: канонический `safe`: `stepDivisor=1`, `stopSteps=2`, `dynamic-partial`, `partialFraction=0.25`, add enabled, moving partial at Mean, moving full target at opposite Inner, fixed stop, conservative intrabar order `add→stop→partial→full`, `maxHoldingBars=2000`.
- Candidate events формируются один раз baseline-логикой. Filtered не генерирует новых событий и не меняет replay; vetoed opportunity получает нулевую экспозицию в opportunity-метрике.
- Costs: 5 bps на исполненную сторону. Gross 0 bps — только диагностика.
- Funding cashflows: для обеих рук одинаково, direction-aware, по каждому settlement, который позиция реально пересекает: long платит положительный rate и получает отрицательный; short наоборот. Funding не начисляется vetoed opportunity.

## 3. Замороженный OOS-корпус и integrity gate

Предпочтительный one-time OOS — только `untouched-oos` из `ci-results/stateful-apex-s1-manifest.json`, reveal count до этой фиксации заявлен как 0. Замороженные записи:
- AVAXUSDT spot 5m;
- AVAXUSDT futures 1h;
- LINKUSDT spot 15m и 1h;
- SOLUSDT spot 2h.

Funding-sign эксперимент требует совпадения market/symbol/time span с реальным perpetual funding. Spot-series нельзя молча превращать в futures-series и нельзя считать, что spot outcome эквивалентен perpetual outcome. До reveal обязателен coverage-аудит.

**Integrity/coverage PASS только если одновременно:**
1. S1 manifest по-прежнему показывает `untouchedOosMetricsInspected=false` и нет артефакта reveal с метриками этого split;
2. исходные candle-файлы совпадают с frozen SHA-256 из S1 manifest;
3. каждая включённая серия является futures/perpetual и имеет официальный settled funding для того же symbol и полного интервала candidate entries/exits;
4. минимум 3 независимых symbols доступны без подмены корпуса;
5. для каждого решения as-of используется settlement с `settlementTimestamp < decision/entryTimestamp` (строгое неравенство); settlement на точной границе не доступен;
6. отсутствующие ставки не интерполируются и не создаются forward-fill-события; допустимо лишь взять последнее реально опубликованное settlement и отдельно измерить его возраст;
7. после фильтра остаётся минимум 100 trades, а baseline содержит минимум 250 OOS opportunities.

Если любой пункт 1–6 не выполнен, OOS outcomes не читаются и итог = `INCONCLUSIVE DATA`. Пункт 7 проверяется только после допустимого one-time reveal; нехватка N также даёт `INCONCLUSIVE DATA`.

## 4. Primary metrics и paired design

На одной и той же таблице baseline opportunities:
1. **Primary:** paired delta net expectancy per baseline opportunity = `filteredNetOrZero - baselineNet`.
2. Mean net per executed trade — отдельно для baseline и retained filtered trades.
3. Total и mean net per baseline opportunity, где veto = 0 exposure.
4. Vetoed group — только диагностика, не источник ретюна.

## 5. Bootstrap и breadth

- 10 000 resamples; fixed seed `25082026`.
- Joint block/cluster bootstrap по UTC calendar day candidate-decision time: выбранный день переносит совместно все symbols/timeframes и paired baseline/filtered values.
- CI95 percentile.
- Breadth: знак paired improvement per baseline opportunity по independent symbol; дополнительно по timeframe и side без права исключать плохие группы.

## 6. Frozen gates

`GO` только если одновременно:
- CI95 primary paired delta per baseline opportunity lower > 0;
- filtered net expectancy per executed trade > 0;
- positive paired breadth минимум 2/3 доступных независимых symbols;
- baseline OOS opportunities >= 250;
- retained filtered trades >= 100.

Если integrity/coverage или минимальный размер недоступны — `INCONCLUSIVE DATA`. Во всех остальных случаях — `KILL`.

## 7. Secondary diagnostics

Retained rate, PF, WR, max DD, gross/net, funding contribution, long/short, symbol/timeframe breadth, concentration, latest-rate age distribution, missing/zero coverage. Sensitivity разрешена только как label-free audit причинности/coverage, без поиска альтернативного торгового правила. Recall vendor shapes не сравнивается с trading expectancy.

## 8. Frozen provenance hashes at registration

Git HEAD: `0a5085cacc0f2dfe754ada867c5782504703f2f1`; working tree already dirty before this experiment, поэтому фиксируются file-level hashes и новые файлы эксперимента не должны перетирать существующие изменения.

- `src/core/signals/ApexEngine.ts`: `0857b29aef879a3de56641f4a49cf405ffad8226df19f6e24e8ab91597cb2af7`
- `src/core/signals/ArrowSignalEngine.ts`: `9d53614d2068ffc3db3bd52cfc9e6b03c06cc49684c459b5e3408a3933218217`
- `src/core/signals/ArrowTradeReplay.ts`: `5b74d0a0d4d3b0ebb07859b6879295264d6c4e1e2f231b33a1335b71f7fe5fc2`
- `ci-results/stateful-apex-s1-manifest.json`: `1eafaf72b8a5efd571a680e497f90c1416bd346eae543857c891a87d6bbb30ba`
- `tools/shared/fundingFetcher.ts`: `6750ec5aafdf98c3f89810e54e89298ddf8885fe2de1901fdde357b13569f034`

Этот preregistration не разрешает использовать уже раскрытые ONDO/VIRTUAL internal holdout, S4 ZEC/1000PEPE/BOME holdout, funding-only OOS outcomes или vendor-shape outcomes как новый clean OOS для OWN2 funding-sign.
