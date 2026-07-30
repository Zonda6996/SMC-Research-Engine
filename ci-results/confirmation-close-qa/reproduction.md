# Б1: воспроизводимый сценарий закрытия Confirmation

Дата: 2026-07-30
Статус: только фиксация, механику не исправляли.

## Сценарий пользователя

1. Загрузить данные.
2. Открыть «Зоны ликвидности».
3. Показать Heatmap.
4. Открыть Confirmation — режим зон закрывается автоматически.
5. Скрыть Heatmap.
6. Закрыть Confirmation.

## Что записывалось

На каждом шаге: `S.mode`, `S.mainShown`, `S.hmOn`, visible logical range, размер chart/canvas и состояние кнопок.

## Fixture

- 500 баров основного ряда.
- После последовательности: `mode=trades`, `mainShown=true`, range `0..499`.
- Canvas остаётся ненулевым, JS ошибок нет.
- Скриншот: `shots/exact-close-sequence.png`.

## Контроль с реальной подменой candle series

К fixture добавлена синтетическая simplified-сделка с PARTIAL→TIME, после чего Confirmation реально вызвал `setCandles()` и `mainShown=false`.

Перед закрытием:
- `mode=conf`;
- `mainShown=false`;
- диапазон LTF `154..431`;
- статус `4H→15M · LONG · ТАЙМ-СТОП`.

После закрытия:
- `mode=trades`;
- `mainShown=true`;
- восстановлен диапазон основного ряда `0..499`.

Скриншот: `shots/synthetic-ltf-close-sequence.png`.

## Вывод

Точный путь пользователя зафиксирован, но на офлайн fixture текущая версия не воспроизводит визуальную деформацию. Это не опровергает баг на реальном наборе данных: нужен сохранённый реальный payload/дата, где он проявляется. До такого payload механику `activateMode/deactivateMode/restoreMainCandles/range` не меняем вслепую.
