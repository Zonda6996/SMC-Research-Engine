// market-structure.test.ts
//
// Прямой unit-тест MarketStructureEngine на синтетических данных.
// Задаёт прецедент синтетических тестов в проекте (SPEC, раздел 8:
// «синтетические данные для чистой логики»).
//
// Свечи здесь строятся вручную и НЕ проходят через PivotDetector/SwingEngine —
// это сознательно: мы тестируем реакцию MarketStructureEngine на валидные
// StructurePoint[], а не весь пайплайн. Движок читает у свечи только .close
// (правило слома по two-candle confirmation, баг №3 v2).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { MarketStructureEngine } from '../src/core/builders/MarketStructureEngine.js'
import type { Candle } from '../src/models/price/Candle.js'
import type { StructurePoint } from '../src/models/structure/StructurePoint.js'

const MS = 60_000 // 1 минута на свечу — только для timestamp

function candle(
	index: number,
	close: number,
	opts?: { high?: number; low?: number },
): Candle {
	const high = opts?.high ?? close + 1
	const low = opts?.low ?? close - 1
	return { timestamp: index * MS, open: close, high, low, close, volume: 1 }
}

function pt(
	index: number,
	price: number,
	type: 'high' | 'low',
	label: StructurePoint['label'],
): StructurePoint {
	return { index, timestamp: index * MS, price, type, label }
}

/** Прогоняет движок по точкам и возвращает финальное состояние. */
function runEngine(points: StructurePoint[], candles: Candle[]) {
	const engine = new MarketStructureEngine()
	for (const p of points) engine.update(p, candles)
	return engine.getState()
}

