export interface IndependentReversalG2EvaluatedTrade {
	symbol: string
	signalAt: number
	entryIndex: number
	exitIndex: number
	netR: number
	turnover: number
	holdingBars: number
	outcome: 'Stop' | 'Partial' | 'Full fix' | 'End mark'
}

export interface IndependentReversalG2Summary {
	trades: number
	meanNetR: number | null
	medianNetR: number | null
	profitFactor: number | null
	positiveNetRate: number | null
	bestOnePercentRemovedR: number | null
	turnover: number
	timeInMarketBars: number
	netRPerUnitExposure: number | null
	maximumSequentialDrawdownR: number
}

function mean(values: readonly number[]): number | null {
	return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function median(values: readonly number[]): number | null {
	if (!values.length) return null
	const sorted = [...values].sort((a, b) => a - b)
	const middle = Math.floor(sorted.length / 2)
	return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function profitFactor(values: readonly number[]): number | null {
	const grossProfit = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
	const grossLoss = Math.abs(values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0))
	return grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : null
}

export function summarizeIndependentReversalG2(trades: readonly IndependentReversalG2EvaluatedTrade[]): IndependentReversalG2Summary {
	const net = trades.map((trade) => trade.netR)
	const bestRemoved = [...net].sort((a, b) => b - a).slice(net.length ? Math.max(1, Math.ceil(net.length * 0.01)) : 0)
	let equity = 0
	let peak = 0
	let maximumSequentialDrawdownR = 0
	for (const trade of [...trades].sort((a, b) => a.signalAt - b.signalAt || a.symbol.localeCompare(b.symbol))) {
		equity += trade.netR
		peak = Math.max(peak, equity)
		maximumSequentialDrawdownR = Math.max(maximumSequentialDrawdownR, peak - equity)
	}
	const timeInMarketBars = trades.reduce((sum, trade) => sum + trade.holdingBars, 0)
	return {
		trades: trades.length,
		meanNetR: mean(net),
		medianNetR: median(net),
		profitFactor: profitFactor(net),
		positiveNetRate: mean(net.map((value) => value > 0 ? 1 : 0)),
		bestOnePercentRemovedR: mean(bestRemoved),
		turnover: trades.reduce((sum, trade) => sum + trade.turnover, 0),
		timeInMarketBars,
		netRPerUnitExposure: timeInMarketBars > 0 ? net.reduce((sum, value) => sum + value, 0) / timeInMarketBars : null,
		maximumSequentialDrawdownR,
	}
}

function monthKey(timestamp: number): string {
	const date = new Date(timestamp)
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function mulberry32(seed: number): () => number {
	return () => {
		seed |= 0
		seed = seed + 0x6D2B79F5 | 0
		let value = Math.imul(seed ^ seed >>> 15, 1 | seed)
		value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value
		return ((value ^ value >>> 14) >>> 0) / 4294967296
	}
}

export function deterministicMonthBlockBootstrap(
	trades: readonly IndependentReversalG2EvaluatedTrade[],
	runs: number,
	seed: number,
): { low95: number | null; high95: number | null; probabilityPositive: number | null } {
	if (!trades.length || runs <= 0) return { low95: null, high95: null, probabilityPositive: null }
	const blocks = new Map<string, IndependentReversalG2EvaluatedTrade[]>()
	for (const trade of trades) {
		const key = monthKey(trade.signalAt)
		const list = blocks.get(key)
		if (list) list.push(trade)
		else blocks.set(key, [trade])
	}
	const values = [...blocks.values()]
	const random = mulberry32(seed)
	const sampledMeans: number[] = []
	for (let run = 0; run < runs; run++) {
		let sum = 0
		let count = 0
		for (let i = 0; i < values.length; i++) {
			const sample = values[Math.floor(random() * values.length)]!
			for (const trade of sample) { sum += trade.netR; count++ }
		}
		sampledMeans.push(count ? sum / count : 0)
	}
	sampledMeans.sort((a, b) => a - b)
	return {
		low95: sampledMeans[Math.floor((sampledMeans.length - 1) * 0.025)]!,
		high95: sampledMeans[Math.floor((sampledMeans.length - 1) * 0.975)]!,
		probabilityPositive: sampledMeans.filter((value) => value > 0).length / sampledMeans.length,
	}
}

export function simulateIndependentReversalG2Portfolio(
	trades: readonly IndependentReversalG2EvaluatedTrade[],
	riskPerTradePct = 1,
	maximumOpenRiskPct = 3,
): { accepted: number; rejectedOverlap: number; totalReturnPct: number; maximumDrawdownPct: number } {
	const sorted = [...trades].sort((a, b) => a.signalAt - b.signalAt || a.symbol.localeCompare(b.symbol))
	const active: IndependentReversalG2EvaluatedTrade[] = []
	let equity = 0
	let peak = 0
	let maximumDrawdownPct = 0
	let rejectedOverlap = 0
	let accepted = 0
	for (const trade of sorted) {
		for (let i = active.length - 1; i >= 0; i--) if (active[i]!.exitIndex < trade.entryIndex) active.splice(i, 1)
		if ((active.length + 1) * riskPerTradePct > maximumOpenRiskPct) { rejectedOverlap++; continue }
		active.push(trade)
		accepted++
		equity += trade.netR * riskPerTradePct
		peak = Math.max(peak, equity)
		maximumDrawdownPct = Math.max(maximumDrawdownPct, peak - equity)
	}
	return { accepted, rejectedOverlap, totalReturnPct: equity, maximumDrawdownPct }
}
