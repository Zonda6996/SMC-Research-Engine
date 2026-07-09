// lastSwingBreachProbe.test.ts
//
// Юнит-тесты для изолированной логики слоя B визуализатора.
// Префикс синтетических данных — SPEC, раздел 8. НЕ часть пайплайна —
// тестирует пробник, живущий в tools/visualizer/.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { probeSwingBreaches } from '../tools/visualizer/lastSwingBreachProbe.js'
import type { Candle } from '../src/models/price/Candle.js'
import type { StructurePoint } from '../src/models/structure/StructurePoint.js'

const MS = 60_000

function candle(index: number, close: number, opts?: { high?: number; low?: number }): Candle {
	const high = opts?.high ?? close + 1
	const low = opts?.low ?? close - 1
	return { timestamp: index * MS, open: close, high, low, close, volume: 1 }
}

function pt(index: number, price: number, type: 'high' | 'low'): StructurePoint {
	return { index, timestamp: index * MS, price, type, label: 'UNKNOWN' }
}

const WINDOW = 2

describe('lastSwingBreachProbe — two-candle confirmation для swing high/low', () => {
	it('пробой последнего swing high: два закрытия выше = слом', () => {
		// swing high @4 (price=110). confirmedAt = 4+2 = 6.
		// candle[7] close 115 > 110 → pending. candle[8] close 116 → подтверждение.
		const candles = [
			candle(0, 100), candle(1, 102), candle(2, 100), candle(3, 103),
			candle(4, 110), candle(5, 108), candle(6, 109),
			candle(7, 115), // свеча пробоя
			candle(8, 116), // подтверждение
		]
		const structure = [pt(4, 110, 'high')]

		const breaches = probeSwingBreaches(structure, candles, WINDOW)

		assert.equal(breaches.length, 1)
		assert.equal(breaches[0]!.level.price, 110)
		assert.equal(breaches[0]!.level.type, 'high')
		assert.equal(breaches[0]!.breachIndex, 7, 'свеча пробоя')
		assert.equal(breaches[0]!.confirmIndex, 8, 'подтверждающая')
	})

	it('защита уровня: 2-я свеча закрылась обратно — слома нет', () => {
		// swing high @4 (110). confirmedAt=6.
		// candle[7] close 115 → pending. candle[8] close 108 (ниже) → защита.
		const candles = [
			candle(0, 100), candle(1, 102), candle(2, 100), candle(3, 103),
			candle(4, 110), candle(5, 108), candle(6, 109),
			candle(7, 115), // свеча пробоя
			candle(8, 108), // защита уровня
		]
		const structure = [pt(4, 110, 'high')]

		const breaches = probeSwingBreaches(structure, candles, WINDOW)

		assert.equal(breaches.length, 0, 'защита уровня — слома нет')
	})

	it('уровень ещё не подтверждён (index+window не достигнут) — пробой не считается', () => {
		// swing high @4 (110). confirmedAt = 6.
		// candle[5] close 115 > 110 → НО i=5 < confirmedAt=6 → не проверяем.
		// candle[6] close 116 → i=6 >= 6, начинаем проверку → pending.
		// candle[7] close 117 → подтверждение.
		const candles = [
			candle(0, 100), candle(1, 102), candle(2, 100), candle(3, 103),
			candle(4, 110), candle(5, 115), candle(6, 116),
			candle(7, 117),
		]
		const structure = [pt(4, 110, 'high')]

		const breaches = probeSwingBreaches(structure, candles, WINDOW)

		// Пробой начался на свече 5 (close 115 > 110), но уровень ещё не
		// подтверждён. Свеча 6 — первая доступная для проверки, но она уже
		// вторая подряд за уровнем → формально pending(6)+confirm(7).
		// Если свеча 5 не считается (i < confirmedAt), то свеча 6 = pending,
		// свеча 7 = confirm.
		assert.equal(breaches.length, 1, 'слом после подтверждения уровня')
		assert.equal(breaches[0]!.breachIndex, 6, 'pending только с подтверждённой свечи')
		assert.equal(breaches[0]!.confirmIndex, 7)
	})

	it('сброс pending при переназначении swing (новый экстремум того же типа)', () => {
		// swing high#1 @4 (110). confirmedAt=6.
		// candle[7] close 115 → pending против 110.
		// Новый swing high#2 @8 (120). confirmedAt=10.
		// Переназначение сбрасывает pending#1. Но новый уровень подтверждается
		// только с свечи 10. candle[9] close 125 — уровень ещё не подтверждён,
		// не проверяется. candle[10] close 126 > 120 → pending#2.
		// candle[11] close 127 → подтверждение.
		const candles = [
			candle(0, 100), candle(1, 102), candle(2, 100), candle(3, 103),
			candle(4, 110), candle(5, 108), candle(6, 109),
			candle(7, 115), // pending#1 против 110
			candle(8, 120), // новый swing high @8 (close=120 = price, не >)
			candle(9, 125), // уровень ещё не подтверждён (9 < 10)
			candle(10, 126), // pending#2 против 120
			candle(11, 127), // подтверждение#2
		]
		const structure = [pt(4, 110, 'high'), pt(8, 120, 'high')]

		const breaches = probeSwingBreaches(structure, candles, WINDOW)

		assert.equal(breaches.length, 1, 'только подтверждённый слом нового уровня')
		assert.equal(breaches[0]!.level.price, 120, 'пробит новый swing (120), не старый (110)')
		assert.equal(breaches[0]!.breachIndex, 10)
		assert.equal(breaches[0]!.confirmIndex, 11)
	})

	it('пробой swing low симметричен (два закрытия ниже)', () => {
		// swing low @4 (90). confirmedAt=6.
		// candle[7] close 85 → pending. candle[8] close 84 → подтверждение.
		const candles = [
			candle(0, 100), candle(1, 98), candle(2, 100), candle(3, 97),
			candle(4, 90), candle(5, 92), candle(6, 91),
			candle(7, 85), // свеча пробоя
			candle(8, 84), // подтверждение
		]
		const structure = [pt(4, 90, 'low')]

		const breaches = probeSwingBreaches(structure, candles, WINDOW)

		assert.equal(breaches.length, 1)
		assert.equal(breaches[0]!.level.price, 90)
		assert.equal(breaches[0]!.level.type, 'low')
		assert.equal(breaches[0]!.breachIndex, 7)
		assert.equal(breaches[0]!.confirmIndex, 8)
	})
})
