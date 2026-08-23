# RE21 — F&G-экстремум среди касаний внутренней полосы vs shapes

Гейт (RE20): фитиль≥inner + rearm у mean [+объём]. ФИЛЬТР: осциллятор oversold(buy)/overbought(sell). Ранг по F1 при density≤8, matched≥3. Осцилляторы причинны. Сравнивать с RE20 (гейт без F&G): там на 1m/5m F1~0.14–0.20, на fine precision 1–7%.

| файл | ТФ | shapes | BEST cfg | recall | precision | F1 | density | matched/fires |
|---|---|---|---|---|---|---|---|---|
| BINANCE_BNBUSDT, 1.csv | 1m | 106 | stoch21 30/70 vol0 reject ±2 | 21% | 9% | 0.13 | 2.25 | 22/238 |
| BINANCE_BNBUSDT, 10S.csv | 10s | 47 | stoch21 30/70 vol1.4 reject ±1 | 19% | 5% | 0.08 | 3.72 | 9/175 |
| BINANCE_BNBUSDT, 1S.csv | 1s | 8 | rsi14 30/70 vol0 off ±1 | 0% | 0% | 0.00 | n/a | 0/0 |
| BINANCE_BNBUSDT, 5.csv | 5m | 94 | stoch21 20/80 vol1.4 off ±2 | 15% | 9% | 0.11 | 1.60 | 14/150 |
| BINANCE_BTCUSDT, 5S.csv | 5s | 15 | rsi14 30/70 vol0 off ±1 | 0% | 0% | 0.00 | n/a | 0/0 |
| BINANCE_ETHUSDT, 1.csv | 1m | 116 | stoch21 20/80 vol1.4 off ±2 | 24% | 12% | 0.16 | 2.09 | 28/243 |
| BINANCE_ETHUSDT, 120.csv | 2h | 85 | stoch21 10/90 vol1.4 off ±2 | 14% | 11% | 0.12 | 1.27 | 12/108 |
| BINANCE_ETHUSDT, 1S.csv | 1s | 10 | rsi14 30/70 vol0 off ±1 | 0% | 0% | 0.00 | n/a | 0/0 |
| BINANCE_ETHUSDT, 5.csv | 5m | 89 | rsi14 30/70 vol0 off ±2 | 17% | 10% | 0.12 | 1.76 | 15/157 |
| BINANCE_ETHUSDT, 5S.csv | 5s | 40 | stoch21 30/70 vol1.4 reject ±1 | 35% | 5% | 0.09 | 6.88 | 14/275 |

_Вывод-критерий: если precision СРЕДИ касаний прыгает с ~1–18% (RE20) до заметно выше при живом recall — F&G-осциллятор и есть селектор. Если F1 остаётся ~0.2 и ниже (как OWN2) — F&G среди касаний тоже НЕ разделяет ⇒ селектор не на OHLCV (укрепляет §3, закрываем генерацию стрелки). ⚠ best выбран на этих же данных (in-sample, малые выборки на fine ТФ) — завышает; смотреть на порядок, не на точное число._