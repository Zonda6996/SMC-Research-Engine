import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseExactIndicatorCsv } from './lib/exactIndicatorExport.js'
import {
	detectStatefulApexEvents,
	type StatefulApexRow,
} from './lib/statefulApexEvents.js'

const MANIFEST_PATH = resolve('ci-results/stateful-apex-s1-manifest.json')
const S2_PATH = resolve('ci-results/stateful-apex-s2-results.json')
const S3_PROFILE_PATH = resolve('ci-results/stateful-apex-s3-profile.json')
const RUNNER_PATH = 'ci/research/runStatefulApexS3V2Freeze.ts'
const JSON_OUT = resolve('ci-results/stateful-apex-s3-v2-freeze.json')
const MD_OUT = resolve('ci-results/stateful-apex-s3-v2-freeze.md')
const PRIMARY_MIN_TF_MINUTES = 15
const ONE_WAY_COST_BPS = 5
const SPLIT_SALT = 'apex-state-s3-v2-internal-holdout'
const SPLIT_MODULUS = 4
const HOLDOUT_REMAINDER = 1
const FEATURE = 'newAdverseExtremes'
const QUANTILE = 0.5

type OriginalSplit = 'train' | 'validation' | 'untouched-oos'
type V2Split = 'development' | 'internal-holdout' | 'untouched-oos-s1'

interface ManifestSeries {
	file: string
	symbol: string
	timeframe: string
	market: 'spot' | 'futures'
	split: OriginalSplit
	rows: number
	eligibleRows: number
	firstUtc: string
	lastUtc: string
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
}
interface S3Profile {
	protocol: { manifestConfigHash: string; stateMachineHash: string; oneWayCostBps: number; vendorShapesUsedAsTargetOrFeature: boolean; integrityErrors: string[] }
	untouchedOosAudit: { revealCount: number; filesRead: number; labelsComputed: number }
	featureReports: Array<{ feature: string; proxyRisk: string | null; classification: string }>
}

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
function splitRemainder(symbol: string): number {
	const digest = createHash('sha256').update(`${SPLIT_SALT}:${symbol}`).digest()
	let remainder = 0
	for (const byte of digest) remainder = (remainder * 256 + byte) % SPLIT_MODULUS
	return remainder
}
function assignment(series: ManifestSeries): V2Split {
	if (series.split === 'untouched-oos') return 'untouched-oos-s1'
	return splitRemainder(series.symbol) === HOLDOUT_REMAINDER ? 'internal-holdout' : 'development'
}
function quantile(sorted: readonly number[], p: number): number {
	if (sorted.length === 0) throw new Error('Cannot freeze a threshold from an empty development sample.')
	const position = (sorted.length - 1) * p
	const lower = Math.floor(position), upper = Math.ceil(position)
	return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower)
}
function countSummary(series: readonly ManifestSeries[]): { symbols: number; series: number; rows: number; eligibleRows: number; events: number } {
	return {
		symbols: new Set(series.map((item) => item.symbol)).size,
		series: series.length,
		rows: series.reduce((sum, item) => sum + item.rows, 0),
		eligibleRows: series.reduce((sum, item) => sum + item.eligibleRows, 0),
		events: series.reduce((sum, item) => sum + item.primaryEvents, 0),
	}
}

