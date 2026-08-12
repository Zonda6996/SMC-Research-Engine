# План большой уборки и переписывания докуметации (WORKING DOC)

> **Статус:** временный рабочий документ. Удалить после завершения всех фаз.
> **Создан:** 2026-08-12. **Ветка:** `research/independent-reversal-edge`.
> **Зачем:** в репозитории накопилась куча устаревших файлов/результатов/отчётов;
> из-за них путаница (даже свежий разбор спотыкался о старьё). Последний push был
> давно. Нужна строгая очистка → потом ветки/коммиты → потом переписать SPEC и
> HANDOFF и задокументировать логику индикаторов от А до Я.
>
> Этот файл — точка возобновления: если чат сменится, отсюда можно продолжить.

---

## Как мы работаем (ПРОТОКОЛ — читать первым)
1. **Идём строго по порядку фаз.** Не перепрыгивать: сначала файлы, потом ветки/
   коммиты, потом переписывание доков.
2. **Разбор файлов — по одному / небольшими группами.** Для каждого спорного файла
   агент: (а) объясняет, что это за файл и зачем он был; (б) даёт рекомендацию
   (удалить / оставить / архивировать); (в) **спрашивает** — нужен или нет.
   Пользователь отвечает «удалять» / «оставить».
3. **Очевидный мусор** агент может удалять сам, **но обязан явно перечислить, что
   удалил** (список путей + причина) в том же ответе.
4. **Никаких удалений без отчёта.** После каждой партии — что удалено, что оставлено,
   что под вопросом.
5. **Незаменимые данные НЕ трогать** (см. «Красный список» ниже) — по ним даже не
   предлагать удаление без явного запроса пользователя.
6. Прогресс отмечать в этом файле (секция «Журнал»), чтобы новый чат подхватил.
7. Язык общения и доков — русский.

---

## Красный список (НЕ удалять / спросить с явным предупреждением)
Источник: `FINDINGS-GGI-REVERSE-ENGINEERING.md` §4 и `docs/HANDOFF.md` §9.
- `ci-results/fwd1-telegram-forward-audit.json` — ~660 forward-стрелок вендора с
  таймстампами. **Невоспроизводимо.**
- `data/vendor-exports/`, `data/vendor-export/` — канонический exact Reversal corpus,
  vendor CSV. Незаменимо.
- `ci-results/geo2-simulator-calibration.md` — измеренные геометрические константы
  со скринов симулятора. Невоспроизводимо.
- `ci-results/own2b-ablation.*`, `geo1-*` — цепочка доказательств.
- Калибровочные константы Apex/POI в `src/core/` (менять только по согласованию).
- `docs/LOOK-AHEAD-AUDIT.md` — свежая память по утечкам (нужна до переписывания SPEC).

Если сомнение — считаем файл спорным и спрашиваем.

---

## Фазы

### Фаза 1 — Строгая очистка файлов (ТЕКУЩАЯ)
Цель: убрать устаревшее/дубли/одноразовые скрипты, оставить только актуальное.
Подход: пройти по каталогам, составить карту (что это, статус, рекомендация),
затем удалять партиями по протоколу.

Кандидаты на разбор (каталоги с потенциальным мусором):
- `scratch/` — одноразовые аудиты (часть untracked).
- `ci-results/` — множество отчётов/JSON, много старых итераций (apex-anchors2..7 и т.п.).
- `outputs/` — отчёты-снимки по датам.
- `results/`, `screenshots/`, `ci-results/shots/` — артефакты прогонов.
- `temp/` — временные раннеры (`run-zonda-profitability-cycle.ts` и пр.).
- `ci/research/` — большой набор исследовательских раннеров (многие отработали).
- `scratch/auditStackSizeCausal.ts` — оставить до завершения разбора утечек (артефакт).

Definition of done: в дереве остались только актуальные для действующей стратегии
и активного research файлы; всё удалённое — перечислено в «Журнале».

