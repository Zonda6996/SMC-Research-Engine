# OWN2 + funding-sign filter — coverage report (исторический pre-reveal этап)

> Этот отчёт фиксирует корректную остановку до первоначального coverage gate. Позже пользователь явно разрешил отдельный AVAX-only diagnostic reveal через immutable amendment. Актуальные фактические числа и granular reveal status: `ci-results/own2-funding-sign-avax-diagnostic.md` и `ci-results/own2-funding-sign-reveal-status.json`. Четыре spot-серии по-прежнему untouched; только AVAX futures 1h раскрыта диагностически.

## Итог pre-reveal этапа

**Тогдашний вердикт: `INCONCLUSIVE DATA`.** Правило, метрики, bootstrap и GO/KILL-гейты были неизменно зафиксированы до OOS; причинная реализация и синтетические тесты готовы. Обязательный coverage-аудит остановил clean multi-symbol эксперимент **до чтения S1 outcomes**: замороженный S1 содержит 5 серий и 3 символа, однако 4 серии — spot, а settled funding относится к perpetual futures. Единственная совместимая серия — AVAXUSDT futures 1h. Последующий отдельный diagnostic reveal не превращает этот корпус в clean multi-symbol test.

## 1. Что проверяли и зачем

Гипотеза: знак последней уже опубликованной funding-ставки может отсеивать часть собственных сигналов OWN2, оставляя развороты против перегруженной стороны perpetual-рынка. Проверялся не самостоятельный funding-only трейдинг, а **надстройка над OWN2**: сначала OWN2 создаёт price/volume candidate, затем funding лишь разрешает или запрещает его.

Цель была экономической: выяснить, улучшает ли фильтр результат на тех же возможностях после реальных taker costs 5 bps/side и фактических funding cashflows, не маскируя падение общей прибыли уменьшением числа сделок.

## 2. Чем OWN2 отличается от funding-only

- **OWN2** использует Apex-зону, положение цены, направленную свечу, relative volume и причинную ATR-геометрию; вход — на следующем баре; сделкой управляет канонический Safe replay.
- **Funding-only** сам создаёт направление из знака ставки и торгует settlement-to-settlement. Эта отдельная линия уже была проверена и получила `KILL`.
- В текущем эксперименте funding **не создаёт вход**. Он только veto для уже существующего OWN2 candidate. Поэтому корректная единица сравнения — одна и та же baseline opportunity.

## 3. Данные и честность OOS

### Что было заморожено

Preregistration: `ci-results/own2-funding-sign-preregistration.md`, SHA-256 `99a63a09edbf492bd151a63b0f5f6532db6093827abdc5f7a824bb4831c68ea1`.

Предпочтительный clean OOS — S1 `untouched-oos` из frozen manifest. Проверка показала:
- manifest всё ещё содержит `untouchedOosMetricsInspected=false`;
- reveal-артефакт с untouched outcomes не найден;
- SHA-256 всех пяти исходных файлов совпадает;
- значит S1 действительно остаётся untouched и пригоден для будущего one-time reveal — **но не для этого funding-теста в текущем составе**.

### Coverage-аудит

| Замороженная серия | Market | Hash | Совместима с perpetual funding? |
|---|---|---|---|
| AVAXUSDT 5m | spot | PASS | нет |
| AVAXUSDT 1h | futures | PASS | да |
| LINKUSDT 15m | spot | PASS | нет |
| LINKUSDT 1h | spot | PASS | нет |
| SOLUSDT 2h | spot | PASS | нет |

Итого: 1 совместимая серия, 1 symbol, 168 manifest primary events. Требовались минимум 3 независимых symbols и 250 baseline OOS opportunities. Даже верхняя граница 168 уже ниже event gate, а фактических исполненных OWN2 opportunities после replay не может стать больше.

Почему нельзя «просто приклеить» funding к spot: funding cashflow появляется только у perpetual position. Spot high/low/volume и perpetual high/low/volume различаются, а значит меняются и OWN2 candidates, и стопы, и тейки. Это был бы другой корпус после preregistration.

## 4. Простое объяснение правила

На момент решения берётся последняя реальная settled funding запись, опубликованная **строго раньше** timestamp решения:
- OWN2 LONG + funding < 0 → оставить;
- OWN2 SHORT + funding > 0 → оставить;
- противоположный знак, ноль или отсутствие записи → не входить.

