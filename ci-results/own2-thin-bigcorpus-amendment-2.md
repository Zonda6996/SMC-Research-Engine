# OWN2-thinned big-corpus — AMENDMENT №2 (immutable, до просмотра любых исходов)

> Создан 2026-08-22 до вычисления/просмотра любых торговых исходов (выполнена только acquisition
> и QA данных). Уточняет одно место preregistration; всё остальное — без изменений.

## Причина

Инструменты вселенной — PERPETUAL-фьючерсы: позиции держатся через funding-сеттлменты, и по
стоящему соглашению проекта (HANDOFF «Стандарт издержек для прогонов», 2026-08-18) фьючерсный
фид обязан включать фактический funding в net-экономику. Формулировка §5 preregistration
(«netR при 5 bps») этого явно не зафиксировала.

## Изменение

**Primary endpoint** = pooled mean по всем resolved-сделкам величины
`netR@5bps + фактическая direction-aware funding-кассфлоу` (funding считается той же функцией
замороженной линии OWN2+funding-sign: `fundingContributionR`, strict settled-before-decision).
Дополнительно отчётываются дескриптивно: price-only netR@0/5 и gross@0.

Secondary-рука (funding-sign paired delta), гейты, bootstrap, seed, терминальность — без изменений.
