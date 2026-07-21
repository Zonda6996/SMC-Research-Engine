// LiquidityHeatmapEngine.ts
//
// Диагностический heatmap ликвидности (EQH/EQL pools).
// Отдельный слой: НЕ участвует в battle, PnL и confirmation, и пока не
// является источником POI-зон. Все коэффициенты — display-настройки
// интенсивности, вынесенные в LIQUIDITY_HEATMAP_CONFIG (см. SPEC 16.5).
import type { Candle } from '../../models/price/Candle.js'

export const LIQUIDITY_HEATMAP_VERSION = 'liquidity-heatmap-0.1-eq-pools'

export type LiquiditySide = 'buy-side' | 'sell-side'
export type LiquidityPoolStatus = 'active' | 'swept'

export interface LiquidityHeatmapConfig {
	/** Окна подтверждения pivot (лево/право, в барах), по возрастанию. Минимальное окно определяет causal-доступность уровня. */
	pivotWindows: [number, number, number]
	/** Допуск кластеризации и сноса: доля ATR(atrPeriod) на баре pivot. */
	clusterAtrFraction: number
	/** Допуск кластеризации и сноса: доля цены. Берётся максимум из двух допусков. */
	clusterPricePct: number
	atrPeriod: number
	volumeLookback: number
	/** Насыщение веса: weight = 1 - exp(-rawScore / weightSaturation). */
	weightSaturation: number
}

export const LIQUIDITY_HEATMAP_CONFIG: LiquidityHeatmapConfig = {
	pivotWindows: [5, 10, 20],
	clusterAtrFraction: 0.1,
	clusterPricePct: 0.0015,
	atrPeriod: 14,
	volumeLookback: 20,
	weightSaturation: 4,
}

export interface LiquidityPool {
	id: string
	version: string
	side: LiquiditySide
	/** Крайняя цена пула: max high (sell-side) / min low (buy-side). Порог сноса = extreme + tolerance. */
	extremePrice: number
	bandLow: number
	bandHigh: number
	tolerance: number
	startIndex: number
	startAt: number
	confirmedIndex: number
	confirmedAt: number
	sweptIndex: number | null
	sweptAt: number | null
	/** Сколько подтверждённых pivot слилось в пул (EQH/EQL-стек). */
	pivotCount: number
	pivotIndexes: number[]
	pivotSpans: number[]
	/** Заходы цены в пул без сноса (после подтверждения). */
	touchCount: number
	volumeAccumulated: number
	rawScore: number
	weight: number
	status: LiquidityPoolStatus
	endAt: number
}

interface PivotSeed {
	type: 'high' | 'low'
	index: number
	price: number
	span: number
	confirmedIndex: number
	volume: number
	relVolume: number
	atr: number
}
interface PoolState extends LiquidityPool { lastExtremeIndex: number; inside: boolean }

function atrAt(c: Candle[], i: number, n: number): number {
	let sum = 0, count = 0
	for (let j = Math.max(1, i - n + 1); j <= i; j++) {
		const x = c[j]!, p = c[j - 1]!
		sum += Math.max(x.high - x.low, Math.abs(x.high - p.close), Math.abs(x.low - p.close))
		count++
	}
	return count ? sum / count : 0
}

function relVolumeAt(c: Candle[], i: number, lookback: number): number {
	let sum = 0, count = 0
	for (let j = Math.max(0, i - lookback); j < i; j++) { sum += c[j]!.volume; count++ }
	const avg = count ? sum / count : 0
	return avg > 0 ? c[i]!.volume / avg : 1
}

/** Максимальное окно, при котором бар i остаётся pivot. Лево — строго, право — нестрого (первый из равных экстремумов побеждает). */
function pivotSpan(c: Candle[], i: number, type: 'high' | 'low', windows: readonly number[]): number {
	let span = 0
	for (const w of windows) {
		if (i - w < 0 || i + w >= c.length) break
		let ok = true
		for (let j = i - w; j <= i + w && ok; j++) {
			if (j === i) continue
			const y = c[j]!, x = c[i]!
			if (type === 'high') ok = j < i ? y.high < x.high : y.high <= x.high
			else ok = j < i ? y.low > x.low : y.low >= x.low
		}
		if (!ok) break
		span = w
	}
	return span
}

function pivotSeeds(c: Candle[], config: LiquidityHeatmapConfig): PivotSeed[] {
	const windows = [...config.pivotWindows].sort((a, b) => a - b)
	const minW = windows[0]!
	const out: PivotSeed[] = []
	for (let i = minW; i < c.length - minW; i++) {
		for (const type of ['high', 'low'] as const) {
			const span = pivotSpan(c, i, type, windows)
			if (!span) continue
			out.push({ type, index: i, price: type === 'high' ? c[i]!.high : c[i]!.low, span,
				confirmedIndex: i + minW, volume: c[i]!.volume,
				relVolume: relVolumeAt(c, i, config.volumeLookback), atr: atrAt(c, i, config.atrPeriod) })
		}
	}
	return out
}

