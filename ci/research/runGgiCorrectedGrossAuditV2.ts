import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseExactIndicatorCsv, sha256File, type ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import {
	applyOneWayCostBps,
	collectCorrectedGgiTrades,
	trueRangeSma,
	type CorrectedGgiBeBound,
	type CorrectedGgiTrade,
} from './lib/ggiCorrectedReplay.js'

interface InputSpec {
	id: string
	asset: string
	file: string
	timeframeMinutes: number
	group: 'reference' | 'holdout' | 'low-tf' | 'five-minute'
	windowBars?: number
}

const inputs: InputSpec[] = [
	{ id: 'btc-2h', asset: 'BTC', file: 'C:/Users/Никита/Downloads/BYBIT_BTCUSDT.P, 120.csv', timeframeMinutes: 120, group: 'reference' },
	{ id: 'btc-1h', asset: 'BTC', file: 'C:/Users/Никита/Downloads/BYBIT_BTCUSDT.P, 60.csv', timeframeMinutes: 60, group: 'reference' },
	{ id: 'btc-15m', asset: 'BTC', file: 'C:/Users/Никита/Downloads/BYBIT_BTCUSDT.P, 15.csv', timeframeMinutes: 15, group: 'reference' },
	{ id: 'ondo-2h', asset: 'ONDO', file: 'C:/Users/Никита/Downloads/BYBIT_ONDOUSDT.P, 120.csv', timeframeMinutes: 120, group: 'reference' },
	{ id: 'ondo-1h', asset: 'ONDO', file: 'C:/Users/Никита/Downloads/BYBIT_ONDOUSDT.P, 60.csv', timeframeMinutes: 60, group: 'reference' },
	{ id: 'ondo-15m', asset: 'ONDO', file: 'C:/Users/Никита/Downloads/BYBIT_ONDOUSDT.P, 15.csv', timeframeMinutes: 15, group: 'reference' },
	{ id: 'eth-2h', asset: 'ETH', file: 'C:/Users/Никита/Downloads/BYBIT_ETHUSDT.P, 120.csv', timeframeMinutes: 120, group: 'holdout' },
	{ id: 'eth-1h', asset: 'ETH', file: 'C:/Users/Никита/Downloads/BYBIT_ETHUSDT.P, 60.csv', timeframeMinutes: 60, group: 'holdout' },
	{ id: 'sol-2h', asset: 'SOL', file: 'C:/Users/Никита/Downloads/BYBIT_SOLUSDT.P, 120.csv', timeframeMinutes: 120, group: 'holdout' },
	{ id: 'sol-1h', asset: 'SOL', file: 'C:/Users/Никита/Downloads/BYBIT_SOLUSDT.P, 60.csv', timeframeMinutes: 60, group: 'holdout' },
	{ id: 'xrp-2h', asset: 'XRP', file: 'C:/Users/Никита/Downloads/BYBIT_XRPUSDT.P, 120.csv', timeframeMinutes: 120, group: 'holdout' },
	{ id: 'xrp-1h', asset: 'XRP', file: 'C:/Users/Никита/Downloads/BYBIT_XRPUSDT.P, 60.csv', timeframeMinutes: 60, group: 'holdout' },
	{ id: 'aave-2h', asset: 'AAVE', file: 'C:/Users/Никита/Downloads/BYBIT_AAVEUSDT.P, 120 (1).csv', timeframeMinutes: 120, group: 'holdout' },
	{ id: 'aave-1h', asset: 'AAVE', file: 'C:/Users/Никита/Downloads/BYBIT_AAVEUSDT.P, 60.csv', timeframeMinutes: 60, group: 'holdout' },
	{ id: 'bnb-2h', asset: 'BNB', file: 'C:/Users/Никита/Downloads/BYBIT_BNBUSDT.P, 120.csv', timeframeMinutes: 120, group: 'holdout' },
	{ id: 'bnb-1h', asset: 'BNB', file: 'C:/Users/Никита/Downloads/BYBIT_BNBUSDT.P, 60.csv', timeframeMinutes: 60, group: 'holdout' },
	{ id: 'bnb-3m', asset: 'BNB', file: 'C:/Users/Никита/Downloads/BYBIT_BNBUSDT.P, 3.csv', timeframeMinutes: 3, group: 'low-tf' },
	{ id: 'sp500-1m', asset: 'SP500', file: 'C:/Users/Никита/Downloads/VANTAGE_SP500, 1.csv', timeframeMinutes: 1, group: 'low-tf' },
	{ id: 'btc-5m', asset: 'BTC', file: 'C:/Users/Никита/Downloads/BYBIT_BTCUSDT.P, 5.csv', timeframeMinutes: 5, group: 'five-minute', windowBars: 20_000 },
	{ id: 'eth-5m', asset: 'ETH', file: 'C:/Users/Никита/Downloads/BYBIT_ETHUSDT.P, 5.csv', timeframeMinutes: 5, group: 'five-minute', windowBars: 20_000 },
	{ id: 'sol-5m', asset: 'SOL', file: 'C:/Users/Никита/Downloads/BYBIT_SOLUSDT.P, 5.csv', timeframeMinutes: 5, group: 'five-minute', windowBars: 20_000 },
	{ id: 'xrp-5m', asset: 'XRP', file: 'C:/Users/Никита/Downloads/BYBIT_XRPUSDT.P, 5.csv', timeframeMinutes: 5, group: 'five-minute', windowBars: 20_000 },
	{ id: 'bnb-5m', asset: 'BNB', file: 'C:/Users/Никита/Downloads/BYBIT_BNBUSDT.P, 5.csv', timeframeMinutes: 5, group: 'five-minute', windowBars: 20_000 },
]