Settlement ровно на timestamp решения ещё недоступен. Будущие записи запрещены. Между settlements не создаётся искусственных событий: хранится лишь возраст последней реально известной ставки.

## 5. Результаты baseline vs filter

Экономические результаты **не раскрывались**, потому что preregistered integrity/coverage gate не прошёл.

| Метрика | Baseline | Funding-sign filter |
|---|---:|---:|
| Clean OOS opportunities | не раскрыто | не раскрыто |
| Executed trades | не раскрыто | не раскрыто |
| Mean net / executed trade | не раскрыто | не раскрыто |
| Total net | не раскрыто | не раскрыто |
| Mean net / baseline opportunity | не раскрыто | не раскрыто |
| PF / WR / max DD | не раскрыто | не раскрыто |
| Funding contribution | не раскрыто | не раскрыто |

Это не пропуск анализа, а защита holdout: после установленного coverage FAIL чтение результатов было бы бесполезным сжиганием единственного untouched корпуса.

## 6. Статистическая уверенность

Был заранее заморожен joint UTC-day cluster bootstrap: 10 000 выборок, seed `25082026`, paired delta на baseline opportunities. GO требовал CI95 lower > 0, положительный filtered expectancy, breadth ≥2/3, N baseline ≥250 и retained ≥100.

CI не рассчитывался: при одном symbol и максимум 168 предварительных событий невозможно выполнить preregistered design. Любой CI здесь отвечал бы на более узкий постфактум вопрос и не мог дать заявленный GO.

## 7. Почему итог именно такой

Гипотеза не доказана и не опровергнута. Остановила не доходность, а несовместимость market corpus:
1. S1 был создан для другой stateful-линии и смешивает spot/futures.
2. Funding-sign экономически осмыслен только на perpetual positions.
3. Только AVAX 1h совпадает по market.
4. Этого недостаточно и по breadth, и по sample size.
5. Замена корпуса после фиксации нарушила бы независимость.

## 8. Ограничения

- Не получена оценка экономического edge фильтра.
- Не измерены retained rate, PF, WR, DD, концентрация и age distribution на OOS — намеренно.
- Funding-only `KILL` нельзя переносить на OWN2+filter: это разные стратегии.
- Recall vendor shapes нельзя сопоставлять с expectancy и здесь не использовался.
- Рабочее дерево уже было dirty до эксперимента; существующие изменения не перезаписывались. Provenance фиксировался file hashes.

## 9. Чёткий вердикт

# `INCONCLUSIVE DATA`

Не `GO`: нет допустимого результата и не выполнены N/breadth gates.
Не `KILL`: гипотеза не получила честного экономического reveal.
S1 остаётся sealed и не сожжён этим экспериментом.

## 10. Что делать дальше и чего не делать

### Делать

Создать **новый preregistered all-perpetual holdout** минимум на трёх заранее выбранных symbols, с теми же OWN2/Safe/cost правилами и official settled funding. До outcomes выполнить acquisition manifest, hashes, timestamp/coverage audit и убедиться, что ожидается ≥250 baseline opportunities и ≥100 retained trades. Только затем сделать один reveal и применить уже написанный paired/bootstrap harness.

### Не делать

- не использовать spot outcomes с perpetual funding cashflows;
- не заменять S1 spot-файлы futures-файлами под тем же названием OOS;
- не открывать один AVAX futures symbol «для интереса» и не выдавать его за clean test;
- не ретюнить знак, magnitude, окна, symbol/side/timeframe;
- не использовать ONDO/VIRTUAL, S4 holdout или funding-only OOS как новый независимый holdout;
- не объявлять победу только по mean retained trade без per-baseline-opportunity результата.

## Технические артефакты и проверки

- Preregistration: `ci-results/own2-funding-sign-preregistration.md`
- Причинный модуль: `ci/research/lib/own2FundingSignResearch.ts`
- Синтетические тесты: `tests/own2FundingSignResearch.test.ts`
- Coverage evidence: `ci-results/own2-funding-sign-coverage-audit.json`
- TypeScript: `npx tsc --noEmit` — PASS
- Relevant tests: 22/22 PASS, включая sign long/short/zero/missing, strict boundary, no future leakage, direction-aware funding, subset/baseline, opportunity metric и deterministic cluster bootstrap.
