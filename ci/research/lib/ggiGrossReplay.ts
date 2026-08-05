import type { ExactIndicatorRow } from './exactIndicatorExport.js'

export type GgiDirection = 'long' | 'short'
export type GgiEntryTiming = 'next-open' | 'signal-close'
export type GgiIntrabarOrder = 'stop-first' | 'target-first'
export type GgiStopFamily = 'atr' | 'outer-band' | 'inner-band' | 'swing' | 'atr-plus-outer' | 'atr-plus-swing'
export type GgiTargetMode = 'dynamic' | 'standard-fixed'
export type GgiOutcome = 'Partial' | 'Stop' | 'Full fix' | 'Unresolved'

export interface GgiGrossReplayConfig {
	entryTiming: GgiEntryTiming
	intrabarOrder: GgiIntrabarOrder
	stopFamily: GgiStopFamily
	targetMode: GgiTargetMode
	standardTargetR: number
	stopMultiplier: number
	atrPeriod: number
	atrMultiplier: number
	addEnabled: boolean
	breakEvenAfterPartial: boolean
	partialFraction: number
	addFraction: number
	maxHoldingBars: number
	warmupBars: number
}

export const DEFAULT_GGI_GROSS_REPLAY_CONFIG: GgiGrossReplayConfig = {
	entryTiming: 'next-open',
	intrabarOrder: 'stop-first',
	stopFamily: 'atr',
	targetMode: 'dynamic',
	standardTargetR: 1.14,
	stopMultiplier: 1,
	atrPeriod: 14,
	atrMultiplier: 1,
	addEnabled: true,
	breakEvenAfterPartial: true,
	partialFraction: 0.25,
	addFraction: 0.5,
	maxHoldingBars: 2000,
	warmupBars: 100,
}

export interface GgiGrossTrade {
	index: number
	direction: GgiDirection
	entryIndex: number
	entryPrice: number
	initialStop: number
	addPrice: number
	averagePrice: number
	added: boolean
	partialIndex: number | null
	fullIndex: number | null
	exitIndex: number | null
	outcome: GgiOutcome
	grossR: number | null
	mfeR: number
	maeR: number
	holdingBars: number | null
}

export interface GgiGrossSummary {
	config: GgiGrossReplayConfig
	trades: number
	partial: number
	stop: number
	fullFix: number
	unresolved: number
	winrate: number | null
	meanGrossR: number | null
	tradesWithAdd: number
	tradesWithPartial: number
	tradesWithFull: number
}

function atrSeries(rows: readonly ExactIndicatorRow[], period: number): Array<number | null> {
	const out: Array<number | null> = Array.from({ length: rows.length }, () => null)
	let previousClose: number | null = null
	let previousAtr: number | null = null
	const ranges: number[] = []
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]!
		const tr = previousClose == null
			? row.high - row.low
			: Math.max(row.high - row.low, Math.abs(row.high - previousClose), Math.abs(row.low - previousClose))
		ranges.push(tr)
		if (ranges.length >= period) {
			const atr: number = previousAtr == null
				? ranges.slice(-period).reduce((sum, value) => sum + value, 0) / period
				: (previousAtr * (period - 1) + tr) / period
			previousAtr = atr
			out[i] = atr
		}
		previousClose = row.close
	}
	return out
}

function validBand(row: ExactIndicatorRow): boolean {
	return row.lowerOuter < row.lowerInner && row.lowerInner < row.mean && row.mean < row.upperInner && row.upperInner < row.upperOuter
}

