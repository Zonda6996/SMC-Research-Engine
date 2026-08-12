import type { ExactDirection } from './exactIndicatorExport.js'

export interface TimedDirectionalEvent {
	at: number
	direction: ExactDirection
}

export interface EventMatch {
	truth: TimedDirectionalEvent
	prediction: TimedDirectionalEvent
	deltaBars: number
}

export interface EventMetrics {
	tp: number
	fp: number
	fn: number
	precision: number
	recall: number
	f1: number
	predictions: number
	truth: number
	matches: EventMatch[]
}

export function matchDirectionalEvents(
	truthInput: TimedDirectionalEvent[],
	predictionInput: TimedDirectionalEvent[],
	timeframeMs: number,
	toleranceBars = 0,
): EventMetrics {
	if (timeframeMs <= 0) throw new Error('timeframeMs must be positive')
	if (!Number.isInteger(toleranceBars) || toleranceBars < 0) throw new Error('toleranceBars must be a non-negative integer')
	const truth = [...truthInput].sort((a, b) => a.at - b.at || a.direction.localeCompare(b.direction))
	const predictions = [...predictionInput].sort((a, b) => a.at - b.at || a.direction.localeCompare(b.direction))
	const candidates: Array<{ truthIndex: number; predictionIndex: number; distance: number }> = []
	const toleranceMs = toleranceBars * timeframeMs
	for (let ti = 0; ti < truth.length; ti++) {
		for (let pi = 0; pi < predictions.length; pi++) {
			if (truth[ti]!.direction !== predictions[pi]!.direction) continue
			const distance = Math.abs(truth[ti]!.at - predictions[pi]!.at)
			if (distance <= toleranceMs) candidates.push({ truthIndex: ti, predictionIndex: pi, distance })
		}
	}
	candidates.sort((a, b) => a.distance - b.distance || truth[a.truthIndex]!.at - truth[b.truthIndex]!.at || predictions[a.predictionIndex]!.at - predictions[b.predictionIndex]!.at)
	const usedTruth = new Set<number>()
	const usedPredictions = new Set<number>()
	const matches: EventMatch[] = []
	for (const candidate of candidates) {
		if (usedTruth.has(candidate.truthIndex) || usedPredictions.has(candidate.predictionIndex)) continue
		usedTruth.add(candidate.truthIndex)
		usedPredictions.add(candidate.predictionIndex)
		matches.push({
			truth: truth[candidate.truthIndex]!,
			prediction: predictions[candidate.predictionIndex]!,
			deltaBars: (predictions[candidate.predictionIndex]!.at - truth[candidate.truthIndex]!.at) / timeframeMs,
		})
	}
	const tp = matches.length
	const fp = predictions.length - tp
	const fn = truth.length - tp
	const precision = tp / Math.max(1, tp + fp)
	const recall = tp / Math.max(1, tp + fn)
	const f1 = 2 * tp / Math.max(1, 2 * tp + fp + fn)
	return { tp, fp, fn, precision, recall, f1, predictions: predictions.length, truth: truth.length, matches }
}
