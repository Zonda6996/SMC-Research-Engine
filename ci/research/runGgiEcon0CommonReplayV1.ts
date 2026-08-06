import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseExactIndicatorCsv, sha256File, type ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import {
	applyOneWayCostBps,
	collectCorrectedSignalTrades,
	trueRangeSma,
	validGgiBand,
	type CorrectedGgiSignal,
	type CorrectedGgiSide,
	type CorrectedGgiTrade,
} from './lib/ggiCorrectedReplay.js'
import { bodySma20, own1Signals } from './runOwn1Generator.js'
import {
	OWN2_FIT,
	OWN2_VALIDATION,
	fitOwn2Model,
	own2Candidates,
	scoreOwn2,
	selectOwn2Candidates,
	type Candidate,
	type Own2Model,
} from './runGgiOwn2ExpectancyRankerV1.js'
import { replayDm3Trade } from './runDm3StaticExit.js'

export const ECON0_VERSION = 'ggi-econ0-common-corrected-replay-v1'
export const ECON0_COST_BPS = 6
export const ECON0_WARMUP = 100
export const ECON0_NULL_SEED = 20260806
export const ECON0_MAX_HOLDING = 2_000
export const ECON0_STREAMS = ['GGI', 'OWN1', 'OWN2_BROAD', 'OWN2_SELECTED'] as const
export type Econ0Stream = (typeof ECON0_STREAMS)[number]
export type Econ0Window = 'full' | 'fit' | 'validation' | 'test'

export interface Econ0DatasetSpec {
	id: string
	file: string
	role: 'development' | 'transfer'
	timeframeMinutes: number
}

export const ECON0_DATASETS: Econ0DatasetSpec[] = [
	{ id: 'btc-2h', file: 'data/vendor-exports/incoming-2026-08/BYBIT_BTCUSDT.P_2h_full20k_vol.csv', role: 'development', timeframeMinutes: 120 },
	{ id: 'xrp-3m', file: 'data/vendor-exports/incoming-2026-08/BINANCE_XRPUSDT_3m_vol.csv', role: 'transfer', timeframeMinutes: 3 },
	{ id: 'ondo-2h', file: 'data/vendor-exports/incoming-2026-08/BYBIT_ONDOUSDT.P_2h.csv', role: 'transfer', timeframeMinutes: 120 },
	{ id: 'ondo-15m', file: 'data/vendor-exports/incoming-2026-08/BYBIT_ONDOUSDT.P_15m.csv', role: 'transfer', timeframeMinutes: 15 },
	{ id: 'btc-15m', file: 'data/vendor-exports/incoming-2026-08/BYBIT_BTCUSDT.P_15m.csv', role: 'transfer', timeframeMinutes: 15 },
]

export interface Econ0Summary {
	signals: number
	closedTrades: number
	partial: number
	stop: number
	full: number
	end: number
	dashboardWinRate: number | null
	positiveNetRate: number | null
	meanGrossR: number | null
	medianGrossR: number | null
	meanNetR: number | null
	medianNetR: number | null
	profitFactorNet: number | null
	best1RemovedMeanNetR: number | null
	turnover: number
	meanHoldingBars: number | null
	timeInMarketBars: number
	netRPer1000Bars: number | null
	outcomes: Record<'Partial' | 'Stop' | 'Full fix' | 'End mark', { count: number; meanNetR: number | null; totalNetR: number }>
}

export interface Econ0MatchedSignal extends CorrectedGgiSignal {
	templateIndex: number
	tier: 'month-side-mean-atr' | 'month-side-mean' | 'side-mean-atr' | 'side-mean' | 'unmatched'
}

interface LoadedDataset {
	spec: Econ0DatasetSpec
	rows: ExactIndicatorRow[]
	tr55: Array<number | null>
	body: Array<number | null>
	sha256: string
}

interface FrozenOwn2 {
	model: Own2Model
	cutoff: number
	retention: number
	fitCandidates: number
	validationClosedTrades: number
	validationMeanNetR: number | null
}

const mean = (xs: readonly number[]): number | null => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
function median(xs: readonly number[]): number | null {
	if (!xs.length) return null
	const sorted = [...xs].sort((a, b) => a - b)
	const middle = Math.floor(sorted.length / 2)
	return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}
