import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseExactIndicatorCsv } from './lib/exactIndicatorExport.js'
import {
	detectStatefulApexEvents,
	labelStatefulApexEvent,
	statefulApexSplit,
	type ApexEventSide,
	type ApexTrajectoryFeatures,
	type StatefulApexRow,
} from './lib/statefulApexEvents.js'

const MANIFEST_PATH = resolve('ci-results/stateful-apex-s1-manifest.json')
const S2_PATH = resolve('ci-results/stateful-apex-s2-results.json')
const JSON_OUT = resolve('ci-results/stateful-apex-s3-profile.json')
const MD_OUT = resolve('ci-results/stateful-apex-s3-profile.md')
const ALLOWED_SPLITS = ['train', 'validation'] as const
const PRIMARY_MIN_TF_MINUTES = 15
const ONE_WAY_COST_BPS = 5
const BOOTSTRAP_SEED = 20260820
const BOOTSTRAP_RESAMPLES = 2_000
const RANDOM_BASELINE_RESAMPLES = 500
const MIN_GROUP_CLASS_N = 10

type AllowedSplit = typeof ALLOWED_SPLITS[number]
type Outcome = 'winner' | 'loser'
type Classification = 'robust candidate' | 'unstable correlation' | 'leakage/proxy risk' | 'no signal'

interface ManifestSeries {
	file: string
	symbol: string
	timeframe: string
	market: 'spot' | 'futures'
	split: 'train' | 'validation' | 'untouched-oos'
	rows: number
	eligibleRows: number
	sha256: string
	primaryEvents: number
	censoredNoNextBar: number
}
interface FrozenManifest {
	config: { protocolVersion: string; oneWayCostBps: number; warmupBars: number; vendorShapesInFeaturesOrTargets: boolean }
	configHash: string
	codeHashes: { stateMachine: string; runner: string; tests: string }
	series: ManifestSeries[]
	oOSSeal: { status: string; outcomesComputed: boolean; metricsPublished: boolean }
}
interface S2Results {
	protocol: { manifestConfigHash: string; stateMachineHash: string; oneWayCostBps: number; vendorShapesUsed: boolean; integrityErrors: string[] }
	oosRevealCount: number
	untouchedOos: unknown
	verdict: string
}
interface Observation {
	id: string
	split: AllowedSplit
	symbol: string
	series: string
	timeframe: string
	timeframeMinutes: number
	side: ApexEventSide
	timestamp: number
	month: string
	temporalFold: 'early' | 'middle' | 'late'
	outcome: Outcome
	features: Record<string, number | null>
}
interface Distribution {
	n: number
	mean: number | null
	q10: number | null
	q25: number | null
	median: number | null
	q75: number | null
	q90: number | null
}
interface Stability {
	dimension: string
	estimable: number
	positive: number
	negative: number
	zero: number
	agreementWithPooled: number | null
	groups: Array<{ group: string; winners: number; losers: number; effect: number }>
}
interface FeatureReport {
	feature: string
	description: string
	proxyRisk: string | null
	primary: {
		winners: Distribution
		losers: Distribution
		effect: number | null
		medianDifference: number | null
		clusterCi95: { low: number | null; high: number | null }
		matchedRandomBaseline: { resamples: number; p95AbsEffect: number | null; empiricalP: number | null }
		bhQ: number | null
	}
	bySplit: Array<{ split: AllowedSplit; winners: Distribution; losers: Distribution; effect: number | null }>
	stability: Stability[]
	lowTfSensitivity: { winners: Distribution; losers: Distribution; effect: number | null }
	classification: Classification
	reasons: string[]
}

