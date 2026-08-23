# RE8 — precision-split full-fix-at-mean: MATCHED (vendor-shape) vs EXTRA

**Цель:** разложить full-fix-at-mean сделки на MATCHED (наш OWN2-сигнал совпадает с vendor CSV-shape той же стороны в пределах ±1 бара) и EXTRA (vendor-shape нет), чтобы понять, идёт ли плохая mean-fix статистика ОТ СТРАТЕГИИ или ОТ OWN2-переизлучения (низкая precision).

> §2.2: LDO/AVAX/ONDO исключены — у них нет vendor CSV-shapes. Только VIRTUAL(автор)/BNB/BTC 5m содержат shapes. Движок `src/core` не тронут — измерительный харнесс. relVol=1.4, каноничные Apex-полосы, arm=safe + `{fullFixAtMean:true, addEnabled:false}`.

## 1. Счётчики по сериям

| серия | OWN2 сигналы | vendor shapes | ratio (OWN2/shapes) |
|---|---|---|---|
| VIRTUAL.P 5m (автор) | 345 | 100 | ×3.45 |
| BNB.P 5m | 351 | 92 | ×3.82 |
| BTC.P 5m | 364 | 82 | ×4.44 |

## 2. PRIMARY arm (canon safe, fullFixAtMean, addEnabled:false) — агрегат по 3 сериям

| bucket | N | WR (netR>0) | vendorWR | totalR | meanR | PF |
|---|---|---|---|---|---|---|
| ALL | 408 | 68.1% | 82.1% | -26.499 | -0.065 | 0.69 |
| MATCHED | 39 | 66.7% | 76.9% | -5.130 | -0.132 | 0.49 |
| EXTRA | 369 | 68.3% | 82.7% | -21.369 | -0.058 | 0.72 |

### 2.1 Per-series meanR (MATCHED / EXTRA)

| серия | MATCHED N | MATCHED meanR | EXTRA N | EXTRA meanR |
|---|---|---|---|---|
| VIRTUAL.P 5m | 15 | 0.048 | 115 | 0.023 |
| BNB.P 5m | 10 | 0.002 | 121 | -0.092 |
| BTC.P 5m | 14 | -0.419 | 133 | -0.097 |

### 2.2 TRAIN / OOS (cutoff = firstTs + 0.65·span, per-series; агрегат)

| выборка | bucket | N | meanR | totalR |
|---|---|---|---|---|
| TRAIN | MATCHED | 26 | -0.198 | -5.136 |
| TRAIN | EXTRA | 242 | -0.035 | -8.491 |
| OOS | MATCHED | 13 | 0.000 | 0.006 |
| OOS | EXTRA | 127 | -0.101 | -12.878 |

## 3. stop1x arm (canon safe, fullFixAtMean, addEnabled:false, stopSteps:1) — агрегат

| bucket | N | WR (netR>0) | vendorWR | totalR | meanR | PF |
|---|---|---|---|---|---|---|
| ALL | 521 | 57.6% | 65.5% | -89.857 | -0.172 | 0.59 |
| MATCHED | 42 | 66.7% | 69.0% | -5.459 | -0.130 | 0.65 |
| EXTRA | 479 | 56.8% | 65.1% | -84.398 | -0.176 | 0.59 |

## 4. Вывод (черновой)

- MATCHED meanR (-0.132) тоже неположителен → сама стратегия слаба даже на настоящих vendor-сетапах; проблема не сводится к переизлучению. EXTRA meanR=-0.058 (N=369).

_Числа — сырые netR (с издержками 7 bps/side, как в движке). Без overclaiming: vendor-shapes есть только на 3 сериях 5m._
