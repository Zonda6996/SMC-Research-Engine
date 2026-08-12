import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseExactIndicatorCsv, sha256File, type ExactIndicatorRow } from './lib/exactIndicatorExport.js'

interface InputSpec {
	id: string
	file: string
	timeframeMinutes: number
}

interface ForwardMetric {
	returnPct: number
	mfePct: number
	maePct: number
}

interface TradeResult {
	outcome: 'Stop' | 'Partial' | 'Full fix' | 'End mark'
	returnPct: number
	added: boolean
	partial: boolean
}

const inputs: InputSpec[] = [
	{ id: 'btc-2h', file: 'C:/Users/Никита/Downloads/BYBIT_BTCUSDT.P, 120.csv', timeframeMinutes: 120 },
	{ id: 'btc-1h', file: 'C:/Users/Никита/Downloads/BYBIT_BTCUSDT.P, 60.csv', timeframeMinutes: 60 },
	{ id: 'btc-15m', file: 'C:/Users/Никита/Downloads/BYBIT_BTCUSDT.P, 15.csv', timeframeMinutes: 15 },
	{ id: 'ondo-2h', file: 'C:/Users/Никита/Downloads/BYBIT_ONDOUSDT.P, 120.csv', timeframeMinutes: 120 },
	{ id: 'ondo-1h', file: 'C:/Users/Никита/Downloads/BYBIT_ONDOUSDT.P, 60.csv', timeframeMinutes: 60 },
	{ id: 'ondo-15m', file: 'C:/Users/Никита/Downloads/BYBIT_ONDOUSDT.P, 15.csv', timeframeMinutes: 15 },
]

const horizonsHours = [6, 12, 24, 48]
const safeMultipliers = [8, 10, 12, 14, 16]
const riskScale = 0.694
const bootstrapSamples = 2_000
const warmupBars = 100

function validBand(row: ExactIndicatorRow): boolean {
	return row.lowerOuter < row.lowerInner && row.lowerInner < row.mean && row.mean < row.upperInner && row.upperInner < row.upperOuter
}

function trueRangeSma(rows: readonly ExactIndicatorRow[], period: number): Array<number | null> {
	const out = Array<number | null>(rows.length).fill(null)
	const queue: number[] = []
	let sum = 0
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]!
		const previousClose = i > 0 ? rows[i - 1]!.close : row.open
		const value = Math.max(row.high - row.low, Math.abs(row.high - previousClose), Math.abs(row.low - previousClose))
		queue.push(value)
		sum += value
		if (queue.length > period) sum -= queue.shift()!
		if (queue.length === period) out[i] = sum / period
	}
	return out
}

function direction(row: ExactIndicatorRow): 1 | -1 | null {
	if (row.buy) return 1
	if (row.sell) return -1
	return null
}

function forwardMetric(rows: readonly ExactIndicatorRow[], signalIndex: number, side: 1 | -1, horizonBars: number): ForwardMetric | null {
	const entryIndex = signalIndex + 1
	const endIndex = entryIndex + horizonBars - 1
	if (endIndex >= rows.length) return null
	const entry = rows[entryIndex]!.open
	let favourable = 0
	let adverse = 0
	for (let i = entryIndex; i <= endIndex; i++) {
		const row = rows[i]!
		const favourableMove = side === 1 ? row.high - entry : entry - row.low
		const adverseMove = side === 1 ? row.low - entry : entry - row.high
		favourable = Math.max(favourable, favourableMove)
		adverse = Math.min(adverse, adverseMove)
	}
	const endClose = rows[endIndex]!.close
	return {
		returnPct: side * (endClose - entry) / entry * 100,
		mfePct: favourable / entry * 100,
		maePct: adverse / entry * 100,
	}
}

function mean(values: readonly number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length
}

function profitFactor(values: readonly number[]): number | null {
	const profit = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
	const loss = Math.abs(values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0))
	return loss > 0 ? profit / loss : profit > 0 ? Number.POSITIVE_INFINITY : null
}

function maxSequentialDrawdown(values: readonly number[]): number {
	let equity = 0
	let peak = 0
	let drawdown = 0
	for (const value of values) {
		equity += value
		peak = Math.max(peak, equity)
		drawdown = Math.min(drawdown, equity - peak)
	}
	return drawdown
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b)
	const middle = Math.floor(sorted.length / 2)
	return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
}

function rng(seed: number): () => number {
	let state = seed >>> 0
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0
		return state / 0x1_0000_0000
	}
}

