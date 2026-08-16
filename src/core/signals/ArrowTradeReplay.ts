import type { Candle } from '../../models/price/Candle.js'
import type { ApexBand } from './ApexEngine.js'
import type { ArrowMode, ArrowSide, ArrowSignal } from './ArrowSignalEngine.js'

export const ARROW_TRADE_REPLAY_VERSION = 'signal-arrows-replay-1.2-geo4-moving-close'

export type ArrowTradeOutcome =
	| 'full-tp'
	| 'partial-be'
	| 'partial-stop'
	| 'stop'
	| 'timeout'
	| 'open'

export type ArrowTradeEventType = 'entry' | 'add' | 'partial' | 'full' | 'stop' | 'breakeven' | 'timeout' | 'open'

export interface ArrowModeConfig {
	stepDivisor: number
	stopSteps: number
	management: 'dynamic-partial' | 'static-full'
	partialFraction: number
	postExitBars: number
	maxHoldingBars: number
	oneWayCostBps: number
}

/** GEO4 calibrated geometry; costs use the later BingX small-size 7 bps assumption. */
export const ARROW_MODE_CONFIGS: Record<ArrowMode, ArrowModeConfig> = {
	safe: { stepDivisor: 1, stopSteps: 2, management: 'dynamic-partial', partialFraction: 0.25, postExitBars: 3, maxHoldingBars: 2_000, oneWayCostBps: 7 },
	standard: { stepDivisor: 1.17, stopSteps: 1.75, management: 'static-full', partialFraction: 0, postExitBars: 3, maxHoldingBars: 2_000, oneWayCostBps: 7 },
	risk: { stepDivisor: 1.43, stopSteps: 2, management: 'dynamic-partial', partialFraction: 0.25, postExitBars: 3, maxHoldingBars: 2_000, oneWayCostBps: 7 },
}

export interface ArrowTradeEvent {
	type: ArrowTradeEventType
	index: number
	at: number
	price: number
}

export interface ArrowManagementPoint {
	index: number
	at: number
	mean: number
	oppositeInner: number
}

export interface ArrowTrade {
	version: string
	id: string
	mode: ArrowMode
	side: ArrowSide
	signalIndex: number
	signalAt: number
	entryIndex: number
	entryAt: number
	exitIndex: number | null
	exitAt: number | null
	entry: number
	add: number
	addFilled: boolean
	averageEntry: number
	stop: number
	/** Deprecated compatibility alias: actual Partial event price, never a target fallback. */
	partial: number | null
	/** Deprecated compatibility alias: actual Full event price, or static Standard target before an event. */
	full: number | null
	eventPrices: {
		partial: number | null
		full: number | null
	}
	currentLevels: {
		mean: number | null
		oppositeInner: number | null
		staticFull: number | null
	}
	outcome: ArrowTradeOutcome
	partialTaken: boolean
	holdingBars: number
	grossR: number
	costR: number
	netR: number
	events: ArrowTradeEvent[]
	management: 'moving-apex' | 'static'
	trajectory: ArrowManagementPoint[]
	trigger: ArrowSignal['trigger']
}

export interface ArrowTradeSummary {
	signals: number
	fullTp: number
	partial: number
	partialBe: number
	partialStop: number
	stop: number
	timeout: number
	open: number
	totalNetR: number
	meanNetR: number | null
	profitFactor: number | null
	positiveRate: number | null
	/** Vendor-style finalized WR: (terminal partial + terminal full) / (terminal partial + stop + terminal full). */
	vendorStyleWinrate: number
	medianHoldingBars: number | null
	long: number
	short: number
}

export interface ArrowReplayResult {
	version: string
	mode: ArrowMode
	trades: ArrowTrade[]
	signals: ArrowSignal[]
	summary: ArrowTradeSummary
}

