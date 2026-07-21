// LiquidityHeatmapEngine.ts
//
// Диагностический heatmap ликвидности v0.3: модель потенциальных
// ликвидаций (coinglass-style) из OHLCV без OI/funding.
// v0.3: только свечи со значимым объёмом рождают ликвидность,
// соседние бины сливаются в единые кластерные полосы,
// короткоживущий снесённый шум у цены отфильтрован.
// Отдельный слой: НЕ участвует в battle/PnL/confirmation и пока не
// является источником POI-зон. Все коэффициенты — display-настройки.
import type { Candle } from '../../models/price/Candle.js'

export const LIQUIDITY_HEATMAP_VERSION = 'liquidity-heatmap-0.4-balanced-brightness'

export type LiquiditySide = 'buy-side' | 'sell-side'
export type LiquidityPoolStatus = 'active' | 'swept'

export interface LeverageTier {
	leverage: number
	/** Доля условного объёма позиций с этим плечом. */
	share: number
}

export interface LiquidityHeatmapConfig {
	/** Ширина логарифмического ценового бина (доля цены). */
	binPct: number
	/** Распределение плеч (coinglass-style tiers). */
	leverageTiers: LeverageTier[]
	/** Окно SMA объёма для относительной значимости свечи. */
	volumeLookback: number
	/** Ликвидность рождают только свечи с relVolume выше порога («незначительные ликвидации» игнорируются). */
	minRelVolume: number
	/** Снесённые сегменты, прожившие меньше этого числа баров, отбрасываются как шум у цены. */
	minLifetimeBars: number
	/** Минимальное число вкладов в сегмент. */
	minContributions: number
	/** Максимальная высота одного кластера в бинах. */
	maxClusterBins: number
	/** Кластеры слабее этого веса отбрасываются. */
	minWeight: number
	/** Кривая яркости: weight = (notional/max)^gamma. */
	gamma: number
	/** Потолок числа кластеров в выдаче (топ по весу). */
	maxPools: number
}

export const LIQUIDITY_HEATMAP_CONFIG: LiquidityHeatmapConfig = {
	binPct: 0.004,
	leverageTiers: [
		{ leverage: 5, share: 0.1 },
		{ leverage: 10, share: 0.275 },
		{ leverage: 25, share: 0.3 },
		{ leverage: 50, share: 0.2 },
		{ leverage: 100, share: 0.125 },
	],
	volumeLookback: 20,
	minRelVolume: 1.25,
	minLifetimeBars: 12,
	minContributions: 1,
	maxClusterBins: 3,
	minWeight: 0.18,
	gamma: 0.5,
	maxPools: 600,
}

export interface LiquidityPool {
	id: string
	version: string
	/** sell-side = плотность ликвидаций шортов ВЫШЕ цены (красные), buy-side = лонгов НИЖЕ (зелёные). */
	side: LiquiditySide
	/** Notional-взвешенная середина кластера — уровень отрисовки. */
	extremePrice: number
	bandLow: number
	bandHigh: number
	/** Высота кластера в бинах (для толщины отрисовки). */
	spanBins: number
	startIndex: number
	startAt: number
	sweptIndex: number | null
	sweptAt: number | null
	contributions: number
	volumeAccumulated: number
	/** Накопленный условный объём (volume x price x share) — основа яркости. */
	notional: number
	weight: number
	status: LiquidityPoolStatus
	endAt: number
}

interface Segment {
	side: LiquiditySide
	k: number
	startIndex: number
	sweptIndex: number | null
	contributions: number
	volume: number
	notional: number
}

interface Cluster {
	side: LiquiditySide
	minK: number
	maxK: number
	startIndex: number
	endIndex: number
	allSwept: boolean
	maxSweptIndex: number
	contributions: number
	volume: number
	notional: number
	midNum: number
}

function collectSegments(c: Candle[], config: LiquidityHeatmapConfig, logStep: number): Segment[] {
	const binOf = (price: number): number => Math.floor(Math.log(price) / logStep)
	const binLow = (k: number): number => Math.exp(k * logStep)
	const binHigh = (k: number): number => Math.exp((k + 1) * logStep)
	const alive = new Map<string, Segment>()
	const done: Segment[] = []
	const volWindow: number[] = []
	let volSum = 0
	for (let i = 0; i < c.length; i++) {
		const bar = c[i]!
		// 1) Потребление: цена зашла в бин — ликвидность снята; новый объём позже копит новый сегмент (без воскрешения).
		for (const [key, seg] of alive) {
			if (i <= seg.startIndex) continue
			const hit = seg.side === 'sell-side' ? bar.high >= binLow(seg.k) : bar.low <= binHigh(seg.k)
			if (hit) {
				seg.sweptIndex = i
				done.push(seg)
				alive.delete(key)
			}
		}
		// 2) Новые уровни ликвидаций — только от свечей со значимым объёмом (look-ahead нет).
		const avg = volWindow.length ? volSum / volWindow.length : 0
		const relVolume = avg > 0 ? bar.volume / avg : 1
		volWindow.push(bar.volume)
		volSum += bar.volume
		if (volWindow.length > config.volumeLookback) volSum -= volWindow.shift()!
		if (relVolume < config.minRelVolume) continue
		const entry = (bar.high + bar.low + bar.close) / 3
		for (const tier of config.leverageTiers) {
			for (const side of ['sell-side', 'buy-side'] as const) {
				const level = side === 'sell-side' ? entry * (1 + 1 / tier.leverage) : entry * (1 - 1 / tier.leverage)
				const k = binOf(level)
				const key = `${side}|${k}`
				let seg = alive.get(key)
				if (!seg) {
					seg = { side, k, startIndex: i, sweptIndex: null, contributions: 0, volume: 0, notional: 0 }
					alive.set(key, seg)
				}
				seg.contributions++
				seg.volume += bar.volume * tier.share
				seg.notional += bar.volume * entry * tier.share
			}
		}
	}
	return [...done, ...alive.values()]
}

