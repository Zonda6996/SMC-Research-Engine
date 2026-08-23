import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DIAGNOSTIC_JSON = 'ci-results/stateful-apex-s4-loss-source-diagnostic.json'
const DIAGNOSTIC_MD = 'ci-results/stateful-apex-s4-loss-source-diagnostic.md'
const PREREGISTRATION = 'ci-results/stateful-apex-s4-loss-source-diagnostic-preregistration.md'
const MANIFEST = 'ci-results/stateful-apex-s1-manifest.json'
const STATE_MACHINE = 'ci/research/lib/statefulApexEvents.ts'
const DIAGNOSTIC_RUNNER = 'ci/research/runStatefulApexS4LossSourceDiagnostic.ts'
const FREEZE_RUNNER = 'ci/research/runStatefulApexS4V2Freeze.ts'
const JSON_OUT = 'ci-results/stateful-apex-s4-v2-freeze.json'
const MD_OUT = 'ci-results/stateful-apex-s4-v2-freeze.md'
const FEATURE = 'recoveryFromExtremeOverInner'
const OUTCOME = 'favorableThenStop'
const COST_BPS_PER_SIDE = 5
const RESAMPLES = 10_000
const SEED = 20260821

interface DiagnosticEvent {
	features: Record<string, number | null>
}
interface Association {
	feature: string
	outcome: string
	effect: number | null
	clusterCi95: { low: number | null; high: number | null }
	q: number | null
	passesCandidateScreens: boolean
}
interface Diagnostic {
	protocol: {
		designArtifact: string
		designArtifactSha256: string
		manifest: string
		manifestSha256: string
		stateMachineSha256: string
		runnerSha256: string
		costBpsPerSide: number
		bootstrap: { resamples: number; seed: number }
	}
	integrityAudit: {
		passed: boolean
		s1UntouchedOos: Record<string, number>
		ondoVirtual: Record<string, number>
		sealedLabelsRead: number
	}
	associations: Association[]
	candidateDecision: {
		selectedFutureCandidate: { feature: string; outcome: string } | null
	}
	eventLedger: DiagnosticEvent[]
}

function fileBytes(path: string): Buffer {
	return readFileSync(resolve(path))
}
function sha256File(path: string): string {
	return createHash('sha256').update(fileBytes(path)).digest('hex')
}
function sha256Text(text: string): string {
	return createHash('sha256').update(text).digest('hex')
}
function quantile(values: readonly number[], p: number): number {
	if (values.length === 0) throw new Error('Cannot freeze a cutoff from an empty development feature sample.')
	const sorted = [...values].sort((a, b) => a - b)
	const position = (sorted.length - 1) * p
	const lower = Math.floor(position)
	const upper = Math.ceil(position)
	return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower)
}
function allZero(record: Record<string, number>): boolean {
	return Object.values(record).every((value) => value === 0)
}

