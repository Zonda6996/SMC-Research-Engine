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

export const LIQUIDITY_HEATMAP_VERSION = 'liquidity-heatmap-1.4-shelf-grouping'

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
	/** Вклад позже чем через столько баров после предыдущего открывает НОВУЮ полосу в том же бине (событийные окна накопления). */
	maxGapBars: number
	/** Кластеры слабее этого веса отбрасываются. 0 = без отсева: ранг считается по ВСЕЙ истории и при длинной загрузке голодил бы свежее окно; видимый отсев делает рендерер по окну. */
	minWeight: number
	/** Кривая яркости: weight = (rank/count)^gamma внутри стороны; gamma > 1 делает большинство полос бледными, а топ — насыщенным. */
	gamma: number
	/** Аварийный потолок размера выдачи (топ по весу) — защита payload, а НЕ визуальный фильтр: обрезка по историческому рангу делала 15k-загрузку пустее 5k. */
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
	minRelVolume: 0.75,
	minLifetimeBars: 12,
	minContributions: 1,
	maxClusterBins: 3,
	maxGapBars: 12,
	minWeight: 0,
	gamma: 1.5,
	maxPools: 10_000,
}

const HOUR_4_MS = 14_400_000
const DAY_MS = 86_400_000
const WEEK_MS = 604_800_000

/** Медианный шаг между свечами — определение ТФ без внешнего параметра. */
export function inferTfMs(c: Candle[]): number {
	if (c.length < 2) return HOUR_4_MS
	const deltas: number[] = []
	for (let i = 1; i < c.length; i++) deltas.push(c[i]!.timestamp - c[i - 1]!.timestamp)
	deltas.sort((a, b) => a - b)
	return deltas[Math.floor(deltas.length / 2)]!
}

/**
 * ТФ-профили (дефолт при отсутствии явного конфига): младшие ТФ (< 4h)
 * группируются жёстче (крупнее кластеры, строже порог объёма), дневка/неделька
 * дополнительно укрупняют бины — иначе узкие 0.4%-полосы на макро-диапазоне выглядят
 * стеной шума. 4h — базовый профиль без изменений.
 */
export function heatmapConfigForTf(tfMs: number): LiquidityHeatmapConfig {
	if (tfMs < HOUR_4_MS) return { ...LIQUIDITY_HEATMAP_CONFIG, minRelVolume: 1.0, binPct: 0.005, maxClusterBins: 6 }
	if (tfMs >= WEEK_MS) return { ...LIQUIDITY_HEATMAP_CONFIG, minRelVolume: 1.25, binPct: 0.009, maxClusterBins: 5 }
	if (tfMs >= DAY_MS) return { ...LIQUIDITY_HEATMAP_CONFIG, minRelVolume: 1.25, binPct: 0.01, maxClusterBins: 6 }
	return { ...LIQUIDITY_HEATMAP_CONFIG, minRelVolume: 1.0, binPct: 0.006, maxClusterBins: 6 }
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
	/** Индекс/время ПОСЛЕДНЕГО пополнения кластера — основа фильтра свежести (бин мог родиться давно, но кормиться недавно). */
	lastContributionIndex: number
	lastContributionAt: number
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
	lastIndex: number
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
	lastContributionIndex: number
	sweeps: Array<{ index: number; notional: number }>
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
	// Закрытые по гэпу окна накопления: всё ещё живая ликвидность, снимается вместе с бином.
	const dormant = new Map<string, Segment[]>()
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
				for (const d of dormant.get(key) ?? []) {
					d.sweptIndex = i
					done.push(d)
				}
				dormant.delete(key)
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
				if (seg && i - seg.lastIndex > config.maxGapBars) {
					// Гэп без вкладов: старое окно остаётся жить отдельной полосой, новый объём — новая полоса.
					const dor = dormant.get(key) ?? []
					dor.push(seg)
					dormant.set(key, dor)
					alive.delete(key)
					seg = undefined
				}
				if (!seg) {
					seg = { side, k, startIndex: i, lastIndex: i, sweptIndex: null, contributions: 0, volume: 0, notional: 0 }
					alive.set(key, seg)
				}
				seg.lastIndex = i
				seg.contributions++
				seg.volume += bar.volume * tier.share
				seg.notional += bar.volume * entry * tier.share
			}
		}
	}
	return [...done, ...[...dormant.values()].flat(), ...alive.values()]
}

