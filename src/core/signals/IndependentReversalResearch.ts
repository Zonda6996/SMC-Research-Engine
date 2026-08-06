import type { Candle } from '../../models/price/Candle.js'
import type { StructureEvent } from '../../models/events/StructureEvent.js'
import type { LiquidityPoiCandidate } from '../confirmation/LiquidityPoiCalibration.js'
import type { ApexBand } from './ApexEngine.js'
import {
	INDEPENDENT_REVERSAL_PROTOCOL,
	type IndependentReversalFamily,
} from './IndependentReversalProtocol.js'

export const INDEPENDENT_REVERSAL_RESEARCH_VERSION = 'independent-reversal-research-1.0-causal-episodes'
export type IndependentReversalDirection = 'long' | 'short'
export type IndependentReversalSignalFamily = 'CORE' | IndependentReversalFamily

export interface IndependentReversalConfig {
	atrPeriod: number
	relativeVolumePeriod: number
	penetrationInnerWidth: number
	recoveryInnerWidth: number
	favorableBodyAtr: number
	maxEpisodeBars: number
	liquidityDistanceAtr: number
	peakRelativeVolume: number
	confirmationVolumeMax: number
	confirmationVolumePeakRatio: number
}

export const DEFAULT_INDEPENDENT_REVERSAL_CONFIG: IndependentReversalConfig = {
	atrPeriod: 14,
	relativeVolumePeriod: 20,
	...INDEPENDENT_REVERSAL_PROTOCOL.signal,
}

export interface IndependentReversalContext {
	candles: Candle[]
	apexBands: ApexBand[]
	structureEvents?: StructureEvent[]
	liquidityZones?: LiquidityPoiCandidate[]
}

export interface IndependentReversalSignal {
	version: string
	episodeId: string
	family: IndependentReversalSignalFamily
	at: number
	index: number
	direction: IndependentReversalDirection
	episodeStartIndex: number
	episodeBars: number
	extremeIndex: number
	extremePrice: number
	atr: number
	innerHalfWidth: number
	penetrationInnerWidth: number
	recoveryInnerWidth: number
	relativeVolume: number | null
	peakRelativeVolume: number | null
	bodyAtr: number
	liquidityQualified: boolean
	structureQualified: boolean
	volumeQualified: boolean
	priceQualified: boolean
}

interface SideState {
	startIndex: number | null
	extremeIndex: number
	extremePrice: number
	maxPenetration: number
	peakRelativeVolume: number | null
	liquidityQualified: boolean
	structureLiquidityQualified: boolean
	structureQualified: boolean
	coreSeen: boolean
	priceQualified: boolean
	emitted: Set<IndependentReversalSignalFamily>
}

function emptyState(side: IndependentReversalDirection): SideState {
	return {
		startIndex: null,
		extremeIndex: -1,
		extremePrice: side === 'long' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY,
		maxPenetration: 0,
		peakRelativeVolume: null,
		liquidityQualified: false,
		structureLiquidityQualified: false,
		structureQualified: false,
		coreSeen: false,
		priceQualified: false,
		emitted: new Set(),
	}
}

function resetState(state: SideState, side: IndependentReversalDirection): void {
	Object.assign(state, emptyState(side))
}

function trueRange(candles: Candle[], index: number): number {
	const current = candles[index]!
	if (index === 0) return current.high - current.low
	const previous = candles[index - 1]!
	return Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close))
}

export function buildIndependentReversalAtr(candles: Candle[], period = 14): number[] {
	const out = new Array<number>(candles.length).fill(Number.NaN)
	let sum = 0
	for (let i = 0; i < candles.length; i++) {
		sum += trueRange(candles, i)
		if (i >= period) sum -= trueRange(candles, i - period)
		if (i >= period - 1) out[i] = sum / period
	}
	return out
}

export function buildIndependentReversalRelativeVolume(candles: Candle[], period = 20): Array<number | null> {
	const out = new Array<number | null>(candles.length).fill(null)
	let priorSum = 0
	for (let i = 0; i < candles.length; i++) {
		if (i > 0) priorSum += candles[i - 1]!.volume
		if (i > period) priorSum -= candles[i - period - 1]!.volume
		if (i >= period) {
			const average = priorSum / period
			out[i] = average > 0 ? candles[i]!.volume / average : null
		}
	}
	return out
}

function halfWidth(band: ApexBand): number {
	return Math.max(Number.EPSILON, (band.redLo - band.greenHi) / 2)
}

function ownInnerTouched(candle: Candle, band: ApexBand, side: IndependentReversalDirection): boolean {
	return side === 'long' ? candle.low <= band.greenHi : candle.high >= band.redLo
}

