# Initial prompt for Claude Fable 5 in v0.app

Скопируй в новый чат Claude после того, как дашь ему доступ к GitHub-репозиторию и research-ветке.

---

Ты подключён к GitHub-репозиторию `SMC-Research-Engine`. Твоя задача — провести независимое, строго воспроизводимое исследование двух приватных TradingView-индикаторов: **Zonda Apex** (пять линий экстремумов) и особенно **Zonda Reversal** (редкие BUY/SELL labels).

Главная цель — не косметически повторить наши идеи и не немедленно внедрить код, а понять механизм оригинального Reversal настолько хорошо, насколько позволяют exact exports, найти модель с существенно лучшей out-of-sample fidelity либо честно доказать, что текущих наблюдаемых данных недостаточно. Ты можешь критиковать наши выводы, предлагать новые причинные Pine-compatible гипотезы и тестировать другой подход. Запрет только один: нельзя подменять доказательство красивой историей или подгонкой.

## Сначала прочитай

1. `docs/INDICATOR-RESEARCH-HANDOFF.md` — главный handoff и протокол.
2. `ci-results/README.md` — индекс canonical результатов.
3. `data/vendor-exports/manifest.json`.
4. `ci/research/lib/exactIndicatorExport.ts`, `ci/research/lib/eventMetrics.ts`, `ci/research/config/reversalDatasets.ts`.
5. `src/core/signals/ApexEngine.ts` и все `src/core/signals/Reversal*Research.ts`.
6. Тесты `tests/exactIndicatorExport.test.ts`, `tests/apexOosRegression.test.ts`, `tests/eventMetrics.test.ts` и causal tests Reversal.
7. Актуальные части `SPEC.md`; для общей карты — `docs/CONTEXT.md`.

Не начинай с чтения сотен отчётов в случайном порядке: canonical последовательность дана в `ci-results/README.md`.

## Первый ответ мне

До изменения кода:

1. Кратко перескажи, как ты понял Apex, Reversal, datasets, режимы Risk/Safe/Standard и текущие отрицательные результаты.
2. Запусти/проверь integrity baseline. Подтверди фактические counts/hashes: canonical corpus сейчас **86,420 rows / 370 exact labels**, а не старые 61,820/268.
3. Скажи, достаточно ли файлов в GitHub для следующего честного эксперимента.
4. Если нужны дополнительные данные от меня, попроси их только в точном формате: exchange, symbol, spot/futures, timeframe, Risk Mode, date range, обязательные CSV columns и какую пару гипотез этот экспорт различит. Не проси “ещё скринов/CSV на всякий случай”.
5. Предложи одну основную гипотезу и максимум две альтернативы. Для каждой укажи причинный механизм, почему V1–V6 её не проверили полностью, preregistered search space и критерий отказа.
6. Ничего не коммить, пока я не подтвержу выбранный эксперимент.

## Методологические ограничения

- На баре `i` разрешены только данные с индексом `<= i`.
- Запрещены future pivots, negative-offset labels как вход, future outcome, post-hoc выбор universe и настройка по sealed/holdout.
- Development: BTC perpetual 15m/1h. Внутри каждого ряда: 50% fit, 25% validation, 25% sealed.
- ETH Futures 15m и BTC Futures 5m/4h — untouched Futures holdouts. SOL Spot 15m считать отдельно.
- Гипотеза и search space фиксируются до просмотра sealed/holdout.
- Использовать one-to-one directional event matching. Отчитываться exact и ±1 bar, но exact — основной критерий.
- Для каждого dataset и BUY/SELL отдельно показать precision, recall, F1, predictions, truth, count ratio и inter-signal gaps.
- Не оптимизировать торговую прибыльность на этапе vendor fidelity. Совпадение меток и edge — разные задачи.
- Не выдавать aggregate за успех, если BTC4h/ETH/одна сторона проваливаются.

Текущий promotion gate для каждого Futures holdout:

```text
precision >= 15%
recall >= 40%
count ratio between 0.5 and 2.0
```

Severe sealed collapse автоматически отклоняет модель. Прохождение gate означает “можно обсуждать дальше”, а не “формула оригинала найдена”.

## Свобода исследования

Ты не обязан запускать описанный V7. Самостоятельно проверь, действительно ли самая сильная следующая линия — pure episode age + narrow 52–60 bar lock + stateful Standard acceptance. Можешь предложить другую модель, если объяснишь:

- какое новое наблюдаемое различие она использует;
- почему оно не является переименованием уже провалившегося RSI/Stoch/MFI/volume/pivot composite;
- как минимизируешь multiple testing;
- какой результат заранее заставит тебя отказаться от гипотезы.

Особенно учти уже установленное:

- Reversal не является обычным per-bar threshold classifier;
- ни один из 370 labels не требует current/previous Outer touch;
- label часто появляется через десятки баров после начала Inner episode;
- Risk minimum global gap стабилен примерно на 53–54 барах across 3m/5m/15m;
- Safe/Risk entries на контролируемом overlap совпали полностью;
- Standard преимущественно принимает подмножество Risk, но редкие Standard-only replacements требуют stateful pre-consumption gate;
- публичные BUY/SELL series — алиасы final Shapes; hidden score/state/counters не экспортируются;
- Apex уже близок геометрически, поэтому не меняй его ради улучшения Reversal-fit без независимого Apex OOS доказательства.

## Если эксперимент подтверждён

Создай новую ветку `research/<короткое-название-гипотезы>` и сохрани:

1. отдельный Markdown с preregistration;
2. причинный TypeScript-код;
3. unit tests на prefix stability/no-lookahead, one-shot, lock и re-arm;
4. machine-readable JSON/CSV результата;
5. компактный отчёт fit/validation/sealed/holdouts;
6. строгий critic verdict;
7. явный ответ: что узнали о механизме оригинала, что осталось неизвестно, production менять или нет.

Коммиты делай тематически и push в GitHub. **Не меняй production `detectReversals()`, Apex defaults, UI или battle strategy**, пока gate не пройден и я явно не разрешил promotion.

Если все честные варианты снова провалятся, не продолжай бесконечный grid. Остановись и перечисли минимальный новый information set, который сильнее всего уменьшит неопределённость.

---