const safeMultipliers = [8, 10, 12, 14, 16]
const riskScale = 0.694
const beBounds: CorrectedGgiBeBound[] = [
	'optimistic-initial-stop',
	'next-bar-blended-be',
	'next-bar-entry-be',
]
const costTiersBps = { gross: 0, low: 3, base: 6, stressed: 10 } as const
const warmupBars = 100
const bootstrapSamples = 2_000

function mean(values: readonly number[]): number {
	return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function median(values: readonly number[]): number | null {
	if (values.length === 0) return null
	const sorted = [...values].sort((a, b) => a - b)
	const middle = Math.floor(sorted.length / 2)
	return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
}

function quantile(values: readonly number[], p: number): number | null {
	if (values.length === 0) return null
	const sorted = [...values].sort((a, b) => a - b)
	return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!
}

function profitFactor(values: readonly number[]): number | null {
	const profit = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
	const loss = Math.abs(values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0))
	return loss > 0 ? profit / loss : profit > 0 ? Number.POSITIVE_INFINITY : null
}

function maxDrawdown(values: readonly number[]): number {
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

function rng(seed: number): () => number {
	let state = seed >>> 0
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0
		return state / 0x1_0000_0000
	}
}

function monthlyBlocks(trades: readonly CorrectedGgiTrade[]): CorrectedGgiTrade[][] {
	const map = new Map<string, CorrectedGgiTrade[]>()
	for (const trade of trades) {
		const date = new Date(trade.signalTimestamp)
		const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
		const block = map.get(key) ?? []
		block.push(trade)
		map.set(key, block)
	}
	return [...map.values()]
}

function blockBootstrapMean(trades: readonly CorrectedGgiTrade[], seed: number): { q05: number | null; median: number | null; q95: number | null } {
	const blocks = monthlyBlocks(trades)
	if (blocks.length === 0) return { q05: null, median: null, q95: null }
	const random = rng(seed)
	const samples: number[] = []
	for (let sample = 0; sample < bootstrapSamples; sample++) {
		const values: number[] = []
		for (let i = 0; i < blocks.length; i++) {
			const block = blocks[Math.floor(random() * blocks.length)]!
			values.push(...block.map((trade) => trade.grossR))
		}
		samples.push(mean(values))
	}
	return { q05: quantile(samples, 0.05), median: quantile(samples, 0.5), q95: quantile(samples, 0.95) }
}