function bootstrapNull(
	rows: readonly ExactIndicatorRow[],
	sides: readonly (1 | -1)[],
	horizonBars: number,
	seed: number,
): { mean: number; pOneSided: number; q05: number; q95: number } {
	const eligible: number[] = []
	for (let i = warmupBars; i + 1 + horizonBars - 1 < rows.length; i++) {
		if (validBand(rows[i]!) && validBand(rows[i + 1]!)) eligible.push(i)
	}
	const random = rng(seed)
	const samples: number[] = []
	for (let b = 0; b < bootstrapSamples; b++) {
		let total = 0
		let count = 0
		for (const side of sides) {
			const index = eligible[Math.floor(random() * eligible.length)]!
			const metric = forwardMetric(rows, index, side, horizonBars)
			if (metric != null) {
				total += metric.returnPct
				count++
			}
		}
		samples.push(count > 0 ? total / count : 0)
	}
	samples.sort((a, b) => a - b)
	return {
		mean: mean(samples),
		pOneSided: 0,
		q05: samples[Math.floor(samples.length * 0.05)]!,
		q95: samples[Math.floor(samples.length * 0.95)]!,
	}
}

function hitTarget(side: 1 | -1, row: ExactIndicatorRow, level: number): boolean {
	return side === 1 ? row.high >= level : row.low <= level
}

function hitStop(side: 1 | -1, row: ExactIndicatorRow, level: number): boolean {
	return side === 1 ? row.low <= level : row.high >= level
}

function hitAdd(side: 1 | -1, row: ExactIndicatorRow, level: number): boolean {
	return side === 1 ? row.low <= level : row.high >= level
}

function pricePnl(side: 1 | -1, from: number, to: number, weight: number, reference: number): number {
	return side * (to - from) / reference * weight * 100
}

function simulateTrade(
	rows: readonly ExactIndicatorRow[],
	tr55: readonly (number | null)[],
	signalIndex: number,
	side: 1 | -1,
	stopMultiplier: number,
	intrabarOrder: 'stop-first' | 'target-first',
	addEnabled: boolean,
): TradeResult | null {
	const entryIndex = signalIndex + 1
	const entryRow = rows[entryIndex]
	const volatility = tr55[signalIndex]
	if (entryRow == null || volatility == null || volatility <= 0 || !validBand(rows[signalIndex]!) || !validBand(entryRow)) return null
	const entry = entryRow.open
	const stopDistance = volatility * stopMultiplier
	const stop = entry - side * stopDistance
	const add = entry - side * stopDistance * 0.5
	let average = entry
	let activeWeight = addEnabled ? 0.5 : 1
	let added = false
	let partial = false
	let realised = 0
	let breakEvenActiveFrom = Number.POSITIVE_INFINITY
	for (let i = entryIndex; i < rows.length; i++) {
		const row = rows[i]!
		if (!validBand(row)) continue
		const currentStop = i >= breakEvenActiveFrom ? average : stop
		const stopHit = hitStop(side, row, currentStop)
		const addHit = addEnabled && !added && hitAdd(side, row, add)
		const partialLevel = row.mean
		const partialHit = !partial && hitTarget(side, row, partialLevel)
		const fullLevel = side === 1 ? row.upperInner : row.lowerInner
		const fullHit = hitTarget(side, row, fullLevel)

		// The add lies between entry and initial stop, so any path reaching the
		// initial stop must cross the add first. Target-vs-stop order remains
		// unknown inside an OHLC candle and is evaluated at both boundaries.
		if (addHit) {
			added = true
			activeWeight = 1
			average = (entry + add) / 2
		}
		const processTargets = (): TradeResult | null => {
			if (partialHit && !partial) {
				partial = true
				const exitWeight = activeWeight * 0.25
				realised += pricePnl(side, average, partialLevel, exitWeight, entry)
				activeWeight -= exitWeight
				breakEvenActiveFrom = i + 1
			}
			if (fullHit) {
				return {
					outcome: 'Full fix',
					returnPct: realised + pricePnl(side, average, fullLevel, activeWeight, entry),
					added,
					partial,
				}
			}
			return null
		}
		const processStop = (): TradeResult | null => stopHit ? {
			outcome: partial ? 'Partial' : 'Stop',
			returnPct: realised + pricePnl(side, average, currentStop, activeWeight, entry),
			added,
			partial,
		} : null
		const first = intrabarOrder === 'stop-first' ? processStop() : processTargets()
		if (first != null) return first
		const second = intrabarOrder === 'stop-first' ? processTargets() : processStop()
		if (second != null) return second
	}
	const last = rows.at(-1)!
	return {
		outcome: 'End mark',
		returnPct: realised + pricePnl(side, average, last.close, activeWeight, entry),
		added,
		partial,
	}
}

