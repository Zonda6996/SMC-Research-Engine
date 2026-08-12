import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { Candle } from '../src/models/price/Candle.js'
import { computeApexBands } from '../src/core/signals/ApexEngine.js'

const bar = (timestamp: number, price: number): Candle => ({
	timestamp,
	open: price,
	high: price + 2,
	low: price - 2,
	close: price,
	volume: 1,
})

it('Apex: widthScale=0 строго схлопывает все края в среднюю', () => {
	const candles = Array.from({ length: 50 }, (_, i) => bar(i, 100 + Math.sin(i / 3)))
	const band = computeApexBands(candles, { lookback: 10, devLookback: 10, widthScale: 0 }).at(-1)!
	assert.ok(Number.isFinite(band.mean))
	assert.equal(band.s, 0)
	assert.equal(band.redLo, band.mean)
	assert.equal(band.redHi, band.mean)
	assert.equal(band.greenHi, band.mean)
	assert.equal(band.greenLo, band.mean)
})
