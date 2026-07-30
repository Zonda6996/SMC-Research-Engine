# Browser QA: маркеры сделок и routing confirmation TF

Дата: 2026-07-30
Ветка: `fix/confirmation-tf-routing`
Источник: офлайн fixture
Viewport: 1600×1000

## Маркеры главного графика

- Deep по умолчанию: OFF
- OTE по умолчанию: OFF
- BOS/CHoCH по умолчанию: ON
- protected по умолчанию: OFF
- Все четыре переключателя находятся внутри панели `tradesPanel`
- Дублирующихся DOM id: 0
- Неожиданных console/page ошибок: 0

Скриншот: `shots/trade-marker-toggles.png`.

## Confirmation TF

Server payload содержит независимые поля `simplifiedTf`, `refinedTf`, `ltfSimplified`, `ltfConf` и mode-specific indicators.

На fixture 4h:
- simplified UI выбирает 1h по §14.1, но сделок в коротком fixture-окне нет;
- refined UI выбирает 15m и показывает `4h→15m`;
- отсутствие сделок в fixture не считается QA события TIME.

Скриншот: `shots/simplified-routing.png`.

## TIME

Отдельный синтетический browser QA подтвердил:
- outcome `ТАЙМ-СТОП`;
- фиолетовый marker state `TIME`;
- trace-текст `тайм-стоп: остаток закрыт по времени`;
- статус `4H→15M · ... · ТАЙМ-СТОП`.
