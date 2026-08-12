# ECON0: общий corrected replay — итоговый отчет

Дата: 2026-08-06  
Ветка: `research/independent-reversal-edge`

## Итог в одном абзаце

ECON0 выполнен. Все четыре потока — GGI, OWN1, широкий OWN2 и выбранный OWN2 — прогнаны через одинаковый corrected management: вход на следующем open, стоп `12 × causal SMA(TR,55)`, 25% фиксации на касании moving Mean, перенос остатка в BE со следующего бара, Full только по закрытию за moving opposite Inner, stop-first внутри бара, 6 bps за каждое исполнение и максимум 2 000 баров удержания. Результат **не подтверждает, что прежний разрыв создавался главным образом разным менеджментом**. На последнем 30% BTC 2h GGI сам отрицателен и проигрывает matched null, поэтому этот участок нельзя использовать как teacher-cell. Формальный вердикт ECON0: **TEACHER_INVALID_IN_CELL** при **PARTIAL_INPUT_COVERAGE**.

## Главные числа

### BTC 2h, последний 30% test

| Поток | Сделки | Dashboard WR | Реально положительные | Mean net R | PF | Best 1% removed | Matched null | Разница |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| GGI | 29 | 89.7% | 55.2% | **−0.0675R** | 0.419 | −0.0967R | −0.0120R | −0.0555R |
| OWN1 | 109 | 93.6% | 49.5% | **−0.0180R** | 0.770 | −0.0324R | −0.0077R | −0.0102R |
| OWN2 broad | 211 | 92.4% | 60.7% | **+0.0016R** | 1.018 | −0.0100R | −0.0035R | +0.0050R |
| OWN2 selected | 116 | 89.7% | 59.5% | **−0.0213R** | 0.814 | −0.0362R | −0.0024R | −0.0189R |

Ни один поток не прошёл материальный экономический gate `mean net R >= +0.03`, `PF >= 1.10`, положительный результат без лучшего 1% и преимущество над null.

### BTC 2h, полный доступный период

| Поток | Mean net R | PF | Best 1% removed | Null | Разница |
|---|---:|---:|---:|---:|---:|
| GGI | +0.0610R | 1.793 | +0.0498R | +0.0166R | +0.0444R |
| OWN1 | −0.0011R | 0.987 | −0.0097R | +0.0073R | −0.0084R |
| OWN2 broad | +0.0095R | 1.105 | +0.0002R | +0.0159R | −0.0065R |
| OWN2 selected | +0.0109R | 1.111 | +0.0022R | +0.0324R | −0.0215R |

На длинной истории GGI выглядит лучше, но это преимущество не переносится в свежий test. Это согласуется с найденным ранее time-decay GGI: историческая прибыль не является доказательством живого edge.

### Transfer-наборы, агрегат

| Поток | Закрытые сделки | Weighted mean net R | Equal-dataset mean | Положительные наборы |
|---|---:|---:|---:|---:|
| GGI | 256 | −0.0162R | −0.0062R | 2/4 |
| OWN1 | 1 301 | −0.0359R | −0.0255R | 2/4 |
| OWN2 broad | 2 440 | −0.0329R | −0.0220R | 2/4 |
| OWN2 selected | 1 492 | −0.0293R | −0.0145R | 2/4 |

Общий corrected management немного улучшает картину относительно static DM3, особенно потому что Partial после BE становится около нуля, а не около −0.74R. Но этого недостаточно: pooled transfer остаётся отрицательным у всех потоков.

## Что именно объяснил ECON0

### 1. Разный менеджмент действительно искажал прежнее сравнение

В static DM3 Partial часто стоил около −0.73…−0.75R. В corrected replay с переносом в BE он стал близок к нулю:

- BTC 2h: Partial в среднем от +0.003R до +0.012R в зависимости от потока;
- ONDO 2h: от +0.008R до +0.016R;
- на low-TF комиссии делают Partial слегка отрицательным: примерно −0.003…−0.071R.

То есть прежняя огромная дыра от Partial была в значительной мере артефактом static management.

### 2. Но разрыв не сводится к менеджменту

