import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseExactIndicatorCsv } from './lib/exactIndicatorExport.js'
import {
	detectStatefulApexEvents,
	labelStatefulApexEvent,
	type ApexEventSide,
	type ApexOutcomeLabel,
	type StatefulApexRow,
} from './lib/statefulApexEvents.js'

const FREEZE_JSON_PATH = resolve('ci-results/stateful-apex-s3-v2-freeze.json')
const FREEZE_MD_PATH = resolve('ci-results/stateful-apex-s3-v2-freeze.md')
const JSON_OUT = resolve('ci-results/stateful-apex-s3-v2-holdout.json')
const MD_OUT = resolve('ci-results/stateful-apex-s3-v2-holdout.md')
const ONE_WAY_COST_BPS = 5
const THRESHOLD = 1
const BOOTSTRAP_SEED = 20260820
const BOOTSTRAP_RESAMPLES = 10_000
const EXPECTED_CONFIG_HASH = '92ff4fe9de8299039de493a03f947efd096024c85b60031a7933cf91696aca98'
const EXPECTED_ASSIGNMENT_HASH = 'aa169cbccd97cfb8754eb25773b0058ff65cfc9bda81b2e6520131ecfd542a6a'
const EXPECTED_SYMBOLS = ['ONDOUSDT', 'VIRTUALUSDT'] as const

interface SplitAssignment {
	file: string
	symbol: string
	timeframe: string
	market: 'spot' | 'futures'
	originalSplit: 'train' | 'validation' | 'untouched-oos'
	v2Split: 'development' | 'internal-holdout' | 'untouched-oos-s1'
	rows: number
	eligibleRows: number
	events: number
	dataSha256: string
}
interface FreezeManifest {
	status: string
	config: {
		oneWayCostBps: number
		rule: { formula: string; feature: string; operator: string; threshold: number; degreesOfFreedom: number }
		vendorShapesForbidden: boolean
		stateMachineChanged: boolean
		labelsChanged: boolean
		costsChanged: boolean
		srcCoreChanged: boolean
	}
	configHash: string
	inputs: { hashes: { manifest: string; s2Results: string; s3ProfileJson: string; s3ProfileMarkdown: string } }
	codeHashes: { stateMachine: string; s1Runner: string; s1Tests: string; s2Runner: string; s3ProfileRunner: string; freezeRunner: string }
	splitAssignmentHash: string
	splitAssignments: SplitAssignment[]
	counts: { internalHoldout: { series: number; events: number; rawFilesRead: number; labelsComputed: number }; untouchedOosS1: { rawFilesRead: number; rowsParsed: number; labelsComputed: number; outcomesComputed: number; metricsComputed: number; revealCount: number } }
	seal: { internalHoldout: string; internalHoldoutSymbols: string[]; holdoutLabelsOutcomesPerformancePresent: boolean; untouchedOosS1: string; untouchedOosS1RevealCount: number }
	futureEvaluation: { holdoutEvaluationPerformed: boolean; decision: string }
	integrityErrors: string[]
}
interface EconomicEvent {
	id: string
	symbol: string
	series: string
	timestamp: number
	month: string
	side: ApexEventSide
	admitted: boolean
	label: ApexOutcomeLabel | null
}
interface Metrics {
	detectedN: number
	admittedN: number
	validLabelN: number
	resolvedN: number
	censoredN: number
	netMeanR5bps: number | null
	profitFactor: number | null
	winRate: number | null
	maxDrawdownR: number
}

