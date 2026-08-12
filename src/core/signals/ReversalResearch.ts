import type { Candle } from '../../models/price/Candle.js'
import { APEX_PARAMS, computeApexBands, type ApexBand, type ApexParams } from './ApexEngine.js'

export type ReversalRiskMode = 'safe' | 'risk' | 'standard'
export type ReversalHypothesisId = 'H0' | 'H1' | 'H3' | 'H4' | 'H5'

export interface ReversalResearchConfig {
	hypothesis: ReversalHypothesisId
	mode: ReversalRiskMode
	apexParams?: Partial<ApexParams>
	/** Maximum bars between extreme evidence and confirmation. */
	maxPendingBars: number
	/** H1/H4: required penetration beyond the selected edge in Apex-width units. */
	minPenetrationS: number
	/** H3: current body must be no larger than this share of the previous body. */
	bodyContractionRatio: number
	/** H5: directional recovery from the extreme, measured in Apex-width units. */
	minRecoveryS: number
}

export const REVERSAL_RESEARCH_VERSION = 'reversal-research-0.1-observation-first'

export const REVERSAL_RESEARCH_CONFIG: ReversalResearchConfig = {
	hypothesis: 'H0',
	mode: 'safe',
	maxPendingBars: 8,
	minPenetrationS: 0,
	bodyContractionRatio: 0.85,
	minRecoveryS: 0,
}

export interface ReversalResearchSignal {
	at: number
	index: number
	direction: 'long' | 'short'
	hypothesis: ReversalHypothesisId
	mode: ReversalRiskMode
	edge: number
	penetrationS: number
	recoveryS: number
	pendingBars: number
}

type SideState = { armed: boolean; pendingAt: number | null; extreme: number }

function finiteBand(b: ApexBand): boolean {
	return Number.isFinite(b.mean) && Number.isFinite(b.s) && b.s >= 0
}

function widthPrice(b: ApexBand): number {
	return Math.max(Number.EPSILON, b.mean * b.s)
}

function modeEdge(mode: ReversalRiskMode, side: 'long' | 'short', b: ApexBand): number {
	// Safe/Risk share the observed signal timing. Standard eligibility is unresolved,
	// therefore research starts from the same outer edge instead of inventing a filter.
	if (side === 'long') return b.greenLo
	return b.redHi
}

function penetration(side: 'long' | 'short', c: Candle, edge: number, b: ApexBand): number {
	return Math.max(0, side === 'long' ? (edge - c.low) / widthPrice(b) : (c.high - edge) / widthPrice(b))
}

function recovery(side: 'long' | 'short', c: Candle, extreme: number, b: ApexBand): number {
	return Math.max(0, side === 'long' ? (c.close - extreme) / widthPrice(b) : (extreme - c.close) / widthPrice(b))
}

/**
 * Research-only detector family. It intentionally does not replace detectReversals().
 * Every signal uses only candles and Apex values at indices <= i.
 */
export function detectReversalResearch(
	candles: Candle[],
	configArg: Partial<ReversalResearchConfig> = {},
): ReversalResearchSignal[] {
	const cfg: ReversalResearchConfig = { ...REVERSAL_RESEARCH_CONFIG, ...configArg }
	const apexParams = { ...APEX_PARAMS, ...(cfg.apexParams ?? {}) }
	const bands = computeApexBands(candles, apexParams)
	const out: ReversalResearchSignal[] = []
	const long: SideState = { armed: true, pendingAt: null, extreme: Infinity }
	const short: SideState = { armed: true, pendingAt: null, extreme: -Infinity }

	for (let i = 0; i < candles.length; i++) {
		const c = candles[i]!, b = bands[i]!
		if (!finiteBand(b)) continue
		if (!long.armed && c.close >= b.mean) { long.armed = true; long.pendingAt = null; long.extreme = Infinity }
		if (!short.armed && c.close <= b.mean) { short.armed = true; short.pendingAt = null; short.extreme = -Infinity }

		const longEdge = modeEdge(cfg.mode, 'long', b)
		const shortEdge = modeEdge(cfg.mode, 'short', b)
		const longPen = penetration('long', c, longEdge, b)
		const shortPen = penetration('short', c, shortEdge, b)
		if (long.armed && c.low <= longEdge && longPen >= cfg.minPenetrationS) {
			if (long.pendingAt == null) long.pendingAt = i
			long.extreme = Math.min(long.extreme, c.low)
		}
		if (short.armed && c.high >= shortEdge && shortPen >= cfg.minPenetrationS) {
			if (short.pendingAt == null) short.pendingAt = i
			short.extreme = Math.max(short.extreme, c.high)
		}

		if (long.pendingAt != null && i - long.pendingAt > cfg.maxPendingBars) { long.pendingAt = null; long.extreme = Infinity }
		if (short.pendingAt != null && i - short.pendingAt > cfg.maxPendingBars) { short.pendingAt = null; short.extreme = -Infinity }

		const bullish = c.close > c.open
		const bearish = c.close < c.open
		const prev = candles[i - 1]
		const contracted = prev ? Math.abs(c.close - c.open) <= Math.abs(prev.close - prev.open) * cfg.bodyContractionRatio : false
		const longRecovery = Number.isFinite(long.extreme) ? recovery('long', c, long.extreme, b) : 0
		const shortRecovery = Number.isFinite(short.extreme) ? recovery('short', c, short.extreme, b) : 0
		const longReclaim = c.close >= longEdge
		const shortReclaim = c.close <= shortEdge
		const longPending = long.pendingAt != null
		const shortPending = short.pendingAt != null

		let longOk = false, shortOk = false
		if (cfg.hypothesis === 'H0' || cfg.hypothesis === 'H1') {
			longOk = longPending && bullish
			shortOk = shortPending && bearish
		} else if (cfg.hypothesis === 'H3') {
			longOk = longPending && bullish && contracted
			shortOk = shortPending && bearish && contracted
		} else if (cfg.hypothesis === 'H4') {
			longOk = longPending && bullish && longReclaim
			shortOk = shortPending && bearish && shortReclaim
		} else if (cfg.hypothesis === 'H5') {
			longOk = longPending && bullish && longRecovery >= cfg.minRecoveryS
			shortOk = shortPending && bearish && shortRecovery >= cfg.minRecoveryS
		}

		if (longOk && shortOk) {
			if (bullish) shortOk = false
			else if (bearish) longOk = false
			else if (longRecovery >= shortRecovery) shortOk = false
			else longOk = false
		}
		if (longOk) {
			out.push({ at: c.timestamp, index: i, direction: 'long', hypothesis: cfg.hypothesis, mode: cfg.mode, edge: longEdge, penetrationS: longPen, recoveryS: longRecovery, pendingBars: i - long.pendingAt! })
			long.armed = false; long.pendingAt = null; long.extreme = Infinity
		} else if (shortOk) {
			out.push({ at: c.timestamp, index: i, direction: 'short', hypothesis: cfg.hypothesis, mode: cfg.mode, edge: shortEdge, penetrationS: shortPen, recoveryS: shortRecovery, pendingBars: i - short.pendingAt! })
			short.armed = false; short.pendingAt = null; short.extreme = -Infinity
		}

		if (c.close >= b.mean) { long.pendingAt = null; long.extreme = Infinity }
		if (c.close <= b.mean) { short.pendingAt = null; short.extreme = -Infinity }
	}
	return out
}
