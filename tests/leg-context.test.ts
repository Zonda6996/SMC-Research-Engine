// leg-context.test.ts
//
// Прямой unit-тест LegContextEngine на синтетических данных.
// Проверяет алгоритм enclosingLegs/insideLegs (замена бывшего largerLeg):
// движок считает цепочку объемлющих непробитых структурных ног и НЕ решает,
// какая именно нога — «якорная»; ближняя [0] и внешняя [last] обе доступны
// потребителю (FibEngine / debug). Прецедент синтетических тестов — SPEC, раздел 8.
//
// Ноги здесь строятся вручную и НЕ проходят через StructuralLegEngine —
// это сознательно: мы тестируем логику вложенности, а не построение ног.
// LegContextEngine читает у ноги только start.price, end.price, direction.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { LegContextEngine } from '../src/core/legs/LegContextEngine.js'
import type { Leg, LegDirection } from '../src/models/legs/Leg.js'
import type { StructurePoint } from '../src/models/structure/StructurePoint.js'

function pt(
	index: number,
	price: number,
	type: 'high' | 'low',
): StructurePoint {
	return { index, timestamp: index, price, type, label: 'UNKNOWN' }
}

/** Берёт пару цен и направление, собирает Leg. start/end — StructurePoint. */
function leg(
	startPrice: number,
	endPrice: number,
	direction: LegDirection,
): Leg {
	const start: StructurePoint =
		direction === 'bullish'
			? pt(0, startPrice, 'low')
			: pt(0, startPrice, 'high')
	const end: StructurePoint =
		direction === 'bullish'
			? pt(1, endPrice, 'high')
			: pt(1, endPrice, 'low')
	return {
		start,
		end,
		direction,
		range: Math.abs(endPrice - startPrice),
		candles: 1,
		duration: 1,
	}
}