### Фаза 2 — Ветки и коммиты
Цель: навести порядок в git (последний push давно).
Шаги (детализировать перед стартом): осмотреть локальные/удалённые ветки, статус
`research/independent-reversal-edge`, незакоммиченное; решить стратегию
(коммит очистки → push; при необходимости сжать/переименовать ветки). Ничего не
пушить без явного согласия.

### Фаза 3 — Переписать SPEC / HANDOFF + логика индикаторов А→Я
Цель: один источник истины без противоречий.
- Переписать `SPEC.md` и `docs/HANDOFF.md` под текущее реальное состояние.
- Единый документ «Логика индикаторов от А до Я»: Apex (ALMA-полосы), Zonda Reversal
  (OWN2-триггер), режимы Safe/Risk/Standard и их management, POI-зоны, что причинно
  и что нет, что доказано / отвергнуто / открыто.
- Свести отрицательное знание (V1–V7, look-ahead, stackShare) в один раздел.
- **ТРЕБОВАНИЕ К СТРУКТУРЕ ДОКОВ (от пользователя):** никаких простыней. Отдельные
  короткие структурные доки: (1) описание индикатора, (2) спецификация, (3) негативное
  знание, (4) хэндофф. Зашёл — сразу видно, что где. Плюс вторая чистка docs/ (сейчас
  много файлов «с кучей буковок»).
