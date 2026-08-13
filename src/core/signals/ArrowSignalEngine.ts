import type { Candle } from '../../models/price/Candle.js'
import { APEX_PARAMS, computeApexBands, type ApexBand, type ApexParams } from './ApexEngine.js'

export const ARROW_SIGNAL_VERSION = 'signal-arrows-1.0-own2-extension'

export type ArrowMode = 'safe' | 'standard' | 'risk'
export type ArrowSide = 'long' | 'short'

export interface ArrowSignalConfig {
	warmupBars: number
	relativeVolumePeriod: number
	minimumRelativeVolume: number
	minimumDistanceMeanPct: number
	minimumPenetrationInner: number
}

export const DEFAULT_ARROW_SIGNAL_CONFIG: ArrowSignalConfig = {
	warmupBars: 200,
	relativeVolumePeriod: 20,
	minimumRelativeVolume: 0.0,
	minimumDistanceMeanPct: 3,
	minimumPenetrationInner: -0.35,
}

export interface ArrowSignal {
	version: string
	signalIndex: number
	signalAt: number
	side: ArrowSide
	close: number
	mean: number
	inner: number
	outer: number
	atr200: number
	trigger: {
		family: 'own2-extension'
		penetrationInner: number
		distanceMeanPct: number
		relativeVolume: number
	}
}

export type ArrowSignalDiagnosticReason =
	| 'accepted'
	| 'invalid-input'
	| 'relative-volume'
	| 'distance-mean'
	| 'candle-direction'
	| 'invalid-geometry'
	| 'wrong-side-of-mean'
	| 'penetration-inner'

export interface ArrowSignalDiagnostic {
	index: number
	at: number
	side: ArrowSide
	accepted: boolean
	reason: ArrowSignalDiagnosticReason
	close: number
	mean: number | null
	inner: number | null
	outer: number | null
	atr200: number | null
	relativeVolume: number | null
	distanceMeanPct: number | null
	penetrationInner: number | null
}

export interface ArrowSignalDiagnosticReport {
	evaluatedBars: number
	evaluatedSides: number
	accepted: number
	rejected: number
	byReason: Record<ArrowSignalDiagnosticReason, number>
}

export interface ArrowSignalDetection {
	version: string
	warmupBars: number
	bands: ApexBand[]
	candidates: ArrowSignal[]
	diagnostics: ArrowSignalDiagnostic[]
	diagnosticReport: ArrowSignalDiagnosticReport
}

/** GEO4/RMA ATR. Bar i is based only on true ranges from bars 1..i. */
export function arrowAtr200(candles: readonly Candle[], period = 200): number[] {
	const out = new Array<number>(candles.length).fill(Number.NaN)
	if (!Number.isInteger(period) || period < 1) return out
	let sum = 0
	for (let index = 1; index < candles.length; index++) {
		const candle = candles[index]!
		const previous = candles[index - 1]!
		const tr = Math.max(candle.high - candle.low, Math.abs(candle.high - previous.close), Math.abs(candle.low - previous.close))
		if (index <= period) {
			sum += tr
			if (index === period) out[index] = sum / period
		} else out[index] = (out[index - 1]! * (period - 1) + tr) / period
	}
	return out
}

function relativeVolume(candles: readonly Candle[], index: number, period: number): number {
	let sum = 0
	for (let cursor = index - period; cursor < index; cursor++) sum += candles[cursor]!.volume
	return sum > 0 ? candles[index]!.volume / (sum / period) : 0
}

/**
 * Canonical raw arrow trigger. This is deliberately state-free: trade occupancy
 * and post-exit blocking are applied by ArrowTradeReplay, so research runners
 * and the visualizer can share the same trigger without duplicating formulas.
 */
