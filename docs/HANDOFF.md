# HANDOFF — точка входа: что сейчас в работе

> **Что это:** тощий восстановитель контекста. Зашёл — понял, что происходит и какой
> следующий шаг. **Без** таблиц результатов и логов (они — в спеках стратегий и `outputs/`).
> **Как часто меняется:** часто. Читать после `AGENTS.md`.

---

## Сейчас в фокусе
**Zonda Reversal + Apex** — активная линия. Только что завершена уборка репозитория и
структурная переработка документации (Фазы 1–3 плана уборки).

## Вердикт по стратегии (одной строкой)
**HOLD research / NO-GO production.** Причинный baseline закрыт как trading edge; высокий
vendor-style WR не компенсирует слабый expectancy. Детали и цифры — `docs/strategies/zonda-reversal.md`.

## Следующий один шаг
Заморозить ровно **H1 Risk** (Apex contraction/regime guard) как research-only кандидат и
собрать новый **untouched paper-forward до 200 finalized trades** — с funding, cluster-equal
метрикой и отдельным long/short gate. Score/параметры не менять до checkpoint.

## Открытые технические хвосты
- Утечка #2 (`pool.notional` за всю жизнь пула) — не исправлена (см. `NEGATIVE-KNOWLEDGE.md`).
- `scripts/auditReversalBenchmark.ts` — сломан (регистр импорта `ArrowTradeReplay` + `meanNetR`).
- Посчитать накопленный paper-forward (`tmp/forward/`, ~3 недели).
- Прунинг `ci-results/` и раннеров `ci/research/` — после стабилизации доков.

## Куда смотреть
| Нужно | Файл |
|---|---|
| Правила работы в проекте | `AGENTS.md` |
| Как устроен движок / модули | `docs/ARCHITECTURE.md` |
| Логика Apex/Reversal, тейки, БУ | `docs/INDICATOR.md` |
| Активная стратегия + baseline | `docs/strategies/zonda-reversal.md` |
| Что отвергнуто / утечки | `docs/NEGATIVE-KNOWLEDGE.md` |
| Fib / POI (заморожены) | `docs/strategies/` |
| Историческая спека (лог) | `docs/archive/` |

## Рабочие команды
```bash
npm test
npx tsc --noEmit --pretty false
npm run research:integrity     # hashes/schema/chronology/counts + Apex OOS regression
npm run viz
```

---

## Красный список (НЕ удалять / трогать только по явному запросу)
- `ci-results/fwd1-telegram-forward-audit.json` — ~660 forward-стрелок вендора. Невоспроизводимо.
- `data/vendor-exports/`, `data/vendor-export/` — канонический exact Reversal corpus (vendor CSV).
- `ci-results/geo2-simulator-calibration.md` — геометрические константы со скринов симулятора.
- `ci-results/own2b-ablation.*`, `geo1-*` — цепочка доказательств.
- Калибровочные константы Apex/POI в `src/core/` — менять только по согласованию.
- `tmp/forward/` — накопительный paper-forward журнал (gitignored, не пересоздаётся задним числом).

> Историческая заметка: прежний HANDOFF §4 описывал перевод стопа в безубыток, которого
> **нет** в текущем `ArrowTradeReplay.ts`. Актуально: стоп фиксирован, в БУ не трейлится
> (см. `docs/INDICATOR.md` §6).
