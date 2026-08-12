# Apex: пользовательские TV-якоря 27.07.2026 01:00 Казахстан

- Timestamp: 2026-07-26T20:00:00.000Z (UTC), один и тот же bar-open для 5m/15m/1h/4h.
- Feed: TradingView BINANCE BTCUSDT Spot. Архив сравнения: Binance Spot data.binance.vision.
- TV-порядок значений интерпретирован как mean, upper outer, upper inner, lower inner, lower outer.
- Текущие defaults не менялись.

| TF | TV mean | model mean | mean err | TV s | model s | width err | max edge err |
|---|---:|---:|---:|---:|---:|---:|---:|
| 4h | 64825.74 | 64692.68 | -0.205% | 0.009212 | 0.009345 | 1.450% | 0.148% |
| 1h | 64507.54 | 64545.22 | 0.058% | 0.003153 | 0.003328 | 5.529% | 0.444% |
| 15m | 64516.53 | 64518.06 | 0.002% | 0.000952 | 0.001028 | 7.982% | 0.075% |
| 5m | 64687.52 | 64698.49 | 0.017% | 0.000613 | 0.000607 | -0.947% | 0.023% |

## Интерпретация

- Mean и width оцениваются отдельно; абсолютная долларовая разница линий не смешивается с feed basis.
- Здесь feed совпадает (spot против spot), поэтому остаток — ошибка модели/точности чтения status line, а не futures basis.
- Один timestamp на четырёх TF — calibration point, не доказательство vendor formula. Следующий gate — другие даты и OOS symbol.
