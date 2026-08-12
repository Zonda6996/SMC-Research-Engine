# FROZEN-1: Null B → ECON1-base → BREADTH1

Период: 2024-01-01 — 2026-08-01. FROZEN-1 без подбора параметров: own2Raw 1h/2h + RELAXED 4h pool + STATIC2 (step=5.5×ATR200/1.17, TP/SL=2×step, без добора/партиала, timeout 14 дней).
Базовая экономика: 7 bps one-way + Binance USD-M funding proxy по фактическому удержанию. Кластер: сторона × UTC-день.
Покрытие запуска: null=полное, breadth=полное; символы=BCHUSDT, ETCUSDT, UNIUSDT, FILUSDT, NEARUSDT, APTUSDT, ARBUSDT, OPUSDT, SUIUSDT, SEIUSDT, PEPEUSDT, RUNEUSDT, TAOUSDT, ENAUSDT, LDOUSDT, STXUSDT, SANDUSDT, MANAUSDT, AXSUSDT, DYDXUSDT, IMXUSDT, MKRUSDT, CRVUSDT, PENDLEUSDT, TIAUSDT, WIFUSDT, TF=1h, 2h.

## Решение

- Null B / SEQ: **INCONCLUSIVE** — exact equal-count не достигнут, вывод запрещён.
- BREADTH1: **CLOSE**; raw n=272, clusters=181, cluster-equal mean=0.0374R.
- Parity QA: исправленный state-first replay оставил 338 сделок из 4552 state-gated (7.43%); прежние 2175 breadth-сделок относились к ошибочной более частой стратегии.
- Планка не пройдена: FROZEN-1 закрывается честно.

## 1. Null B для SEQ (equal-count, side + month + TF)

| Slice | Trades | Clusters | Mean net R | Cluster-equal mean R | PF | Positive | Funding R |
|---|---:|---:|---:|---:|---:|---:|---:|
| SEQ real | 3 | 3 | -0.1426 | -0.1426 | 0.600 | 33.3% | -0.0212 |
| non-SEQ matched control | 2 | 2 | -0.0095 | -0.0095 | 0.981 | 50.0% | 0.0010 |

Exact equal-count: **нет (3 vs 2)**. SEQ минус control: **-**.

## 2. ECON1-base

| Slice | Trades | Clusters | Mean net R | Cluster-equal mean R | PF | Positive | Funding R |
|---|---:|---:|---:|---:|---:|---:|---:|
| Null-universe FROZEN-1 | 66 | 55 | 0.0874 | 0.0807 | 1.253 | 59.1% | 0.2401 |
| Unseen breadth FROZEN-1 | 272 | 181 | 0.0174 | 0.0374 | 1.044 | 51.1% | -0.0129 |

Funding включён в каждую сделку только для settlement строго после entry и строго до exit. Источник — Binance USD-M proxy, не точная история BingX.

## 3. BREADTH1

Заранее заданные unseen относительно G2/IMP2 символы: ARBUSDT, OPUSDT, SUIUSDT, SEIUSDT, PEPEUSDT, RUNEUSDT, TAOUSDT, ENAUSDT, LDOUSDT, STXUSDT, SANDUSDT, MANAUSDT, AXSUSDT, DYDXUSDT, IMXUSDT, MKRUSDT, CRVUSDT, PENDLEUSDT, TIAUSDT, WIFUSDT.
Сделки получены на: ARBUSDT, AXSUSDT, CRVUSDT, DYDXUSDT, ENAUSDT, IMXUSDT, LDOUSDT, MANAUSDT, MKRUSDT, OPUSDT, PENDLEUSDT, RUNEUSDT, SANDUSDT, SEIUSDT, STXUSDT, SUIUSDT, TAOUSDT, TIAUSDT, WIFUSDT.

| Slice | Trades | Clusters | Mean net R | Cluster-equal mean R | PF | Positive | Funding R |
|---|---:|---:|---:|---:|---:|---:|---:|
| ALL | 272 | 181 | 0.0174 | 0.0374 | 1.044 | 51.1% | -0.0129 |
| 1h | 184 | 144 | -0.0043 | 0.0167 | 0.990 | 48.9% | 0.0807 |
| 2h | 88 | 70 | 0.0629 | 0.0611 | 1.193 | 55.7% | -0.0936 |

## 4. QA-воронка FROZEN-1

Порядок parity: raw signal → STATIC2 replay/state occupancy → RELAXED context. Отклонённый контекстом replayable-сигнал всё равно блокирует поток до exit + 3 bars, как в IMP2.

| Funnel stage | Count | % of previous stage |
|---|---:|---:|
| own2Raw (including warmup) | 53053 | - |
| after warmup + date window | 50675 | 95.52% |
| admitted by raw state gate | 4552 | 8.98% |
| replayable (occupies state) | 4552 | 100.00% |
| near pool ±50% | 4037 | 88.69% |
| rank < 2/3 | 1040 | 25.76% |
| swept ≤48h | 463 | 44.52% |
| entry within ±25% | 338 | 73.00% |
| final RELAXED trades | 338 | 100.00% |

Итоговая доля RELAXED среди state-gated: **7.43%**.

## Ограничения

- Это ровно одна FROZEN-1; FIB/HTF/SEQ-комбинации здесь не ранжировались.
- Кластеризация light: одинаковая сторона в один UTC-день считается одним эпизодом.
- Если raw n < 100, BREADTH1 имеет статус INCOMPLETE независимо от знака результата.
- SEQ может перейти в FROZEN-2 только при валидном exact equal-count и положительном преимуществе.

## Предупреждения данных

- PEPEUSDT 1h: insufficient candles (known unavailable in Binance USD-M archive)
- PEPEUSDT 2h: insufficient candles (known unavailable in Binance USD-M archive)