const FEATURE_DEFINITIONS: Array<{ name: string; description: string; proxyRisk: string | null }> = [
	{ name: 'barsSinceMean', description: 'Bars since last mean touch.', proxyRisk: null },
	{ name: 'barsSinceInner', description: 'Bars since first inner-band touch.', proxyRisk: null },
	{ name: 'currentDepth', description: 'Close depth in contemporaneous inner-width units.', proxyRisk: 'Uses the same Apex geometry that defines target/stop distances; causal but may proxy payoff geometry.' },
	{ name: 'maxDepth', description: 'Maximum adverse depth in contemporaneous inner-width units.', proxyRisk: 'Uses the same Apex geometry that defines target/stop distances; causal but may proxy payoff geometry.' },
	{ name: 'newAdverseExtremes', description: 'Count of new adverse extremes before confirmation.', proxyRisk: null },
	{ name: 'lastExtensionIncrementOverInner', description: 'Latest extension increment / inner width.', proxyRisk: null },
	{ name: 'previousExtensionIncrementOverInner', description: 'Previous extension increment / inner width.', proxyRisk: null },
	{ name: 'recoveryFromExtremeOverInner', description: 'Recovery from episode extreme / inner width.', proxyRisk: null },
	{ name: 'closeToMeanProgress', description: 'One-bar fractional progress toward mean.', proxyRisk: 'Mechanically related to the frozen reversal-confirmation condition; causal but may be a trigger-strength proxy.' },
	{ name: 'sideAlignedBodyOverInner', description: 'Body aligned to trade side / inner width.', proxyRisk: null },
	{ name: 'rangeOverInner', description: 'Candle range / inner width.', proxyRisk: null },
	{ name: 'upperWickOverInner', description: 'Upper wick / inner width.', proxyRisk: null },
	{ name: 'lowerWickOverInner', description: 'Lower wick / inner width.', proxyRisk: null },
	{ name: 'trueRangeOverInner', description: 'True range / inner width.', proxyRisk: null },
	{ name: 'meanSlopeOverInner', description: 'One-bar mean slope aligned to trade side / inner width.', proxyRisk: null },
	{ name: 'innerWidthOverTrueRange', description: 'Inner width / true range.', proxyRisk: 'Width is part of frozen target/stop geometry; association may be payoff scaling rather than entry information.' },
	{ name: 'outerWidthOverTrueRange', description: 'Outer width / true range.', proxyRisk: 'Outer width directly participates in frozen stop geometry; association may be payoff scaling rather than entry information.' },
	{ name: 'innerWidthChangeOverTrueRange', description: 'One-bar inner-width change / true range.', proxyRisk: 'Derived from geometry used by the frozen payoff definition.' },
	{ name: 'outerWidthChangeOverTrueRange', description: 'One-bar outer-width change / true range.', proxyRisk: 'Derived from geometry used by the frozen payoff definition.' },
]