Если бы management был основной причиной, OWN1/OWN2 должны были бы приблизиться к GGI и стабильно пройти economic/null gates. Этого не произошло:

- BTC 2h test отрицателен у GGI, OWN1 и selected OWN2;
- broad OWN2 около нуля, но PF 1.018 и отрицательный результат без лучшего 1%;
- transfer aggregate отрицателен у всех;
- positive transfer count одинаково слабый: 2/4.

### 3. GGI нельзя считать стабильным teacher

Самый важный свежий вывод — не то, что OWN хуже GGI, а то, что **GGI в test-cell невалиден как экономический эталон**:

- GGI test mean net: −0.0675R;
- PF: 0.419;
- matched-null advantage: −0.0555R;
- только один Full против трёх Stop при 25 Partial.

Следовательно, обучение модели на близость к GGI arrows без проверки экономической валидности конкретного режима может закрепить устаревший паттерн.

## Методологические ограничения

1. Доступны только пять локальных наборов: BTC 2h и четыре уже использованных transfer diagnostics.
2. Десять исторических ETH/SOL/XRP/AAVE/BNB 1h/2h CSV отсутствуют; это не полный обещанный holdout.
3. Funding исключён, поскольку нет venue-aligned settlement history для всех экспортов.
4. Matched null детерминирован и совпадает по direction, calendar month, signal-side Mean state и causal expanding ATR55 quintile, но это одна реализация draw, не ансамбль доверительных интервалов.
5. OWN2 model/cutoff воспроизведены по frozen fit/validation процедуре; никакой ретюнинг после просмотра ECON0 не выполнялся.

## Решение по дальнейшему исследованию

### Не делать сейчас

- не оптимизировать ещё один candle gate;
- не учить модель повторять GGI arrow в любом режиме;
- не принимать dashboard WR или Full:Stop за экономический edge;
- не продвигать broad OWN2 только потому, что его test mean слегка выше нуля.

### Следующий рациональный шаг: SEQ1, но с regime-valid teacher mask

SEQ1 остаётся правильным направлением, однако задача должна быть сформулирована не как «предсказать GGI», а как **ранжировать causal reversal candidates по будущему net R с правом молчать**. GGI можно использовать только как дополнительный weak feature/teacher там, где сам GGI положителен и превосходит matched null.

Минимальный протокол:

1. Preregister shallow interaction model: depth-limited tree/boosted stumps, без deep network.
2. Causal sequence features на 8/16/32 барах: episode age, weakening continuation, failed continuation, Mean slope path, contraction, body/range trajectory, directional close locations.
3. Target: corrected-replay net R, а не Partial/Full label и не arrow proximity.
4. Frozen coverage ladder: top 35% → 20% → 10%; expectancy должна монотонно расти при снижении coverage.
5. Обязательные gates: test mean >= +0.03R, PF >= 1.10, best-1%-removed > 0, superiority over matched null, минимум 3/4 положительных transfer diagnostics до восстановления полноценного holdout.
6. Abstain обязателен: если confidence/expected R ниже frozen cutoff, сигнал не выдаётся.

## Техническая реализация

Добавлено:

- общий arbitrary-signal API в `ci/research/lib/ggiCorrectedReplay.ts`;
- runner `ci/research/runGgiEcon0CommonReplayV1.ts`;
- тесты `tests/ggiEcon0CommonReplay.test.ts`;
- команда `npm run research:ggi:econ0`;
- frozen outputs `ci-results/ggi-econ0-common-corrected-replay-v1.{json,md}`.

Проверки:

- TypeScript: `npx tsc --noEmit` — pass;
- focused ECON0 tests — 5/5 pass;
- полный suite — 456/456 pass;
- `git diff --check` — pass.

## Финальный вывод

**ECON0 закрывает гипотезу «всё объясняется разным management» как недостаточную.** Corrected BE действительно убирает катастрофический −0.74R у Partial, но устойчивого edge не появляется. Более того, свежий BTC 2h test показывает распад самого GGI comparator. Поэтому следующий исследовательский коммит должен быть не про копирование arrows, а про preregistered sequence/interaction ranking с экономическим target, режимной маской валидности teacher и обязательным abstain.
