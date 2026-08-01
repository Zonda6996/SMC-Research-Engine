import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { Candle } from '../src/models/price/Candle.js'
import { detectReversalResearch, REVERSAL_RESEARCH_VERSION } from '../src/core/signals/ReversalResearch.js'

const bar = (timestamp: number, open: number, high: number, low: number, close: number): Candle => ({ timestamp, open, high, low, close, volume: 1 })
const warm = () => Array.from({ length: 30 }, (_, i) => bar(i, 100, 101, 99, 100))
const apex = { lookback: 10, devLookback: 10, kInner: 0.1, kOuter: 0.2 }

it('Reversal research: version and modes are explicit', () => {
	assert.equal(REVERSAL_RESEARCH_VERSION, 'reversal-research-0.1-observation-first')
	for (const mode of ['safe', 'risk', 'standard'] as const) {
		assert.doesNotThrow(() => detectReversalResearch(warm(), { mode, apexParams: apex }))
	}
})

it('Reversal research H0 remains causal and directional', () => {
	const c = warm()
	c.push(bar(30, 100, 99, 90, 91))
	assert.equal(detectReversalResearch(c, { hypothesis: 'H0', apexParams: apex }).filter((x) => x.index >= 30).length, 0)
	c.push(bar(31, 91, 94, 90, 93))
	const signals = detectReversalResearch(c, { hypothesis: 'H0', apexParams: apex }).filter((x) => x.index >= 30)
	assert.equal(signals.length, 1)
	assert.equal(signals[0]!.direction, 'long')
	assert.equal(signals[0]!.at, 31)
})

it('Reversal research: future candles cannot change past signals', () => {
	const c = warm()
	c.push(bar(30, 100, 100, 90, 91), bar(31, 91, 94, 90, 93))
	const before = detectReversalResearch(c, { hypothesis: 'H5', minRecoveryS: 0.1, apexParams: apex })
	const extended = [...c, bar(32, 93, 120, 92, 118), bar(33, 118, 119, 110, 111)]
	const after = detectReversalResearch(extended, { hypothesis: 'H5', minRecoveryS: 0.1, apexParams: apex }).filter((x) => x.index < c.length)
	assert.deepEqual(after, before)
})

it('Reversal research: Safe/Risk/Standard do not invent timing differences without evidence', () => {
	const c = warm()
	c.push(bar(30, 100, 100, 90, 91), bar(31, 91, 94, 90, 93))
	const times = (mode: 'safe' | 'risk' | 'standard') => detectReversalResearch(c, { mode, hypothesis: 'H0', apexParams: apex }).map((x) => [x.at, x.direction])
	assert.deepEqual(times('safe'), times('risk'))
	assert.deepEqual(times('safe'), times('standard'))
})

it('Reversal research H4 requires a reclaim close', () => {
	const c = warm()
	c.push(bar(30, 100, 99, 90, 91))
	c.push(bar(31, 91, 92, 89, 90))
	assert.equal(detectReversalResearch(c, { hypothesis: 'H4', apexParams: apex }).filter((x) => x.index >= 30).length, 0)
	c.push(bar(32, 90, 99, 89, 98))
	assert.equal(detectReversalResearch(c, { hypothesis: 'H4', apexParams: apex }).filter((x) => x.index >= 30).length, 1)
})

it('Reversal research pending state expires by maxPendingBars', () => {
	const c = warm()
	const wideApex = { ...apex, kInner: 0.5, kOuter: 1 }
	c.push(bar(30, 100, 99, 50, 60))
	c.push(bar(31, 90, 91, 89, 89.5), bar(32, 89.5, 91, 89, 90), bar(33, 90, 93, 89, 92))
	const signals = detectReversalResearch(c, { hypothesis: 'H0', maxPendingBars: 1, apexParams: wideApex }).filter((x) => x.index >= 30)
	assert.equal(signals.length, 0)
})