const favorableWick = (side: ArrowSide, candle: Candle, level: number): boolean => side === 'long' ? candle.high >= level : candle.low <= level
const adverseWick = (side: ArrowSide, candle: Candle, level: number): boolean => side === 'long' ? candle.low <= level : candle.high >= level
const directionalPnl = (side: ArrowSide, entry: number, exit: number): number => side === 'long' ? exit - entry : entry - exit

function median(values: readonly number[]): number | null {
	if (!values.length) return null
	const sorted = [...values].sort((a, b) => a - b)
	const middle = Math.floor(sorted.length / 2)
	return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

export function summarizeArrowTrades(trades: readonly ArrowTrade[], includeCosts = true): ArrowTradeSummary {
	const values = trades.map((trade) => includeCosts ? trade.netR : trade.grossR).filter(Number.isFinite)
	const gains = values.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
	const losses = -values.filter((value) => value < 0).reduce((sum, value) => sum + value, 0)
	const fullTpCount = trades.filter((trade) => trade.outcome === 'full-tp').length
	const partialCount = trades.filter((trade) => trade.outcome === 'partial-be' || trade.outcome === 'partial-stop').length
	const stopCount = trades.filter((trade) => trade.outcome === 'stop').length
	// Vendor-style finalized taxonomy is terminal and mutually exclusive. Open/timeout are reported separately.
	const finalizedCount = partialCount + stopCount + fullTpCount
	const vendorStyleWinrate = finalizedCount ? (partialCount + fullTpCount) / finalizedCount : 0

	return {
		signals: trades.length,
		fullTp: fullTpCount,
		partial: partialCount,
		partialBe: trades.filter((trade) => trade.outcome === 'partial-be').length,
		partialStop: trades.filter((trade) => trade.outcome === 'partial-stop').length,
		stop: trades.filter((trade) => trade.outcome === 'stop').length,
		timeout: trades.filter((trade) => trade.outcome === 'timeout').length,
		open: trades.filter((trade) => trade.outcome === 'open').length,
		totalNetR: values.reduce((sum, value) => sum + value, 0),
		meanNetR: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
		profitFactor: losses > 0 ? gains / losses : gains > 0 ? Number.POSITIVE_INFINITY : null,
		positiveRate: values.length ? values.filter((value) => value > 0).length / values.length : null,
		vendorStyleWinrate,
		medianHoldingBars: median(trades.map((trade) => trade.holdingBars)),
		long: trades.filter((trade) => trade.side === 'long').length,
		short: trades.filter((trade) => trade.side === 'short').length,
	}
}

/**
 * GEO4 execution replay. Within one OHLC bar the conservative order is:
 * add fill -> stop -> partial -> BE/full. Therefore a same-bar stop/target
 * ambiguity is always a stop, matching the research runner's frozen rule.
 */
export function replayArrowTrade(
	candles: readonly Candle[],
	bands: readonly ApexBand[],
	signal: ArrowSignal,
	mode: ArrowMode,
	partial: Partial<ArrowModeConfig> = {},
): ArrowTrade | null {
	const config = { ...ARROW_MODE_CONFIGS[mode], ...partial }
	const entryIndex = signal.signalIndex + 1
	const entryCandle = candles[entryIndex]
	if (entryCandle == null || !Number.isFinite(signal.atr200) || signal.atr200 <= 0) return null
	const step = 5.5 * signal.atr200 / config.stepDivisor
	const entry = entryCandle.open
	if (!(entry > 0) || !(step > 0)) return null
	const add = signal.side === 'long' ? entry - step : entry + step
	let stop = signal.side === 'long' ? entry - config.stopSteps * step : entry + config.stopSteps * step
	const staticFull = signal.side === 'long' ? entry + 2 * step : entry - 2 * step
	const averageFullEntry = (entry + add) / 2
	const oneR = Math.abs(averageFullEntry - stop) * 2
	if (!(oneR > 0)) return null

	const events: ArrowTradeEvent[] = [{ type: 'entry', index: entryIndex, at: entryCandle.timestamp, price: entry }]
	let addFilled = false
	let partialTaken = false
	let partialPrice: number | null = null
	let fullEventPrice: number | null = null
	let exitIndex: number | null = null
	let exitPrice = entry
	let outcome: ArrowTradeOutcome = 'open'
	let averageEntry = entry
	let weight = 1
	let realizedPnl = 0
	let turnoverNotional = Math.abs(entry)
	let fullTarget = staticFull
	const trajectory: ArrowManagementPoint[] = []
	const lastIndex = Math.min(candles.length - 1, entryIndex + config.maxHoldingBars - 1)

	for (let index = entryIndex; index <= lastIndex; index++) {
		const candle = candles[index]!
		const band = bands[index]
		if (!addFilled && adverseWick(signal.side, candle, add)) {
			addFilled = true
			// The add is one original unit. If Partial happened first, only
			// (1 - partialFraction) of the entry lot remains, so its blended
			// basis is not the 50/50 average used by an add-before-partial fill.
			averageEntry = (averageEntry * weight + add) / (weight + 1)
			weight += 1
			turnoverNotional += Math.abs(add)
			events.push({ type: 'add', index, at: candle.timestamp, price: add })
		}
		if (adverseWick(signal.side, candle, stop)) {
			exitIndex = index
			exitPrice = stop
			outcome = partialTaken ? 'partial-stop' : 'stop'
			turnoverNotional += Math.abs(stop) * weight
			events.push({ type: 'stop', index, at: candle.timestamp, price: stop })
			break
		}
		if (config.management === 'static-full') {
			if (favorableWick(signal.side, candle, staticFull)) {
				exitIndex = index
				exitPrice = staticFull
				outcome = 'full-tp'
				fullEventPrice = staticFull
				turnoverNotional += Math.abs(staticFull) * weight
				events.push({ type: 'full', index, at: candle.timestamp, price: staticFull })
				break
			}
			continue
		}
		if (band == null || !Number.isFinite(band.mean)) continue
		fullTarget = signal.side === 'long' ? band.redLo : band.greenHi
		if (!Number.isFinite(fullTarget)) continue
		trajectory.push({ index, at: candle.timestamp, mean: band.mean, oppositeInner: fullTarget })
		const meanInProfit = signal.side === 'long' ? band.mean > averageEntry : band.mean < averageEntry
		if (!partialTaken && meanInProfit && favorableWick(signal.side, candle, band.mean)) {
			const closedWeight = weight * config.partialFraction
			realizedPnl += directionalPnl(signal.side, averageEntry, band.mean) * closedWeight
			weight -= closedWeight
			turnoverNotional += Math.abs(band.mean) * closedWeight
			partialTaken = true
			partialPrice = band.mean
			events.push({ type: 'partial', index, at: candle.timestamp, price: band.mean })
		}

		if ((signal.side === 'long' ? candle.close >= fullTarget : candle.close <= fullTarget)) {
			exitIndex = index
			exitPrice = fullTarget
			outcome = 'full-tp'
			fullEventPrice = fullTarget
			turnoverNotional += Math.abs(fullTarget) * weight
			events.push({ type: 'full', index, at: candle.timestamp, price: fullTarget })
			break
		}
	}

	if (exitIndex == null && lastIndex < candles.length - 1) {
		exitIndex = lastIndex
		exitPrice = candles[lastIndex]!.close
		outcome = 'timeout'
		turnoverNotional += Math.abs(exitPrice) * weight
		events.push({ type: 'timeout', index: lastIndex, at: candles[lastIndex]!.timestamp, price: exitPrice })
	} else if (exitIndex == null) {
		exitPrice = candles[candles.length - 1]!.close
		events.push({ type: 'open', index: candles.length - 1, at: candles[candles.length - 1]!.timestamp, price: exitPrice })
	}

	const grossR = (realizedPnl + directionalPnl(signal.side, averageEntry, exitPrice) * weight) / oneR
	const costR = (turnoverNotional * config.oneWayCostBps / 10_000) / oneR
	return {
		version: ARROW_TRADE_REPLAY_VERSION,
		id: `${mode}-${signal.side}-${signal.signalAt}`,
		mode,
		side: signal.side,
		signalIndex: signal.signalIndex,
		signalAt: signal.signalAt,
		entryIndex,
		entryAt: entryCandle.timestamp,
		exitIndex,
		exitAt: exitIndex == null ? null : candles[exitIndex]!.timestamp,
		entry,
		add,
		addFilled,
		averageEntry,
		stop,
		partial: partialPrice,
		full: config.management === 'static-full' ? staticFull : fullEventPrice,
		eventPrices: { partial: partialPrice, full: fullEventPrice },
		currentLevels: {
			mean: config.management === 'dynamic-partial' ? trajectory.at(-1)?.mean ?? null : null,
			oppositeInner: config.management === 'dynamic-partial' ? trajectory.at(-1)?.oppositeInner ?? null : null,
			staticFull: config.management === 'static-full' ? staticFull : null,
		},
		outcome,
		partialTaken,
		holdingBars: (exitIndex ?? candles.length - 1) - entryIndex + 1,
		grossR,
		costR,
		netR: grossR - costR,
		events,
		management: config.management === 'dynamic-partial' ? 'moving-apex' : 'static',
		trajectory,
		trigger: signal.trigger,
	}
}

/** Apply one per-mode state slot: open trade plus post-exit quiet bars. */
export function replayArrowSignals(
	candles: readonly Candle[],
	bands: readonly ApexBand[],
	candidates: readonly ArrowSignal[],
	mode: ArrowMode,
	partial: Partial<ArrowModeConfig> = {},
): ArrowReplayResult {
	const config = { ...ARROW_MODE_CONFIGS[mode], ...partial }
	const signals: ArrowSignal[] = []
	const trades: ArrowTrade[] = []
	let blockedUntil = -1
	for (const signal of candidates) {
		if (signal.signalIndex <= blockedUntil) continue
		const trade = replayArrowTrade(candles, bands, signal, mode, config)
		if (trade == null) continue
		signals.push(signal)
		trades.push(trade)
		blockedUntil = trade.exitIndex == null ? candles.length : trade.exitIndex + config.postExitBars
	}
	return { version: ARROW_TRADE_REPLAY_VERSION, mode, trades, signals, summary: summarizeArrowTrades(trades) }
}

/**
 * Regime-independent replay (A1). Every admitted arrow is its own independent
 * trade — there is NO per-mode exit-cooldown, so safe/standard/risk all trade
 * the SAME arrow set and differ only in management (geometry/partials). Signal
 * admission (min-spacing in bars) must be done upstream with `admitArrowSignals`;
 * this function does not thin the input. Use this on the visualizer/benchmark
 * path. `replayArrowSignals` (regime-dependent exit-cooldown) is preserved
 * unchanged for backward compatibility with existing callers/tests.
 */
export function replayAdmittedArrowSignals(
	candles: readonly Candle[],
	bands: readonly ApexBand[],
	admitted: readonly ArrowSignal[],
	mode: ArrowMode,
	partial: Partial<ArrowModeConfig> = {},
): ArrowReplayResult {
	const config = { ...ARROW_MODE_CONFIGS[mode], ...partial }
	const signals: ArrowSignal[] = []
	const trades: ArrowTrade[] = []
	for (const signal of admitted) {
		const trade = replayArrowTrade(candles, bands, signal, mode, config)
		if (trade == null) continue
		signals.push(signal)
		trades.push(trade)
	}
	return { version: ARROW_TRADE_REPLAY_VERSION, mode, trades, signals, summary: summarizeArrowTrades(trades) }
}
