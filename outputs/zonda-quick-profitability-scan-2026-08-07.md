# FROZEN-1: Null B → ECON1-base → BREADTH1

Период: 2024-01-01 — 2026-08-01. FROZEN-1 без подбора параметров: own2Raw 1h/2h + RELAXED 4h pool + STATIC2 (step=5.5×ATR200/1.17, TP/SL=2×step, без добора/партиала, timeout 14 дней).
Базовая экономика: 7 bps one-way + Binance USD-M funding proxy по фактическому удержанию. Кластер: сторона × UTC-день.
Покрытие запуска: полный Null-universe (6 transfer-монет × 1h/2h) и полный заранее заданный breadth-universe (20 монет × 1h/2h); у PEPE архивные свечи отсутствовали, поэтому сделки получены по 19 breadth-монетам.

## Решение

- Null B / SEQ: **THINS_ONLY**; преимущество SEQ = -0.1721R.
- BREADTH1: **CLOSE**; raw n=2175, clusters=655, cluster-equal mean=0.0357R.
- Планка не пройдена: FROZEN-1 закрывается честно.

## 1. Null B для SEQ (equal-count, side + month + TF)

| Slice | Trades | Clusters | Mean net R | Cluster-equal mean R | PF | Positive | Funding R |
|---|---:|---:|---:|---:|---:|---:|---:|
| SEQ real | 40 | 38 | 0.0372 | 0.0305 | 1.092 | 47.5% | 0.3473 |
| non-SEQ matched control | 40 | 37 | 0.2093 | 0.2117 | 1.642 | 57.5% | 0.2663 |

Exact equal-count: **да**. SEQ минус control: **-0.1721R**.

## 2. ECON1-base

| Slice | Trades | Clusters | Mean net R | Cluster-equal mean R | PF | Positive | Funding R |
|---|---:|---:|---:|---:|---:|---:|---:|
| Null-universe FROZEN-1 | 635 | 330 | 0.0308 | 0.0281 | 1.079 | 51.8% | 3.9926 |
| Unseen breadth FROZEN-1 | 2175 | 655 | 0.0169 | 0.0357 | 1.043 | 51.9% | 3.8780 |

Funding включён в каждую сделку только для settlement строго после entry и строго до exit. Источник — Binance USD-M proxy, не точная история BingX.

## 3. BREADTH1

Заранее заданные unseen относительно G2/IMP2 символы: ARBUSDT, OPUSDT, SUIUSDT, SEIUSDT, PEPEUSDT, RUNEUSDT, TAOUSDT, ENAUSDT, LDOUSDT, STXUSDT, SANDUSDT, MANAUSDT, AXSUSDT, DYDXUSDT, IMXUSDT, MKRUSDT, CRVUSDT, PENDLEUSDT, TIAUSDT, WIFUSDT.
Сделки получены на: ARBUSDT, AXSUSDT, CRVUSDT, DYDXUSDT, ENAUSDT, IMXUSDT, LDOUSDT, MANAUSDT, MKRUSDT, OPUSDT, PENDLEUSDT, RUNEUSDT, SANDUSDT, SEIUSDT, STXUSDT, SUIUSDT, TAOUSDT, TIAUSDT, WIFUSDT.

| Slice | Trades | Clusters | Mean net R | Cluster-equal mean R | PF | Positive | Funding R |
|---|---:|---:|---:|---:|---:|---:|---:|
| ALL | 2175 | 655 | 0.0169 | 0.0357 | 1.043 | 51.9% | 3.8780 |
| 1h | 1332 | 576 | 0.0119 | 0.0344 | 1.028 | 51.2% | 2.0973 |
| 2h | 843 | 423 | 0.0246 | 0.0049 | 1.073 | 53.0% | 1.7807 |

## Ограничения

- Это ровно одна FROZEN-1; FIB/HTF/SEQ-комбинации здесь не ранжировались.
- Кластеризация light: одинаковая сторона в один UTC-день считается одним эпизодом.
- Если raw n < 100, BREADTH1 имеет статус INCOMPLETE независимо от знака результата.
- SEQ может перейти в FROZEN-2 только при валидном exact equal-count и положительном преимуществе.

## Предупреждения данных

- PEPEUSDT 1h: insufficient candles (0/0)
- PEPEUSDT 2h: insufficient candles (0/0)

