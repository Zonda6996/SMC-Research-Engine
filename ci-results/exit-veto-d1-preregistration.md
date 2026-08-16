# D1 exit × vol-veto — пред-регистрация

> Трек D1 (`docs/ROADMAP.md`). Пред-регистрируется ДО прогона. Вердикт/пороги — ⚠ решает автор.
> Раннер: `tools/research/exitVetoD1.ts`. Артефакт: `ci-results/exit-veto-d1.json`.

## Гипотеза
Baseline даёт vendor-WR ~0.83 при meanR≈0 → подозрение на утечку R в геометрии **выхода**
(`NEGATIVE-KNOWLEDGE §8`). Плюс из D4b есть durable причинный risk-filter «не торговать сигнал в
**low-vol** режиме BTC-2h». Вопрос: меняет ли картину смена выхода (фикс-TP → pure-hold) и/или
вето low-vol сигналов.

## Дизайн (2×2 = 4 плеча)
Вход фиксирован: весь допущенный набор стрелок (`admitArrowSignals`, filter=off, A1-путь),
5 активов × 3 ТФ (SOL/BTC/ETH/XRP/BNB × 30m/1h/2h), safe-геометрия.

- **Выход:**
  - **A0 (референс):** `safe/static-full`, тейк `2×step` — `replayStatic` вербатим.
  - **A1 (pure-hold):** та же safe-геометрия и стоп, но **без фикс-TP** — выход только по стопу
    или `maxHoldingBars` (timeout). Аблация TP-ветки, новых чисел нет.
- **Veto (BTC-2h realized-vol, причинный):**
  - **OFF:** high ∪ low.
  - **ON:** только **high-vol** (low-vol сигналы отброшены).
  - warmup-строки (режим не определён) исключены из **обоих** плеч — единственное отличие
    OFF↔ON это low-vol дроп.

## Заморожено (§2.1 — не свипается)
- Окна режима: `VOL_WINDOW=120`, `VOL_MEDIAN_WINDOW=1000` (как в `regimeGateD4Vol.ts`).
- `TARGET_STEPS=2`, издержки `7 bps/side`, `TRAIN_FRACTION=0.65`.
- Bootstrap: 2000 trade-level resamples, seed `20260807`.

## Метрики
Для каждого из 4 плеч: train/OOS (65/35 по времени) meanR + 95% bootstrap CI, PF, N, clusters;
per-asset breadth на OOS. Причинность: BTC-2h режим = трейлинг-std лог-доходностей + трейлинг-медиана
+ последний BTC-бар с `ts ≤ signalAt` (no look-ahead).

## §2.3
`src/` не тронут; `replayStatic`, vol-режим, `regimeAsOf` и stats-хелперы скопированы вербатим из
`tools/research/regimeGateD4Vol.ts`.