function profitFactor(xs: readonly number[]): number | null {
	const wins = xs.filter((x) => x > 0).reduce((a, b) => a + b, 0)
	const losses = Math.abs(xs.filter((x) => x < 0).reduce((a, b) => a + b, 0))
	return losses > 0 ? wins / losses : wins > 0 ? Number.POSITIVE_INFINITY : null
}
function best1Removed(xs: readonly number[]): number | null {
	if (!xs.length) return null
	const remove = Math.max(1, Math.ceil(xs.length * 0.01))
	return mean([...xs].sort((a, b) => b - a).slice(remove))
}
function monthKey(timestamp: number): string {
	const date = new Date(timestamp)
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}
function meanState(row: ExactIndicatorRow): -1 | 0 | 1 { return row.close < row.mean ? -1 : row.close > row.mean ? 1 : 0 }
function rng(seed: number): () => number {
	return () => {
		seed |= 0
		seed = seed + 0x6D2B79F5 | 0
		let value = Math.imul(seed ^ seed >>> 15, 1 | seed)
		value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value
		return ((value ^ value >>> 14) >>> 0) / 4294967296
	}
}

function loadDataset(spec: Econ0DatasetSpec): LoadedDataset {
	const file = resolve(spec.file)
	const rows = parseExactIndicatorCsv(readFileSync(file, 'utf8'), { allowInvalidBandOrder: true, allowIrregularBars: true })
	return { spec, rows, tr55: trueRangeSma(rows, 55), body: bodySma20(rows), sha256: sha256File(file) }
}

export function ggiSignals(rows: readonly ExactIndicatorRow[], from = 0, to = rows.length): CorrectedGgiSignal[] {
	const out: CorrectedGgiSignal[] = []
	for (let i = Math.max(ECON0_WARMUP, from); i < Math.min(to, rows.length - 1); i++) {
		if (rows[i]!.buy) out.push({ signalIndex: i, side: 1 })
		else if (rows[i]!.sell) out.push({ signalIndex: i, side: -1 })
	}
	return out
}

function toSignals(candidates: readonly Candidate[]): CorrectedGgiSignal[] {
	return candidates.map((candidate) => ({ signalIndex: candidate.idx, side: candidate.side }))
}

function evaluateOwn2Dm3(rows: readonly ExactIndicatorRow[], tr55: readonly (number | null)[], candidates: readonly Candidate[]) {
	return candidates.flatMap((candidate) => {
		const trade = replayDm3Trade(rows, tr55, candidate.idx, candidate.side, 'V2_movP_staticTPwick')
		if (trade == null || trade.outcome === 'End mark') return []
		const entry = rows[candidate.idx + 1]
		const volatility = tr55[candidate.idx]
		if (entry == null || volatility == null || volatility <= 0) return []
		const riskPct = volatility * 12 / entry.open * 100
		return [{ candidate, netR: trade.grossR - (ECON0_COST_BPS * 2 / 100) / riskPct }]
	})
}

function fitFrozenOwn2(data: LoadedDataset): FrozenOwn2 {
	const split1 = Math.floor(data.rows.length * OWN2_FIT)
	const split2 = Math.floor(data.rows.length * (OWN2_FIT + OWN2_VALIDATION))
	const candidates = own2Candidates(data.rows, data.tr55, data.body)
	const fit = candidates.filter((candidate) => candidate.idx < split1)
	const evaluation = evaluateOwn2Dm3(data.rows, data.tr55, fit).map(({ candidate, netR }) => ({ candidate, trade: null, grossR: null, netR }))
	const model = fitOwn2Model(fit, evaluation)
	const scores = fit.map((candidate) => scoreOwn2(model, candidate)).sort((a, b) => b - a)
	const retentions = [0.10, 0.20, 0.35].map((retention) => {
		const cutoff = scores[Math.min(scores.length - 1, Math.max(0, Math.ceil(scores.length * retention) - 1))]!
		const selected = selectOwn2Candidates(candidates.filter((candidate) => candidate.idx >= split1 && candidate.idx < split2), model, cutoff)
		const net = evaluateOwn2Dm3(data.rows, data.tr55, selected).map((x) => x.netR)
		return { retention, cutoff, closed: net.length, meanNetR: mean(net) }
	})
	const winner = retentions.filter((x) => x.closed >= 20).sort((a, b) => (b.meanNetR ?? -Infinity) - (a.meanNetR ?? -Infinity))[0] ?? retentions[0]!
	return { model, cutoff: winner.cutoff, retention: winner.retention, fitCandidates: fit.length, validationClosedTrades: winner.closed, validationMeanNetR: winner.meanNetR }
}

