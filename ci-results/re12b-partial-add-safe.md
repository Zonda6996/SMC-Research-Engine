# RE12b — partial + add, БЕЗ full-fix-at-mean, только safe (ETH/SOL, 2h), NET-edge

**Цель:** воспроизвести Partial/FullFix профиль вендора (Partial ~28%, FullFix ~52–60%). В отличие от RE12 (`re12-vendor-2h-reproduce.*`, арм `fullFixAtMean=true`), здесь base `{fullFixAtMean:false, addEnabled:true}`: full-fix-at-mean выключен, доборы включены — чтобы у safe-режима заработал динамический partial-менеджмент (частичная фиксация + полная цель) и корзина PARTIAL стала ненулевой.

> §2.1/§2.2: стоп подобран под **stop-rate** вендора (не по Avg-stop — его в этой версии нет; не по правилу автора — оно неизвестно). Движок `src/core` НЕ тронут, только config-override. Входы = vendor CSV shapes; геометрия — каноничные Apex-полосы. base `{fullFixAtMean:false, addEnabled:true}`; гоняется только режим `safe`.

## ETH 2h

Вендор: N=84, WR=81%, Stop=19%, Partial=28.6%, FullFix=52.4%.

| mode | подобр. stopSteps | достигнутый stop-rate (vs вендор) | N | комиссия bps/side | WR | stop% | partial% | fullfix% | totalR | meanR | PF |
|---|---|---|---|---|---|---|---|---|---|---|---|
| safe | 2 | 38.3% (вендор 19%) | 60 | 0 | 60.0% | 38.3% | 0.0% | 61.7% | -6.324 | -0.105 | 0.70 |
|  |  |  |  | 5 | 60.0% | 38.3% | 0.0% | 61.7% | -6.792 | -0.113 | 0.68 |

**Vendor-vs-наши (на 0 bps, терминальная таксономия):**

| mode | WR наши / вендор | Partial наши / вендор | Stop наши / вендор | FullFix наши / вендор |
|---|---|---|---|---|
| safe | 60.0% / 81% | 0.0% / 28.6% | 38.3% / 19% | 61.7% / 52.4% |

## SOL 2h

Вендор: N=88, WR=88.6%, Stop=11.4%, Partial=28.4%, FullFix=60.2%.

| mode | подобр. stopSteps | достигнутый stop-rate (vs вендор) | N | комиссия bps/side | WR | stop% | partial% | fullfix% | totalR | meanR | PF |
|---|---|---|---|---|---|---|---|---|---|---|---|
| safe | 1.75 | 32.8% (вендор 11.4%) | 58 | 0 | 65.5% | 32.8% | 0.0% | 67.2% | 1.451 | 0.025 | 1.09 |
|  |  |  |  | 5 | 65.5% | 32.8% | 0.0% | 67.2% | 1.111 | 0.019 | 1.07 |

**Vendor-vs-наши (на 0 bps, терминальная таксономия):**

| mode | WR наши / вендор | Partial наши / вендор | Stop наши / вендор | FullFix наши / вендор |
|---|---|---|---|---|
| safe | 65.5% / 88.6% | 0.0% / 28.4% | 32.8% / 11.4% | 67.2% / 60.2% |

## Вердикт (честный)

- **ETH 2h** (safe, stopSteps=2, stop-rate 38.3% vs вендор 19%): PARTIAL по-прежнему 0% = 0.0% vs вендор 28.6% (-28.6 п.п.). WR 60.0% vs вендор 81% (-21.0 п.п.). Профиль-Δ (сумма |Δstop|+|Δpartial|+|Δfullfix|) = 57.2 п.п. Net-edge на 5 bps: totalR=-6.792, meanR=-0.113, PF=0.68 → НЕ положителен.
- **SOL 2h** (safe, stopSteps=1.75, stop-rate 32.8% vs вендор 11.4%): PARTIAL по-прежнему 0% = 0.0% vs вендор 28.4% (-28.4 п.п.). WR 65.5% vs вендор 88.6% (-23.1 п.п.). Профиль-Δ (сумма |Δstop|+|Δpartial|+|Δfullfix|) = 56.8 п.п. Net-edge на 5 bps: totalR=1.111, meanR=0.019, PF=1.07 → ПОЛОЖИТЕЛЕН.

_Оговорки: стоп подобран под **stop-rate** вендора, а не под реальное правило автора (оно неизвестно); издержки — симметричный taker-прокси (5 bps/side ≈ BingX VIP0 taker 0.05%), спот, без funding; геометрия — каноничные Apex-полосы. Корзина PARTIAL = терминальный `partial-be` (частичная фиксация, затем выход не по TP). `timeout` исключён из vendor-таксономии (у вендора его нет). Это арм `fullFixAtMean=false, addEnabled=true`; арм `fullFixAtMean=true` — в `re12-vendor-2h-reproduce.*`._
