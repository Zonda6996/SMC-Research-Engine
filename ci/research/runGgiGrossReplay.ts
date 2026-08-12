import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseExactIndicatorCsv, sha256File } from './lib/exactIndicatorExport.js'
import {
	collectGgiGrossTrades,
	DEFAULT_GGI_GROSS_REPLAY_CONFIG,
	summarizeGgiGrossTrades,
	type GgiEntryTiming,
	type GgiGrossReplayConfig,
	type GgiIntrabarOrder,
	type GgiStopFamily,
} from './lib/ggiGrossReplay.js'

interface InputSpec {
	id: string
	file: string
	timeframeMs: number
	market: 'continuous' | 'session'
	dashboard?: { trades: number; winrate: number; partial: number; stop: number; fullFix: number }
}

const inputs: InputSpec[] = [
	{ id: 'btc-2h', file: 'C:/Users/Никита/Downloads/BYBIT_BTCUSDT.P, 120.csv', timeframeMs: 7_200_000, market: 'continuous' },
	{ id: 'btc-1h', file: 'C:/Users/Никита/Downloads/BYBIT_BTCUSDT.P, 60.csv', timeframeMs: 3_600_000, market: 'continuous' },
	{ id: 'btc-15m', file: 'C:/Users/Никита/Downloads/BYBIT_BTCUSDT.P, 15.csv', timeframeMs: 900_000, market: 'continuous', dashboard: { trades: 85, winrate: 0.8, partial: 24, stop: 17, fullFix: 44 } },
	{ id: 'ondo-2h', file: 'C:/Users/Никита/Downloads/BYBIT_ONDOUSDT.P, 120.csv', timeframeMs: 7_200_000, market: 'continuous' },
	{ id: 'ondo-1h', file: 'C:/Users/Никита/Downloads/BYBIT_ONDOUSDT.P, 60.csv', timeframeMs: 3_600_000, market: 'continuous' },
	{ id: 'ondo-15m', file: 'C:/Users/Никита/Downloads/BYBIT_ONDOUSDT.P, 15.csv', timeframeMs: 900_000, market: 'continuous' },
	{ id: 'bnb-3m', file: 'C:/Users/Никита/Downloads/BYBIT_BNBUSDT.P, 3.csv', timeframeMs: 180_000, market: 'continuous' },
	{ id: 'sp500-1m', file: 'C:/Users/Никита/Downloads/VANTAGE_SP500, 1.csv', timeframeMs: 60_000, market: 'session' },
]

const entryTimings: GgiEntryTiming[] = ['next-open', 'signal-close']
const intrabarOrders: GgiIntrabarOrder[] = ['stop-first', 'target-first']
const stopFamilies: GgiStopFamily[] = ['atr', 'outer-band', 'inner-band', 'swing', 'atr-plus-outer', 'atr-plus-swing']
const multipliers: Record<GgiStopFamily, number[]> = {
	atr: [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3],
	'outer-band': [0.5, 0.75, 1, 1.1, 1.2, 1.25, 1.3, 1.4, 1.5, 1.75, 2],
	'inner-band': [0.5, 0.75, 1, 1.25, 1.5, 2],
	swing: [1],
	'atr-plus-outer': [0.25, 0.5, 0.75, 1, 1.5, 2, 3],
	'atr-plus-swing': [0.25, 0.5, 0.75, 1, 1.5, 2, 3],
}

function dashboardDistance(summary: ReturnType<typeof summarizeGgiGrossTrades>, dashboard: NonNullable<InputSpec['dashboard']>): number {
	return Math.abs(summary.trades - dashboard.trades) * 10
		+ Math.abs(summary.partial - dashboard.partial)
		+ Math.abs(summary.stop - dashboard.stop)
		+ Math.abs(summary.fullFix - dashboard.fullFix)
		+ Math.abs((summary.winrate ?? 0) - dashboard.winrate) * dashboard.trades
}

const datasets = inputs.map((input) => {
	const rows = parseExactIndicatorCsv(readFileSync(input.file, 'utf8'), {
		expectedTimeframeMs: input.timeframeMs,
		allowIrregularBars: true,
		allowInvalidBandOrder: true,
	})
	return { input, rows, hash: sha256File(input.file) }
})

const candidateConfigs: GgiGrossReplayConfig[] = []
for (const entryTiming of entryTimings) {
	for (const intrabarOrder of intrabarOrders) {
		for (const stopFamily of stopFamilies) {
			for (const multiplier of multipliers[stopFamily]) {
				for (const addEnabled of [false, true]) {
					for (const breakEvenAfterPartial of [true, false]) {
						candidateConfigs.push({
							...DEFAULT_GGI_GROSS_REPLAY_CONFIG,
							entryTiming,
							intrabarOrder,
							stopFamily,
							stopMultiplier: multiplier,
							atrMultiplier: multiplier,
							addEnabled,
							breakEvenAfterPartial,
						})
					}
				}
			}
		}
	}
}

const known = datasets.find((dataset) => dataset.input.dashboard != null)!
const ranked = candidateConfigs.map((config) => {
	const trades = collectGgiGrossTrades(known.rows, config)
	const summary = summarizeGgiGrossTrades(trades, config)
	return { distance: dashboardDistance(summary, known.input.dashboard!), summary }
}).sort((a, b) => a.distance - b.distance)

const selectedKeys = new Set<string>()
const selected: GgiGrossReplayConfig[] = []
for (const result of ranked) {
	const key = `${result.summary.config.stopFamily}:${result.summary.config.entryTiming}:${result.summary.config.intrabarOrder}:${result.summary.config.addEnabled}`
	if (selectedKeys.has(key)) continue
	selectedKeys.add(key)
	selected.push(result.summary.config)
	if (selected.length >= 12) break
}

const result = {
	schemaVersion: 1,
	generatedAt: new Date().toISOString(),
	scope: 'gross-only vendor dashboard reconstruction; no fees, funding or slippage',
	inputs: datasets.map(({ input, rows, hash }) => ({
		id: input.id,
		file: input.file,
		sha256: hash,
		rows: rows.length,
		buy: rows.filter((row) => row.buy).length,
		sell: rows.filter((row) => row.sell).length,
		firstUtc: new Date(rows[0]!.timestamp).toISOString(),
		lastUtc: new Date(rows.at(-1)!.timestamp).toISOString(),
	})),
	knownDashboard: known.input.dashboard,
	bestKnownCellFits: ranked.slice(0, 25),
	crossDatasetSelected: selected.map((config) => ({
		config,
		datasets: datasets.map(({ input, rows }) => {
			const trades = collectGgiGrossTrades(rows, config)
			return { id: input.id, ...summarizeGgiGrossTrades(trades, config) }
		}),
	})),
}

const outDir = resolve('ci-results')
mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'ggi-gross-replay-grid-v1.json'), `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify({ candidates: candidateConfigs.length, best: result.bestKnownCellFits.slice(0, 5) }, null, 2))
