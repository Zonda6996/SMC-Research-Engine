# Контекст проекта SMC Research Engine для нового ИИ

> Обновлено: 2026-07-17. Состояние репозитория при обновлении: `864895e8c5b6cde104b30a9c436860f31df691d7`.
>
> Это файл быстрого восстановления контекста, **не замена `SPEC.md`**. `SPEC.md` — главный источник истории решений, результатов и отрицательного знания. Код, особенно `src/strategy/battleConfig.ts`, — источник истины о текущем боевом поведении.

## 0. Обязательный протокол нового чата

Перед любыми идеями, выводами или изменениями кода:

1. Открой актуальный репозиторий и выполни `git pull`/`git fetch`.
2. Прочитай **`SPEC.md` полностью**, от начала до конца. Не ограничивайся последними разделами: старые волны объясняют, что уже тестировалось и почему было отклонено.
3. Прочитай этот файл полностью.
4. Просмотри все tracked-файлы проекта как минимум через `git ls-files`; бинарные результаты можно инвентаризировать, но весь исходный код, тесты, конфиги и Markdown нужно прочитать.
5. Особенно внимательно прочитай:
   - `src/strategy/battleConfig.ts`;
   - `src/core/analysis/runAnalysis.ts`;
   - `src/core/fib/FibLifecycleEngine.ts`;
   - `src/core/analysis/entryModels.ts`;
   - `src/core/analysis/takeLadders.ts`;
   - `src/core/analysis/portfolioBacktest.ts`;
   - `src/core/analysis/regimeFilter.ts`;
   - `src/core/analysis/dedupFilter.ts`;
   - `tools/batch/runBatch.ts`;
   - `tools/forward/forwardRunner.ts`;
   - все тесты в `tests/`.
6. Посмотри последние коммиты и diff, а не исходи из того, что этот контекст всё ещё свежий.
7. Перед утверждением «работает» запусти:

```bash
npm install --package-lock=false --ignore-scripts --no-audit --no-fund
npm test
npx tsc --noEmit
```

На коммите `864895e` проходили 217/217 тестов и `tsc --noEmit`.

8. Не исправляй найденные логические проблемы молча. Сначала покажи проблему, экономический эффект, варианты решения и тест, который отличит варианты.
9. Не предлагай повторно уже убитые идеи без нового information set и явного объяснения, почему теперь результат может измениться.
10. Общайся с пользователем по-русски, прямо, плотно, с цифрами. Не выдумывай результаты и параметры.

---

## 1. Что это за проект

SMC Research Engine — TypeScript/Node.js research-платформа для проверки авторской SMC/Fibonacci-логики на крипто-фьючерсах. Это не классический ICT, не готовый торговый бот и не лицензия придумывать новые правила структуры.

Основной pipeline:

```text
Candles
→ PivotDetector
→ SwingEngine
→ StructureEngine / MarketStructureEngine
→ BosChochEngine
→ FibGridEngine
→ FibLifecycleEngine
→ batch/replay/portfolio/forward tooling
```

Канонический оркестратор — `runAnalysis()` в `src/core/analysis/runAnalysis.ts`. Он чистый: считает snapshot без вывода и сетевого исполнения.

Рынок исследования: Binance USDT-M candles. Пользователь торгует/оценивает исполнение под BingX. Модель costs:

- maker: 0.02%;
- taker: 0.05%;
- дополнительный stop slippage allowance: 0.02%;
- входы и тейки предполагаются maker, стоп и time-stop — taker+slippage.

Исторический основной universe последних исследований:

- 14 активов: BTC, ETH, SOL, XRP, BNB, DOGE, ADA, AVAX, LINK, SUI, TON, NEAR, APT, LTC;
- таймфреймы: 15m, 30m, 1h;
- Binance USDT-M futures;
- H1/H2, asset/TF-разрезы и rolling walk-forward применяются как защита от подгонки.

---

## 2. Текущий боевой source of truth

Источник истины — `BATTLE_CONFIG` в `src/strategy/battleConfig.ts`. Не копируй его числовые параметры в другие модули.

### Canon stream

#### Deep

- направление: по сетке;
- touch entry: 38.2;
- stop: 15;
- full take: 61.8;
- time-stop: нет;
- историческое ожидание после costs: около `+0.358R` на сделку.

#### OTE

- направление: по сетке;
- touch entry: 78.6;
- stop: 61.8;
- full take: 100;
- time-stop: 20 баров;
- историческое ожидание после costs: около `+0.244R` на сделку.

Для canon включён bigbar-фильтр, но его исполнимость для resting touch-limit сейчас является открытым критическим вопросом — см. раздел 7.

### Canon sizing

`canonRiskMultiplier()` перемножает:

- freshness: `≤3 → 2.0`, `4–15 → 1.0`, `16+ → 0.5`;
- swing compactness относительно rolling median: compact `1.4`, wide `0.7`;
- session 15–20 UTC `1.2`, но session layer сейчас выключен.

