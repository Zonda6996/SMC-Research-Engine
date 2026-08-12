import type { Candle } from '../../models/price/Candle.js'

export interface ReversalResearchRow extends Candle {
	mean: number
	upperOuter?: number
	upperInner: number
	lowerInner: number
	lowerOuter?: number
}

type ExactIndicatorRow = ReversalResearchRow

export const REVERSAL_STATE_MACHINE_RESEARCH_VERSION = 'reversal-state-machine-research-1.0-exact-bands'

export type ReversalArmKind =
	| 'inner'
	| 'outer'
	| 'rsi25'
	| 'rsi30'
	| 'stoch20'
	| 'inner-rsi35'
	| 'inner-stoch30'
	| 'range24'
	| 'range48'

export type ReversalConfirmKind = 'directional' | 'reclaim' | 'rsi-slope' | 'stoch-slope' | 'recovery25' | 'reclaim-rsi'
export type ReversalRearmKind = 'mean' | 'inner' | 'neutral' | 'cooldown'

export interface ReversalStateMachineConfig {
	armKind: ReversalArmKind
	maxPendingBars: number
	confirmKind: ReversalConfirmKind
	rearmKind: ReversalRearmKind
	cooldownBars: number
	neutralBars: number
}

export interface ReversalStateMachineSignal {
	at: number
	index: number
	direction: 'long' | 'short'
	pendingBars: number
	armKind: ReversalArmKind
	confirmKind: ReversalConfirmKind
}

type SideState = {
	available: boolean
	pendingAt: number | null
	extreme: number
	lockedAt: number | null
	neutralCount: number
}

interface FeatureCache {
	rsi14: number[]
	stoch14: number[]
	rangeLow24: number[]
	rangeHigh24: number[]
	rangeLow48: number[]
	rangeHigh48: number[]
}

function rsi(values: number[], period: number): number[] {
	const out = new Array<number>(values.length).fill(NaN)
	let gains = 0, losses = 0
	for (let i = 1; i < values.length; i++) {
		const delta = values[i]! - values[i - 1]!
		gains += Math.max(0, delta)
		losses += Math.max(0, -delta)
		if (i > period) {
			const oldDelta = values[i - period]! - values[i - period - 1]!
			gains -= Math.max(0, oldDelta)
			losses -= Math.max(0, -oldDelta)
		}
		if (i >= period) out[i] = losses === 0 ? 100 : 100 - 100 / (1 + gains / losses)
	}
	return out
}

function stochastic(rows: ExactIndicatorRow[], period: number): number[] {
	const out = new Array<number>(rows.length).fill(NaN)
	for (let i = period - 1; i < rows.length; i++) {
		let low = Infinity, high = -Infinity
		for (let j = i - period + 1; j <= i; j++) {
			low = Math.min(low, rows[j]!.low)
			high = Math.max(high, rows[j]!.high)
		}
		out[i] = 100 * (rows[i]!.close - low) / Math.max(Number.EPSILON, high - low)
	}
	return out
}

function rollingExtremes(rows: ExactIndicatorRow[], period: number): { low: number[]; high: number[] } {
	const low = new Array<number>(rows.length).fill(NaN)
	const high = new Array<number>(rows.length).fill(NaN)
	for (let i = period - 1; i < rows.length; i++) {
		let lo = Infinity, hi = -Infinity
		for (let j = i - period + 1; j <= i; j++) {
			lo = Math.min(lo, rows[j]!.low)
			hi = Math.max(hi, rows[j]!.high)
		}
		low[i] = lo
		high[i] = hi
	}
	return { low, high }
}

export function buildReversalFeatureCache(rows: ExactIndicatorRow[]): FeatureCache {
	const r24 = rollingExtremes(rows, 24)
	const r48 = rollingExtremes(rows, 48)
	return {
		rsi14: rsi(rows.map((row) => row.close), 14),
		stoch14: stochastic(rows, 14),
		rangeLow24: r24.low,
		rangeHigh24: r24.high,
		rangeLow48: r48.low,
		rangeHigh48: r48.high,
	}
}

function outerEdge(row: ExactIndicatorRow, side: 'long' | 'short'): number {
	const ratio = 9.6 / 5.6
	return side === 'long'
		? row.mean * Math.exp(Math.log(row.lowerInner / row.mean) * ratio)
		: row.mean * Math.exp(Math.log(row.upperInner / row.mean) * ratio)
}

