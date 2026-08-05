# Claude Fable 5 — следующий независимый GGI discovery audit

Скопируй основной текст ниже в существующий чат Claude, где уже велось исследование. Claude должен иметь доступ к GitHub-репозиторию `SMC-Research-Engine` и новой ветке, созданной от актуальной GGI research-ветки.

---

Ты продолжаешь независимое исследование реального приватного TradingView-индикатора **GGI Buy/Sell**. Пользователь имеет доступ к индикатору и exact TradingView CSV. Не начинай с нуля, не возвращайся к отвергнутому independent G1 как к модели GGI и не повторяй уже выполненные grid-search без нового различающего наблюдения.

## Главная цель

Найти **новое причинное и проверяемое улучшение** нашей модели GGI, которое существенно продвинет хотя бы одну из двух целей:

1. **Trading usefulness:** улучшить честную, переносимую модель 2h GGI management/expectancy;
2. **Vendor fidelity:** объяснить неизвестную часть private Safe stop, BE execution или stateful Standard gate.

Если доступные observable series не позволяют идентифицировать новый механизм, не выдумывай его. Докажи неидентифицируемость и сформулируй минимальный новый information set, который действительно различает оставшиеся гипотезы.

## Сначала восстанови весь текущий контекст

Читай в таком порядке:

1. `docs/GGI-RESEARCH-CONTINUATION.md` — главный актуальный handoff;
2. `ci-results/ggi-go-no-go-verdict-v1.md`;
3. `ci-results/ggi-state-machine-fidelity-v1.md` и `.json`;
4. `ci-results/ggi-corrected-gross-audit-v2.md` и `.json`;
5. `ci-results/ggi-safe-stop-modifier-audit-v1.md` и `.json`;
6. `ci-results/ggi-anti-repaint-collection-protocol-v1.md`;
7. `ci-results/ggi-validation-v2.md` и `.json`;
8. `ci-results/ggi-signal-first-audit-v1.md` и `.json`;
9. `ci-results/ggi-multi-asset-holdout-v1.md` и `.json` только как historical audit; его старые Full/BE semantics заменены corrected v2;
10. `ci/research/lib/exactIndicatorExport.ts`;
11. `ci/research/lib/ggiCorrectedReplay.ts`;
12. `ci/research/runGgiStateMachineFidelityV1.ts`;
13. `ci/research/runGgiCorrectedGrossAuditV2.ts`;
14. `ci/research/runGgiSafeStopModifierAuditV1.ts`;
15. `ci/research/compareGgiExportSnapshots.ts`;
16. `tests/ggiGrossReplay.test.ts` и `tests/ggiSnapshotDiff.test.ts`.

Не проси пользователя пересказывать исследование до чтения этих файлов.

## Подтверждённые факты, которые нельзя заново оспаривать без прямого контрдоказательства

### Export и labels

```text
Shape 0 = BUY
Shape 1 = SELL
Safe и Risk используют общие BUY/SELL Shapes
```

Пока позиция активна, следующая common Shape не появляется. Это gating уже встроено в export. Второй sequential/non-overlap filter ошибочен: на BTC 15m он сокращает 85 dashboard trades до 64.

### Dashboard accounting

```text
Trades = Partial + Stop + Full fix
Winrate = (Partial + Full fix) / Trades
```

### Terminal semantics

На BTC 15m получено точное совпадение:

```text
Dashboard: 85 Trades / 24 Partial / 17 Stop / 44 Full
Replay:    85 Trades / 24 Partial / 17 Stop / 44 Full

Entry:   next-bar open
Partial: wick touch moving Mean
Full:    candle close beyond moving opposite Inner
Stop:    adverse wick, stop-first
```

Прежний Full-by-wick давал `20 Partial / 17 Stop / 48 Full`. Ровно четыре сделки касались Inner тенью без close-confirmation, а позже завершались Partial.

### Safe/Risk/add

```text
RiskDistance ≈ 0.694 × SafeDistance
Add ≈ midpoint(Entry, Stop)
average после равного 50/50 add = (Entry + Add) / 2
```

