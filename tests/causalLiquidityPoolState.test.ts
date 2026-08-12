import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { Candle } from '../src/models/price/Candle.js'
import type { LiquidityPool } from '../ci/research/lib/liquidityHeatmapEngine.js'
import { completedPrefixLength, selectCausalLiquidityPool } from '../src/core/analysis/CausalLiquidityPoolState.js'

const config = { minimumAgeMs: 48 * 3_600_000, sweepRecencyMs: 24 * 3_600_000, maximumNotionalRank: 2 / 3, requireStrictBandEntry: true }
function pool(id: string, notional: number, partial: Partial<LiquidityPool> = {}): LiquidityPool {
	return {
		id,
		version: 'fixture',
		side: 'buy-side',
		extremePrice: 100,
		bandLow: 99,
		bandHigh: 101,
		spanBins: 1,
		startIndex: 0,
		startAt: 0,
		lastContributionIndex: 1,
		lastContributionAt: 1,
		sweptIndex: 60,
		sweptAt: 60 * 3_600_000,
		contributions: 1,
		volumeAccumulated: 1,
		notional,
		remainingNotional: notional,
		weight: 1,
		status: 'swept',
		endAt: 60 * 3_600_000,
		...partial,
	}
}

it('completedPrefixLength excludes an HTF candle that has not closed', () => {
	const candles: Candle[] = Array.from({ length: 4 }, (_, index) => ({ timestamp: index * 4 * 3_600_000, open: 1, high: 2, low: 0, close: 1, volume: 1 }))
	assert.equal(completedPrefixLength(candles, 10 * 3_600_000, 4 * 3_600_000), 2)
})

it('causal pool selector rejects the heaviest tercile and accepts a recent light sweep', () => {
	const decisionAt = 72 * 3_600_000
	const light = selectCausalLiquidityPool([pool('a', 10), pool('b', 20), pool('c', 30)], decisionAt, 100, 1, config)
	assert.ok(light)
	assert.equal(light.poolId, 'a')
	assert.equal(light.qualified, true)
	const heavyOnly = selectCausalLiquidityPool([pool('c', 30, { bandLow: 99, bandHigh: 101 }), pool('a', 10, { bandLow: 80, bandHigh: 81 }), pool('b', 20, { bandLow: 85, bandHigh: 86 })], decisionAt, 100, 1, config)
	assert.ok(heavyOnly)
	assert.equal(heavyOnly.qualified, false)
})

it('causal pool selection is deterministic under input reordering', () => {
	const decisionAt = 72 * 3_600_000
	const pools = [pool('b', 20), pool('a', 10), pool('c', 30)]
	assert.deepEqual(selectCausalLiquidityPool(pools, decisionAt, 100, 1, config), selectCausalLiquidityPool([...pools].reverse(), decisionAt, 100, 1, config))
})
