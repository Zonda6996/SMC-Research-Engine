# GGI / Independent Reversal — второй взгляд после работы v0

Дата: 2026-08-06  
Ветка: `research/independent-reversal-edge`  
Точка анализа: HEAD `eb0b1f2` плюс текущие незакоммиченные G2 / OWN1 path / OWN2 артефакты.

## Вердикт

Мы **не упёрлись в предел задачи**, как в истории с Fibonacci. Мы упёрлись в предел **неправильной постановки метрики и слишком бедного класса моделей**.

Что уже ясно:

1. **Высокий dashboard WR и Full:Stop не равны прибыли.** В DM3 V2 исход `Partial` считается «победой» в WR, хотя экономически он в среднем даёт около **−0.73…−0.75R**. `Full` приносит всего около **+0.54…+0.65R**, а `Stop` — около **−1R**. Поэтому WR 90–96% может сосуществовать с отрицательной expectancy.
2. **OWN1 воспроизвёл форму dashboard, но не селективность GGI.** Он даёт в 4.5 раза больше сигналов, Full:Stop 5.5–15.6 и WR 90–96%, но pooled OOS = **−0.0349R**.
3. **G2 не решил проблему:** pooled transfer net = **−0.0864R**, положителен только 1 из 4 transfer-наборов.
4. **OWN2 сделал правильный концептуальный поворот — ранжировал по net R, а не WR — но additive-модель тоже не нашла устойчивую селективность.** На sealed BTC 2h test: **+0.0245R, PF 1.073**, то есть ниже гейтов и практически равно regime-null **+0.0253R**. Pooled transfer = **−0.0410R**, положительны 2/4 наборов.
5. При этом **реальный GGI ещё не обнулён как эталон**: corrected 2h holdout по пяти активам ранее дал примерно **+0.0615R net при 6 bps/fill, PF 1.66**, все 5 активов положительны. Но это другая, более корректная moving-management модель, а не DM3 V2.

Главный вывод: **следующий шаг — не ещё один candle gate. Сначала нужно починить экономический objective и привести comparator к одной и той же management-механике. Потом тестировать взаимодействия и последовательности, а не суммы одномерных bins.**

---

## 1. Что сделал v0 и где именно закончился прежний путь

Под «v0» здесь логично понимать research-agent, который начал с базы `a5c5af7` и провёл цепочку до `eb0b1f2`.

### Этапы

- `10995a0`–`d6dd35f`: episode-age / V7'. Найдены reversal-регионы, но exact bar не восстановлен. Лучший validation F1 всего **3.03%**.
- `f1e8b65`–`89b41a8`: H2/H3 falsification. H3 cross-TF гипотеза не выдержала более строгой проверки; прежние выводы ослаблены.
- `a2af134`–`6b38c35`: LTF1. Lower-TF ordering не объяснил расхождение BE: 0% существенной intrabar ambiguity при широком stop.
- `92f53b1`–`086b0fb`: DM1/DM2. Dashboard counts локализованы, literal BE отвергнут; остаток оказался в terminal semantics.
- `5f44497`–`eff1f3f`: DM3. Найдена рабочая proxy-механика: moving Mean partial + static signal-bar Inner full + no BE; OOS на XRP 3m прошёл по count-distance.
- `7138402`–`64db200`: SUR1. Все девять outer-stretch/volume правил окончательно провалились даже там, где arrows положительны.
- `91aab25`: SIG1. Фальсифицировано предположение, что стрелка возникает у Outer: **0% touches**. Подтверждены только два инварианта — directional candle и close на сигнальной стороне Mean. OHLCV-gates дают precision не выше 9%.
- `4da4998`–`5a31350`: OWN1. Собственный генератор из анатомии сигнальной свечи. Train положителен, time-forward почти ноль, pooled OOS отрицателен.
- `eb0b1f2`: REG1. Сделан сильный, но опасный headline: Full:Stop у OWN1 выглядит не хуже GGI. Опасность в том, что эта метрика не учитывает размер payoff.

После HEAD уже выполнены дополнительные текущие исследования:

- OWN1 path/regime audit — подтвердил regime dependence и частичное преимущество над matched null, но только на 5 доступных наборах.
- G2 state detector — **REJECT**.
- OWN2 expectancy ranker — **REJECT**.

Это важный прогресс: закрыты не «все способы», а конкретно:

- simple single-bar thresholds;
- explicit cooldown/state grammars без богатых взаимодействий;
- outer-stretch/volume surrogate;
- additive one-dimensional feature bins.

---

## 2. Почему WR нормальный, а прибыль хуже GGI

### 2.1 Формула, которую сейчас маскирует dashboard

Dashboard считает:

