import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseExactIndicatorCsv, sha256File, type ExactIndicatorRow } from './lib/exactIndicatorExport.js'

type Direction = 'long' | 'short'
type PartialTrigger = 'wick' | 'close'
type FullTrigger = 'wick' | 'close'
type FullPriority = 'full-first' | 'be-first'
type BeActivation = 'same-bar' | 'next-bar' | 'none'
type BeLevel = 'entry' | 'blended-average'
type Outcome = 'Partial' | 'Stop' | 'Full fix' | 'Unresolved'

interface DashboardCounts {
	trades: number
	partial: number
	stop: number
	fullFix: number
}

interface InputSpec {
	id: string
	file: string
	timeframeMs: number
	dashboardSafe?: DashboardCounts
	dashboardRisk?: DashboardCounts
	windowBars?: number
}

interface SemanticConfig {
	partialTrigger: PartialTrigger
	fullTrigger: FullTrigger
	fullPriority: FullPriority
	beActivation: BeActivation
	beLevel: BeLevel
}

interface StopConfig {
	name: 'safe-proxy' | 'risk-proxy'
	outerMultiplier: number
}

interface TradeLedger {
	signalIndex: number
	signalTime: string
	direction: Direction
	entryIndex: number
	entryTime: string
	entryPrice: number
	initialStop: number
	addPrice: number
	added: boolean
	averagePrice: number
	firstAddIndex: number | null
	firstMeanWickIndex: number | null
	firstMeanCloseIndex: number | null
	firstInnerWickIndex: number | null
	firstInitialStopIndex: number | null
	firstSameBarMeanInnerIndex: number | null
	firstSameBarMeanStopIndex: number | null
	partialIndex: number | null
	fullIndex: number | null
	exitIndex: number | null
	outcome: Outcome
	holdingBars: number | null
}

interface Summary {
	labels: number
	accepted: number
	closed: number
	partial: number
	stop: number
	fullFix: number
	unresolved: number
	skippedWhileActive: number
	meanHoldingBars: number | null
	timeInMarketBars: number
}

const inputs: InputSpec[] = [
	{
		id: 'btc-15m',
		file: 'C:/Users/Никита/Downloads/BYBIT_BTCUSDT.P, 15.csv',
		timeframeMs: 900_000,
		dashboardSafe: { trades: 85, partial: 24, stop: 17, fullFix: 44 },
	},
	{
		id: 'btc-5m',
		file: 'C:/Users/Никита/Downloads/BYBIT_BTCUSDT.P, 5.csv',
		timeframeMs: 300_000,
		windowBars: 20_000,
		dashboardSafe: { trades: 84, partial: 30, stop: 13, fullFix: 41 },
		dashboardRisk: { trades: 89, partial: 34, stop: 20, fullFix: 35 },
	},
	{
		id: 'eth-5m',
		file: 'C:/Users/Никита/Downloads/BYBIT_ETHUSDT.P, 5.csv',
		timeframeMs: 300_000,
		windowBars: 20_000,
		dashboardSafe: { trades: 74, partial: 24, stop: 14, fullFix: 36 },
		dashboardRisk: { trades: 81, partial: 30, stop: 17, fullFix: 34 },
	},
	{
		id: 'sol-5m',
		file: 'C:/Users/Никита/Downloads/BYBIT_SOLUSDT.P, 5.csv',
		timeframeMs: 300_000,
		windowBars: 20_000,
		dashboardSafe: { trades: 76, partial: 24, stop: 14, fullFix: 38 },
		dashboardRisk: { trades: 79, partial: 29, stop: 16, fullFix: 34 },
	},
	{
		id: 'xrp-5m',
		file: 'C:/Users/Никита/Downloads/BYBIT_XRPUSDT.P, 5.csv',
		timeframeMs: 300_000,
		windowBars: 20_000,
		dashboardSafe: { trades: 78, partial: 27, stop: 11, fullFix: 40 },
		dashboardRisk: { trades: 81, partial: 29, stop: 18, fullFix: 34 },
	},
	{
		id: 'bnb-5m',
		file: 'C:/Users/Никита/Downloads/BYBIT_BNBUSDT.P, 5.csv',
		timeframeMs: 300_000,
		windowBars: 20_000,
		dashboardSafe: { trades: 99, partial: 26, stop: 14, fullFix: 59 },
		dashboardRisk: { trades: 100, partial: 28, stop: 26, fullFix: 46 },
	},
]

