import type { ReversalResearchRow } from './ReversalStateMachineResearch.js'

export const REVERSAL_EPISODE_RESEARCH_VERSION = 'reversal-episode-research-2.0-long-memory'

export type EpisodeOscillator = 'rsi' | 'stoch' | 'rsi-stoch'
export type EpisodeConfirm = 'directional' | 'osc-cross' | 'fast-slow-cross' | 'price-recovery' | 'osc-cross-directional'
export type EpisodeRearm = 'mean' | 'opposite-inner' | 'cooldown'

export interface ReversalEpisodeConfig {
	armInner: boolean
	armThreshold: number
	oscillator: EpisodeOscillator
	smoothFast: number
	smoothSlow: number
	releaseThreshold: number
	confirm: EpisodeConfirm
	minDwellBars: number
	maxEpisodeBars: number
	minRecoveryWidth: number
	rearm: EpisodeRearm
	cooldownBars: number
}

export interface ReversalEpisodeSignal {
	at: number
	index: number
	direction: 'long' | 'short'
	episodeBars: number
	oscillator: EpisodeOscillator
	confirm: EpisodeConfirm
}

interface Features {
	rsi: number[]
	stoch: number[]
}

interface SideState {
	available: boolean
	start: number | null
	extreme: number
	armedExtreme: boolean
	lastSignal: number | null
}

function rsi(values: number[], period: number): number[] {
	const out = new Array<number>(values.length).fill(NaN)
	let gains = 0, losses = 0
	for (let i = 1; i < values.length; i++) {
		const delta = values[i]! - values[i - 1]!
		gains += Math.max(0, delta); losses += Math.max(0, -delta)
		if (i > period) {
			const old = values[i - period]! - values[i - period - 1]!
			gains -= Math.max(0, old); losses -= Math.max(0, -old)
		}
		if (i >= period) out[i] = losses === 0 ? 100 : 100 - 100 / (1 + gains / losses)
	}
	return out
}

function stochastic(rows: ReversalResearchRow[], period: number): number[] {
	const out = new Array<number>(rows.length).fill(NaN)
	for (let i = period - 1; i < rows.length; i++) {
		let low = Infinity, high = -Infinity
		for (let j = i - period + 1; j <= i; j++) { low = Math.min(low, rows[j]!.low); high = Math.max(high, rows[j]!.high) }
		out[i] = 100 * (rows[i]!.close - low) / Math.max(1e-12, high - low)
	}
	return out
}

export function buildReversalEpisodeFeatures(rows: ReversalResearchRow[]): Features {
	return { rsi: rsi(rows.map((row) => row.close), 14), stoch: stochastic(rows, 14) }
}

function emaSeries(values: number[], period: number): number[] {
	const out = new Array<number>(values.length).fill(NaN)
	const alpha = 2 / (period + 1)
	let value = NaN
	for (let i = 0; i < values.length; i++) {
		if (!Number.isFinite(values[i])) continue
		value = Number.isFinite(value) ? alpha * values[i]! + (1 - alpha) * value : values[i]!
		out[i] = value
	}
	return out
}

function oscillatorSeries(features: Features, config: ReversalEpisodeConfig): number[] {
	if (config.oscillator === 'rsi') return features.rsi
	if (config.oscillator === 'stoch') return features.stoch
	return features.rsi.map((value, i) => (value + features.stoch[i]!) / 2)
}

function sideOsc(value: number, side: 'long' | 'short'): number { return side === 'long' ? value : 100 - value }

function armByInner(row: ReversalResearchRow, side: 'long' | 'short'): boolean {
	return side === 'long' ? row.low <= row.lowerInner : row.high >= row.upperInner
}

function rearm(row: ReversalResearchRow, side: 'long' | 'short', state: SideState, config: ReversalEpisodeConfig, i: number): boolean {
	if (state.lastSignal == null) return true
	if (config.rearm === 'cooldown') return i - state.lastSignal >= config.cooldownBars
	if (config.rearm === 'mean') return side === 'long' ? row.close >= row.mean : row.close <= row.mean
	return side === 'long' ? row.high >= row.upperInner : row.low <= row.lowerInner
}

export function detectReversalEpisodes(
	rows: ReversalResearchRow[],
	config: ReversalEpisodeConfig,
	features = buildReversalEpisodeFeatures(rows),
): ReversalEpisodeSignal[] {
	const states: Record<'long' | 'short', SideState> = {
		long: { available: true, start: null, extreme: Infinity, armedExtreme: false, lastSignal: null },
		short: { available: true, start: null, extreme: -Infinity, armedExtreme: false, lastSignal: null },
	}
	const out: ReversalEpisodeSignal[] = []
	const oscillatorValues = oscillatorSeries(features, config)
	const fastValues = emaSeries(oscillatorValues, config.smoothFast)
	const slowValues = emaSeries(oscillatorValues, config.smoothSlow)
	for (let i = 1; i < rows.length; i++) {
		const row = rows[i]!, width = Math.max(1e-12, (row.upperInner - row.lowerInner) / 2)
		const osc = oscillatorValues[i]!
		const prevOsc = oscillatorValues[i - 1]!
		for (const side of ['long', 'short'] as const) {
			const state = states[side]
			if (!state.available && rearm(row, side, state, config, i)) {
				state.available = true; state.start = null; state.extreme = side === 'long' ? Infinity : -Infinity; state.armedExtreme = false
			}
			if (!state.available) continue
			const arm = config.armInner ? armByInner(row, side) : sideOsc(osc, side) <= config.armThreshold
			if (arm && state.start == null) state.start = i
			if (state.start == null) continue
			state.extreme = side === 'long' ? Math.min(state.extreme, row.low) : Math.max(state.extreme, row.high)
			if (sideOsc(osc, side) <= config.armThreshold) state.armedExtreme = true
			if (i - state.start > config.maxEpisodeBars) {
				state.start = null; state.extreme = side === 'long' ? Infinity : -Infinity; state.armedExtreme = false
				continue
			}
			if (!state.armedExtreme || i - state.start < config.minDwellBars) continue
			const directional = side === 'long' ? row.close > row.open : row.close < row.open
			const releaseCross = sideOsc(osc, side) >= config.releaseThreshold && sideOsc(prevOsc, side) < config.releaseThreshold
			const fast = fastValues[i]!, slow = slowValues[i]!, prevFast = fastValues[i - 1]!, prevSlow = slowValues[i - 1]!
			const fastSlowCross = side === 'long' ? fast >= slow && prevFast < prevSlow : fast <= slow && prevFast > prevSlow
			const recovery = side === 'long' ? (row.close - state.extreme) / width : (state.extreme - row.close) / width
			let ok = false
			if (config.confirm === 'directional') ok = directional
			else if (config.confirm === 'osc-cross') ok = releaseCross
			else if (config.confirm === 'fast-slow-cross') ok = fastSlowCross
			else if (config.confirm === 'price-recovery') ok = recovery >= config.minRecoveryWidth
			else ok = releaseCross && directional
			if (!ok) continue
			out.push({ at: row.timestamp, index: i, direction: side, episodeBars: i - state.start, oscillator: config.oscillator, confirm: config.confirm })
			state.available = false; state.start = null; state.extreme = side === 'long' ? Infinity : -Infinity; state.armedExtreme = false; state.lastSignal = i
		}
	}
	return out
}
