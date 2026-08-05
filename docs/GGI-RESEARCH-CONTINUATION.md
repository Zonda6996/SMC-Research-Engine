# GGI Buy/Sell — единая точка продолжения исследования

Обновлено: 2026-08-05 — завершены corrected audits, начата live BNB 2h Safe SELL серия и подготовлен новый независимый Claude discovery brief

Этот документ является главной точкой восстановления контекста для следующего чата. Сначала читать его, затем при необходимости обращаться к JSON и подробным отчётам.

## 1. Цель

Восстановить причинную и переносимую модель приватного GGI Buy/Sell:

1. реальные BUY/SELL labels;
2. Safe/Risk/Standard stop, add и exits;
3. dashboard accounting;
4. после reconciliation gross-механики — оценка реальной прибыльности;
5. комиссии/slippage уже проверены sensitivity tiers `0/3/6/10 bps` на каждый one-way fill; venue-specific funding пока не включён.

Предыдущий независимый G1 не является моделью GGI и не должен использоваться как вывод о прибыльности GGI.

## 2. Подтверждённые данные

Получено восемь ISO TradingView CSV:

- BTC perpetual: 15m, 1h, 2h;
- ONDO perpetual: 15m, 1h, 2h;
- BNB perpetual: 3m;
- SP500: 1m.

Всего:

```text
100,687 bars
356 exact GGI labels
Shape 0 = BUY
Shape 1 = SELL
```

BTC 15m содержит 47 BUY + 38 SELL = 85 labels. Это точно совпадает с `Trades = 85` в показанной таблице GGI, поэтому BTC 15m является единственной полностью совмещённой dashboard-ячейкой текущего этапа.

## 3. Согласованная механика режимов

### Safe

- BUY/SELL открывает сделку;
- stop динамический, зависит от волатильности и, возможно, дополнительной геометрии;
- initial position: 50%;
- optional add: остальные 50% примерно посередине entry–stop;
- после фактического add рабочая точка позиции смещается на `avg`; при равных долях это `avg = (entry + add) / 2`;
- дальнейшие расчёты позиции, blended risk и BE должны учитывать `avg`, а не только первоначальный entry;
- при касании moving Mean фиксируется 25%;
- сразу после partial сделка переводится в BE;
- до partial одновременно активны stop и optional add;
- full fix — касание moving opposite Inner boundary, то есть начала противоположной зоны.

### Risk

- BUY/SELL timestamps обычно совпадают с Safe;
- Mean partial и Inner full target совпадают с Safe;
- stop короче;
- add расположен относительно собственного Risk stop и поэтому отличается от Safe;
- статистика отличается преимущественно из-за management, не из-за другого entry generator.

### Standard

- частичного фикса нет;
- stop и add отличаются от Safe/Risk;
- full target фиксированный и определяется доступным reward/risk;
- без add результат около 1.14R;
- с add около 2R;
- Standard принимает не все Safe/Risk candidates, вероятно из-за RR feasibility;
- controlled CSV-пары показали, что Standard в основном является stateful acceptance gate, а не независимым генератором сигналов.

## 4. Dashboard accounting — теперь зафиксировано

Таблица использует взаимоисключающие terminal categories:

```text
Trades = Partial + Stop + Full fix
Winrate = (Partial + Full fix) / Trades
Stop = Trades - Partial - Full fix
```

`Add`, вероятнее всего, не учитывается отдельным полем и не изменяет counts таблицы. Он влияет на цену позиции и R, если трейдер его использует, но не на число Trades/Partial/Stop/Full fix.

Для BTC 15m:

```text
Trades   = 85
Partial  = 24
Stop     = 17
Full fix = 44
Winrate  = (24 + 44) / 85 = 80.0%
```

Неясность предыдущего этапа была не в этой арифметике. Не совпадала причинная классификация отдельных сделок при буквальном OHLC replay:

- немедленный wick-based BE после Mean давал слишком много Partial и слишком мало Full;
- отключение буквального BE и stop около `1.5 × entry-to-opposite-Outer distance` давало ровно 85 Trades, 80.0% WR и 17 Stop, но `20 Partial / 48 Full` вместо `24 / 44`.

