# D6-mgmt — TERMINAL REVEAL: управление каскадной сделки (6 co-primary рук)

# Вердикт линии: `GO` · Лучшая рука по замороженному правилу: **H72-stopStruct**

Событий: 186 на 12 symbol-fresh символах (APT, ETHFI, DODOX, PEOPLE, WIF, ORDI, ATOM, JTO, GALA, DASH, TIA, ALGO).

| рука | стоп | выход | N | WR | PF | средняя net | CI95 low | CI95 high | breadth | вердикт |
|---|---|---|---:|---:|---:|---:|---:|---:|---|---|
| H24-nostop | нет | 24ч | 181 | 59.7% | 1.71 | 1.923% | -0.359% | 4.151% | 7/12 | **KILL** |
| H24-stopStruct | flushLow−0.5ATR | 24ч | 181 | 44.8% | 1.55 | 1.314% | -0.420% | 3.123% | 6/12 | **KILL** |
| H24-stopWide | entry−5ATR | 24ч | 181 | 58.6% | 1.73 | 1.905% | -0.041% | 3.956% | 7/12 | **KILL** |
| Reclaim-stopStruct | flushLow−0.5ATR | close≥refLevel/max72ч | 181 | 46.4% | 1.85 | 2.174% | 0.284% | 3.944% | 9/12 | **GO** |
| H72-stopStruct | flushLow−0.5ATR | 72ч | 181 | 40.3% | 2.03 | 2.972% | 0.503% | 5.455% | 9/12 | **GO** |
| H12-stopStruct | flushLow−0.5ATR | 12ч | 181 | 54.1% | 2.22 | 1.551% | 0.541% | 2.578% | 7/12 | **GO** |

Все цифры net: 5bps/side + фактический funding. Стоп проверяется ПЕРВЫМ внутри бара.
Правило «лучшая рука»: GO + breadth ≥9/12 → максимальный CI-low. Power gate: ≥100 событий.
После reveal вселенная сожжена для D6-класса гипотез.

Prereg `365f4e8c74651b07f4aa80d1882442440e5bab17bc253239bd5e28450fb57fdd`; amendment `1004952eb6404c9589b4cced33a296117e5a2928f6f968d55871d78605b84b80`; manifest `5ed29eb914d138349040de555ee7ef4560f3107dd2a9cded21eef243f9cb50d6`; seed 24082026.