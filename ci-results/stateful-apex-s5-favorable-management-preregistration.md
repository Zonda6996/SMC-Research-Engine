# Stateful Apex S5 — preregistration development-only favorable-excursion management

> Статус при создании: **DESIGN ONLY / NOT EXECUTED**. После записи этого файла разрешён ровно один diagnostic runner. Это не freeze и не OOS-validation.

## Вопрос и population

Проверяется один причинный механизм без изменения входов: может ли уже существующая геометрическая веха сохранить favorable excursion до исходного stop.

Population фиксирован по S4: только `train`, TF >=15m из `ci-results/stateful-apex-s1-manifest.json`: ADA/BTC/DOGE/ETH/LDO/XRP (15 series). Запрещены S1 untouched OOS, ONDO/VIRTUAL, S4 holdout ZEC/1000PEPE/BOME и любые Vendor Shapes. Shape-колонки CSV не читаются как данные и не участвуют ни в одном вычислении.

## Единственный механизм

Baseline без изменений: Stateful Apex v1; entry = next-bar open после confirmation; target = frozen confirmation Mean; stop = frozen same-side Outer; stop-first collision; 5 bps/side.

Candidate `INNER_TOUCH_THEN_BE_NEXT_BAR`:

1. Frozen waypoint = same-side Inner на confirmation (`lowerInner` long, `upperInner` short). Это существующая Apex-геометрия, не числовой threshold.
2. После entry исходные target/stop действуют без изменений.
3. Если завершённый бар после entry касается frozen Inner в favorable направлении и на этом баре не разрешился исходный target/stop, milestone считается причинно достигнутой на close этого бара.
4. Только с открытия следующего бара stop остатка переносится ровно в entry. Никакой intrabar-последовательности не предполагается; на activation bar новый stop ещё не действует.
5. После активации target остаётся frozen Mean. Если target и BE находятся в одном последующем баре, консервативно BE исполняется первым.
6. Costs считаются по фактическому entry/exit при 5 bps/side. Никаких partial, add, trailing-параметров, PnL-grid или альтернативных уровней.

Механизм отличается от RE18: там BE включался после partial у Mean в vendor-shape replay; здесь нет partial/Vendor Shapes, а BE включается раньше по frozen Inner в threshold-free Stateful Apex development replay. RE13–RE17 (payoff/static stop) не тестировали этот path rule.

## Attribution

На парном event ledger публикуются:

- baseline favorable-then-stop и сколько из них улучшено (`saved` = managed netR > baseline netR);
- baseline winners, преждевременно обрезанные в BE (`winnerClipped` = baseline target, managed BE);
- activation count/rate, activation→BE/target, неактивированные события;
- gross и net paired delta, total delta;
- path feasibility: milestone только на завершённом баре, перенос только со следующего бара; same-bar activation запрещена;
- per-symbol/per-series delta и положительная breadth.

## Inference

10,000 paired hierarchical bootstrap resamples, seed `20260822`: symbols с возвращением, затем calendar-month clusters внутри выбранного symbol с возвращением; все paired events cluster сохраняются. Percentile CI95 для gross/net delta. Дополнительно series-cluster sensitivity CI95.

## Conservative screens и решение

`CANDIDATE_FOR_FREEZE` допускается только если одновременно:

1. paired mean net delta > 0 и primary CI95 lower > 0;
2. paired mean gross delta > 0 и primary CI95 lower > 0;
3. positive net-delta breadth >=60% estimable symbols и >=60% series;
4. saved favorable-then-stop > winnerClipped, а conservative lower Wilson bound доли saved среди baseline favorable-then-stop > 0;
5. activation feasible у >=3 symbols и >=5 series;
6. integrity counters forbidden datasets/Vendor-Shape uses/src-core changes равны 0.

Если любой screen не проходит: `NO_CANDIDATE`. Максимум один candidate. Development-прохождение не является edge и разрешает только последующий отдельный freeze до нового независимого holdout.