function stopFor(
	rows: readonly ExactIndicatorRow[],
	entryIndex: number,
	entryPrice: number,
	direction: GgiDirection,
	atr: number,
	config: GgiGrossReplayConfig,
): number {
	const row = rows[entryIndex]!
	if (config.stopFamily === 'atr') {
		return direction === 'long'
			? entryPrice - atr * config.atrMultiplier
			: entryPrice + atr * config.atrMultiplier
	}
	if (config.stopFamily === 'outer-band') {
		const anchor = direction === 'long' ? row.lowerOuter : row.upperOuter
		return entryPrice + (anchor - entryPrice) * config.stopMultiplier
	}
	if (config.stopFamily === 'inner-band') {
		const anchor = direction === 'long' ? row.lowerInner : row.upperInner
		return entryPrice + (anchor - entryPrice) * config.stopMultiplier
	}
	const lookback = Math.min(20, entryIndex)
	const window = rows.slice(entryIndex - lookback, entryIndex + 1)
	const swing = direction === 'long'
		? Math.min(...window.map((candidate) => candidate.low))
		: Math.max(...window.map((candidate) => candidate.high))
	if (config.stopFamily === 'atr-plus-outer') {
		const outer = direction === 'long' ? row.lowerOuter : row.upperOuter
		const distance = atr * config.atrMultiplier + Math.abs(entryPrice - outer) * config.stopMultiplier
		return direction === 'long' ? entryPrice - distance : entryPrice + distance
	}
	if (config.stopFamily === 'atr-plus-swing') {
		const distance = atr * config.atrMultiplier + Math.abs(entryPrice - swing) * config.stopMultiplier
		return direction === 'long' ? entryPrice - distance : entryPrice + distance
	}
	return swing
}

function directionPnl(direction: GgiDirection, entry: number, exit: number): number {
	return direction === 'long' ? exit - entry : entry - exit
}

function reached(direction: GgiDirection, high: number, low: number, level: number): boolean {
	return direction === 'long' ? high >= level : low <= level
}

function stopReached(direction: GgiDirection, high: number, low: number, stop: number): boolean {
	return direction === 'long' ? low <= stop : high >= stop
}

function addReached(direction: GgiDirection, high: number, low: number, addPrice: number): boolean {
	return direction === 'long' ? low <= addPrice : high >= addPrice
}

function emptyTrade(index: number, direction: GgiDirection, entryIndex: number, entryPrice: number, stop: number, addPrice: number): GgiGrossTrade {
	return {
		index,
		direction,
		entryIndex,
		entryPrice,
		initialStop: stop,
		addPrice,
		averagePrice: entryPrice,
		added: false,
		partialIndex: null,
		fullIndex: null,
		exitIndex: null,
		outcome: 'Unresolved',
		grossR: null,
		mfeR: 0,
		maeR: 0,
		holdingBars: null,
	}
}

