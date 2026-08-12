# GGI / Reversal: объединённый разбор Fable + Sol

Дата: 2026-08-06  
Ветка: `research/independent-reversal-edge`  
Состояние после синхронизации: Fable `71b6dea` + ECON0 `297c9fb` + repair архивов `589418c`

## Короткий вердикт

Мы действительно подошли к восстановлению исходного Reversal намного ближе, чем показывал мой прежний ECON0-разбор.

Fable нашёл сильную и воспроизводимую конструкцию:

1. **Сырой сигнал — extension от Mean к/за внутренней полосой на повышенном объёме**, а не свечной body-pattern.
2. Этот raw universe покрывает **73.3%** реальных forward Telegram arrows; relaxed-вариант — **89.3%**.
3. Низкая точность exact-bar возникает не потому, что raw condition неверен, а потому что неизвестно, **какой бар внутри extension-эпизода выбирает vendor**.
4. Частота 2–3 сигнала в месяц и различия Safe/Risk/Standard объясняются **отдельным trade-state gate для каждого режима**.
5. Геометрия Safe/Risk и Standard почти восстановлена. Единственная крупная неизвестная — **формула шага `step`**.

Но восстановление поведения индикатора и наличие торгового edge — разные вопросы. Forward-аудит и ECON0 показывают, что headline WR нельзя принимать за прибыльность. Поэтому проект надо вести двумя параллельными дорожками:

- **Replica track:** закончить точную механику Reversal/режимов.
- **Edge track:** строить наш сигнал на extension + причинном контексте зон/ликвидности и проверять net R после расходов.

Мой вывод: **ветку не удалять и не перезаписывать**. Текущую локальную работу не выбрасывать: она уже безопасно перебазирована поверх Fable и прошла тесты.

---

## 1. Что я проверил

### Git и сохранность

До синхронизации:

- локальный HEAD: `642ed4c`;
- remote Fable: `71b6dea`;
- расхождение: локально `ahead 2, behind 26`;
- рабочее дерево было чистым;
- stash отсутствовал.

То есть скрин с `+601/-17` был состоянием незакоммиченной работы прошлого чата, но к моменту этой проверки эти изменения уже находились в двух локальных коммитах. Никакого «мусора, который надо stash/drop» уже не было.

Я создал две страховочные ветки:

- `backup/sol-econ0-before-fable-20260806` → старый локальный `642ed4c`;
- `backup/fable-v0-20260806` → Fable `71b6dea`.

После этого локальные два коммита были перебазированы поверх Fable без конфликтов:

```text
589418c fix(data): repair internal gaps from daily archives
297c9fb research: add independent reversal evidence and ECON0 replay
71b6dea docs: master findings summary - GGI reverse engineering
```

Текущее состояние:

```text
research/independent-reversal-edge...origin/research/independent-reversal-edge [ahead 2]
```

Это нормальное чистое состояние для push: удалённая история полностью включена, сверху лежат только два наших коммита.

### Проверки кода

На чистом Fable HEAD:

- полный suite: **410/410 pass**;
- TypeScript: **pass**.

После объединения Fable + ECON0:

- полный suite: **461/461 pass**;
- TypeScript: **pass**.

ECON0 был повторно запущен после объединения; его JSON обновился как генерируемый артефакт. Перед push этот результат следует включить в отдельный итоговый коммит вместе с данным отчётом после проверки итогового diff.

---

## 2. Что Fable действительно восстановил

### 2.1 Raw trigger

Самое важное открытие — смена оси исследования.

Прежний OWN1 искал крупную directional candle после drought и покрывал только около **20.5%** forward GGI arrows. REV1 показал, что совпадающие с GGI свечи отличаются прежде всего:

- глубиной extension;
- расстоянием от Mean;
- повышенным объёмом.

OWN2b затем напрямую проверил extension condition:

| Поток | Recall forward arrows | Median signals/month | Mean gross R |
|---|---:|---:|---:|
| OWN1 | 20.4% | 6.4 | +0.0462R |
| Extension raw | 73.3% | 23.0 | +0.0589R |
| Extension relaxed raw | 89.3% | 48.5 | +0.0631R |
| Extension + state + BE | 10.9% exact-bar | 2.8 | +0.0418R |

Интерпретация:

- raw universe почти найден;
- exact-bar пока не найден;
- state machine резко снижает частоту и выбирает первый доступный бар, тогда как vendor часто ставит arrow позже/глубже в том же эпизоде.

Это намного сильнее прежнего вывода «OHLCV replica невозможна». Корректный вывод теперь такой: **raw family восстановлена; неизвестен selection rule внутри episode**.

### 2.2 Per-mode state gates

Наблюдение DOGE 1h в симуляторе:

- Risk освободился и выдал SELL первым;
- Safe выдал его спустя несколько баров;
- Standard не выдал, потому что предыдущая Standard-сделка оставалась открыта.