Эти отношения независимо подтвердились на нескольких активах, направлениях и timeframe.

### BE

Пользователь подтвердил: после Partial позиция переводится в BE. Но наивные OHLC-варианты same-bar/next-bar BE на initial entry или blended average не воспроизводят dashboard: они превращают слишком много реальных Full в Partial.

Это не опровергает реальный BE. Неизвестны execution timing, confirmed state, lower-timeframe path и dashboard classification.

### Safe stop

Первый кандидат:

```text
SafeDistance ≈ 12.3 × SMA(TrueRange,55)
```

прошёл только четыре development observations и провалил независимый batch с ошибками до `+33.6%`.

Затем проверены десять causal scalar modifiers. Лучший:

```text
SafeDistance = ATR55 ×
  (12.666599 - 0.076980 × directionalMeanGapAtr55)
```

улучшил validation MAE только на `3.12%`. Статус: `candidate_not_validated`. Не выдавай ATR55 или этот modifier за private formula и не продолжай свободный перебор periods/features на той же выборке.

### Profitability

Corrected v2 использует common Shapes, Full-by-close, Partial-by-wick, stop-first, three BE bounds, Safe envelope `8/10/12/14/16 × TR55`, Risk `0.694 × Safe`, no-add/50-50 midpoint add и costs `0/3/6/10 bps` на каждый actual one-way fill.

Центральный 2h Safe 12 no-add holdout:

```text
517 trades
mean gross +0.0669R
PF 1.759
после 6 bps/fill +0.0615R
PF net 1.660
break-even one-way cost ≈ 68.6 bps
ETH/SOL/XRP/AAVE/BNB 2h — все положительны
```

1h:

```text
+0.0013R gross, PF 1.046
-0.0057R после 6 bps, PF 0.950
```

5m central corrected proxy:

```text
-0.0091R gross, PF 0.929
```

Текущий verdict:

```text
2h Safe no-add: conditional GO только для forward validation
1h: no universal GO
5m/3m/1m: no-go при текущей reconstruction/costs
exact GGI replica: not achieved
```

Положительный 2h результат — evidence устойчивого path-management в reasonable volatility envelope, но не доказательство точной private Safe strategy.

## Новая live-серия

Начата BNBUSDT.P 2h Safe SELL серия:

```text
Signal: 2026-08-05 07:00 +05
Mode: Safe
Snapshot #1: 2026-08-05 11:55 +05
CSV: ci-results/ggi-snapshot-bnb-2h-2026-08-05-1155.csv
Manifest: ci-results/ggi-snapshot-bnb-2h-manifest-v1.json
Signal row: Shapes[1] = 1
```

Приблизительные отображаемые уровни screenshot:

```text
Entry: 598.1
Add: 621.5
Partial/Mean: 583.5
Full target: 562.4
State: active
```

Следующие snapshots будут получены после закрытия 13:00 свечи и при первом management event. Они предназначены прежде всего для проверки real BE/management transitions; anti-repaint является secondary safety check.

## Твоя исследовательская задача

### Шаг 1 — независимый audit текущего evidence

До изменения кода дай короткий ответ:

1. Какие выводы действительно подтверждены данными?
2. Какие три главные неопределённости сильнее всего влияют на final 2h net expectancy?
3. Где текущий corrected replay может систематически завышать или занижать результат?
4. Есть ли в текущих exact series новое observable различие, которое ещё не тестировалось?

### Шаг 2 — предложи только одну основную новую гипотезу

Допускается максимум одна primary hypothesis и одна negative-control alternative.

Гипотеза должна:

- использовать только данные, доступные причинно на signal/management bar;
- объяснять конкретный остаток, а не просто улучшать метрику;
- не быть переименованием ATR period/coefficient search;
- не быть повтором Full-by-wick, naive BE или duplicate non-overlap;
- иметь маленький заранее фиксированный search space;
- содержать формальный kill criterion;
- объяснять, какой результат будет новым знанием даже при провале.

Предпочтительные исследовательские направления — выбери только одно, если оно действительно идентифицируемо:

