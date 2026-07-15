// takeLadders.ts
//
// SPEC 7.22: лестницы тейк-профитов — реплей выходов на пуле сделок.
//
// Идея пользователя (визуальное ревью): вместо канонического менеджмента
// «50% на 141, раннер до 241 с BE» попробовать частичные фиксации раньше и
// глубже: 100 → 141/161 → 241, либо только 100 → 241.
//
// Методология (урок SPEC 7.20/7.21): НИКАКОЙ портфельной симуляции. Берём
// тот же пул сделок, что --eval-filters (входы и стопы канонические,
// look-ahead-free), и для каждой сделки реплеим ТОЛЬКО выходы по свечам —
// разные лестницы на одном и том же множестве входов. Композиционный рандом
// исключён: сделка либо в пуле, либо нет, лестница меняет только её netR.
//
// Конвенции реплея — зеркало FibLifecycleEngine (консервативные):
//   - до первой частичной фиксации конфликт стоп/тейк в одном баре = стоп;
//   - после первой фиксации стоп переезжает в BE (цена входа): первый
//     возврат к входу закрывает остаток по BE, конфликт BE/тейк = BE;
//   - бар, взявший тейк и коснувшийся входа, — тейк засчитан, остаток BE.
//
// Издержки — модель fibCosts: вход и стоп/BE-выходы fee+slip (рыночные),
// тейки только fee (лимитные). Все издержки в R от планового риска.

import type { Candle } from '@/models/price/Candle.js'
import type { FibSetupOutcome } from '@/models/fib/FibLifecycle.js'
import { FEE_RATE, SLIP_RATE } from '@/core/fib/fibCosts.js'

/** Ступень лестницы: уровень сетки (ratio) и доля объёма. */
export interface TakeLadderStep {
	ratio: number
	fraction: number
}

export interface TakeLadder {
	id: string
	steps: TakeLadderStep[]
}

/**
 * Варианты лестниц (SPEC 7.22). 'canon' — реплика канонического менеджмента
 * (50% на 141, раннер до 241) тем же реплеем: контроль корректности и честная
 * точка сравнения (любые артефакты реплея одинаково влияют на все варианты).
 */
export const TAKE_LADDERS: readonly TakeLadder[] = [
	{ id: 'canon', steps: [{ ratio: 141, fraction: 0.5 }, { ratio: 241, fraction: 0.5 }] },
	{ id: 't100-241', steps: [{ ratio: 100, fraction: 0.5 }, { ratio: 241, fraction: 0.5 }] },
	{ id: 't100-141-241', steps: [{ ratio: 100, fraction: 1 / 3 }, { ratio: 141, fraction: 1 / 3 }, { ratio: 241, fraction: 1 / 3 }] },
	{ id: 't100-161-241', steps: [{ ratio: 100, fraction: 1 / 3 }, { ratio: 161, fraction: 1 / 3 }, { ratio: 241, fraction: 1 / 3 }] },
	{ id: 't100-only', steps: [{ ratio: 100, fraction: 1 }] },
	// SPEC 7.26: фулл на 141 (запрос пользователя — сравнение с t100 на
	// новой базе bigbar + косты BingX).
	{ id: 't141-only', steps: [{ ratio: 141, fraction: 1 }] },
]

/** Стоимость филла в R (модель fibCosts). */
function fillCostR(price: number, rate: number, fraction: number, risk: number): number {
	return (price * rate * fraction) / risk
}

/**
 * Ставки издержек реплея. По умолчанию — историческая модель fibCosts
 * (вход рыночный), для SPEC 7.26 передаются ставки BingX: вход лимиткой
 * (maker), тейки лимитками (maker), стоп/BE рыночные (taker+slip).
 */
export interface LadderCostRates {
	/** Вход (доля цены). */
	entryRate: number
	/** Тейк лимиткой (доля цены). */
	takeRate: number
	/** Стоп/BE рыночный со слипом (доля цены). */
	stopRate: number
}

const DEFAULT_LADDER_COSTS: LadderCostRates = {
	entryRate: FEE_RATE + SLIP_RATE,
	takeRate: FEE_RATE,
	stopRate: FEE_RATE + SLIP_RATE,
}

/**
 * Реплей одной лестницы на одной сделке пула. Возвращает netR или null,
 * если позиция не разрешилась до конца данных (сделка исключается из
 * сравнения по ВСЕМ лестницам — пул должен быть идентичным).
 *
 * Ступени с ценой не в favorable-стороне от входа (например тейк на 100 для
 * breaker, чей вход и есть 100) отбрасываются, доли перенормируются на
 * оставшиеся. Если валидных ступеней нет — null.
 */
export function replayLadder(
	candles: Candle[],
	outcome: FibSetupOutcome,
	levelPrice: (ratio: number) => number | null,
	ladder: TakeLadder,
	costs: LadderCostRates = DEFAULT_LADDER_COSTS,
): number | null {
	if (!outcome.entered || outcome.entryIndex == null || outcome.entryPrice == null || outcome.riskSize == null || outcome.riskSize <= 0) return null
	const long = outcome.direction === 'long'
	const entry = outcome.entryPrice
	const stop = outcome.stopPrice
	const risk = outcome.riskSize

	// Валидация ступеней: цена тейка должна лежать за входом в сторону профита.
	const rawSteps = ladder.steps
		.map((s) => ({ price: levelPrice(s.ratio), fraction: s.fraction }))
		.filter((s): s is { price: number; fraction: number } =>
			s.price != null && (long ? s.price > entry : s.price < entry))
	if (rawSteps.length === 0) return null
	const totalFraction = rawSteps.reduce((sum, s) => sum + s.fraction, 0)
	const steps = rawSteps.map((s) => ({ price: s.price, fraction: s.fraction / totalFraction, filled: false }))

	const toR = (fraction: number, price: number): number =>
		(fraction * (long ? price - entry : entry - price)) / risk

	let net = -fillCostR(entry, costs.entryRate, 1, risk)
	let remaining = 1
	let filledAny = false

	for (let i = outcome.entryIndex; i < candles.length; i++) {
		const candle = candles[i]
		if (!candle) continue
		const touchedEntry = long ? candle.low <= entry : candle.high >= entry
		const hitStop = long ? candle.low <= stop : candle.high >= stop

		// После первой фиксации стоп в BE: возврат к входу закрывает остаток.
		// Конфликт BE/тейк внутри бара — консервативно BE.
		if (filledAny && touchedEntry) {
			net -= fillCostR(entry, costs.stopRate, remaining, risk)
			return net
		}
		// До первой фиксации конфликт стоп/тейк — консервативно стоп.
		if (!filledAny && hitStop) {
			net += toR(remaining, stop) - fillCostR(stop, costs.stopRate, remaining, risk)
			return net
		}

		for (const step of steps) {
			if (step.filled) continue
			const hitTp = long ? candle.high >= step.price : candle.low <= step.price
			if (!hitTp) continue
			step.filled = true
			filledAny = true
			net += toR(step.fraction, step.price) - fillCostR(step.price, costs.takeRate, step.fraction, risk)
			remaining -= step.fraction
		}
		if (remaining <= 1e-9) return net

		// Бар взял тейк и коснулся входа: тейк засчитан, остаток — BE
		// (последовательность внутри бара неизвестна, зеркало engine).
		if (filledAny && touchedEntry) {
			net -= fillCostR(entry, costs.stopRate, remaining, risk)
			return net
		}
	}
	// Данные кончились с открытым остатком — сделка не разрешена.
	return null
}
