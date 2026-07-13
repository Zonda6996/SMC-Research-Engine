import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { FibGridEngine } from '../src/core/fib/FibGridEngine.js'
import type { StructureEvent } from '../src/models/events/StructureEvent.js'
import type { Candle } from '../src/models/price/Candle.js'
import type { ATRPoint } from '../src/models/indicators/ATRPoint.js'

const MS = 60_000

/** Плоская свеча с заданным диапазоном high/low. */
function candle(index: number, low: number, high: number): Candle {
	return {
		timestamp: index * MS,
		open: (low + high) / 2,
		high,
		low,
		close: (low + high) / 2,
		volume: 1,
	}
}

/**
 * Базовый сценарий (long BOS): уровень high=110 формируется на #20,
 * откат вниз до low=101 на #25, импульс вверх пробивает уровень на #29.
 * Абсолютный лоу всей истории — 90 на #2 (для global-режима).
 */
function makeCandles(): Candle[] {
	const candles: Candle[] = []
	for (let i = 0; i <= 30; i++) {
		let low = 100
		let high = 105
		if (i === 2) { low = 90; high = 95 }
		if (i === 20) { low = 105; high = 110 }
		if (i > 20 && i < 25) { low = 103; high = 107 }
		if (i === 25) { low = 101; high = 104 }
		if (i > 25 && i < 29) { low = 104; high = 109 }
		if (i === 29) { low = 108; high = 112 }
		if (i === 30) { low = 110; high = 113 }
		candles.push(candle(i, low, high))
	}
	return candles
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
		oppositeSweptBefore: false,
		...overrides,
	}
}

const NO_ATR: ATRPoint[] = []

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

describe('FibGridEngine — экстремальные якоря', () => {
	it('local: 0% = минимальный low между формированием уровня и пробоем', () => {
		const result = new FibGridEngine().build({ events: [event()], candles: makeCandles(), atr: NO_ATR })
		assert.equal(result.candidates.length, 1)
		const local = result.candidates[0]?.variants.local
		assert.equal(local?.start.index, 25)
		assert.equal(local?.start.price, 101)
		assert.equal(result.candidates[0]?.end.price, 110)
		assert.equal(result.candidates[0]?.createdAtIndex, 30)
	})

	it('global: 0% = абсолютный экстремум от последнего противоположного события', () => {
		const result = new FibGridEngine().build({ events: [event()], candles: makeCandles(), atr: NO_ATR })
		const global = result.candidates[0]?.variants.global
		// Противоположных событий нет — окно от начала данных, лоу 90 на #2.
		assert.equal(global?.start.index, 2)
		assert.equal(global?.start.price, 90)
	})

	it('global-окно начинается после противоположного события', () => {
		const opposite = event({
			type: 'choch',
			direction: 'down',
			levelPrice: 95,
			levelType: 'low',
			levelIndex: 2,
			breachIndex: 10,
			breachTimestamp: 10 * MS,
			confirmIndex: 11,
			confirmTimestamp: 11 * MS,
		})
		const result = new FibGridEngine().build({
			events: [opposite, event()],
			candles: makeCandles(),
			atr: NO_ATR,
		})
		const bos = result.candidates.find((c) => c.trigger === 'bos')
		// Окно от breachIndex=10 противоположного события: лоу 90 на #2 недоступен,
		// минимум окна — 100 на #10.
		assert.equal(bos?.variants.global?.start.index, 10)
		assert.equal(bos?.variants.global?.start.price, 100)
	})

	it('short: 0% = максимальный high в окне', () => {
		const candles = makeCandles().map((c, i) => (i === 25 ? candle(25, 101, 118) : c))
		const result = new FibGridEngine().build({
			events: [event({ type: 'choch', direction: 'down', levelType: 'low', levelPrice: 100, levelLabel: 'HL' })],
			candles,
			atr: NO_ATR,
		})
		const local = result.candidates[0]?.variants.local
		assert.equal(result.candidates[0]?.direction, 'short')
		assert.equal(local?.start.index, 25)
		assert.equal(local?.start.price, 118)
	})

	it('legAtrRatio = размер ноги в единицах ATR на момент пробоя', () => {
		const atr: ATRPoint[] = [{ index: 28, timestamp: 28 * MS, value: 3 }]
		const result = new FibGridEngine().build({ events: [event()], candles: makeCandles(), atr })
		const local = result.candidates[0]?.variants.local
		assert.equal(local?.legSize, 9) // 110 - 101
		assert.equal(local?.legAtrRatio, 3) // 9 / 3
	})

	it('без ATR legAtrRatio = null, кандидат не отбрасывается', () => {
		const result = new FibGridEngine().build({ events: [event()], candles: makeCandles(), atr: NO_ATR })
		assert.equal(result.candidates[0]?.variants.local?.legAtrRatio, null)
	})

	it('unlabeled не строит сетку и оставляет диагностический skip', () => {
		const result = new FibGridEngine().build({
			events: [event({ type: 'unlabeled' })],
			candles: makeCandles(),
			atr: NO_ATR,
		})
		assert.equal(result.candidates.length, 0)
		assert.equal(result.skips[0]?.reason, 'unlabeled-event')
	})

	it('экстремум по неправильную сторону уровня даёт невалидный вариант', () => {
		// Все свечи выше уровня 100 → для long-события с level=100 нет lows ниже.
		const candles: Candle[] = []
		for (let i = 0; i <= 30; i++) candles.push(candle(i, 101, 105))
		const result = new FibGridEngine().build({
			events: [event({ levelPrice: 100 })],
			candles,
			atr: NO_ATR,
		})
		assert.equal(result.candidates.length, 0)
		assert.equal(result.skips[0]?.reason, 'no-valid-variant')
	})
})