function armCondition(rows: ExactIndicatorRow[], features: FeatureCache, i: number, side: 'long' | 'short', kind: ReversalArmKind): boolean {
	const row = rows[i]!, rsiValue = features.rsi14[i]!, stochValue = features.stoch14[i]!
	const inner = side === 'long' ? row.low <= row.lowerInner : row.high >= row.upperInner
	if (kind === 'inner') return inner
	if (kind === 'outer') return side === 'long' ? row.low <= outerEdge(row, side) : row.high >= outerEdge(row, side)
	if (kind === 'rsi25') return side === 'long' ? rsiValue <= 25 : rsiValue >= 75
	if (kind === 'rsi30') return side === 'long' ? rsiValue <= 30 : rsiValue >= 70
	if (kind === 'stoch20') return side === 'long' ? stochValue <= 20 : stochValue >= 80
	if (kind === 'inner-rsi35') return inner && (side === 'long' ? rsiValue <= 35 : rsiValue >= 65)
	if (kind === 'inner-stoch30') return inner && (side === 'long' ? stochValue <= 30 : stochValue >= 70)
	if (kind === 'range24') return side === 'long' ? row.low <= features.rangeLow24[i]! : row.high >= features.rangeHigh24[i]!
	return side === 'long' ? row.low <= features.rangeLow48[i]! : row.high >= features.rangeHigh48[i]!
}

function confirmCondition(
	rows: ExactIndicatorRow[],
	features: FeatureCache,
	i: number,
	side: 'long' | 'short',
	state: SideState,
	kind: ReversalConfirmKind,
): boolean {
	const row = rows[i]!, previous = rows[i - 1]
	const directional = side === 'long' ? row.close > row.open : row.close < row.open
	if (!directional || state.pendingAt == null) return false
	const reclaim = side === 'long' ? row.close >= row.lowerInner : row.close <= row.upperInner
	const rsiSlope = previous != null && (side === 'long' ? features.rsi14[i]! > features.rsi14[i - 1]! : features.rsi14[i]! < features.rsi14[i - 1]!)
	const stochSlope = previous != null && (side === 'long' ? features.stoch14[i]! > features.stoch14[i - 1]! : features.stoch14[i]! < features.stoch14[i - 1]!)
	const width = Math.max(Number.EPSILON, (row.upperInner - row.lowerInner) / 2)
	const recovery = side === 'long' ? (row.close - state.extreme) / width : (state.extreme - row.close) / width
	if (kind === 'directional') return true
	if (kind === 'reclaim') return reclaim
	if (kind === 'rsi-slope') return rsiSlope
	if (kind === 'stoch-slope') return stochSlope
	if (kind === 'recovery25') return recovery >= 0.25
	return reclaim && rsiSlope
}

function rearmCondition(row: ExactIndicatorRow, side: 'long' | 'short', state: SideState, config: ReversalStateMachineConfig, i: number): boolean {
	if (state.lockedAt == null || i - state.lockedAt < config.cooldownBars) return false
	if (config.rearmKind === 'cooldown') return true
	if (config.rearmKind === 'mean') return side === 'long' ? row.close >= row.mean : row.close <= row.mean
	if (config.rearmKind === 'inner') return side === 'long' ? row.close >= row.lowerInner : row.close <= row.upperInner
	const neutral = row.close >= row.lowerInner && row.close <= row.upperInner
	state.neutralCount = neutral ? state.neutralCount + 1 : 0
	return state.neutralCount >= config.neutralBars
}

export function detectReversalStateMachine(
	rows: ExactIndicatorRow[],
	config: ReversalStateMachineConfig,
	features = buildReversalFeatureCache(rows),
): ReversalStateMachineSignal[] {
	const out: ReversalStateMachineSignal[] = []
	const states: Record<'long' | 'short', SideState> = {
		long: { available: true, pendingAt: null, extreme: Infinity, lockedAt: null, neutralCount: 0 },
		short: { available: true, pendingAt: null, extreme: -Infinity, lockedAt: null, neutralCount: 0 },
	}
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]!
		for (const side of ['long', 'short'] as const) {
			const state = states[side]
			if (!state.available && rearmCondition(row, side, state, config, i)) {
				state.available = true
				state.pendingAt = null
				state.extreme = side === 'long' ? Infinity : -Infinity
				state.neutralCount = 0
			}
			if (!state.available) continue
			if (armCondition(rows, features, i, side, config.armKind)) {
				state.pendingAt ??= i
				state.extreme = side === 'long' ? Math.min(state.extreme, row.low) : Math.max(state.extreme, row.high)
			}
			if (state.pendingAt != null && i - state.pendingAt > config.maxPendingBars) {
				state.pendingAt = null
				state.extreme = side === 'long' ? Infinity : -Infinity
			}
		}
		let longOk = confirmCondition(rows, features, i, 'long', states.long, config.confirmKind)
		let shortOk = confirmCondition(rows, features, i, 'short', states.short, config.confirmKind)
		if (longOk && shortOk) {
			if (row.close > row.open) shortOk = false
			else if (row.close < row.open) longOk = false
			else { longOk = false; shortOk = false }
		}
		const emit = (side: 'long' | 'short') => {
			const state = states[side]
			out.push({ at: row.timestamp, index: i, direction: side, pendingBars: i - state.pendingAt!, armKind: config.armKind, confirmKind: config.confirmKind })
			state.available = false
			state.pendingAt = null
			state.extreme = side === 'long' ? Infinity : -Infinity
			state.lockedAt = i
			state.neutralCount = 0
		}
		if (longOk) emit('long')
		else if (shortOk) emit('short')
	}
	return out
}