```text
WR_dashboard = (Partial + Full) / Closed trades
```

Но экономическая expectancy:

```text
E[R] = p(Partial) × E[R|Partial]
     + p(Full)    × E[R|Full]
     + p(Stop)    × E[R|Stop]
     − costs
```

`WR_dashboard` полезен только если все Partial действительно неотрицательны. В DM3 V2 это неверно.

### 2.2 Фактический payoff DM3 V2

Рассчитано напрямую тем же `replayDm3Trade(..., V2_movP_staticTPwick)`.

| Dataset | Семейство | Partial mean | Stop mean | Full mean | Mean R |
|---|---|---:|---:|---:|---:|
| BTC 2h | GGI | −0.734R | −1.000R | +0.651R | +0.151R |
| BTC 2h | OWN1 | −0.747R | −1.000R | +0.557R | +0.040R |
| XRP 3m | GGI | −0.723R | −1.000R | +0.631R | +0.019R |
| XRP 3m | OWN1 | −0.734R | −1.000R | +0.551R | −0.035R |
| ONDO 2h | GGI | −0.744R | −1.000R | +0.652R | +0.023R |
| ONDO 2h | OWN1 | −0.738R | −1.000R | +0.538R | −0.057R |
| ONDO 15m | GGI | −0.725R | −1.000R | +0.621R | +0.136R |
| ONDO 15m | OWN1 | −0.748R | −1.000R | +0.540R | +0.050R |
| BTC 15m | GGI | −0.743R | −1.000R | +0.618R | −0.093R |
| BTC 15m | OWN1 | −0.747R | −1.000R | +0.543R | −0.084R |

Это и есть ответ на основной вопрос.

**Partial в DM3 — не маленькая победа.** После 25% фикса у Mean остаток продолжает жить без BE и часто закрывается по дальнему initial stop. Итоговая сделка классифицируется `Partial`, но её R около −0.74. Dashboard WR говорит «win», деньги говорят «почти полный loss».

### 2.3 Почему GGI всё же лучше OWN1 на тех же exits

У GGI две реальные формы селективности:

1. **Лучше Full payoff:** примерно +0.62…+0.65R против +0.54…+0.56R у OWN1. GGI выбирает свечи, где static opposite-Inner дальше/выгоднее относительно 12×TR55 risk.
2. **Лучше смесь исходов:** меньше damaging Partial на один Full в сильных режимах.

Пример BTC 2h:

```text
GGI:  25 Partial × −0.734 + 6 Stop × −1 + 58 Full × +0.651 = +13.43R
OWN1: 116 Partial × −0.747 + 27 Stop × −1 + 231 Full × +0.557 = +15.07R
```

OWN1 зарабатывает почти столько же total gross R, но требует 374 закрытых сделок против 89. На сделку:

```text
GGI  +0.151R
OWN1 +0.040R
```

После fees, overlap и risk capacity разница становится ещё важнее.

### 2.4 Почему Full:Stop тоже обманчив

Full:Stop игнорирует Partial. На BTC 15m OWN1 имеет `F:S = 5.46`, но:

```text
202 Full дают +109.70R
140 Partial забирают −104.58R
37 Stop забирают −37.00R
Итого −31.87R
```

То есть «Full в 5.5 раза больше Stop» выглядит отлично, но один только поток Partial почти полностью съедает все Full.

### 2.5 Есть ещё три структурные причины

- **Частота:** OWN1 примерно в 4.5 раза чаще GGI. Это означает больше costs, больше одновременных/коррелированных входов и меньше капитала на каждый сигнал.
- **Режим:** BTC 2h GGI ослаб во второй части; BTC 15m токсичен и для GGI, и для OWN1. Универсального по TF edge нет.
- **Несопоставимый benchmark:** реальный corrected GGI 2h анализ использует moving Inner close-confirmed full + next-bar BE, а OWN1/G2/OWN2 сейчас оцениваются в DM3 static no-BE. Нельзя честно утверждать «меньше GGI», пока оба потока не прогнаны через одинаковый corrected replay.

---

## 3. Что не так в текущем OWN2, несмотря на правильную идею

OWN2 правильно сделал три вещи:

- target = net R, а не WR;
- train/validation/sealed split;
- GGI labels не используются как target.

Но модель ограничена:

1. Восемь признаков превращаются в пять одномерных bins каждый.
2. Итоговый score — простое среднее восьми bin-values.
3. **Нет взаимодействий.** Например, long episode age полезен только при определённой Mean slope и recovery geometry — additive ranker этого не видит.
4. **Нет последовательности.** Он видит summary текущего episode, но не форму последних 8–32 баров.
5. Null слабее, чем должен быть: текущий OWN2 null совпадает только по стороне Mean, но не по volatility/month/episode-age/candidate grammar так строго, как path audit.
6. Broad comparator в реализации использует score-less cooldown stream, но не делает полную decomposition selected-minus-broad по одинаковым temporal opportunity sets.

