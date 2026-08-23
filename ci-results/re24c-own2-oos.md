# RE24c — строгая OOS-валидация net-edge собственных сигналов OWN2

> Хронo split 65/35. (spacing,stop) подбираются ТОЛЬКО на train по max net@5; замер на OOS. A-priori = стоп под его AvgStop, spacing=0 (без подбора). Kill-критерий: OOS net@5 > 0 И bootstrap-CI95 meanR@5 не пересекает 0. base `{fullFixAtMean:true, addEnabled:false}`, mode `safe`. src/core не тронут.

| серия | A-priori OOS@5 (net / WR) | BEST spacing/stop | OOS@0 | OOS@5 | OOS@7 | OOS meanR@5 CI95 | OOS freq/мес |
|---|---|---|---|---|---|---|---|
| VIRTUAL 5m | -2.74R / 64.8% | sp100/st1.1 | 5.77R | **2.53R** | 1.23R | [-0.175, 0.243] | 46.66 |
| ONDO 5m | 1.40R / 73.6% | sp20/st1 | 6.94R | **3.33R** | 1.88R | [-0.082, 0.205] | 62.29 |
| LDO 15m | -1.77R / 47.3% | sp100/st1 | 4.79R | **3.61R** | 3.14R | [-0.073, 0.270] | 15.31 |
| AVAX 5m | -5.01R / 64.3% | sp50/st0.7 | 4.49R | **-2.84R** | -5.77R | [-0.309, 0.133] | 62.29 |

## Чтение
- **OOS@5 > 0 И CI95 не пересекает 0 на серии** ⇒ edge переносится на этой серии (не in-sample артефакт).
- **A-priori OOS@5 > 0** (без подбора spacing/stop) ⇒ самый честный сигнал: плюс без выбора гиперпараметров.
- **BEST OOS ≪ trainNet5** ⇒ train-подбор переобучился (как RE17); смотреть на CI и a-priori, не на train.