После уточнения пользователя вариант `no BE` признан только диагностическим fit, а не допустимой механикой. Обязательное правило: **partial достигнут -> сделка переведена в BE**.

Оставшиеся варианты, которые нужно различить:

1. BE стоит на initial entry или на blended average после optional add;
2. BE срабатывает по wick touch или по close/confirmed cross;
3. BE активируется внутри свечи partial либо начиная со следующей свечи;
4. при одной свече, затронувшей Mean, BE и Full, какой event имеет приоритет;
5. предупреждение автора про impulsive target/BE может быть отдельным dashboard edge case.

## 5. Текущий код и результаты

Реализовано:

- ISO timestamps с timezone offsets;
- trailing Volume;
- duplicate Shapes columns;
- opt-in session gaps;
- startup-invalid Apex rows;
- next-open и signal-close entry;
- moving Mean/Inner targets;
- 50/50 add;
- ATR, Apex band, swing и combined stop families;
- stop-first/target-first OHLC ambiguity;
- отдельный Standard fixed-target replay;
- gross R без funding/fees/slippage.

Ключевые файлы:

- `ci/research/lib/exactIndicatorExport.ts`;
- `ci/research/lib/ggiGrossReplay.ts`;
- `ci/research/runGgiGrossReplay.ts`;
- `tests/exactIndicatorExport.test.ts`;
- `tests/ggiGrossReplay.test.ts`;
- `ci-results/ggi-gross-replay-grid-v1.json`;
- `ci-results/ggi-gross-reconciliation-v1.md`;
- `ci-results/ggi-next-verdict-v1.md`.

Verification:

```text
417 tests passed
0 failed
TypeScript clean
```

### Active setup screenshot batch v1

Оцифрованы 11 скриншотов:

- ONDO 15m BUY: Safe / Risk / Standard;
- LTC 2h BUY: Safe / Risk;
- AVAX 1h BUY: Safe / Risk / Standard;
- BNB 15m SELL: Safe / Risk / Standard.

Артефакты:

- `ci-results/ggi-active-setups-v1.json` — машинный manifest;
- `ci-results/ggi-active-setups-v1.md` — таблицы и формульные проверки.

Подтверждённые black-box отношения:

```text
add ≈ midpoint(entry, stop)
RiskStopDistance / SafeStopDistance ≈ 0.694
```

Risk/Safe ratio на четырёх matched pairs:

```text
ONDO 15m BUY  0.6953
LTC 2h BUY    0.6935
AVAX 1h BUY   0.6924
BNB 15m SELL  0.6955
```

Это уже не слабая визуальная гипотеза: один и тот же ratio переносится между четырьмя активами, тремя timeframe и обоими направлениями. Наиболее вероятно, что Risk применяет фиксированный multiplier около `0.694` к общей базовой stop distance Safe. Сама базовая формула Safe stop пока не идентифицирована.

По Standard получен кандидат:

```text
StandardStopDistance ≈ 0.74 × SafeStopDistance
```

на ONDO/AVAX/BNB. Выборка пока мала, поэтому считать это рабочей гипотезой, не доказанным правилом.

Standard target независимо подтверждён:

```text
без add: около 1.14R от initial entry/stop
после 50/50 add: около 2R от blended average/stop
```

AVAX и BNB дают практически ровно 2.00R после add; ONDO даёт около 2.04R из-за округления отображаемых уровней.

## 6. Новые exact CSV matches и Safe-stop diagnostic

Пользователь предоставил четыре CSV и точное время сигналов. Все четыре совпали с ожидаемыми GGI labels:

| Asset | TF | Signal (+05:00) | Direction | Label |
|---|---|---|---|---|
| ONDOUSDT.P | 15m | 2026-08-03 08:45 | BUY | Shape0=1 |
| AVAXUSDT.P | 1h | 2026-08-02 02:00 | BUY | Shape0=1 |
| LTCUSDT.P | 2h | 2026-08-02 05:00 | BUY | Shape0=1 |
| BNBUSDT Spot | 15m | 2026-08-03 03:45 | SELL | Shape1=1 |