const semanticConfigs: SemanticConfig[] = []
for (const partialTrigger of ['wick', 'close'] as const) {
	for (const fullTrigger of ['wick', 'close'] as const) {
		for (const fullPriority of ['full-first', 'be-first'] as const) {
			for (const beActivation of ['same-bar', 'next-bar'] as const) {
				for (const beLevel of ['entry', 'blended-average'] as const) {
					semanticConfigs.push({ partialTrigger, fullTrigger, fullPriority, beActivation, beLevel })
				}
			}
		}
	}
}
for (const partialTrigger of ['wick', 'close'] as const) {
	for (const fullTrigger of ['wick', 'close'] as const) {
		for (const fullPriority of ['full-first', 'be-first'] as const) {
			semanticConfigs.push({ partialTrigger, fullTrigger, fullPriority, beActivation: 'none', beLevel: 'entry' })
		}
	}
}

const stopConfigs: StopConfig[] = [
	{ name: 'safe-proxy', outerMultiplier: 1.5 },
	{ name: 'risk-proxy', outerMultiplier: 1.5 * 0.694 },
]

function validBand(row: ExactIndicatorRow): boolean {
	return row.lowerOuter < row.lowerInner && row.lowerInner < row.mean && row.mean < row.upperInner && row.upperInner < row.upperOuter
}

function directionFor(row: ExactIndicatorRow): Direction | null {
	if (row.buy) return 'long'
	if (row.sell) return 'short'
	return null
}

function reached(direction: Direction, row: ExactIndicatorRow, level: number): boolean {
	return direction === 'long' ? row.high >= level : row.low <= level
}

function closeReached(direction: Direction, row: ExactIndicatorRow, level: number): boolean {
	return direction === 'long' ? row.close >= level : row.close <= level
}

function adverseReached(direction: Direction, row: ExactIndicatorRow, level: number): boolean {
	return direction === 'long' ? row.low <= level : row.high >= level
}

function iso(rows: readonly ExactIndicatorRow[], index: number | null): string | null {
	return index == null ? null : new Date(rows[index]!.timestamp).toISOString()
}