Исторический research-результат sizing stack: около `0.280 → 0.362 R/unit`, то есть +29% к качеству аллокации. Это не означает, что production budget normalization уже корректно реализована.

### Reverse stream после исправления SPEC 7.45

Текущий reverse — **только mirror**:

- активируется после canon OTE entry;
- направление против сетки;
- entry 100;
- stop 120;
- take 78.6;
- cancelBeyond 0;
- честное ожидание: `+0.172R`, WR 60.5%, H1 `+0.169`, H2 `+0.175`, n=3515.

`fade141` удалён из `BATTLE_CONFIG` и новых forward-сигналов.

### Reverse sizing

`reverseRiskMultiplier()` использует свежесть canon-касания:

- `≤3 → 1.5`;
- `4–15 → 1.0`;
- `16+ → 0.7`.

На исправленном mirror-only пуле avgR по этим бакетам: `0.268 / 0.178 / 0.138`. Compactness для reverse не прошла и не используется.

---

## 3. Важнейшее исправление SPEC 7.45: fade141 был look-ahead

Ранее reverse состоял из `mirror@100` и `fade141@141` с first-fill-wins и показывал `+0.347R`.

Проблема: fade оценивался на OTE-сетках, где canon **впоследствии вошёл**, хотя fade-заявка стартовала при создании сетки, когда будущий canon entry ещё неизвестен. Это selection look-ahead.

Unconditional проверка дала:

- все OTE-сетки: n=5625, avgR `−0.130`;
- canon вошёл: n=2983, avgR `+0.205`;
- canon не вошёл: n=2642, avgR `−0.508`, WR 19.2%;
- отрицательный результат устойчив на H1/H2.

После переноса fade activation на момент после canon OTE entry выяснилось:

- цена не может дойти от 78.6 до 141, не пройдя 100;
- mirror на 100 всегда заполняется раньше;
- fade-only n=0;
- first-fill-wins вырождается в mirror-only.

Поэтому fade удалён, старые `+0.347R` признаны завышенными. Новый ИИ не должен ссылаться на `0.347` как на актуальное ожидание reverse, даже если эта цифра осталась в более раннем разделе `SPEC.md` или legacy journal report.

Методологическое правило, добавленное после этой находки:

> Любое условие отбора universe должно быть проверяемо в момент постановки заявки. Если eligibility зависит от будущего входа/исхода другой leg, это look-ahead.

---

## 4. Forward runner после последних изменений

Файл: `tools/forward/forwardRunner.ts`.

Архитектура: stateless replay последних 3000 свечей на каждом `symbol|tf`, состояние дедупликации в `tmp/forward/state.json`, журнал в `tmp/forward/signals.jsonl`, опциональные Telegram-уведомления.

Добавлены события:

- `setup` — сетка создана, нужно заранее поставить canon limit;
- `cancel` — снять незаполненную заявку;
- `signal` — fill;
- `outcome` — tp/stop/timestop.

`--report` считает статистику только по signal/outcome, но показывает число setup/cancel. Legacy fade141-записи читаются для совместимости, новые не создаются.

Это улучшило старую проблему «сигнал-некролог», когда пользователь узнавал о touch только после закрытия свечи. Но implementation ещё не полностью исполнима — см. открытые вопросы.

---

## 5. Что уже исследовано и закрыто

Не предлагай это как новую идею:

- close/candle confirmations;
- MTF CHoCH confirmation;
- partial exits и runners;
- break-even management;
- trailing по уровням;
- re-entry после стопа;
- scale-in/усреднение;
- динамическая переподгонка stop/take cells;
- per-symbol/per-TF cherry-picking;
- HTF trend/alignment filter;
- deep-mirror;
- fade241;
- подход к зоне `approachAtr` и wick fraction;
- equity-streak sizing;
- fixed R:R для OTE;
- дальние цели 141/241 вместо магнитных 61.8/100.

Причины подробно описаны в `SPEC.md`: подтверждения опаздывают, runners разбавляют edge после магнитного уровня, BE/trailing выбивают будущих победителей, re-entry торгует уже сломанный уровень, scale-in получает adverse selection, MTF теряет V-развороты и платит худшей ценой.

### Проверенные и принятые результаты

- full single take лучше partial/BE/runners;
- оптимальные fixed cells: deep `15×61.8`, OTE `61.8×100`;
- OTE entry 78.6 подтверждён полным entry×stop×take sweep;
- freshness и compactness работают как sizing, не hard filters;
- OTE time-stop 20 даёт небольшой плюс;
- rolling walk-forward подтвердил стабильность fixed cells;
- pessimistic intrabar почти не искажает результат для stop/take conflicts;
- volume spike `volRatio≥2` ухудшает OTE, но эффект признан слишком слабым/немонотонным для production layer;
- текущий reverse — только mirror, не fade.

