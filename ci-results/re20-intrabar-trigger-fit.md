# RE20 — интрабарный триггер (фитиль≥inner + объём + rearm) vs shapes: recall/precision

fire(buy)=low≤LoInner, fire(sell)=high≥UpInner (линии вендора), +volRatio≥volMin, +rearm у mean, опц. направление. Матч ±tol баров, greedy. density=fires/shape (≤8 для best). recall=сматченные shapes/все; precision=сматченные fires/все.

| файл | ТФ | shapes | A-priori recall/prec/F1 (dens) | BEST cfg | BEST recall/prec/F1 (dens) |
|---|---|---|---|---|---|
| BINANCE_BNBUSDT, 1.csv | 1m | 106 | 10% / 5% / 0.06 (2.27) | vol1.2,reject,±2 | 26% / 13% / 0.18 (1.99) |
| BINANCE_BNBUSDT, 10S.csv | 10s | 47 | 17% / 2% / 0.04 (6.87) | vol1.6,reject,±0 | 36% / 7% / 0.11 (5.55) |
| BINANCE_BNBUSDT, 1S.csv | 1s | 8 | 13% / 0% / 0.01 (34.88) | vol1.4,off,±1 | 13% / 0% / 0.01 (34.88) |
| BINANCE_BNBUSDT, 5.csv | 5m | 94 | 10% / 5% / 0.07 (1.82) | vol1.4,reject,±2 | 20% / 15% / 0.17 (1.37) |
| BINANCE_BTCUSDT, 5S.csv | 5s | 15 | 20% / 1% / 0.01 (32.13) | vol1.4,off,±1 | 20% / 1% / 0.01 (32.13) |
| BINANCE_ETHUSDT, 1.csv | 1m | 116 | 15% / 6% / 0.08 (2.53) | vol1.2,reject,±2 | 29% / 14% / 0.19 (2.13) |
| BINANCE_ETHUSDT, 120.csv | 2h | 85 | 6% / 4% / 0.05 (1.61) | vol1.6,reject,±1 | 22% / 18% / 0.20 (1.22) |
| BINANCE_ETHUSDT, 1S.csv | 1s | 10 | 40% / 1% / 0.02 (47.30) | vol1.4,off,±1 | 40% / 1% / 0.02 (47.30) |
| BINANCE_ETHUSDT, 5.csv | 5m | 89 | 12% / 6% / 0.08 (2.03) | vol0,reject,±2 | 20% / 11% / 0.14 (1.80) |
| BINANCE_ETHUSDT, 5S.csv | 5s | 40 | 33% / 3% / 0.05 (10.90) | vol1.4,off,±1 | 33% / 3% / 0.05 (10.90) |

_Ориентир: наш прежний OWN2 на closed-баре давал recall ~26–31% (dev) / ~20% (OOS). Если на 1s/5s recall≫этого при precision≫случайной — интрабар-касание-inner подтверждено как механизм. §2.1: линии зоны вендорские, порог объёма/направление свипаны (не выдуманы). src/core не тронут._