- Источники для распила в чистые доки: outputs/*.md (fable-sol = ядро логики сигнала;
  second-look + econ0 = негативное знание; g2-evidence = вердикт активной линии),
  FINDINGS-GGI-REVERSE-ENGINEERING.md (описание индикаторов + красный список),
  .workbuddy-ai/memory/*.md (нюансы), docs/LOOK-AHEAD-AUDIT.md (утечки).
- Удалить этот `CLEANUP-PLAN.md` по завершении.

---

## Текущее зафиксированное знание (чтобы не потерять при смене чата)
- **Причинно чисто:** Apex ALMA, ATR200 (RMA), relativeVolume, вход = next open,
  реплей (stop-first). Детали — `docs/LOOK-AHEAD-AUDIT.md`.
- **Утечка #1 (stackShare, end-of-history) — исправлена** в `scratch/auditStackSize.ts`
  и `src/core/analysis/ZondaEdgeFeatures.ts` (v0.2); поле в движке помечено ⚠️ UI-only.
  Ложный вывод в `docs/ARROW_FILTERS_SPEC.md` отозван.
- **Утечка #2 (pool.notional за всю жизнь пула) — НЕ исправлена**, задокументирована.
- **Визуализатор** торговой статистикой utечку не использовал (чисто).
- **Общий вердикт стратегии:** HOLD research / NO-GO production (см. HANDOFF).
- Известные pre-existing ошибки tsc: `scripts/auditReversalBenchmark.ts` (casing
  импорта + `meanNetR`) — не связаны с правками утечек.

---

## Журнал действий (дополнять по ходу)
- 2026-08-12: создан план. Уборка ещё НЕ начата (ждём старт пользователя).
- 2026-08-12 Партия 1:
  - Удалено `results/` целиком (6 CSV: evalentry-latest, evalentry-exits-latest, evalentry-fixedrr-latest, evalentry-freshness-latest, sweep-v2-latest, sweep-v3-latest) — регенерируемо, обратимо через git.
  - Удалено из `temp/` 17 файлов: 9 логов (*.log), fix-handoff-encoding.cjs, одноразовые аудиты (audit-arrow-runtime.ts/.json, audit-static-vs-dynamic.ts, static-vs-dynamic-audit.json, run-paired-exit-audit.ts, paired-exit-audit.json, paired-exit-key.txt) — необратимо (untracked).
  - Удалено из `screenshots/` 4 скрина нашего движка/баг-референсы (1h reversal SOL, m30 reversal SOL statistics, «здесь более мене адекватно 1h сигнал Reversal», «пример сигнала нашего (reversal)…») — необратимо.
  - ПРИДЕРЖАНО (жду явного «да»): temp/ frozen baseline (run-zonda-profitability-cycle.ts, summarize-zonda-cycle.cjs, zonda-profitability-cycle.json — HANDOFF §0) + вендорские выгрузки (ggi.xlsx, ggi_preview.csv, zonda_v1/v2.xlsx, v1_preview, v1_full_preview, v2_preview); screenshots/ вендорская доказательная база (m30 GGI (вендор) SOL statistics, 1h ggi SOL, пример вендорного сигнала). Рекомендация: baseline → ci-results/, вендор → data/vendor-exports/.
- 2026-08-12 Партия 2:
  - Удалено `screenshots/` целиком (7 файлов, включая 3 вендорских скрина) — по явному согласию, легко пересоздаются. Необратимо.
  - РЕШЕНИЕ по frozen baseline (temp/): НЕ удалять до Фазы 3 — регенерируется перепрогоном, но на его цифры ссылается HANDOFF §0; уберём осознанно при переписывании HANDOFF.
  - Удалено из `scratch/` 8 одноразовых аудит/дебаг-скриптов: analyzeFilterBreakdown, auditAllModes20k, auditBtc30m, auditExhaustion, auditMinRR, checkFilterModeServer, checkFixtureSignals, debugBtc15mSignals. Необратимо (untracked).
  - ОСТАВЛЕНО в scratch/: auditStackSize.ts (фикс утечки #1) + auditStackSizeCausal.ts (каузальный эталон) — держим до закрытия утечки #2. Имена не меняли (на них ссылаются доки).
- 2026-08-12 Партия 3:
  - `outputs/` (6 датированных отчётов 2026-08-06/07): НЕ трогаем — исходник для переписывания SPEC/HANDOFF в Фазе 3.
  - `ci-results/` (247 файлов: 149 md + 93 json): НЕ чистим сейчас — доказательная база + красный список (fwd1-*, geo2-simulator-calibration, own2b-ablation, geo1-*) + активная линия reversal-*/independent-reversal-* ветки research/independent-reversal-edge. Прунинг ПОСЛЕ Фазы 3.
  - `ci/research/`: удалён 21 one-off скрипт правок UI/обвязки (applyApexRename, applyDesignAndZoneFix, applyGlobalIndicatorPanel, applyIndicatorSettings, applySimplifiedTimeStop, browserQaAndFixToggles, enableSimplifiedTimeStopPreset, finalizeArchiveOiWiring, finishRedesign, fixAndApplySimplifiedTimeStop, fixApexPrimitiveThenApply, fixArchiveOiWiring, fixArchiveOiWiringTs, fixIndicatorIds, fixIndicatorTimeframes, fixLayerZoneTimeline, indicator-panel.css/.html, runApexRenameFixed, runApexRenameFixed2, wireArchiveOiHeatmap). Все tracked в git (обратимо). 112 -> 91.
  - ОСТАВЛЕНО в ci/research/: ~90 раннеров (run*/scan*/search*/audit*/analyze*/diagnose*) — слой воспроизводимости результатов ci-results/, разбираем в Фазе 3.
- 2026-08-12 Партия 4 (мусорный слой + .gitignore):
  - Удалено `tmp/` ВСЁ, КРОМЕ `tmp/forward/` (analysis/, funding-cache/, viz-archive-cache/, ofat-7.20/, user-results/, eval*.csv, smoke, smoke2). tracked, обратимо.
  - `tmp/forward/` ОСТАВЛЕНО: выхлоп `npm run forward` (tools/forward/forwardRunner.ts) — накопительный paper-forward журнал (~3 недели), не пересоздаётся задним числом. TODO: посчитать результат форварда.
  - Удалено `.tmp/` целиком (4 batch-csv, регенерируемо, tracked).
  - Удалено `tsc-out.txt`, `x.type`, `прошлый чат.txt` (мусор/чат-лог).
  - `.gitignore` += /tmp/, .tmp/, tsc-out.txt, x.type, `прошлый чат.txt`, .workbuddy-ai/, .github/.
  - `.workbuddy-ai/memory/*.md` (9 файлов) — ИСТОЧНИК для Фазы 3 (память ИИ, вытащить нюансы в SPEC/HANDOFF), затем удалить.
  - `data/` — КРАСНЫЙ СПИСОК, не трогаем. Пользователь сам почистил, оставил tg-сигналы. РЕШЕНИЕ по manifest.json: рекомендую ОСТАВИТЬ (каталог-описатель корпуса: символы/ТФ/rows/buy-sell/даты/sha256/роли dev|holdout). Вендорские CSV — регенерируемы ре-экспортом, можно игнорить (нужен git rm --cached, т.к. tracked). TODO: разобрать data/ отдельно.
  - `.github/workflows/research.yml` — CI, оставлен (tracked). Прим.: .gitignore на .github/ не развяжет уже отслеживаемый research.yml, только заблокирует новые файлы.