function simulateTrade(
	rows: readonly ExactIndicatorRow[],
	signalIndex: number,
	semantic: SemanticConfig,
	stopConfig: StopConfig,
): TradeLedger | null {
	const signal = rows[signalIndex]
	if (signal == null || !validBand(signal)) return null
	const direction = directionFor(signal)
	if (direction == null) return null
	const entryIndex = signalIndex + 1
	const entryRow = rows[entryIndex]
	if (entryRow == null || !validBand(entryRow)) return null
	const entryPrice = entryRow.open
	const oppositeOuter = direction === 'long' ? entryRow.lowerOuter : entryRow.upperOuter
	const initialStop = entryPrice + (oppositeOuter - entryPrice) * stopConfig.outerMultiplier
	if ((direction === 'long' && initialStop >= entryPrice) || (direction === 'short' && initialStop <= entryPrice)) return null
	const addPrice = (entryPrice + initialStop) / 2
	let added = false
	let averagePrice = entryPrice
	let firstAddIndex: number | null = null
	let firstMeanWickIndex: number | null = null
	let firstMeanCloseIndex: number | null = null
	let firstInnerWickIndex: number | null = null
	let firstInitialStopIndex: number | null = null
	let firstSameBarMeanInnerIndex: number | null = null
	let firstSameBarMeanStopIndex: number | null = null
	let partialIndex: number | null = null
	let fullIndex: number | null = null
	let exitIndex: number | null = null
	let outcome: Outcome = 'Unresolved'
	let beActiveFrom: number | null = null

	for (let i = entryIndex; i < rows.length && i < entryIndex + 2_000; i++) {
		const row = rows[i]!
		if (!validBand(row)) continue
		const meanWick = reached(direction, row, row.mean)
		const meanClose = closeReached(direction, row, row.mean)
		const partialHit = semantic.partialTrigger === 'wick' ? meanWick : meanClose
		const fullTarget = direction === 'long' ? row.upperInner : row.lowerInner
		const fullWick = reached(direction, row, fullTarget)
		const fullClose = closeReached(direction, row, fullTarget)
		const fullHit = semantic.fullTrigger === 'wick' ? fullWick : fullClose
		const initialStopHit = adverseReached(direction, row, initialStop)
		const addHit = adverseReached(direction, row, addPrice)
		if (meanWick && firstMeanWickIndex == null) firstMeanWickIndex = i
		if (meanClose && firstMeanCloseIndex == null) firstMeanCloseIndex = i
		if (fullWick && firstInnerWickIndex == null) firstInnerWickIndex = i
		if (initialStopHit && firstInitialStopIndex == null) firstInitialStopIndex = i
		if (meanWick && fullWick && firstSameBarMeanInnerIndex == null) firstSameBarMeanInnerIndex = i
		if (meanWick && initialStopHit && firstSameBarMeanStopIndex == null) firstSameBarMeanStopIndex = i

		if (!added && addHit) {
			added = true
			averagePrice = (entryPrice + addPrice) / 2
			firstAddIndex = i
		}

		const beLevel = semantic.beLevel === 'entry' ? entryPrice : averagePrice
		const beIsActive = partialIndex != null && semantic.beActivation !== 'none' && beActiveFrom != null && i >= beActiveFrom
		const activeStop = beIsActive ? beLevel : initialStop
		const stopHitAtBarStart = adverseReached(direction, row, activeStop)

		if (partialIndex != null) {
			if (semantic.fullPriority === 'full-first' && fullHit) {
				fullIndex = i
				exitIndex = i
				outcome = 'Full fix'
				break
			}
			if (stopHitAtBarStart) {
				exitIndex = i
				outcome = 'Partial'
				break
			}
			if (fullHit) {
				fullIndex = i
				exitIndex = i
				outcome = 'Full fix'
				break
			}
			continue
		}

		// Before Partial, preserve the prior reconciliation's conservative initial-stop priority.
		if (initialStopHit) {
			exitIndex = i
			outcome = 'Stop'
			break
		}
		if (semantic.fullPriority === 'full-first' && fullHit) {
			fullIndex = i
			exitIndex = i
			outcome = 'Full fix'
			break
		}
		if (partialHit) {
			partialIndex = i
			beActiveFrom = semantic.beActivation === 'same-bar'
				? i
				: semantic.beActivation === 'next-bar' ? i + 1 : null
			if (fullHit && semantic.fullPriority === 'be-first') {
				const sameBarBeActive = semantic.beActivation === 'same-bar'
				if (sameBarBeActive && adverseReached(direction, row, beLevel)) {
					exitIndex = i
					outcome = 'Partial'
					break
				}
				fullIndex = i
				exitIndex = i
				outcome = 'Full fix'
				break
			}
			if (semantic.beActivation === 'same-bar' && adverseReached(direction, row, beLevel)) {
				exitIndex = i
				outcome = 'Partial'
				break
			}
			continue
		}
		if (fullHit) {
			fullIndex = i
			exitIndex = i
			outcome = 'Full fix'
			break
		}
	}

	return {
		signalIndex,
		signalTime: new Date(signal.timestamp).toISOString(),
		direction,
		entryIndex,
		entryTime: new Date(entryRow.timestamp).toISOString(),
		entryPrice,
		initialStop,
		addPrice,
		added,
		averagePrice,
		firstAddIndex,
		firstMeanWickIndex,
		firstMeanCloseIndex,
		firstInnerWickIndex,
		firstInitialStopIndex,
		firstSameBarMeanInnerIndex,
		firstSameBarMeanStopIndex,
		partialIndex,
		fullIndex,
		exitIndex,
		outcome,
		holdingBars: exitIndex == null ? null : exitIndex - entryIndex + 1,
	}
}