function summarize(trades: readonly CorrectedGgiTrade[], timeframeMinutes: number) {
	const grossPct = trades.map((trade) => trade.grossReturnPct)
	const grossR = trades.map((trade) => trade.grossR)
	const closed = trades.filter((trade) => trade.outcome !== 'End mark')
	const totalHoldingBars = trades.reduce((sum, trade) => sum + trade.holdingBars, 0)
	return {
		trades: trades.length,
		fullFix: trades.filter((trade) => trade.outcome === 'Full fix').length,
		partial: trades.filter((trade) => trade.outcome === 'Partial').length,
		stop: trades.filter((trade) => trade.outcome === 'Stop').length,
		endMark: trades.filter((trade) => trade.outcome === 'End mark').length,
		vendorWinrate: closed.length === 0 ? null : closed.filter((trade) => trade.outcome !== 'Stop').length / closed.length,
		meanGrossPct: mean(grossPct),
		medianGrossPct: median(grossPct),
		meanGrossR: mean(grossR),
		medianGrossR: median(grossR),
		q05GrossR: quantile(grossR, 0.05),
		q95GrossR: quantile(grossR, 0.95),
		profitFactorR: profitFactor(grossR),
		maxSequentialDrawdownR: maxDrawdown(grossR),
		positiveRate: grossR.filter((value) => value > 0).length / Math.max(1, grossR.length),
		addRate: trades.filter((trade) => trade.added).length / Math.max(1, trades.length),
		meanHoldingBars: mean(trades.map((trade) => trade.holdingBars)),
		meanHoldingHours: mean(trades.map((trade) => trade.holdingBars * timeframeMinutes / 60)),
		timeInMarketBars: totalHoldingBars,
		longMeanR: mean(trades.filter((trade) => trade.side === 1).map((trade) => trade.grossR)),
		shortMeanR: mean(trades.filter((trade) => trade.side === -1).map((trade) => trade.grossR)),
		meanTurnover: mean(trades.map((trade) => trade.turnover)),
		breakEvenOneWayCostBps: trades.reduce((sum, trade) => sum + trade.turnover, 0) > 0
			? trades.reduce((sum, trade) => sum + trade.grossReturnPct, 0) / trades.reduce((sum, trade) => sum + trade.turnover, 0) * 100
			: null,
		costTiers: Object.entries(costTiersBps).map(([tier, oneWayCostBps]) => {
			const netR = trades.map((trade) => applyOneWayCostBps(trade, oneWayCostBps).netR)
			return { tier, oneWayCostBps, meanNetR: mean(netR), profitFactorNetR: profitFactor(netR), positiveRate: netR.filter((value) => value > 0).length / Math.max(1, netR.length) }
		}),
	}
}

const datasets = inputs.map((input) => {
	const parsed = parseExactIndicatorCsv(readFileSync(input.file, 'utf8'), {
		expectedTimeframeMs: input.timeframeMinutes * 60_000,
		allowIrregularBars: true,
		allowInvalidBandOrder: true,
	})
	const rows = input.windowBars == null ? parsed : parsed.slice(-input.windowBars)
	return { input, rows, tr55: trueRangeSma(rows, 55), hash: sha256File(input.file), fullRows: parsed.length }
})