const datasets = inputs.map((input) => {
	const rows = parseExactIndicatorCsv(readFileSync(input.file, 'utf8'), {
		expectedTimeframeMs: input.timeframeMinutes * 60_000,
		allowIrregularBars: true,
		allowInvalidBandOrder: true,
	})
	return { input, rows, tr55: trueRangeSma(rows, 55), hash: sha256File(input.file) }
})

const eventStudy = datasets.map(({ input, rows }) => {
	const signals = rows.map((row, index) => ({ index, side: direction(row) })).filter((item): item is { index: number; side: 1 | -1 } => item.side != null && item.index >= warmupBars)
	return {
		id: input.id,
		signals: signals.length,
		horizons: horizonsHours.map((hours, horizonIndex) => {
			const bars = Math.ceil(hours * 60 / input.timeframeMinutes)
			const metrics = signals.map(({ index, side }) => forwardMetric(rows, index, side, bars)).filter((value): value is ForwardMetric => value != null)
			const sides = signals.slice(0, metrics.length).map(({ side }) => side)
			const nullResult = bootstrapNull(rows, sides, bars, 20260803 + horizonIndex * 101 + input.timeframeMinutes)
			const actualMean = mean(metrics.map((metric) => metric.returnPct))
			const random = rng(991 + horizonIndex + input.timeframeMinutes)
			let exceed = 0
			const eligible: number[] = []
			for (let i = warmupBars; i + 1 + bars - 1 < rows.length; i++) if (validBand(rows[i]!) && validBand(rows[i + 1]!)) eligible.push(i)
			for (let b = 0; b < bootstrapSamples; b++) {
				let total = 0
				for (const side of sides) {
					const index = eligible[Math.floor(random() * eligible.length)]!
					total += forwardMetric(rows, index, side, bars)!.returnPct
				}
				if (total / sides.length >= actualMean) exceed++
			}
			nullResult.pOneSided = (exceed + 1) / (bootstrapSamples + 1)
			return {
				hours,
				bars,
				n: metrics.length,
				meanReturnPct: actualMean,
				medianReturnPct: median(metrics.map((metric) => metric.returnPct)),
				positiveRate: metrics.filter((metric) => metric.returnPct > 0).length / metrics.length,
				meanMfePct: mean(metrics.map((metric) => metric.mfePct)),
				meanMaePct: mean(metrics.map((metric) => metric.maePct)),
				null: nullResult,
			}
		}),
	}
})

const pooledEventStudy = horizonsHours.map((hours, horizonIndex) => {
	let actualSum = 0
	let actualCount = 0
	let positive = 0
	const prepared = datasets.map(({ input, rows }, datasetIndex) => {
		const bars = Math.ceil(hours * 60 / input.timeframeMinutes)
		const signals = rows
			.map((row, index) => ({ index, side: direction(row) }))
			.filter((item): item is { index: number; side: 1 | -1 } => item.side != null && item.index >= warmupBars)
			.filter(({ index }) => index + bars < rows.length)
		const metrics = signals.map(({ index, side }) => forwardMetric(rows, index, side, bars)!)
		actualSum += metrics.reduce((sum, metric) => sum + metric.returnPct, 0)
		actualCount += metrics.length
		positive += metrics.filter((metric) => metric.returnPct > 0).length
		const eligible: number[] = []
		for (let i = warmupBars; i + bars < rows.length; i++) if (validBand(rows[i]!) && validBand(rows[i + 1]!)) eligible.push(i)
		return { rows, bars, signals, eligible, seed: datasetIndex * 10_000 }
	})
	const actualMean = actualSum / actualCount
	const random = rng(440_000 + horizonIndex)
	const samples: number[] = []
	let exceed = 0
	for (let b = 0; b < bootstrapSamples; b++) {
		let sum = 0
		let count = 0
		for (const item of prepared) {
			for (const signal of item.signals) {
				const index = item.eligible[Math.floor(random() * item.eligible.length)]!
				sum += forwardMetric(item.rows, index, signal.side, item.bars)!.returnPct
				count++
			}
		}
		const sampleMean = sum / count
		samples.push(sampleMean)
		if (sampleMean >= actualMean) exceed++
	}
	samples.sort((a, b) => a - b)
	return {
		hours,
		n: actualCount,
		meanReturnPct: actualMean,
		positiveRate: positive / actualCount,
		nullMeanReturnPct: mean(samples),
		nullQ05: samples[Math.floor(samples.length * 0.05)]!,
		nullQ95: samples[Math.floor(samples.length * 0.95)]!,
		pOneSided: (exceed + 1) / (bootstrapSamples + 1),
	}
})