function sha256File(path: string): string {
	return createHash('sha256').update(readFileSync(resolve(path))).digest('hex')
}
function sha256Text(text: string): string {
	return createHash('sha256').update(text).digest('hex')
}
function timeframeMinutes(tf: string): number {
	if (/^\d+$/.test(tf)) return Number(tf)
	if (/^\d+S$/.test(tf)) return Number(tf.slice(0, -1)) / 60
	throw new Error(`Unsupported timeframe: ${tf}`)
}
function finiteOrNull(value: number | null): number | null {
	return value != null && Number.isFinite(value) ? value : null
}
function normalizedFeatures(f: ApexTrajectoryFeatures): Record<string, number | null> {
	const inner = f.innerWidth > 0 ? f.innerWidth : NaN
	const tr = f.trueRange > 0 ? f.trueRange : NaN
	const aligned = f.side === 'long' ? 1 : -1
	return {
		barsSinceMean: f.barsSinceMean,
		barsSinceInner: f.barsSinceInner,
		currentDepth: finiteOrNull(f.currentDepth),
		maxDepth: finiteOrNull(f.maxDepth),
		newAdverseExtremes: f.newAdverseExtremes,
		lastExtensionIncrementOverInner: finiteOrNull(f.lastExtensionIncrement == null ? null : f.lastExtensionIncrement / inner),
		previousExtensionIncrementOverInner: finiteOrNull(f.previousExtensionIncrement == null ? null : f.previousExtensionIncrement / inner),
		recoveryFromExtremeOverInner: finiteOrNull(f.recoveryFromExtreme / inner),
		closeToMeanProgress: finiteOrNull(f.closeToMeanProgress),
		sideAlignedBodyOverInner: finiteOrNull(aligned * f.body / inner),
		rangeOverInner: finiteOrNull(f.range / inner),
		upperWickOverInner: finiteOrNull(f.upperWick / inner),
		lowerWickOverInner: finiteOrNull(f.lowerWick / inner),
		trueRangeOverInner: finiteOrNull(f.trueRange / inner),
		meanSlopeOverInner: finiteOrNull(f.meanSlope == null ? null : aligned * f.meanSlope / inner),
		innerWidthOverTrueRange: finiteOrNull(f.innerWidth / tr),
		outerWidthOverTrueRange: finiteOrNull(f.outerWidth / tr),
		innerWidthChangeOverTrueRange: finiteOrNull(f.innerWidthChange == null ? null : f.innerWidthChange / tr),
		outerWidthChangeOverTrueRange: finiteOrNull(f.outerWidthChange == null ? null : f.outerWidthChange / tr),
	}
}
function quantile(sorted: readonly number[], p: number): number | null {
	if (sorted.length === 0) return null
	const position = (sorted.length - 1) * p
	const lower = Math.floor(position), upper = Math.ceil(position)
	return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower)
}
function distribution(values: readonly number[]): Distribution {
	const sorted = [...values].sort((a, b) => a - b)
	return {
		n: sorted.length,
		mean: sorted.length === 0 ? null : sorted.reduce((a, b) => a + b, 0) / sorted.length,
		q10: quantile(sorted, 0.10), q25: quantile(sorted, 0.25), median: quantile(sorted, 0.50),
		q75: quantile(sorted, 0.75), q90: quantile(sorted, 0.90),
	}
}
function values(observations: readonly Observation[], feature: string, outcome?: Outcome): number[] {
	return observations.flatMap((o) => outcome != null && o.outcome !== outcome ? [] : o.features[feature] == null ? [] : [o.features[feature]!])
}
// Cliff's delta: P(winner > loser) - P(winner < loser), computed in O(n log n).
function cliffsDelta(winners: readonly number[], losers: readonly number[]): number | null {
	if (winners.length === 0 || losers.length === 0) return null
	const sorted = [...losers].sort((a, b) => a - b)
	let score = 0
	for (const x of winners) {
		let lo = 0, hi = sorted.length
		while (lo < hi) { const mid = (lo + hi) >>> 1; if (sorted[mid]! < x) lo = mid + 1; else hi = mid }
		const below = lo
		lo = 0; hi = sorted.length
		while (lo < hi) { const mid = (lo + hi) >>> 1; if (sorted[mid]! <= x) lo = mid + 1; else hi = mid }
		const above = sorted.length - lo
		score += below - above
	}
	return score / (winners.length * losers.length)
}
function mulberry32(seed: number): () => number {
	let a = seed >>> 0
	return () => {
		a |= 0; a = a + 0x6D2B79F5 | 0
		let t = Math.imul(a ^ a >>> 15, 1 | a)
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
		return ((t ^ t >>> 14) >>> 0) / 4_294_967_296
	}
}
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
	const out = [...items]
	for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!] }
	return out
}
function clusterBootstrap(observations: readonly Observation[], feature: string, seed: number): { low: number | null; high: number | null } {
	const bySeries = new Map<string, Observation[]>()
	for (const o of observations) { const group = bySeries.get(o.series) ?? []; group.push(o); bySeries.set(o.series, group) }
	const clusters = [...bySeries.values()]
	if (clusters.length < 2) return { low: null, high: null }
	const rng = mulberry32(seed)
	const estimates: number[] = []
	for (let b = 0; b < BOOTSTRAP_RESAMPLES; b++) {
		const sample: Observation[] = []
		for (let i = 0; i < clusters.length; i++) sample.push(...clusters[Math.floor(rng() * clusters.length)]!)
		const effect = cliffsDelta(values(sample, feature, 'winner'), values(sample, feature, 'loser'))
		if (effect != null) estimates.push(effect)
	}
	estimates.sort((a, b) => a - b)
	return { low: quantile(estimates, 0.025), high: quantile(estimates, 0.975) }
}
function randomBaseline(observations: readonly Observation[], feature: string, observed: number | null, seed: number): { resamples: number; p95AbsEffect: number | null; empiricalP: number | null } {
	if (observed == null) return { resamples: RANDOM_BASELINE_RESAMPLES, p95AbsEffect: null, empiricalP: null }
	const strata = new Map<string, Observation[]>()
	for (const o of observations) {
		const key = `${o.series}|${o.side}|${o.temporalFold}`
		const group = strata.get(key) ?? []; group.push(o); strata.set(key, group)
	}
	const rng = mulberry32(seed)
	const nullEffects: number[] = []
	for (let b = 0; b < RANDOM_BASELINE_RESAMPLES; b++) {
		const pseudoWinners: number[] = [], pseudoLosers: number[] = []
		for (const group of strata.values()) {
			const labels = shuffle(group.map((o) => o.outcome), rng)
			for (let i = 0; i < group.length; i++) {
				const value = group[i]!.features[feature]
				if (value == null) continue
				;(labels[i] === 'winner' ? pseudoWinners : pseudoLosers).push(value)
			}
		}
		const effect = cliffsDelta(pseudoWinners, pseudoLosers)
		if (effect != null) nullEffects.push(effect)
	}
	const absolute = nullEffects.map(Math.abs).sort((a, b) => a - b)
	return {
		resamples: RANDOM_BASELINE_RESAMPLES,
		p95AbsEffect: quantile(absolute, 0.95),
		empiricalP: (1 + absolute.filter((x) => x >= Math.abs(observed)).length) / (1 + absolute.length),
	}
}
function stability(observations: readonly Observation[], feature: string, pooled: number | null, dimension: string, groupOf: (o: Observation) => string): Stability {
	const groups = new Map<string, Observation[]>()
	for (const o of observations) { const key = groupOf(o); const group = groups.get(key) ?? []; group.push(o); groups.set(key, group) }
	const effects = [...groups].flatMap(([group, rows]) => {
		const winners = values(rows, feature, 'winner'), losers = values(rows, feature, 'loser')
		if (winners.length < MIN_GROUP_CLASS_N || losers.length < MIN_GROUP_CLASS_N) return []
		return [{ group, winners: winners.length, losers: losers.length, effect: cliffsDelta(winners, losers)! }]
	})
	const pooledSign = pooled == null ? 0 : Math.sign(pooled)
	return {
		dimension,
		estimable: effects.length,
		positive: effects.filter((x) => x.effect > 0).length,
		negative: effects.filter((x) => x.effect < 0).length,
		zero: effects.filter((x) => x.effect === 0).length,
		agreementWithPooled: pooledSign === 0 || effects.length === 0 ? null : effects.filter((x) => Math.sign(x.effect) === pooledSign).length / effects.length,
		groups: effects,
	}
}
function bhAdjust(reports: FeatureReport[]): void {
	const eligible = reports.flatMap((report, index) => report.primary.matchedRandomBaseline.empiricalP == null ? [] : [{ index, p: report.primary.matchedRandomBaseline.empiricalP }]).sort((a, b) => a.p - b.p)
	let running = 1
	for (let i = eligible.length - 1; i >= 0; i--) {
		const item = eligible[i]!
		running = Math.min(running, item.p * eligible.length / (i + 1))
		reports[item.index]!.primary.bhQ = running
	}
}
function classify(report: FeatureReport): void {
	const effect = report.primary.effect
	const ci = report.primary.clusterCi95
	const baseline = report.primary.matchedRandomBaseline
	const train = report.bySplit.find((x) => x.split === 'train')?.effect ?? null
	const validation = report.bySplit.find((x) => x.split === 'validation')?.effect ?? null
	const agreements = report.stability.map((x) => x.agreementWithPooled).filter((x): x is number => x != null)
	const reasons: string[] = []
	const significant = effect != null && Math.abs(effect) >= 0.147
		&& ci.low != null && ci.high != null && (ci.low > 0 || ci.high < 0)
		&& report.primary.bhQ != null && report.primary.bhQ <= 0.05
		&& baseline.p95AbsEffect != null && Math.abs(effect) > baseline.p95AbsEffect
	const stable = effect != null && train != null && validation != null
		&& Math.sign(train) === Math.sign(effect) && Math.sign(validation) === Math.sign(effect)
		&& agreements.length >= 4 && agreements.every((x) => x >= 0.65)
	if (effect == null) reasons.push('Insufficient resolved winner/loser values.')
	if (effect != null && Math.abs(effect) < 0.147) reasons.push('Absolute Cliff effect is below the conservative small-effect floor (0.147).')
	if (ci.low == null || ci.high == null || !(ci.low > 0 || ci.high < 0)) reasons.push('Series-cluster bootstrap CI crosses zero.')
	if (report.primary.bhQ == null || report.primary.bhQ > 0.05) reasons.push('Matched-label permutation p-value does not survive Benjamini-Hochberg FDR 5%.')
	if (train == null || validation == null || effect == null || Math.sign(train) !== Math.sign(effect) || Math.sign(validation) !== Math.sign(effect)) reasons.push('Sign is not stable across train and validation.')
	if (agreements.length < 4 || agreements.some((x) => x < 0.65)) reasons.push('Sign agreement is below 65% in at least one breadth dimension (symbol/series/TF/side/temporal fold).')
	if (significant && stable && report.proxyRisk == null) { report.classification = 'robust candidate'; reasons.push('Passes conservative effect, cluster-CI, matched-baseline, FDR, split, and breadth screens.') }
	else if (significant && stable && report.proxyRisk != null) { report.classification = 'leakage/proxy risk'; reasons.push(report.proxyRisk) }
	else if (effect != null && (Math.abs(effect) >= 0.147 || (ci.low != null && ci.high != null && (ci.low > 0 || ci.high < 0)))) report.classification = report.proxyRisk != null ? 'leakage/proxy risk' : 'unstable correlation'
	else report.classification = 'no signal'
	report.reasons = reasons
}
function fmt(value: number | null, digits = 3): string { return value == null ? 'n/a' : value.toFixed(digits) }