function sha256File(path: string): string {
	return createHash('sha256').update(readFileSync(resolve(path))).digest('hex')
}
function sha256Text(text: string): string {
	return createHash('sha256').update(text).digest('hex')
}
function mean(values: readonly number[]): number | null {
	return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length
}
function values(events: readonly EconomicEvent[]): number[] {
	return events.flatMap((event) => event.label?.netR5bps == null ? [] : [event.label.netR5bps])
}
function metrics(events: readonly EconomicEvent[], detectedN: number): Metrics {
	const valid = events.filter((event) => event.label != null)
	const resolved = events.filter((event) => event.label?.netR5bps != null)
	const net = values(events)
	const grossProfit = net.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
	const grossLoss = -net.filter((value) => value < 0).reduce((sum, value) => sum + value, 0)
	let equity = 0
	let peak = 0
	let maxDrawdownR = 0
	for (const event of [...resolved].sort((a, b) => a.timestamp - b.timestamp || a.series.localeCompare(b.series) || a.id.localeCompare(b.id))) {
		equity += event.label!.netR5bps!
		peak = Math.max(peak, equity)
		maxDrawdownR = Math.max(maxDrawdownR, peak - equity)
	}
	return {
		detectedN,
		admittedN: events.length,
		validLabelN: valid.length,
		resolvedN: resolved.length,
		censoredN: valid.length - resolved.length,
		netMeanR5bps: mean(net),
		profitFactor: grossLoss === 0 ? (grossProfit > 0 ? null : 0) : grossProfit / grossLoss,
		winRate: net.length === 0 ? null : net.filter((value) => value > 0).length / net.length,
		maxDrawdownR,
	}
}
function mulberry32(seed: number): () => number {
	let a = seed >>> 0
	return () => {
		a |= 0
		a = a + 0x6D2B79F5 | 0
		let t = Math.imul(a ^ a >>> 15, 1 | a)
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
		return ((t ^ t >>> 14) >>> 0) / 4_294_967_296
	}
}
function percentile(sorted: readonly number[], p: number): number | null {
	if (sorted.length === 0) return null
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))]!
}
function clustered(events: readonly EconomicEvent[]): Map<string, Map<string, EconomicEvent[]>> {
	const output = new Map<string, Map<string, EconomicEvent[]>>()
	for (const event of events) {
		let months = output.get(event.symbol)
		if (months == null) { months = new Map(); output.set(event.symbol, months) }
		const cluster = `${event.symbol}:${event.month}`
		const bucket = months.get(cluster) ?? []
		bucket.push(event)
		months.set(cluster, bucket)
	}
	return output
}
function bootstrap(v1: readonly EconomicEvent[]): { v1: { low: number | null; high: number | null }; v2: { low: number | null; high: number | null }; pairedDelta: { low: number | null; high: number | null } } {
	const bySymbol = clustered(v1.filter((event) => event.label?.netR5bps != null))
	const symbols = [...bySymbol.keys()].sort()
	const rng = mulberry32(BOOTSTRAP_SEED)
	const v1Estimates: number[] = []
	const v2Estimates: number[] = []
	const deltaEstimates: number[] = []
	for (let b = 0; b < BOOTSTRAP_RESAMPLES; b++) {
		const sample: EconomicEvent[] = []
		for (let si = 0; si < symbols.length; si++) {
			const symbol = symbols[Math.floor(rng() * symbols.length)]!
			const clusters = [...bySymbol.get(symbol)!.values()]
			for (let ci = 0; ci < clusters.length; ci++) sample.push(...clusters[Math.floor(rng() * clusters.length)]!)
		}
		const v1Mean = mean(values(sample))
		const v2Mean = mean(values(sample.filter((event) => event.admitted)))
		if (v1Mean != null) v1Estimates.push(v1Mean)
		if (v2Mean != null) v2Estimates.push(v2Mean)
		if (v1Mean != null && v2Mean != null) deltaEstimates.push(v2Mean - v1Mean)
	}
	v1Estimates.sort((a, b) => a - b)
	v2Estimates.sort((a, b) => a - b)
	deltaEstimates.sort((a, b) => a - b)
	const ci = (estimates: readonly number[]) => ({ low: percentile(estimates, 0.025), high: percentile(estimates, 0.975) })
	return { v1: ci(v1Estimates), v2: ci(v2Estimates), pairedDelta: ci(deltaEstimates) }
}
function fmt(value: number | null, digits = 4): string {
	return value == null ? 'n/a' : value.toFixed(digits)
}