function summarize(labels: number, trades: readonly TradeLedger[], skippedWhileActive = 0): Summary {
	const closed = trades.filter((trade) => trade.outcome !== 'Unresolved')
	const holding = closed.flatMap((trade) => trade.holdingBars == null ? [] : [trade.holdingBars])
	return {
		labels,
		accepted: trades.length,
		closed: closed.length,
		partial: closed.filter((trade) => trade.outcome === 'Partial').length,
		stop: closed.filter((trade) => trade.outcome === 'Stop').length,
		fullFix: closed.filter((trade) => trade.outcome === 'Full fix').length,
		unresolved: trades.filter((trade) => trade.outcome === 'Unresolved').length,
		skippedWhileActive,
		meanHoldingBars: holding.length === 0 ? null : holding.reduce((sum, value) => sum + value, 0) / holding.length,
		timeInMarketBars: holding.reduce((sum, value) => sum + value, 0),
	}
}

function simulateAll(rows: readonly ExactIndicatorRow[], semantic: SemanticConfig, stopConfig: StopConfig): { trades: TradeLedger[]; summary: Summary } {
	const labelIndices = rows.flatMap((row, index) => row.buy || row.sell ? [index] : [])
	const trades = labelIndices.flatMap((index) => {
		const trade = simulateTrade(rows, index, semantic, stopConfig)
		return trade == null ? [] : [trade]
	})
	return { trades, summary: summarize(labelIndices.length, trades) }
}

function simulateSequential(rows: readonly ExactIndicatorRow[], semantic: SemanticConfig, stopConfig: StopConfig): { trades: TradeLedger[]; summary: Summary } {
	const labelIndices = rows.flatMap((row, index) => row.buy || row.sell ? [index] : [])
	const trades: TradeLedger[] = []
	let activeUntil = -1
	let skipped = 0
	for (const index of labelIndices) {
		if (index <= activeUntil) {
			skipped++
			continue
		}
		const trade = simulateTrade(rows, index, semantic, stopConfig)
		if (trade == null) continue
		trades.push(trade)
		activeUntil = trade.exitIndex ?? rows.length - 1
	}
	return { trades, summary: summarize(labelIndices.length, trades, skipped) }
}

function countDistance(summary: Summary, dashboard: DashboardCounts): number {
	return Math.abs(summary.closed - dashboard.trades) * 10
		+ Math.abs(summary.partial - dashboard.partial)
		+ Math.abs(summary.stop - dashboard.stop)
		+ Math.abs(summary.fullFix - dashboard.fullFix)
}

function configKey(config: SemanticConfig): string {
	return `${config.partialTrigger}|${config.fullTrigger}|${config.fullPriority}|${config.beActivation}|${config.beLevel}`
}

const datasets = inputs.map((input) => {
	const parsed = parseExactIndicatorCsv(readFileSync(input.file, 'utf8'), {
		expectedTimeframeMs: input.timeframeMs,
		allowIrregularBars: true,
		allowInvalidBandOrder: true,
	})
	const rows = input.windowBars == null ? parsed : parsed.slice(-input.windowBars)
	return { input, rows, fullRows: parsed.length, hash: sha256File(input.file) }
})

const btc15 = datasets.find((dataset) => dataset.input.id === 'btc-15m')!
const btcTarget = btc15.input.dashboardSafe!
const btcGrid = semanticConfigs.map((semantic) => {
	const independent = simulateAll(btc15.rows, semantic, stopConfigs[0]!)
	const sequential = simulateSequential(btc15.rows, semantic, stopConfigs[0]!)
	return {
		semantic,
		key: configKey(semantic),
		independent: independent.summary,
		sequential: sequential.summary,
		independentDistance: countDistance(independent.summary, btcTarget),
		sequentialDistance: countDistance(sequential.summary, btcTarget),
	}
}).sort((a, b) => a.independentDistance - b.independentDistance || a.sequentialDistance - b.sequentialDistance)

