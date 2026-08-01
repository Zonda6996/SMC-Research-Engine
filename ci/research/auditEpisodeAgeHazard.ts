/**
 * Pre-detector descriptive audits for the episode-age hazard hypothesis (H1),
 * the rolling-window-vs-cooldown lock question (H2) and the hidden HTF condition (H3).
 *
 * (a) Per-age-bin first-label hazard on the FIT slices of the development datasets only.
 *     Episodes reuse the chronology-v2 grammar: an episode of a side starts at the first
 *     bar whose extreme breaches the inner band, and ends at a close through the mean
 *     (256-bar cap kept for consistency with diagnoseReversalChronology.ts).
 *     Hazard(bin) = first labels whose age falls in the bin / unlabeled episode-bars at risk.
 *     An episode is censored (stops contributing exposure) after its first label.
 *
 * (b) Global inter-label gap shape near the observed minimum (all 6 datasets, descriptive,
 *     no parameters fitted). An explicit cooldown implies a hard floor with mass piling up
 *     directly at 53-56; a rolling-window extremum mechanism implies a soft floor with a
 *     deficit just above the minimum.
 *
 * (c) Cross-TF coincidence of BTC.P labels in overlapping UTC ranges (5m vs 15m, 15m vs 1h,
 *     1h vs 4h). Observed rate of a same-direction lower-TF label within +/-W higher-TF bars
 *     of each higher-TF label, versus the rate expected under independence given the lower-TF
 *     label density in the overlap. No parameters fitted; W is fixed a priori at 2 HTF bars.
 *
 * No detector is built here, no sealed slices are consumed for (a), and nothing in this
 * script optimizes over thresholds.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chronologicalSlices, developmentDatasets, loadReversalDatasets } from './config/reversalDatasets.js'
import { exactEvents, type ExactDirection, type ExactIndicatorDataset, type ExactIndicatorRow } from './lib/exactIndicatorExport.js'

const EPISODE_CAP_BARS = 256

interface Episode {
	direction: ExactDirection
	start: number
	end: number
	firstLabelOffset: number | null
}

function collectEpisodes(rows: ExactIndicatorRow[]): Episode[] {
	const result: Episode[] = []
	for (const direction of ['long', 'short'] as const) {
		let current: Episode | null = null
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i]!
			const beyondInner = direction === 'long' ? row.low <= row.lowerInner : row.high >= row.upperInner
			const neutralClose = direction === 'long' ? row.close >= row.mean : row.close <= row.mean
			const label = direction === 'long' ? row.buy : row.sell
			if (!current && beyondInner) current = { direction, start: i, end: i, firstLabelOffset: null }
			if (current) {
				current.end = i
				if (label && current.firstLabelOffset == null) current.firstLabelOffset = i - current.start
				if (neutralClose || i - current.start >= EPISODE_CAP_BARS) {
					result.push(current)
					current = null
				}
			}
		}
		if (current) result.push(current)
	}
	return result
}

const AGE_BINS: Array<[number, number]> = [
	[0, 8], [8, 16], [16, 24], [24, 32], [32, 48], [48, 64], [64, 96], [96, 128], [128, 192], [192, 257],
]

interface HazardBin {
	from: number
	toExclusive: number
	events: number
	exposureBars: number
	hazard: number
	ratioToOverall: number
}

interface HazardSummary {
	datasetId: string
	direction: ExactDirection | 'both'
	episodes: number
	labeledEpisodes: number
	overallHazard: number
	bins: HazardBin[]
	maxRatio: number
	maxRatioBin: string
}

function hazardTable(episodes: Episode[], datasetId: string, direction: ExactDirection | 'both'): HazardSummary {
	const filtered = direction === 'both' ? episodes : episodes.filter((e) => e.direction === direction)
	const events = new Array<number>(AGE_BINS.length).fill(0)
	const exposure = new Array<number>(AGE_BINS.length).fill(0)
	let totalEvents = 0
	let totalExposure = 0
	for (const episode of filtered) {
		const duration = episode.end - episode.start + 1
		const riskEnd = episode.firstLabelOffset != null ? episode.firstLabelOffset + 1 : duration
		for (let b = 0; b < AGE_BINS.length; b++) {
			const [from, toEx] = AGE_BINS[b]!
			const overlap = Math.max(0, Math.min(riskEnd, toEx) - from)
			exposure[b]! += overlap
			totalExposure += overlap
			if (episode.firstLabelOffset != null && episode.firstLabelOffset >= from && episode.firstLabelOffset < toEx) {
				events[b]!++
				totalEvents++
			}
		}
	}
	const overall = totalExposure > 0 ? totalEvents / totalExposure : 0
	const bins: HazardBin[] = AGE_BINS.map(([from, toEx], b) => {
		const hazard = exposure[b]! > 0 ? events[b]! / exposure[b]! : 0
		return { from, toExclusive: toEx, events: events[b]!, exposureBars: exposure[b]!, hazard, ratioToOverall: overall > 0 ? hazard / overall : 0 }
	})
	const meaningful = bins.filter((bin) => bin.exposureBars >= 50)
	const best = meaningful.reduce((acc, bin) => (bin.ratioToOverall > acc.ratioToOverall ? bin : acc), meaningful[0] ?? bins[0]!)
	return {
		datasetId,
		direction,
		episodes: filtered.length,
		labeledEpisodes: filtered.filter((e) => e.firstLabelOffset != null).length,
		overallHazard: overall,
		bins,
		maxRatio: best?.ratioToOverall ?? 0,
		maxRatioBin: best ? `${best.from}-${best.toExclusive - 1}` : 'n/a',
	}
}

interface GapShape {
	datasetId: string
	totalGaps: number
	minGap: number
	histogram50to100: Record<number, number>
	massAtFloor53to56: number
	massAt57to70: number
	gapsBelow80: number
}

function gapShape(dataset: ExactIndicatorDataset): GapShape {
	const events = exactEvents(dataset.rows)
	const gaps: number[] = []
	for (let i = 1; i < events.length; i++) gaps.push(Math.round((events[i]!.at - events[i - 1]!.at) / dataset.meta.timeframeMs))
	const histogram: Record<number, number> = {}
	for (const gap of gaps) if (gap >= 50 && gap <= 100) histogram[gap] = (histogram[gap] ?? 0) + 1
	return {
		datasetId: dataset.meta.id,
		totalGaps: gaps.length,
		minGap: gaps.length ? Math.min(...gaps) : -1,
		histogram50to100: histogram,
		massAtFloor53to56: gaps.filter((g) => g >= 53 && g <= 56).length,
		massAt57to70: gaps.filter((g) => g >= 57 && g <= 70).length,
		gapsBelow80: gaps.filter((g) => g < 80).length,
	}
}

interface CoincidenceResult {
	pair: string
	overlapFromUtc: string
	overlapToUtc: string
	htfLabelsInOverlap: number
	ltfLabelsInOverlap: number
	windowHtfBars: number
	observedHits: number
	observedRate: number
	expectedRate: number
	clusteringCoefficient: number
}

function coincidence(htf: ExactIndicatorDataset, ltf: ExactIndicatorDataset, windowHtfBars: number): CoincidenceResult {
	const from = Math.max(htf.rows[0]!.timestamp, ltf.rows[0]!.timestamp)
	const to = Math.min(htf.rows.at(-1)!.timestamp, ltf.rows.at(-1)!.timestamp)
	const htfEvents = exactEvents(htf.rows).filter((e) => e.at >= from && e.at <= to)
	const ltfEvents = exactEvents(ltf.rows).filter((e) => e.at >= from && e.at <= to)
	const windowMs = windowHtfBars * htf.meta.timeframeMs
	let hits = 0
	for (const h of htfEvents) {
		if (ltfEvents.some((l) => l.direction === h.direction && Math.abs(l.at - h.at) <= windowMs)) hits++
	}
	const overlapMs = to - from
	let expected = 0
	for (const direction of ['long', 'short'] as const) {
		const nHtf = htfEvents.filter((e) => e.direction === direction).length
		const nLtf = ltfEvents.filter((e) => e.direction === direction).length
		const rate = nLtf / Math.max(1, overlapMs)
		const pHit = 1 - Math.exp(-rate * 2 * windowMs)
		expected += (nHtf / Math.max(1, htfEvents.length)) * pHit
	}
	const observedRate = htfEvents.length ? hits / htfEvents.length : 0
	return {
		pair: htf.meta.id + ' vs ' + ltf.meta.id,
		overlapFromUtc: new Date(from).toISOString(),
		overlapToUtc: new Date(to).toISOString(),
		htfLabelsInOverlap: htfEvents.length,
		ltfLabelsInOverlap: ltfEvents.length,
		windowHtfBars,
		observedHits: hits,
		observedRate,
		expectedRate: expected,
		clusteringCoefficient: expected > 0 ? observedRate / expected : 0,
	}
}

const datasets = loadReversalDatasets()
const dev = developmentDatasets(datasets)

const hazardSummaries: HazardSummary[] = []
for (const dataset of dev) {
	const fit = chronologicalSlices(dataset).find((slice) => slice.kind === 'fit')!
	const rows = dataset.rows.slice(fit.fromIndex, fit.toIndexExclusive)
	const eps = collectEpisodes(rows)
	hazardSummaries.push(hazardTable(eps, dataset.meta.id, 'both'))
	hazardSummaries.push(hazardTable(eps, dataset.meta.id, 'long'))
	hazardSummaries.push(hazardTable(eps, dataset.meta.id, 'short'))
}

const gapShapes = datasets.map(gapShape)

const btc = datasets.filter((d) => d.meta.symbol.includes('BTC') && d.meta.market === 'futures')
btc.sort((a, b) => a.meta.timeframeMs - b.meta.timeframeMs)
const coincidences: CoincidenceResult[] = []
for (let i = 0; i + 1 < btc.length; i++) {
	coincidences.push(coincidence(btc[i + 1]!, btc[i]!, 2))
}

const fmtHazard = (s: HazardSummary) =>
	'### ' + s.datasetId + ' (' + s.direction + ')\n\n- Episodes ' + s.episodes + ', labeled ' + s.labeledEpisodes + ', overall hazard ' + (1e3 * s.overallHazard).toFixed(3) + ' per 1000 at-risk bars.\n- Max bin ratio ' + s.maxRatio.toFixed(2) + 'x at age ' + s.maxRatioBin + '.\n\n| age bin | events | exposure | hazard/1000 | ratio |\n|---|---|---|---|---|\n' + s.bins.map((b) => '| ' + b.from + '-' + (b.toExclusive - 1) + ' | ' + b.events + ' | ' + b.exposureBars + ' | ' + (1e3 * b.hazard).toFixed(3) + ' | ' + b.ratioToOverall.toFixed(2) + ' |').join('\n')

const fmtGap = (g: GapShape) => {
	const keys = Object.keys(g.histogram50to100).map(Number).sort((a, b) => a - b)
	return '### ' + g.datasetId + '\n\n- ' + g.totalGaps + ' global gaps, min ' + g.minGap + '; mass at 53-56: ' + g.massAtFloor53to56 + '; mass at 57-70: ' + g.massAt57to70 + '; gaps < 80: ' + g.gapsBelow80 + '.\n- Histogram 50-100: ' + (keys.length ? keys.map((k) => k + ':' + g.histogram50to100[k]).join(', ') : '(empty)')
}

const fmtCoin = (c: CoincidenceResult) =>
	'### ' + c.pair + '\n\n- Overlap ' + c.overlapFromUtc + ' .. ' + c.overlapToUtc + '; HTF labels ' + c.htfLabelsInOverlap + ', LTF labels ' + c.ltfLabelsInOverlap + '.\n- Observed same-direction hit rate within +/-' + c.windowHtfBars + ' HTF bars: ' + (100 * c.observedRate).toFixed(1) + '% (' + c.observedHits + '/' + c.htfLabelsInOverlap + '); expected under independence ' + (100 * c.expectedRate).toFixed(1) + '%.\n- Clustering coefficient: ' + c.clusteringCoefficient.toFixed(2) + 'x.'

const md = '# Episode-age hazard pre-detector audits (H1/H2/H3)\n\nBranch: research/episode-age-hazard. Descriptive only: no detector, no parameter search, hazard uses development FIT slices only.\n\n## (a) Per-age-bin first-label hazard - dev fit slices\n\nEpisode grammar identical to chronology v2 (first inner breach -> close through mean, ' + EPISODE_CAP_BARS + '-bar cap). Episodes censored after first label. Pre-registered kill criterion for H1: no bin (with >=50 bars exposure) reaching >=2x the overall hazard means the age variable alone cannot separate labeled from unlabeled episode-bars.\n\n' + hazardSummaries.map(fmtHazard).join('\n\n') + '\n\n## (b) Global inter-label gap shape near the minimum - all datasets\n\nH2 (rolling-window extremum) predicts a soft floor: few gaps piled at 53-56 and a deficit through ~70. An explicit cooldown predicts a hard floor with visible mass directly at 53-56.\n\n' + gapShapes.map(fmtGap).join('\n\n') + '\n\n## (c) Cross-TF coincidence of BTC.P labels - overlapping UTC ranges\n\nWindow fixed a priori at +/-2 HTF bars. Pre-registered kill criterion for H3: clustering coefficient <= 1.5x on every pair.\n\n' + coincidences.map(fmtCoin).join('\n\n') + '\n\n## Notes\n\n- (a) consumes only fit slices of the two development datasets; sealed and holdout data untouched.\n- (b) and (c) are descriptive statistics of the existing 370 vendor labels; they fit no thresholds and are excluded from the detector multiple-testing budget.\n'

mkdirSync(resolve('ci-results'), { recursive: true })
writeFileSync(resolve('ci-results/episode-age-hazard-audits-v1.json'), JSON.stringify({ hazardSummaries, gapShapes, coincidences }, null, 2))
writeFileSync(resolve('ci-results/episode-age-hazard-audits-v1.md'), md)
console.log(md)
