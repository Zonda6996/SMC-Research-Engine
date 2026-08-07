import type { Candle } from '../../models/price/Candle.js'
import type { LiquidityPool } from '../../../ci/research/lib/liquidityHeatmapEngine.js'

export interface CausalPoolStateConfig {
	minimumAgeMs: number
	sweepRecencyMs: number
	maximumNotionalRank: number
	requireStrictBandEntry: boolean
}

export interface CausalPoolMatch {
	poolId: string
	side: LiquidityPool['side']
	bandLow: number
	bandHigh: number
	notional: number
	rank: number
	alivePoolCount: number
	sweptAt: number
	sweepAgeMs: number
	strictlyInsideBand: boolean
	qualified: boolean
}

export function completedPrefixLength(candles: readonly Candle[], decisionAt: number, timeframeMs: number): number {
	let lo = 0
	let hi = candles.length
	while (lo < hi) {
		const mid = (lo + hi) >>> 1
		if (candles[mid]!.timestamp + timeframeMs <= decisionAt) lo = mid + 1
		else hi = mid
	}
	return lo
}

function contains(pool: LiquidityPool, price: number): boolean {
	return price >= pool.bandLow && price <= pool.bandHigh
}

/**
 * Selects the best knowledge-at-T liquidity pool. The caller must supply pools
 * computed from the completed HTF prefix only; final-history pools are invalid.
 */
export function selectCausalLiquidityPool(
	pools: readonly LiquidityPool[],
	decisionAt: number,
	entryPrice: number,
	signalSide: 1 | -1,
	config: CausalPoolStateConfig,
): CausalPoolMatch | null {
	const wantedSide: LiquidityPool['side'] = signalSide === 1 ? 'buy-side' : 'sell-side'
	const alive = pools
		.filter((pool) => pool.side === wantedSide)
		.filter((pool) => pool.startAt + config.minimumAgeMs <= decisionAt)
		.filter((pool) => pool.sweptAt == null || decisionAt - pool.sweptAt <= config.sweepRecencyMs)
		.sort((a, b) => a.bandLow - b.bandLow || a.bandHigh - b.bandHigh || a.startAt - b.startAt || a.id.localeCompare(b.id))
	const hits = alive.filter((pool) => contains(pool, entryPrice))
	if (!hits.length) return null

	const rank = (pool: LiquidityPool): number => {
		if (alive.length <= 1) return 0.5
		const below = alive.filter((candidate) => candidate.id !== pool.id && (
			candidate.notional < pool.notional || (candidate.notional === pool.notional && candidate.id.localeCompare(pool.id) < 0)
		)).length
		return below / (alive.length - 1)
	}
	// Geometry chooses the pool; notional rank is evaluated only after selection.
	// Choosing the lightest overlapping pool would bake the desired outcome into the selector.
	const hit = [...hits].sort((a, b) => Math.abs(a.extremePrice - entryPrice) - Math.abs(b.extremePrice - entryPrice) || a.id.localeCompare(b.id))[0]!
	const poolRank = rank(hit)
	const strictlyInsideBand = contains(hit, entryPrice)
	const sweptAt = hit.sweptAt
	const sweptRecently = sweptAt != null && decisionAt >= sweptAt && decisionAt - sweptAt <= config.sweepRecencyMs
	return {
		poolId: hit.id,
		side: hit.side,
		bandLow: hit.bandLow,
		bandHigh: hit.bandHigh,
		notional: hit.notional,
		rank: poolRank,
		alivePoolCount: alive.length,
		sweptAt: sweptAt ?? Number.NaN,
		sweepAgeMs: sweptAt == null ? Number.POSITIVE_INFINITY : decisionAt - sweptAt,
		strictlyInsideBand,
		qualified: (!config.requireStrictBandEntry || strictlyInsideBand) && sweptRecently && poolRank < config.maximumNotionalRank,
	}
}
