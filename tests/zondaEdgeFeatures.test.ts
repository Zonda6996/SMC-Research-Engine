import assert from 'node:assert/strict'
import { it } from 'node:test'
import { buildZondaEdgeFeatureSnapshot } from '../src/core/analysis/ZondaEdgeFeatures.js'
import type { Candle } from '../src/models/price/Candle.js'
import type { FibGridCandidate } from '../src/models/fib/FibGrid.js'

const candles: Candle[] = Array.from({ length: 140 }, (_, i) => ({
	timestamp: i * 60_000,
	open: 100 + i * 0.1,
	high: 101 + i * 0.1,
	low: 99 + i * 0.1,
	close: 100.5 + i * 0.1,
	volume: 100 + i,
}))

const futureFib: FibGridCandidate = {
	id: 'future', eventId: 'future', trigger: 'bos', direction: 'long', createdAtIndex: 120,
	end: { index: 100, timestamp: candles[100]!.timestamp, price: 120, type: 'high', label: 'HH', knownAtIndex: 120 },
	variants: { local: { start: { index: 90, timestamp: candles[90]!.timestamp, price: 100, type: 'low', label: 'UNKNOWN', knownAtIndex: 120 }, levels: [{ ratio: 50, price: 110, kind: 'retracement' }], legSize: 20, legAtrRatio: 5 }, global: null },
	oppositeSweptBefore: false, explanation: 'future fixture',
}

it('Zonda Edge features: future structure and Fib objects are unavailable', () => {
	const snapshot = buildZondaEdgeFeatureSnapshot({
		candles,
		decisionIndex: 100,
		structureEvents: [{ type: 'choch', direction: 'up', levelPrice: 110, levelType: 'high', levelIndex: 80, levelLabel: 'HH', breachIndex: 110, breachTimestamp: candles[110]!.timestamp, confirmIndex: 111, confirmTimestamp: candles[111]!.timestamp, sweptBefore: false, sweptDepth: 0, oppositeSweptBefore: true }],
		fibCandidates: [futureFib],
	})
	assert.equal(snapshot.structure.lastType, null)
	assert.equal(snapshot.fib.nearestRatio, null)
})

it('Zonda Edge features: appending future candles cannot change an earlier snapshot', () => {
	const before = buildZondaEdgeFeatureSnapshot({ candles: candles.slice(0, 101), decisionIndex: 100 })
	const after = buildZondaEdgeFeatureSnapshot({ candles, decisionIndex: 100 })
	assert.deepEqual(after, before)
})
