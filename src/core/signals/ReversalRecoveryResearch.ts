import type { ReversalResearchRow } from './ReversalStateMachineResearch.js'

export const REVERSAL_RECOVERY_RESEARCH_VERSION = 'reversal-recovery-research-3.0-global-cooldown'

export interface ReversalRecoveryConfig {
	arm: 'inner' | 'outer'
	recoveryLevel: number
	minRecoveryDelta: number
	maxEpisodeBars: number
	globalCooldownBars: number
	requireDirectional: boolean
	requireCloseInsideInner: boolean
}

export interface ReversalRecoverySignal {
	at: number
	index: number
	direction: 'long' | 'short'
	distance: number
	recoveryDelta: number
	episodeBars: number
}

type State = { start: number | null; previousDistance: number | null }

function distance(row: ReversalResearchRow, side: 'long' | 'short'): number {
	const halfInner = Math.max(1e-12, (row.upperInner - row.lowerInner) / 2)
	return side === 'long' ? (row.mean - row.close) / halfInner : (row.close - row.mean) / halfInner
}

function armed(row: ReversalResearchRow, side: 'long' | 'short', arm: ReversalRecoveryConfig['arm']): boolean {
	if (arm === 'inner') return side === 'long' ? row.low <= row.lowerInner : row.high >= row.upperInner
	const candidate = row as ReversalResearchRow & { lowerOuter?: number; upperOuter?: number }
	if (candidate.lowerOuter == null || candidate.upperOuter == null) return false
	return side === 'long' ? row.low <= candidate.lowerOuter : row.high >= candidate.upperOuter
}

export function detectReversalRecoveries(rows: ReversalResearchRow[], config: ReversalRecoveryConfig): ReversalRecoverySignal[] {
	const states: Record<'long' | 'short', State> = { long: { start: null, previousDistance: null }, short: { start: null, previousDistance: null } }
	const out: ReversalRecoverySignal[] = []
	let lastSignalIndex = -Infinity
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]!
		const candidates: ReversalRecoverySignal[] = []
		for (const side of ['long', 'short'] as const) {
			const state = states[side]
			const currentDistance = distance(row, side)
			if (armed(row, side, config.arm) && state.start == null) state.start = i
			if (state.start == null) { state.previousDistance = currentDistance; continue }
			if (i - state.start > config.maxEpisodeBars) { state.start = null; state.previousDistance = currentDistance; continue }
			const previousDistance = state.previousDistance
			const recoveryDelta = previousDistance == null ? 0 : previousDistance - currentDistance
			const crossed = previousDistance != null && previousDistance > config.recoveryLevel && currentDistance <= config.recoveryLevel
			const directional = side === 'long' ? row.close > row.open : row.close < row.open
			const inside = side === 'long' ? row.close >= row.lowerInner : row.close <= row.upperInner
			if (crossed && recoveryDelta >= config.minRecoveryDelta && (!config.requireDirectional || directional) && (!config.requireCloseInsideInner || inside) && i - lastSignalIndex >= config.globalCooldownBars) {
				candidates.push({ at: row.timestamp, index: i, direction: side, distance: currentDistance, recoveryDelta, episodeBars: i - state.start })
			}
			state.previousDistance = currentDistance
		}
		if (candidates.length) {
			const directional = row.close > row.open ? 'long' : row.close < row.open ? 'short' : null
			const winner = candidates.find((candidate) => candidate.direction === directional) ?? candidates.sort((a, b) => b.recoveryDelta - a.recoveryDelta)[0]!
			out.push(winner)
			lastSignalIndex = i
			states[winner.direction].start = null
			states[winner.direction].previousDistance = null
		}
	}
	return out
}
