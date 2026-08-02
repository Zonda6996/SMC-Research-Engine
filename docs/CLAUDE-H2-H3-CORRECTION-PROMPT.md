# Prompt для Claude Fable 5: корректирующий аудит H2/H3

Передай Claude этот текст целиком в чате, где он имеет доступ к GitHub-репозиторию и ветке `research/episode-age-hazard`.

---

Ты продолжаешь исследование SMC Research Engine после независимого review ветки `research/episode-age-hazard`.

Перед началом прочитай:

1. `docs/EPISODE-AGE-HAZARD-SESSION-SUMMARY.md`;
2. `ci-results/episode-age-hazard-independent-review-sol.md`;
3. `ci-results/episode-age-hazard-audits-v1.md`;
4. `ci-results/reversal-v7prime-preregistration.md`;
5. `ci/research/auditEpisodeAgeHazard.ts`;
6. `ci/research/runReversalV7RollingExtremum.ts`;
7. `docs/INDICATOR-RESEARCH-HANDOFF.md`.

## Задача этой сессии

Провести **исправляющий falsification audit H2/H3**. Не разрабатывать и не запускать V8. Не подбирать detector. Не пытаться улучшить F1. Цель — выяснить, выдерживают ли наблюдения о minimum gap и cross-TF coincidence строгую проверку или являются следствием малого числа событий, выбора окна либо неверного null model.

Создай новую ветку от актуального `research/episode-age-hazard`:

```text
research/htf-gap-falsification
```

Перед расчётами создай и отдельно закоммить preregistration:

```text
ci-results/htf-gap-falsification-preregistration.md
```

После preregistration не меняй окна, метрики, null model и kill criteria.

## Обязательное исправление интерпретации V7'

В новом итоговом отчёте явно зафиксируй:

1. V7' проверил не pure episode age, а coupled family: `minAge + recovery threshold + rolling recovery maximum + spacing`.
2. `lastEmit` в `detectV7()` side-local, поэтому V7' использовал same-side spacing, а не global BUY/SELL lock.
3. H2/H3 audits просмотрели labels полного текущего корпуса. Поэтому ETH15, BTC5, BTC4h и sealed slices могут оставаться execution-unseen для неисполненного V7 final, но больше не являются hypothesis-unseen для H2/H3-derived моделей.
4. Не утверждай, что V7' убил episode age вообще. Допустимый вывод: провалена конкретная coupled V7' family как exact-bar selector.

Не переписывай старые committed artifacts задним числом. Исправление оформи новым addendum/report.

## Audit H2: global gap mechanism

### Вопрос

Позволяет ли форма inter-label gaps отличить:

- explicit global cooldown;
- same-side cooldown;
- rolling-window extremum;
- редкий/кластеризованный base candidate stream?

### Требования

1. Покажи global и same-side gap distributions отдельно для каждого dataset.
2. Не делай вывод `нет pile-up у floor => hard cooldown отвергнут`: это не идентифицируется без candidate stream.
3. Рассчитай survival/hazard gaps после minima, но называй результат descriptive, а не механизмом.
4. Проведи sensitivity без подбора параметров: заранее зафиксируй bins/windows в preregistration.
5. Итог H2 должен иметь один из статусов:
   - `not identifiable from label gaps alone`;
   - `evidence inconsistent with a specific lock family`;
   - `robust evidence`, только если есть формально определённое различающее наблюдение.
6. Не строить detector и не использовать результат для F1-search.

Ожидаемый консервативный baseline: label gaps сами по себе, вероятно, недостаточны для различения cooldown и emergent rolling lock. Если найдёшь обратное, покажи формальное доказательство или simulation-based falsification.

## Audit H3: cross-TF coincidence

### Общий принцип

Сравнивать пары только на общем overlap и с **одинаковыми wall-clock windows**, а не с `±2 HTF bars`, которые означают разные длительности.

### Окна

Зафиксируй до расчёта ровно эти окна:

```text
±30 minutes
±60 minutes
±240 minutes
```

Никаких дополнительных окон после просмотра результата.

### Направление и matching

- Same-direction — primary.
- Opposite-direction — negative-control diagnostic.
- Каждый HTF event может иметь бинарный hit/no-hit.
- Отдельно покажи one-to-one event matching, чтобы один LTF event не раздувал несколько HTF hits.
- Покажи все exact matched timestamp pairs в machine-readable artifact.

### Null model

Простой Poisson density baseline недостаточен. Используй permutation/null, сохраняющий временную структуру:

