import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { completedPrefixLength } from '../../src/core/analysis/CausalLiquidityPoolState.js'
import { INDEPENDENT_REVERSAL_G2_PROTOCOL } from '../../src/core/signals/IndependentReversalG2Protocol.js'
import type { Candle } from '../../src/models/price/Candle.js'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'
import { fetchFundingHistory } from '../../tools/shared/fundingFetcher.js'
import { buildRows } from './runFwd1TelegramForwardAudit.js'
import { detectLiquidityHeatmap, heatmapConfigForTf, type LiquidityPool } from './lib/liquidityHeatmapEngine.js'
import type { ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import { own2Raw } from './runOwn2ExtensionTrigger.js'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const FROM = Date.parse('2024-01-01T00:00:00Z')
const UNTIL = Date.parse('2026-08-01T00:00:00Z')
const TIMEFRAMES = ['1h', '2h'] as const
const BREADTH_SYMBOLS = [
	'ARBUSDT', 'OPUSDT', 'SUIUSDT', 'SEIUSDT', 'PEPEUSDT', 'RUNEUSDT',
	'TAOUSDT', 'ENAUSDT', 'LDOUSDT', 'STXUSDT', 'SANDUSDT', 'MANAUSDT',
	'AXSUSDT', 'DYDXUSDT', 'IMXUSDT', 'MKRUSDT', 'CRVUSDT', 'PENDLEUSDT',
	'TIAUSDT', 'WIFUSDT',
] as const
const KNOWN_NO_MARKET_DATA_SYMBOLS = new Set(['PEPEUSDT'])
const NULL_SYMBOLS = [...INDEPENDENT_REVERSAL_G2_PROTOCOL.validation.transferSymbols]
const BASE_ONE_WAY_COST_BPS = 7
const MAX_HOLDING_DAYS = 14
const POST_EXIT_BARS = 3
const MINIMUM_HISTORY_4H = 300
const MINIMUM_POOL_AGE_MS = 48 * HOUR_MS
const SWEEP_RECENCY_MS = 48 * HOUR_MS
const MAXIMUM_NOTIONAL_RANK = 2 / 3
const ENTRY_BAND_TOLERANCE = 0.25
const MINIMUM_BREADTH_TRADES = 100
const PAPER_THRESHOLD_R = 0.05

type Side = 1 | -1
type Timeframe = typeof TIMEFRAMES[number]

export interface FundingPayment { timestamp: number; rate: number; markPrice: number }
export interface FrozenTrade {
	symbol: string
	timeframe: Timeframe
	side: Side
	signalAt: number
	entryAt: number
	exitAt: number
	holdingBars: number
	grossR: number
	costR: number
	fundingR: number
	netR: number
	outcome: 'tp' | 'stop' | 'timeout'
	seq: boolean
	cluster: string
}

export interface FrozenFunnel {
	own2Raw: number
	afterWarmupAndWindow: number
	admittedByStateGate: number
	replayable: number
	nearPool: number
	rankPassed: number
	freshSweepPassed: number
	entryBandPassed: number
	finalTrades: number
}

export interface FrozenFunnelCell extends FrozenFunnel {
	symbol: string
	timeframe: Timeframe
}

export interface RelaxedPoolAudit {
	pool: LiquidityPool | null
	nearPool: boolean
	rankPassed: boolean
	freshSweepPassed: boolean
	entryBandPassed: boolean
	rank: number | null
	sweepAgeHours: number | null
}

export interface StateFirstSignal { idx: number }

export function emptyFunnel(): FrozenFunnel {
	return {
		own2Raw: 0,
		afterWarmupAndWindow: 0,
		admittedByStateGate: 0,
		replayable: 0,
		nearPool: 0,
		rankPassed: 0,
		freshSweepPassed: 0,
		entryBandPassed: 0,
		finalTrades: 0,
	}
}

export function selectStateFirst<TSignal extends StateFirstSignal, TReplay extends { holdingBars: number }>(
	signals: readonly TSignal[],
	replay: (signal: TSignal) => TReplay | null,
	accept: (signal: TSignal, replay: TReplay) => boolean,
	postExitBars = POST_EXIT_BARS,
	includeInCounts: (signal: TSignal) => boolean = () => true,
): { selected: Array<{ signal: TSignal; replay: TReplay }>; admittedByStateGate: number; replayable: number } {
	let blockedUntil = -1
	let admittedByStateGate = 0
	let replayable = 0
	const selected: Array<{ signal: TSignal; replay: TReplay }> = []
	for (const signal of signals) {
		if (signal.idx <= blockedUntil) continue
		const counted = includeInCounts(signal)
		if (counted) admittedByStateGate++
		const result = replay(signal)
		if (!result) continue
		if (counted) replayable++
		// IMP2 parity: every replayable raw candidate occupies trade state,
		// even when it is before the reporting window or the later
		// liquidity-context filter rejects it.
		blockedUntil = signal.idx + result.holdingBars + postExitBars
		if (accept(signal, result)) selected.push({ signal, replay: result })
	}
	return { selected, admittedByStateGate, replayable }
}

interface Summary {
	trades: number
	clusters: number
	meanNetR: number | null
	clusterEqualMeanNetR: number | null
	profitFactor: number | null
	positiveRate: number | null
	totalNetR: number
	fundingR: number
}

function monthKey(timestamp: number): string {
	return new Date(timestamp).toISOString().slice(0, 7)
}

function clusterKey(timestamp: number, side: Side): string {
	return `${new Date(Math.floor(timestamp / DAY_MS) * DAY_MS).toISOString().slice(0, 10)}-${side === 1 ? 'L' : 'S'}`
}

function mean(values: readonly number[]): number | null {
	return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

export function atrRma200(rows: readonly ExactIndicatorRow[]): number[] {
	const out = new Array<number>(rows.length).fill(Number.NaN)
	let sum = 0
	for (let index = 1; index < rows.length; index++) {
		const row = rows[index]!
		const previous = rows[index - 1]!
		const tr = Math.max(row.high - row.low, Math.abs(row.high - previous.close), Math.abs(row.low - previous.close))
		if (index <= 200) {
			sum += tr
			if (index === 200) out[index] = sum / 200
		} else out[index] = (out[index - 1]! * 199 + tr) / 200
	}
	return out
}

function averageRange(rows: readonly ExactIndicatorRow[], from: number, until: number): number {
	let sum = 0
	for (let index = from; index < until; index++) sum += rows[index]!.high - rows[index]!.low
	return until > from ? sum / (until - from) : 0
}

export function sequenceScoreAt(rows: readonly ExactIndicatorRow[], index: number, side: Side): number {
	const failedLookback = INDEPENDENT_REVERSAL_G2_PROTOCOL.sequence.failedContinuationLookback
	const slopeLookback = INDEPENDENT_REVERSAL_G2_PROTOCOL.sequence.meanSlopeLookback
	const contractionLookback = INDEPENDENT_REVERSAL_G2_PROTOCOL.sequence.contractionLookback
	if (index < Math.max(failedLookback, slopeLookback, contractionLookback)) return 0
	let adverseExtreme = side === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
	for (let cursor = index - failedLookback; cursor < index; cursor++) {
		adverseExtreme = side === 1 ? Math.min(adverseExtreme, rows[cursor]!.low) : Math.max(adverseExtreme, rows[cursor]!.high)
	}
	const current = rows[index]!
	const failedContinuation = side === 1
		? (current.low >= adverseExtreme && current.close > current.open ? 1 : 0)
		: (current.high <= adverseExtreme && current.close < current.open ? 1 : 0)
	let trSum = 0
	for (let cursor = index - slopeLookback + 1; cursor <= index; cursor++) {
		const row = rows[cursor]!
		const previous = rows[cursor - 1] ?? row
		trSum += Math.max(row.high - row.low, Math.abs(row.high - previous.close), Math.abs(row.low - previous.close))
	}
	const meanSlopeAtr = (side === 1 ? 1 : -1) * (current.mean - rows[index - slopeLookback]!.mean) / Math.max(trSum / slopeLookback, Number.EPSILON)
	const half = Math.floor(contractionLookback / 2)
	const recentRange = averageRange(rows, index - half, index)
	const priorRange = averageRange(rows, index - contractionLookback, index - half)
	const contractionRatio = priorRange > 0 ? recentRange / priorRange : 1
	return failedContinuation
		+ (meanSlopeAtr > -0.25 ? 1 : 0)
		+ (contractionRatio < 1 ? 1 : 0)
		+ ((side === 1 ? current.close > current.open : current.close < current.open) ? 1 : 0)
}

export function fundingReturnR(
	side: Side,
	entryAt: number,
	exitAt: number,
	plannedRiskPct: number,
	payments: readonly FundingPayment[],
): number {
	if (!(plannedRiskPct > 0)) return 0
	let returnPct = 0
	for (const payment of payments) {
		if (payment.timestamp <= entryAt || payment.timestamp >= exitAt) continue
		returnPct += -side * payment.rate * 100
	}
	return returnPct / plannedRiskPct
}

export function replayFrozenStatic2(
	rows: readonly ExactIndicatorRow[],
	atr: readonly number[],
	signalIndex: number,
	side: Side,
	timeframeMs: number,
	payments: readonly FundingPayment[],
): Omit<FrozenTrade, 'symbol' | 'timeframe' | 'seq' | 'cluster'> | null {
	const signal = rows[signalIndex]
	const entryBar = rows[signalIndex + 1]
	const atrAtSignal = atr[signalIndex]
	if (!signal || !entryBar || !Number.isFinite(atrAtSignal) || atrAtSignal! <= 0) return null
	const step = 5.5 * atrAtSignal! / 1.17
	const entry = entryBar.open
	const riskDistance = 2 * step
	const stop = side === 1 ? entry - riskDistance : entry + riskDistance
	const target = side === 1 ? entry + riskDistance : entry - riskDistance
	const maxHoldingBars = Math.max(1, Math.floor(MAX_HOLDING_DAYS * DAY_MS / timeframeMs))
	const lastIndex = Math.min(rows.length - 1, signalIndex + maxHoldingBars)
	let exitIndex = lastIndex
	let exitPrice = rows[lastIndex]?.close
	let outcome: FrozenTrade['outcome'] = 'timeout'
	if (exitPrice == null) return null
	for (let index = signalIndex + 1; index <= lastIndex; index++) {
		const row = rows[index]!
		const stopped = side === 1 ? row.low <= stop : row.high >= stop
		const targeted = side === 1 ? row.high >= target : row.low <= target
		if (stopped) { exitIndex = index; exitPrice = stop; outcome = 'stop'; break }
		if (targeted) { exitIndex = index; exitPrice = target; outcome = 'tp'; break }
	}
	const grossR = side * (exitPrice - entry) / riskDistance
	const costReturnPct = -(BASE_ONE_WAY_COST_BPS / 100) * (1 + exitPrice / entry)
	const plannedRiskPct = riskDistance / entry * 100
	const costR = costReturnPct / plannedRiskPct
	const entryAt = entryBar.timestamp
	const exitAt = rows[exitIndex]!.timestamp + timeframeMs
	const fundingR = fundingReturnR(side, entryAt, exitAt, plannedRiskPct, payments)
	return {
		side,
		signalAt: signal.timestamp,
		entryAt,
		exitAt,
		holdingBars: exitIndex - signalIndex,
		grossR,
		costR,
		fundingR,
		netR: grossR + costR + fundingR,
		outcome,
	}
}

export function auditRelaxedPool(
	pools: readonly LiquidityPool[],
	decisionAt: number,
	entryPrice: number,
	side: Side,
): RelaxedPoolAudit {
	const wanted = side === 1 ? 'buy-side' : 'sell-side'
	const alive = pools.filter((pool) => pool.side === wanted
		&& pool.startAt + MINIMUM_POOL_AGE_MS <= decisionAt
		&& (pool.sweptAt == null || (decisionAt >= pool.sweptAt && decisionAt - pool.sweptAt <= SWEEP_RECENCY_MS)))
	const within = (pool: LiquidityPool, tolerance: number) => {
		const width = pool.bandHigh - pool.bandLow
		return entryPrice >= pool.bandLow - tolerance * width
			&& entryPrice <= pool.bandHigh + tolerance * width
	}
	const hit = alive.find((pool) => within(pool, 0.5)) ?? null
	if (!hit) return { pool: null, nearPool: false, rankPassed: false, freshSweepPassed: false, entryBandPassed: false, rank: null, sweepAgeHours: null }
	const below = alive.filter((pool) => pool !== hit && pool.notional < hit.notional).length
	const rank = alive.length <= 1 ? 0.5 : below / (alive.length - 1)
	const rankPassed = rank < MAXIMUM_NOTIONAL_RANK
	const sweepAgeHours = hit.sweptAt == null ? null : (decisionAt - hit.sweptAt) / HOUR_MS
	const freshSweepPassed = hit.sweptAt != null && decisionAt >= hit.sweptAt && decisionAt - hit.sweptAt <= SWEEP_RECENCY_MS
	const entryBandPassed = within(hit, ENTRY_BAND_TOLERANCE)
	return {
		pool: rankPassed && freshSweepPassed && entryBandPassed ? hit : null,
		nearPool: true,
		rankPassed,
		freshSweepPassed,
		entryBandPassed,
		rank,
		sweepAgeHours,
	}
}

function summarize(trades: readonly FrozenTrade[]): Summary {
	const values = trades.map((trade) => trade.netR)
	const gains = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
	const losses = -values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0)
	const clusterValues = [...Map.groupBy(trades, (trade) => trade.cluster).values()]
		.map((cluster) => mean(cluster.map((trade) => trade.netR))!)
	return {
		trades: trades.length,
		clusters: clusterValues.length,
		meanNetR: mean(values),
		clusterEqualMeanNetR: mean(clusterValues),
		profitFactor: losses > 0 ? gains / losses : gains > 0 ? Number.POSITIVE_INFINITY : null,
		positiveRate: trades.length ? values.filter((value) => value > 0).length / values.length : null,
		totalNetR: values.reduce((sum, value) => sum + value, 0),
		fundingR: trades.reduce((sum, trade) => sum + trade.fundingR, 0),
	}
}

export function deterministicNullB(template: readonly FrozenTrade[], controls: readonly FrozenTrade[]): FrozenTrade[] {
	const used = new Set<number>()
	const out: FrozenTrade[] = []
	for (const target of [...template].sort((a, b) => a.signalAt - b.signalAt || a.symbol.localeCompare(b.symbol))) {
		let chosen = -1
		let bestDistance = Number.POSITIVE_INFINITY
		for (let index = 0; index < controls.length; index++) {
			if (used.has(index)) continue
			const control = controls[index]!
			if (control.side !== target.side || control.timeframe !== target.timeframe || monthKey(control.signalAt) !== monthKey(target.signalAt)) continue
			const distance = Math.abs(control.signalAt - target.signalAt)
			if (distance < bestDistance) { bestDistance = distance; chosen = index }
		}
		if (chosen >= 0) { used.add(chosen); out.push(controls[chosen]!) }
	}
	return out
}

interface LoadedSymbol {
	rows: ExactIndicatorRow[]
	candles4h: Candle[]
}

async function loadSymbol(symbol: string, timeframe: Timeframe): Promise<LoadedSymbol> {
	const timeframeMs = timeframe === '1h' ? HOUR_MS : 2 * HOUR_MS
	const warmup = FROM - 400 * 4 * HOUR_MS
	const [candles, candles4h] = await Promise.all([
		fetchArchiveKlines(symbol, timeframe, 'futures', warmup, UNTIL),
		fetchArchiveKlines(symbol, '4h', 'futures', warmup, UNTIL),
	])
	const complete = candles.filter((candle) => candle.timestamp + timeframeMs <= UNTIL)
	return {
		rows: buildRows(complete.map((candle) => ({ t: candle.timestamp, o: candle.open, h: candle.high, l: candle.low, c: candle.close, v: candle.volume }))),
		candles4h,
	}
}

interface EvaluatedSymbol {
	trades: FrozenTrade[]
	funnel: FrozenFunnelCell
}

async function evaluateSymbol(
	symbol: string,
	timeframe: Timeframe,
	payments: readonly FundingPayment[],
	warnings: string[],
	loaded?: LoadedSymbol,
): Promise<EvaluatedSymbol> {
	const timeframeMs = timeframe === '1h' ? HOUR_MS : 2 * HOUR_MS
	const { rows, candles4h } = loaded ?? await loadSymbol(symbol, timeframe)
	const funnel: FrozenFunnelCell = { symbol, timeframe, ...emptyFunnel() }
	if (rows.length < 1_000 || candles4h.length < MINIMUM_HISTORY_4H) {
		warnings.push(`${symbol} ${timeframe}: insufficient candles (${rows.length}/${candles4h.length})`)
		return { trades: [], funnel }
	}
	const atr = atrRma200(rows)
	const raw = own2Raw(rows)
	funnel.own2Raw = raw.length
	const replayCandidates = raw.filter((signal) => signal.idx > 200 && signal.idx + 1 < rows.length)
	const inWindow = (signal: StateFirstSignal) => {
		const entryAt = rows[signal.idx + 1]!.timestamp
		return entryAt >= FROM && entryAt < UNTIL
	}
	funnel.afterWarmupAndWindow = replayCandidates.filter(inWindow).length
	const cfg4h = heatmapConfigForTf(4 * HOUR_MS)
	let cachedPrefix = -1
	let pools = detectLiquidityHeatmap([], cfg4h)
	const selection = selectStateFirst(
		replayCandidates,
		(signal) => replayFrozenStatic2(rows, atr, signal.idx, signal.side, timeframeMs, payments),
		(signal) => {
			if (!inWindow(signal)) return false
			const decisionAt = rows[signal.idx]!.timestamp
			// IMP2 parity: causal 4h context is frozen at signal close, not next-bar entry.
			const prefix = completedPrefixLength(candles4h, decisionAt, 4 * HOUR_MS)
			if (prefix < MINIMUM_HISTORY_4H) return false
			if (prefix !== cachedPrefix) { pools = detectLiquidityHeatmap(candles4h.slice(0, prefix), cfg4h); cachedPrefix = prefix }
			const audit = auditRelaxedPool(pools, decisionAt, rows[signal.idx + 1]!.open, signal.side)
			if (audit.nearPool) funnel.nearPool++
			if (audit.nearPool && audit.rankPassed) funnel.rankPassed++
			if (audit.nearPool && audit.rankPassed && audit.freshSweepPassed) funnel.freshSweepPassed++
			if (audit.nearPool && audit.rankPassed && audit.freshSweepPassed && audit.entryBandPassed) funnel.entryBandPassed++
			return audit.pool != null
		},
		POST_EXIT_BARS,
		inWindow,
	)
	funnel.admittedByStateGate = selection.admittedByStateGate
	funnel.replayable = selection.replayable
	const trades = selection.selected.map(({ signal, replay }) => {
		const signalAt = rows[signal.idx]!.timestamp
		return {
			...replay,
			symbol,
			timeframe,
			seq: sequenceScoreAt(rows, signal.idx, signal.side) >= INDEPENDENT_REVERSAL_G2_PROTOCOL.sequence.minimumScore,
			cluster: clusterKey(signalAt, signal.side),
		} satisfies FrozenTrade
	})
	funnel.finalTrades = trades.length
	return { trades, funnel }
}

function format(value: number | null, digits = 4): string {
	return value == null || !Number.isFinite(value) ? '-' : value.toFixed(digits)
}

function formatR(value: number | null, digits = 4): string {
	const formatted = format(value, digits)
	return formatted === '-' ? '-' : `${formatted}R`
}

function addFunnel(target: FrozenFunnel, source: FrozenFunnel): void {
	for (const key of Object.keys(emptyFunnel()) as Array<keyof FrozenFunnel>) target[key] += source[key]
}

function funnelTable(funnel: FrozenFunnel): string[] {
	const rows: Array<[string, number]> = [
		['own2Raw (including warmup)', funnel.own2Raw],
		['after warmup + date window', funnel.afterWarmupAndWindow],
		['admitted by raw state gate', funnel.admittedByStateGate],
		['replayable (occupies state)', funnel.replayable],
		['near pool ±50%', funnel.nearPool],
		['rank < 2/3', funnel.rankPassed],
		['swept ≤48h', funnel.freshSweepPassed],
		['entry within ±25%', funnel.entryBandPassed],
		['final RELAXED trades', funnel.finalTrades],
	]
	return [
		'| Funnel stage | Count | % of previous stage |',
		'|---|---:|---:|',
		...rows.map(([name, count], index) => {
			if (index === 0) return `| ${name} | ${count} | - |`
			const previous = rows[index - 1]![1]
			return `| ${name} | ${count} | ${previous > 0 ? `${(count / previous * 100).toFixed(2)}%` : '-'} |`
		}),
	]
}

function table(rows: Array<{ name: string; summary: Summary }>): string[] {
	const out = ['| Slice | Trades | Clusters | Mean net R | Cluster-equal mean R | PF | Positive | Funding R |', '|---|---:|---:|---:|---:|---:|---:|---:|']
	for (const row of rows) out.push(`| ${row.name} | ${row.summary.trades} | ${row.summary.clusters} | ${format(row.summary.meanNetR)} | ${format(row.summary.clusterEqualMeanNetR)} | ${format(row.summary.profitFactor, 3)} | ${row.summary.positiveRate == null ? '-' : `${(row.summary.positiveRate * 100).toFixed(1)}%`} | ${format(row.summary.fundingR)} |`)
	return out
}

export async function main() {
	const warnings: string[] = []
	const requestedSymbols = process.env.ZONDA_FROZEN_SYMBOLS?.split(',').map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)
	const requestedTimeframes = process.env.ZONDA_FROZEN_TIMEFRAMES?.split(',').map((timeframe) => timeframe.trim()).filter((timeframe): timeframe is Timeframe => TIMEFRAMES.includes(timeframe as Timeframe))
	const allSymbols = requestedSymbols?.length ? requestedSymbols : [...new Set([...NULL_SYMBOLS, ...BREADTH_SYMBOLS])]
	const timeframes = requestedTimeframes?.length ? requestedTimeframes : [...TIMEFRAMES]
	const requestedNullComplete = NULL_SYMBOLS.every((symbol) => allSymbols.includes(symbol)) && TIMEFRAMES.every((timeframe) => timeframes.includes(timeframe))
	const requestedBreadthComplete = BREADTH_SYMBOLS.every((symbol) => allSymbols.includes(symbol)) && TIMEFRAMES.every((timeframe) => timeframes.includes(timeframe))
	const requireCompleteFunding = process.env.ZONDA_REQUIRE_COMPLETE_FUNDING === '1' || (requestedNullComplete && requestedBreadthComplete)
	const allTrades: FrozenTrade[] = []
	const funnelCells: FrozenFunnelCell[] = []
	for (const symbol of allSymbols) {
		if (KNOWN_NO_MARKET_DATA_SYMBOLS.has(symbol)) {
			for (const timeframe of timeframes) {
				console.log(`[frozen-1] ${symbol} ${timeframe} (known unavailable)`)
				warnings.push(`${symbol} ${timeframe}: insufficient candles (known unavailable in Binance USD-M archive)`)
				funnelCells.push({ symbol, timeframe, ...emptyFunnel() })
			}
			continue
		}
		const loadedByTimeframe = new Map<Timeframe, LoadedSymbol>()
		let hasUsableMarketData = false
		for (const timeframe of timeframes) {
			const loaded = await loadSymbol(symbol, timeframe)
			loadedByTimeframe.set(timeframe, loaded)
			if (loaded.rows.length >= 1_000 && loaded.candles4h.length >= MINIMUM_HISTORY_4H) hasUsableMarketData = true
		}
		let payments: FundingPayment[] = []
		if (hasUsableMarketData) {
			try { payments = await fetchFundingHistory(symbol, FROM, UNTIL) }
			catch (error) {
				const message = `${symbol}: funding unavailable (${error instanceof Error ? error.message : String(error)})`
				if (requireCompleteFunding) throw new Error(message)
				warnings.push(message)
			}
		}
		for (const timeframe of timeframes) {
			console.log(`[frozen-1] ${symbol} ${timeframe}`)
			const evaluated = await evaluateSymbol(symbol, timeframe, payments, warnings, loadedByTimeframe.get(timeframe))
			allTrades.push(...evaluated.trades)
			funnelCells.push(evaluated.funnel)
		}
	}
	const funnel = emptyFunnel()
	for (const cell of funnelCells) addFunnel(funnel, cell)

	const nullUniverse = allTrades.filter((trade) => NULL_SYMBOLS.includes(trade.symbol as never))
	const seq = nullUniverse.filter((trade) => trade.seq)
	const nonSeq = nullUniverse.filter((trade) => !trade.seq)
	const nullB = deterministicNullB(seq, nonSeq)
	const exactNull = requestedNullComplete && seq.length > 0 && seq.length === nullB.length
	const seqMean = summarize(seq).meanNetR
	const nullMean = summarize(nullB).meanNetR
	const nullAdvantage = exactNull && seqMean != null && nullMean != null ? seqMean - nullMean : null
	const seqVerdict = nullAdvantage == null ? 'INCONCLUSIVE' : nullAdvantage > 0 ? 'SELECTS' : 'THINS_ONLY'

	const breadth = allTrades.filter((trade) => BREADTH_SYMBOLS.includes(trade.symbol as never))
	const breadthSummary = summarize(breadth)
	const breadthStatus = !requestedBreadthComplete || breadth.length < MINIMUM_BREADTH_TRADES
		? 'INCOMPLETE'
		: (breadthSummary.clusterEqualMeanNetR ?? -Infinity) >= PAPER_THRESHOLD_R ? 'PAPER' : 'CLOSE'
	const byTf = TIMEFRAMES.map((timeframe) => ({ name: timeframe, summary: summarize(breadth.filter((trade) => trade.timeframe === timeframe)) }))
	const coveredSymbols = [...new Set(breadth.map((trade) => trade.symbol))].sort()

	const md = [
		'# FROZEN-1: Null B → ECON1-base → BREADTH1', '',
		`Период: 2024-01-01 — 2026-08-01. FROZEN-1 без подбора параметров: own2Raw 1h/2h + RELAXED 4h pool + STATIC2 (step=5.5×ATR200/1.17, TP/SL=2×step, без добора/партиала, timeout 14 дней).`,
		`Базовая экономика: ${BASE_ONE_WAY_COST_BPS} bps one-way + Binance USD-M funding proxy по фактическому удержанию. Кластер: сторона × UTC-день.`,
		`Покрытие запуска: null=${requestedNullComplete ? 'полное' : 'частичное'}, breadth=${requestedBreadthComplete ? 'полное' : 'частичное'}; символы=${allSymbols.join(', ')}, TF=${timeframes.join(', ')}.`, '',
		'## Решение', '',
		`- Null B / SEQ: **${seqVerdict}**${nullAdvantage == null ? ' — exact equal-count не достигнут, вывод запрещён.' : `; преимущество SEQ = ${formatR(nullAdvantage)}.`}`,
		`- BREADTH1: **${breadthStatus}**; raw n=${breadthSummary.trades}, clusters=${breadthSummary.clusters}, cluster-equal mean=${formatR(breadthSummary.clusterEqualMeanNetR)}.`,
		`- Parity QA: исправленный state-first replay оставил ${funnel.finalTrades} сделок из ${funnel.admittedByStateGate} state-gated (${(funnel.finalTrades / Math.max(1, funnel.admittedByStateGate) * 100).toFixed(2)}%); прежние 2175 breadth-сделок относились к ошибочной более частой стратегии.`,
		breadthStatus === 'PAPER' ? '- Планка пройдена: можно переходить к paper trading.' : breadthStatus === 'CLOSE' ? '- Планка не пройдена: FROZEN-1 закрывается честно.' : `- Для решения нужно минимум ${MINIMUM_BREADTH_TRADES} raw сделок; текущий локальный breadth не даёт права ни на paper, ни на закрытие.`, '',
		'## 1. Null B для SEQ (equal-count, side + month + TF)', '',
		...table([{ name: 'SEQ real', summary: summarize(seq) }, { name: 'non-SEQ matched control', summary: summarize(nullB) }]), '',
		`Exact equal-count: **${exactNull ? 'да' : `нет (${seq.length} vs ${nullB.length})`}**. SEQ минус control: **${formatR(nullAdvantage)}**.`, '',
		'## 2. ECON1-base', '',
		...table([{ name: 'Null-universe FROZEN-1', summary: summarize(nullUniverse) }, { name: 'Unseen breadth FROZEN-1', summary: breadthSummary }]), '',
		'Funding включён в каждую сделку только для settlement строго после entry и строго до exit. Источник — Binance USD-M proxy, не точная история BingX.', '',
		'## 3. BREADTH1', '',
		`Заранее заданные unseen относительно G2/IMP2 символы: ${BREADTH_SYMBOLS.join(', ')}.`,
		`Сделки получены на: ${coveredSymbols.length ? coveredSymbols.join(', ') : 'ни на одном символе'}.`, '',
		...table([{ name: 'ALL', summary: breadthSummary }, ...byTf]), '',
		'## 4. QA-воронка FROZEN-1', '',
		'Порядок parity: raw signal → STATIC2 replay/state occupancy → RELAXED context. Отклонённый контекстом replayable-сигнал всё равно блокирует поток до exit + 3 bars, как в IMP2.', '',
		...funnelTable(funnel), '',
		`Итоговая доля RELAXED среди state-gated: **${(funnel.finalTrades / Math.max(1, funnel.admittedByStateGate) * 100).toFixed(2)}%**.`, '',
		'## Ограничения', '',
		'- Это ровно одна FROZEN-1; FIB/HTF/SEQ-комбинации здесь не ранжировались.',
		'- Кластеризация light: одинаковая сторона в один UTC-день считается одним эпизодом.',
		'- Если raw n < 100, BREADTH1 имеет статус INCOMPLETE независимо от знака результата.',
		'- SEQ может перейти в FROZEN-2 только при валидном exact equal-count и положительном преимуществе.',
		...(warnings.length ? ['', '## Предупреждения данных', '', ...warnings.map((warning) => `- ${warning}`)] : []), '',
	]
	const report = `${md.join('\n')}\n`
	const json = {
		generatedAt: new Date().toISOString(),
		frozen: { signal: 'own2Raw', timeframes: TIMEFRAMES, context: 'RELAXED 4h pool', step: '5.5*ATR200/1.17', exits: 'STATIC2 no-add no-partial, 14d timeout', oneWayCostBps: BASE_ONE_WAY_COST_BPS },
		coverage: { requestedSymbols: allSymbols, requestedTimeframes: timeframes, completeNull: requestedNullComplete, completeBreadth: requestedBreadthComplete },
		qa: { stateGateOrder: 'raw replay/state first, RELAXED context second', contextDecisionAt: 'signal timestamp', funnel, funnelCells },
		nullB: { exact: exactNull, verdict: seqVerdict, advantageR: nullAdvantage, real: summarize(seq), control: summarize(nullB) },
		breadth: { status: breadthStatus, minimumTrades: MINIMUM_BREADTH_TRADES, thresholdR: PAPER_THRESHOLD_R, symbols: BREADTH_SYMBOLS, coveredSymbols, summary: breadthSummary, byTimeframe: byTf },
		warnings,
		trades: allTrades,
	}
	writeFileSync(resolve('ci-results/zonda-quick-profitability-scan.json'), `${JSON.stringify(json, null, 2)}\n`)
	writeFileSync(resolve('outputs/zonda-quick-profitability-scan-2026-08-07.md'), report)
	console.log(report)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