Отчёты:

- `ci-results/ggi-csv-signal-match-v1.md`;
- `ci-results/ggi-csv-signal-match-v1.json`.

На этих четырёх matched setup Safe stop distance из screenshots:

```text
ONDO 0.0256
AVAX 0.621
LTC  5.09
BNB  11.69
```

Простая causal-проверка дала первый переносимый volatility candidate:

```text
Safe stop distance ≈ 12.3 × SMA(True Range, 55)
```

Множители `distance / ATR55` равны `12.254`, `12.474`, `12.503`, `11.935`; CV около 1.85%, ошибки фиксированного `12.3 × ATR55` от +0.37% до +3.06%. Это сильный диагностический результат, но пока не идентификация private formula: только 4 setup, уровни на screenshots округлены, а exact smoothing/волатильность индикатора могут отличаться.

На этих же rows Apex-only кандидат не переносится: Safe distance / entry-to-opposite-Outer равно примерно `4.77`, `2.71`, `2.10`, `2.30`. Предыдущий `1.5 × entry-to-opposite-Outer` остаётся только dashboard-fit diagnostic и не должен считаться stop formula.

## 7. Independent validation batch v2

Пользователь предоставил второй пакет: AAVE, LINK, DASH, 1000PEPE, DOGE, INJ и TAO. После получения дополнительного PEPE 1h CSV все основные screenshots сопоставлены с exact GGI labels.

Артефакты:

- `ci-results/ggi-validation-v2.md`;
- `ci-results/ggi-validation-v2.json`.

Замороженный candidate из v1:

```text
SafeDistance = 12.3 × SMA(TrueRange,55)
```

не прошёл независимую валидацию как финальная формула Safe: ошибки составили AAVE +17.9%, LINK +4.85%, DASH -1.77%, PEPE 15m -5.81%, PEPE 1h +15.14%, DOGE -9.26%, INJ +33.6%, TAO -8.45%. Поэтому `12.3 × SMA(TR,55)` остаётся baseline волатильности, но не реконструкцией private stop.

При этом две важные зависимости устойчиво подтвердились:

```text
RiskDistance ≈ 0.694 × SafeDistance
Add ≈ midpoint(Entry, Stop)
```

Risk/Safe ratio подтвердился на LINK, DASH, PEPE, DOGE и TAO; AAVE является аномальной/state-affected записью с ratio около 0.715 и add fraction около 0.393. TAO визуально подтверждает фактический add (`add 2x`), поэтому blended average обязателен.

Новые mode-state наблюдения:

- INJ: текущий Risk screenshot соответствует более раннему SELL, чем текущий Safe; это может быть state/gating/active-position difference, но пока не доказанный баг.
- LINK: Safe/Risk показывают BUY 02.08 05:00, а Standard — более ранний BUY 28.07 19:00, уже завершённый в Safe/Risk. Это усиливает вывод, что Standard — stateful acceptance gate.
- PEPE 1h: matching CSV получен; screenshots точно соответствуют SELL `2026-08-02 13:00 +05`. Entry `0.002912`, Safe/Risk stop `0.003242/0.003141`, Safe/Risk add `0.003077/0.003026`, partial `0.002811`, full `0.002649`. Получено `Risk/Safe = 0.6939` и midpoint add `0.5000/0.4978`; ATR55 baseline переоценивает Safe distance на `15.14%`.

## 8. Data integrity

- BTC 2h/1h/15m и ONDO 1h/15m непрерывны;
- ONDO 2h: первые 134 строки имеют startup-invalid ordering полос, сигналов на них нет; эти строки не чинить и не использовать как нормальную геометрию;
- BNB 3m: четыре одиночных отсутствующих бара;
- SP500 1m: session/day/weekend gaps не считать crypto-style missing candles;
- оригиналы в Downloads не изменять.

## 9. Что нужно собрать на активных сетапах

### Приоритет