---

## 6. Архитектурный разрыв, который ещё не закрыт

`src/core/analysis/portfolioBacktest.ts` не является portfolio backtest текущего `BATTLE_CONFIG`.

Он исторически собирает lifecycle-сценарии `ote/deep/breaker`, использует одинаковый `riskPct`, `netBeR()` старого lifecycle и tie-break:

```text
entryAt → symbol → timeframe → scenario → id
```

Он не моделирует полноценно:

- новые stop/take cells battleConfig;
- raw/normalized canon sizing;
- mirror activation как parent-child lifecycle;
- reverse sizing;
- единый parent setup risk;
- реальную приоритизацию при max concurrent risk.

Поэтому его equity/DD/Monte Carlo нельзя автоматически называть портфелем текущей canon+mirror системы.

Будущий правильный слой должен строить единый chronological family ledger непосредственно из `BATTLE_CONFIG` и использовать один и тот же replay в batch и forward.

---

## 7. Forward runner v2 (сделано после ревью 864895e)

Текущая версия журнала: `battle-7.45-exec-v2`. Детали и принятые решения — SPEC 7.46.

Исправлено:

- state и события версионированы; старый state не открывается молча;
- FORWARD определяется по заявке/размеру, известным до fill, а не по времени outcome;
- carry-in и catch-up навсегда остаются backfill;
- mutable `swingPool` удалён, median строится по прошлым 200 уникальным сеткам;
- freshness исполняется через `SETUP` и заранее отправленные `AMEND` перед барами 4/16;
- touch fill важнее bigbar свечи касания; post-close bigbar не отменяет уже исполненную лимитку;
- mirror получает setup после OTE fill и торгуется только со следующего бара;
- structural cancel получает реальный confirmIndex противоположного события;
- отчёт показывает clean forward, backfill, pending orders и open trades;
- добавлены тесты median/report/idempotency.

После изменения execution semantics старые цифры `deep 0.358`, `OTE 0.244`, `mirror 0.172` в forward-report — только старые benchmarks. Нужен отдельный batch-пересчёт с теми же исполнимыми правилами.

Перед запуском v2 старую `tmp/forward` обязательно архивировать или удалить.

### Что ещё проверить

1. Полный batch-сравнительный прогон старой и executable bigbar semantics.
2. Пересчитать mirror с активацией со следующего бара после OTE fill.
3. Добавить более прямые синтетические тесты exact cancel index и mirror next-bar.
4. Построить единый battle-family portfolio ledger; legacy `portfolioBacktest.ts` всё ещё не равен текущему battleConfig.

---

## 8. Приоритет следующей работы

1. Запустить чистый forward v2 после удаления старой папки.
2. Доделать визуализатор так, чтобы он использовал тот же battle execution layer.
3. Пересчитать old-vs-executable bigbar и mirror next-bar.
4. Проверить fade141 только после stop mirror.
5. Затем family sizing/allocator и остальные новые идеи.

---

## 9. Важные команды и файлы результатов

Основные команды:

```bash
npm test
npx tsc --noEmit
npm run batch -- --eval-entry
npm run forward -- --once
npm run forward -- --report
npm run forward -- --fixture
npm run portfolio -- ...
```

Перед реальным длинным прогоном изучить CLI-шапку и `parseArgs()` в `tools/batch/runBatch.ts`.

Forward state/journal:

```text
tmp/forward/state.json
tmp/forward/signals.jsonl
```

Batch results генерируются research runner; не делай вывод по одному summary без CSV-разрезов H1/H2, symbol, TF и проверок одинакового universe.

---

## 10. Стиль работы с пользователем

- Ответы только на русском, если пользователь не попросил иначе.
- Без мотивационной воды.
- Сначала факт из кода/SPEC, затем интерпретация.
- Любую оценку помечать как оценку.
- Если результат плохой — говорить прямо. История fade141 показывает, что пользователь предпочитает честное удаление красивого edge его защите.
- Не считать большой totalR доказательством без проверки universe eligibility на момент решения.
- Не менять архитектурные правила без согласования.
- После любой правки: тест, `tsc`, fixture/synthetic regression, затем описание diff.
- Коммит/пуш — только если пользователь явно попросил или подтвердил.

---

## 11. Короткая формула текущего состояния

```text
Боевой кандидат:
canon deep 38.2 → stop15 → take61.8
canon OTE 78.6 → stop61.8 → take100, time-stop20
+ canon freshness×compact sizing
+ mirror reverse 100 → stop120 → take78.6
+ mirror freshness sizing 1.5/1.0/0.7
− fade141 удалён как look-ahead/non-executable

Но перед деньгами ещё проверить:
bigbar executability
risk quantity до fill
causal rolling median
точный cancel timestamp
pre-touch mirror setup
единый battle-family portfolio ledger
```