export function detectArrowSignalsFromBands(
	candles: readonly Candle[],
	bands: readonly ApexBand[],
	partial: Partial<ArrowSignalConfig> = {},
): ArrowSignalDetection {
	const config = { ...DEFAULT_ARROW_SIGNAL_CONFIG, ...partial }
	const atr = arrowAtr200(candles)
	const candidates: ArrowSignal[] = []
	const diagnostics: ArrowSignalDiagnostic[] = []
	const first = Math.max(config.warmupBars, config.relativeVolumePeriod)
	const reasons: ArrowSignalDiagnosticReason[] = ['accepted', 'invalid-input', 'relative-volume', 'distance-mean', 'candle-direction', 'invalid-geometry', 'wrong-side-of-mean', 'penetration-inner']
	const byReason = Object.fromEntries(reasons.map((reason) => [reason, 0])) as Record<ArrowSignalDiagnosticReason, number>
	const finiteOrNull = (value: number | undefined): number | null => value != null && Number.isFinite(value) ? value : null
	for (let index = first; index < candles.length; index++) {
		const candle = candles[index]!
		const band = bands[index]
		const rv = relativeVolume(candles, index, config.relativeVolumePeriod)
		const distanceMeanPct = band != null && Number.isFinite(band.mean) && band.mean !== 0
			? Math.abs(candle.close - band.mean) / band.mean * 100 : Number.NaN
		const bandStdPct = band != null && Number.isFinite(band.s) && band.s > 0
			? band.s * 100 : Number.NaN
		const minDistancePct = Number.isFinite(bandStdPct)
			? Math.min(config.minimumDistanceMeanPct, Math.max(0.15, bandStdPct * 0.8))
			: config.minimumDistanceMeanPct
		for (const side of ['long', 'short'] as const) {
			const inner = band == null ? Number.NaN : side === 'long' ? band.greenHi : band.redLo
			const outer = band == null ? Number.NaN : side === 'long' ? band.greenLo : band.redHi
			const half = band == null ? Number.NaN : side === 'long' ? band.mean - inner : inner - band.mean
			const penetrationInner = half > 0
				? side === 'long' ? (inner - candle.close) / half : (candle.close - inner) / half
				: Number.NaN
			let reason: ArrowSignalDiagnosticReason = 'accepted'
			if (band == null || !Number.isFinite(band.mean) || !Number.isFinite(band.s) || !Number.isFinite(atr[index])) reason = 'invalid-input'
			else if (rv < config.minimumRelativeVolume) reason = 'relative-volume'
			else if (distanceMeanPct < minDistancePct) reason = 'distance-mean'
			else if (side === 'long' ? candle.close <= candle.open : candle.close >= candle.open) reason = 'candle-direction'
			else if (!(half > 0)) reason = 'invalid-geometry'
			else if (side === 'long' ? candle.close >= band.mean : candle.close <= band.mean) reason = 'wrong-side-of-mean'
			else if (penetrationInner < config.minimumPenetrationInner) reason = 'penetration-inner'
			const diagnostic: ArrowSignalDiagnostic = {
				index, at: candle.timestamp, side, accepted: reason === 'accepted', reason, close: candle.close,
				mean: finiteOrNull(band?.mean), inner: finiteOrNull(inner), outer: finiteOrNull(outer),
				atr200: finiteOrNull(atr[index]), relativeVolume: finiteOrNull(rv),
				distanceMeanPct: finiteOrNull(distanceMeanPct), penetrationInner: finiteOrNull(penetrationInner),
			}
			diagnostics.push(diagnostic)
			byReason[reason]++
			if (!diagnostic.accepted || band == null) continue
			candidates.push({
				version: ARROW_SIGNAL_VERSION, signalIndex: index, signalAt: candle.timestamp, side,
				close: candle.close, mean: band.mean, inner, outer, atr200: atr[index]!,
				trigger: { family: 'own2-extension', penetrationInner, distanceMeanPct, relativeVolume: rv },
			})
		}
	}
	return {
		version: ARROW_SIGNAL_VERSION, warmupBars: config.warmupBars, bands: Array.from(bands), candidates, diagnostics,
		diagnosticReport: {
			evaluatedBars: Math.max(0, candles.length - first), evaluatedSides: diagnostics.length,
			accepted: byReason.accepted, rejected: diagnostics.length - byReason.accepted, byReason,
		},
	}
}

export function detectArrowSignalCandidates(
	candles: readonly Candle[],
	apexParams: Partial<ApexParams> = {},
	partial: Partial<ArrowSignalConfig> = {},
): ArrowSignalDetection {
	const params = { ...APEX_PARAMS, ...apexParams }
	return detectArrowSignalsFromBands(candles, computeApexBands([...candles], params), partial)
}

/**
 * Regime-independent arrow spacing, in BARS. Vendor-anchored: the vendor's
 * arrow density (~85-90 arrows) does not depend on asset or timeframe, which
 * implies a fixed bar-step rather than an ATR/exit-derived cooldown. `N≈180`
 * bars matches vendor density across all assets and TFs (see docs/ROADMAP.md
 * A1). This is a comparability/fidelity anchor, NOT a performance lever — the
 * step does not create edge (BTC/ETH negative, ONDO mildly positive at any N).
 * Named so it can later be specialized per-TF if the author decides to.
 */
export const ARROW_SIGNAL_SPACING_BARS = 180

/**
 * Regime-independent signal admission: greedy minimum-spacing over candidates
 * by `signalIndex`. Produces ONE admitted arrow set that every mode
 * (safe/standard/risk) trades identically, so the modes differ only in
 * management — never in which arrows they take. This replaces the previous,
 * regime-dependent behaviour where each mode's exit-cooldown decided how many
 * arrows it could fit (A1). Candidates are expected in ascending `signalIndex`
 * order, as produced by `detectArrowSignalsFromBands`.
 */
export function admitArrowSignals(
	candidates: readonly ArrowSignal[],
	spacingBars: number = ARROW_SIGNAL_SPACING_BARS,
): ArrowSignal[] {
	const admitted: ArrowSignal[] = []
	let lastAdmittedIndex = Number.NEGATIVE_INFINITY
	for (const signal of candidates) {
		if (signal.signalIndex - lastAdmittedIndex < spacingBars) continue
		admitted.push(signal)
		lastAdmittedIndex = signal.signalIndex
	}
	return admitted
}