Самый полезный материал — **один и тот же актив, timeframe и активный сигнал, снятый подряд во всех трёх режимах**:

1. Safe;
2. Risk;
3. Standard.

Не нужен именно BTC. Подходит любой ликвидный perpetual или другой рынок, где прямо сейчас есть активный сигнал.

Приоритет timeframe:

1. 2h — основной практический старший TF;
2. 1h;
3. 15m;
4. затем 5m/3m/1m для проверки нормализации.

### Минимум для первого шага

Первый приоритет — текущий активный `ONDOUSDT.P 15m BUY` из предоставленного setup screenshot. Для него получить подряд:

1. Safe;
2. Risk;
3. Standard.

На каждом режиме сохранить одинаковый масштаб и по возможности один и тот же момент/сигнал. Это даст первый matched triple для прямого сравнения stop/add/target.

После него собрать хотя бы:

- ещё 4 matched Safe/Risk setups;
- из них по возможности 2–3 с доступным Standard;
- оба направления: минимум 2 BUY и 2 SELL;
- минимум два timeframe;
- желательно 2h/1h и 15m;
- желательно 3 разных актива.

Для уверенной формулы stop лучше 12–20 matched setups, но не нужно ждать полного набора: присылать можно пакетами по одному активному сигналу.

### Что должно быть на каждом скриншоте

Обязательно:

- полное имя символа и биржи/feed;
- timeframe;
- выбранный режим Safe/Risk/Standard;
- направление BUY/SELL;
- timestamp сигнальной свечи;
- видимая ценовая шкала;
- entry;
- stop;
- add;
- Mean/partial level для Safe/Risk;
- full target;
- несколько десятков свечей слева от сигнала;
- текущая свеча и состояние сделки.

Желательно:

- Data Window или курсор на каждой линии, чтобы видеть точное число, а не оценивать по пикселям;
- один скрин общего контекста и один увеличенный скрин уровней;
- не менять масштаб и окно между Safe/Risk/Standard;
- записать числа текстом рядом с сообщением.

Шаблон сообщения:

```text
Symbol/feed:
Timeframe:
Mode:
Direction:
Signal timestamp + timezone:
Signal candle OHLC (если видно):
Entry:
Stop:
Add:
Mean/partial:
Full target:
Current price:
State: active / add hit / partial hit / closed
Add actually used by trader: yes / no
Notes:
```

### Почему нужны именно эти поля

Из одного matched triple можно вычислить:

- stop distance в ATR;
- stop distance относительно Inner/Outer width;
- stop distance до signal/episode swing;
- Safe/Risk stop ratio;
- точное положение add как долю entry-stop;
- Standard target R;
- зависит ли stop от режима линейным multiplier;
- использует ли формула signal candle или более длинное volatility state.

## 10. Следующий план

### Этап A — signal-first проверка преимущества

Точная private stop formula больше не является обязательным условием для первичной проверки GGI. Сначала нужно ответить, содержат ли реальные BUY/SELL labels направленное преимущество и остаётся ли gross-result положительным в широком диапазоне разумных volatility stops.

1. Вход только next-bar open.
2. Event study без stop: direction-adjusted forward return, MFE и MAE на 6h/12h/24h/48h.
3. Сравнение с time-matched random-entry null при сохранении числа LONG/SHORT и timeframe.
4. Robustness grid, зафиксированный до запуска: Safe stop `8/10/12/14/16 × SMA(TR,55)`, Risk = `0.694 × Safe`; midpoint add, moving Mean partial, next-bar BE at blended average, moving opposite Inner full target.
5. Проверять не максимальный WR одной точки, а устойчивость знака expectancy по соседним stop-множителям, активам и timeframe.
6. Dashboard WR использовать как evidence корректной классификации, но не как замену expectancy: Partial может быть малой прибылью/BE, а Standard уже показывал отрицательный Total R при приемлемом win rate.

### Результат frozen low-timeframe и 5m state audit v1

