import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { Candle } from '../src/models/price/Candle.js'
import { buildReactionCandidates } from '../tools/visualizer/server.js'
import { runAnalysis } from '../src/core/analysis/runAnalysis.js'

it('Decision Lab falls back to HTF when LTF history starts after setup', () => {
	const candles: Candle[] = [
		{ timestamp: 0, open: 190, high: 200, low: 180, close: 195, volume: 1 },
		{ timestamp: 900_000, open: 200, high: 250, low: 190, close: 240, volume: 1 }, // реальный first touch 141=241
		{ timestamp: 1_800_000, open: 240, high: 300, low: 230, close: 280, volume: 1 },
	]
	const ltfTooLate: Candle[] = [
		{ timestamp: 1_800_000, open: 240, high: 300, low: 230, close: 280, volume: 1 },
	]
	const variant = {
		start: { index: 0, timestamp: 0, price: 100, type: 'low', label: 'UNKNOWN', knownAtIndex: 0 },
		levels: [{ ratio: 0, price: 100, kind: 'anchor' }, { ratio: 100, price: 200, kind: 'anchor' }],
		legSize: 100,
		legAtrRatio: 5,
	}
	const snapshot = {
		candles,
		fib: { candidates: [{
			id: 'grid-1', eventId: 'event-1', trigger: 'bos', direction: 'long',
			end: { index: 0, timestamp: 0, price: 200, type: 'high', label: 'HH', knownAtIndex: 0 },
			variants: { local: variant, global: null }, createdAtIndex: 0,
			oppositeSweptBefore: false, explanation: '',
		}] },
	} as unknown as ReturnType<typeof runAnalysis>

	const result = buildReactionCandidates(snapshot, ltfTooLate, 900_000)
	const level141 = result.find((x) => x.ratio === 141)
	assert.ok(level141)
	assert.equal(level141.touchAt, 900_000)
	assert.equal(level141.touchHtfIndex, 1)
	assert.equal(level141.touchLtfIndex, null)
	assert.equal(level141.resolution, 'htf')
})