- 2026-08-12 Партия 5:
  - Пакетный менеджер = npm (нет node_modules/.pnpm, package-lock новее). Удалён `pnpm-lock.yaml` (git rm), `package-lock.json` оставлен.
  - Удалён `outputs/signal-arrows-visualizer-plan-2026-08-07.md` (untracked) — план визуализатора, уже реализован → устарел.
  - Удалён `zonda-profitability-cycle-summary.md` (untracked) — таблица baseline с прошлого состояния движка, регенерируема (summarize-zonda-cycle.cjs), вердикт уже в HANDOFF.
  - `outputs/` осталось 5 отчётов (fable-sol, second-look, econ0, g2-evidence, zonda-quick-scan) — ИСТОЧНИК для Фазы 3, не трогаем.
  - `scripts/auditReversalBenchmark.ts` — ОСТАВЛЕН: бенчмарк Reversal (baseline vs H1_APEX_CONTRACTION) на текущем движке; сломан мелочью (регистр импорта ArrowTradeReplay + поле meanNetR), починить в Фазе 3. `scripts/save-fixture.ts` — оставлен (генератор фикстур).
  - ХВОСТЫ Фазы 1 (на Фазу 3 / отдельно): консолидация папок (scripts→tools, scratch→ci/research, outputs после распила, temp→ci-results+data) с проверкой путей импортов; отвязка вендорских CSV в data/ от git (git rm --cached, оставить tg_topic_*.json + manifest.json).