Результат подтверждает ограничение класса:

- validation top-35%: +0.1146R;
- sealed test: +0.0245R;
- null: +0.0253R;
- transfer pooled: −0.0410R.

То есть модель выбрала неплохой режим на validation, но не выучила переносимую селективность.

---

## 4. Новый план: не «ещё один индикатор», а каскад селективности

### Приоритет 0 — исправить measurement contract

До нового signal model сделать **ECON0 — common corrected replay**.

Один и тот же поток кандидатов — GGI, OWN1, broad OWN2 — прогнать через:

- next-bar open;
- stop 12×TR55 как frozen baseline;
- Partial = moving Mean wick, 25%;
- Full = moving opposite Inner **close-confirmed**;
- BE = next-bar entry BE;
- no-add primary;
- 6 bps per one-way fill;
- max holding/time mark одинаковый;
- exposure/overlap-adjusted portfolio ledger.

Обязательные метрики:

- true positive-return rate, не dashboard WR;
- mean/median net R;
- PF;
- payoff и contribution по Partial/Full/Stop/End;
- turnover и time-in-market;
- R per 1,000 bars и per unit exposure;
- best-1%-removed;
- month-block bootstrap;
- selected-minus-regime-matched-null.

**Kill criterion:** если GGI сам не сохраняет advantage на corrected common replay в данном TF/периоде, этот TF/период нельзя использовать как teacher для собственного сигнала.

### Приоритет 1 — SEQ1: компактная interaction/sequence-модель

Не нейросеть. Первый честный кандидат — gradient-boosted shallow trees или Explainable Boosting Machine на causal features.

Candidate universe оставить широким: directional reversal candle на сигнальной стороне Mean после episode drought.

Добавить признаки только из прошлого:

- текущие 8 OWN2;
- slopes/curvature Mean, Inner, Outer за 3/8/16 баров;
- последовательность signed returns и ranges за 8/16 баров;
- число и величина новых episode-extremes;
- time since last expansion/contraction transition;
- realized volatility ratios 8/32/128;
- distance-to-Mean velocity, не только level;
- failed-continuation: был ли после нового extreme бар, не сумевший продолжить движение;
- liquidity/volume z-score, если volume корректен;
- side-specific trend state.

Target — **net R corrected replay**, плюс отдельная binary meta-label `netR > 0.05` для проверки calibration.

Ограничения:

- depth 2–3;
- максимум 50–100 trees;
- asset/TF/time IDs запрещены;
- nested walk-forward;
- одна frozen retention family, например top 10/20/35%;
- monotonicity не навязывать там, где неизвестна.

**Promotion:** test mean net ≥ +0.03R, PF ≥1.15, > matched null на ≥0.03R, best-1%-removed >0, минимум 3/4 positive transfers.

**Kill:** test ≤ null или sign flips в 3+ transfer cells.

### Приоритет 2 — HTF1: рыночное состояние как отдельный gate, не exact-arrow predictor

Раньше H3 пытались использовать для совпадения exact bar. Это слишком жёсткая цель. Проверить другой вопрос:

> Повышает ли 4×HTF state экономическую ценность уже найденных reversal candidates?

HTF-features:

- положение close относительно HTF Mean/Inner;
- HTF Mean slope и curvature;
- expansion/contraction HTF channel;
- HTF episode side/age;
- совпадает ли LTF reversal с HTF mean-reversion direction;
- market-wide BTC state для альтов.

Не искать exact GGI match. Измерять uplift net R относительно того же candidate stream.

**Kill:** selected-minus-broad < +0.02R или effect меняет знак между активами.

### Приоритет 3 — TEACH1: GGI как weak teacher, но не как конечная цель

Две задачи, строго разделённые:

1. **Imitation diagnostic:** вероятность, что candidate находится в GGI reversal region ±N баров.
2. **Economic meta-label:** вероятность положительного corrected net R.

Сделать multi-task score:

```text
score = economic_score + small λ × region_similarity
```

GGI-label proximity не должна доминировать. Teacher нужен, чтобы подсказать скрытые interaction regions, а не заставить нас копировать exact arrow.

Обязательный negative control: перемешанные GGI labels внутри month/side/regime. Если реальный teacher не лучше shuffled teacher на sealed data, weak supervision бесполезна.

**Kill:** teacher term не даёт OOS uplift или улучшает arrow overlap без улучшения net R.

