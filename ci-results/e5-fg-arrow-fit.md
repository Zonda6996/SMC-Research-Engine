# E5 — reverse-engineering стрелки: F&G-осциллятор поверх Apex vs OWN2 (fit к 1692 алертам вендора)

F&G = w·RSI(n) + (1−w)·StochPos(n) (свечной, причинный). Long — фаза страха, short — жадности. Триггер level/cross, зона Apex on/off.
Fit к реальным scalp-алертам (`tg_topic_16293_scalp.json`), фид futures, матч ±1 бар, та же сторона. Метрика: recall при density∈[0.6,1.6].

**Baseline OWN2 (relVol1.4):** vendorN=341 ourN=1138 density=×3.3 recall=19% precision=6%

## Топ-15 F&G-конфигов (по recall при разумной плотности)

| конфиг | density | recall | precision |
|---|---|---|---|
| n14 w1 T20/80 cross zone:on sp3 | ×0.8 | 1% | 2% |
| n14 w1 T20/80 cross zone:off sp3 | ×0.8 | 1% | 2% |
| n14 w1 T20/80 cross zone:on sp10 | ×0.7 | 1% | 2% |
| n14 w1 T20/80 cross zone:off sp10 | ×0.7 | 1% | 2% |
| n21 w1 T25/75 cross zone:on sp3 | ×0.7 | 1% | 1% |
| n21 w1 T25/75 cross zone:off sp3 | ×0.7 | 1% | 1% |
| n21 w1 T25/75 level zone:on sp10 | ×0.6 | 0% | 0% |
| n21 w1 T25/75 level zone:off sp10 | ×0.6 | 0% | 0% |
| n14 w1 T20/80 level zone:on sp10 | ×0.7 | 0% | 0% |
| n14 w1 T20/80 level zone:off sp10 | ×0.7 | 0% | 0% |
| n14 w1 T20/80 level zone:on sp3 | ×1.1 | 0% | 0% |
| n14 w1 T20/80 level zone:off sp3 | ×1.1 | 0% | 0% |
| n21 w1 T25/75 level zone:on sp3 | ×1.1 | 0% | 0% |
| n21 w1 T25/75 level zone:off sp3 | ×1.1 | 0% | 0% |

## Лучший конфиг по парам: n14 w1 T20/80 cross zone:on sp3

| пара | vendorN | ourN | density | recall | precision |  OWN2 recall |
|---|---|---|---|---|---|---|
| 5m VIRTUAL | 94 | 74 | ×0.8 | 0% | 0% | 18% |
| 5m BNB | 89 | 80 | ×0.9 | 3% | 4% | 24% |
| 5m ETH | 71 | 83 | ×1.2 | 3% | 2% | 24% |
| 15m OP | 34 | 16 | ×0.5 | 0% | 0% | 9% |
| 15m CRV | 27 | 12 | ×0.4 | 0% | 0% | 7% |
| 15m ONDO | 26 | 13 | ×0.5 | 0% | 0% | 15% |