const stopRobustness = safeMultipliers.flatMap((safeMultiplier) => [
	{ mode: 'Safe', multiplier: safeMultiplier },
	{ mode: 'Risk', multiplier: safeMultiplier * riskScale },
]).flatMap(({ mode, multiplier }) => (['stop-first', 'target-first'] as const).flatMap((intrabarOrder) => [false, true].map((addEnabled) => {
	const perDataset = datasets.map(({ input, rows, tr55 }) => {
		const trades: TradeResult[] = []
		for (let i = warmupBars; i < rows.length; i++) {
			const side = direction(rows[i]!)
			if (side == null) continue
			const trade = simulateTrade(rows, tr55, i, side, multiplier, intrabarOrder, addEnabled)
			if (trade != null) trades.push(trade)
		}
		const returns = trades.map((trade) => trade.returnPct)
		return {
			id: input.id,
			trades: trades.length,
			fullFix: trades.filter((trade) => trade.outcome === 'Full fix').length,
			partial: trades.filter((trade) => trade.outcome === 'Partial').length,
			stop: trades.filter((trade) => trade.outcome === 'Stop').length,
			endMark: trades.filter((trade) => trade.outcome === 'End mark').length,
			vendorWinrate: trades.filter((trade) => trade.outcome === 'Full fix' || trade.outcome === 'Partial').length / trades.length,
			meanReturnPct: mean(returns),
			medianReturnPct: median(returns),
			grossProfitPct: returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0),
			grossLossPct: Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0)),
			profitFactor: profitFactor(returns),
			maxSequentialDrawdownPct: maxSequentialDrawdown(returns),
			positivePnlRate: trades.filter((trade) => trade.returnPct > 0).length / trades.length,
			addRate: trades.filter((trade) => trade.added).length / trades.length,
		}
	})
	const totals = perDataset.reduce((acc, row) => ({
		trades: acc.trades + row.trades,
		fullFix: acc.fullFix + row.fullFix,
		partial: acc.partial + row.partial,
		stop: acc.stop + row.stop,
		endMark: acc.endMark + row.endMark,
		weightedReturn: acc.weightedReturn + row.meanReturnPct * row.trades,
		weightedPositive: acc.weightedPositive + row.positivePnlRate * row.trades,
		grossProfit: acc.grossProfit + row.grossProfitPct,
		grossLoss: acc.grossLoss + row.grossLossPct,
	}), { trades: 0, fullFix: 0, partial: 0, stop: 0, endMark: 0, weightedReturn: 0, weightedPositive: 0, grossProfit: 0, grossLoss: 0 })
	return {
		mode,
		multiplier,
		intrabarOrder,
		addEnabled,
		datasets: perDataset,
		aggregate: {
			...totals,
			vendorWinrate: (totals.fullFix + totals.partial) / totals.trades,
			meanReturnPct: totals.weightedReturn / totals.trades,
			profitFactor: totals.grossLoss > 0 ? totals.grossProfit / totals.grossLoss : null,
			positivePnlRate: totals.weightedPositive / totals.trades,
		},
	}
})))

const result = {
	schemaVersion: 1,
	generatedAt: new Date().toISOString(),
	scope: 'signal-first gross audit; next-open; no fees, funding or slippage; fixed preregistered stop grid; no vendor-stop refit',
	assumptions: {
		forwardHorizonsHours: horizonsHours,
		stopBaseline: 'SMA(TrueRange,55)',
		safeMultipliers,
		riskScale,
		add: '50% initial + 50% midpoint add',
		partial: '25% of active position at moving Mean',
		breakEven: 'blended average, active next bar after partial',
		fullTarget: 'moving opposite Inner',
	},
	inputs: datasets.map(({ input, rows, hash }) => ({
		id: input.id,
		sha256: hash,
		rows: rows.length,
		buy: rows.filter((row) => row.buy).length,
		sell: rows.filter((row) => row.sell).length,
		firstUtc: new Date(rows[0]!.timestamp).toISOString(),
		lastUtc: new Date(rows.at(-1)!.timestamp).toISOString(),
	})),
	eventStudy,
	pooledEventStudy,
	stopRobustness,
}

const outDir = resolve('ci-results')
mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'ggi-signal-first-audit-v1.json'), `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify({
	inputs: result.inputs,
	eventStudy: result.eventStudy,
	pooledEventStudy: result.pooledEventStudy,
	stopRobustness: result.stopRobustness.map(({ mode, multiplier, intrabarOrder, addEnabled, aggregate }) => ({ mode, multiplier, intrabarOrder, addEnabled, aggregate })),
}, null, 2))
