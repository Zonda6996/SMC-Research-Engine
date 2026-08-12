import assert from 'node:assert/strict'
import test from 'node:test'
import { buildIndependentReversalDataManifest } from '../tools/shared/reversalDataManifest.js'
import type { Candle } from '../src/models/price/Candle.js'

const candle = (timestamp: number, close = 100): Candle => ({
	timestamp, open: close, high: close + 1, low: close - 1, close, volume: 1,
})

test('data manifest counts duplicates, missing bars and hashes deterministically', () => {
	const candles = [candle(0), candle(60_000), candle(60_000, 101), candle(180_000)]
	const funding = [
		{ timestamp: 30_000, rate: 0.001, markPrice: 100 },
		{ timestamp: 30_000, rate: 0.002, markPrice: 101 },
	]
	const first = buildIndependentReversalDataManifest('BTC/USDT', '1m', 60_000, 0, 240_000, candles, funding)
	const second = buildIndependentReversalDataManifest('BTC/USDT', '1m', 60_000, 0, 240_000, [...candles].reverse(), [...funding].reverse())
	assert.equal(first.candleRows, 4)
	assert.equal(first.uniqueCandles, 3)
	assert.equal(first.duplicateCandles, 1)
	assert.equal(first.missingBars, 1)
	assert.equal(first.irregularIntervals, 0)
	assert.equal(first.fundingRows, 2)
	assert.equal(first.uniqueFunding, 1)
	assert.equal(first.duplicateFunding, 1)
	assert.equal(first.combinedSha256, second.combinedSha256)
})

test('data manifest exposes irregular intervals separately from missing whole bars', () => {
	const manifest = buildIndependentReversalDataManifest('BTC/USDT', '1m', 60_000, 0, 240_000, [candle(0), candle(90_000)], [])
	assert.equal(manifest.irregularIntervals, 1)
	assert.equal(manifest.missingBars, 0)
})

test('data manifest rejects malformed candle geometry', () => {
	const malformed = { ...candle(0), high: 99 }
	assert.throws(() => buildIndependentReversalDataManifest('BTC/USDT', '1m', 60_000, 0, 60_000, [malformed], []), /geometry/)
})