### Приоритет 4 — ABSTAIN1: индикатор имеет право молчать

Цель не обязательно 4.5× частоты GGI. Нормальный индикатор может работать только в узких regimes.

Ввести selective prediction:

- score threshold;
- uncertainty threshold по ensemble/bootstrap;
- no-trade при disagreement;
- отдельные allowed regimes, заранее выбранные на validation.

Основная кривая:

```text
coverage → mean net R → PF → total R / exposure
```

Нужен не один threshold, а доказательство, что при снижении coverage качество **монотонно растёт**. Если top 10% не лучше top 35%, ranker не умеет ранжировать.

**Kill:** нет monotonic lift по score-deciles на validation и sealed test.

### Приоритет 5 — использовать OWN1 как confluence, а не standalone

OWN1 действительно может быть полезен как дешёвый reversal-event detector, но только если не называть dashboard WR торговой прибылью.

Тестировать:

- OWN1 внутри заранее заданных Apex/POI/SMC зон;
- OWN1 только при SEQ1 high score;
- OWN1 как exit/scale-down warning для трендовых позиций;
- OWN1 как feature, не trigger.

**Kill:** confluence не улучшает expectancy существующего base strategy минимум на +0.02R OOS или уменьшает total return сильнее, чем drawdown.

---

## 5. Что делать буквально следующим коммитом

### Эксперимент ECON0 — обязательный

1. Написать preregistration.
2. Адаптировать corrected replay так, чтобы он принимал произвольный signal stream, а не только `row.buy/row.sell`.
3. На одинаковом management сравнить:
   - GGI;
   - OWN1;
   - broad OWN2 candidates;
   - OWN2 selected;
   - regime-matched null.
4. Сделать payoff decomposition и exposure-adjusted ledger.
5. Не подбирать параметры.

Почему это первое: сейчас сравнение «GGI vs OWN1» частично сравнивает **разные management engines**. Пока это не исправлено, мы можем улучшать не сигнал, а артефакт DM3.

### После ECON0

- Если corrected GGI > OWN1 и > null: запускать SEQ1.
- Если GGI ≈ null в конкретном TF/окне: исключить этот cell из teacher-development, но оставить как hostile transfer.
- Если OWN1 на corrected replay резко улучшается: проблема была в DM3 management, и новый signal model пока не нужен.
- Если OWN1 остаётся отрицательным, а GGI положителен: missing selectivity реальна; SEQ1/HTF1 оправданы.

---

## 6. Что больше не делать

- Не оптимизировать WR.
- Не считать `Partial` победой без знака realised R.
- Не продвигать Full:Stop без contribution decomposition.
- Не перебирать ещё 20 вариантов body/drought/cooldown.
- Не сравнивать OWN-сигналы на DM3 с GGI на corrected moving management.
- Не использовать BTC 15m как основной development cell: он токсичен даже для GGI.
- Не открывать новые sealed периоды ради rescue одной модели.
- Не делать большую neural network до того, как shallow interaction model докажет, что взаимодействия вообще несут OOS-сигнал.

---

## 7. Итоговая позиция

Уверенность пользователя, что «ещё не всё сделали», оправдана — но не потому, что где-то остался магический RSI или ещё одна комбинация свечей.

**Не сделаны три действительно другие вещи:**

1. одинаковая экономическая механика для всех signal streams;
2. модель взаимодействий/последовательности вместо бинарных правил и additive bins;
3. selective/abstaining индикатор, который оптимизирует expectancy на единицу exposure, а не частоту и красивый WR.

Это не гарантирует, что мы получим GGI-level edge. Но это первая следующая ветка, которая структурно отличается от уже проваленных подходов и отвечает именно на найденную проблему.

Мой порядок: **ECON0 → SEQ1 → HTF1 → TEACH1 → ABSTAIN1**. Не наоборот.

## Основные источники в репозитории

- `docs/EPISODE-AGE-HAZARD-SESSION-SUMMARY.md`
- `docs/GGI-RESEARCH-CONTINUATION.md`
- `ci-results/sig1-arrow-anatomy.md`
- `ci-results/own1-generator.md`
- `ci-results/reg1-fullstop-comparison.md`
- `ci-results/ggi-own1-path-regime-audit-v1.md`
- `ci-results/ggi-g2-state-detector-v1.md`
- `ci-results/ggi-own2-expectancy-ranker-v1.md`
- `ci-results/ggi-corrected-gross-audit-v2.md`
- `ci-results/ggi-go-no-go-verdict-v1.md`
- `ci/research/runDm3StaticExit.ts`
- `ci/research/runGgiOwn2ExpectancyRankerV1.ts`
- `ci/research/lib/ggiCorrectedReplay.ts`
