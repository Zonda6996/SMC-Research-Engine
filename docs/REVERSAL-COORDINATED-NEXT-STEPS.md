# Согласованный план продолжения Reversal

Дата: 2026-08-02  
Текущая ветка на момент исторического этапа: `research/htf-gap-falsification` (этап завершён; старые локальные research branches очищены)

## Цель текущего этапа

Не искать новую формулу Reversal прямо сейчас. Сначала определить, выдерживает ли HTF-гипотеза строгую попытку опровержения и можно ли вообще извлечь механизм global lock из одних vendor labels.

## 1. Что требуется от Никиты сейчас

Только два действия:

1. Этот H2/H3 этап завершён и сохранён как исторический план. Для нового GGI цикла использовать только `docs/CLAUDE-GGI-NEXT-DISCOVERY-PROMPT.md`.
2. После завершения Claude прислать Sol:
   - название ветки;
   - commit hashes;
   - финальный ответ Claude либо ссылку/текст его отчёта.

Сейчас от Никиты **не требуются**:

- новые CSV;
- новые TradingView exports;
- screenshots;
- ручная разметка;
- решение о production;
- запуск V8.

Новые данные потребуются только после falsification audit и только если H3 не будет отвергнута.

## 2. Что должен сделать Claude Fable 5

Claude отвечает за исправляющий исследовательский цикл на новой ветке `research/htf-gap-falsification`.

Обязательные задачи:

1. До расчётов preregister windows, null model и kill criteria.
2. Исправить трактовку V7':
   - это coupled age/recovery/extremum/spacing family;
   - spacing был same-side, не global;
   - полный корпус уже hypothesis-seen для H2/H3.
3. Проверить H2:
   - global и same-side gaps отдельно;
   - не отождествлять soft floor с rolling extremum;
   - определить, идентифицируется ли механизм lock по labels вообще.
4. Проверить H3:
   - одинаковые wall-clock windows ±30m/±60m/±240m;
   - circular-shift/block-preserving null;
   - same-direction primary и opposite-direction control;
   - one-to-one matches;
   - leave-one-event-out;
   - отдельный результат по каждой TF-паре;
   - общий four-TF overlap diagnostic.
5. Добавить deterministic tests и machine-readable JSON.
6. Запустить integrity/full tests/TypeScript gate.
7. Закоммитить тематически и push ветку.
8. Остановиться. `V8 NOT STARTED`.

Claude не должен:

- разрабатывать V8;
- оптимизировать F1 или прибыльность;
- менять production;
- добавлять окна после просмотра результата;
- просить новые данные до завершения аудита.

## 3. Что сделает Sol после Claude

После получения ветки Sol независимо:

1. Проверит ancestry и diff ветки.
2. Проверит, что preregistration commit действительно предшествует расчётам.
3. Перезапустит integrity, tests, TypeScript и research script.
4. Проверит byte-level или semantic reproducibility JSON/Markdown.
5. Проведёт code review circular shifts, matching, windows и leave-one-out.
6. Проверит, что null сохраняет:
   - label counts;
   - BUY/SELL directions;
   - inter-label gap structure;
   - отсутствие near-zero shifts.
7. Проверит synthetic fixtures на false-positive/true-positive поведение.
8. Пересчитает ключевые результаты независимо либо альтернативной реализацией.
9. Вынесет final verdict: `H3 rejected`, `H3 inconclusive` или `H3 survives falsification`.
10. Только после этого предложит preregistration следующего эксперимента.

Sol не будет автоматически доверять итоговому тексту Claude и не запустит V8 до независимой проверки.

## 4. Решение после аудита

### Сценарий A — H3 rejected

Если срабатывает kill criterion:

- V8 не создаётся;
- HTF-направление закрывается как неподтверждённое;
- текущий корпус сохраняется как negative research record;
- следующий шаг — новый observable information set либо controlled Risk-mode parameter perturbation, если он доступен.

### Сценарий B — H3 inconclusive

Если counts слишком малы или результаты зависят от одного события:

- V8 на текущих данных не запускается;
- запрашивается минимальный новый OOS dataset с TF companions;
- механизм и критерии фиксируются до получения новых labels.

### Сценарий C — H3 survives falsification

Если эффект устойчив минимум в двух соседних TF-парах, не держится на одном событии и не повторяется в opposite-direction control:

1. Текущий корпус используется только для development V8.
2. До detector run создаётся отдельная preregistration V8.
3. Нужен новый hypothesis-unseen OOS период/набор.
4. V8 должен иметь не более примерно 20 заранее фиксированных configs.
5. Exact one-to-one matching остаётся primary.
6. Production promotion возможен только после нового OOS gate.

## 5. Какие новые данные могут потребоваться позже

Только при сценарии B или C.

Предпочтительный минимальный набор:

- один и тот же Futures symbol;
- связанные TF, например 5m + 15m + 1h, желательно также 4h;
- Risk mode;
- одинаковый непрерывный UTC range;
- OHLC;
- GGI Mean, Upper Outer, Upper Inner, Lower Inner, Lower Outer;
- Shape0/BUY и Shape1/SELL;
- закрытые свечи, без текущей незавершённой свечи;
- manifest metadata и SHA-256.

Главное условие: период или symbol не должен быть просмотрен при разработке V8.

## 6. Текущая граница решений

До завершения двух последовательных проверок — Claude audit и Sol audit — запрещено утверждать:

- что hidden HTF state является механизмом оригинала;
- что episode age окончательно мёртв;
- что 52–60 bars — программный cooldown либо rolling-window lock;
- что Reversal готов к production replacement.

Текущий надёжный вывод остаётся узким: single-TF OHLC+bands grammars V1–V7 находят регионы, но не exact emission bar.