function oppositeInnerTouched(candle: Candle, band: ApexBand, side: IndependentReversalDirection): boolean {
	return side === 'long' ? candle.high >= band.redLo : candle.low <= band.greenHi
}

function backInsideInner(candle: Candle, band: ApexBand, side: IndependentReversalDirection): boolean {
	return side === 'long' ? candle.close >= band.greenHi : candle.close <= band.redLo
}

function meanRecovered(candle: Candle, band: ApexBand, side: IndependentReversalDirection): boolean {
	return side === 'long' ? candle.close >= band.mean : candle.close <= band.mean
}

function favorableCandle(candle: Candle, side: IndependentReversalDirection): boolean {
	return side === 'long' ? candle.close > candle.open : candle.close < candle.open
}

function favorableStructure(event: StructureEvent, side: IndependentReversalDirection): boolean {
	return event.type === 'choch' && event.direction === (side === 'long' ? 'up' : 'down')
}

function zoneTouched(candle: Candle, zone: LiquidityPoiCandidate): boolean {
	const lower = Math.min(zone.near, zone.far)
	const upper = Math.max(zone.near, zone.far)
	return candle.high >= lower && candle.low <= upper
}

function updateExtreme(state: SideState, candle: Candle, index: number, side: IndependentReversalDirection): boolean {
	const value = side === 'long' ? candle.low : candle.high
	const isNew = side === 'long' ? value < state.extremePrice : value > state.extremePrice
	if (isNew) {
		state.extremePrice = value
		state.extremeIndex = index
		// A CHoCH qualified before a later adverse extreme no longer satisfies
		// the frozen "confirmed after the episode extreme" requirement.
		state.structureLiquidityQualified = false
		state.structureQualified = false
	}
	return isNew
}

function episodeId(side: IndependentReversalDirection, startIndex: number): string {
	return `${side}-${startIndex}`
}

/**
 * Research-only causal detector. A family emits at most once per side episode.
 * The legacy/vendor Reversal stream is deliberately not an input.
 */
