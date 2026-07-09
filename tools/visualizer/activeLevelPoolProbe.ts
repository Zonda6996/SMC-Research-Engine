// activeLevelPoolProbe.ts
//
// ИЗОЛИРОВАННАЯ ЛОГИКА СЛОЯ C (вариант 3: «пул активных уровней»)
// для сравнительного визуализатора. НЕ часть пайплайна (не в src/core/).
//
// Отличие от слоёв A и B: уровни НЕ вытесняются более свежими.
// Каждый подтверждённый structure-экстремум попадает в пул и живёт там,
// пока не будет пробит (по выбранному правилу пробоя). Слом ЛЮБОГО
// активного уровня — событие. Так «важный уровень слева» никогда не
// теряется, даже если после него появились более близкие экстремумы.
//
// Look-ahead-free: уровень существует для проверки пробоя только с
// confirmedAt = point.index + window. Правило пробоя — то же, что в
// остальных слоях ('single' — одно закрытие, 'two' — two-candle
// confirmation с защитой уровня). Pending-состояние у каждого уровня своё.

import type { Candle } from '../../src/models/price/Candle.js'
import type { StructurePoint } from '../../src/models/structure/StructurePoint.js'
import type { BreachMode, SwingBreach } from './lastSwingBreachProbe.js'

interface PoolLevel {
	point: StructurePoint
	confirmedAt: number
	/** Two-candle: первое закрытие за уровнем (кандидат), null = нет pending. */
	pending: { breachIndex: number; breachTimestamp: number } | null
}

/**
 * Пробник слоя C: пул активных уровней.
 *
 * @param structure — StructurePoint[] из snapshot
 * @param candles   — Candle[] из snapshot
 * @param window    — PivotDetector window (датировка confirmedAt)
 * @param mode      — правило пробоя ('single' | 'two'), общее для всех слоёв
 */
export function probeActiveLevelPool(
	structure: StructurePoint[],
	candles: Candle[],
	window: number = 2,
	mode: BreachMode = 'two',
): SwingBreach[] {
	const breaches: SwingBreach[] = []
	const pool: PoolLevel[] = []
	let structIdx = 0

	for (let i = 0; i < candles.length; i++) {
		const candle = candles[i]!
		const ts = candle.timestamp

		// 1. Поглощаем structure-точки, возникшие к этой свече.
		//    Уровень станет проверяемым только с confirmedAt (look-ahead-free).
		while (structIdx < structure.length && structure[structIdx]!.index <= i) {
			const pt = structure[structIdx]!
			pool.push({ point: pt, confirmedAt: pt.index + window, pending: null })
			structIdx++
		}

		// 2. Проверяем пробой КАЖДОГО активного уровня независимо.
		for (let p = pool.length - 1; p >= 0; p--) {
			const lvl = pool[p]!
			if (i < lvl.confirmedAt) continue

			const isBreach =
				lvl.point.type === 'high'
					? candle.close > lvl.point.price
					: candle.close < lvl.point.price

			if (!isBreach) {
				// Закрытие вернулось за уровень → защита, сброс кандидата.
				lvl.pending = null
				continue
			}

			if (mode === 'single') {
				breaches.push({
					level: lvl.point,
					breachIndex: i,
					breachTimestamp: ts,
					confirmIndex: i,
					confirmTimestamp: ts,
				})
				pool.splice(p, 1)
				continue
			}

			// two-candle confirmation
			if (lvl.pending === null) {
				lvl.pending = { breachIndex: i, breachTimestamp: ts }
			} else {
				breaches.push({
					level: lvl.point,
					breachIndex: lvl.pending.breachIndex,
					breachTimestamp: lvl.pending.breachTimestamp,
					confirmIndex: i,
					confirmTimestamp: ts,
				})
				pool.splice(p, 1)
			}
		}
	}

	// Сортировка по свече подтверждения — на одной свече может сломаться
	// несколько уровней сразу (каскад), порядок делаем детерминированным.
	breaches.sort(
		(a, b) => a.confirmIndex - b.confirmIndex || a.level.index - b.level.index,
	)
	return breaches
}
