// LiquidityHeatmapEngine.ts
//
// Диагностический heatmap ликвидности v0.2: модель потенциальных
// ликвидаций (coinglass-style), аппроксимированная из OHLCV без OI/funding:
// каждая свеча «открывает позиции» пропорционально объёму, уровни
// ликвидаций плеч 5x..100x ложатся выше/ниже входа и копятся в
// логарифмических ценовых бинах. Объём — главный драйвер яркости.
// Отдельный слой: НЕ участвует в battle/PnL/confirmation и пока не
// является источником POI-зон. Все коэффициенты — display-настройки
// интенсивности в LIQUIDITY_HEATMAP_CONFIG (см. SPEC 16.5).
import type { Candle } from '../../models/price/Candle.js'

export const LIQUIDITY_HEATMAP_VERSION = 'liquidity-heatmap-0.2-liquidation-bins'

export type LiquiditySide = 'buy-side' | 'sell-side'
export type LiquidityPoolStatus = 'active' | 'swept'

export interface LeverageTier {
	leverage: number
	/** Доля условного объёма позиций, открываемых с этим плечом. */
	share: number
}

export interface LiquidityHeatmapConfig {
	/** Ширина логарифмического ценового бина (доля цены). */
	binPct: number
	/** Распределение плеч (coinglass-style tiers). */
	leverageTiers: LeverageTier[]
	/** Окно SMA объёма для относительной значимости свечи. */
	volumeLookback: number
	/** Свечи с relVolume ниже порога игнорируются («незначительные ликвидации»). */
	minRelVolume: number
	/** Сегменты слабее этого веса отбрасываются. */
	minWeight: number
	/** Кривая яркости: weight = (notional/max)^gamma. */
	gamma: number
	/** Жёсткий потолок числа сегментов в выдаче (топ по весу). */
	maxPools: number
}

export const LIQUIDITY_HEATMAP_CONFIG: LiquidityHeatmapConfig = {
	binPct: 0.0025,
	leverageTiers: [
		{ leverage: 5, share: 0.1 },
		{ leverage: 10, share: 0.275 },
		{ leverage: 25, share: 0.3 },
		{ leverage: 50, share: 0.2 },
		{ leverage: 100, share: 0.125 },
	],
	volumeLookback: 20,
	minRelVolume: 0.5,
	minWeight: 0.05,
	gamma: 0.35,
	maxPools: 2500,
}

export interface LiquidityPool {
	id: string
	version: string
	/** sell-side = плотность ликвидаций шортов ВЫШЕ цены (красные), buy-side = лонгов НИЖЕ (зелёные). */
	side: LiquiditySide
	/** Середина бина — уровень отрисовки. */
	extremePrice: number
	bandLow: number
	bandHigh: number
	startIndex: number
	startAt: number
	sweptIndex: number | null
	sweptAt: number | null
	/** Сколько вкладов (свеча x плечо) накоплено в бине. */
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

export function detectLiquidityHeatmap(c: Candle[], config: LiquidityHeatmapConfig = LIQUIDITY_HEATMAP_CONFIG): LiquidityPool[] {
	if (c.length === 0) return []
	const logStep = Math.log(1 + config.binPct)
	const binOf = (price: number): number => Math.floor(Math.log(price) / logStep)
	const binLow = (k: number): number => Math.exp(k * logStep)
	const binHigh = (k: number): number => Math.exp((k + 1) * logStep)
	const alive = new Map<string, Segment>()
	const done: Segment[] = []
	const volWindow: number[] = []
	let volSum = 0
	for (let i = 0; i < c.length; i++) {
		const bar = c[i]!
		// 1) Потребление: цена зашла в бин — ликвидность снята. Новый объём
		// позже копит новый сегмент в том же бине (без воскрешения).
		for (const [key, seg] of alive) {
			if (i <= seg.startIndex) continue
			const hit = seg.side === 'sell-side' ? bar.high >= binLow(seg.k) : bar.low <= binHigh(seg.k)
			if (hit) {
				seg.sweptIndex = i
				done.push(seg)
				alive.delete(key)
			}
		}
		// 2) Новые уровни ликвидаций от позиций этой свечи (известны сразу, look-ahead нет).
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
	const all = [...done, ...alive.values()]
	const maxNotional = all.reduce((m, s) => Math.max(m, s.notional), 0)
	if (maxNotional <= 0) return []
	const lastTs = c.at(-1)!.timestamp
	const pools: LiquidityPool[] = []
	for (const seg of all) {
		const weight = Math.pow(seg.notional / maxNotional, config.gamma)
		if (weight < config.minWeight) continue
		pools.push({
			id: `${LIQUIDITY_HEATMAP_VERSION}|${seg.side}|${seg.k}|${seg.startIndex}`,
			version: LIQUIDITY_HEATMAP_VERSION,
			side: seg.side,
			extremePrice: Math.exp((seg.k + 0.5) * logStep),
			bandLow: binLow(seg.k),
			bandHigh: binHigh(seg.k),
			startIndex: seg.startIndex,
			startAt: c[seg.startIndex]!.timestamp,
			sweptIndex: seg.sweptIndex,
			sweptAt: seg.sweptIndex == null ? null : c[seg.sweptIndex]!.timestamp,
			contributions: seg.contributions,
			volumeAccumulated: seg.volume,
			notional: seg.notional,
			weight,
			status: seg.sweptIndex == null ? 'active' : 'swept',
			endAt: seg.sweptIndex == null ? lastTs : c[seg.sweptIndex]!.timestamp,
		})
	}
	pools.sort((a, b) => b.weight - a.weight)
	return pools.slice(0, config.maxPools)
}
