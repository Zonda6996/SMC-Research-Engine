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
- `ci/research/auditStackSizeCausal.ts` (перенесён из `scratch/` 2026-08-13) — оставить до завершения разбора утечек (артефакт).

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
- 2026-08-12 Фаза 2, Партия 7 — ВЫПОЛНЕНО: 7 коммитов A→G созданы на research/independent-reversal-edge (ahead 7 vs origin, push НЕ делали):
  - cb72f9e chore(cleanup): remove obsolete research artifacts, backtest outputs, pnpm lockfile
  - a5b2b8a chore(data): drop re-exportable vendor CSVs, keep tg signals + manifest
  - 531f290 docs: restructure - remove stale docs, add specs + cleanup plan
  - b9794d8 feat(signals): reversal arrow engine + stackShare leak #1 fix
  - 059dcbf test: arrow engine/replay/parity + funding, tf-routing
  - 30d2597 feat(viz): signal arrows indicator + shadcn styling
  - cedc5d6 chore(research): reversal benchmark script + runner/report updates
  - Рабочее дерево чистое, кроме untracked temp/ (frozen baseline + вендорские xlsx — держим до Фазы 3).
  - ОСТАЛОСЬ: примирить main (merge research->main) + PUSH (только с явного согласия).
- 2026-08-12 Фаза 2, Партия 8 — ЗАВЕРШЕНА:
  - Журнальный коммит 120ce31 (+запись A-G). main примирён merge-коммитом e519c3c: 6 конфликтов (наследие shadcn-seed) разрешены — .gitignore объединён (обе записи кэша + tmp/funding-cache/), DESIGN-SYSTEM.md/app.mjs/index.html/zones.mjs/styles.css взяты из research. Деревья main==research с точностью до строки /.cache/.
  - PUSH ВЫПОЛНЕН (с согласия пользователя): main (72360b8..e519c3c), теги archive/* (3 шт.), затем research. research отклонялся из-за CI-коммита origin (research.yml auto-commit "ci(gate): results [skip ci]") — забран merge, повторный push прошёл. Обе ветки синхронизированы с origin (учтены последующие CI gate-коммиты 2d8769f/8cd5ba9). ФАЗА 2 ЗАКРЫТА.
- 2026-08-12 Фаза 3 — СОГЛАСОВАННАЯ АРХИТЕКТУРА ДОКОВ (решения пользователя):
  - ПРИЧИНА деградации SPEC.md: смешаны стабильная «конституция» и волатильный research-лог (§16.1..16.x до бесконечности). Лечение — разделение слоёв. Research-итерации/QA БОЛЬШЕ НЕ живут в спеке: артефакты → outputs/ + ci-results/, выводы → NEGATIVE-KNOWLEDGE.
  - Приоритет пользователя: Zonda Reversal + Apex (активная линия). Остальные подсистемы ЖИВЫЕ, но сейчас НЕ трогаются → им короткие справки-спеки, не глубокие.
  - Целевая структура:
    - `AGENTS.md` (корень) — конституция: главное правило (не придумывать правила анализа; не чинить баги молча; не уверен — спроси) + тех-ограничения (strict TS, tsc не гарантия, верификация тестами) + как запускать/тестировать + КАРТА ДОКОВ. Источник — §1–2 легаси-спеки (docs/archive/SPEC-legacy-2026-07-21.md). Подтверждено пользователем.
    - `docs/ARCHITECTURE.md` — движок/платформа: пайплайн данных, структура папок, реестр модулей (Pivot/Swing/Structure BOS-CHoCH, Fibonacci, POI/liquidity, Apex, confirmation). Источник — §3–5 легаси. Меняется редко.
    - `docs/INDICATOR.md` — логика индикаторов/сигналов А→Я (Apex ALMA + Zonda Reversal OWN2, геометрия, режимы Safe/Risk/Standard, динамические тейки, почему нет б/у, POI). КРИТИЧНА КОРРЕКТНОСТЬ: каждое правило подтверждать по коду (ApexEngine/ArrowSignalEngine/ArrowTradeReplay), спорные места помечать «⚠ подтверди» и давать на вычитку. Меняется редко.
    - `docs/strategies/zonda-reversal.md` — ПОЛНАЯ спека активной стратегии (правила, параметры, статус). baseline-таблицы живут ЗДЕСЬ, не в HANDOFF.
    - `docs/strategies/fibonacci.md`, `docs/strategies/poi-confirmation.md` — КОРОТКИЕ справки-спеки (живые, но замороженные по приоритету).
    - `docs/NEGATIVE-KNOWLEDGE.md` — отвергнутое + утечки (#1 fixed, #2 open, V1–V7, stackShare-артефакт, динамич. цели, инвертир. GGI, «зон меньше→WR» и т.д.).
    - `docs/HANDOFF.md` — ТОЩИЙ восстановитель контекста: что сейчас в работе, активная линия, следующий шаг, указатели. БЕЗ таблиц результатов. Вердикт одной строкой + ссылка. Красный список — секцией здесь.
    - `docs/DESIGN-SYSTEM.md` — оставляем (UI).
    - `docs/archive/` — легаси-спека (3115) + текущий лог SPEC.md §16.x держим ЧИТАЕМЫМИ файлами (подтверждено). Полезные решения дистиллируем, сырой лог остаётся в архиве.
  - У каждого дока — шапка «как вести этот док + частота изменений» (ответ на «что можно/нельзя менять»).
  - FINDINGS-GGI-REVERSE-ENGINEERING.md — ОСТАВИТЬ (канонический протокол реверс-инжиниринга + красный список), распилить описательную часть в INDICATOR.
  - Порядок: ARCHITECTURE → AGENTS → INDICATOR → strategies → NEGATIVE → HANDOFF → архивирование SPEC → чистка распиленных доков (ARROW_FILTERS_SPEC, EDGE_HYPOTHESES, LOOK-AHEAD-AUDIT) + outputs/ + .workbuddy-ai/memory → хвосты Фазы 1 (temp/, консолидация папок) → коммит/push → удалить CLEANUP-PLAN последним.
  - Источник легаси для копирования правил: git 531f290~1:docs/archive/SPEC-legacy-2026-07-21.md.
- 2026-08-12 Фаза 3, Партия 9 — СОЗДАНЫ ДОКИ (6 из 8 по плану):
  - AGENTS.md (корень) — конституция (§1–2 легаси + карта доков + правило «спеки=текущее состояние, research→outputs/ci-results»).
  - docs/ARCHITECTURE.md — 2 слоя (базовый SMC / Apex-сигнальный), пайплайн, структура папок, реестр модулей (из реального src/ + легаси §5). Base-слой описан как заморожен.
  - docs/INDICATOR.md — Apex ALMA + OWN2-триггер + геометрия/реплей + режимы + динамич. тейки + «почему нет БУ». СВЕРЕНО С КОДОМ. 4 неоднозначности разобраны (см. ниже).
  - docs/strategies/zonda-reversal.md — активная линия: runtime, universe/costs/split, baseline (OOS Safe -0.063/Risk -0.016/Standard +0.017), breadth, H1 Risk кандидат, вердикт HOLD/NO-GO, следующий шаг (H1 Risk → paper-forward 200 trades).
  - docs/strategies/fibonacci.md — заморож. справка по BATTLE_CONFIG (canon deep 38.2/15/61.8, ote 78.6/61.8/100, first-5 gate, cost gate 1.75R, сайзинг, mirror=shadow).
  - docs/strategies/poi-confirmation.md — заморож. справка (heatmap→зоны near/far lifecycle, гео-касание, simplified/refined; stackShare=UI-only).
  - ОТВЕТЫ АВТОРА по 4 неоднозначностям INDICATOR: (1) relVol — автор не помнит; РАЗОБРАНО ПО КОДУ: движок state-free (дефолт 0.0), канон 1.4 задаётся в runOwn2ExtensionTrigger.ts (VOL_MIN=1.4) + IndependentReversalG2Protocol.extensionRelativeVolumeMin=1.4. (2) distance — оставить адаптивным, пометить что был фикс. 3%. (3) два детектора — активный OWN2, detectReversals исторический. (4) БУ — стоп не переносится/не трейлится (подтверждено).
  - НАХОДКИ (по правилу «показать, не молчать»): (A) HANDOFF §4 описывает механику БУ (закрытие остатка по averageEntry), которой НЕТ в текущем ArrowTradeReplay.ts — устаревший текст, при переписывании HANDOFF не тащить, код=истина. (B) battleConfig.ts относится к Fibonacci-стратегии, НЕ к Zonda Reversal — учтено в раскладке доков.
  - ОСТАЛОСЬ: NEGATIVE-KNOWLEDGE, тощий HANDOFF, архив SPEC §16.x, чистка распиленных (ARROW_FILTERS_SPEC/EDGE_HYPOTHESES/LOOK-AHEAD-AUDIT/outputs/memory), хвосты Фазы 1 (temp/), коммит+push, удалить CLEANUP-PLAN.
- 2026-08-12 Фаза 3, Партия 10 — ДОКИ ЗАВЕРШЕНЫ + АРХИВ + ЧИСТКА + temp/:
  - Созданы docs/NEGATIVE-KNOWLEDGE.md (утечки #1 fixed/#2 open, viz-clean, V1–V7, exact-bar limit, FROZEN/IMP2, BREADTH1, отвергнутое из SPEC, методграбли) и переписан docs/HANDOFF.md (ТОЩИЙ: фокус, вердикт 1 строкой, следующий шаг H1 Risk, хвосты, карта «куда смотреть», команды, красный список; старое описание БУ НЕ перенесено).
  - АРХИВ: git mv SPEC.md → docs/archive/SPEC-2026-08-12.md (полный лог §16.x, читаемый); восстановлена docs/archive/SPEC-legacy-2026-07-21.md (git checkout 531f290~1, точные байты). Обе — только чтение.
  - УДАЛЕНО (git rm, распилено в новые доки; обратимо через git): docs/ARROW_FILTERS_SPEC.md, docs/EDGE_HYPOTHESES.md, docs/LOOK-AHEAD-AUDIT.md; outputs/*.md (5: ggi-econ0-final, ggi-fable-sol, ggi-independent-reversal-second-look, independent-reversal-g2-evidence-audit, zonda-quick-profitability-scan). outputs/ теперь пуст.
  - .workbuddy-ai/memory/*.md — НЕ удалял и НЕ вычитывал: gitignored (в коммит не попадёт), доки распилены из первичных источников (HANDOFF/SPEC/аудит). Мину́ть память отдельно при желании.
  - temp/ РАСФОРМИРОВАНА (untracked): baseline (run-zonda-profitability-cycle.ts, summarize-zonda-cycle.cjs, zonda-profitability-cycle.json) → ci-results/ (git add, tracked); вендор (ggi.xlsx, ggi_preview.csv, zonda_v1/v2.xlsx, v1_full_preview/v1_preview/v2_preview.csv) → data/vendor-exports/ (оставлены UNTRACKED — единый локальный дом вендорских выгрузок, без раздувания репо; если нужны в git — отдельное решение). temp/ удалена.
  - CLEANUP-PLAN.md НЕ удаляю сейчас: остаются незакрытые хвосты (ниже). Удалить последним, когда закроются.
  - ОСТАВШИЕСЯ ХВОСТЫ (перенесены и в docs/HANDOFF «Открытые технические хвосты»): утечка #2; починка scripts/auditReversalBenchmark.ts; посчитать tmp/forward (~3 недели); прунинг ci-results/ (247) и раннеров ci/research/ (~90); консолидация папок (scripts→tools, scratch→ci/research) с проверкой импортов + tsc; при желании — вычитка .workbuddy-ai/memory и отвязка вендорских выгрузок/трекинг.
- 2026-08-13 Фаза 3, Партия 11 — forward + прунинг + консолидация (текущая сессия):
  - tmp/forward ПОСЧИТАН (Fib/BATTLE_CONFIG battle-7.53-cost175-v5): live 20–29 июля n=107 mean +0.175R WR 62.6%; frozen-config OOS 30 июля–13 авг n=568 mean +0.009R WR 56.2%. Вывод: edge не подтверждён на OOS, стабилен только 1h. Детали в HANDOFF.
  - ПРУНИНГ Партия 1 (UI/QA, git rm, обратимо): ci-results/chart-restore-qa, confirmation-close-qa, marker-tf-qa, shots, tf-routing-e2e + design-zone-fix.md + current-zone-trade-sort.md = 20 файлов (268→248). Проверено: нет ссылок из tests/src/актуальных docs (только раннеры-генераторы). tsc чист, тесты 503/505 (2 падения — pre-existing, отсутствует data/vendor-exports/bybit-btcusdt-perp-15m.csv, не связано с прунингом).
  - ПРИДЕРЖАНО до решения автора: apex-rename.md, archive-oi-wiring.md, geo-probe.md, gate.md (Apex/OI/CI-смежные); остальные партии прунинга (Apex-anchors, orphan-очередь, legacy independent-reversal).
  - КОНСОЛИДАЦИЯ (git mv): scripts/auditReversalBenchmark.ts, scripts/save-fixture.ts → tools/research/; scratch/auditStackSize.ts, scratch/auditStackSizeCausal.ts → ci/research/. Импорты переписаны под новую глубину, tsc чист. scripts/ и scratch/ удалены.
  - auditReversalBenchmark ПОДТВЕРЖДЁН починенным (tsc чист) — пометка «сломан» в доках снята.
  - НЕ коммитили и НЕ пушили. Остаток Фазы 2: примирение main + push — только с согласия.
- 2026-08-13 Фаза 3, Партия 12 — прунинг Apex-anchors / orphan / legacy independent-reversal (по согласованию с автором: аккуратно, полезное для ИИ — не удалять, а АРХИВИРОВАТЬ). Заведены папки-архивы `ci/research/archive/` (раннеры) и `ci-results/archive/` (результаты).
  - УДАЛЕНО (git rm, обратимо, 24 файла):
    - A1 (apex-anchors v1–v6, superseded канонической цепочкой apex-exact-export-cross-tf-fit → apex-sigma-oos → tests/apexOosRegression): ci/research/apexAnchors{,2,3,4,5,6}.ts + ci-results/apex-anchors.{md,json}, apex-anchors2.{md,json}, apex-anchors{3,4,5,6}.md.
    - B1 (orphan): ci-results/apex-rename.md, ci-results/archive-oi-wiring.md (короткие отчёты завершённых задач); ci/research/runZonePanQaWithFixture.ts, runZonePanQaWithFixture2.ts, sortCurrentZoneTrades.ts (одноразовые self-modifying/migration раннеры, их UI-артефакты уже удалены в Партии 11).
    - C1 (тяжёлый регенерируемый G1 fit-output): ci-results/independent-reversal-fit-{btc,eth,sol,xrp}-15m.json + independent-reversal-fit-aggregate.json.
  - ЗААРХИВИРОВАНО (git mv, провенанс/отрицательное знание — держим читаемым для ИИ):
    - A2 → ci/research/archive/: apexAnchors7.ts (финальная 14-anchor cross-symbol проверка — ближайший провенанс канонных констант), apexUserAnchor20260727.ts (ручные TV-якоря, невосстановимы из биржи); → ci-results/archive/: apex-user-anchor-2026-07-27.{md,json}.
    - B2 → ci/research/archive/: fullTakeTimeStopE2e.ts, fullTakeTimeSweep.ts (историч. POI time-stop эксперименты), runReversalV7RollingExtremum.ts (часть отрицательного знания V7′, final намеренно не открывался).
    - C2 → ci-results/archive/: independent-reversal-fit-verdict.md (отрицательный вердикт G1).
  - ИМПОРТЫ перенесённых раннеров поправлены под новую глубину (../../ → ../../../ в apexUserAnchor20260727.ts; ./config, ./lib → ../config, ../lib в runReversalV7RollingExtremum.ts). Остальные три переносимых раннера используют CWD-относительные пути/только node — правки не требовали.
  - НАХОДКА (правило «показать, не молчать»): C2-preregistration НЕЛЬЗЯ было архивировать — на них ссылается ЖИВОЙ тест tests/independentReversalProtocol.test.ts (читает ci-results/independent-reversal-preregistration.json/.md + проверяет их mtime ≤ mtime раннера). Первичная архивация уронила 2 теста; ОТКАЧЕНО — independent-reversal-preregistration.{json,md} ОСТАВЛЕНЫ на месте в ci-results/. Вывод: слой G1 evidence связан с активными G1-тестами (C3) — архивировать G1 preregistration только вместе с ретайрингом G1-кода/тестов, отдельным атомарным шагом.
  - ОСТАВЛЕНО НЕ ТРОНУТЫМ: A3 (каноническая apex-цепочка + tests/apexOosRegression), B3 (geo-probe.md, gate.md — генерируются CI; auditStackSize*, config/, lib/ — импортируются), C3 (весь G1-код + тесты, ещё в package scripts/G2-ablation), C4 (весь G2 — активный OWN2/H1-контекст).
  - ПРОВЕРКА: `npx tsc --noEmit` чист; `npm test` = 505 tests, 503 pass, 2 fail — ровно pre-existing (отсутствует vendor-CSV, к прунингу не относятся). Новых падений нет.
  - НЕ коммитили и НЕ пушили.