Проверены уже имеющиеся exact exports BTC/ONDO 15m, BNB 3m и SP500 1m тем же frozen envelope, без refit. В 20 stop-first конфигурациях pooled positive mean/PF > 1 получено в `17/20`: ONDO 15m — `19/20`, BNB 3m — `20/20`, SP500 1m — `20/20`, BTC 15m — `0/20`. Central Safe 12 no-add pooled: `234 trades`, mean `+0.183%`, PF `1.604`; но BNB 3m средний результат по grid всего около `+0.048%`, поэтому fees/slippage могут легко его съесть.

Поэтому результат `2h сильнее 1h` нельзя трактовать как `TF < 1h не работают`. Low-TF уже имеет положительные примеры, включая ONDO 15m и BNB 3m, но BTC 15m остаётся отрицательным. Полный отчёт: `ci-results/ggi-low-tf-audit-v1.md`, machine result: `ci-results/ggi-low-tf-audit-v1.json`.

Пять 5m CSV содержат общую последовательность BUY/SELL Shapes; Safe/Risk не меняют labels. Пользователь подтвердил: пока позиция активна, следующая общая GGI метка не появляется; dashboard считает текущие 20k bars. Safe/Risk screenshots правильно собраны для сравнения разных management outcomes на одних сигналах. Различие числа завершённых Trades связано с dashboard window, текущей активной сделкой и разной длительностью/завершённостью Safe/Risk позиций, а не с mode-specific Shapes.

Frozen diagnostic на общих labels дал только `4/20` pooled положительных конфигураций. Central Safe 12 no-add дал mean `-0.0024%`, PF `0.991`, но terminal outcomes `294 Partial / 44 Stop / 77 Full` против реального Safe dashboard pooled `131 Partial / 66 Stop / 214 Full`. Текущая BE/full semantics массово превращает настоящие Full в Partial/BE, поэтому отрицательный proxy PnL не является verdict против GGI. Safe 5m dashboard на пяти активах: `411 trades`, `83.9% WR`, `214 Full / 66 Stop`; минимальный pooled average Full для break-even при нулевом Partial всего `0.308R`. Полный исправленный отчёт: `ci-results/ggi-five-minute-holdout-v1.md`.

### Результат frozen multi-asset holdout v1

Получен независимый holdout из 10 максимальных TradingView Premium экспортов: ETH, SOL, XRP, AAVE и BNB на 1h/2h. Протокол был заморожен до просмотра результатов: next-bar open; Safe `8/10/12/14/16 × SMA(TR,55)`; Risk `0.694 × Safe`; midpoint add; moving Mean partial; BE со следующего бара на blended average; moving opposite Inner; без fees/funding/slippage.

В holdout было 909 raw labels и 908 пригодных replay trades. Pooled fixed-horizon signal-only event study не повторил исходный BTC/ONDO directional result: `-0.110%` на 6h, `-0.111%` на 12h, `-0.248%` на 24h и `-0.060%` на 48h; one-sided p-values для положительного edge составили `0.939/0.873/0.960/0.614`.

При этом moving-management replay остался положительным во всех 20 основных stop-first конфигурациях Safe/Risk × no-add/with-add; каждая имела pooled PF > 1. В leave-one-asset-out проверке все `20 × 5 = 100` агрегатов сохранили положительный equal-dataset mean и PF > 1. Худший случай — Risk `5.552 × TR55`, no-add, без SOL: только `+0.062%` equal-dataset mean и PF `1.022`.

Результат сильно зависит от timeframe, но не от одного актива:

- 2h: все 20 aggregate конфигураций положительны, 91/100 dataset×configuration ячеек положительны;
- 1h: только 6/20 aggregate конфигураций положительны при equal-dataset weighting;
- XRP 1h: 0/10 no-add и 2/10 with-add устойчивых положительных конфигураций;
- SOL 1h: 10/10 no-add и 10/10 with-add положительных конфигураций;
- Safe 12 no-add как центральная точка сетки дал `+0.756%`, PF `1.509` pooled, но не должен трактоваться как выбранный holdout параметр.