function main(): void {
	const diagnostic = JSON.parse(readFileSync(resolve(DIAGNOSTIC_JSON), 'utf8')) as Diagnostic
	const errors: string[] = []
	if (!diagnostic.integrityAudit.passed) errors.push('upstream diagnostic integrity did not pass')
	if (!allZero(diagnostic.integrityAudit.s1UntouchedOos)) errors.push('S1 untouched OOS counters are not zero')
	if (!allZero(diagnostic.integrityAudit.ondoVirtual)) errors.push('ONDO/VIRTUAL counters are not zero')
	if (diagnostic.integrityAudit.sealedLabelsRead !== 0) errors.push('sealed labels were read')
	if (diagnostic.protocol.costBpsPerSide !== COST_BPS_PER_SIDE) errors.push('cost mismatch')
	if (diagnostic.protocol.bootstrap.resamples !== RESAMPLES || diagnostic.protocol.bootstrap.seed !== SEED) errors.push('bootstrap mismatch')
	if (diagnostic.protocol.designArtifact !== PREREGISTRATION) errors.push('preregistration path mismatch')
	if (diagnostic.protocol.designArtifactSha256 !== sha256File(PREREGISTRATION)) errors.push('preregistration hash mismatch')
	if (diagnostic.protocol.manifest !== MANIFEST || diagnostic.protocol.manifestSha256 !== sha256File(MANIFEST)) errors.push('manifest hash mismatch')
	if (diagnostic.protocol.stateMachineSha256 !== sha256File(STATE_MACHINE)) errors.push('state-machine hash mismatch')
	if (diagnostic.protocol.runnerSha256 !== sha256File(DIAGNOSTIC_RUNNER)) errors.push('diagnostic runner hash mismatch')
	const selected = diagnostic.candidateDecision.selectedFutureCandidate
	if (selected?.feature !== FEATURE || selected.outcome !== OUTCOME) errors.push('hierarchy-selected candidate mismatch')
	const association = diagnostic.associations.find((item) => item.feature === FEATURE && item.outcome === OUTCOME)
	if (association == null || !association.passesCandidateScreens || association.effect == null || association.effect >= 0 || association.clusterCi95.high == null || association.clusterCi95.high >= 0 || association.q == null || association.q > 0.05) {
		errors.push('candidate does not have the required stable negative association with favorableThenStop')
	}
	if (errors.length > 0) throw new Error(`S4 freeze integrity failure:\n${errors.join('\n')}`)

	// The diagnostic ledger is the already-published development artifact. Only the causal
	// feature is projected here; outcome/label/PnL fields are never read for cutoff selection.
	const developmentValues = diagnostic.eventLedger
		.map((event) => event.features[FEATURE])
		.filter((value): value is number => value != null && Number.isFinite(value))
	const cutoff = quantile(developmentValues, 0.5)
	const admittedDevelopmentFeatureCount = developmentValues.filter((value) => value >= cutoff).length

	const config = {
		protocolVersion: 'stateful-apex-s4-v2-freeze-v1',
		stage: 'FREEZE_ONLY_BLOCKED_BEFORE_HOLDOUT_REVEAL',
		candidate: { feature: FEATURE, associationOutcome: OUTCOME },
		causalTiming: {
			knownAt: 'REVERSAL_CONFIRMED close; before next-bar-open entry',
			definition: "recoveryFromExtremeOverInner = recoveryFromExtreme / innerWidth; long recoveryFromExtreme = confirmationClose - episode adverse low extreme; short = episode adverse high extreme - confirmationClose; innerWidth is contemporaneous |Mean - same-side Inner| at confirmation.",
			stateUpdateOrder: 'On the confirmation bar the adverse extreme is checked first. Confirmation is possible only when that bar creates no new adverse extreme and closes closer to Mean than the preceding close; feature payload is then captured before emission.',
			entry: 'open of the next bar after confirmation',
			outcomeLeakage: false,
		},
		rule: {
			name: 'minimum-recovery-before-entry-v2',
			formula: `admit = (${FEATURE} >= ${cutoff})`,
			feature: FEATURE,
			operator: '>=',
			cutoff,
			degreesOfFreedom: 1,
			directionRationale: 'The preregistered association is negative: larger causal recovery is associated with lower favorableThenStop incidence. Therefore the rule admits the upper half; the operator is not selected from PnL.',
		},
		cutoffSource: {
			population: 'all eligible S4 diagnostic development events',
			statistic: 'empirical median q=0.5 with linear interpolation',
			featureValues: developmentValues.length,
			admittedFeatureValues: admittedDevelopmentFeatureCount,
			labelFree: true,
			labelsReadForCutoff: 0,
			pnlGridRun: false,
			operatorsTried: 1,
			subgroupsTried: 0,
		},
		execution: {
			stateMachine: 'apex-state-v1 unchanged',
			entry: 'next-bar open unchanged',
			target: 'Mean frozen at confirmation unchanged',
			stop: 'same-side Outer frozen at confirmation unchanged',
			sameBarCollision: 'stop-first unchanged',
			costBpsPerSide: COST_BPS_PER_SIDE,
			fundingModeled: false,
		},
		bootstrap: {
			primary: 'hierarchical cluster bootstrap: symbols, then calendar-month clusters within sampled symbol; preserve all events/series in cluster',
			resamples: RESAMPLES,
			seed: SEED,
			confidenceInterval: 'percentile 95%',
			pairedBaseline: 'unfiltered v1 on identical frozen holdout events',
		},
		decisionGates: {
			minimumHoldoutBreadthBeforeReveal: 'at least 3 previously unused whole symbols and at least 3 independent series',
			successRequiresAll: [
				'v2 holdout mean netR > 0 at 5 bps/side',
				'v2 holdout hierarchical-bootstrap CI95 lower bound > 0',
				'paired mean netR delta (v2 - v1) > 0 and paired hierarchical-bootstrap CI95 lower bound > 0',
				'at least 60% of estimable holdout symbols have positive v2 mean netR',
				'at least 60% of estimable holdout independent series have positive v2 mean netR',
			],
			decision: 'PROMOTE only if every gate passes; otherwise KILL.',
		},
		forbiddenPostRevealActions: [
			'change feature, operator, cutoff, entry, target, stop, collision order, costs, bootstrap, or gates',
			'rerun or reuse the holdout for tuning after the single reveal',
			'perform PnL grids, alternative operators, subgroup/asset/TF/market/side rescue, or threshold retuning',
			'exclude series/events based on revealed labels, PnL, coverage, or observed performance',
			'read S1 untouched OOS or reuse ONDO/VIRTUAL',
			'use Vendor Shapes as feature, target, matcher, boundary, or selection criterion',
		],
	}

	const holdout = {
		status: 'BLOCKED_NOT_SELECTED_NOT_REVEALED',
		blocker: 'No new independent internal-holdout universe was specified by the preregistration or another pre-existing selection rule. The remaining local CSV inventory mixes previously used research series and potential candidates; choosing among them now would require subjective post-diagnostic selection. No raw candidate holdout file was opened.',
		exclusions: ['all S1 untouched-oos series', 'all ONDOUSDT series', 'all VIRTUALUSDT series', 'all series used in S4 development', 'Vendor Shapes and vendor-shape-derived selection'],
		acceptableDatasetAcquisitionMethods: [
			'Before download, freeze a venue/market, fixed symbol list from an external label-free rule, timeframe(s), UTC start/end, bar schema, and missing-data policy; then acquire a future non-overlapping period.',
			'Before download, freeze a deterministic label-free universe rule from a dated exchange listing snapshot (for example rank by contemporaneous quote volume with fixed exclusions), plus fixed N, timeframe(s), and UTC window.',
			'Use an author-supplied new export only if its exact symbol/market/timeframe/window list is declared in writing before any file is opened and none of the exclusions apply.',
		],
		revealCounters: {
			newInternalHoldoutFilesRead: 0,
			newInternalHoldoutRowsParsed: 0,
			newInternalHoldoutEventsDetected: 0,
			newInternalHoldoutFeaturesComputed: 0,
			newInternalHoldoutLabelsComputed: 0,
			newInternalHoldoutPnlComputed: 0,
			newInternalHoldoutMetricsComputed: 0,
			s1UntouchedOosRevealCount: 0,
			ondoVirtualReuseCount: 0,
		},
	}

	const outputWithoutHash = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		status: 'RULE_FROZEN_HOLDOUT_BLOCKED_NO_REVEAL',
		config,
		holdout,
		inputs: {
			preregistration: { path: PREREGISTRATION, sha256: sha256File(PREREGISTRATION) },
			diagnosticJson: { path: DIAGNOSTIC_JSON, sha256: sha256File(DIAGNOSTIC_JSON) },
			diagnosticMarkdown: { path: DIAGNOSTIC_MD, sha256: sha256File(DIAGNOSTIC_MD) },
			manifest: { path: MANIFEST, sha256: sha256File(MANIFEST) },
		},
		codeHashes: {
			stateMachine: sha256File(STATE_MACHINE),
			diagnosticRunner: sha256File(DIAGNOSTIC_RUNNER),
			freezeRunner: sha256File(FREEZE_RUNNER),
		},
		upstreamAssociation: association,
		integrityErrors: errors,
	}
	const configHash = sha256Text(JSON.stringify(config))
	const protocolHash = sha256Text(JSON.stringify({ config, holdout, inputs: outputWithoutHash.inputs, codeHashes: outputWithoutHash.codeHashes }))
	const output = { ...outputWithoutHash, configHash, protocolHash }
	writeFileSync(resolve(JSON_OUT), JSON.stringify(output, null, 2) + '\n')

	const md = [
		'# Stateful Apex Track S4 v2 — frozen rule; holdout blocked without reveal',
		'',
		'- Status: **RULE_FROZEN_HOLDOUT_BLOCKED_NO_REVEAL**.',
		'- Exactly one candidate, one scalar cutoff, and one operator. No PnL grid, operator search, or subgroup search.',
		'- New holdout raw files/rows/events/features/labels/PnL/metrics read or computed: **0/0/0/0/0/0/0**.',
		'- S1 untouched OOS reveal count: **0**. ONDO/VIRTUAL reuse count: **0**.',
		'',
		'## Causal timing and exact feature',
		'',
		'`recoveryFromExtremeOverInner` is captured on the `REVERSAL_CONFIRMED` bar, before entry at the next bar open. For long episodes it is `(confirmation close - adverse low extreme) / contemporaneous innerWidth`; for short episodes it is `(adverse high extreme - confirmation close) / contemporaneous innerWidth`. On that bar the state machine first checks for a new adverse extreme; confirmation is allowed only when there is none and the close moved closer to Mean. The payload is then captured before emission. It is therefore causal at admission time and does not use the later outcome.',
		'',
		'## Frozen rule',
		'',
		`\`admit = (${FEATURE} >= ${cutoff})\``,
		'',
		`Cutoff **${cutoff}** is the deterministic empirical median (q=0.5, linear interpolation) of ${developmentValues.length} development feature values. Only the feature column of the already-published diagnostic ledger was projected; labels and PnL read for cutoff selection: **0**.`,
		'',
		'The operator is fixed by the preregistered direction, not PnL: the selected association with `favorableThenStop` is negative, so larger recovery corresponds to less of that adverse mechanism; the upper half is admitted.',
		'',
		'## Holdout blocker',
		'',
		holdout.blocker,
		'',
		'Excluded: S1 untouched OOS, ONDO/VIRTUAL, S4 development series, and any Vendor-Shape-derived universe. No local candidate series was opened.',
		'',
		'Acceptable ways forward (freeze exact universe before acquisition/opening):',
		...holdout.acceptableDatasetAcquisitionMethods.map((item, index) => `${index + 1}. ${item}`),
		'',
		'## Frozen evaluation',
		'',
		'- Costs: **5 bps/side**, taker; funding not modeled.',
		'- Bootstrap: 10,000 hierarchical symbol→symbol-month resamples, seed `20260821`, percentile CI95; paired v1 baseline on identical events.',
		'- Minimum breadth before reveal: >=3 previously unused whole symbols and >=3 independent series.',
		'- PROMOTE only if all gates pass: v2 mean netR>0; CI95 low>0; paired delta>0 with CI95 low>0; >=60% positive symbols; >=60% positive series. Otherwise KILL.',
		'',
		'After reveal it is forbidden to retune the cutoff/operator/rule/execution/costs/bootstrap/gates, reuse the holdout, run PnL/operator/subgroup rescue, exclude losers, read S1 OOS, reuse ONDO/VIRTUAL, or use Vendor Shapes.',
		'',
		'## Hashes',
		'',
		`- Config SHA-256: \`${configHash}\``,
		`- Protocol SHA-256: \`${protocolHash}\``,
		`- Upstream diagnostic JSON: \`${output.inputs.diagnosticJson.sha256}\``,
		`- Upstream diagnostic MD: \`${output.inputs.diagnosticMarkdown.sha256}\``,
		`- Preregistration: \`${output.inputs.preregistration.sha256}\``,
		`- Manifest: \`${output.inputs.manifest.sha256}\``,
		`- State machine: \`${output.codeHashes.stateMachine}\``,
		`- Diagnostic runner: \`${output.codeHashes.diagnosticRunner}\``,
		`- Freeze runner: \`${output.codeHashes.freezeRunner}\``,
	]
	writeFileSync(resolve(MD_OUT), md.join('\n') + '\n')
	console.log(`Wrote ${JSON_OUT}`)
	console.log(`Wrote ${MD_OUT}`)
	console.log(`Frozen ${config.rule.formula}; holdout blocked; reveal counters remain zero.`)
}

main()