function pivotScore(seed: PivotSeed): number {
	return Math.log2(Math.max(2, seed.span)) + 0.5 * Math.min(seed.relVolume, 2)
}

function saturate(rawScore: number, saturation: number): number {
	return 1 - Math.exp(-rawScore / saturation)
}

export function detectLiquidityHeatmap(c: Candle[], config: LiquidityHeatmapConfig = LIQUIDITY_HEATMAP_CONFIG): LiquidityPool[] {
	const minW = Math.min(...config.pivotWindows)
	if (c.length < 2 * minW + 1) return []
	const byConfirm = new Map<number, PivotSeed[]>()
	for (const seed of pivotSeeds(c, config)) {
		const list = byConfirm.get(seed.confirmedIndex) ?? []
		list.push(seed)
		byConfirm.set(seed.confirmedIndex, list)
	}
	const pools: PoolState[] = []
	for (let i = 0; i < c.length; i++) {
		const bar = c[i]!
		// 1) Снос и касания: строго до подтверждений этого бара.
		for (const pool of pools) {
			if (pool.status !== 'active' || i <= pool.lastExtremeIndex) continue
			const beyond = pool.side === 'sell-side'
				? bar.high > pool.extremePrice + pool.tolerance
				: bar.low < pool.extremePrice - pool.tolerance
			if (beyond) {
				pool.status = 'swept'
				pool.sweptIndex = i
				pool.sweptAt = bar.timestamp
				pool.inside = false
				continue
			}
			const reached = pool.side === 'sell-side' ? bar.high >= pool.bandLow : bar.low <= pool.bandHigh
			if (reached && !pool.inside) {
				pool.touchCount++
				if (pool.touchCount <= 5) pool.rawScore += 0.3
				pool.weight = saturate(pool.rawScore, config.weightSaturation)
			}
			pool.inside = reached
			if (reached) {
				// Прокол внутри допуска — не снос, а обновление equal-экстремума.
				if (pool.side === 'sell-side' && bar.high > pool.extremePrice) {
					pool.extremePrice = bar.high
					pool.bandHigh = Math.max(pool.bandHigh, bar.high)
					pool.lastExtremeIndex = i
				} else if (pool.side === 'buy-side' && bar.low < pool.extremePrice) {
					pool.extremePrice = bar.low
					pool.bandLow = Math.min(pool.bandLow, bar.low)
					pool.lastExtremeIndex = i
				}
			}
		}
		// 2) Подтверждённые на этом баре pivot: слить в пул или создать новый.
		for (const seed of byConfirm.get(i) ?? []) {
			const side: LiquiditySide = seed.type === 'high' ? 'sell-side' : 'buy-side'
			const tolerance = Math.max(config.clusterAtrFraction * seed.atr, config.clusterPricePct * seed.price)
			const pool = pools.find(x => x.side === side && x.status === 'active'
				&& seed.price >= x.bandLow - Math.max(tolerance, x.tolerance)
				&& seed.price <= x.bandHigh + Math.max(tolerance, x.tolerance))
			if (pool) {
				pool.pivotCount++
				pool.pivotIndexes.push(seed.index)
				pool.pivotSpans.push(seed.span)
				pool.volumeAccumulated += seed.volume
				pool.bandLow = Math.min(pool.bandLow, seed.price)
				pool.bandHigh = Math.max(pool.bandHigh, seed.price)
				pool.tolerance = Math.max(pool.tolerance, tolerance)
				if (side === 'sell-side' ? seed.price > pool.extremePrice : seed.price < pool.extremePrice) {
					pool.extremePrice = seed.price
					pool.lastExtremeIndex = Math.max(pool.lastExtremeIndex, seed.index)
				}
				pool.rawScore += pivotScore(seed)
				pool.weight = saturate(pool.rawScore, config.weightSaturation)
			} else {
				const rawScore = pivotScore(seed)
				pools.push({
					id: `${LIQUIDITY_HEATMAP_VERSION}|${side}|${seed.index}|${seed.confirmedIndex}`,
					version: LIQUIDITY_HEATMAP_VERSION, side,
					extremePrice: seed.price, bandLow: seed.price, bandHigh: seed.price, tolerance,
					startIndex: seed.index, startAt: c[seed.index]!.timestamp,
					confirmedIndex: seed.confirmedIndex, confirmedAt: c[seed.confirmedIndex]!.timestamp,
					sweptIndex: null, sweptAt: null,
					pivotCount: 1, pivotIndexes: [seed.index], pivotSpans: [seed.span],
					touchCount: 0, volumeAccumulated: seed.volume,
					rawScore, weight: saturate(rawScore, config.weightSaturation),
					status: 'active', endAt: c.at(-1)!.timestamp,
					lastExtremeIndex: seed.index, inside: false,
				})
			}
		}
	}
	const lastTs = c.at(-1)!.timestamp
	return pools.map(({ lastExtremeIndex: _l, inside: _i, ...pool }) => ({ ...pool, endAt: pool.sweptAt ?? lastTs }))
}
