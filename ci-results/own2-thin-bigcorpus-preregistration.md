# OWN2-thinned big-corpus — preregistration (FROZEN)

> Заморожено до acquisition и до просмотра любых исходов. Один конфирматорный тест единственной
> заранее заданной руки: канонический OWN2 + режимо-независимое прореживание (A1) + масштаб стопа
> вендора + канон-менеджмент с добором. Терминальный эксперимент: результат принимается любым.
>
> Решения автора (2026-08-22): правило вселенной «топ-25 по обороту» — ОК; стоп — через глобальную
> step-константу с медианной дистанцией 1.9% цены (label-free); менеджмент — частичка у mean +
> полный тейк у внутренней полосы + ДОБОР ВКЛЮЧЁН; терминальность принята.

## 1. Мотивация

Все OOS-проверки линии Reversal после RE17 упирались в мощность: точечные оценки thinning-руки
положительны (RE24c: 3/4), но CI пересекает ноль из-за N=39–74 на серию. Настоящий прогон даёт
корпус с N в тысячах: либо pooled-CI отрывается от нуля (GO), либо линия закрывается окончательно
(KILL) с пруфом адекватной мощности.

## 2. Вселенная (механическое правило, без выбора по PnL)

- Источник: Binance USD-M futures (`fapi`), контракт type PERPETUAL, quote USDT, status TRADING.
- Cutoff данных: **2026-08-22T00:00:00.000Z** (фиксирован до acquisition). Свечи: полная доступная
  история 1h до cutoff (последний ЗАКРЫТЫЙ бар строго раньше cutoff).
- Возраст листинга: `onboardDate <= cutoff − 365 дней`.
- Исключаются символы, тронутые прежними исследованиями (полный явный список):
  BTCUSDT, ETHUSDT, SOLUSDT, XRPUSDT, BNBUSDT (пул B1/D);
  DOGEUSDT (E3 in-sample, RE25b); AAVEUSDT, ARBUSDT, ENAUSDT, OPUSDT, SUIUSDT (E3 OOS);
  LDOUSDT, AVAXUSDT, ONDOUSDT, VIRTUALUSDT (вендор-корпус автора, RE9–RE25b);
  ADAUSDT, LINKUSDT (RE25b, S1); ZECUSDT, 1000PEPEUSDT, BOMEUSDT (S4 holdout).
- Ранг: сумма `quoteVolume` дневных свечей за [cutoff−30d, cutoff) (trailing 30 дней).
- Берутся первые **25** символов по рангу после исключений.

## 3. Acquisition и QA (до любых исходов)

- Свечи 1h: официальные архивы data.binance.vision (monthly + daily fallback), кэш `tmp/klines-cache`;
  funding: официальный `fapi/v1/fundingRate` (+архивы), фактическая cadence без синтетики.
- Манифест: source URLs/типы, SHA-256 каждого файла, row counts, actual UTC bounds, аудит
  дубликатов/немонотонности/OHLC/volume/пропусков часовых баров. Манифест замораживается SHA-256
  до прогона калибровки/реveаl.
- Механические QA-дропы символа (по данным, не по исходам): malformedRows>0 ИЛИ не-монотонность
  ИЛИ duplicateTimestamps>0 ИЛИ missingHourlyBars>0 ИЛИ ohlcInvalid>0 ИЛИ volumeInvalid>0 ИЛИ
  строк <20000. После дропов должно остаться ≥20 символов, иначе `BLOCKED DATA`. Подмены запрещены.

## 4. Замороженная рука (единственная)

- Сигнал: канонический OWN2 — `detectArrowSignalCandidates(candles, {}, { minimumRelativeVolume: 1.4 })`
  (дефолты движка: warmup 200, rvPeriod 20, distMean 3%, penetrationInner −0.35). Явная передача
  relVol=1.4 обязательна (урок E1).
- Допуск: `admitArrowSignals(candidates, ARROW_SIGNAL_SPACING_BARS = 180)` — greedy min-spacing в
  барах, вендор-якорь плотности (A1; шаг по верности, не по PnL).
- Сделки: `replayAdmittedArrowSignals(candles, bands, admitted, 'safe', cfg)` — каждая допущенная
  стрелка = независимая сделка, вход next-open, conservative stop-first внутри бара (канон).
- Менеджмент (канон safe): management `dynamic-partial`, partialFraction 0.25 у движущейся mean;
  полный тейк у противоположной внутренней полосы; **добор включён** (`addEnabled: true`,
  add = entry ∓ step); `fullFixAtMean: false`; maxHoldingBars 2000; postExitBars (не используется
  при admitted-реплее); risk-unit oneR — канонический (`|averageFullEntry − stop| × 2` при доборе).
- Стоп: одна ГЛОБАЛЬНАЯ константа `stopSteps*`, определённая label-free правилом:
  медиана по всем допущенным сигналам корпуса отношения `step_i / entry_i` равна `0.019 / stopSteps*`,
  т.е. `stopSteps* = 0.019 / median(step_i / entry_i)`; `entry_i` = open бара signalIndex+1,
  `step_i = 5.5 × atr200_i / stepDivisor(safe=1)`. В вычислении участвуют ТОЛЬКО цены (никаких
  исходов сделок). Значение фиксируется отдельным calibration-артефактом с SHA-256 до reveal.
  Фактическая % дистанция стопа волатильностно-масштабируется вокруг медианы 1.9% — это осознанное
  решение автора («масштаб через step»), а не фикс-% на каждой сделке.
- Издержки: 5 bps/side taker (primary, реальный сценарий автора BingX VIP0) и 0 bps (gross-потолок,
  референс). Издержки не оптимизируются.

## 5. Эндпоинты и гейты

- Primary endpoint: **pooled mean netR всех resolved-сделок при 5 bps/side**.
- Инференс: UTC-day cluster bootstrap — совместный перевыбор суток по всем символам (сохраняет
  кросс-символьные шоки одного дня), 10 000 ресемплов, seed **22082026**, percentile CI95.
- Event gate: допущенных возможностей ≥250 И resolved-сделок ≥100.
- **GO** ⇔ event gate выполнен И lower95 pooled mean netR@5 > 0.
- **KILL** ⇔ event gate выполнен, но lower95 ≤ 0 (точечная оценка при этом отчётывается как есть).
- **INCONCLUSIVE DATA** ⇔ event gate не выполнен (при живой вселенной ≥20 символов).
- Secondary (диагностика, НЕ влияет на GO/KILL): funding-sign поверх того же thinned-baseline —
  правило из замороженной линии OWN2+funding-sign (strict `settlementTimestamp < decisionTimestamp`,
  direction-aware cashflow, paired delta per opportunity, paired UTC-day bootstrap CI).
- Reference (описательно, без гейтов): тот же стоп/менеджмент БЕЗ прореживания (spacing=0).

## 6. Терминальность

Reveal выполняется ОДИН раз. После него запрещены: retune stopSteps*/spacing/relVol/менеджмента,
исключения проигравших символов/подвыборок, повторное использование корпуса для этой гипотезы,
«ещё одна вариация». KILL закрывает линию OWN2-thinning окончательно; GO переводит руку в
paper-forward. Отрицательный/положительный результат фиксируется в HANDOFF/NEGATIVE-KNOWLEDGE.

## 7. Проверка целостности

Раннеры калибровки и reveal обязаны сверять SHA-256: этого preregistration, acquisition-manifest
и calibration-артефакта. Несовпадение любого хеша → запуск блокируется.
