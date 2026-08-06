import assert from 'node:assert/strict'
import test from 'node:test'
import type { LiquidityPoiCandidate } from '../src/core/confirmation/LiquidityPoiCalibration.js'
import type { StructureEvent } from '../src/models/events/StructureEvent.js'
import type { Candle } from '../src/models/price/Candle.js'
import type { ApexBand } from '../src/core/signals/ApexEngine.js'
import {
	detectIndependentReversalSignals,
	type IndependentReversalConfig,
} from '../src/core/signals/IndependentReversalResearch.js'

const candle = (
	timestamp: number,
	open: number,
	high: number,
	low: number,
	close: number,
	volume = 100,
): Candle => ({ timestamp, open, high, low, close, volume })

const band = (): ApexBand => ({
	mean: 100,
	s: 0.01,
	redLo: 110,
	redHi: 115,
	greenHi: 90,
	greenLo: 85,
})

const config: IndependentReversalConfig = {
	atrPeriod: 1,
	relativeVolumePeriod: 1,
	penetrationInnerWidth: 0.10,
	recoveryInnerWidth: 0.30,
	favorableBodyAtr: 0.10,
	maxEpisodeBars: 4,
	liquidityDistanceAtr: 2,
	peakRelativeVolume: 1.50,
	confirmationVolumeMax: 1.00,
	confirmationVolumePeakRatio: 0.70,
}

const detect = (
	candles: Candle[],
	extra: { structureEvents?: StructureEvent[]; liquidityZones?: LiquidityPoiCandidate[] } = {},
) => detectIndependentReversalSignals({ candles, apexBands: candles.map(band), ...extra }, config)

function longFixture(): Candle[] {
	return [
		candle(0, 100, 101, 99, 100, 100),
		candle(1, 91, 92, 88, 89, 200),
		candle(2, 89, 93, 88.5, 92, 50),
		candle(3, 92, 94, 91, 93, 50),
	]
}

test('Independent Reversal: one CORE/P/V emission per episode with stable episode geometry', () => {
	const signals = detect(longFixture())
	assert.deepEqual(signals.map((signal) => [signal.index, signal.direction, signal.family]), [
		[2, 'long', 'C'],
		[2, 'long', 'CORE'],
		[2, 'long', 'P'],
		[2, 'long', 'V'],
	])
	for (const signal of signals) {
		assert.equal(signal.episodeStartIndex, 1)
		assert.equal(signal.extremeIndex, 1)
		assert.equal(signal.extremePrice, 88)
		assert.equal(signal.episodeBars, 1)
	}
})

test('Independent Reversal: appending future bars cannot repaint prior emissions', () => {
	const prefix = longFixture()
	const before = detect(prefix)
	const after = detect([
		...prefix,
		candle(4, 93, 112, 92, 111),
		candle(5, 111, 113, 108, 109),
	]).filter((signal) => signal.index < prefix.length)
	assert.deepEqual(after, before)
})

test('Independent Reversal: expired episode does not emit from a late recovery', () => {
	const candles = [
		candle(0, 100, 101, 99, 100),
		candle(1, 91, 92, 88, 89),
		candle(2, 89, 90, 88, 89),
		candle(3, 89, 90, 88, 89),
		candle(4, 89, 90, 88, 89),
		candle(5, 89, 90, 88, 89),
		candle(6, 89, 94, 88, 93),
	]
	assert.equal(detect(candles).length, 0)
})

test('Independent Reversal: future-known liquidity is rejected while prior-known liquidity emits L and C', () => {
	const candles = longFixture().map((row) => ({ ...row, volume: 100 }))
	const zone = (knownAt: number): LiquidityPoiCandidate => ({
		id: `z-${knownAt}`,
		direction: 'long',
		valid: true,
		knownAt,
		geometryKnownAt: knownAt,
		near: 88,
		far: 89,
	} as LiquidityPoiCandidate)
	const futureKnown = detect(candles, { liquidityZones: [zone(2)] })
	assert.equal(futureKnown.some((signal) => signal.family === 'L'), false)
	assert.equal(futureKnown.some((signal) => signal.family === 'C'), false)

	const priorKnown = detect(candles, { liquidityZones: [zone(0)] })
	assert.equal(priorKnown.some((signal) => signal.family === 'L'), true)
	assert.equal(priorKnown.some((signal) => signal.family === 'C'), true)
})

test('Independent Reversal: a causal favorable CHoCH after recovery emits S and C', () => {
	const candles = longFixture()
	const event: StructureEvent = {
		type: 'choch',
		direction: 'up',
		levelPrice: 91,
		levelType: 'high',
		levelIndex: 1,
		levelLabel: 'LH',
		breachIndex: 2,
		breachTimestamp: 2,
		confirmIndex: 2,
		confirmTimestamp: 2,
		sweptBefore: false,
		sweptDepth: 0,
		oppositeSweptBefore: true,
	}
	const signals = detect(candles, { structureEvents: [event] })
	assert.equal(signals.some((signal) => signal.index === 2 && signal.family === 'S'), true)
	assert.equal(signals.some((signal) => signal.index === 2 && signal.family === 'C'), true)
})

test('Independent Reversal: a CHoCH before a later adverse extreme cannot qualify S', () => {
	const candles = [
		candle(0, 100, 101, 99, 100),
		candle(1, 91, 92, 88, 89),
		candle(2, 89, 93, 88.5, 92),
		candle(3, 92, 93, 87, 88),
		candle(4, 88, 94, 88, 93),
	]
	const event = {
		type: 'choch', direction: 'up', levelPrice: 91, levelType: 'high', levelIndex: 1,
		levelLabel: 'LH', breachIndex: 2, breachTimestamp: 2, confirmIndex: 2,
		confirmTimestamp: 2, sweptBefore: false, sweptDepth: 0, oppositeSweptBefore: true,
	} as StructureEvent
	const signals = detect(candles, { structureEvents: [event] })
	assert.equal(signals.some((candidate) => candidate.index >= 3 && candidate.family === 'S'), false)
})

test('Independent Reversal: structure with a future confirmation timestamp is not consumed', () => {
	const candles = longFixture()
	const event = {
		type: 'choch', direction: 'up', levelPrice: 92, levelType: 'high', levelIndex: 1,
		levelLabel: 'LH', breachIndex: 3, breachTimestamp: 3, confirmIndex: 3,
		confirmTimestamp: 99, sweptBefore: false, sweptDepth: 0, oppositeSweptBefore: true,
	} as StructureEvent
	const signals = detect(candles, { structureEvents: [event] })
	assert.equal(signals.some((signal) => signal.family === 'S'), false)
})
