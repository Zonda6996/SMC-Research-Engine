import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { Candle } from '../src/models/price/Candle.js'
import type { ApexBand } from '../src/core/signals/ApexEngine.js'
import { detectArrowSignalCandidates, detectArrowSignalsFromBands } from '../src/core/signals/ArrowSignalEngine.js'

const HOUR = 3_600_000
function makeSeries(length: number): Candle[] {
	return Array.from({ length }, (_, index) => {
		const base = 100 + Math.sin(index / 13) * 0.3
		return { timestamp: index * HOUR, open: base, high: base + 0.5, low: base - 0.5, close: base, volume: 1_000 }
	})
}

it('uses only loaded bars and does not rewrite earlier raw signals when future bars are appended', () => {
	const candles = makeSeries(280)
	candles[240] = { ...candles[240]!, open: 80, high: 82, low: 76, close: 78, volume: 5_000 }
	const short = detectArrowSignalCandidates(candles.slice(0, 260), {}, { minimumDistanceMeanPct: 1, minimumRelativeVolume: 1.2 })
	const full = detectArrowSignalCandidates(candles, {}, { minimumDistanceMeanPct: 1, minimumRelativeVolume: 1.2 })
	assert.deepEqual(full.candidates.filter((x) => x.signalIndex < 260), short.candidates)
	assert.equal(full.warmupBars, 200)
	assert.equal(full.bands.length, candles.length)
})

it('emits causal trigger metadata on timestamps from the source candle array', () => {
	const candles = makeSeries(240)
	candles[220] = { ...candles[220]!, open: 118, high: 124, low: 117, close: 122, volume: 4_000 }
	const result = detectArrowSignalCandidates(candles, {}, { minimumDistanceMeanPct: 1, minimumRelativeVolume: 1.2, minimumPenetrationInner: -1 })
	const times = new Set(candles.map((x) => x.timestamp))
	for (const candidate of result.candidates) {
		assert.ok(times.has(candidate.signalAt))
		assert.equal(candidate.trigger.family, 'own2-extension')
		assert.ok(Number.isFinite(candidate.trigger.relativeVolume))
	}
})

it('allows BUY only on bullish candles, SELL only on bearish candles, and no signal on doji', () => {
	const baseBand: ApexBand = { mean: 100, s: 0.01, redLo: 102, redHi: 104, greenHi: 98, greenLo: 96 }
	const cases = [
		{ open: 96, close: 97, expected: ['long'] },
		{ open: 97, close: 96, expected: [] },
		{ open: 103, close: 104, expected: [] },
		{ open: 104, close: 103, expected: ['short'] },
		{ open: 97, close: 97, expected: [] },
	] as const
	for (const item of cases) {
		const candles = Array.from({ length: 202 }, (_, index): Candle => ({
			timestamp: index * HOUR,
			open: index === 201 ? item.open : 100,
			high: index === 201 ? 105 : 100.5,
			low: index === 201 ? 95 : 99.5,
			close: index === 201 ? item.close : 100,
			volume: index === 201 ? 2_000 : 1_000,
		}))
		const result = detectArrowSignalsFromBands(candles, candles.map(() => baseBand), {
			warmupBars: 200,
			relativeVolumePeriod: 1,
			minimumRelativeVolume: 1,
			minimumDistanceMeanPct: 1,
			minimumPenetrationInner: -1,
		})
		assert.deepEqual(result.candidates.filter((x) => x.signalIndex === 201).map((x) => x.side), item.expected)
		const diagnostics = result.diagnostics.filter((x) => x.index === 201)
		assert.equal(diagnostics.length, 2)
		assert.equal(diagnostics.filter((x) => x.accepted).length, item.expected.length)
		assert.equal(result.diagnosticReport.accepted + result.diagnosticReport.rejected, result.diagnosticReport.evaluatedSides)
	}
})
