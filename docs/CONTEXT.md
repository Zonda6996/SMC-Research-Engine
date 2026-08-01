# Контекст SMC Research Engine

**Обновлено:** 2026-08-01

**Статус:** исследовательская платформа; не готовая торговая система и не доказанный edge.

Этот файл — короткая карта входа. Для реконструкции индикаторов сначала читать `docs/INDICATOR-RESEARCH-HANDOFF.md`; для действующей системы — `SPEC.md`; для интерфейса — `docs/DESIGN-SYSTEM.md`.

## 1. Репозиторий и ветки

- `main` — интегрированная, проверенная версия продукта и canonical visualizer.
- `research/apex-reversal-handoff` — отдельная ветка с black-box исследованиями, exact TradingView exports, экспериментальными моделями и handoff для нового исследователя.
- Работу с новой гипотезой начинать от отдельной `research/*` ветки; не смешивать UI, production и research в один коммит.
- Перед работой: `git fetch --prune`, проверить текущую ветку, `git status`, последние коммиты и diff.

## 2. Правила доказательности

1. Сначала факт из данных/кода, затем интерпретация.
2. Не менять production-значения или `detectReversals()` по одному скриншоту, одной монете или визуальной похожести.
3. Каждая новая модель обязана быть каузальной: на баре `i` используются только данные `<= i`; запрещены future pivot labels, future outcomes и post-hoc universe selection.
4. Для стратегии: комиссии, adverse same-bar ordering, time split, asset/TF holdout, проверки устойчивости без лучшего 1% сделок.
5. Для vendor fidelity: точное/±1-bar event matching, precision, recall, direction, count ratio и разрезы по datasets. Это не доказательство торговой прибыльности.
6. Новые файлы: код + тест + machine-readable JSON/CSV + краткий Markdown-вывод. Коммиты: research, production, UI и docs раздельно.

## 3. Быстрые команды

```bash
npm test
npx tsc --noEmit
node --check tools/visualizer/public/*.mjs tools/visualizer/public/{lib,panels}/*.mjs
npm run research:integrity
npm run viz
```

`research:integrity` проверяет SHA-256, схему, chronology, counts exact CSV и OOS-регрессию Apex. Не запускать массовый гиперпараметрический поиск до формулирования гипотезы и отбора development/holdout.

## 4. Карта кода

```text
src/core/signals/ApexEngine.ts              Apex production approximation + minimal Reversal baseline
src/core/signals/Reversal*Research.ts       rejected research-only causal detector families
src/core/analysis/ZondaEdgeFeatures.ts      causal feature snapshot; research-only
ci/research/lib/exactIndicatorExport.ts     exact CSV parser, hash/chronology/band validation
ci/research/lib/eventMetrics.ts             one-to-one directional event matching
ci/research/config/reversalDatasets.ts      development/holdout and chronological splits
data/vendor-exports/                        six canonical original-indicator exports + manifest + volume alignment
ci-results/README.md                        index of canonical results and reproduction commands
docs/INDICATOR-RESEARCH-HANDOFF.md          full handoff for Apex/Reversal research
tools/visualizer/                           local inspection interface, not a trading executor
```

## 5. UI policy

The only supported skin is the dark shadcn/Vercel/Geist classic visualizer. Do not introduce a terminal/TradingView skin, duplicate DOM ids, inline layout styling, or server recomputes on visual-only controls. See `docs/DESIGN-SYSTEM.md`.

## 6. Communication and safety of conclusions

Work in Russian with direct, numerical conclusions when speaking to the project owner. Distinguish confirmed result, candidate, negative result and hypothesis. A failed reconstruction is useful evidence; do not disguise it as a weak success.
