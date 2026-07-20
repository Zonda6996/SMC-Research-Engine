import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { Candle } from '../src/models/price/Candle.js'
import { evaluateReaction } from '../tools/review/runReactionAudit.js'

const candidate = {
	id: 'x', ratio: 141, levelPrice: 90, tradeDirection: 'long' as const, touchLtfIndex: 0,
	gridLevels: [{ ratio: 0, price: 120 }, { ratio: 100, price: 100 }, { ratio: 141, price: 90 }, { ratio: 176, price: 80 }],
}

it('reaction audit enters on first opposite candle close and resolves TP with costs', () => {
	const candles: Candle[] = [
		{ timestamp: 0, open: 95, high: 96, low: 89, close: 91, volume: 1 },
		{ timestamp: 300_000, open: 91, high: 94, low: 90, close: 93, volume: 1 },
		{ timestamp: 600_000, open: 93, high: 101, low: 92, close: 100, volume: 1 },
	]
	const r = evaluateReaction(candles, candidate, 3, 0.5, false)
	assert.equal(r.status, 'tp')
	assert.ok(r.netR != null && r.netR > 0)
	assert.ok(r.actualRR != null && r.actualRR >= 0.5)
})

it('reaction audit skips when no opposite candle appears inside wait window', () => {
	const candles: Candle[] = [
		{ timestamp: 0, open: 95, high: 96, low: 89, close: 91, volume: 1 },
		{ timestamp: 300_000, open: 91, high: 92, low: 88, close: 89, volume: 1 },
	]
	assert.equal(evaluateReaction(candles, candidate, 2, 0, false).status, 'no-confirm')
})

it('reaction audit rejects a candle body that burns the whole level-to-stop zone', () => {
	const candles: Candle[] = [
		{ timestamp: 0, open: 95, high: 96, low: 75, close: 78, volume: 1 },
	]
	assert.equal(evaluateReaction(candles, candidate, 1, 0, true).status, 'full-body-through')
})