Это объясняет различия режимов без трёх независимых signal engines:

```text
shared extension candidates
        ↓
Safe state gate / Risk state gate / Standard state gate
        ↓
mode-specific entry and management
```

### 2.3 Геометрия сделок

Подтверждено по LINK 2h и SOL 1h:

```text
stop = 2 * add - entry
```

Отношения:

- Safe stop distance / step: 2.002 и 2.000;
- Risk: 1.986 и 1.987;
- `step_safe / step_risk`: 1.431 и 1.430.

Standard:

- `stop = entry - 1.75 * step` для long, зеркально для short;
- `TP = entry + 2 * step`;
- около **1.145R** без add;
- около **2.005 RR** при заполненном add;
- без partial fix.

Safe/Risk:

- 25% partial на динамической Mean;
- full target на динамической противоположной полосе;
- BE-связанная логика после partial;
- точная формула абсолютного `step` пока не найдена.

### 2.4 Семантика статистики

Vendor WR — это не процент прибыльных сделок.

Сделка, которая взяла partial, а затем ушла в stop/BE, идёт в строку `Partial` и считается win. Поэтому:

```text
vendor WR = reached first target at least once
```

Это согласуется с нашим ранним выводом ECON0: dashboard-классы нельзя использовать вместо realised net R.

---

## 3. Что говорят forward-данные

Главный актив ветки — `ci-results/fwd1-telegram-forward-audit.json`:

- 1 775 Telegram signals распарсено;
- 736 оценено в FWD1;
- примерно 660 пригодных non-repaintable arrows с точными timestamps образуют уникальный эталон.

FWD1 base P25/S12:

| Срез | n | Mean gross R | Vendor-style WR |
|---|---:|---:|---:|
| Все | 736 | +0.0141R | 88.2% |
| Hourly | 629 | +0.0006R | 87.3% |
| 2h | 162 | +0.0310R | 85.8% |
| 4h | 59 | -0.0794R | 83.1% |
| Scalp mostly 15m | 107 | +0.0935R | 93.5% |

Выводы:

1. Высокий WR снова сосуществует с почти нулевой hourly expectancy.
2. Scalp выглядит положительно, но там присутствует selection layer автора: он сам выбирал монеты для публикации.
3. VAR1 add-конфигурация не пережила forward OOS и хуже base на всех срезах.
4. Это первый действительно неперерисовываемый сигналовый аудит, поэтому его вес выше старых исторических экспортов.

---

## 4. Как Fable соотносится с ECON0

Здесь нет противоречия; работы отвечают на разные вопросы.

### Fable доказал

- raw extension family близка к vendor arrows;
- режимная cadence объяснима state gates;
- геометрические отношения почти восстановлены;
- точная формула step остаётся неизвестной.

### ECON0 доказал

- единый corrected management исправляет ложную экономику Partial;
- но на свежем BTC 2h test сам GGI был отрицателен и хуже matched null;
- historical/full-period GGI лучше, чем свежий test, то есть есть regime/time decay;
- нельзя обучаться слепо на arrow proximity без economic mask.

### Важное ограничение GEO1

GEO1 получил около `-0.16R/trade`, но использовал guessed step через реконструированные зоны. Сам отчёт признаёт, что абсолютный stop rate оказался примерно в 2.4 раза выше vendor tables. Поэтому число `-0.16R` нельзя считать финальной оценкой vendor economics.

Правильный статус:

- направление вывода о хрупкости WR подтверждено;
- точный mean R vendor geometry **ещё не определён**, пока не решён step;
- после калибровки нужен повтор GEO1 с корректным risk denominator для split entry.

---

## 5. Наш собственный edge: где сейчас лучший сигнал

Самое интересное экономическое открытие Fable — не точная копия arrows, а ZC5:

```text
OWN1 1h trigger
+ causal 4h liquidity pools
+ pool rank < 2/3
+ entry strictly inside band
+ pool swept within 24h
```

Результат:

- 54 сделки из 2 113 кандидатов, coverage 2.6%;
- mean gross `+0.1789R`;
- 98.1% vendor-style WR;
- один clean stop;
- bootstrap p=0.026 против out-zone.

Но это не готовая стратегия:

- только 54 сделки;
- один 14-месячный период;
- 12 majors;
- gross, без fees;
- правило было найдено в исследуемом окне, поэтому нужен новый frozen forward period.

Тем не менее это сейчас более перспективная линия, чем попытка зарабатывать одной лишь точной копией arrows. Она говорит, что value layer, вероятно, находится в **контексте ликвидности**, а arrow/extension — timing layer.

---

## 6. Что делать дальше

### Шаг 1 — добить формулу step

Нужно 3–4 новых **Safe mode** примера с ценовыми тегами:

- symbol и timeframe;
- side BUY/SELL;
- entry;
- add;
- желательно stop;
- время signal candle;
- screenshot с Apex/Mean/bands в тот же момент;
- настройки режима без изменений.

Подойдут любые монеты. Лучше взять разные цены и волатильность, чтобы отличить:

- процент цены;
- ATR/TR-family;
- собственную ширину Apex;
- расстояние до конкретной внутренней/внешней линии;
- quantized tick/rounding rule.

Минимум 3 независимых примера нужен не «для среднего», а чтобы идентифицировать формулу, которая переносится между активами.

### Шаг 2 — восстановить selection rule внутри extension episode

Не надо снова перебирать произвольные candle gates. Надо построить episode table:

- все raw extension bars одного эпизода;
- какой по счёту бар отмечен vendor;
- depth/penetration;
- новый extreme или failed continuation;
- volume trajectory;
- Mean/band slope;
- состояние mode slot;
- момент освобождения previous trade через Partial/BE/Full/Stop.

Цель — объяснить не весь market, а только выбор одного бара среди уже найденного 73–89% raw universe.

### Шаг 3 — GEO3 после калибровки

После решения step:

1. Перезапустить vendor arrows на точной геометрии.
2. Считать split entry правильно:
   - stop до add — риск только первой половины;
   - stop после add — `-1R` относительно полного planned risk.
3. Отдельно показать Safe/Risk/Standard.
4. Добавить fees/slippage sensitivity.
5. Сравнить stats rows и true net R, не только WR.

Это даст финальный ответ, есть ли edge в vendor arrow + vendor management.

### Шаг 4 — наш causal engine

Параллельно, не дожидаясь perfect replica:

- оформить ZC5 как incremental causal pool-state module;
- заменить OWN1 на raw extension trigger и сравнить оба timing layers;
- заморозить rule и thresholds;
- проверить на новых месяцах и новых активах;
- считать costs, exposure, overlap, best-1%-removed и per-symbol concentration.

Нужен A/B:

```text
A: OWN1 + ZC5 context
B: extension + ZC5 context
C: vendor arrows + тот же context
D: matched causal null + тот же context
```

Тогда станет ясно, нужен ли точный vendor bar или достаточно нашего causal extension timing.

### Шаг 5 — anti-repaint продолжать отдельно

BNB 2h snapshot-series уже показал отсутствие исторических изменений между двумя экспортами. Следующий snapshot нужен не по расписанию, а на management event/закрытии активной сделки. Это проверяет отображение и state release, а не формулу raw signal.

---

## 7. Что делать с Git прямо сейчас

### Что уже сделано

- Remote Fable получен.
- Обе линии сохранены страховочными ветками.
- Наши два коммита перебазированы поверх Fable.
- Конфликтов нет.
- Полный suite и TypeScript проходят.

### Что не делать

- Не делать `git stash drop`: stash пуст.
- Не делать merge-коммит поверх старой расходящейся истории: rebase уже аккуратно решил задачу.
- Не делать `git reset --hard origin/...`: это выкинет ECON0.
- Не удалять `research/independent-reversal-edge` и архив FWD1.
- Не использовать force push.

### Что осталось перед push

ECON0 rerun изменил generated JSON, а этот объединённый отчёт — новый файл. Их нужно проверить и сделать обычный новый коммит. После этого:

```bash
git status
git diff --stat
git add ci-results/ggi-econ0-common-corrected-replay-v1.json outputs/ggi-fable-sol-consolidated-report-2026-08-06.md
git commit -m "research: reconcile Fable findings with ECON0"
git push origin research/independent-reversal-edge
```

Push теперь должен быть fast-forward, потому что локальная ветка содержит remote `71b6dea` и находится только ahead. Если Fable успеет снова запушить между commit и push, повторить:

```bash
git fetch origin
git rebase origin/research/independent-reversal-edge
git push origin research/independent-reversal-edge
```

Не нужно stash, если `git status` показывает только осознанные изменения отчёта/result JSON.

---

## Финальная позиция

Фраза «почти восстановили сигнал» теперь обоснована, если точно понимать, что восстановлено:

- **семейство raw trigger — с высокой уверенностью;**
- **режимный state gating — с высокой уверенностью;**
- **относительная геометрия — с высокой уверенностью;**
- **абсолютный step — не решён;**
- **точный arrow bar внутри episode — не решён;**
- **устойчивый net edge vendor системы — не доказан.**

Поэтому правильный следующий ход не «ещё один огромный поиск». Он узкий:

1. собрать 3–4 Safe entry/add samples;
2. решить step;
3. воспроизвести selection внутри extension episode;
4. перезапустить точную экономику;
5. параллельно заморозить и forward-проверять наш extension + causal liquidity context.

Это уже не блуждание. Остались две конкретные неизвестные, из которых step закрывается скриншотами, а exact-bar selection — специальной episode-таблицей на уже сохранённом FWD1 архиве.