Корректный текущий вердикт: **GGI не доказан как готовая net-profitable система, но 2h moving-target management прошёл сильный gross holdout; 1h пока не подтверждён.** Положительный management при отрицательном fixed-horizon endpoint возможен из-за path-dependent раннего favourable excursion, moving Mean/Inner и partial→BE, но требует проверки non-overlap state machine, time-in-market, risk-normalization, repaint и clustered bootstrap.

Полный отчёт: `ci-results/ggi-multi-asset-holdout-v1.md`; machine result: `ci-results/ggi-multi-asset-holdout-v1.json`.

### Этап B — восстановление базовой Safe stop distance

1. Считать замороженный кандидат `12.3 × SMA(TR,55)` отвергнутым как финальную private formula; использовать его только как общий volatility baseline.
2. Не перебирать произвольные ATR-периоды и коэффициенты. До следующего расчёта зафиксировать малый набор интерпретируемых causal modifiers:
   - режим волатильности относительно более длинного прошлого окна;
   - expansion/contraction текущей Apex width;
   - положение entry и signal candle относительно Mean/Inner/Outer;
   - расстояние до причинного swing;
   - долгосрочный state, вычисленный только по прошлым барам.
3. На текущих matched observations проверить, объясняет ли один из этих modifiers структурные residuals baseline без asset-specific коэффициентов: AAVE/INJ требуют уменьшения baseline, DOGE/TAO — увеличения.
4. Валидировать выбранное правило на следующем независимом screenshot+CSV пакете без повторного fit.
5. Использовать уже подтверждённые ограничения как жёсткие cross-checks:
   - `add = midpoint(entry, stop)` для Safe/Risk и равных 50/50 долей;
   - `RiskDistance ≈ 0.694 × SafeDistance`;
   - Standard stop — отдельная гипотеза около `0.74 × SafeDistance`;
   - Standard target — около `1.14R` без add и `2R` после add.
6. AAVE держать отдельно как state-affected/uncertain observation до повторной проверки уровней.
7. PEPE 1h уже сопоставлен и включён в независимую проверку.
8. Восстановить active-position state machine Safe/Risk на INJ и acceptance state Standard на LINK, не смешивая stateful rendering с raw BUY/SELL label generator.

### Результат signal-first audit v1

Артефакты:

- `ci-results/ggi-signal-first-audit-v1.md`;
- `ci-results/ggi-signal-first-audit-v1.json`;
- runner `ci/research/runGgiSignalFirstAudit.ts`.

По шести длинным BTC/ONDO datasets получено 355 real labels. Pooled next-open directional event study дал `+0.275%` на 12h (`p≈0.047`) и `+1.049%` на 48h (`p≈0.0005`) против dataset-matched random-entry null. Эффект наиболее выражен на BTC 2h, ONDO 2h и ONDO 1h; BTC 15m отрицательный на 24h/48h.

Preregistered management envelope `Safe 8/10/12/14/16 × SMA(TR,55)` и соответствующий Risk multiplier `0.694` проверен с no-add и 50/50 midpoint add. Все 20 combinations дали положительную pooled gross expectancy и PF > 1, но результат неоднороден по dataset. Representative Safe 12 отрицателен на BTC 1h/15m и положителен на BTC 2h и всех ONDO TF. Add увеличивает positive-outcome rate, но в текущем gross model часто снижает mean return/PF.

Вердикт: signals/management выглядят promising, но ещё не validated из-за двух основных assets и отсутствия multi-asset holdout. Неудача точной ATR55 stop reconstruction не является отрицательным verdict для GGI.

### Этап C — terminal state-machine fidelity v1 завершён

Созданы:

- `ci/research/runGgiStateMachineFidelityV1.ts`;
- `ci-results/ggi-state-machine-fidelity-v1.json` — полный ledger 85 BTC 15m сделок, semantic grid и 5m transfer;
- `ci-results/ggi-state-machine-fidelity-v1.md` — выводы.

Без повторного подбора stop проверены Partial wick/close, Full wick/close, Full-first/BE-first, same-bar/next-bar/no literal OHLC BE и BE на entry/blended average.

