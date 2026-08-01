import type { Candle } from '../../models/price/Candle.js'
import type { StructureEvent } from '../../models/events/StructureEvent.js'
import type { FibGridCandidate } from '../../models/fib/FibGrid.js'
import type { LiquidityPoiCandidate } from '../confirmation/LiquidityPoiCalibration.js'
import type { ApexBand, ReversalSignal } from '../signals/ApexEngine.js'

export const ZONDA_EDGE_FEATURE_VERSION = 'zonda-edge-features-0.1-causal-snapshot'

export interface ZondaEdgeFeatureContext {
	candles: Candle[]
	decisionIndex: number
	apexBands?: ApexBand[]
	reversals?: ReversalSignal[]
	zones?: LiquidityPoiCandidate[]
	structureEvents?: StructureEvent[]
	fibCandidates?: FibGridCandidate[]
}

export interface ZondaEdgeFeatureSnapshot {
	version: string
	at: number
	price: number
	apex: {
		widthPct: number | null
		distanceMeanWidth: number | null
		distanceInnerWidth: number | null
		widthSlope5: number | null
		state: 'below-inner' | 'inside' | 'above-inner' | 'unavailable'
	}
	reversal: {
		lastDirection: 'long' | 'short' | null
		ageBars: number | null
	}
	liquidity: {
		direction: 'long' | 'short' | null
		distanceAtr: number | null
		stackShare: number | null
		stackNotional: number | null
		touchCount: number | null
		ageBars: number | null
		spent: boolean | null
	}
	structure: {
		lastType: 'bos' | 'choch' | null
		direction: 'up' | 'down' | null
		ageBars: number | null
		oppositeSweptBefore: boolean | null
		sweptDepthPct: number | null
	}
	fib: {
		direction: 'long' | 'short' | null
		nearestRatio: number | null
		distanceLeg: number | null
		legAtrRatio: number | null
		ageBars: number | null
	}
	market: {
		relativeVolume20: number | null
		efficiencyRatio50: number | null
		atrRatio100: number | null
	}
}

function medianStep(candles: Candle[]): number {
	if (candles.length < 2) return 0
	const deltas = candles.slice(1).map((candle, i) => candle.timestamp - candles[i]!.timestamp).sort((a, b) => a - b)
	return deltas[Math.floor(deltas.length / 2)]!
}

function indexAtOrBefore(candles: Candle[], timestamp: number, maxIndex: number): number {
	let lo = 0, hi = Math.min(maxIndex, candles.length - 1), best = -1
	while (lo <= hi) {
		const mid = (lo + hi) >>> 1
		if (candles[mid]!.timestamp <= timestamp) { best = mid; lo = mid + 1 }
		else hi = mid - 1
	}
	return best
}

function atr(candles: Candle[], index: number, period: number): number | null {
	if (index < period) return null
	let sum = 0
	for (let i = index - period + 1; i <= index; i++) {
		const candle = candles[i]!, previous = candles[i - 1]!
		sum += Math.max(candle.high - candle.low, Math.abs(candle.high - previous.close), Math.abs(candle.low - previous.close))
	}
	return sum / period
}

function relativeVolume(candles: Candle[], index: number, period: number): number | null {
	if (index < period) return null
	let sum = 0
	for (let i = index - period; i < index; i++) sum += candles[i]!.volume
	const average = sum / period
	return average > 0 ? candles[index]!.volume / average : null
}

function efficiencyRatio(candles: Candle[], index: number, period: number): number | null {
	if (index < period) return null
	let noise = 0
	for (let i = index - period + 1; i <= index; i++) noise += Math.abs(candles[i]!.close - candles[i - 1]!.close)
	return noise > 0 ? Math.abs(candles[index]!.close - candles[index - period]!.close) / noise : null
}

function atrRatio(candles: Candle[], index: number, period: number, averageWindow: number): number | null {
	if (index < period + averageWindow) return null
	const current = atr(candles, index, period)
	if (current == null) return null
	let sum = 0, count = 0
	for (let i = index - averageWindow + 1; i <= index; i++) {
		const value = atr(candles, i, period)
		if (value != null) { sum += value; count++ }
	}
	return count === averageWindow && sum > 0 ? current / (sum / count) : null
}