function main(): void {
	const freezeBytes = readFileSync(FREEZE_JSON_PATH, 'utf8')
	const freezeMd = readFileSync(FREEZE_MD_PATH, 'utf8')
	const freeze = JSON.parse(freezeBytes) as FreezeManifest
	const integrityErrors: string[] = []
	if (freeze.status !== 'FROZEN_NOT_EVALUATED') integrityErrors.push('freeze status is not FROZEN_NOT_EVALUATED')
	if (sha256Text(JSON.stringify(freeze.config)) !== freeze.configHash || freeze.configHash !== EXPECTED_CONFIG_HASH) integrityErrors.push('frozen config hash mismatch')
	if (sha256Text(JSON.stringify(freeze.splitAssignments)) !== freeze.splitAssignmentHash || freeze.splitAssignmentHash !== EXPECTED_ASSIGNMENT_HASH) integrityErrors.push('split assignment hash mismatch')
	if (freeze.config.rule.formula !== 'admit = (newAdverseExtremes <= 1)' || freeze.config.rule.feature !== 'newAdverseExtremes' || freeze.config.rule.operator !== '<=' || freeze.config.rule.threshold !== THRESHOLD || freeze.config.rule.degreesOfFreedom !== 1) integrityErrors.push('frozen rule mismatch')
	if (freeze.config.oneWayCostBps !== ONE_WAY_COST_BPS || !freeze.config.vendorShapesForbidden || freeze.config.stateMachineChanged || freeze.config.labelsChanged || freeze.config.costsChanged || freeze.config.srcCoreChanged) integrityErrors.push('frozen protocol mutation detected')
	if (!freezeMd.includes('Status: **FROZEN_NOT_EVALUATED**') || !freezeMd.includes('`admit = (newAdverseExtremes <= 1)`') || !freezeMd.includes('reveal count **0**')) integrityErrors.push('freeze markdown does not match frozen protocol')
	const expectedFileHashes: Array<[string, string]> = [
		['ci-results/stateful-apex-s1-manifest.json', freeze.inputs.hashes.manifest],
		['ci-results/stateful-apex-s2-results.json', freeze.inputs.hashes.s2Results],
		['ci-results/stateful-apex-s3-profile.json', freeze.inputs.hashes.s3ProfileJson],
		['ci-results/stateful-apex-s3-profile.md', freeze.inputs.hashes.s3ProfileMarkdown],
		['ci/research/lib/statefulApexEvents.ts', freeze.codeHashes.stateMachine],
		['ci/research/runStatefulApexS1.ts', freeze.codeHashes.s1Runner],
		['tests/statefulApexEvents.test.ts', freeze.codeHashes.s1Tests],
		['ci/research/runStatefulApexS2.ts', freeze.codeHashes.s2Runner],
		['ci/research/runStatefulApexS3Profile.ts', freeze.codeHashes.s3ProfileRunner],
		['ci/research/runStatefulApexS3V2Freeze.ts', freeze.codeHashes.freezeRunner],
	]
	for (const [path, expected] of expectedFileHashes) if (sha256File(path) !== expected) integrityErrors.push(`hash mismatch: ${path}`)
	if (freeze.integrityErrors.length !== 0) integrityErrors.push('freeze contains integrity errors')
	if (freeze.seal.internalHoldout !== 'SEALED' || freeze.seal.holdoutLabelsOutcomesPerformancePresent || freeze.futureEvaluation.holdoutEvaluationPerformed) integrityErrors.push('internal holdout was already revealed')
	if (freeze.counts.internalHoldout.rawFilesRead !== 0 || freeze.counts.internalHoldout.labelsComputed !== 0) integrityErrors.push('freeze reports prior internal holdout access')
	if (freeze.seal.untouchedOosS1 !== 'SEALED' || freeze.seal.untouchedOosS1RevealCount !== 0 || freeze.counts.untouchedOosS1.revealCount !== 0 || freeze.counts.untouchedOosS1.rawFilesRead !== 0 || freeze.counts.untouchedOosS1.rowsParsed !== 0 || freeze.counts.untouchedOosS1.labelsComputed !== 0 || freeze.counts.untouchedOosS1.outcomesComputed !== 0 || freeze.counts.untouchedOosS1.metricsComputed !== 0) integrityErrors.push('S1 untouched OOS seal mismatch')
	const holdout = freeze.splitAssignments.filter((item) => item.v2Split === 'internal-holdout')
	const symbols = [...new Set(holdout.map((item) => item.symbol))].sort()
	if (holdout.length !== 2 || JSON.stringify(symbols) !== JSON.stringify([...EXPECTED_SYMBOLS]) || JSON.stringify(freeze.seal.internalHoldoutSymbols) !== JSON.stringify([...EXPECTED_SYMBOLS])) integrityErrors.push('internal holdout assignment mismatch')
	if (integrityErrors.length > 0) throw new Error(`Pre-reveal integrity failure:\n${integrityErrors.join('\n')}`)

	// Sole reveal: only the two frozen internal-holdout paths are opened. S1 untouched-OOS
	// paths are never hashed, opened, parsed, detected, or labeled by this runner.
	const allEvents: EconomicEvent[] = []
	let filesRead = 0
	let rowsParsed = 0
	for (const series of holdout) {
		if (sha256File(series.file) !== series.dataSha256) throw new Error(`Holdout data hash mismatch: ${series.file}`)
		const parsed = parseExactIndicatorCsv(readFileSync(resolve(series.file), 'utf8'), { allowIrregularBars: true, allowInvalidBandOrder: true })
		filesRead++
		rowsParsed += parsed.length
		// Vendor BUY/SELL Shapes are removed immediately after parsing, before detection.
		const rows: StatefulApexRow[] = parsed.map(({ buy: _buy, sell: _sell, ...row }) => row).slice(parsed.length - series.eligibleRows)
		const detected = detectStatefulApexEvents(rows)
		if (parsed.length !== series.rows || rows.length !== series.eligibleRows || detected.events.length !== series.events) throw new Error(`Frozen holdout count mismatch: ${series.file}`)
		for (const event of detected.events) allEvents.push({
			id: `${series.file}:${event.id}`,
			symbol: series.symbol,
			series: series.file,
			timestamp: event.confirmationTimestamp,
			month: new Date(event.confirmationTimestamp).toISOString().slice(0, 7),
			side: event.side,
			admitted: event.features.newAdverseExtremes <= THRESHOLD,
			label: labelStatefulApexEvent(rows, event, ONE_WAY_COST_BPS),
		})
	}
	const v1Events = allEvents
	const v2Events = allEvents.filter((event) => event.admitted)
	const v1Metrics = metrics(v1Events, allEvents.length)
	const v2Metrics = metrics(v2Events, allEvents.length)
	const confidence = bootstrap(v1Events)
	const bySymbol = symbols.map((symbol) => ({ symbol, v1: metrics(v1Events.filter((event) => event.symbol === symbol), v1Events.filter((event) => event.symbol === symbol).length), v2: metrics(v2Events.filter((event) => event.symbol === symbol), v1Events.filter((event) => event.symbol === symbol).length) }))
	const seriesNames = [...new Set(allEvents.map((event) => event.series))].sort()
	const bySeries = seriesNames.map((series) => ({ series, symbol: allEvents.find((event) => event.series === series)!.symbol, v1: metrics(v1Events.filter((event) => event.series === series), v1Events.filter((event) => event.series === series).length), v2: metrics(v2Events.filter((event) => event.series === series), v1Events.filter((event) => event.series === series).length) }))
	const positiveSymbols = bySymbol.filter((item) => item.v2.netMeanR5bps != null && item.v2.netMeanR5bps > 0).length
	const positiveSeries = bySeries.filter((item) => item.v2.netMeanR5bps != null && item.v2.netMeanR5bps > 0).length
	const positiveSymbolFraction = positiveSymbols / bySymbol.length
	const pairedDeltaMeanR = v2Metrics.netMeanR5bps == null || v1Metrics.netMeanR5bps == null ? null : v2Metrics.netMeanR5bps - v1Metrics.netMeanR5bps
	const successGate = {
		v2MeanRPositive: v2Metrics.netMeanR5bps != null && v2Metrics.netMeanR5bps > 0,
		v2CiLowPositive: confidence.v2.low != null && confidence.v2.low > 0,
		positiveSymbolsAtLeast60Pct: positiveSymbolFraction >= 0.60,
		atLeastTwoPositiveSeries: positiveSeries >= 2,
		improvementOverUnfilteredV1: pairedDeltaMeanR != null && pairedDeltaMeanR > 0,
	}
	const verdict = Object.values(successGate).every(Boolean) ? 'PASS' : 'KILL'
	const output = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		status: 'INTERNAL_HOLDOUT_EVALUATED',
		verdict,
		protocol: {
			freezeJson: 'ci-results/stateful-apex-s3-v2-freeze.json',
			freezeJsonSha256: sha256Text(freezeBytes),
			freezeMarkdown: 'ci-results/stateful-apex-s3-v2-freeze.md',
			freezeMarkdownSha256: sha256Text(freezeMd),
			configHash: freeze.configHash,
			splitAssignmentHash: freeze.splitAssignmentHash,
			rule: freeze.config.rule.formula,
			oneWayCostBps: ONE_WAY_COST_BPS,
			bootstrap: { method: 'paired hierarchical percentile cluster bootstrap: outer symbol, inner symbol×calendar-month', seed: BOOTSTRAP_SEED, resamples: BOOTSTRAP_RESAMPLES },
			vendorShapesRemovedBeforeDetection: true,
			retunedAfterReveal: false,
			additionalThresholdsOrSubgroupsAfterReveal: false,
			integrityErrors,
		},
		revealAudit: {
			internalHoldoutRevealCount: 1,
			internalHoldoutSymbols: symbols,
			internalHoldoutSeries: holdout.map((item) => item.file),
			filesRead,
			rowsParsed,
			untouchedOosS1RevealCount: 0,
			untouchedOosS1RawFilesRead: 0,
			untouchedOosS1RowsParsed: 0,
			untouchedOosS1LabelsComputed: 0,
		},
		v1Unfiltered: { metrics: v1Metrics, ci95: confidence.v1 },
		v2FrozenRule: { metrics: v2Metrics, ci95: confidence.v2 },
		pairedDeltaMeanR: { estimate: pairedDeltaMeanR, ci95: confidence.pairedDelta },
		breadth: { positiveSymbols, symbols: bySymbol.length, positiveSymbolFraction, positiveSeries, series: bySeries.length },
		bySymbol,
		bySeries,
		successGate,
	}
	writeFileSync(JSON_OUT, JSON.stringify(output, null, 2) + '\n')
	const md = [
		'# Stateful Apex Track S3 v2 — internal holdout reveal',
		'',
		`- Verdict: **${verdict}**`,
		'- Integrity: **PASS** (frozen config, assignment, code, and upstream artifact hashes verified before reveal).',
		'- Internal holdout reveal count: **1**.',
		'- S1 untouched OOS reveal count: **0** (no raw file read, parse, detection, or label).',
		'- Vendor Shapes: discarded before detection and unused.',
		'- Frozen rule: `admit = (newAdverseExtremes <= 1)`; no post-reveal threshold or subgroup.',
		'',
		'## Holdout metrics (5 bps/side)',
		'',
		'| arm | detected N | admitted N | resolved N | meanR | CI95 | PF | WR | maxDD R |',
		'|---|---:|---:|---:|---:|---|---:|---:|---:|',
		`| unfiltered v1 | ${v1Metrics.detectedN} | ${v1Metrics.admittedN} | ${v1Metrics.resolvedN} | ${fmt(v1Metrics.netMeanR5bps)} | [${fmt(confidence.v1.low)}, ${fmt(confidence.v1.high)}] | ${fmt(v1Metrics.profitFactor)} | ${fmt(v1Metrics.winRate)} | ${fmt(v1Metrics.maxDrawdownR)} |`,
		`| frozen v2 | ${v2Metrics.detectedN} | ${v2Metrics.admittedN} | ${v2Metrics.resolvedN} | ${fmt(v2Metrics.netMeanR5bps)} | [${fmt(confidence.v2.low)}, ${fmt(confidence.v2.high)}] | ${fmt(v2Metrics.profitFactor)} | ${fmt(v2Metrics.winRate)} | ${fmt(v2Metrics.maxDrawdownR)} |`,
		'',
		`Paired delta meanR (v2-v1): **${fmt(pairedDeltaMeanR)}**, CI95 [${fmt(confidence.pairedDelta.low)}, ${fmt(confidence.pairedDelta.high)}].`,
		'',
		`Breadth: ${positiveSymbols}/${bySymbol.length} positive symbols (${(positiveSymbolFraction * 100).toFixed(1)}%); ${positiveSeries}/${bySeries.length} positive series.`,
		'',
		'## Frozen success gate',
		'',
		`- v2 meanR > 0: **${successGate.v2MeanRPositive ? 'PASS' : 'FAIL'}**`,
		`- v2 CI95 low > 0: **${successGate.v2CiLowPositive ? 'PASS' : 'FAIL'}**`,
		`- >=60% positive symbols: **${successGate.positiveSymbolsAtLeast60Pct ? 'PASS' : 'FAIL'}**`,
		`- >=2 positive series: **${successGate.atLeastTwoPositiveSeries ? 'PASS' : 'FAIL'}**`,
		`- improvement over unfiltered v1: **${successGate.improvementOverUnfilteredV1 ? 'PASS' : 'FAIL'}**`,
		'',
		`Final frozen decision: **${verdict}**.`,
	]
	writeFileSync(MD_OUT, md.join('\n') + '\n')
	console.log(`Integrity PASS; internal reveal=1; S1 OOS reveal=0; verdict=${verdict}`)
	console.log(`Wrote ${JSON_OUT}`)
	console.log(`Wrote ${MD_OUT}`)
}

main()
