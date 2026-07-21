import assert from 'node:assert/strict'
import { it } from 'node:test'
import { detectLiquidityHeatmap, LIQUIDITY_HEATMAP_CONFIG, type LiquidityHeatmapConfig } from '../src/core/liquidity/LiquidityHeatmapEngine.js'
import type { Candle } from '../src/models/price/Candle.js'

const H = 14_400_000
function series(highs: number[], volume = 100): Candle[] {
	return highs.map((h, i) => ({ timestamp: i * H, open: h - 0.5, high: h, low: h - 1, close: h - 0.4, volume }))
}
const cfg: LiquidityHeatmapConfig = {
	...LIQUIDITY_HEATMAP_CONFIG,
	leverageTiers: [{ leverage: 10, share: 1 }],
	binPct: 0.005,
	minRelVolume: 0,
	minLifetimeBars: 0,
	minWeight: 0,
	gamma: 1,
}

it('places liquidation density on both sides of entries, causally', () => {
	const c = series(Array(40).fill(100))
	const pools = detectLiquidityHeatmap(c, cfg)
	const above = pools.find(p => p.side === 'sell-side')!
	const below = pools.find(p => p.side === 'buy-side')!
	const entry = (100 + 99 + 99.6) / 3
	assert.ok(above.bandLow <= entry * 1.1 && entry * 1.1 <= above.bandHigh)
	assert.ok(below.bandLow <= entry * 0.9 && entry * 0.9 <= below.bandHigh)
	assert.equal(above.status, 'active')
	assert.equal(above.startIndex, 0)
	const prefix = detectLiquidityHeatmap(c.slice(0, 25), cfg)
	assert.ok(prefix.some(p => p.side === 'sell-side' && p.startIndex === 0))
})

it('volume drives brightness (coinglass-style density)', () => {
	const highs = [...Array(20).fill(100), ...Array(20).fill(104)]
	const c = series(highs)
	c[25] = { ...c[25]!, volume: 5000 }
	const pools = detectLiquidityHeatmap(c, cfg)
		.filter(p => p.side === 'sell-side')
		.sort((a, b) => a.extremePrice - b.extremePrice)
	assert.equal(pools.length, 2)
	assert.ok(pools[1]!.weight > pools[0]!.weight)
	assert.equal(pools[1]!.weight, 1)
})

it('price sweeping a bin consumes it and re-accumulates later', () => {
	const highs = [...Array(10).fill(100), ...Array(10).fill(112), ...Array(20).fill(100)]
	const c = series(highs)
	const entry = (100 + 99 + 99.6) / 3
	const target = entry * 1.1
	const hits = detectLiquidityHeatmap(c, cfg)
		.filter(p => p.side === 'sell-side' && p.bandLow <= target && target <= p.bandHigh)
		.sort((a, b) => a.startIndex - b.startIndex)
	assert.equal(hits.length, 2)
	assert.equal(hits[0]!.status, 'swept')
	assert.equal(hits[0]!.sweptIndex, 10)
	assert.equal(hits[0]!.endAt, 10 * H)
	assert.equal(hits[1]!.status, 'active')
	assert.equal(hits[1]!.startIndex, 20)
})

it('insignificant volume is ignored', () => {
	const c = series(Array(40).fill(100))
	c[30] = { timestamp: 30 * H, open: 119.5, high: 120, low: 119, close: 119.6, volume: 5 }
	const pools = detectLiquidityHeatmap(c, { ...cfg, minRelVolume: 0.5 })
	assert.ok(pools.every(p => p.extremePrice < 125))
})

it('short-lived swept segments are filtered as noise near price', () => {
	const highs = [...Array(8).fill(100), 112, ...Array(31).fill(100)]
	const c = series(highs)
	const entry = (100 + 99 + 99.6) / 3
	const target = entry * 1.1
	const hits = detectLiquidityHeatmap(c, { ...cfg, minLifetimeBars: 12 })
		.filter(p => p.side === 'sell-side' && p.bandLow <= target && target <= p.bandHigh)
	assert.equal(hits.length, 1)
	assert.equal(hits[0]!.status, 'active')
	assert.equal(hits[0]!.startIndex, 9)
})

it('adjacent bins alive together merge into one cluster band', () => {
	const highs = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 100 : 100.6))
	const pools = detectLiquidityHeatmap(series(highs), cfg)
	const above = pools.filter(p => p.side === 'sell-side')
	const below = pools.filter(p => p.side === 'buy-side')
	assert.equal(above.length, 1)
	assert.equal(below.length, 1)
	assert.ok(above[0]!.spanBins >= 2)
	assert.ok(above[0]!.bandHigh > above[0]!.bandLow * 1.008)
})

it('small fresh clusters stay visible next to giant accumulations', () => {
	const highs = [...Array(80).fill(100), ...Array(5).fill(90), ...Array(35).fill(100)]
	const c = series(highs)
	const pools = detectLiquidityHeatmap(c, { ...cfg, gamma: 0.5, minWeight: 0.18 })
	const entry = (90 + 89 + 89.6) / 3
	const target = entry * 0.9
	assert.ok(pools.some(p => p.side === 'buy-side' && p.status === 'active' && p.bandLow <= target && target <= p.bandHigh))
})