export function buildZondaEdgeFeatureSnapshot(context: ZondaEdgeFeatureContext): ZondaEdgeFeatureSnapshot {
	const { candles, decisionIndex } = context
	if (decisionIndex < 0 || decisionIndex >= candles.length) throw new Error(`decisionIndex ${decisionIndex} is outside candle range`)
	const current = candles[decisionIndex]!
	const tfMs = medianStep(candles)
	const ageBars = (timestamp: number): number | null => {
		const index = indexAtOrBefore(candles, timestamp, decisionIndex)
		return index >= 0 ? decisionIndex - index : null
	}

	const band = context.apexBands?.[decisionIndex]
	let apex: ZondaEdgeFeatureSnapshot['apex'] = { widthPct: null, distanceMeanWidth: null, distanceInnerWidth: null, widthSlope5: null, state: 'unavailable' }
	if (band && Number.isFinite(band.mean) && Number.isFinite(band.s) && band.s > 0) {
		const width = band.mean * band.s
		const innerDistance = current.close < band.greenHi ? current.close - band.greenHi : current.close > band.redLo ? current.close - band.redLo : 0
		const previousBand = context.apexBands?.[decisionIndex - 5]
		apex = {
			widthPct: band.s,
			distanceMeanWidth: (current.close - band.mean) / width,
			distanceInnerWidth: innerDistance / width,
			widthSlope5: previousBand && Number.isFinite(previousBand.s) ? (band.s - previousBand.s) / 5 : null,
			state: current.close < band.greenHi ? 'below-inner' : current.close > band.redLo ? 'above-inner' : 'inside',
		}
	}

	const reversals = (context.reversals ?? []).filter((signal) => signal.at <= current.timestamp).sort((a, b) => b.at - a.at)
	const lastReversal = reversals[0]

	const activeZones = (context.zones ?? []).filter((zone) => zone.knownAt <= current.timestamp && zone.geometryKnownAt <= current.timestamp)
	const zoneDistance = (zone: LiquidityPoiCandidate) => {
		const lower = Math.min(zone.near, zone.far), upper = Math.max(zone.near, zone.far)
		return current.close < lower ? lower - current.close : current.close > upper ? current.close - upper : 0
	}
	const nearestZone = activeZones.sort((a, b) => zoneDistance(a) - zoneDistance(b) || b.knownAt - a.knownAt)[0]
	const zoneAtr = nearestZone?.atr && nearestZone.atr > 0 ? nearestZone.atr : null

	const structure = (context.structureEvents ?? []).filter((event) => event.confirmIndex <= decisionIndex && event.confirmTimestamp <= current.timestamp).sort((a, b) => b.confirmIndex - a.confirmIndex)[0]

	const fib = (context.fibCandidates ?? []).filter((candidate) => candidate.createdAtIndex <= decisionIndex).sort((a, b) => b.createdAtIndex - a.createdAtIndex)[0]
	let fibFeatures: ZondaEdgeFeatureSnapshot['fib'] = { direction: null, nearestRatio: null, distanceLeg: null, legAtrRatio: null, ageBars: null }
	if (fib) {
		const variants = Object.values(fib.variants).filter((variant) => variant != null && variant.start.knownAtIndex <= decisionIndex)
		const variant = variants[0]
		if (variant && variant.legSize > 0) {
			const nearest = [...variant.levels].sort((a, b) => Math.abs(a.price - current.close) - Math.abs(b.price - current.close))[0]!
			fibFeatures = {
				direction: fib.direction,
				nearestRatio: nearest.ratio,
				distanceLeg: Math.abs(nearest.price - current.close) / variant.legSize,
				legAtrRatio: variant.legAtrRatio,
				ageBars: decisionIndex - fib.createdAtIndex,
			}
		}
	}

	return {
		version: ZONDA_EDGE_FEATURE_VERSION,
		at: current.timestamp,
		price: current.close,
		apex,
		reversal: { lastDirection: lastReversal?.direction ?? null, ageBars: lastReversal ? ageBars(lastReversal.at) : null },
		liquidity: nearestZone ? {
			direction: nearestZone.direction,
			distanceAtr: zoneAtr ? zoneDistance(nearestZone) / zoneAtr : null,
			stackShare: nearestZone.stackShare,
			stackNotional: nearestZone.stackNotional,
			touchCount: nearestZone.touchCount,
			ageBars: ageBars(nearestZone.knownAt),
			spent: nearestZone.spentAt != null && nearestZone.spentAt <= current.timestamp,
		} : { direction: null, distanceAtr: null, stackShare: null, stackNotional: null, touchCount: null, ageBars: null, spent: null },
		structure: structure ? {
			lastType: structure.type === 'unlabeled' ? null : structure.type,
			direction: structure.direction,
			ageBars: decisionIndex - structure.confirmIndex,
			oppositeSweptBefore: structure.oppositeSweptBefore,
			sweptDepthPct: structure.levelPrice > 0 ? structure.sweptDepth / structure.levelPrice : null,
		} : { lastType: null, direction: null, ageBars: null, oppositeSweptBefore: null, sweptDepthPct: null },
		fib: fibFeatures,
		market: {
			relativeVolume20: relativeVolume(candles, decisionIndex, 20),
			efficiencyRatio50: efficiencyRatio(candles, decisionIndex, 50),
			atrRatio100: atrRatio(candles, decisionIndex, 14, 100),
		},
	}
}