const bestSemantic = btcGrid[0]!.semantic
const btcBest = simulateAll(btc15.rows, bestSemantic, stopConfigs[0]!)
const btcLedger = btcBest.trades.map((trade) => ({
	...trade,
	firstAddTime: iso(btc15.rows, trade.firstAddIndex),
	firstMeanWickTime: iso(btc15.rows, trade.firstMeanWickIndex),
	firstMeanCloseTime: iso(btc15.rows, trade.firstMeanCloseIndex),
	firstInnerWickTime: iso(btc15.rows, trade.firstInnerWickIndex),
	firstInitialStopTime: iso(btc15.rows, trade.firstInitialStopIndex),
	firstSameBarMeanInnerTime: iso(btc15.rows, trade.firstSameBarMeanInnerIndex),
	firstSameBarMeanStopTime: iso(btc15.rows, trade.firstSameBarMeanStopIndex),
	partialTime: iso(btc15.rows, trade.partialIndex),
	fullTime: iso(btc15.rows, trade.fullIndex),
	exitTime: iso(btc15.rows, trade.exitIndex),
}))

const fiveMinuteTransfer = datasets.filter((dataset) => dataset.input.id.endsWith('-5m')).map(({ input, rows, fullRows, hash }) => {
	const modes = stopConfigs.map((stopConfig) => {
		const dashboard = stopConfig.name === 'safe-proxy' ? input.dashboardSafe! : input.dashboardRisk!
		const independent = simulateAll(rows, bestSemantic, stopConfig)
		const sequential = simulateSequential(rows, bestSemantic, stopConfig)
		return {
			mode: stopConfig.name,
			stopConfig,
			dashboard,
			independent: independent.summary,
			sequential: sequential.summary,
			independentDistance: countDistance(independent.summary, dashboard),
			sequentialDistance: countDistance(sequential.summary, dashboard),
		}
	})
	return {
		id: input.id,
		file: input.file,
		sha256: hash,
		fullRows,
		windowRows: rows.length,
		firstWindowUtc: new Date(rows[0]!.timestamp).toISOString(),
		lastWindowUtc: new Date(rows.at(-1)!.timestamp).toISOString(),
		labels: rows.filter((row) => row.buy || row.sell).length,
		modes,
	}
})

const result = {
	schemaVersion: 1,
	generatedAt: new Date().toISOString(),
	scope: 'causal GGI terminal-state fidelity test; fixed outer-band stop proxy; no stop refit; no fees, funding or slippage',
	semanticGridDefinition: {
		partialTrigger: ['wick', 'close'],
		fullTrigger: ['wick', 'close'],
		fullPriority: ['full-first', 'be-first'],
		beActivation: ['same-bar', 'next-bar', 'none'],
		beLevel: ['entry', 'blended-average'],
		initialStopPriority: 'stop-first (frozen from prior BTC 15m reconciliation)',
		fullTriggerRule: 'wick or close crossing of moving opposite Inner (tested grid)',
		add: '50/50 midpoint before stop; blended average=(entry+add)/2',
	},
	stopConfigs,
	btc15: {
		input: btc15.input,
		sha256: btc15.hash,
		rows: btc15.rows.length,
		labels: btc15.rows.filter((row) => row.buy || row.sell).length,
		target: btcTarget,
		grid: btcGrid,
		selectedSemantic: bestSemantic,
		selectedSummary: btcBest.summary,
		ledger: btcLedger,
	},
	fiveMinuteTransfer,
}

const outDir = resolve('ci-results')
mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'ggi-state-machine-fidelity-v1.json'), `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify({
	btcTarget,
	best: btcGrid.slice(0, 10),
	selectedSemantic: bestSemantic,
	fiveMinuteTransfer: fiveMinuteTransfer.map((dataset) => ({ id: dataset.id, labels: dataset.labels, modes: dataset.modes })),
}, null, 2))
