import type { ExactIndicatorRow } from './exactIndicatorExport.js'

export type CorrectedGgiSide = 1 | -1
export type CorrectedGgiMode = 'Safe' | 'Risk'
export type CorrectedGgiBeBound = 'optimistic-initial-stop' | 'next-bar-blended-be' | 'next-bar-entry-be'
export type CorrectedGgiOutcome = 'Stop' | 'Partial' | 'Full fix' | 'End mark'

export interface CorrectedGgiReplayConfig {
	stopMultiplier: number
	beBound: CorrectedGgiBeBound
	addEnabled: boolean
	partialFraction: number
	maxHoldingBars: number
}

export const DEFAULT_CORRECTED_GGI_REPLAY_CONFIG: CorrectedGgiReplayConfig = {
	stopMultiplier: 12,
	beBound: 'optimistic-initial-stop',
	addEnabled: false,
	partialFraction: 0.25,
	maxHoldingBars: 20_000,
}

export interface CorrectedGgiTrade {
	signalIndex: number
	signalTimestamp: number
	entryIndex: number
	exitIndex: number
	side: CorrectedGgiSide
	entryPrice: number
	initialStop: number
	stopDistance: number
	addPrice: number
	averagePrice: number
	added: boolean
	partial: boolean
	partialIndex: number | null
	fullIndex: number | null
	outcome: CorrectedGgiOutcome
	grossReturnPct: number
	grossR: number
	plannedRiskPct: number
	turnover: number
	holdingBars: number
}

export function validGgiBand(row: ExactIndicatorRow): boolean {
	return row.lowerOuter < row.lowerInner
		&& row.lowerInner < row.mean
		&& row.mean < row.upperInner
		&& row.upperInner < row.upperOuter
}

export function ggiSide(row: ExactIndicatorRow): CorrectedGgiSide | null {
	if (row.buy) return 1
	if (row.sell) return -1
	return null
}

