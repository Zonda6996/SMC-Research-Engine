# Независимый разбор `research/episode-age-hazard`

Дата: 2026-08-02  
База контекста: `research/apex-reversal-handoff` → `research/episode-age-hazard`  
Автор разбора: Sol

## Короткий вердикт

Работа Claude Fable 5 не бесполезна: она воспроизводима, не трогает production и честно фиксирует провал V7' на validation. Главный отрицательный результат надёжен: **конкретная V7'-формула не выбирает exact bar оригинального Reversal**.

Но положительные выводы исследования существенно сильнее, чем позволяют данные. В частности:

1. V7' не является чистым тестом episode age.
2. Заявленная глобальная блокировка 52–60 баров фактически реализована как same-side spacing.
3. H2/H3 и диапазон `W={48,54,60}` сформированы с просмотром всех шести рядов, включая прежние sealed/holdout labels. Поэтому для этой гипотезы эти ряды уже нельзя считать untouched holdouts.
4. Вывод о hidden HTF state опирается на 5 и 3 совпадения, простой Poisson-baseline и заранее не проверенную устойчивость к выбору окна.
5. Вывод «hard cooldown должен создавать pile-up прямо у пола» методологически неверен: pile-up зависит от интенсивности и формы потока кандидатов после разблокировки.
6. Обязательные из handoff per-side metrics, gap diagnostics и causal/prefix unit tests для V7' отсутствуют.

Моя оценка: **Claude корректно убил одну узкую формулу, но не убил episode age вообще и не доказал HTF-механизм. Следующий запуск V8 в текущей постановке преждевременен.**

## 1. Что было восстановлено

Исходный handoff правильно фиксировал:

- canonical corpus: 86,420 строк, 370 exact BUY/SELL labels;
- Apex уже достаточно близок и не должен перенастраиваться ради Reversal;
- Reversal — редкая chronological one-shot/state-machine задача, а не per-bar classifier;
- V1–V6 провалили sealed/OOS exact fidelity;
- следующий рекомендуемый порядок: сначала чистый age analysis, затем узкий lock, и только потом recovery/volume;
- Standard должен рассматриваться как stateful pre-consumption gate;
- vendor fidelity и самостоятельный trading edge нельзя смешивать.

Ветка Claude добавляет пять содержательных коммитов:

- `10995a0` — H1/H2/H3 audits;
- `e98d93a` — preregistration V7';
- `b1e3371` — detector;
- `d6dd35f` — validation FAIL;
- `c1a38f0` — session summary.

Integrity baseline воспроизведён локально: 5/5 тестов проходят. Audit и V7' search также воспроизводятся byte-for-byte без diff результатов.

## 2. Что Claude сделал хорошо

### 2.1. Честно остановился на validation

Лучший V7' config даёт mean validation F1 3.03%; BTC 15m validation имеет 0/16 exact TP. Не запускать final sealed/holdout evaluation такой формулы — разумно. Это не скрывает плохой результат и не создаёт post-hoc «спасение» модели.

### 2.2. Preregistration действительно предшествует запуску V7'

Порядок коммитов подтверждает, что конкретный 18-config grid был записан до реализации и результата. Это лучше предыдущих широких поисков V1–V6.

### 2.3. Region-vs-exact-bar разделение полезно

Tolerance diagnostic показывает, что Inner-episode grammar действительно локализует широкие области появления labels, но не точный бар. Это важное отрицательное знание: продолжать случайно перебирать близкие recovery thresholds внутри той же single-TF information set малоэффективно.

### 2.4. Production не затронут

`detectReversals()`, Apex defaults, UI и battle strategy не изменены. Gate ветки проходит: 366/366 tests, TypeScript clean, frontend syntax clean.

## 3. Главные методологические проблемы

### 3.1. V7' не проверяет чистую episode-age гипотезу

Deferred brief требовал последовательность:

1. age distribution/hazard;
2. fixed age windows без oscillator/volume;
3. только если age выживает — recovery;
4. затем lock.

V7' сразу связывает четыре механизма:

- `minAge`;
- recovery от episode extreme;
- strict rolling maximum recovery;
- same-side spacing `W`.

Следовательно, провал V7' означает только:

> age + именно эта нормировка recovery + именно этот rolling-extremum selector + same-side spacing не восстанавливают exact labels.

Он не означает, что episode age как conditioning variable «dead». Audit показывает слабую region-level ассоциацию, но отдельный fixed-window classifier не был построен и проверен.

### 3.2. Global lock реализован неверно относительно исходной гипотезы

В `detectV7()` цикл идёт отдельно по `long` и `short`, а `lastEmit` находится внутри side-loop. Поэтому BUY не блокирует SELL и наоборот.

Исходное наблюдение было о **global inter-label gap** между соседними labels любой стороны. Deferred brief прямо говорил «global across BUY and SELL». Реализованный V7' тестирует same-side spacing, то есть другую гипотезу.

Кроме того, сигнал не consume-ит episode. Длинный episode может повторно emit после `W` баров. Это не соответствует ожидаемой one-shot architecture из handoff.

### 3.3. Sealed/holdout contamination для H2/H3

H1 hazard использует только fit slices — это чисто.

Но H2 gap audit и H3 cross-TF audit используют все labels всех шести datasets. Затем:

- наблюдение минимумов 52–60 формирует `W={48,54,60}`;
- H3 используется как обоснование следующего V8;
- ETH/BTC5/BTC4h продолжают называться holdouts.

Для уже известных семейств H2/H3 это неверно. Данные могут оставаться execution-sealed для конкретного V7 final, но они уже не hypothesis-sealed. Любая будущая оценка H2/HTF на тех же рядах будет development/exploratory, а не честным OOS подтверждением.

Нужен новый OOS information set: новые символы/TF или будущий appended период, не просмотренный при выборе механизма.

