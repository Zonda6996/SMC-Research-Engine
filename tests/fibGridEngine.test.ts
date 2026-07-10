import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FibGridEngine } from '../src/core/fib/FibGridEngine.js'
import type { StructureEvent } from '../src/models/events/StructureEvent.js'
import type { Leg } from '../src/models/legs/Leg.js'
import type { LegContext } from '../src/models/legs/LegContext.js'
import type { StructurePoint } from '../src/models/structure/StructurePoint.js'

const MS = 60_000

function pt(index: number, price: number, type: 'high' | 'low', label: StructurePoint['label'] = 'UNKNOWN'): StructurePoint {
	return { index, timestamp: index * MS, price, type, label }
}

function leg(start: StructurePoint, end: StructurePoint): Leg {
	return {
		start,
		end,
		direction: start.type === 'low' ? 'bullish' : 'bearish',
		range: Math.abs(end.price - start.price),
		candles: end.index - start.index,
		duration: end.timestamp - start.timestamp,
	}
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

function context(item: Leg, enclosingLegs: Leg[]): LegContext {
	return { leg: item, index: 0, isLast: true, enclosingLegs, insideLegs: [] }
}

describe('FibGridEngine — levels and event impulse', () => {
	it('вычисляет одинаковые ratios для long и short с правильным знаком', () => {
		const long = FibGridEngine.levels(100, 200)
		const short = FibGridEngine.levels(200, 100)
		assert.equal(long.find((level) => level.ratio === 61.8)?.price, 161.8)
		assert.equal(short.find((level) => level.ratio === 61.8)?.price, 138.2)
		assert.equal(long.find((level) => level.ratio === 161)?.price, 261)
		assert.equal(short.find((level) => level.ratio === 161)?.price, 39)
	})

	it('event impulse берёт последний противоположный swing → event-level', () => {
		const structure = [
			pt(2, 90, 'low', 'LL'),
			pt(8, 104, 'high', 'HH'),
			pt(12, 96, 'low', 'HL'),
			pt(20, 110, 'high', 'HH'),
		]
		const result = new FibGridEngine().build({ events: [event()], structure, structuralLegs: [], legContexts: [] })
		const candidate = result.candidates.find((item) => item.mode === 'event-impulse')
		assert.equal(candidate?.start.index, 12)
		assert.equal(candidate?.end.index, 20)
		assert.equal(candidate?.createdAtIndex, 30)
	})

	it('unlabeled не строит сетки и оставляет диагностические skips', () => {
		const result = new FibGridEngine().build({
			events: [event({ type: 'unlabeled' })],
			structure: [], structuralLegs: [], legContexts: [],
		})
		assert.equal(result.candidates.length, 0)
		assert.equal(result.skips.length, 3)
		assert.ok(result.skips.every((skip) => skip.reason === 'unlabeled-event'))
	})
})

describe('FibGridEngine — enclosing candidates and look-ahead', () => {
	it('nearest и outermost выбирают разные ноги из контекста', () => {
		const outer = leg(pt(0, 70, 'low', 'LL'), pt(18, 120, 'high', 'HH'))
		const near = leg(pt(5, 80, 'low', 'LL'), pt(19, 115, 'high', 'HH'))
		const base = leg(pt(10, 90, 'low', 'LL'), pt(20, 110, 'high', 'HH'))
		const structure = [outer.start, near.start, base.start, outer.end, near.end, base.end]
		const result = new FibGridEngine().build({
			events: [event()], structure, structuralLegs: [outer, near, base],
			legContexts: [context(outer, []), context(near, [outer]), context(base, [near, outer])],
		})
		const nearest = result.candidates.find((item) => item.mode === 'nearest-enclosing-leg')
		const outermost = result.candidates.find((item) => item.mode === 'outermost-enclosing-leg')
		assert.equal(nearest?.start.index, 5)
		assert.equal(outermost?.start.index, 0)
	})

	it('якорь, подтверждённый после события, отклоняется без look-ahead', () => {
		const structure = [pt(10, 90, 'low', 'LL'), pt(29, 110, 'high', 'HH')]
		const result = new FibGridEngine({ pivotWindow: 2 }).build({
			events: [event({ levelIndex: 29, confirmIndex: 30 })],
			structure, structuralLegs: [], legContexts: [],
		})
		assert.equal(result.candidates.length, 0)
		assert.ok(result.skips.some((skip) => skip.reason === 'anchor-known-after-event'))
	})

	it('нулевой и неверно направленный диапазоны отклоняются диагностикой', () => {
		const zero = new FibGridEngine().build({
			events: [event({ levelPrice: 100, levelIndex: 20 })],
			structure: [pt(10, 100, 'low', 'LL'), pt(20, 100, 'high', 'HH')],
			structuralLegs: [], legContexts: [],
		})
		assert.ok(zero.skips.some((skip) => skip.reason === 'zero-range'))

		const wrong = new FibGridEngine().build({
			events: [event({ levelPrice: 90, levelIndex: 20 })],
			structure: [pt(10, 100, 'low', 'LL'), pt(20, 90, 'high', 'HH')],
			structuralLegs: [], legContexts: [],
		})
		assert.ok(wrong.skips.some((skip) => skip.reason === 'invalid-direction'))
	})
})
