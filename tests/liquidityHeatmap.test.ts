import assert from 'node:assert/strict'
import { it } from 'node:test'
import { detectLiquidityHeatmap, LIQUIDITY_HEATMAP_VERSION } from '../src/core/liquidity/LiquidityHeatmapEngine.js'
import type { Candle } from '../src/models/price/Candle.js'

const H = 14_400_000
function series(highs: number[]): Candle[] {
	return highs.map((h, i) => ({ timestamp: i * H, open: h - 0.5, high: h, low: h - 1, close: h - 0.4, volume: 100 }))
}

it('confirms pivot pools causally and tracks both sides', () => {
	const highs = Array(30).fill(100)
	highs[10] = 105
	const c = series(highs)
	c[12] = { ...c[12]!, high: 96, low: 95, open: 95.5, close: 95.6 }
	const pools = detectLiquidityHeatmap(c)
	const sell = pools.find(p => p.side === 'sell-side')!
	const buy = pools.find(p => p.side === 'buy-side')!
	assert.equal(sell.version, LIQUIDITY_HEATMAP_VERSION)
	assert.equal(sell.extremePrice, 105)
	assert.equal(sell.startIndex, 10)
	assert.equal(sell.confirmedIndex, 15)
	assert.equal(sell.status, 'active')
	assert.equal(buy.extremePrice, 95)
	assert.equal(buy.status, 'active')
})

it('does not reveal a pool before its pivot confirmation bar', () => {
	const highs = Array(30).fill(100)
	highs[10] = 105
	const c = series(highs)
	assert.equal(detectLiquidityHeatmap(c.slice(0, 15)).length, 0)
	assert.ok(detectLiquidityHeatmap(c.slice(0, 16)).some(p => p.side === 'sell-side' && p.extremePrice === 105))
})

it('merges equal highs into one stronger pool instead of sweeping them', () => {
	const highs = Array(40).fill(100)
	highs[10] = 105
	highs[20] = 105.05
	highs[32] = 103
	const pools = detectLiquidityHeatmap(series(highs)).filter(p => p.side === 'sell-side')
	assert.equal(pools.length, 2)
	const merged = pools.find(p => p.pivotCount === 2)!
	const single = pools.find(p => p.pivotCount === 1)!
	assert.equal(merged.status, 'active')
	assert.equal(merged.extremePrice, 105.05)
	assert.ok(merged.touchCount >= 1)
	assert.ok(merged.weight > single.weight)
})

it('sweeps a pool beyond tolerance and re-accumulates as a new pool', () => {
	const highs = Array(30).fill(100)
	highs[10] = 105
	highs[20] = 106
	const pools = detectLiquidityHeatmap(series(highs)).filter(p => p.side === 'sell-side')
		.sort((a, b) => a.startIndex - b.startIndex)
	assert.equal(pools.length, 2)
	assert.equal(pools[0]!.status, 'swept')
	assert.equal(pools[0]!.sweptIndex, 20)
	assert.equal(pools[0]!.endAt, 20 * H)
	assert.equal(pools[1]!.status, 'active')
	assert.equal(pools[1]!.startIndex, 20)
	assert.equal(pools[1]!.extremePrice, 106)
})
