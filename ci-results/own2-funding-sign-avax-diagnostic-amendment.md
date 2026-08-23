# Immutable amendment — AVAX-only diagnostic reveal

Зафиксировано **до чтения AVAXUSDT outcomes** по явному решению пользователя.

Разрешён ровно один one-time diagnostic reveal: канонический OWN2 baseline против уже зафиксированного funding-sign filter на единственной совместимой frozen S1 серии **AVAXUSDT perpetual futures 1h** из untouched segment. Исходный файл и его frozen SHA-256 должны совпасть с S1 manifest.

Правило не меняется: LONG допускается только при latest strictly-prior settled funding < 0; SHORT — только > 0; zero/missing veto. Решение использует только settlement с `settlementTimestamp < decisionTimestamp`; future leakage запрещён. Management/execution остаются каноническими; primary costs 5 bps/side, 0 bps — gross diagnostic; actual direction-aware funding cashflows начисляются обеим рукам.

Этот reveal **не может дать общий clean multi-symbol GO**, потому что доступен один symbol и ожидаемый N < 250. Допустимая итоговая классификация только одна из:
- `DIAGNOSTIC SUPPORT`;
- `DIAGNOSTIC REJECTION`;
- `INCONCLUSIVE SMALL-N`.

AVAXUSDT futures 1h после запуска считается раскрытой/сожжённой серией. Остальные четыре spot-серии S1 не раскрываются и сохраняют untouched status. Нельзя обозначать весь S1 как `reveal=1`: статус reveal ведётся гранулярно по сериям.

Bootstrap остаётся frozen: paired UTC-day block/cluster, 10 000 resamples, seed `25082026`; primary comparison — mean/total net per baseline opportunity с veto=0.