describe('MarketStructureEngine — two-candle confirmation (баг №3 v2)', () => {
	it('protectedLow: одно закрытие ниже = кандидат, второе подряд = слом', () => {
		// protectedLow = 100 (low@2, после high@4 HH).
		// candle[5] close 95 < 100 → кандидат (pending).
		// candle[6] close 94 < 100 → подтверждение → breach, уровень обнулён.
		// low@7 приходит уже после пробоя — structure-точка просто закрывает окно.
		const candles = [
			candle(0, 105),
			candle(1, 102),
			candle(2, 100),
			candle(3, 103),
			candle(4, 110),
			candle(5, 95), // свеча пробоя
			candle(6, 94), // подтверждающая
			candle(7, 90),
		]
		const points = [
			pt(0, 105, 'high', 'UNKNOWN'),
			pt(2, 100, 'low', 'UNKNOWN'),
			pt(4, 110, 'high', 'HH'), // → protectedLow = 100
			pt(7, 90, 'low', 'LL'),
		]

		const state = runEngine(points, candles)

		assert.equal(state.protectedLow, undefined, 'уровень обнулён после подтверждённого слома')
		assert.equal(state.breached.length, 1)
		const b = state.breached[0]!
		assert.equal(b.level.price, 100)
		assert.equal(b.level.type, 'low')
		assert.equal(b.breachIndex, 5, 'свеча пробоя — №5')
		assert.equal(b.confirmIndex, 6, 'подтверждающая — №6')
		assert.equal(b.breachTimestamp, 5 * MS)
		assert.equal(b.confirmTimestamp, 6 * MS)
		// protectedHigh выставляется на LL-шаге (LL после high@4).
		assert.equal(state.protectedHigh?.price, 110)
	})

	it('protectedLow: 2-я свеча закрылась обратно = защита уровня, слома нет', () => {
		// protectedLow = 100. candle[5] close 95 → кандидат.
		// candle[6] close 101 → закрылась выше уровня → защита, pending сброшен.
		// Уровень выжил.
		const candles = [
			candle(0, 105),
			candle(1, 102),
			candle(2, 100),
			candle(3, 103),
			candle(4, 110),
			candle(5, 95), // свеча пробоя
			candle(6, 101), // защита уровня
			candle(7, 90),
		]
		const points = [
			pt(0, 105, 'high', 'UNKNOWN'),
			pt(2, 100, 'low', 'UNKNOWN'),
			pt(4, 110, 'high', 'HH'),
			pt(7, 90, 'low', 'LL'),
		]

		const state = runEngine(points, candles)

		assert.equal(state.protectedLow?.price, 100, 'уровень выжил после защиты')
		assert.equal(state.breached.length, 0, 'слома нет — защиты достаточно')
	})

	it('только фитиль за уровнем, закрытие внутри — не кандидат', () => {
		// protectedLow = 100. candle[5] low=95 (фитиль ниже), close=101 (выше).
		// По правилу (по close) — вообще не пробой. Кандидата нет.
		const candles = [
			candle(0, 105),
			candle(1, 102),
			candle(2, 100),
			candle(3, 103),
			candle(4, 110),
			candle(5, 101, { low: 95 }),
			candle(6, 102),
			candle(7, 90),
		]
		const points = [
			pt(0, 105, 'high', 'UNKNOWN'),
			pt(2, 100, 'low', 'UNKNOWN'),
			pt(4, 110, 'high', 'HH'),
			pt(7, 90, 'low', 'LL'),
		]

		const state = runEngine(points, candles)

		assert.equal(state.protectedLow?.price, 100, 'уровень активен — фитиль не считается')
		assert.equal(state.breached.length, 0)
	})

	it('protectedHigh симметрично: два закрытия выше = слом', () => {
		// protectedHigh = 110 (high@2, после low@4 LL).
		// candle[5] close 115 → кандидат. candle[6] close 116 → подтверждение.
		const candles = [
			candle(0, 100),
			candle(1, 105),
			candle(2, 110),
			candle(3, 103),
			candle(4, 95),
			candle(5, 115), // свеча пробоя
			candle(6, 116), // подтверждение
			candle(7, 120),
		]
		const points = [
			pt(0, 100, 'low', 'UNKNOWN'),
			pt(2, 110, 'high', 'UNKNOWN'),
			pt(4, 95, 'low', 'LL'), // → protectedHigh = 110
			pt(7, 120, 'high', 'HH'),
		]

		const state = runEngine(points, candles)

		assert.equal(state.protectedHigh, undefined, 'protectedHigh обнулён после слома')
		assert.equal(state.breached.length, 1)
		const b = state.breached[0]!
		assert.equal(b.level.price, 110)
		assert.equal(b.level.type, 'high')
		assert.equal(b.breachIndex, 5)
		assert.equal(b.confirmIndex, 6)
		// protectedLow выставляется на HH-шаге.
		assert.equal(state.protectedLow?.price, 95)
	})

	it('свеча structure-точки подтверждает кандидат из предыдущего окна', () => {
		// pending хранится между вызовами update(): свеча пробоя в одном окне,
		// подтверждение — на свече structure-точки в следующем окне.
		// protectedLow = 100 (low@2 → high@4 HH).
		// update(pt6 LH): окно (4,6] → candle[5] close 95 → pending(5);
		//   candle[6] close 94 < 100 → подтверждение. breach(5,6). LH не HH.
		// candle[6] — high-пивот (price=108 из high свечи), но close=94 (фитиль
		// вверх, закрытие ниже уровня) — реалистичная картина «сквиза».
		const candles = [
			candle(0, 105),
			candle(1, 102),
			candle(2, 100),
			candle(3, 103),
			candle(4, 110),
			candle(5, 95), // свеча пробоя (в окне pt6)
			candle(6, 94, { high: 108 }), // подтверждение + high-пивот (LH)
			candle(7, 93),
		]
		const points = [
			pt(0, 105, 'high', 'UNKNOWN'),
			pt(2, 100, 'low', 'UNKNOWN'),
			pt(4, 110, 'high', 'HH'), // → protectedLow = 100
			pt(6, 108, 'high', 'LH'), // LH: подтверждает кандидат, protectedLow не трогает
			pt(7, 93, 'low', 'LL'),
		]

		const state = runEngine(points, candles)

		assert.equal(state.protectedLow, undefined, 'слом подтверждён через structure-точку')
		assert.equal(state.breached.length, 1)
		assert.equal(state.breached[0]!.breachIndex, 5, 'свеча пробоя из предыдущего окна')
		assert.equal(state.breached[0]!.confirmIndex, 6, 'подтверждение — свеча structure-точки')
	})

	it('breached[] накапливает несколько подтверждённых сломов', () => {
		// Два независимых protectedLow, оба пробиты two-candle confirmation.
		//   low@2(100) → high@4(110,HH) [protectedLow#1=100]
		//   candle5(95)+candle6(94) → breach#1 (против 100)
		//   low@7(90) → high@10(115,HH) [protectedLow#2=90,候选なし]
		//   candle11(85)+candle12(84) → breach#2 (против 90)
		const candles = [
			candle(0, 105),
			candle(1, 102),
			candle(2, 100),
			candle(3, 103),
			candle(4, 110),
			candle(5, 95),
			candle(6, 94),
			candle(7, 90),
			candle(8, 108),
			candle(9, 109),
			candle(10, 109),
			candle(11, 85),
			candle(12, 84),
			candle(13, 80),
		]
		const points = [
			pt(0, 105, 'high', 'UNKNOWN'),
			pt(2, 100, 'low', 'UNKNOWN'),
			pt(4, 110, 'high', 'HH'),
			pt(7, 90, 'low', 'LL'),
			pt(10, 115, 'high', 'HH'),
			pt(13, 80, 'low', 'LL'),
		]

		const state = runEngine(points, candles)

		assert.equal(state.protectedLow, undefined)
		assert.equal(state.breached.length, 2)
		assert.equal(state.breached[0]!.level.price, 100)
		assert.equal(state.breached[0]!.breachIndex, 5)
		assert.equal(state.breached[0]!.confirmIndex, 6)
		assert.equal(state.breached[1]!.level.price, 90)
		assert.equal(state.breached[1]!.breachIndex, 11)
		assert.equal(state.breached[1]!.confirmIndex, 12)
	})

	it('getState() возвращает защитную копию breached[]', () => {
		const candles = [
			candle(0, 105), candle(1, 102), candle(2, 100), candle(3, 103),
			candle(4, 110), candle(5, 95), candle(6, 94), candle(7, 90),
		]
		const points = [
			pt(0, 105, 'high', 'UNKNOWN'),
			pt(2, 100, 'low', 'UNKNOWN'),
			pt(4, 110, 'high', 'HH'),
			pt(7, 90, 'low', 'LL'),
		]
		const engine = new MarketStructureEngine()
		for (const p of points) engine.update(p, candles)

		const a = engine.getState()
		const b = engine.getState()
		assert.notEqual(a.breached, b.breached, 'каждый вызов возвращает новый массив')
		assert.deepEqual(a.breached, b.breached, 'содержимое одинаковое')
	})
})