Для BTC 15m найден точный terminal-count match:

```text
Dashboard: 85 Trades / 24 Partial / 17 Stop / 44 Full
Replay:    85 Trades / 24 Partial / 17 Stop / 44 Full
Rule:      Partial = wick touch Mean
           Full = close beyond moving opposite Inner
           Stop = initial stop, stop-first
           BE не исполняется как наивный OHLC wick stop
```

Прежний Full-by-wick replay давал `20 / 17 / 48`. Ровно четыре спорные сделки касались Inner тенью без close-confirmation и затем завершались Partial. Это объясняет swap `48→44 Full` и `20→24 Partial` без специальной dashboard поправки.

Реальный BE этим не опровергнут: пользователь подтвердил перевод в BE после Partial. Опровергнута только наивная реконструкция `после Mean любой OHLC wick до entry/avg немедленно завершает сделку`; она превращает слишком много реальных Full в Partial. Вероятны confirmed-state, lower-TF path или другая execution semantics.

Правило перенесено без refit на последние 20k bars BTC/ETH/SOL/XRP/BNB 5m. Перенос частичный: ETH/SOL Safe proxy точно совпал по Stop=14, BNB по Partial=26, BTC по Full отличается на 1; универсального полного совпадения нет. Основной остаток — private stop formula и дополнительная Full/BE state logic.

Также проверена трактовка active state. Дополнительный sequential/non-overlap фильтр поверх экспортированных common Shapes оставляет BTC 15m только 64 из 85 labels и поэтому ошибочен. Правило «пока сделка активна, новый сигнал не появляется» уже встроено в Shapes; повторно фильтровать их нельзя.

### Этап D — corrected gross/net profitability v2 завершён

Созданы:

- `ci/research/lib/ggiCorrectedReplay.ts`;
- `ci/research/runGgiCorrectedGrossAuditV2.ts`;
- `ci-results/ggi-corrected-gross-audit-v2.json`;
- `ci-results/ggi-corrected-gross-audit-v2.md`.

Замороженный corrected replay:

```text
common Shapes
next-bar open
Partial = wick Mean
Full = close beyond opposite Inner
stop-first
Safe = 8/10/12/14/16 × SMA(TR,55)
Risk = 0.694 × Safe
BE bounds = no literal OHLC BE / next-bar blended BE / next-bar entry BE
costs = 0/3/6/10 bps на каждый фактический one-way fill
```

Обработано 23 datasets и 60 grid cells. Центральный holdout Safe 12, no-add, next-bar entry BE:

```text
ETH/SOL/XRP/AAVE/BNB 1h+2h:
908 trades
mean gross +0.0296R
PF 1.278
base-cost mean +0.0199R
base-cost PF 1.185
block-bootstrap q05 -0.0009R
```

Критически важен split по timeframe:

```text
2h: 517 trades, +0.0669R, PF 1.759
    после 6 bps/fill: +0.0615R, PF 1.660
    break-even one-way cost ≈ 68.6 bps
    все 5 holdout assets положительны

1h: 599 trades, +0.0013R, PF 1.046
    после 6 bps/fill: -0.0057R, PF 0.950
    break-even one-way cost ≈ 9 bps

5m: pooled central gross ≈ -0.0091R, PF 0.929
    после 6 bps/fill ≈ -0.0703R

3m/1m: отдельные gross-positive proxy результаты не переживают 6 bps tier
```

Текущий profitability verdict:

```text
2h: PROMISING
1h: WEAK/HETEROGENEOUS
5m: UNRESOLVED и отрицателен в central corrected proxy
3m/1m: COST-UNVIABLE under current assumptions
```

Это не exact private-strategy PnL: Safe stop всё ещё volatility envelope, а BE представлен bounds. Funding пока не включён из-за необходимости venue-specific settlement data и корректных holding intervals.

### Этап E — anti-repaint audit готов, live data ожидаются

Созданы:

- `ci/research/compareGgiExportSnapshots.ts`;
- `tests/ggiSnapshotDiff.test.ts`;
- `ci-results/ggi-anti-repaint-collection-protocol-v1.md`.

