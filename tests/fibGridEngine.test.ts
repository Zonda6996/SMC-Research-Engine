import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FibGridEngine } from '../src/core/fib/FibGridEngine.js'
import type { StructureEvent } from '../src/models/events/StructureEvent.js'
import type { StructurePoint } from '../src/models/structure/StructurePoint.js'

const MS = 60_000

function pt(index: number, price: number, type: 'high' | 'low', label: StructurePoint['label'] = 'UNKNOWN'): StructurePoint {
	return { index, timestamp: index * MS, price, type, label }
}

function event(overrides: Partial<StructureEvent> = {}): StructureEvent {
	return {
		type: 'bos',
		direction: 'up',
		levelPrice: 110,
		levelType: 'high',
		levelIndex: 20,
		levelLabel: 'HH',
		breachIndex: 29,
		breachTimestamp: 29 * MS,
		confirmIndex: 30,
		confirmTimestamp: 30 * MS,
		sweptBefore: false,
		sweptDepth: 0,
		...overrides,
	}
}

describe('FibGridEngine — уровни', () => {
	it('вычисляет одинаковые ratios для long и short с правильным знаком', () => {
		const long = FibGridEngine.levels(100, 200)
		const short = FibGridEngine.levels(200, 100)
		assert.equal(long.find((level) => level.ratio === 50)?.price, 150)
		assert.equal(short.find((level) => level.ratio === 50)?.price, 150)
		assert.equal(long.find((level) => level.ratio === 61.8)?.price, 161.8)
		assert.equal(short.find((level) => level.ratio === 61.8)?.price, 138.2)
		assert.equal(long.find((level) => level.ratio === 161)?.price, 261)
		assert.equal(short.find((level) => level.ratio === 161)?.price, 39)
		assert.equal(long.find((level) => level.ratio === 300)?.price, 400)
		assert.equal(long.length, 13)
	})
})

describe('FibGridEngine — структурные якоря', () => {
	it('0% берётся из отката МЕЖДУ уровнем и пробоем, а не до уровня', () => {
		const structure = [
			pt(2, 90, 'low', 'LL'),
			pt(8, 104, 'high', 'HH'),
			pt(12, 96, 'low', 'HL'),
			pt(20, 110, 'high', 'HH'), // пробиваемый уровень
			pt(25, 101, 'low', 'HL'), // откат перед импульсом — настоящий 0%
		]
		const result = new FibGridEngine().build({ events: [event()], structure })
		assert.equal(result.candidates.length, 1)
		const candidate = result.candidates[0]
		assert.equal(candidate?.start.index, 25)
		assert.equal(candidate?.start.price, 101)
		assert.equal(candidate?.end.index, 20)
		assert.equal(candidate?.end.price, 110)
		assert.equal(candidate?.createdAtIndex, 30)
	})

	it('без промежуточного отката берётся последний валидный свинг до уровня', () => {
		const structure = [
			pt(12, 96, 'low', 'HL'),
			pt(20, 110, 'high', 'HH'),
		]
		const result = new FibGridEngine().build({ events: [event()], structure })
		assert.equal(result.candidates[0]?.start.index, 12)
	})

	it('short-событие берёт последний high перед пробоем low', () => {
		const structure = [
			pt(10, 120, 'high', 'HH'),
			pt(20, 100, 'low', 'HL'), // пробиваемый уровень
			pt(25, 112, 'high', 'LH'), // откат перед импульсом вниз
		]
		const result = new FibGridEngine().build({
			events: [event({ type: 'choch', direction: 'down', levelType: 'low', levelPrice: 100, levelLabel: 'HL' })],
			structure,
		})
		const candidate = result.candidates[0]
		assert.equal(candidate?.direction, 'short')
		assert.equal(candidate?.start.index, 25)
		assert.equal(candidate?.end.price, 100)
	})

	it('unlabeled не строит сетку и оставляет один диагностический skip', () => {
		const result = new FibGridEngine().build({ events: [event({ type: 'unlabeled' })], structure: [] })
		assert.equal(result.candidates.length, 0)
		assert.equal(result.skips.length, 1)
		assert.equal(result.skips[0]?.reason, 'unlabeled-event')
	})

	it('якорь, подтверждённый после события, отклоняется без look-ahead', () => {
		// Единственный откат подтверждается на 31-й свече (29+2), событие — на 30-й.
		const structure = [pt(20, 110, 'high', 'HH'), pt(29, 96, 'low', 'HL')]
		const result = new FibGridEngine({ pivotWindow: 2 }).build({ events: [event()], structure })
		assert.equal(result.candidates.length, 0)
		assert.equal(result.skips[0]?.reason, 'missing-opposite-swing')
	})

	it('свинг с невалидным диапазоном пропускается в пользу более раннего валидного', () => {
		const structure = [
			pt(12, 96, 'low', 'HL'),
			pt(20, 110, 'high', 'HH'),
			pt(25, 115, 'low', 'HL'), // «низ» выше уровня — невалидный диапазон
		]
		const result = new FibGridEngine().build({ events: [event()], structure })
		assert.equal(result.candidates[0]?.start.index, 12)
	})

	it('отсутствие валидного свинга даёт missing-opposite-swing', () => {
		const result = new FibGridEngine().build({
			events: [event()],
			structure: [pt(20, 110, 'high', 'HH')],
		})
		assert.equal(result.candidates.length, 0)
		assert.equal(result.skips[0]?.reason, 'missing-opposite-swing')
	})
})
