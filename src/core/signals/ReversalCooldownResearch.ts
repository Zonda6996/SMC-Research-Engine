import type { ReversalResearchRow } from './ReversalStateMachineResearch.js'

export const REVERSAL_COOLDOWN_RESEARCH_VERSION = 'reversal-cooldown-research-4.0-first-eligible'

export type CooldownCandidateKind = 'directional' | 'distance-band' | 'inner-recovery' | 'inner-recovery-directional' | 'distance-cross'

export interface ReversalCooldownConfig {
	candidate: CooldownCandidateKind
	cooldownBars: number
	warmupBars: number
	minDistance: number
	maxDistance: number
	minRecoveryDelta: number
	innerMemoryBars: number
}

export interface ReversalCooldownSignal {
	at: number
	index: number
	direction: 'long' | 'short'
	distance: number
	recoveryDelta: number
	barsSinceInner: number | null
}

function distance(row: ReversalResearchRow, side: 'long' | 'short'): number {
	const half = Math.max(1e-12, (row.upperInner - row.lowerInner) / 2)
	return side === 'long' ? (row.mean - row.close) / half : (row.close - row.mean) / half
}

export function detectReversalCooldown(rows: ReversalResearchRow[], config: ReversalCooldownConfig): ReversalCooldownSignal[] {
	const out: ReversalCooldownSignal[] = []
	const lastInner: Record<'long' | 'short', number | null> = { long: null, short: null }
	let lastSignal = -Infinity
	for (let i = 1; i < rows.length; i++) {
		const row = rows[i]!, previous = rows[i - 1]!
		if (row.low <= row.lowerInner) lastInner.long = i
		if (row.high >= row.upperInner) lastInner.short = i
		if (i < config.warmupBars || i - lastSignal < config.cooldownBars) continue
		const candidates: ReversalCooldownSignal[] = []
		for (const side of ['long', 'short'] as const) {
			const currentDistance = distance(row, side), previousDistance = distance(previous, side)
			const recoveryDelta = previousDistance - currentDistance
			const barsSinceInner = lastInner[side] == null ? null : i - lastInner[side]!
			const memory = barsSinceInner != null && barsSinceInner <= config.innerMemoryBars
			const directional = side === 'long' ? row.close > row.open : row.close < row.open
			const inBand = currentDistance >= config.minDistance && currentDistance <= config.maxDistance
			const recovery = recoveryDelta >= config.minRecoveryDelta
			const crossed = previousDistance > config.maxDistance && currentDistance <= config.maxDistance && currentDistance >= config.minDistance
			let eligible = false
			if (config.candidate === 'directional') eligible = directional && inBand
			else if (config.candidate === 'distance-band') eligible = inBand
			else if (config.candidate === 'inner-recovery') eligible = memory && inBand && recovery
			else if (config.candidate === 'inner-recovery-directional') eligible = memory && inBand && recovery && directional
			else eligible = memory && crossed && recovery
			if (eligible) candidates.push({ at: row.timestamp, index: i, direction: side, distance: currentDistance, recoveryDelta, barsSinceInner })
		}
		if (!candidates.length) continue
		const candleDirection = row.close > row.open ? 'long' : row.close < row.open ? 'short' : null
		const winner = candidates.find((candidate) => candidate.direction === candleDirection) ?? candidates.sort((a, b) => b.recoveryDelta - a.recoveryDelta)[0]!
		out.push(winner)
		lastSignal = i
	}
	return out
}