describe('LegContextEngine — enclosingLegs / insideLegs', () => {
	it('базовая вложенность: ближняя и внешняя обе доступны', () => {
		// Три ноги, ни одна не пробила protected предыдущей.
		//   нога 0: 100 → 80   (bearish, protected = 100 — верх)
		//   нога 1:  80 → 95   (bullish, не пробила 100: 95 < 100)
		//   нога 2:  95 → 85   (bearish, не пробила 100: 95, 85 < 100)
		const legs = [
			leg(100, 80, 'bearish'),
			leg(80, 95, 'bullish'),
			leg(95, 85, 'bearish'),
		]

		const ctx = new LegContextEngine().build(legs)

		// Нога 0 — самая ранняя, объемлющих нет.
		assert.equal(ctx[0]!.enclosingLegs.length, 0)
		// Нога 1: объемлющая только нога 0 (ближняя = внешняя).
		assert.equal(ctx[1]!.enclosingLegs.length, 1)
		assert.equal(ctx[1]!.enclosingLegs[0], legs[0])
		// Нога 2: две объемлющих — ближняя нога 1, внешняя нога 0.
		assert.equal(ctx[2]!.enclosingLegs.length, 2)
		assert.equal(ctx[2]!.enclosingLegs[0], legs[1], 'ближняя [0] = нога 1')
		assert.equal(ctx[2]!.enclosingLegs[1], legs[0], 'внешняя [last] = нога 0')
	})

	it('пробой внешней ноги выкидывает её из enclosingLegs', () => {
		// SOL-стиль: крупная bearish-нога 0 (protected 83.42) остаётся значимой,
		// пока нога 3 не закрывается выше 83.42. Нога 3 пробивает protected ноги 0
		// (и заодно ноги 2), но НЕ ноги 1.
		//   нога 0: 83.42 → 60.13  (bearish, protected 83.42)
		//   нога 1: 60.13 → 75.00  (bullish, protected 60.13)
		//   нога 2: 75.00 → 65.00  (bearish, protected 75.00)
		//   нога 3: 65.00 → 90.00  (bullish, пробила 83.42: 90 > 83.42)
		const legs = [
			leg(83.42, 60.13, 'bearish'),
			leg(60.13, 75.0, 'bullish'),
			leg(75.0, 65.0, 'bearish'),
			leg(65.0, 90.0, 'bullish'),
		]

		const ctx = new LegContextEngine().build(legs)

		// Нога 3: protected ноги 0 (83.42) пробит её end (90) → нога 0 вылетела.
		// protected ноги 2 (75) тоже пробит (90 > 75) → вылетела.
		// protected ноги 1 (60.13, низ) НЕ пробит (65, 90 > 60.13) → выжила.
		assert.equal(ctx[3]!.enclosingLegs.length, 1, 'только нога 1 выжила')
		assert.equal(ctx[3]!.enclosingLegs[0], legs[1], 'внешняя = нога 1, не 0')
		// Нога 0 больше не enclosing для ноги 3 — пробита к моменту её формирования.
		assert.ok(
			!ctx[3]!.enclosingLegs.includes(legs[0]!),
			'нога 0 исключена — protected пробит',
		)
	})

	it('insideLegs — обратная карта: кто кого объемлет', () => {
		// Тот же сценарий, что в первом тесте. Проверяем обратную связь:
		// если нога i имеет ногу j в enclosingLegs, то нога j имеет i в insideLegs.
		const legs = [
			leg(100, 80, 'bearish'), // 0
			leg(80, 95, 'bullish'), // 1
			leg(95, 85, 'bearish'), // 2
		]

		const ctx = new LegContextEngine().build(legs)

		// Нога 0 объемлет ноги 1 и 2.
		assert.equal(ctx[0]!.insideLegs.length, 2)
		assert.ok(ctx[0]!.insideLegs.includes(legs[1]!))
		assert.ok(ctx[0]!.insideLegs.includes(legs[2]!))
		// Нога 1 объемлет только ногу 2.
		assert.equal(ctx[1]!.insideLegs.length, 1)
		assert.equal(ctx[1]!.insideLegs[0], legs[2])
		// Нога 2 — самая поздняя, никого внутри нет.
		assert.equal(ctx[2]!.insideLegs.length, 0)
	})

	it('insideLegs не включает ноги, пробившие protected', () => {
		// SOL-сценарий: нога 3 пробила protected ноги 0 → не должна попасть
		// в insideLegs ноги 0. Но нога 3 объемлется ногой 1 → попадает в её insideLegs.
		const legs = [
			leg(83.42, 60.13, 'bearish'), // 0
			leg(60.13, 75.0, 'bullish'), // 1
			leg(75.0, 65.0, 'bearish'), // 2
			leg(65.0, 90.0, 'bullish'), // 3
		]

		const ctx = new LegContextEngine().build(legs)

		// Нога 0 объемлет 1 и 2, но НЕ 3 (та пробила её protected).
		assert.equal(ctx[0]!.insideLegs.length, 2, 'ноги 1 и 2, без 3')
		assert.ok(!ctx[0]!.insideLegs.includes(legs[3]!))
		// Нога 1 объемлет 2 и 3 (нога 3 не пробила protected 60.13).
		assert.equal(ctx[1]!.insideLegs.length, 2)
		assert.ok(ctx[1]!.insideLegs.includes(legs[3]!))
	})

	it('касание protected (строгое сравнение) — не пробой', () => {
		// Если точка ноги точно равна protected, пробоя нет (строгое >/<).
		//   нога 0: 100 → 80  (bearish, protected 100)
		//   нога 1:  80 → 100 (bullish, end = 100 = protected, не > 100)
		const legs = [
			leg(100, 80, 'bearish'),
			leg(80, 100, 'bullish'),
		]

		const ctx = new LegContextEngine().build(legs)

		assert.equal(ctx[1]!.enclosingLegs.length, 1, 'касание не пробивает')
		assert.equal(ctx[1]!.enclosingLegs[0], legs[0])
	})

	it('previous/next/isLast/index остаются корректными', () => {
		// Базовая индексация не должна сломаться при добавлении enclosingLegs.
		const legs = [
			leg(100, 80, 'bearish'),
			leg(80, 95, 'bullish'),
			leg(95, 85, 'bearish'),
		]

		const ctx = new LegContextEngine().build(legs)

		assert.equal(ctx[0]!.index, 0)
		assert.equal(ctx[0]!.isLast, false)
		assert.equal(ctx[0]!.previous, undefined)
		assert.equal(ctx[0]!.next, legs[1])

		assert.equal(ctx[1]!.index, 1)
		assert.equal(ctx[1]!.previous, legs[0])
		assert.equal(ctx[1]!.next, legs[2])

		assert.equal(ctx[2]!.index, 2)
		assert.equal(ctx[2]!.isLast, true)
		assert.equal(ctx[2]!.next, undefined)
	})
})