export function detectIndependentReversalSignals(
	context: IndependentReversalContext,
	partial: Partial<IndependentReversalConfig> = {},
): IndependentReversalSignal[] {
	const config = { ...DEFAULT_INDEPENDENT_REVERSAL_CONFIG, ...partial }
	const { candles, apexBands } = context
	if (candles.length !== apexBands.length) throw new Error('Independent Reversal: candles/apexBands length mismatch')
	const atr = buildIndependentReversalAtr(candles, config.atrPeriod)
	const relativeVolume = buildIndependentReversalRelativeVolume(candles, config.relativeVolumePeriod)
	const eventsByConfirm = new Map<number, StructureEvent[]>()
	for (const event of context.structureEvents ?? []) {
		if (event.confirmIndex < 0 || event.confirmIndex >= candles.length) continue
		const list = eventsByConfirm.get(event.confirmIndex)
		if (list) list.push(event)
		else eventsByConfirm.set(event.confirmIndex, [event])
	}
	const states: Record<IndependentReversalDirection, SideState> = {
		long: emptyState('long'),
		short: emptyState('short'),
	}
	const previousOwnTouch: Record<IndependentReversalDirection, boolean> = {
		long: false,
		short: false,
	}
	const out: IndependentReversalSignal[] = []

	for (let i = 0; i < candles.length; i++) {
		const candle = candles[i]!
		const band = apexBands[i]!
		const atrValue = atr[i]!
		if (!Number.isFinite(band.mean) || !Number.isFinite(band.s) || !Number.isFinite(atrValue) || atrValue <= 0) continue
		const width = halfWidth(band)
		const longTouch = ownInnerTouched(candle, band, 'long')
		const shortTouch = ownInnerTouched(candle, band, 'short')

		for (const side of ['long', 'short'] as const) {
			const state = states[side]
			if (state.startIndex == null) continue
			const expired = i - state.startIndex > config.maxEpisodeBars
			if (expired) { resetState(state, side); continue }
			// A genuine opposite-side breach invalidates the old episode before a new one is armed.
			if (oppositeInnerTouched(candle, band, side) && !ownInnerTouched(candle, band, side)) {
				resetState(state, side)
			}
		}

		// A bar spanning both Inner edges is resolved by its close direction; a doji arms neither side.
		for (const side of ['long', 'short'] as const) {
			const state = states[side]
			if (state.startIndex != null) continue
			const touched = side === 'long' ? longTouch : shortTouch
			// An episode starts on the first breach/touch, not on every bar that
			// remains beyond the Inner edge after an expiry or mean reset.
			if (!touched || previousOwnTouch[side]) continue
			if (longTouch && shortTouch && !favorableCandle(candle, side)) continue
			state.startIndex = i
			updateExtreme(state, candle, i, side)
		}

		for (const side of ['long', 'short'] as const) {
			const state = states[side]
			if (state.startIndex == null) continue
			updateExtreme(state, candle, i, side)
			const penetration = side === 'long'
				? Math.max(0, band.greenHi - state.extremePrice) / width
				: Math.max(0, state.extremePrice - band.redLo) / width
			state.maxPenetration = Math.max(state.maxPenetration, penetration)
			const rv = relativeVolume[i] ?? null
			if (rv != null) state.peakRelativeVolume = Math.max(state.peakRelativeVolume ?? rv, rv)

			for (const zone of context.liquidityZones ?? []) {
				if (zone.direction !== side || !zone.valid) continue
				// Prior-bar knowledge is required because the touch order inside this candle is unknown.
				if (zone.knownAt >= candle.timestamp || zone.geometryKnownAt >= candle.timestamp) continue
				const distance = Math.min(Math.abs(candle.close - zone.near), Math.abs(candle.close - zone.far))
				if (distance <= config.liquidityDistanceAtr * atrValue && zoneTouched(candle, zone)) state.liquidityQualified = true
			}

			const confirmedEvents = (eventsByConfirm.get(i) ?? []).filter((event) => event.confirmTimestamp <= candle.timestamp)
			for (const event of confirmedEvents) {
				if (event.confirmIndex < state.extremeIndex) continue
				if (favorableStructure(event, side) && event.oppositeSweptBefore) state.structureLiquidityQualified = true
			}

			const recovery = side === 'long'
				? (candle.close - state.extremePrice) / width
				: (state.extremePrice - candle.close) / width
			const bodyAtr = Math.abs(candle.close - candle.open) / atrValue
			const coreNow = !state.coreSeen && favorableCandle(candle, side) && backInsideInner(candle, band, side) && recovery >= config.recoveryInnerWidth
			if (coreNow) {
				state.coreSeen = true
				state.priceQualified = state.maxPenetration >= config.penetrationInnerWidth && bodyAtr >= config.favorableBodyAtr
			}
			const structureNow = state.coreSeen && confirmedEvents.some((event) => event.confirmIndex >= state.extremeIndex && favorableStructure(event, side))
			if (structureNow) state.structureQualified = true
			const liquidityQualified = state.liquidityQualified || state.structureLiquidityQualified
			const volumeQualified = state.peakRelativeVolume != null && state.peakRelativeVolume >= config.peakRelativeVolume && rv != null &&
				(rv <= config.confirmationVolumeMax || rv <= state.peakRelativeVolume * config.confirmationVolumePeakRatio)
			// Composite confirmation requires price exhaustion plus at least one
				// independent confirmation family. Current-bar volume qualification is
				// valid because both P and V are known at the same candle close.
			const compositeConfirmed = liquidityQualified || state.structureQualified || volumeQualified

			const emit = (family: IndependentReversalSignalFamily): void => {
				if (state.emitted.has(family) || state.startIndex == null) return
				state.emitted.add(family)
				out.push({
					version: INDEPENDENT_REVERSAL_RESEARCH_VERSION,
					episodeId: episodeId(side, state.startIndex),
					family,
					at: candle.timestamp,
					index: i,
					direction: side,
					episodeStartIndex: state.startIndex,
					episodeBars: i - state.startIndex,
					extremeIndex: state.extremeIndex,
					extremePrice: state.extremePrice,
					atr: atrValue,
					innerHalfWidth: width,
					penetrationInnerWidth: state.maxPenetration,
					recoveryInnerWidth: recovery,
					relativeVolume: rv,
					peakRelativeVolume: state.peakRelativeVolume,
					bodyAtr,
					liquidityQualified,
					structureQualified: state.structureQualified,
					volumeQualified,
					priceQualified: state.priceQualified,
				})
			}

			if (coreNow) {
				emit('CORE')
				if (state.priceQualified) emit('P')
			}
			if (state.coreSeen && liquidityQualified) emit('L')
			if (state.coreSeen && volumeQualified) emit('V')
			if (structureNow) emit('S')
			if (state.priceQualified && compositeConfirmed) emit('C')

			if (meanRecovered(candle, band, side)) resetState(state, side)
		}
		previousOwnTouch.long = longTouch
		previousOwnTouch.short = shortTouch
	}
	return out.sort((a, b) => a.index - b.index || a.direction.localeCompare(b.direction) || a.family.localeCompare(b.family))
}