function main(): void {
	const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FrozenManifest
	const s2 = JSON.parse(readFileSync(S2_PATH, 'utf8')) as S2Results
	const integrityErrors: string[] = []
	if (manifest.config.protocolVersion !== 'apex-state-v1') integrityErrors.push('protocolVersion mismatch')
	if (manifest.config.oneWayCostBps !== ONE_WAY_COST_BPS || s2.protocol.oneWayCostBps !== ONE_WAY_COST_BPS) integrityErrors.push('cost mismatch')
	if (manifest.config.vendorShapesInFeaturesOrTargets !== false || s2.protocol.vendorShapesUsed !== false) integrityErrors.push('vendor Shapes prohibition mismatch')
	if (sha256Text(JSON.stringify(manifest.config)) !== manifest.configHash || s2.protocol.manifestConfigHash !== manifest.configHash) integrityErrors.push('manifest config hash mismatch')
	if (sha256File('ci/research/lib/statefulApexEvents.ts') !== manifest.codeHashes.stateMachine || s2.protocol.stateMachineHash !== manifest.codeHashes.stateMachine) integrityErrors.push('state-machine hash mismatch')
	if (sha256File('ci/research/runStatefulApexS1.ts') !== manifest.codeHashes.runner) integrityErrors.push('S1 runner hash mismatch')
	if (sha256File('tests/statefulApexEvents.test.ts') !== manifest.codeHashes.tests) integrityErrors.push('state-machine test hash mismatch')
	if (s2.protocol.integrityErrors.length !== 0) integrityErrors.push('S2 contains integrity errors')
	if (s2.oosRevealCount !== 0 || s2.untouchedOos !== null || manifest.oOSSeal.status !== 'untouched') integrityErrors.push('untouched-OOS seal mismatch')

	const observations: Observation[] = []
	let filesRead = 0
	let parsedRows = 0
	let resolvedEvents = 0
	let unresolvedOrInvalidEvents = 0
	const allowedSeries = manifest.series.filter((series): series is ManifestSeries & { split: AllowedSplit } => ALLOWED_SPLITS.includes(series.split as AllowedSplit))
	const forbiddenSeries = manifest.series.filter((series) => series.split === 'untouched-oos')
	for (const series of allowedSeries) {
		// Security boundary: untouched-OOS paths never reach readFileSync, hash checks, parser, detector, or labeler.
		if (sha256File(series.file) !== series.sha256) integrityErrors.push(`data hash mismatch: ${series.file}`)
		if (statefulApexSplit(series.symbol) !== series.split) integrityErrors.push(`split mismatch: ${series.file}`)
		const parsed = parseExactIndicatorCsv(readFileSync(resolve(series.file), 'utf8'), { allowIrregularBars: true, allowInvalidBandOrder: true })
		filesRead++
		parsedRows += parsed.length
		// BUY/SELL columns are validated by the parser, then irreversibly discarded before detection and profiling.
		const rows: StatefulApexRow[] = parsed.map(({ buy: _buy, sell: _sell, ...row }) => row).slice(manifest.config.warmupBars)
		if (parsed.length !== series.rows || rows.length !== series.eligibleRows) integrityErrors.push(`row count mismatch: ${series.file}`)
		const events = detectStatefulApexEvents(rows)
		if (events.events.length !== series.primaryEvents) integrityErrors.push(`event count mismatch: ${series.file}`)
		const resolved = events.events.flatMap((event) => {
			const label = labelStatefulApexEvent(rows, event, ONE_WAY_COST_BPS)
			if (label?.netR5bps == null) { unresolvedOrInvalidEvents++; return [] }
			resolvedEvents++
			return [{ event, outcome: label.netR5bps > 0 ? 'winner' as const : 'loser' as const }]
		})
		const ordered = [...resolved].sort((a, b) => a.event.confirmationTimestamp - b.event.confirmationTimestamp)
		for (let i = 0; i < ordered.length; i++) {
			const item = ordered[i]!
			const fold = i < ordered.length / 3 ? 'early' : i < 2 * ordered.length / 3 ? 'middle' : 'late'
			observations.push({
				id: `${series.file}:${item.event.id}`,
				split: series.split,
				symbol: series.symbol,
				series: series.file,
				timeframe: series.timeframe,
				timeframeMinutes: timeframeMinutes(series.timeframe),
				side: item.event.side,
				timestamp: item.event.confirmationTimestamp,
				month: new Date(item.event.confirmationTimestamp).toISOString().slice(0, 7),
				temporalFold: fold,
				outcome: item.outcome,
				features: normalizedFeatures(item.event.features),
			})
		}
	}
	if (integrityErrors.length > 0) throw new Error(`Frozen protocol integrity failure:\n${integrityErrors.join('\n')}`)

	const primary = observations.filter((o) => o.timeframeMinutes >= PRIMARY_MIN_TF_MINUTES)
	const lowTf = observations.filter((o) => o.timeframeMinutes < PRIMARY_MIN_TF_MINUTES)
	const reports: FeatureReport[] = FEATURE_DEFINITIONS.map((definition, index) => {
		const winners = values(primary, definition.name, 'winner'), losers = values(primary, definition.name, 'loser')
		const effect = cliffsDelta(winners, losers)
		return {
			feature: definition.name,
			description: definition.description,
			proxyRisk: definition.proxyRisk,
			primary: {
				winners: distribution(winners), losers: distribution(losers), effect,
				medianDifference: winners.length === 0 || losers.length === 0 ? null : distribution(winners).median! - distribution(losers).median!,
				clusterCi95: clusterBootstrap(primary, definition.name, BOOTSTRAP_SEED + index * 101),
				matchedRandomBaseline: randomBaseline(primary, definition.name, effect, BOOTSTRAP_SEED + index * 313),
				bhQ: null,
			},
			bySplit: ALLOWED_SPLITS.map((split) => {
				const rows = primary.filter((o) => o.split === split), w = values(rows, definition.name, 'winner'), l = values(rows, definition.name, 'loser')
				return { split, winners: distribution(w), losers: distribution(l), effect: cliffsDelta(w, l) }
			}),
			stability: [
				stability(primary, definition.name, effect, 'symbol', (o) => `${o.split}:${o.symbol}`),
				stability(primary, definition.name, effect, 'independent-series', (o) => `${o.split}:${o.series}`),
				stability(primary, definition.name, effect, 'timeframe', (o) => `${o.split}:${o.timeframe}`),
				stability(primary, definition.name, effect, 'side', (o) => `${o.split}:${o.side}`),
				stability(primary, definition.name, effect, 'temporal-fold', (o) => `${o.split}:${o.temporalFold}`),
			],
			lowTfSensitivity: {
				winners: distribution(values(lowTf, definition.name, 'winner')),
				losers: distribution(values(lowTf, definition.name, 'loser')),
				effect: cliffsDelta(values(lowTf, definition.name, 'winner'), values(lowTf, definition.name, 'loser')),
			},
			classification: 'no signal', reasons: [],
		}
	})
	bhAdjust(reports)
	for (const report of reports) classify(report)
	const candidates = reports.filter((x) => x.classification === 'robust candidate').sort((a, b) => Math.abs(b.primary.effect ?? 0) - Math.abs(a.primary.effect ?? 0)).slice(0, 3).map((x) => x.feature)
	const output = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		protocol: {
			manifest: 'ci-results/stateful-apex-s1-manifest.json', s2Results: 'ci-results/stateful-apex-s2-results.json',
			manifestConfigHash: manifest.configHash, stateMachineHash: manifest.codeHashes.stateMachine,
			allowedSplits: ALLOWED_SPLITS, oneWayCostBps: ONE_WAY_COST_BPS,
			stateMachineChanged: false, splitsChanged: false, labelsChanged: false, srcCoreChanged: false,
			vendorShapesUsedAsTargetOrFeature: false, causalRelativeVolume: null,
			primaryInference: `independent series with timeframe >= ${PRIMARY_MIN_TF_MINUTES} minutes`,
			lowTfPolicy: 'timeframes below 15m are excluded from primary inference and reported only as sensitivity',
			multipleComparisonControl: 'matched within-series×side×temporal-fold label permutation; Benjamini-Hochberg FDR 5%; conservative |Cliff delta| >= 0.147',
			clusterCi: `percentile bootstrap resampling independent series, ${BOOTSTRAP_RESAMPLES} resamples`,
			integrityErrors,
		},
		untouchedOosAudit: {
			revealCount: 0, filesRead: 0, rowsParsed: 0, eventsDetected: 0, labelsComputed: 0, featuresAnalyzed: 0,
			manifestSeriesExcludedBeforeIo: forbiddenSeries.length,
			assertion: 'Untouched-OOS series were filtered out before file hashing/read/parser/detection/labeling. Only their pre-existing manifest count was observed.',
		},
		dataAudit: {
			allowedFilesRead: filesRead, allowedRowsParsed: parsedRows, resolvedEvents, unresolvedOrInvalidEvents,
			primary: { observations: primary.length, winners: primary.filter((o) => o.outcome === 'winner').length, losers: primary.filter((o) => o.outcome === 'loser').length, series: new Set(primary.map((o) => o.series)).size },
			lowTfSensitivity: { observations: lowTf.length, winners: lowTf.filter((o) => o.outcome === 'winner').length, losers: lowTf.filter((o) => o.outcome === 'loser').length, series: new Set(lowTf.map((o) => o.series)).size },
		},
		featureReports: reports,
		candidatePolicy: 'At most three non-proxy features passing all predeclared conservative screens. This is a diagnostic shortlist, not a v2 rule or winner selection.',
		admissibleCandidates: candidates,
		v2RuleFormulatedOrTested: false,
		validationReusedForRuleTesting: false,
		verdict: candidates.length === 0 ? 'NO_ROBUST_CANDIDATE' : 'DIAGNOSTIC_CANDIDATES_ONLY',
	}
	writeFileSync(JSON_OUT, JSON.stringify(output, null, 2) + '\n')

	const classRows = (classification: Classification) => reports.filter((x) => x.classification === classification)
	const md = [
		'# Stateful Apex S3 — resolved winners vs losers diagnostic profile', '',
		'## Protocol / seal', '',
		`- Inputs: frozen S1 manifest + S2 results; allowed raw splits: **train, validation only**.`,
		`- Untouched-OOS audit: **reveal=0**, files read=0, rows parsed=0, labels=0, features=0; ${forbiddenSeries.length} manifest OOS series excluded before I/O.`,
		'- Vendor Shapes: parser validation only; BUY/SELL fields discarded before detection. Never target, feature, match criterion, or selection input.',
		'- State machine, splits, labels, costs (5 bps/side), and `src/core`: unchanged.',
		'- `causalRelativeVolume`: **null**; no lookback or denominator invented.',
		'- Primary inference: independent series at **>=15m**. Lower TFs appear only in the sensitivity appendix.',
		'- No classifier, grid, v2 rule, or validation/holdout retest was performed.', '',
		'## Sample', '',
		`- Allowed files read: ${filesRead}; resolved events: ${resolvedEvents}; unresolved/invalid: ${unresolvedOrInvalidEvents}.`,
		`- Primary >=15m: n=${primary.length} (${primary.filter((o) => o.outcome === 'winner').length} winners / ${primary.filter((o) => o.outcome === 'loser').length} losers), ${new Set(primary.map((o) => o.series)).size} series.`,
		`- Low-TF sensitivity: n=${lowTf.length}, ${new Set(lowTf.map((o) => o.series)).size} series.`, '',
		'## Primary feature profile', '',
		'Effect is Cliff’s delta (winner minus loser ordering). CI resamples independent series. `q` is BH-adjusted matched-permutation p.', '',
		'| feature | W med [q25,q75] | L med [q25,q75] | delta | CI95 | q | train / validation | class |',
		'|---|---:|---:|---:|---:|---:|---:|---|',
		...reports.map((r) => {
			const w = r.primary.winners, l = r.primary.losers, train = r.bySplit.find((x) => x.split === 'train')!, validation = r.bySplit.find((x) => x.split === 'validation')!
			return `| ${r.feature} | ${fmt(w.median)} [${fmt(w.q25)},${fmt(w.q75)}] | ${fmt(l.median)} [${fmt(l.q25)},${fmt(l.q75)}] | ${fmt(r.primary.effect)} | [${fmt(r.primary.clusterCi95.low)}, ${fmt(r.primary.clusterCi95.high)}] | ${fmt(r.primary.bhQ)} | ${fmt(train.effect)} / ${fmt(validation.effect)} | ${r.classification} |`
		}), '',
		'## Classification', '',
		...(['robust candidate', 'unstable correlation', 'leakage/proxy risk', 'no signal'] as const).flatMap((classification) => [
			`### ${classification}`, '',
			...(classRows(classification).length === 0 ? ['- None.'] : classRows(classification).map((r) => `- **${r.feature}**: ${r.reasons.join(' ')}`)), ''
		]),
		'## Admissible candidates for a future single-rule v2', '',
		...(candidates.length === 0 ? ['**None.** Conservative screening produced zero admissible candidates.'] : candidates.map((x) => `- ${x}`)),
		'', 'This list is diagnostic only. No rule, threshold, direction, or v2 implementation was formulated or tested.', '',
		'## Sign stability details', '',
		...reports.flatMap((r) => [
			`### ${r.feature}`, '',
			...r.stability.map((s) => `- ${s.dimension}: agreement=${fmt(s.agreementWithPooled)}, estimable=${s.estimable}, +/−/0=${s.positive}/${s.negative}/${s.zero}.`), ''
		]),
		'## Low-TF sensitivity appendix (excluded from inference)', '',
		'| feature | low-TF W median | low-TF L median | low-TF delta | primary delta |',
		'|---|---:|---:|---:|---:|',
		...reports.map((r) => `| ${r.feature} | ${fmt(r.lowTfSensitivity.winners.median)} | ${fmt(r.lowTfSensitivity.losers.median)} | ${fmt(r.lowTfSensitivity.effect)} | ${fmt(r.primary.effect)} |`), '',
		'## Interpretation boundary', '',
		'- Correlation at the already-frozen confirmation bar is not a trading rule.',
		'- Geometry features are explicitly flagged when they may proxy the same target/stop geometry used by labels.',
		'- Validation is used once here only to assess descriptive sign stability; it was not used to tune or retest a candidate.',
	]
	writeFileSync(MD_OUT, md.join('\n') + '\n')
	console.log(`Wrote ${JSON_OUT}`)
	console.log(`Wrote ${MD_OUT}`)
	console.log(`Untouched OOS reveal count: 0`)
	console.log(`Admissible candidates: ${candidates.length === 0 ? 'none' : candidates.join(', ')}`)
}

main()