export function causalAtrQuintiles(rows: readonly ExactIndicatorRow[], tr55: readonly (number | null)[], from: number, to: number): Array<number | null> {
	const result = Array<number | null>(rows.length).fill(null)
	const history: number[] = []
	for (let i = 0; i < Math.min(to, rows.length - 1); i++) {
		const value = tr55[i]
		if (value == null || value <= 0) continue
		if (i >= Math.max(ECON0_WARMUP, from)) {
			const lessOrEqual = history.filter((prior) => prior <= value).length
			result[i] = history.length ? Math.min(4, Math.floor(lessOrEqual * 5 / (history.length + 1))) : 2
		}
		history.push(value)
	}
	return result
}

export function matchEcon0NullSignals(
	rows: readonly ExactIndicatorRow[],
	tr55: readonly (number | null)[],
	template: readonly CorrectedGgiSignal[],
	from: number,
	to: number,
	seed: number,
): Econ0MatchedSignal[] {
	const random = rng(seed)
	const quintiles = causalAtrQuintiles(rows, tr55, from, to)
	const templateIndices = new Set(template.map((signal) => signal.signalIndex))
	const used = new Set<number>()
	const eligible = Array.from({ length: Math.max(0, Math.min(to, rows.length - 1) - Math.max(ECON0_WARMUP, from)) }, (_, k) => k + Math.max(ECON0_WARMUP, from))
		.filter((i) => !templateIndices.has(i) && validGgiBand(rows[i]!) && validGgiBand(rows[i + 1]!) && tr55[i] != null && tr55[i]! > 0)
	return template.map((signal) => {
		const source = rows[signal.signalIndex]!
		const month = monthKey(source.timestamp)
		const state = meanState(source)
		const quintile = quintiles[signal.signalIndex]
		const allowed = (idx: number) => !used.has(idx) && !templateIndices.has(idx) && !template.some((real) => real.side === signal.side && real.signalIndex === idx)
		const base = eligible.filter((idx) => allowed(idx) && meanState(rows[idx]!) === state)
		const pools: Array<{ tier: Econ0MatchedSignal['tier']; candidates: number[] }> = [
			{ tier: 'month-side-mean-atr', candidates: base.filter((idx) => monthKey(rows[idx]!.timestamp) === month && quintiles[idx] === quintile) },
			{ tier: 'month-side-mean', candidates: base.filter((idx) => monthKey(rows[idx]!.timestamp) === month) },
			{ tier: 'side-mean-atr', candidates: base.filter((idx) => quintiles[idx] === quintile) },
			{ tier: 'side-mean', candidates: base },
		]
		for (const pool of pools) {
			if (!pool.candidates.length) continue
			const index = pool.candidates[Math.floor(random() * pool.candidates.length)]!
			used.add(index)
			return { signalIndex: index, side: signal.side, templateIndex: signal.signalIndex, tier: pool.tier }
		}
		return { signalIndex: -1, side: signal.side, templateIndex: signal.signalIndex, tier: 'unmatched' }
	})
}

export function summarizeEcon0(trades: readonly CorrectedGgiTrade[], sourceBars: number): Econ0Summary {
	const closed = trades.filter((trade) => trade.outcome !== 'End mark')
	const net = closed.map((trade) => applyOneWayCostBps(trade, ECON0_COST_BPS).netR)
	const gross = closed.map((trade) => trade.grossR)
	const outcome = (name: CorrectedGgiTrade['outcome']) => {
		const subset = closed.filter((trade) => trade.outcome === name).map((trade) => applyOneWayCostBps(trade, ECON0_COST_BPS).netR)
		return { count: subset.length, meanNetR: mean(subset), totalNetR: subset.reduce((a, b) => a + b, 0) }
	}
	return {
		signals: trades.length,
		closedTrades: closed.length,
		partial: closed.filter((trade) => trade.outcome === 'Partial').length,
		stop: closed.filter((trade) => trade.outcome === 'Stop').length,
		full: closed.filter((trade) => trade.outcome === 'Full fix').length,
		end: trades.filter((trade) => trade.outcome === 'End mark').length,
		dashboardWinRate: closed.length ? closed.filter((trade) => trade.outcome === 'Partial' || trade.outcome === 'Full fix').length / closed.length : null,
		positiveNetRate: net.length ? net.filter((value) => value > 0).length / net.length : null,
		meanGrossR: mean(gross), medianGrossR: median(gross), meanNetR: mean(net), medianNetR: median(net), profitFactorNet: profitFactor(net),
		best1RemovedMeanNetR: best1Removed(net), turnover: closed.reduce((sum, trade) => sum + trade.turnover, 0),
		meanHoldingBars: mean(closed.map((trade) => trade.holdingBars)), timeInMarketBars: closed.reduce((sum, trade) => sum + trade.holdingBars, 0),
		netRPer1000Bars: sourceBars > 0 ? net.reduce((a, b) => a + b, 0) / sourceBars * 1_000 : null,
		outcomes: { Partial: outcome('Partial'), Stop: outcome('Stop'), 'Full fix': outcome('Full fix'), 'End mark': outcome('End mark') },
	}
}

