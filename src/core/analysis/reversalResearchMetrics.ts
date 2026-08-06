import type { IndependentReversalSignalFamily } from '../signals/IndependentReversalResearch.js'
import type { IndependentReversalTradeReplay } from './reversalTradeReplay.js'

export const INDEPENDENT_REVERSAL_METRICS_VERSION =
	'independent-reversal-metrics-1.0-calendar-week-bootstrap'

export interface IndependentReversalResolvedTrade extends IndependentReversalTradeReplay {
	status: 'closed'
	netR: number
	entryAt: number
	exitAt: number
	exitReason: 'target' | 'stop' | 'time'
}

export interface IndependentReversalResearchTrade extends IndependentReversalResolvedTrade {
	symbol: string
	timeframe: string
	family: IndependentReversalSignalFamily
}

export interface IndependentReversalMetricSummary {
	trades: number
	wins: number
	losses: number
	breakeven: number
	winRate: number | null
	totalR: number
	expectancyR: number | null
	avgWinR: number | null
	avgLossR: number | null
	profitFactor: number | null
	maxDrawdownR: number
	bestOnePctRemovedTrades: number
	bestOnePctRemovedExpectancyR: number | null
}

export interface IndependentReversalBootstrapSummary {
	runs: number
	seed: number
	block: 'calendar-week-clustered-across-cells'
	lower95: number | null
	median: number | null
	upper95: number | null
	probabilityPositive: number | null
}

function percentile(values: number[], probability: number): number | null {
	if (!values.length) return null
	const sorted = [...values].sort((a, b) => a - b)
	const position = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * probability)))
	return sorted[position]!
}

function mulberry32(seed: number): () => number {
	return () => {
		seed |= 0
		seed = seed + 0x6D2B79F5 | 0
		let value = Math.imul(seed ^ seed >>> 15, 1 | seed)
		value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value
		return ((value ^ value >>> 14) >>> 0) / 4_294_967_296
	}
}

export function isResolvedIndependentReversalTrade(
	trade: IndependentReversalTradeReplay,
): trade is IndependentReversalResolvedTrade {
	return trade.status === 'closed' && trade.netR != null && trade.entryAt != null && trade.exitAt != null && trade.exitReason != null
}

export function removeBestOnePct<T extends { netR: number }>(trades: readonly T[]): T[] {
	if (!trades.length) return []
	const removeCount = Math.max(1, Math.ceil(trades.length * 0.01))
	return [...trades]
		.sort((a, b) => b.netR - a.netR)
		.slice(removeCount)
}

export function summarizeIndependentReversalTrades(
	trades: readonly { netR: number; entryAt: number; tradeId?: string }[],
): IndependentReversalMetricSummary {
	const ordered = [...trades].sort((a, b) => a.entryAt - b.entryAt || (a.tradeId ?? '').localeCompare(b.tradeId ?? ''))
	const wins = ordered.filter((trade) => trade.netR > 0)
	const losses = ordered.filter((trade) => trade.netR < 0)
	const breakeven = ordered.length - wins.length - losses.length
	const totalR = ordered.reduce((sum, trade) => sum + trade.netR, 0)
	const grossWin = wins.reduce((sum, trade) => sum + trade.netR, 0)
	const grossLoss = -losses.reduce((sum, trade) => sum + trade.netR, 0)
	let equity = 0
	let peak = 0
	let maxDrawdownR = 0
	for (const trade of ordered) {
		equity += trade.netR
		peak = Math.max(peak, equity)
		maxDrawdownR = Math.max(maxDrawdownR, peak - equity)
	}
	const withoutBest = removeBestOnePct(ordered)
	return {
		trades: ordered.length,
		wins: wins.length,
		losses: losses.length,
		breakeven,
		winRate: ordered.length ? wins.length / ordered.length : null,
		totalR,
		expectancyR: ordered.length ? totalR / ordered.length : null,
		avgWinR: wins.length ? grossWin / wins.length : null,
		avgLossR: losses.length ? grossLoss / losses.length : null,
		profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Number.POSITIVE_INFINITY : null,
		maxDrawdownR,
		bestOnePctRemovedTrades: ordered.length - withoutBest.length,
		bestOnePctRemovedExpectancyR: withoutBest.length
			? withoutBest.reduce((sum, trade) => sum + trade.netR, 0) / withoutBest.length
			: null,
	}
}

export function utcCalendarWeekKey(timestamp: number): string {
	const date = new Date(timestamp)
	const day = date.getUTCDay() || 7
	const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 4 - day))
	const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1)
	const week = Math.ceil(((thursday.getTime() - yearStart) / 86_400_000 + 1) / 7)
	return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function independentReversalBlockKey(trade: IndependentReversalResearchTrade): string {
	return utcCalendarWeekKey(trade.entryAt)
}

export function blockBootstrapExpectancy(
	trades: readonly IndependentReversalResearchTrade[],
	runs = 10_000,
	seed = 20260802,
): IndependentReversalBootstrapSummary {
	if (!Number.isInteger(runs) || runs < 0) throw new Error('Bootstrap runs must be a non-negative integer')
	const buckets = new Map<string, IndependentReversalResearchTrade[]>()
	for (const trade of trades) {
		const key = independentReversalBlockKey(trade)
		buckets.set(key, [...(buckets.get(key) ?? []), trade])
	}
	const blocks = [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, rows]) => rows)
	if (!blocks.length || runs === 0) {
		return { runs, seed, block: 'calendar-week-clustered-across-cells', lower95: null, median: null, upper95: null, probabilityPositive: null }
	}
	const random = mulberry32(seed)
	const outcomes: number[] = []
	let positive = 0
	for (let run = 0; run < runs; run++) {
		let totalR = 0
		let sampledTrades = 0
		for (let i = 0; i < blocks.length; i++) {
			const sampled = blocks[Math.floor(random() * blocks.length)]!
			totalR += sampled.reduce((sum, trade) => sum + trade.netR, 0)
			sampledTrades += sampled.length
		}
		const expectancy = sampledTrades ? totalR / sampledTrades : 0
		outcomes.push(expectancy)
		if (expectancy > 0) positive++
	}
	return {
		runs,
		seed,
		block: 'calendar-week-clustered-across-cells',
		lower95: percentile(outcomes, 0.025),
		median: percentile(outcomes, 0.5),
		upper95: percentile(outcomes, 0.975),
		probabilityPositive: positive / runs,
	}
}

export function groupIndependentReversalMetrics<T extends IndependentReversalResearchTrade>(
	trades: readonly T[],
	key: (trade: T) => string,
): Record<string, IndependentReversalMetricSummary> {
	const groups = new Map<string, T[]>()
	for (const trade of trades) groups.set(key(trade), [...(groups.get(key(trade)) ?? []), trade])
	return Object.fromEntries([...groups.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([group, rows]) => [group, summarizeIndependentReversalTrades(rows)]))
}

export function contributionShares(
	trades: readonly IndependentReversalResearchTrade[],
	key: (trade: IndependentReversalResearchTrade) => string = (trade) => trade.symbol,
): Record<string, number> {
	const positiveByKey = new Map<string, number>()
	for (const trade of trades) {
		const group = key(trade)
		positiveByKey.set(group, (positiveByKey.get(group) ?? 0) + trade.netR)
	}
	const positiveTotal = [...positiveByKey.values()].filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
	return Object.fromEntries([...positiveByKey.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([group, value]) => [group, value > 0 && positiveTotal > 0 ? value / positiveTotal : 0]))
}