export function replayGgiTrade(
	rows: readonly ExactIndicatorRow[],
	signalIndex: number,
	partial: Partial<GgiGrossReplayConfig> = {},
): GgiGrossTrade | null {
	const config = { ...DEFAULT_GGI_GROSS_REPLAY_CONFIG, ...partial }
	const signal = rows[signalIndex]
	if (signal == null || signalIndex < config.warmupBars || !validBand(signal) || (!signal.buy && !signal.sell)) return null
	const direction: GgiDirection = signal.buy ? 'long' : 'short'
	const entryIndex = config.entryTiming === 'next-open' ? signalIndex + 1 : signalIndex
	const entryRow = rows[entryIndex]
	if (entryRow == null) return null
	const atrs = atrSeries(rows, config.atrPeriod)
	const atr = atrs[entryIndex]
	if (atr == null || atr <= 0 || !validBand(entryRow)) return null
	const entryPrice = config.entryTiming === 'next-open' ? entryRow.open : entryRow.close
	const initialStop = stopFor(rows, entryIndex, entryPrice, direction, atr, config)
	const invalidStop = direction === 'long' ? initialStop >= entryPrice : initialStop <= entryPrice
	if (invalidStop) return null
	const risk = Math.abs(entryPrice - initialStop)
	const addPrice = direction === 'long' ? entryPrice - risk * 0.5 : entryPrice + risk * 0.5
	const fixedTarget = direction === 'long'
		? entryPrice + config.standardTargetR * risk
		: entryPrice - config.standardTargetR * risk
	const trade = emptyTrade(signalIndex, direction, entryIndex, entryPrice, initialStop, addPrice)
	let currentStop = initialStop
	let averagePrice = entryPrice
	let remainingFraction = 1
	let realizedPnl = 0
	let partialDone = false
	let addDone = false
	let exitPrice: number | null = null
	for (let i = entryIndex; i < rows.length && i < entryIndex + config.maxHoldingBars; i++) {
		const row = rows[i]!
		trade.mfeR = Math.max(trade.mfeR, direction === 'long' ? (row.high - averagePrice) / risk : (averagePrice - row.low) / risk)
		trade.maeR = Math.min(trade.maeR, direction === 'long' ? (row.low - averagePrice) / risk : (averagePrice - row.high) / risk)
		const hitStop = stopReached(direction, row.high, row.low, currentStop)
		const fullTarget = config.targetMode === 'standard-fixed'
			? fixedTarget
			: direction === 'long' ? row.upperInner : row.lowerInner
		const hitFull = (config.targetMode === 'standard-fixed' || validBand(row))
			&& reached(direction, row.high, row.low, fullTarget)
		const hitPartial = config.targetMode === 'dynamic'
			&& !partialDone
			&& validBand(row)
			&& reached(direction, row.high, row.low, row.mean)
		const hitAdd = config.addEnabled && !addDone && addReached(direction, row.high, row.low, addPrice)
		const events = config.intrabarOrder === 'stop-first'
			? ['stop', 'add', 'partial', 'full']
			: ['add', 'partial', 'full', 'stop']
		for (const event of events) {
			if (event === 'add' && hitAdd && !addDone) {
				addDone = true
				averagePrice = (entryPrice * (1 - config.addFraction) + addPrice * config.addFraction)
				trade.added = true
				trade.averagePrice = averagePrice
				continue
			}
			if (event === 'partial' && hitPartial && !partialDone) {
				partialDone = true
				trade.partialIndex = i
				realizedPnl += directionPnl(direction, averagePrice, row.mean) * config.partialFraction
				remainingFraction -= config.partialFraction
				if (config.breakEvenAfterPartial) currentStop = averagePrice
				continue
			}
			if (event === 'full' && hitFull) {
				trade.fullIndex = i
				trade.exitIndex = i
				trade.outcome = 'Full fix'
				exitPrice = fullTarget
				break
			}
			if (event === 'stop' && hitStop) {
				trade.exitIndex = i
				trade.outcome = partialDone ? 'Partial' : 'Stop'
				exitPrice = currentStop
				break
			}
		}
		if (trade.exitIndex != null) break
	}
	if (trade.exitIndex == null || exitPrice == null) return trade
	trade.averagePrice = averagePrice
	trade.grossR = (realizedPnl + directionPnl(direction, averagePrice, exitPrice) * remainingFraction) / risk
	trade.holdingBars = trade.exitIndex - entryIndex + 1
	return trade
}

export function collectGgiGrossTrades(
	rows: readonly ExactIndicatorRow[],
	partial: Partial<GgiGrossReplayConfig> = {},
): GgiGrossTrade[] {
	const trades: GgiGrossTrade[] = []
	for (let i = 0; i < rows.length; i++) {
		if (!rows[i]!.buy && !rows[i]!.sell) continue
		const trade = replayGgiTrade(rows, i, partial)
		if (trade != null) trades.push(trade)
	}
	return trades
}

export function summarizeGgiGrossTrades(
	trades: readonly GgiGrossTrade[],
	config: GgiGrossReplayConfig,
): GgiGrossSummary {
	const partial = trades.filter((trade) => trade.outcome === 'Partial').length
	const stop = trades.filter((trade) => trade.outcome === 'Stop').length
	const fullFix = trades.filter((trade) => trade.outcome === 'Full fix').length
	const unresolved = trades.filter((trade) => trade.outcome === 'Unresolved').length
	const closed = trades.filter((trade) => trade.grossR != null)
	return {
		config,
		trades: trades.length,
		partial,
		stop,
		fullFix,
		unresolved,
		winrate: trades.length > 0 ? (partial + fullFix) / trades.length : null,
		meanGrossR: closed.length > 0 ? closed.reduce((sum, trade) => sum + trade.grossR!, 0) / closed.length : null,
		tradesWithAdd: trades.filter((trade) => trade.added).length,
		tradesWithPartial: trades.filter((trade) => trade.partialIndex != null).length,
		tradesWithFull: trades.filter((trade) => trade.fullIndex != null).length,
	}
}