function main(): void {
	const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FrozenManifest
	const s2 = JSON.parse(readFileSync(S2_PATH, 'utf8')) as S2Results
	const profile = JSON.parse(readFileSync(S3_PROFILE_PATH, 'utf8')) as S3Profile
	const integrityErrors: string[] = []
	if (manifest.config.protocolVersion !== 'apex-state-v1') integrityErrors.push('protocol version mismatch')
	if (manifest.config.oneWayCostBps !== ONE_WAY_COST_BPS || s2.protocol.oneWayCostBps !== ONE_WAY_COST_BPS || profile.protocol.oneWayCostBps !== ONE_WAY_COST_BPS) integrityErrors.push('cost mismatch')
	if (manifest.config.vendorShapesInFeaturesOrTargets !== false || s2.protocol.vendorShapesUsed !== false || profile.protocol.vendorShapesUsedAsTargetOrFeature !== false) integrityErrors.push('Vendor Shapes prohibition mismatch')
	if (s2.protocol.manifestConfigHash !== manifest.configHash || profile.protocol.manifestConfigHash !== manifest.configHash) integrityErrors.push('manifest config hash mismatch')
	if (s2.protocol.stateMachineHash !== manifest.codeHashes.stateMachine || profile.protocol.stateMachineHash !== manifest.codeHashes.stateMachine) integrityErrors.push('state-machine hash mismatch')
	if (sha256File('ci/research/lib/statefulApexEvents.ts') !== manifest.codeHashes.stateMachine) integrityErrors.push('state-machine file changed')
	if (sha256File('ci/research/runStatefulApexS1.ts') !== manifest.codeHashes.runner) integrityErrors.push('S1 runner changed')
	if (sha256File('tests/statefulApexEvents.test.ts') !== manifest.codeHashes.tests) integrityErrors.push('state-machine tests changed')
	if (manifest.oOSSeal.status !== 'untouched' || manifest.oOSSeal.outcomesComputed || manifest.oOSSeal.metricsPublished) integrityErrors.push('S1 untouched OOS seal mismatch')
	if (s2.oosRevealCount !== 0 || s2.untouchedOos !== null || profile.untouchedOosAudit.revealCount !== 0 || profile.untouchedOosAudit.filesRead !== 0 || profile.untouchedOosAudit.labelsComputed !== 0) integrityErrors.push('S1 untouched OOS was revealed')
	if (s2.protocol.integrityErrors.length !== 0 || profile.protocol.integrityErrors.length !== 0) integrityErrors.push('upstream integrity errors')
	const candidate = profile.featureReports.find((item) => item.feature === FEATURE)
	if (candidate?.classification !== 'robust candidate' || candidate.proxyRisk !== null) integrityErrors.push('frozen feature is not a robust non-proxy candidate')

	const primarySeries = manifest.series.filter((series) => timeframeMinutes(series.timeframe) >= PRIMARY_MIN_TF_MINUTES)
	const developmentSeries = primarySeries.filter((series) => assignment(series) === 'development')
	const holdoutSeries = primarySeries.filter((series) => assignment(series) === 'internal-holdout')
	const untouchedSeries = primarySeries.filter((series) => assignment(series) === 'untouched-oos-s1')
	if (new Set(holdoutSeries.map((series) => series.symbol)).size < 2 || holdoutSeries.length < 2) integrityErrors.push('internal holdout lacks cluster breadth')
	if (integrityErrors.length > 0) throw new Error(`Freeze integrity failure:\n${integrityErrors.join('\n')}`)

	// Phase 1 (threshold freeze): only development paths may be opened. Holdout and S1 OOS paths
	// are excluded before hashing, readFileSync, parsing, detection, feature extraction, or labeling.
	const developmentValues: number[] = []
	let developmentFilesRead = 0
	let developmentRowsParsed = 0
	let developmentDetectedEvents = 0
	for (const series of developmentSeries) {
		if (sha256File(series.file) !== series.sha256) throw new Error(`Development data hash mismatch: ${series.file}`)
		const parsed = parseExactIndicatorCsv(readFileSync(resolve(series.file), 'utf8'), { allowIrregularBars: true, allowInvalidBandOrder: true })
		developmentFilesRead++
		developmentRowsParsed += parsed.length
		const rows: StatefulApexRow[] = parsed.map(({ buy: _buy, sell: _sell, ...row }) => row).slice(manifest.config.warmupBars)
		const detected = detectStatefulApexEvents(rows)
		if (parsed.length !== series.rows || rows.length !== series.eligibleRows || detected.events.length !== series.primaryEvents) throw new Error(`Development count mismatch: ${series.file}`)
		developmentDetectedEvents += detected.events.length
		for (const event of detected.events) developmentValues.push(event.features.newAdverseExtremes)
	}
	developmentValues.sort((a, b) => a - b)
	const threshold = quantile(developmentValues, QUANTILE)
	const developmentSelectedEvents = developmentValues.filter((value) => value <= threshold).length

	// Phase 2 (seal inventory): counts and hashes come only from the pre-existing S1 manifest.
	// No internal-holdout or untouched-OOS raw file is opened; no labels or outcomes are computed.
	const splitAssignments = primarySeries.map((series) => ({
		file: series.file,
		symbol: series.symbol,
		timeframe: series.timeframe,
		market: series.market,
		originalSplit: series.split,
		v2Split: assignment(series),
		rows: series.rows,
		eligibleRows: series.eligibleRows,
		events: series.primaryEvents,
		dataSha256: series.sha256,
	})).sort((a, b) => a.file.localeCompare(b.file))
	const splitAssignmentHash = sha256Text(JSON.stringify(splitAssignments))
	const config = {
		protocolVersion: 'apex-state-s3-v2-freeze',
		primaryMinTimeframeMinutes: PRIMARY_MIN_TF_MINUTES,
		oneWayCostBps: ONE_WAY_COST_BPS,
		split: {
			unit: 'whole symbol',
			formula: `sha256("${SPLIT_SALT}:" + symbol) mod ${SPLIT_MODULUS}`,
			internalHoldoutRemainder: HOLDOUT_REMAINDER,
			eligibleOriginalSplits: ['train', 'validation'],
			untouchedOosS1Policy: 'excluded before all raw I/O and remains sealed',
		},
		rule: {
			name: 'extension-exhaustion-v2',
			economicMeaning: 'Admit a frozen v1 reversal confirmation only after the adverse expansion has produced no more than the typical development-sample count of renewed extremes; fewer renewed pushes represent expansion exhaustion.',
			formula: `admit = (newAdverseExtremes <= ${threshold})`,
			feature: FEATURE,
			operator: '<=',
			threshold,
			degreesOfFreedom: 1,
			proxyRiskFeaturesMixed: false,
		},
		thresholdSource: {
			split: 'development',
			statistic: 'linear-interpolated empirical median (q=0.5) of newAdverseExtremes across all detected primary events',
			labelFree: true,
			pnlGridSearched: false,
			holdoutRawFilesReadBeforeOrDuringThreshold: 0,
			untouchedOosRawFilesRead: 0,
		},
		vendorShapesForbidden: true,
		stateMachineChanged: false,
		labelsChanged: false,
		costsChanged: false,
		srcCoreChanged: false,
	}
	const output = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		status: 'FROZEN_NOT_EVALUATED',
		config,
		configHash: sha256Text(JSON.stringify(config)),
		inputs: {
			manifest: 'ci-results/stateful-apex-s1-manifest.json',
			s2Results: 'ci-results/stateful-apex-s2-results.json',
			s3Profile: 'ci-results/stateful-apex-s3-profile.json',
			hashes: {
				manifest: sha256File('ci-results/stateful-apex-s1-manifest.json'),
				s2Results: sha256File('ci-results/stateful-apex-s2-results.json'),
				s3ProfileJson: sha256File('ci-results/stateful-apex-s3-profile.json'),
				s3ProfileMarkdown: sha256File('ci-results/stateful-apex-s3-profile.md'),
			},
		},
		codeHashes: {
			stateMachine: manifest.codeHashes.stateMachine,
			s1Runner: manifest.codeHashes.runner,
			s1Tests: manifest.codeHashes.tests,
			s2Runner: sha256File('ci/research/runStatefulApexS2.ts'),
			s3ProfileRunner: sha256File('ci/research/runStatefulApexS3Profile.ts'),
			freezeRunner: sha256File(RUNNER_PATH),
		},
		splitAssignmentHash,
		splitAssignments,
		counts: {
			development: { ...countSummary(developmentSeries), filesRead: developmentFilesRead, rowsParsed: developmentRowsParsed, detectedEvents: developmentDetectedEvents, featureValues: developmentValues.length, ruleAdmittedEvents: developmentSelectedEvents },
			internalHoldout: { ...countSummary(holdoutSeries), rawFilesRead: 0, rowsParsed: 0, labelsComputed: 0, outcomesComputed: 0, metricsComputed: 0 },
			untouchedOosS1: { ...countSummary(untouchedSeries), rawFilesRead: 0, rowsParsed: 0, labelsComputed: 0, outcomesComputed: 0, metricsComputed: 0, revealCount: 0 },
		},
		seal: {
			internalHoldout: 'SEALED',
			internalHoldoutSymbols: [...new Set(holdoutSeries.map((series) => series.symbol))].sort(),
			holdoutLabelsOutcomesPerformancePresent: false,
			untouchedOosS1: 'SEALED',
			untouchedOosS1RevealCount: 0,
		},
		futureEvaluation: {
			baseline: 'Unfiltered v1 on the identical internal-holdout events, labels, costs, and cluster inference.',
			successCriteria: [
				'v2 holdout net meanR > 0',
				'v2 holdout cluster-bootstrap CI95 low > 0',
				'at least 60% of holdout symbols have positive v2 net meanR',
				'at least 2 holdout series have positive v2 net meanR',
				'v2 improves net meanR versus the unfiltered v1 baseline on the identical holdout',
			],
			decision: 'SUCCESS only if every criterion passes; otherwise KILL.',
			holdoutEvaluationPerformed: false,
		},
		integrityErrors,
	}
	writeFileSync(JSON_OUT, JSON.stringify(output, null, 2) + '\n')

	const md = [
		'# Stateful Apex Track S3 v2 — frozen protocol (not evaluated)',
		'',
		'- Status: **FROZEN_NOT_EVALUATED**.',
		'- Exactly one rule; one feature; one threshold; no PnL grid.',
		'- Vendor Shapes forbidden. State machine, labels, costs (5 bps/side), and `src/core` unchanged.',
		'- Original S1 untouched OOS remains sealed with reveal count **0**.',
		'',
		'## Frozen rule: extension exhaustion',
		'',
		`\`admit = (newAdverseExtremes <= ${threshold})\``,
		'',
		'`newAdverseExtremes` is the causal count of renewed adverse price extremes between the first inner-band extension and the already-frozen reversal confirmation. A small count means the expansion stopped renewing itself: economic exhaustion of expansion. No proxy-risk geometry or trigger-progress feature is mixed in.',
		'',
		'## Threshold source',
		'',
		`The threshold is the deterministic empirical median (q=0.5, linear interpolation) over all ${developmentValues.length} development events: **${threshold}**.`,
		'',
		`Development-only input: ${developmentFilesRead} files / ${developmentRowsParsed} rows / ${developmentDetectedEvents} events. Rule-admitted development count: ${developmentSelectedEvents}. Labels, outcomes, and PnL were not inputs to the cut; no threshold grid was searched.`,
		'',
		'## New internal holdout',
		'',
		`Whole-symbol assignment: \`sha256("${SPLIT_SALT}:" + symbol) mod ${SPLIT_MODULUS} == ${HOLDOUT_REMAINDER}\`.`,
		'',
		`Sealed symbols: **${[...new Set(holdoutSeries.map((series) => series.symbol))].sort().join(', ')}**. Manifest-only inventory: ${holdoutSeries.length} series / ${holdoutSeries.reduce((sum, item) => sum + item.rows, 0)} rows / ${holdoutSeries.reduce((sum, item) => sum + item.primaryEvents, 0)} events. Raw files read: **0**; labels/outcomes/metrics computed: **0**.`,
		'',
		`Split assignment SHA-256: \`${splitAssignmentHash}\`. Exact assignments and data hashes are in the JSON manifest.`,
		'',
		'## Preregistered next-stage decision',
		'',
		'SUCCESS requires all of:',
		'1. holdout v2 net meanR > 0;',
		'2. holdout v2 cluster-bootstrap CI95 low > 0;',
		'3. >=60% positive holdout symbols;',
		'4. >=2 positive holdout series;',
		'5. v2 net meanR improves versus unfiltered v1 on the identical holdout.',
		'',
		'Otherwise **KILL**. No holdout evaluation was performed in this stage.',
		'',
		'## Hashes / seals',
		'',
		`- Config SHA-256: \`${output.configHash}\``,
		`- State machine SHA-256: \`${manifest.codeHashes.stateMachine}\``,
		`- Freeze runner SHA-256: \`${output.codeHashes.freezeRunner}\``,
		`- Internal holdout: **SEALED**; S1 untouched OOS: **SEALED, reveal=0**.`,
	]
	writeFileSync(MD_OUT, md.join('\n') + '\n')
	console.log(`Wrote ${JSON_OUT}`)
	console.log(`Wrote ${MD_OUT}`)
	console.log(`Frozen ${config.rule.formula}; holdout raw reads=0; S1 OOS reveal=0`)
}

main()