/** Слияние соседних бинов, живущих одновременно, в единые кластерные полосы (реальные плотности вместо параллельных полос). */
function clusterSegments(segments: Segment[], config: LiquidityHeatmapConfig, logStep: number): Cluster[] {
	const binMid = (k: number): number => Math.exp((k + 0.5) * logStep)
	const clusters: Cluster[] = []
	const sorted = [...segments].sort((a, b) => (a.k - b.k) || (a.startIndex - b.startIndex))
	for (const seg of sorted) {
		// Для слияния сравниваем ОКНА НАКОПЛЕНИЯ, а не время жизни: разные эпохи одного бина не сливаются.
		const segEnd = seg.lastIndex
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
			target.lastContributionIndex = Math.max(target.lastContributionIndex, seg.lastIndex)
			if (seg.sweptIndex != null) target.sweeps.push({ index: seg.sweptIndex, notional: seg.notional })
			target.contributions += seg.contributions
			target.volume += seg.volume
			target.notional += seg.notional
			target.midNum += seg.notional * binMid(seg.k)
		} else {
			clusters.push({
				side: seg.side, minK: seg.k, maxK: seg.k,
				startIndex: seg.startIndex, endIndex: segEnd,
				lastContributionIndex: seg.lastIndex,
				sweeps: seg.sweptIndex != null ? [{ index: seg.sweptIndex, notional: seg.notional }] : [],
				contributions: seg.contributions, volume: seg.volume, notional: seg.notional,
				midNum: seg.notional * binMid(seg.k),
			})
		}
	}
	return clusters
}

/**
 * Полоса считается снятой, когда цена сняла БОЛЬШИНСТВО (>= 50% notional) её бинов:
 * высокая полоса, в нижние бины которой цена уже зашла, не должна лежать
 * поперёк графика как «активная» (раньше требовалось снятие ВСЕХ бинов).
 */
function resolveSweptIndex(cl: Cluster): number | null {
	let swept = 0
	for (const sw of cl.sweeps) swept += sw.notional
	if (swept < 0.5 * cl.notional) return null
	const ordered = [...cl.sweeps].sort((a, b) => a.index - b.index)
	let acc = 0
	for (const sw of ordered) {
		acc += sw.notional
		if (acc >= 0.5 * cl.notional) return sw.index
	}
	return ordered[ordered.length - 1]!.index
}

export function detectLiquidityHeatmap(c: Candle[], configArg?: LiquidityHeatmapConfig): LiquidityPool[] {
	if (c.length === 0) return []
	const config = configArg ?? heatmapConfigForTf(inferTfMs(c))
	const logStep = Math.log(1 + config.binPct)
	const lastIndex = c.length - 1
	const lastTs = c[lastIndex]!.timestamp
	const segments = collectSegments(c, config, logStep).filter(seg => {
		if (seg.contributions < config.minContributions) return false
		// Короткоживущий снесённый шум у цены не показываем; активные свежие остаются.
		if (seg.sweptIndex != null && seg.sweptIndex - seg.startIndex < config.minLifetimeBars) return false
		return true
	})
	const clusters = clusterSegments(segments, config, logStep)
	// Сила кластера — ранговая внутри стороны: гарантированный градиент яркости
	// (топ — насыщенный, середина — умеренная, слабые — бледные) без прижатия к потолку
	// и без гашения всей карты одним выбросом.
	const weightOf = new Map<Cluster, number>()
	for (const side of ['sell-side', 'buy-side'] as const) {
		const sorted = clusters.filter(cl => cl.side === side).sort((a, b) => a.notional - b.notional)
		sorted.forEach((cl, i) => weightOf.set(cl, Math.pow((i + 1) / sorted.length, config.gamma)))
	}
	if (weightOf.size === 0) return []
	const pools: LiquidityPool[] = []
	for (const cl of clusters) {
		const weight = weightOf.get(cl) ?? 0
		if (weight < config.minWeight) continue
		const sweptIndex = resolveSweptIndex(cl)
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
			lastContributionIndex: cl.lastContributionIndex,
			lastContributionAt: c[cl.lastContributionIndex]!.timestamp,
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
	if (pools.length <= config.maxPools) return pools
	// Потолок — только защита payload: при переполнении оставляем САМЫЕ СВЕЖИЕ пулы,
	// а не самые тяжёлые: обрезка по историческому весу голодила свежее окно при длинной загрузке.
	const kept = [...pools].sort((a, b) => b.lastContributionAt - a.lastContributionAt).slice(0, config.maxPools)
	kept.sort((a, b) => b.weight - a.weight)
	return kept
}