function strictWindowTrades(trades: readonly CorrectedGgiTrade[], from: number, to: number): CorrectedGgiTrade[] {
	return trades.filter((trade) => trade.signalIndex >= from && trade.signalIndex < to && trade.entryIndex >= from && trade.exitIndex < to)
}

function streamSignals(data: LoadedDataset, frozen: FrozenOwn2): Record<Econ0Stream, CorrectedGgiSignal[]> {
	const candidates = own2Candidates(data.rows, data.tr55, data.body)
	return {
		GGI: ggiSignals(data.rows),
		OWN1: own1Signals(data.rows, data.body, 1.5, 10, 0, data.rows.length).map((signal) => ({ signalIndex: signal.idx, side: signal.side })),
		OWN2_BROAD: toSignals(selectOwn2Candidates(candidates, { cuts: frozen.model.cuts, values: frozen.model.values, globalMean: frozen.model.globalMean }, -Infinity)),
		OWN2_SELECTED: toSignals(selectOwn2Candidates(candidates, frozen.model, frozen.cutoff)),
	}
}

function windows(data: LoadedDataset): Array<{ label: Econ0Window; from: number; to: number }> {
	if (data.spec.role === 'transfer') return [{ label: 'full', from: 0, to: data.rows.length }]
	const split1 = Math.floor(data.rows.length * OWN2_FIT)
	const split2 = Math.floor(data.rows.length * (OWN2_FIT + OWN2_VALIDATION))
	return [
		{ label: 'full', from: 0, to: data.rows.length },
		{ label: 'fit', from: 0, to: split1 },
		{ label: 'validation', from: split1, to: split2 },
		{ label: 'test', from: split2, to: data.rows.length },
	]
}

export function classifyEcon0(cells: Array<{ dataset: string; window: Econ0Window; stream: Econ0Stream; summary: Econ0Summary; nullSummary: Econ0Summary; deltaMeanNetR: number | null }>): string {
	const test = cells.filter((cell) => cell.dataset === 'btc-2h' && cell.window === 'test')
	const ggi = test.find((cell) => cell.stream === 'GGI')
	const own = test.filter((cell) => cell.stream !== 'GGI')
	const material = (cell: typeof cells[number]) => (cell.summary.meanNetR ?? -Infinity) >= 0.03 && (cell.summary.profitFactorNet ?? -Infinity) >= 1.10 && (cell.summary.best1RemovedMeanNetR ?? -Infinity) > 0
	if (ggi && (ggi.deltaMeanNetR ?? -Infinity) <= 0) return 'TEACHER_INVALID_IN_CELL'
	if (ggi && material(ggi) && own.some(material)) return 'MEASUREMENT_EXPLAINS_GAP'
	if (ggi && material(ggi) && own.every((cell) => !material(cell) || (cell.deltaMeanNetR ?? -Infinity) <= 0)) return 'SELECTIVITY_GAP_CONFIRMED'
	return 'INCONCLUSIVE_PARTIAL_COVERAGE'
}

