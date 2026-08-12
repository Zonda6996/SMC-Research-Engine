import type { ExactIndicatorRow } from '../../../ci/research/lib/exactIndicatorExport.js'
import { validGgiBand } from '../../../ci/research/lib/ggiCorrectedReplay.js'
import { INDEPENDENT_REVERSAL_G2_PROTOCOL } from './IndependentReversalG2Protocol.js'

export type IndependentReversalG2Side = 1 | -1
export type IndependentReversalG2Source = 'EXT' | 'OWN1'

export interface IndependentReversalG2Candidate {
	index: number
	at: number
	side: IndependentReversalG2Side
	source: IndependentReversalG2Source
	opportunityId: string
	features: {
		penetrationInner: number
		distanceMeanPct: number
		relativeVolume: number
		bodyRatio: number
		meanDroughtBars: number
		failedContinuation: number
		meanSlopeAtr: number
		contractionRatio: number
		sequenceScore: number
	}
}

function relativeVolume(rows: readonly ExactIndicatorRow[], index: number, period: number): number {
	let sum = 0
	for (let i = index - period; i < index; i++) sum += rows[i]!.volume
	return sum > 0 ? rows[index]!.volume / (sum / period) : 0
}

function bodySma(rows: readonly ExactIndicatorRow[], index: number, period: number): number {
	let sum = 0
	for (let i = index - period; i < index; i++) sum += Math.abs(rows[i]!.close - rows[i]!.open)
	return sum / period
}

function averageRange(rows: readonly ExactIndicatorRow[], from: number, to: number): number {
	let sum = 0
	for (let i = from; i < to; i++) sum += rows[i]!.high - rows[i]!.low
	return to > from ? sum / (to - from) : 0
}

function trueRange(rows: readonly ExactIndicatorRow[], index: number): number {
	const row = rows[index]!
	const previous = rows[index - 1] ?? row
	return Math.max(row.high - row.low, Math.abs(row.high - previous.close), Math.abs(row.low - previous.close))
}

function features(
	rows: readonly ExactIndicatorRow[],
	index: number,
	side: IndependentReversalG2Side,
	lastMeanTouch: number,
	penetrationInner: number,
	distanceMeanPct: number,
	rv: number,
	bodyRatio: number,
): IndependentReversalG2Candidate['features'] {
	const protocol = INDEPENDENT_REVERSAL_G2_PROTOCOL
	const lookback = protocol.sequence.failedContinuationLookback
	let adverseExtreme = side === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
	for (let i = index - lookback; i < index; i++) adverseExtreme = side === 1 ? Math.min(adverseExtreme, rows[i]!.low) : Math.max(adverseExtreme, rows[i]!.high)
	const current = rows[index]!
	const failedContinuation: number = side === 1
		? (current.low >= adverseExtreme && current.close > current.open ? 1 : 0)
		: (current.high <= adverseExtreme && current.close < current.open ? 1 : 0)
	const slopeBars = protocol.sequence.meanSlopeLookback
	let atrSum = 0
	for (let i = index - slopeBars + 1; i <= index; i++) atrSum += trueRange(rows, i)
	const atr = atrSum / slopeBars
	const rawSlope = (current.mean - rows[index - slopeBars]!.mean) / Math.max(atr, Number.EPSILON)
	const meanSlopeAtr = side === 1 ? rawSlope : -rawSlope
	const contraction = protocol.sequence.contractionLookback
	const recentRange = averageRange(rows, index - Math.floor(contraction / 2), index)
	const priorRange = averageRange(rows, index - contraction, index - Math.floor(contraction / 2))
	const contractionRatio = priorRange > 0 ? recentRange / priorRange : 1
	const sequenceScore = failedContinuation
		+ (meanSlopeAtr > -0.25 ? 1 : 0)
		+ (contractionRatio < 1 ? 1 : 0)
		+ ((side === 1 ? current.close > current.open : current.close < current.open) ? 1 : 0)
	return {
		penetrationInner,
		distanceMeanPct,
		relativeVolume: rv,
		bodyRatio,
		meanDroughtBars: index - lastMeanTouch,
		failedContinuation,
		meanSlopeAtr,
		contractionRatio,
		sequenceScore,
	}
}

export function detectIndependentReversalG2Candidates(rows: readonly ExactIndicatorRow[]): IndependentReversalG2Candidate[] {
	const protocol = INDEPENDENT_REVERSAL_G2_PROTOCOL
	const out: IndependentReversalG2Candidate[] = []
	let lastMeanTouch = -1e9
	let lastOwn1: Record<IndependentReversalG2Side, number> = { 1: -1e9, [-1]: -1e9 }
	const lastOpportunity: Record<IndependentReversalG2Source, Record<IndependentReversalG2Side, number>> = {
		EXT: { 1: -1e9, [-1]: -1e9 },
		OWN1: { 1: -1e9, [-1]: -1e9 },
	}

	for (let index = 0; index < rows.length; index++) {
		const row = rows[index]!
		if (!validGgiBand(row)) continue
		const touchesMean = row.low <= row.mean && row.mean <= row.high
		if (index >= protocol.candidate.warmupBars && index < rows.length - 1) {
			const rv = relativeVolume(rows, index, protocol.candidate.relativeVolumePeriod)
			const bodyAverage = bodySma(rows, index, protocol.candidate.own1BodySmaPeriod)
			const bodyRatio = bodyAverage > 0 ? Math.abs(row.close - row.open) / bodyAverage : 0
			for (const side of [1, -1] as const) {
				const half = side === 1 ? row.mean - row.lowerInner : row.upperInner - row.mean
				if (half <= 0) continue
				const band = side === 1 ? row.lowerInner : row.upperInner
				const penetrationInner = side === 1 ? (band - row.close) / half : (row.close - band) / half
				const distanceMeanPct = Math.abs(row.close - row.mean) / row.mean * 100
				const correctSide = side === 1 ? row.close < row.mean : row.close > row.mean
				const favorableBody = side === 1 ? row.close > row.open : row.close < row.open
				const ext = correctSide
					&& penetrationInner >= protocol.candidate.extensionPenetrationMin
					&& distanceMeanPct >= protocol.candidate.extensionDistanceMeanPctMin
					&& rv >= protocol.candidate.extensionRelativeVolumeMin
				const own1 = correctSide && favorableBody
					&& bodyRatio >= protocol.candidate.own1BodyMultiple
					&& index - lastMeanTouch >= protocol.candidate.own1MeanDroughtBars
					&& index - lastOwn1[side] > protocol.candidate.own1SideCooldownBars
				const add = (source: IndependentReversalG2Source): void => {
					if (index - lastOpportunity[source][side] <= protocol.candidate.opportunityCooldownBars) return
					out.push({
						index,
						at: row.timestamp,
						side,
						source,
						opportunityId: `${side === 1 ? 'L' : 'S'}-${index}`,
						features: features(rows, index, side, lastMeanTouch, penetrationInner, distanceMeanPct, rv, bodyRatio),
					})
					lastOpportunity[source][side] = index
				}
				if (ext) add('EXT')
				if (own1) {
					add('OWN1')
					lastOwn1[side] = index
				}
			}
		}
		if (touchesMean) lastMeanTouch = index
	}
	return out.sort((a, b) => a.index - b.index || b.side - a.side || a.source.localeCompare(b.source))
}