1. **BE execution via lower-timeframe path:** использовать совмещённые 2h/1h или 2h/15m OHLC только для реконструкции порядка Mean→Inner→Entry после Partial, не для подбора labels;
2. **Stateful stop regime:** проверить дискретный causal state/change-point вместо непрерывного scalar ATR modifier;
3. **Outcome path decomposition:** определить, обеспечивается ли 2h edge ранним MFE до Partial/Full, close-confirmation или long/short asymmetry;
4. **Standard acceptance state:** восстановить feasibility/pre-consumption gate отдельно от common labels;
5. **Forward/live reconciliation:** построить causal ledger новой BNB 2h сделки и последующих live signals.

Если ни одно направление нельзя честно проверить текущими файлами, остановись и укажи точный новый экспорт, который различит две конкретные гипотезы.

## Методология

Перед запуском нового расчёта создай preregistration:

```text
ci-results/ggi-claude-next-discovery-preregistration.md
```

В нём заранее зафиксируй:

- вопрос и механизм;
- development/validation/OOS split;
- causal feature definitions;
- search space;
- primary metric;
- negative controls;
- kill criteria;
- что считается новым знанием;
- какие существующие datasets уже hypothesis-seen.

После preregistration не меняй критерии по результату.

Обязательные ограничения:

- только данные `<= current bar`;
- никаких future pivots, backplotting или future outcome в features;
- exact labels и trading edge анализировать отдельно;
- не выбирать лучший stop/asset/timeframe из holdout;
- не использовать текущий validation package повторно как независимый OOS;
- не выдавать aggregate за успех при провале нескольких assets/sides;
- показывать no-add отдельно от with-add;
- costs считать на каждый фактический fill;
- funding добавлять только из venue-appropriate settlements;
- не менять production `detectReversals`, Apex, UI, SPEC или strategy defaults.

## Требуемые тесты

Добавь тесты, соответствующие выбранной гипотезе. Минимально:

1. prefix/no-future stability;
2. deterministic replay;
3. exact timestamp alignment across timeframes, если используется LTF path;
4. no duplicate use of management events;
5. synthetic fixture, где механизм должен сработать;
6. synthetic/null fixture, где он не должен создавать ложный edge;
7. regression на common Shapes и Full-by-close.

## Required artifacts

Создай отдельную ветку от актуальной GGI research branch:

```text
research/ggi-claude-next-discovery
```

Сохрани:

```text
ci-results/ggi-claude-next-discovery-preregistration.md
ci-results/ggi-claude-next-discovery.json
ci-results/ggi-claude-next-discovery.md
ci/research/runGgiClaudeNextDiscovery.ts
tests/ggiClaudeNextDiscovery.test.ts
```

Если гипотеза требует другой file structure, объясни это до реализации.

Финальный отчёт обязан содержать:

1. что нового проверено;
2. causal mechanism;
3. результаты по dataset/asset/timeframe/side;
4. OOS/negative-control result;
5. sensitivity без post-hoc tuning;
6. изменился ли 2h go/no-go;
7. изменился ли exact-replica status;
8. что нужно от пользователя дальше;
9. commit hash и branch.

## Gate

Запусти:

```text
npm run research:integrity
npm test
tsc --noEmit
```

Все результаты и ошибки показывай фактически. Коммиты тематические, push только в `research/ggi-claude-next-discovery`.

## Запрещено

- повторять уже проваленный free ATR/feature grid;
- объявлять 12×TR55 private stop;
- возвращать Full-by-wick;
- применять второй non-overlap filter;
- считать win rate доказательством прибыльности;
- смешивать Safe/Risk management с Standard;
- подгонять правило под BNB live trade;
- менять production;
- продолжать search после срабатывания kill criterion.

## Первый ответ

До любых изменений верни:

1. подтверждение прочитанных файлов;
2. краткую карту confirmed / unknown / falsified;
3. одну primary hypothesis;
4. почему она новая;
5. exact preregistered test design;
6. какие данные уже достаточны;
7. какие дополнительные данные нужны только если действительно необходимы;
8. явно: `NO CODE OR COMMIT UNTIL NIKITA APPROVES THE HYPOTHESIS`.

---