export function runEcon0() {
	const manifest = ECON0_DATASETS.map((spec) => ({ ...spec, available: existsSync(resolve(spec.file)), sha256: existsSync(resolve(spec.file)) ? sha256File(resolve(spec.file)) : null }))
	const data = manifest.filter((item) => item.available).map((item) => loadDataset(item))
	const development = data.find((dataset) => dataset.spec.id === 'btc-2h')
	if (!development) throw new Error('ECON0 requires btc-2h development input')
	const frozen = fitFrozenOwn2(development)
	const cells: Array<{ dataset: string; window: Econ0Window; stream: Econ0Stream; summary: Econ0Summary; nullSummary: Econ0Summary; nullTiers: Record<string, number>; deltaMeanNetR: number | null }> = []
	for (let datasetOrder = 0; datasetOrder < data.length; datasetOrder++) {
		const dataset = data[datasetOrder]!
		const signals = streamSignals(dataset, frozen)
		for (const window of windows(dataset)) for (let streamOrder = 0; streamOrder < ECON0_STREAMS.length; streamOrder++) {
			const stream = ECON0_STREAMS[streamOrder]!
			const windowSignals = signals[stream].filter((signal) => signal.signalIndex >= window.from && signal.signalIndex < window.to)
			const replayConfig = { stopMultiplier: 12, addEnabled: false, beBound: 'next-bar-entry-be' as const, partialFraction: 0.25, maxHoldingBars: ECON0_MAX_HOLDING }
			const trades = strictWindowTrades(collectCorrectedSignalTrades(dataset.rows, dataset.tr55, windowSignals, replayConfig), window.from, window.to)
			const matched = matchEcon0NullSignals(dataset.rows, dataset.tr55, windowSignals, window.from, window.to, ECON0_NULL_SEED + datasetOrder * 1009 + streamOrder * 101 + window.from)
			const matchedSignals = matched.filter((signal) => signal.signalIndex >= 0)
			const nullTrades = strictWindowTrades(collectCorrectedSignalTrades(dataset.rows, dataset.tr55, matchedSignals, replayConfig), window.from, window.to)
			const summary = summarizeEcon0(trades, window.to - window.from)
			const nullSummary = summarizeEcon0(nullTrades, window.to - window.from)
			const nullTiers = Object.fromEntries(['month-side-mean-atr', 'month-side-mean', 'side-mean-atr', 'side-mean', 'unmatched'].map((tier) => [tier, matched.filter((signal) => signal.tier === tier).length]))
			cells.push({ dataset: dataset.spec.id, window: window.label, stream, summary, nullSummary, nullTiers, deltaMeanNetR: summary.meanNetR == null || nullSummary.meanNetR == null ? null : summary.meanNetR - nullSummary.meanNetR })
		}
	}
	const transfers = ECON0_STREAMS.map((stream) => {
		const subset = cells.filter((cell) => cell.window === 'full' && cell.stream === stream && data.find((dataset) => dataset.spec.id === cell.dataset)?.spec.role === 'transfer')
		const total = subset.reduce((sum, cell) => sum + cell.summary.closedTrades, 0)
		return {
			stream,
			closedTrades: total,
			closedWeightedMeanNetR: total ? subset.reduce((sum, cell) => sum + (cell.summary.meanNetR ?? 0) * cell.summary.closedTrades, 0) / total : null,
			equalDatasetMeanNetR: mean(subset.map((cell) => cell.summary.meanNetR).filter((value): value is number => value != null)),
			positiveDatasets: subset.filter((cell) => (cell.summary.meanNetR ?? -Infinity) > 0).length,
			datasets: subset.length,
		}
	})
	return {
		version: ECON0_VERSION,
		generatedAt: new Date().toISOString(),
		coverage: { status: manifest.every((item) => item.available) ? 'PARTIAL_INPUT_COVERAGE' : 'PARTIAL_INPUT_COVERAGE_WITH_MISSING_LOCAL_INPUTS', available: data.length, expectedLocal: manifest.length, note: 'Ten historical ETH/SOL/XRP/AAVE/BNB 1h/2h holdout exports are absent by preregistration.' },
		protocol: { management: 'next-open; 12x causal SMA(TR,55) initial stop; 25% Mean-wick partial; next-bar entry BE; close-confirmed moving opposite Inner full; adverse wick first; max 2000 bars; no add', oneWayCostBps: ECON0_COST_BPS, funding: 'excluded', own2Retention: frozen.retention, own2Cutoff: frozen.cutoff, null: 'dataset/window count matched by direction, calendar month, signal-side Mean state and causal expanding ATR55 quintile; deterministic fallback tiers' },
		inputs: manifest,
		frozenOwn2: { retention: frozen.retention, cutoff: frozen.cutoff, fitCandidates: frozen.fitCandidates, validationClosedTrades: frozen.validationClosedTrades, validationMeanNetR: frozen.validationMeanNetR },
		cells,
		transfers,
		verdict: classifyEcon0(cells),
	}
}