- 2026-08-12 Фаза 2, Партия 6 (ветки):
  - Триаж 8 локальных веток сделан (read-only). Активная = research/independent-reversal-edge (0/0 vs origin, последний коммит 2026-08-07).
  - `git worktree prune` — убрана мёртвая регистрация worktree SMC-Research-Engine-redesign (папки нет на диске).
  - Удалены влитые в research: liquidity-improvements-v1, simplified-mode-v1 (-d). apex-reversal-v1 — влита в research HEAD, но не в свой origin (ahead 3), удалена через -D (контент в research есть).
  - Заархивированы тегами + удалены (-D): product/canonical-shadcn-ui (tag archive/product-canonical-shadcn-ui — исходный shadcn, research ушёл вперёд), backup/sol-econ0-before-fable-20260806 (tag archive/backup-sol-econ0-before-fable-20260806 — снимок перед fable, ВНУТРИ фикс данных 642ed4c + reversal evidence a011ec1), redesign/terminal-ui (tag archive/redesign-terminal-ui — заброшен, принят shadcn).
  - ОСТАЛОСЬ локально: main + research/independent-reversal-edge. Теги archive/* хранят удалённые ветки (восстановимо).
  - main НЕ тронут. Уникальные коммиты main: 72360b8 (ignore local cache — .cache уже в .gitignore research) + 4b184a4 (shadcn seed). TODO: примирить main (merge research → main) + push — отдельным осознанным шагом с согласия.
  - НИЧЕГО не пушилось.
- 2026-08-12 Фаза 2, Партия 7 (коммиты) — ПЛАН и СОСТОЯНИЕ (точка возобновления):
  - Рабочее дерево на момент старта коммитов: 136 изменений. Раскладка на осмысленные коммиты (локально, БЕЗ push):
    - A `chore(cleanup): remove obsolete research artifacts and lockfile` — удаления: results/*.csv (6), ci/research/ 21 one-off, tmp/** + .tmp/** (backtest-выхлоп), pnpm-lock.yaml; + правки .gitignore.
    - B `chore(data): drop re-exportable vendor CSVs, keep tg signals + manifest` — удаления data/vendor-exports/*.csv, incoming-2026-08/*, volume/*.json, vendor-export/, review-checklist. ОСТАЮТСЯ tg_topic_*.json + manifest.json.
    - C `docs: restructure — drop stale docs, add specs + cleanup plan` — удалены 9 старых доков (CONTEXT, CLAUDE-GGI-NEXT-DISCOVERY-PROMPT, EPISODE-AGE-HAZARD-SESSION-SUMMARY, GGI-RESEARCH-CONTINUATION, INDICATOR-RESEARCH-HANDOFF, REVERSAL-COORDINATED-NEXT-STEPS, ZONDA-INDICATOR-SPEC, archive/SPEC-legacy, docs/review-checklist.xlsx); добавлены docs/ARROW_FILTERS_SPEC.md, EDGE_HYPOTHESES.md, LOOK-AHEAD-AUDIT.md, CLEANUP-PLAN.md; изменены HANDOFF.md, DESIGN-SYSTEM.md, FINDINGS-GGI-REVERSE-ENGINEERING.md.
    - D `feat(signals): reversal arrow engine + leak #1 fix` — new src/core/signals/ArrowSignalEngine.ts, ArrowTradeReplay.ts; mod src/core/analysis/ZondaEdgeFeatures.ts, confirmation/LiquidityPoiCalibration.ts, signals/ReversalEpisodeResearch.ts; + scratch/auditStackSize.ts, auditStackSizeCausal.ts.
    - E `test: arrow engine/replay/parity + funding/tf-routing` — new tests/arrowResearchParity, arrowSignalEngine, arrowTradeReplay, visualizerSignalArrows; mod fundingFetcher.test, indicatorTimeframeRouting.test.
    - F `feat(viz): signal arrows + shadcn styling` — mod tools/visualizer/** (app.mjs, index.html, lib/api.mjs, lib/palette.mjs, panels/indicators.mjs, styles.css, server.ts) + tools/shared/candleFetcher.ts.
    - G `chore(research): reversal benchmark + runner updates` — new scripts/auditReversalBenchmark.ts (СЛОМАН: регистр импорта ArrowTradeReplay + meanNetR, чинить); mod ci/research/runOwn2ExtensionTrigger.ts, runZondaQuickProfitabilityScan.ts, ci-results/zonda-quick-profitability-scan.json, outputs/zonda-quick-profitability-scan-2026-08-07.md.
  - НЕ КОММИТИТСЯ и остаётся локально untracked: temp/ (frozen baseline + вендорские xlsx, держим до Фазы 3). .postman/, postman/, .workbuddy-ai/, tmp/forward/, .cache — в .gitignore.
  - ОСТАЛОСЬ В ФАЗЕ 2 (после коммитов): (1) примирить main — `git checkout main; git merge research/independent-reversal-edge` (main получит всю работу; его уникальные коммиты 72360b8 ignore-cache + 4b184a4 shadcn сохранятся; конфликтов не ждём). (2) PUSH — ТОЛЬКО с явного согласия пользователя: `git push origin research/independent-reversal-edge` и `git push origin main` (+ по желанию `git push origin --tags` для archive/*). Последний push был 2026-08-07.
  - ФАЗА 3 (следующая): переписать доки СТРУКТУРНО (см. секцию Фаза 3), вторая чистка docs/, распил outputs/*.md + FINDINGS + .workbuddy-ai/memory в чистые доки, консолидация папок (scripts→tools, scratch→ci/research, temp→ci-results+data, outputs после распила), отвязка вендорских CSV от git при необходимости, починка scripts/auditReversalBenchmark.ts, разбор ci-results/ (247) и ci/research/ (~90 раннеров), закрытие утечки #2, посчитать forward (tmp/forward, ~3 недели).