const cells = safeMultipliers.flatMap((safeMultiplier) => [
	{ mode: 'Safe' as const, multiplier: safeMultiplier },
	{ mode: 'Risk' as const, multiplier: safeMultiplier * riskScale },
]).flatMap(({ mode, multiplier }) => beBounds.flatMap((beBound) => [false, true].map((addEnabled) => {
	const perDataset = datasets.map(({ input, rows, tr55 }) => {
		const trades = collectCorrectedGgiTrades(rows, tr55, { stopMultiplier: multiplier, beBound, addEnabled }, warmupBars)
		return { id: input.id, asset: input.asset, group: input.group, timeframeMinutes: input.timeframeMinutes, tradesRaw: trades, ...summarize(trades, input.timeframeMinutes) }
	})
	const aggregateTrades = perDataset.flatMap((dataset) => dataset.tradesRaw)
	const byTimeframe = [...new Set(perDataset.map((dataset) => dataset.timeframeMinutes))].map((timeframeMinutes) => {
		const subset = perDataset.filter((dataset) => dataset.timeframeMinutes === timeframeMinutes)
		const trades = subset.flatMap((dataset) => dataset.tradesRaw)
		return {
			timeframeMinutes,
			datasets: subset.length,
			equalDatasetMeanR: mean(subset.map((dataset) => dataset.meanGrossR)),
			...summarize(trades, timeframeMinutes),
		}
	})
	const holdout = perDataset.filter((dataset) => dataset.group === 'holdout')
	const holdoutTrades = holdout.flatMap((dataset) => dataset.tradesRaw)
	const holdoutAssets = [...new Set(holdout.map((dataset) => dataset.asset))]
	const leaveOneAssetOut = holdoutAssets.map((excludedAsset) => {
		const kept = holdout.filter((dataset) => dataset.asset !== excludedAsset)
		const trades = kept.flatMap((dataset) => dataset.tradesRaw)
		return {
			excludedAsset,
			equalDatasetMeanR: mean(kept.map((dataset) => dataset.meanGrossR)),
			profitFactorR: profitFactor(trades.map((trade) => trade.grossR)),
		}
	})
	return {
		mode,
		multiplier,
		beBound,
		addEnabled,
		datasets: perDataset.map(({ tradesRaw: _tradesRaw, ...dataset }) => dataset),
		aggregate: {
			...summarize(aggregateTrades, 0),
			equalDatasetMeanR: mean(perDataset.map((dataset) => dataset.meanGrossR)),
			blockBootstrapMeanR: blockBootstrapMean(aggregateTrades, 2_026_080_400 + Math.round(multiplier * 1_000) + (addEnabled ? 7 : 0)),
		},
		holdout: {
			...summarize(holdoutTrades, 0),
			equalDatasetMeanR: mean(holdout.map((dataset) => dataset.meanGrossR)),
			blockBootstrapMeanR: blockBootstrapMean(holdoutTrades, 9_001 + Math.round(multiplier * 100) + (addEnabled ? 13 : 0)),
			leaveOneAssetOut,
		},
		byTimeframe,
	}
})))

const result = {
	schemaVersion: 2,
	generatedAt: new Date().toISOString(),
	scope: 'corrected gross/net GGI audit; common Shapes; next-open; Mean wick Partial; Inner close Full; no duplicate non-overlap; no stop selection on holdout',
	protocol: {
		safeMultipliers,
		riskScale,
		beBounds,
		add: '50% initial + 50% midpoint; grossR normalized by planned stop risk (0.75 stop-distance exposure with add)',
		costTiersBps,
		partial: '25% of active position at moving Mean wick',
		full: 'close beyond moving opposite Inner',
		intrabar: 'adverse stop wick first',
	},
	inputs: datasets.map(({ input, rows, hash, fullRows }) => ({
		...input,
		sha256: hash,
		fullRows,
		windowRows: rows.length,
		buy: rows.filter((row) => row.buy).length,
		sell: rows.filter((row) => row.sell).length,
		firstUtc: new Date(rows[0]!.timestamp).toISOString(),
		lastUtc: new Date(rows.at(-1)!.timestamp).toISOString(),
	})),
	cells,
}

const outDir = resolve('ci-results')
mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'ggi-corrected-gross-audit-v2.json'), `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify({
	inputs: result.inputs.length,
	cells: result.cells.length,
	holdout: result.cells.map((cell) => ({
		mode: cell.mode,
		multiplier: cell.multiplier,
		beBound: cell.beBound,
		addEnabled: cell.addEnabled,
		meanR: cell.holdout.equalDatasetMeanR,
		pf: cell.holdout.profitFactorR,
		q05: cell.holdout.blockBootstrapMeanR.q05,
		baseNetR: cell.holdout.costTiers.find((tier) => tier.tier === 'base')?.meanNetR,
	})),
}, null, 2))