export function trueRangeSma(
	rows: readonly ExactIndicatorRow[],
	period: number,
): Array<number | null> {
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

function favourableWick(side: CorrectedGgiSide, row: ExactIndicatorRow, level: number): boolean {
	return side === 1 ? row.high >= level : row.low <= level
}

function favourableClose(side: CorrectedGgiSide, row: ExactIndicatorRow, level: number): boolean {
	return side === 1 ? row.close >= level : row.close <= level
}

function adverseWick(side: CorrectedGgiSide, row: ExactIndicatorRow, level: number): boolean {
	return side === 1 ? row.low <= level : row.high >= level
}

function pnlPct(side: CorrectedGgiSide, from: number, to: number, weight: number): number {
	return side * (to - from) / from * weight * 100
}

export function replayCorrectedGgiTrade(
	rows: readonly ExactIndicatorRow[],
	tr55: readonly (number | null)[],
	signalIndex: number,
	partial: Partial<CorrectedGgiReplayConfig> = {},
): CorrectedGgiTrade | null {
	const config = { ...DEFAULT_CORRECTED_GGI_REPLAY_CONFIG, ...partial }
	const signal = rows[signalIndex]
	const side = signal == null ? null : ggiSide(signal)
	const entryIndex = signalIndex + 1
	const entryRow = rows[entryIndex]
	const volatility = tr55[signalIndex]
	if (
		signal == null
		|| side == null
		|| entryRow == null
		|| volatility == null
		|| volatility <= 0
		|| !validGgiBand(signal)
		|| !validGgiBand(entryRow)
	) return null

	const entryPrice = entryRow.open
	const stopDistance = volatility * config.stopMultiplier
	const initialStop = entryPrice - side * stopDistance
	const addPrice = entryPrice - side * stopDistance * 0.5
	const initialWeight = config.addEnabled ? 0.5 : 1
	const plannedRiskWeight = config.addEnabled ? 0.75 : 1
	const plannedRiskPct = stopDistance / entryPrice * 100 * plannedRiskWeight
	let activeWeight = initialWeight
	let averagePrice = entryPrice
	let turnover = initialWeight
	let realisedPct = 0
	let added = false
	let partialDone = false
	let partialIndex: number | null = null
	let fullIndex: number | null = null
	let breakEvenActiveFrom = Number.POSITIVE_INFINITY

	const finish = (outcome: CorrectedGgiOutcome, exitIndex: number, exitPrice: number): CorrectedGgiTrade => {
		const finalPct = realisedPct + pnlPct(side, averagePrice, exitPrice, activeWeight)
		turnover += activeWeight
		return {
			signalIndex,
			signalTimestamp: signal.timestamp,
			entryIndex,
			exitIndex,
			side,
			entryPrice,
			initialStop,
			stopDistance,
			addPrice,
			averagePrice,
			added,
			partial: partialDone,
			partialIndex,
			fullIndex,
			outcome,
			grossReturnPct: finalPct,
			grossR: plannedRiskPct > 0 ? finalPct / plannedRiskPct : 0,
			plannedRiskPct,
			turnover,
			holdingBars: exitIndex - entryIndex + 1,
		}
	}

	const lastIndex = Math.min(rows.length - 1, entryIndex + config.maxHoldingBars - 1)
	for (let i = entryIndex; i <= lastIndex; i++) {
		const row = rows[i]!
		if (!validGgiBand(row)) continue

		// The midpoint add is crossed before the initial stop. It is disabled
		// after Partial because the confirmed vendor sequence is entry/add -> Partial -> BE.
		if (config.addEnabled && !added && !partialDone && adverseWick(side, row, addPrice)) {
			added = true
			activeWeight += 0.5
			turnover += 0.5
			averagePrice = (entryPrice * initialWeight + addPrice * 0.5) / activeWeight
		}

		let activeStop = initialStop
		if (partialDone && i >= breakEvenActiveFrom) {
			if (config.beBound === 'next-bar-blended-be') activeStop = averagePrice
			if (config.beBound === 'next-bar-entry-be') activeStop = entryPrice
		}

		// Frozen conservative OHLC ordering: an adverse stop wick has priority.
		if (adverseWick(side, row, activeStop)) {
			return finish(partialDone ? 'Partial' : 'Stop', i, activeStop)
		}

		const partialLevel = row.mean
		if (!partialDone && favourableWick(side, row, partialLevel)) {
			partialDone = true
			partialIndex = i
			const exitWeight = activeWeight * config.partialFraction
			realisedPct += pnlPct(side, averagePrice, partialLevel, exitWeight)
			activeWeight -= exitWeight
			turnover += exitWeight
			if (config.beBound !== 'optimistic-initial-stop') breakEvenActiveFrom = i + 1
		}

		// Corrected terminal rule: a wick through Inner is insufficient. Full is
		// confirmed only when the candle closes beyond the moving opposite Inner.
		const fullLevel = side === 1 ? row.upperInner : row.lowerInner
		if (favourableClose(side, row, fullLevel)) {
			fullIndex = i
			return finish('Full fix', i, fullLevel)
		}
	}

	const last = rows[lastIndex]!
	return finish('End mark', lastIndex, last.close)
}

export function collectCorrectedGgiTrades(
	rows: readonly ExactIndicatorRow[],
	tr55: readonly (number | null)[],
	partial: Partial<CorrectedGgiReplayConfig> = {},
	warmupBars = 100,
): CorrectedGgiTrade[] {
	const trades: CorrectedGgiTrade[] = []
	for (let i = warmupBars; i < rows.length; i++) {
		if (ggiSide(rows[i]!) == null) continue
		const trade = replayCorrectedGgiTrade(rows, tr55, i, partial)
		if (trade != null) trades.push(trade)
	}
	return trades
}

export function applyOneWayCostBps(trade: CorrectedGgiTrade, oneWayCostBps: number): { netReturnPct: number; netR: number } {
	const costPct = trade.turnover * oneWayCostBps / 100
	const netReturnPct = trade.grossReturnPct - costPct
	return {
		netReturnPct,
		netR: trade.plannedRiskPct > 0 ? netReturnPct / trade.plannedRiskPct : 0,
	}
}