1. circularly shift полный LTF label stream внутри overlap;
2. одинаковый shift для всех LTF events, чтобы сохранить inter-label gaps, sides и clustering;
3. минимум 10,000 deterministic permutations/offsets с фиксированным seed либо исчерпывающий набор допустимых shifts;
4. исключить trivial shifts внутри максимального test window вокруг нуля;
5. для каждой пары и окна отчитаться:
   - observed hits/rate;
   - null mean и quantiles;
   - empirical one-sided p-value;
   - enrichment ratio;
   - 95% interval;
   - exact one-to-one hits.

Если circular shift технически неоднозначен из-за bar grids разных TF, заранее опиши детерминированное отображение shift в wall-clock milliseconds и не меняй его после запуска.

### Устойчивость

Обязательно:

1. Leave-one-HTF-event-out: максимальное и минимальное enrichment/p-value после удаления каждого HTF event.
2. Покажи результат отдельно для всех трёх пар:
   - BTC 5m ↔ 15m;
   - BTC 15m ↔ 1h;
   - BTC 1h ↔ 4h.
3. Общий overlap sensitivity: повтори расчёт на пересечении периода, где доступны все четыре BTC TF, если размер выборки ненулевой. Это diagnostic, не новый selection axis.
4. Не объединяй пары в успешный aggregate, если одна последовательная пара даёт ноль или противоположный результат.

### Pre-registered kill criteria H3

H3 не продвигается к V8, если выполняется любое условие:

1. same-direction empirical `p > 0.05` на двух из трёх TF-пар во всех трёх фиксированных окнах;
2. эффект в успешной паре теряется (`p > 0.10` либо enrichment < 1.5x) после удаления одного HTF event;
3. opposite-direction control показывает сопоставимое enrichment;
4. эффект существует только в ±240m, но отсутствует в ±30m и ±60m без заранее заданного механистического объяснения;
5. результат зависит от разных исторических overlap regimes и исчезает на общем четырёх-TF overlap.

H3 может получить статус `survives falsification`, только если same-direction enrichment устойчив как минимум в двух смежных TF-парах, не объясняется opposite-direction control и не держится на одном событии. Это ещё не доказательство vendor mechanism и не разрешение V8.

## Data leakage / статус корпуса

В итоговом отчёте создай таблицу:

| dataset/slice | execution status | hypothesis status for H2/H3 | permitted future use |
|---|---|---|---|

Текущий корпус после H2/H3 audit должен быть помечен как exploratory/development для любых H2/H3-derived моделей. Предложи минимальный действительно новый OOS набор:

- либо будущий appended период после фиксированной cutoff-date;
- либо новые symbol/TF pairs с HTF companions;
- exact vendor Shapes, OHLC и все пять Apex lines;
- Risk mode для base-label reconstruction;
- manifest, counts и SHA-256.

Не проси новые данные до завершения falsification audit. В отчёте только сформулируй точную спецификацию будущего OOS.

## Код и тесты

Добавь отдельный research script и unit tests:

```text
ci/research/auditHtfGapFalsification.ts
tests/htfGapFalsification.test.ts
```

Тесты минимум:

1. deterministic circular shifts при фиксированном seed;
2. shift сохраняет counts, direction и inter-label gaps;
3. one-to-one matching не переиспользует LTF event;
4. одинаковые wall-clock windows применяются ко всем TF-парам;
5. synthetic positive fixture обнаруживает planted coincidence;
6. synthetic independent fixture не создаёт систематический false enrichment;
7. prefix/no-future stability для всей подготовки event streams.

## Артефакты

Сохрани:

```text
ci-results/htf-gap-falsification-preregistration.md
ci-results/htf-gap-falsification.json
ci-results/htf-gap-falsification.md
ci-results/episode-age-hazard-methodology-addendum.md
```

JSON должен содержать config, seed, windows, pair-level results, exact matches, null distributions/quantiles, leave-one-out и dataset-status table.

## Финальный gate

Запусти:

```text
npm run research:integrity
npm test
tsc --noEmit
```

В отчёте укажи фактические команды и результаты. Все коммиты тематические, push в `research/htf-gap-falsification`.

## Запрещено

- запускать V8;
- смотреть торговую прибыльность;
- менять production Reversal/Apex/UI/SPEC conclusions;
- добавлять новые окна после просмотра результатов;
- выдавать Poisson ratio или 3–5 совпадений за доказанный hidden HTF state;
- продолжать grid, если H3 kill criteria сработали.

## Последний ответ

Верни кратко:

1. commit hashes и branch;
2. gate status;
3. H2 verdict;
4. H3 verdict по preregistered criteria;
5. какие старые утверждения были ослаблены/исправлены;
6. нужен ли новый OOS набор;
7. явно: `V8 NOT STARTED`.

---
