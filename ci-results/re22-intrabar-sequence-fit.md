# RE22 — интрабарная последовательность как селектор стрелки vs shapes (recall/precision)

> Линии зоны — **вендорские** (§2.1), не выдуманы; пороги/сетка свипаны. **src/core не тронут** — чистый исследовательский раннер поверх CSV.

Реконструируем путь внутри каждого coarse-бара по реальным fine суб-барам того же окна `[t, t+tfSec)`. Популяция касаний (знаменатель precision) — coarse-бары в перекрытии, чей фитиль касается внутренней полосы, с rearm по возврату close к mean (как RE20). Селектор `fire`: интрабар-касание inner + (опц.) `coincide` (|touchSubIdx−volSpikeSubIdx|≤1) + условие на `nTouches` (maxTouches «первое/редкое», minTouches «повторность»). Матч против vendor shapes greedy (та же сторона, ±tol, один↔один, ближайший). `density=fires/shape` (≤8 для best). GATE = только касание (аналог RE20-гейта).

| coarse | fine | shapes(overlap) | touches | GATE r/p/F1 (dens) | BEST cfg | BEST r/p/F1 (dens) | OOS / underpowered | noFineShapes |
|---|---|---|---|---|---|---|---|---|
| BINANCE_ETHUSDT, 5.csv (5m) | BINANCE_ETHUSDT, 1.csv (1m) | 24 | 43 (fine 43) | 13% / 7% / 0.09 (1.79) | coinc=N,maxT=3,minT=1,±1 | 13% / 10% / 0.11 (1.29) | r 9% / p 10% / F1 0.10 | 0 |
| BINANCE_ETHUSDT, 1.csv (1m) | BINANCE_ETHUSDT, 5S.csv (5s) | 14 | 28 (fine 28) | 21% / 11% / 0.14 (2.00) | coinc=N,maxT=∞,minT=2,±2 | 36% / 24% / 0.29 (1.50) | r 0% / p 0% / F1 0.00 | 0 |
| BINANCE_ETHUSDT, 1.csv (1m) | BINANCE_ETHUSDT, 1S.csv (1s) | 5 | 11 (fine 11) | 0% / 0% / 0.00 (2.20) | coinc=N,maxT=∞,minT=1,±0 | 0% / 0% / 0.00 (2.20) | underpowered: N_overlap_shapes=5 (FULL F1 0.00) | 0 |
| BINANCE_ETHUSDT, 5.csv (5m) | BINANCE_ETHUSDT, 1S.csv (1s) | 1 | 2 (fine 2) | 0% / 0% / 0.00 (2.00) | coinc=N,maxT=∞,minT=1,±0 | 0% / 0% / 0.00 (2.00) | underpowered: N_overlap_shapes=1 (FULL F1 0.00) | 0 |
| BINANCE_BNBUSDT, 5.csv (5m) | BINANCE_BNBUSDT, 1.csv (1m) | 29 | 40 (fine 40) | 7% / 5% / 0.06 (1.38) | coinc=N,maxT=∞,minT=2,±2 | 10% / 11% / 0.11 (0.93) | r 0% / p 0% / F1 0.00 | 0 |
| BINANCE_BNBUSDT, 1.csv (1m) | BINANCE_BNBUSDT, 10S.csv (10s) | 18 | 49 (fine 49) | 28% / 10% / 0.15 (2.72) | coinc=N,maxT=2,minT=2,±2 | 17% / 38% / 0.23 (0.44) | r 13% / p 11% / F1 0.12 | 0 |
| BINANCE_BNBUSDT, 1.csv (1m) | BINANCE_BNBUSDT, 1S.csv (1s) | 5 | 14 (fine 14) | 20% / 7% / 0.11 (2.80) | coinc=N,maxT=∞,minT=1,±2 | 40% / 14% / 0.21 (2.80) | underpowered: N_overlap_shapes=5 (FULL F1 0.21) | 0 |

### Интрабар-профиль: бары-стрелки vs все касания

| coarse×fine | nTouches med (стрелки) | nTouches med (все) | coincide (стрелки) | coincide (все) |
|---|---|---|---|---|
| 5m×1m | 3.00 | 2.00 | 100% | 81% |
| 1m×5s | 4.00 | 5.00 | 0% | 50% |
| 1m×1s | n/a | 17.00 | n/a | 27% |
| 5m×1s | n/a | 40.00 | n/a | 100% |
| 5m×1m | n/a | 2.00 | n/a | 88% |
| 1m×10s | n/a | 3.00 | n/a | 69% |
| 1m×1s | n/a | 15.50 | n/a | 14% |

## Как читать
- **BEST precision ≫ GATE precision при живом recall** ⇒ интрабарная последовательность добавляет разделение сверх простого касания (гипотеза RE22 подтверждается).
- **BEST F1 ≈ GATE F1** (и/или best cfg сводится к GATE) ⇒ последовательность НИЧЕГО не добавляет сверх касания — механизм не в интрабар-пути OHLCV.
- **coincide/nTouches у стрелок ≈ как у всех касаний** ⇒ вендор не отбирает по «объём совпал с касанием» / «первое касание» — доп. подтверждение отсутствия разделения.
- **OOS F1 ≪ train F1** ⇒ best cfg — переобучение на in-sample (особенно на fine ТФ с малыми выборками); смотреть на OOS/underpowered, не на train.
- **underpowered** = shapes-в-перекрытии < 12: делить train/OOS нет смысла; это честный результат лимита данных (near-tick окна короткие).

## Сравнение с RE20 / RE21
- **RE20** (гейт «фитиль≥inner + объём + rearm», один агрегат по coarse-бару): best F1 ~0.14–0.20 на 1m/5m, precision 1–18%, density до 47× на fine ТФ.
- **RE21** (F&G-экстремум среди касаний): F1 ~0.12–0.16, precision 5–12%, на 1s/5s matched часто 0.
- **RE22** (эта работа): вопрос — добавляет ли интрабар-путь (coincide + nTouches по РЕАЛЬНЫМ fine-барам) precision сверх RE20-гейта. Вывод — в консольной строке-вердикте и в колонках GATE vs BEST/OOS выше.
