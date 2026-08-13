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

## Paper-forward (Fib/BATTLE_CONFIG `battle-7.53-cost175-v5`) — посчитан 2026-08-13
> Это forward **Fib/BATTLE_CONFIG**, НЕ Reversal. Для активной линии — только справочный фон.
- **Live forward 20–29 июля** (строгий, заявка+amend известны до свечи fill): n=107, total **+18.67R**, mean **+0.175R**, WR 62.6%. Deep +0.170 / OTE +0.177; long +0.309 / short +0.026; 1h +0.495, 15m +0.170, 30m −0.006.
- **Frozen-config OOS replay 30 июля – 13 авг** (catch-up, конфиг заморожен): n=568, total +4.93R, mean **+0.009R**, WR 56.2%. Deep +0.056 / OTE −0.020; 1h +0.157, 30m +0.054, 15m **−0.069**.
- **Вывод:** edge не подтверждён на большей/свежей OOS-выборке — expectancy схлопнулся почти в ноль; стабилен только **1h**. Июльский результат — во многом артефакт короткого окна. Дорабатывать эту ветку не планируем.
- Раннер (`npm run forward`) не держится постоянно включённым; catch-up-сделки anti-backfill гардом корректно маркируются `forwardEligible:false`.

## Открытые технические хвосты
- Утечка #2 (`pool.notional` за всю жизнь пула) — не исправлена (см. `NEGATIVE-KNOWLEDGE.md`).
- ~~`scripts/auditReversalBenchmark.ts` — сломан.~~ ✅ Починен + перенесён в `tools/research/auditReversalBenchmark.ts` (tsc чист).
- ~~Посчитать накопленный paper-forward (`tmp/forward/`, ~3 недели).~~ ✅ Сделано 2026-08-13 (см. выше).
- Прунинг `ci-results/`/`ci/research/`: Партия 1 (UI/QA, 20 файлов) удалена 2026-08-13. Остаток (Apex-anchors, orphan-очередь, legacy independent-reversal) — по решению автора.
- Консолидация папок `scripts→tools`, `scratch→ci/research` — ✅ выполнено 2026-08-13.

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
