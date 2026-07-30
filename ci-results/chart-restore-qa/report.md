# Visualizer QA: восстановление свечей и Heatmap performance

Дата: 2026-07-30
Ветка: `fix/chart-restore-performance`

## Причина тонких свечей

При входе в Confirmation сохранялся `visibleLogicalRange` — индексы баров. Затем candle series заменялся рядом другого TF с другим числом баров. При возврате те же индексы применялись к основному ряду, хотя соответствовали уже другой временной шкале. На реальных данных это меняло ширину/плотность свечей и давало эффект «тонких свечей».

Исправление: сохранять и восстанавливать `visibleRange` в реальных timestamp, а не logical bar indices.

## Регрессионный browser QA

Synthetic main: 500 баров. Synthetic confirmation: 2000 баров другого TF.

- main до Confirmation: time range `1782954900..1783404000`;
- Confirmation: другой ряд/range `1783588500..1783851300`;
- после закрытия: исходный main time range восстановлен с drift 0;
- `mainShown=true`;
- JS errors: 0.

Скриншот: `time-range-restore.png`.

## Лаг Heatmap

Раньше до 400 полос создавались как отдельные `LineSeries`. Каждая серия участвовала в lifecycle/layout библиотеки и удалялась/создавалась на redraw, что объясняет периодические фризы и низкий FPS.

Исправление: все полосы Heatmap рисуются одним canvas primitive.

Browser QA на fixture:

- Heatmap bands: 38;
- overlay LineSeries до включения: 14;
- после включения: 14, то есть Heatmap не добавил 38 отдельных series;
- requestAnimationFrame за 1 секунду: 62 кадра в headless Chromium;
- неожиданных ошибок: 0.

Это измерение fixture, не обещание ровно 60 FPS на любом реальном датасете, но устранён главный O(N series) источник тормозов.
