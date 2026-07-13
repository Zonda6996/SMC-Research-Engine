// fibCosts.ts
//
// Net EV: издержки (комиссия + проскальзывание) поверх gross-исходов
// FibLifecycleEngine. Чистые функции для batch-агрегации (и потенциально UI);
// gross-показатели НЕ подменяются — net идёт отдельными колонками.
//
// Модель издержек (утверждена с пользователем):
//   - комиссия FEE_RATE за каждую сторону (вход и любой выход) — taker
//     Binance USDT-M futures 0.05%;
//   - проскальзывание SLIP_RATE только на рыночные филлы: вход и стоп-выходы
//     (включая BE-стоп); лимитные тейк-профиты исполняются без слиппеджа.
//
// Все издержки считаются в R: (цена филла × ставка × доля объёма) / riskSize.
// Цены TP восстанавливаются из rTp1/rTp2 и направления сделки.

import type { FibSetupOutcome } from '@/models/fib/FibLifecycle.js'

/** Комиссия за сторону (taker, Binance USDT-M futures). */
export const FEE_RATE = 0.0005
/** Проскальзывание на рыночный филл (вход, стоп-выход). */
export const SLIP_RATE = 0.0002

/** Стоимость одного филла в R: цена × ставка × доля объёма / риск. */
function fillCostR(price: number, rate: number, fraction: number, riskSize: number): number {
	return (price * rate * fraction) / riskSize
}

/** Цена цели, восстановленная из R-мультипликатора и направления сделки. */
function targetPrice(outcome: FibSetupOutcome, rTarget: number): number {
	const sign = outcome.direction === 'long' ? 1 : -1
	return outcome.entryPrice! + sign * rTarget * outcome.riskSize!
}

/** Сделка разрешена по правилам агрегации: TP1 достигнут либо стоп без TP1. */
function isResolved(outcome: FibSetupOutcome): boolean {
	return (
		outcome.entered &&
		outcome.entryPrice != null &&
		outcome.riskSize != null &&
		outcome.riskSize > 0 &&
		(outcome.tp1Hit || outcome.state === 'stopped')
	)
}

/**
 * Net-результат в R при менеджменте «весь объём на TP1»:
 * - win  (TP1 достигнут): rTp1 − (вход fee+slip, TP1-выход только fee);
 * - loss (стоп без TP1):  −1 − (вход fee+slip, стоп-выход fee+slip);
 * - null — сделка не разрешена (нет входа или открыта без TP1).
 */
export function netFullR(outcome: FibSetupOutcome): number | null {
	if (!isResolved(outcome)) return null
	const entry = outcome.entryPrice!
	const risk = outcome.riskSize!
	const entryCost = fillCostR(entry, FEE_RATE + SLIP_RATE, 1, risk)

	if (outcome.tp1Hit) {
		const tp1Price = targetPrice(outcome, outcome.rTp1 ?? 0)
		return (outcome.rTp1 ?? 0) - entryCost - fillCostR(tp1Price, FEE_RATE, 1, risk)
	}
	return -1 - entryCost - fillCostR(outcome.stopPrice, FEE_RATE + SLIP_RATE, 1, risk)
}

/**
 * Net-результат в R при менеджменте «50% на TP1, стоп в безубыток, раннер до TP2»:
 * - loss (стоп без TP1): −1 − (вход fee+slip, стоп fee+slip);
 * - TP1 достигнут: половина закрыта на TP1 (fee), раннер:
 *   - state 'tp2' — вторая половина на TP2 (fee, лимитный — без слиппеджа);
 *   - иначе — BE-стоп по цене входа (fee+slip), gross-вклад раннера 0
 *     (консервативно: открытый без TP2 раннер тоже считается закрытым в BE —
 *     зеркально gross-формуле агрегации, где его вклад нулевой).
 */
export function netBeR(outcome: FibSetupOutcome): number | null {
	if (!isResolved(outcome)) return null
	const entry = outcome.entryPrice!
	const risk = outcome.riskSize!
	const entryCost = fillCostR(entry, FEE_RATE + SLIP_RATE, 1, risk)

	if (!outcome.tp1Hit) {
		return -1 - entryCost - fillCostR(outcome.stopPrice, FEE_RATE + SLIP_RATE, 1, risk)
	}

	const tp1Price = targetPrice(outcome, outcome.rTp1 ?? 0)
	let net = 0.5 * (outcome.rTp1 ?? 0) - entryCost - fillCostR(tp1Price, FEE_RATE, 0.5, risk)
	if (outcome.state === 'tp2') {
		const tp2Price = targetPrice(outcome, outcome.rTp2 ?? 0)
		net += 0.5 * (outcome.rTp2 ?? 0) - fillCostR(tp2Price, FEE_RATE, 0.5, risk)
	} else {
		// Раннер закрыт BE-стопом по цене входа: gross 0, издержки рыночного филла.
		net -= fillCostR(entry, FEE_RATE + SLIP_RATE, 0.5, risk)
	}
	return net
}