### 3.4. H2 «soft floor» не различает cooldown и rolling extremum

Утверждение:

> hard cooldown должен давать массу gaps прямо на 53–56, rolling extremum — мягкий дефицит

не является общим следствием моделей.

После hard cooldown следующий signal появляется не обязательно в первый разрешённый бар. Если базовые candidates редки или кластеризованы, histogram также даст sparse gradual rise. И наоборот, rolling extremum при частом candidate stream может создавать pile-up около длины окна.

Чтобы различать механизмы, надо оценивать не histogram labels сам по себе, а conditional waiting time от unlock относительно наблюдаемого candidate stream. Пока candidate stream неизвестен, H2 остаётся неоднозначным.

### 3.5. H3 cross-TF evidence переоценён

Результаты:

- 15m vs 5m: 5/34 совпадений;
- 1h vs 15m: 0/16;
- 4h vs 1h: 3/12.

Проблемы:

- всего восемь положительных совпадений в двух парах;
- одна из трёх последовательных пар даёт ноль;
- окно ±2 HTF bars означает совершенно разные wall-clock окна: ±30 минут для 15m и ±8 часов для 4h;
- Poisson independence baseline игнорирует autocorrelation, volatility regimes и кластеризацию labels;
- не показаны confidence intervals, permutation/circular-shift null и чувствительность к окнам ±1/±2/±3;
- пары имеют разные исторические overlap-периоды.

Это достаточно, чтобы H3 оставить открытой, но недостаточно, чтобы назвать её «strongest unexplained signal» или начинать HTF grid без дополнительного falsification audit.

### 3.6. Wall-clock alignment age peaks слабое

Сопоставление 15m age 24–31 (~6–8h) с 1h age 8–15 (~8–15h) выглядит привлекательным, но:

- 1h aggregate peak не проходит собственный 2x criterion (1.80x);
- side peaks основаны на 2–4 events;
- выбирается максимум среди многих bins;
- confidence intervals и multiple-bin correction отсутствуют;
- диапазоны лишь частично перекрываются и очень широки.

Это exploratory clue, не доказательство timeframe-invariant clock.

### 3.7. Неполные deliverables относительно handoff

Для V7' нет отдельных unit tests на:

- prefix stability/no-lookahead;
- one-shot consumption;
- global lock;
- re-arm.

Также итоговый search report не показывает обязательные:

- BUY/SELL separately;
- count ratio;
- inter-signal gaps;
- ±1-bar diagnostic для всех configs/datasets.

Сам detector выглядит causal по индексам, но это не заменяет regression tests.

## 4. Как правильно интерпретировать фактический результат

Надёжно установлено:

1. V7' recovery-extremum exact selector провален.
2. Inner episodes содержат region-level information.
3. Exact-bar selector по-прежнему не найден.
4. Production Reversal менять нельзя.
5. Новые варианты той же recovery-extremum формулы имеют низкую ожидаемую ценность.

Не установлено:

1. Что episode age бесполезен как conditioning/filter variable.
2. Что minimum gap создаётся rolling extremum, а не cooldown/state consumption/редким base stream.
3. Что exact bar выбирается hidden HTF state.
4. Что текущие ETH/BTC5/BTC4h остаются честными holdouts для H2/H3/V8.
5. Что internal non-exported series необходима: это правдоподобно, но пока не идентифицировано.

## 5. Что делать дальше

### Priority 0 — зафиксировать статус данных

Пометить текущие шесть datasets так:

- чистые для воспроизведения старых V1–V7 результатов;
- development/exploratory для H2/H3 и будущего HTF-family;
- не использовать их как окончательное OOS доказательство новой H2/H3-derived модели.

Для promotion понадобится новый OOS набор или будущий appended period.

### Priority 1 — не запускать V8 grid сразу

Сначала провести один узкий falsification audit без detector search:

1. Cross-TF coincidence на общем overlap и одинаковых wall-clock windows.
2. Circular-shift/block-permutation null, сохраняющий side counts и clustering.
3. Окна фиксировать заранее, например ±30m, ±1h, ±4h.
4. Показать exact timestamps совпадений и их устойчивость к удалению каждого отдельного event.
5. Если эффект исчезает без одного-двух событий или не повторяется на 1h↔15m, H3 не продвигать.

### Priority 2 — чистая age ablation

Если продолжать age stream, отделить переменные:

- candidate = каждый at-risk episode bar или один заранее определённый causal event внутри episode;
- только fixed age bins/windows;
- без recovery threshold, rolling max и lock;
- оценить uncertainty и calibration, а не выбирать самый высокий bin ratio;
- затем отдельно добавить global lock и same-side lock как два разных ablation.

Однако такой анализ уже будет exploratory на текущем корпусе. Честная проверка — на новом периоде/экспорте.

### Priority 3 — Standard gate позже

Standard/Risk pairs пока лежат вне canonical manifest. До stateful Standard model нужно сначала включить пары в отдельный validated manifest с hashes и явно разделить Risk base-label reconstruction от Standard acceptance reconstruction.

## Финальный комментарий пользователю

Результат оказался слабее ожиданий не потому, что Claude «плохо посчитал». Он хорошо оформил и честно провалил узкий эксперимент. Проблема в выборе следующего вопроса: вместо чистого age ablation он быстро собрал ещё одну сложную grammar и затем слишком уверенно интерпретировал несколько descriptive patterns.

Наиболее ценный итог ветки — не H3, а более трезвый:

> На текущих OHLC+bands single-TF признаках мы умеем находить широкие Reversal-regions, но не exact emission bar. V7' не приблизил exact fidelity. Чтобы двигаться дальше, нужен либо новый information set, либо гораздо более строгий falsification audit HTF-гипотезы до любого нового grid.