Инструмент сравнивает sequential CSV по timestamp и отделяет historical Shape changes, band recalculation, OHLC changes и изменения последних открытых баров. Возможные verdict:

```text
no-historical-change-detected-in-this-pair
historical-band-recalculation-detected
historical-shape-repaint-detected
```

Эмпирического verdict пока нет: пользователь должен собрать по 4–10 последовательных exports для одного 2h и одного 5m/15m symbol.

### Этап F — Safe-stop causal modifier audit завершён

Созданы:

- `ci/research/runGgiSafeStopModifierAuditV1.ts`;
- `ci-results/ggi-safe-stop-modifier-audit-v1.json`;
- `ci-results/ggi-safe-stop-modifier-audit-v1.md`.

Проверены десять causal scalar families без asset-specific fit. Baseline, обученный на исходных четырёх observations:

```text
SafeDistance = 12.291783 × SMA(TR,55)
validation MAE = 1.2368 ATR55-множителя
max error = 3.0837 ATR55-множителя
```

Лучший scalar — `directionalMeanGapAtr55`:

```text
SafeDistance = ATR55 ×
  (12.666599 - 0.076980 × directionalMeanGapAtr55)
validation MAE = 1.1982
max error = 2.9744
improvement = только 3.12%
```

Вердикт: ни один проверенный modifier не дал meaningful improvement; exact Safe stop остаётся неидентифицированным. Кандидат сохранён только со статусом `candidate_not_validated` для неизменяемого теста на будущем полностью новом пакете 8–12 matched setups. Acceptance gate: минимум 25% MAE improvement, отсутствие direction/timeframe bias и max clean distance error <12%.

### Этап G — provisional go/no-go

Полный документ: `ci-results/ggi-go-no-go-verdict-v1.md`.

```text
2h Safe no-add: CONDITIONAL GO только в forward validation
1h: NO-GO как универсальный режим
5m: NO-GO по текущей реконструкции
3m/1m: NO-GO при текущих costs
Standard: HOLD / недостаточно corrected evidence
Exact GGI replica: NOT ACHIEVED
```

Final GO требует: live anti-repaint series, минимум 100 завершённых 2h forward trades, положительный результат после реальных fees/slippage/funding, отсутствие asset concentration и causal reconciliation no-add BE.

### Текущая live-серия BNB 2h Safe

Начата причинная серия по активному `BYBIT:BNBUSDT.P 2h` SELL:

```text
Signal: 2026-08-05 07:00 +05
Mode: Safe
Snapshot #1: 2026-08-05 11:55 +05
CSV: ci-results/ggi-snapshot-bnb-2h-2026-08-05-1155.csv
Manifest: ci-results/ggi-snapshot-bnb-2h-manifest-v1.json
Signal row: Shapes[1] = 1
State: active
```

Приблизительные уровни screenshot: Entry `598.1`, Add `621.5`, Partial/Mean `583.5`, Full `562.4`. Следующий snapshot нужен после закрытия 13:00 свечи, затем при первом management event. Главная ценность серии — causal BE/management reconciliation; anti-repaint является secondary safety check.

### Актуальный внешний research brief

Единственный актуальный prompt для Claude:

```text
docs/CLAUDE-GGI-NEXT-DISCOVERY-PROMPT.md
```

Он требует сначала прочитать весь corrected GGI context, предложить одну новую causal hypothesis, preregister test design и не писать код до одобрения Никиты. Старые V0 и H2/H3 correction prompts удалены как завершённые/устаревшие.

## 11. Правила, которые нельзя нарушать

- Не выдавать best-fit stop за доказанную формулу автора.
- Не смешивать Safe/Risk с Standard.
- Не использовать dashboard percentages как exact targets, если period/count не совпадает с CSV.
- Не включать fees/funding/slippage до gross reconciliation.
- Не восстанавливать скрытый BUY/SELL trigger раньше management, потому что exact labels уже доступны.
- Не применять отрицательный G1 verdict к реальному GGI.