function fmt(value: number | null, digits = 4): string { return value == null || !Number.isFinite(value) ? '-' : value.toFixed(digits) }
function pct(value: number | null): string { return value == null ? '-' : `${(value * 100).toFixed(1)}%` }
export function econ0Markdown(result: ReturnType<typeof runEcon0>): string {
	const lines = [
		'# ECON0 common corrected replay v1', '',
		`## Verdict: **${result.verdict}**`, '',
		`Coverage: **${result.coverage.status}** (${result.coverage.available}/${result.coverage.expectedLocal} locally available datasets).`, '',
		'This is a partial-coverage measurement reconciliation study. It is not a fresh sealed holdout and does not promote a production indicator.', '',
		'## Common economics', '',
		'| Dataset | Window | Stream | Closed | P/S/F/E | Dashboard WR | Positive net | Mean net R | PF | Best 1% removed | Null net R | Delta | net R / 1k bars |',
		'|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
	]
	for (const cell of result.cells) lines.push(`| ${cell.dataset} | ${cell.window} | ${cell.stream} | ${cell.summary.closedTrades} | ${cell.summary.partial}/${cell.summary.stop}/${cell.summary.full}/${cell.summary.end} | ${pct(cell.summary.dashboardWinRate)} | ${pct(cell.summary.positiveNetRate)} | ${fmt(cell.summary.meanNetR)} | ${fmt(cell.summary.profitFactorNet, 3)} | ${fmt(cell.summary.best1RemovedMeanNetR)} | ${fmt(cell.nullSummary.meanNetR)} | ${fmt(cell.deltaMeanNetR)} | ${fmt(cell.summary.netRPer1000Bars)} |`)
	lines.push('', '## Terminal payoff decomposition', '', '| Dataset | Window | Stream | Partial mean/total | Stop mean/total | Full mean/total |', '|---|---|---|---:|---:|---:|')
	for (const cell of result.cells.filter((cell) => cell.window === 'full' || (cell.dataset === 'btc-2h' && cell.window === 'test'))) {
		const p = cell.summary.outcomes.Partial, s = cell.summary.outcomes.Stop, f = cell.summary.outcomes['Full fix']
		lines.push(`| ${cell.dataset} | ${cell.window} | ${cell.stream} | ${fmt(p.meanNetR)}/${fmt(p.totalNetR, 2)} | ${fmt(s.meanNetR)}/${fmt(s.totalNetR, 2)} | ${fmt(f.meanNetR)}/${fmt(f.totalNetR, 2)} |`)
	}
	lines.push('', '## Transfer aggregate', '', '| Stream | Closed | Weighted mean net R | Equal-dataset mean net R | Positive datasets |', '|---|---:|---:|---:|---:|')
	for (const row of result.transfers) lines.push(`| ${row.stream} | ${row.closedTrades} | ${fmt(row.closedWeightedMeanNetR)} | ${fmt(row.equalDatasetMeanNetR)} | ${row.positiveDatasets}/${row.datasets} |`)
	lines.push('', '## Interpretation', '')
	if (result.verdict === 'SELECTIVITY_GAP_CONFIRMED') lines.push('GGI retains a material advantage under identical management while OWN streams fail the same economic/null gates. Proceed to a separately preregistered sequence/interaction selector.')
	else if (result.verdict === 'MEASUREMENT_EXPLAINS_GAP') lines.push('At least one OWN stream becomes materially viable under common corrected management. Reconcile execution/management before building another generator.')
	else if (result.verdict === 'TEACHER_INVALID_IN_CELL') lines.push('GGI fails to beat its matched null in the BTC 2h test cell and cannot be used there as a teacher target.')
	else lines.push('The local evidence is inconsistent or insufficient for a directional claim. Treat all transfer cells as diagnostics, not sealed validation.')
	lines.push('', 'Dashboard WR counts Partial as a win, but promotion is based on net expectancy, PF, robustness after removing the best 1%, and matched-null advantage.', '')
	return lines.join('\n')
}

export function main() {
	const result = runEcon0()
	const outDir = resolve('ci-results')
	mkdirSync(outDir, { recursive: true })
	writeFileSync(resolve(outDir, `${ECON0_VERSION}.json`), `${JSON.stringify(result, null, 2)}\n`)
	writeFileSync(resolve(outDir, `${ECON0_VERSION}.md`), `${econ0Markdown(result)}\n`)
	console.log(JSON.stringify({ output: `ci-results/${ECON0_VERSION}.json`, coverage: result.coverage, verdict: result.verdict }, null, 2))
	return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