/** Слияние соседних бинов, живущих одновременно, в единые кластерные полосы (реальные плотности вместо параллельных полос). */
function clusterSegments(segments: Segment[], lastIndex: number, config: LiquidityHeatmapConfig, logStep: number): Cluster[] {
	const binMid = (k: number): number => Math.exp((k + 0.5) * logStep)
	const clusters: Cluster[] = []
	const sorted = [...segments].sort((a, b) => (a.k - b.k) || (a.startIndex - b.startIndex))
	for (const seg of sorted) {
		const segEnd = seg.sweptIndex ?? lastIndex
		let target: Cluster | null = null
		for (const cl of clusters) {
			if (cl.side !== seg.side) continue
			const newSpan = Math.max(cl.maxK, seg.k) - Math.min(cl.minK, seg.k) + 1
			if (newSpan > config.maxClusterBins) continue
			if (seg.k < cl.minK - 1 || seg.k > cl.maxK + 1) continue
			const overlap = Math.min(cl.endIndex, segEnd) - Math.max(cl.startIndex, seg.startIndex)
			const minLen = Math.max(1, Math.min(cl.endIndex - cl.startIndex, segEnd - seg.startIndex))
			if (overlap >= 0.5 * minLen) { target = cl; break }
		}
		if (target) {
			target.minK = Math.min(target.minK, seg.k)
			target.maxK = Math.max(target.maxK, seg.k)
			target.startIndex = Math.min(target.startIndex, seg.startIndex)
			target.endIndex = Math.max(target.endIndex, segEnd)
			target.allSwept = target.allSwept && seg.sweptIndex != null
			target.maxSweptIndex = Math.max(target.maxSweptIndex, seg.sweptIndex ?? -1)
			target.contributions += seg.contributions
			target.volume += seg.volume
			target.notional += seg.notional
			target.midNum += seg.notional * binMid(seg.k)
		} else {
			clusters.push({
				side: seg.side, minK: seg.k, maxK: seg.k,
				startIndex: seg.startIndex, endIndex: segEnd,
				allSwept: seg.sweptIndex != null, maxSweptIndex: seg.sweptIndex ?? -1,
				contributions: seg.contributions, volume: seg.volume, notional: seg.notional,
				midNum: seg.notional * binMid(seg.k),
			})
		}
	}
	return clusters
}

export function detectLiquidityHeatmap(c: Candle[], config: LiquidityHeatmapConfig = LIQUIDITY_HEATMAP_CONFIG): LiquidityPool[] {
	if (c.length === 0) return []
	const logStep = Math.log(1 + config.binPct)
	const lastIndex = c.length - 1
	const lastTs = c[lastIndex]!.timestamp
	const segments = collectSegments(c, config, logStep).filter(seg => {
		if (seg.contributions < config.minContributions) return false
		// Короткоживущий снесённый шум у цены не показываем; активные свежие остаются.
		if (seg.sweptIndex != null && seg.sweptIndex - seg.startIndex < config.minLifetimeBars) return false
		return true
	})
	const clusters = clusterSegments(segments, lastIndex, config, logStep)
	// Нормировка яркости по каждой стороне отдельно и по p90, а не по глобальному
	// максимуму: один гигантский многомесячный кластер не должен гасить
	// свежую ликвидность под локальными лоями/над хаями.
	const refBySide = new Map<LiquiditySide, number>()
	for (const side of ['sell-side', 'buy-side'] as const) {
		const notionals = clusters.filter(cl => cl.side === side).map(cl => cl.notional).sort((a, b) => a - b)
		if (notionals.length === 0) continue
		const ref = notionals.length >= 10 ? notionals[Math.floor(0.9 * (notionals.length - 1))]! : notionals[notionals.length - 1]!
		if (ref > 0) refBySide.set(side, ref)
	}
	if (refBySide.size === 0) return []
	const pools: LiquidityPool[] = []
	for (const cl of clusters) {
		const ref = refBySide.get(cl.side)
		if (ref == null) continue
		const weight = Math.min(1, Math.pow(cl.notional / ref, config.gamma))
		if (weight < config.minWeight) continue
		const sweptIndex = cl.allSwept ? cl.maxSweptIndex : null
		pools.push({
			id: `${LIQUIDITY_HEATMAP_VERSION}|${cl.side}|${cl.minK}:${cl.maxK}|${cl.startIndex}`,
			version: LIQUIDITY_HEATMAP_VERSION,
			side: cl.side,
			extremePrice: cl.midNum / cl.notional,
			bandLow: Math.exp(cl.minK * logStep),
			bandHigh: Math.exp((cl.maxK + 1) * logStep),
			spanBins: cl.maxK - cl.minK + 1,
			startIndex: cl.startIndex,
			startAt: c[cl.startIndex]!.timestamp,
			sweptIndex,
			sweptAt: sweptIndex == null ? null : c[sweptIndex]!.timestamp,
			contributions: cl.contributions,
			volumeAccumulated: cl.volume,
			notional: cl.notional,
			weight,
			status: sweptIndex == null ? 'active' : 'swept',
			endAt: sweptIndex == null ? lastTs : c[sweptIndex]!.timestamp,
		})
	}
	pools.sort((a, b) => b.weight - a.weight)
	return pools.slice(0, config.maxPools)
}
