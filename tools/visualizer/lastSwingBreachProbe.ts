// lastSwingBreachProbe.ts
//
// ИЗОЛИРОВАННАЯ ЛОГИКА СЛОЯ B (вариант 2) для сравнительного визуализатора.
// НЕ часть пайплайна (не в src/core/). Живёт в tools/visualizer/.
//
// Отслеживает «актуальный последний swing high/low» из structure[] и применяет
// правило пробоя. Поддерживает два режима:
//   - 'single' : одно закрытие за уровнем = слом (v1, закрепление телом)
//   - 'two'    : two-candle confirmation (1-я = кандидат, 2-я = подтверждение)
//
// Уровень «существует» только с confirmedAt = point.index + window (look-ahead-free).
// Переназначение swing (новый экстремум того же типа) сбрасывает pending — допущение
// пробника (см. SPEC, раздел визуализатора).

import type { Candle } from '../../src/models/price/Candle.js'
import type { StructurePoint } from '../../src/models/structure/StructurePoint.js'

export type BreachMode = 'single' | 'two'

export interface SwingBreach {
	/** Пробитый swing-экстремум. */
	level: StructurePoint
	breachIndex: number
	breachTimestamp: number
	confirmIndex: number
	confirmTimestamp: number
	/**
	 * true = до слома у уровня уже снимали ликвидность (фитиль проколол
	 * цену, но закрытием слом не подтвердился). Такой фрактал «отработан» —
	 * живые трейдеры ждут слом от следующего нетронутого экстремума.
	 * Заполняется только пробником слоя C (пул активных уровней).
	 */
	sweptBeforeBreak?: boolean
	/**
	 * Максимальная глубина прокола фитилём до слома (в единицах цены),
	 * 0 = не снимали. Порог значимости сравнивается с K×ATR на клиенте.
	 * Заполняется только пробником слоя C.
	 */
	sweptDepth?: number
}

type Phase = 'none' | 'pending'

interface Pending {
	phase: Phase
	breachIndex: number
	breachTimestamp: number
}

function nonePending(): Pending {
	return { phase: 'none', breachIndex: -1, breachTimestamp: 0 }
}

/**
 * Пробник: для каждого structure-экстремума строит историю «актуального
 * последнего swing high/low» и фиксирует сломы по выбранному режиму.
 *
 * @param structure  — StructurePoint[] из snapshot
 * @param candles    — Candle[] из snapshot
 * @param window     — PivotDetector window (для confirmedAt датировки)
 * @param mode       — 'single' (одно закрытие = слом) или 'two' (two-candle confirmation)
 */
export function probeSwingBreaches(
	structure: StructurePoint[],
	candles: Candle[],
	window: number = 2,
	mode: BreachMode = 'two',
): SwingBreach[] {
	const breaches: SwingBreach[] = []
	let structIdx = 0

	let activeHigh: { point: StructurePoint; confirmedAt: number } | null = null
	let activeLow: { point: StructurePoint; confirmedAt: number } | null = null

	let pendingHigh: Pending = nonePending()
	let pendingLow: Pending = nonePending()

	for (let i = 0; i < candles.length; i++) {
		const candle = candles[i]!
		const ts = candle.timestamp

		// 1. Поглощаем structure-точки с index <= i.
		while (structIdx < structure.length && structure[structIdx]!.index <= i) {
			const pt = structure[structIdx]!
			const confirmedAt = pt.index + window
			if (pt.type === 'high') {
				activeHigh = { point: pt, confirmedAt }
				pendingHigh = nonePending()
			} else {
				activeLow = { point: pt, confirmedAt }
				pendingLow = nonePending()
			}
			structIdx++
		}

		// 2. Проверяем пробои — только если уровень подтверждён.
		if (activeHigh && i >= activeHigh.confirmedAt) {
			const result = processLevel(
				candle.close, activeHigh.point.price, pendingHigh, i, ts, 'above', mode,
			)
			if (result.committed) {
				breaches.push({
					level: activeHigh.point,
					breachIndex: result.breachIndex,
					breachTimestamp: result.breachTimestamp,
					confirmIndex: i,
					confirmTimestamp: ts,
				})
				activeHigh = null
				pendingHigh = nonePending()
			} else {
				pendingHigh = result.pending
			}
		}

		if (activeLow && i >= activeLow.confirmedAt) {
			const result = processLevel(
				candle.close, activeLow.point.price, pendingLow, i, ts, 'below', mode,
			)
			if (result.committed) {
				breaches.push({
					level: activeLow.point,
					breachIndex: result.breachIndex,
					breachTimestamp: result.breachTimestamp,
					confirmIndex: i,
					confirmTimestamp: ts,
				})
				activeLow = null
				pendingLow = nonePending()
			} else {
				pendingLow = result.pending
			}
		}
	}

	return breaches
}

interface ProcessResult {
	committed: boolean
	pending: Pending
	breachIndex: number
	breachTimestamp: number
}

/**
 * Автомат пробоя для одного уровня.
 * - 'single': одно закрытие за уровнем = сразу слом (pending не нужен).
 * - 'two': 1-е закрытие → pending, 2-е подряд → слом, обратно → защита.
 */
function processLevel(
	close: number,
	price: number,
	pending: Pending,
	index: number,
	timestamp: number,
	dir: 'above' | 'below',
	mode: BreachMode,
): ProcessResult {
	const isBreach = dir === 'above' ? close > price : close < price

	if (isBreach) {
		// Single-candle: сразу слом.
		if (mode === 'single') {
			return {
				committed: true,
				pending: nonePending(),
				breachIndex: index,
				breachTimestamp: timestamp,
			}
		}
		// Two-candle: pending → подтверждение.
		if (pending.phase === 'none') {
			return {
				committed: false,
				pending: { phase: 'pending', breachIndex: index, breachTimestamp: timestamp },
				breachIndex: index,
				breachTimestamp: timestamp,
			}
		}
		return {
			committed: true,
			pending: nonePending(),
			breachIndex: pending.breachIndex,
			breachTimestamp: pending.breachTimestamp,
		}
	}

	// Закрытие не за уровнем → защита (сброс pending).
	return {
		committed: false,
		pending: nonePending(),
		breachIndex: -1,
		breachTimestamp: 0,
	}
}
