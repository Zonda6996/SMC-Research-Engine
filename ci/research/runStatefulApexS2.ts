import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseExactIndicatorCsv } from './lib/exactIndicatorExport.js'
import {
	detectStatefulApexEvents,
	labelStatefulApexEvent,
	statefulApexSplit,
	type ApexEventSide,
	type ApexOutcomeLabel,
	type ApexSplit,
	type StatefulApexEvent,
	type StatefulApexRow,
} from './lib/statefulApexEvents.js'

const MANIFEST_PATH = resolve('ci-results/stateful-apex-s1-manifest.json')
const JSON_OUT = resolve('ci-results/stateful-apex-s2-results.json')
const MD_OUT = resolve('ci-results/stateful-apex-s2-results.md')
const ONE_WAY_COST_BPS = 5
const BOOTSTRAP_SEED = 20260820
const BOOTSTRAP_RESAMPLES = 10_000

type ManifestSplit = 'train' | 'validation' | 'untouched-oos'
interface ManifestSeries {
	file: string
	symbol: string
	timeframe: string
	market: 'spot' | 'futures'
	split: ManifestSplit
	rows: number
	eligibleRows: number
	sha256: string
	primaryEvents: number
	censoredNoNextBar: number
}
interface FrozenManifest {
	config: {
		protocolVersion: string
		oneWayCostBps: number
		warmupBars: number
		split: string
		stateMachine: string[]
		entry: string
		labelsGeneratedInThisRun: boolean
		untouchedOosMetricsInspected: boolean
		vendorShapesReadByParserButDiscardedBeforeDetection: boolean
		vendorShapesInFeaturesOrTargets: boolean
		unimplemented: string[]
	}
	configHash: string
	codeHashes: { stateMachine: string; runner: string; tests: string }
	series: ManifestSeries[]
}
interface EconomicEvent {
	id: string
	symbol: string
	series: string
	timestamp: number
	month: string
	side: ApexEventSide
	label: ApexOutcomeLabel | null
}
interface GroupMetrics {
	events: number
	validLabels: number
	invalidLabels: number
	resolved: number
	censored: number
	censorRate: number
	count: number
	meanR: number | null
	medianR: number | null
	profitFactor: number | null
	winRate: number | null
	maxDrawdownR: number | null
	meanMfeR: number | null
	meanMaeR: number | null
	targetBeforeStop: { target: number; stop: number; censored: number }
}
interface SplitReport {
	split: ManifestSplit
	primary: GroupMetrics
	ci95: { method: string; resamples: number; seed: number; low: number | null; high: number | null }
	bySymbol: Array<{ symbol: string; metrics: GroupMetrics }>
	bySeries: Array<{ series: string; symbol: string; metrics: GroupMetrics }>
	bySide: Array<{ side: ApexEventSide; metrics: GroupMetrics }>
	breadth: {
		positiveSymbols: number
		symbols: number
		positiveSymbolFraction: number
		positiveSeries: number
		series: number
		maxSymbolContributionFraction: number | null
		leaveOneSymbolOut: Array<{ omitted: string; meanR: number | null }>
		allLeaveOneOutPositive: boolean
	}
	randomMatchedBaseline: GroupMetrics
}

function sha256File(path: string): string {
	return createHash('sha256').update(readFileSync(resolve(path))).digest('hex')
}
function sha256Text(text: string): string {
	return createHash('sha256').update(text).digest('hex')
}
function mean(xs: readonly number[]): number | null {
	return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length
}
function median(xs: readonly number[]): number | null {
	if (xs.length === 0) return null
	const sorted = [...xs].sort((a, b) => a - b)
	const mid = Math.floor(sorted.length / 2)
	return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}
function economicValues(events: readonly EconomicEvent[]): number[] {
	return events.flatMap((event) => event.label?.netR5bps == null ? [] : [event.label.netR5bps])
}
function metrics(events: readonly EconomicEvent[]): GroupMetrics {
	const valid = events.filter((event) => event.label != null)
	const resolved = valid.filter((event) => event.label!.netR5bps != null)
	const values = economicValues(events)
	const wins = values.filter((x) => x > 0)
	const grossProfit = wins.reduce((sum, x) => sum + x, 0)
	const grossLoss = -values.filter((x) => x < 0).reduce((sum, x) => sum + x, 0)
	let equity = 0, peak = 0, maxDrawdownR = 0
	for (const event of [...resolved].sort((a, b) => a.timestamp - b.timestamp || a.series.localeCompare(b.series) || a.id.localeCompare(b.id))) {
		equity += event.label!.netR5bps!
		peak = Math.max(peak, equity)
		maxDrawdownR = Math.max(maxDrawdownR, peak - equity)
	}
	return {
		events: events.length,
		validLabels: valid.length,
		invalidLabels: events.length - valid.length,
		resolved: resolved.length,
		censored: valid.length - resolved.length,
		censorRate: valid.length === 0 ? 0 : (valid.length - resolved.length) / valid.length,
		count: values.length,
		meanR: mean(values),
		medianR: median(values),
		profitFactor: grossLoss === 0 ? (grossProfit > 0 ? null : 0) : grossProfit / grossLoss,
		winRate: values.length === 0 ? null : wins.length / values.length,
		maxDrawdownR,
		meanMfeR: mean(valid.map((event) => event.label!.mfeR)),
		meanMaeR: mean(valid.map((event) => event.label!.maeR)),
		targetBeforeStop: {
			target: valid.filter((event) => event.label!.targetBeforeStop === true).length,
			stop: valid.filter((event) => event.label!.targetBeforeStop === false).length,
			censored: valid.filter((event) => event.label!.targetBeforeStop === 'censored').length,
		},
	}
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
function percentile(sorted: readonly number[], p: number): number | null {
	if (sorted.length === 0) return null
	const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))
	return sorted[index]!
}
function clusterBootstrap(events: readonly EconomicEvent[]): { low: number | null; high: number | null } {
	const resolved = events.filter((event) => event.label?.netR5bps != null)
	const byAsset = new Map<string, Map<string, number[]>>()
	for (const event of resolved) {
		let months = byAsset.get(event.symbol)
		if (months == null) { months = new Map(); byAsset.set(event.symbol, months) }
		const cluster = `${event.symbol}:${event.month}`
		const values = months.get(cluster) ?? []
		values.push(event.label!.netR5bps!)
		months.set(cluster, values)
	}
	const assets = [...byAsset.keys()].sort()
	if (assets.length === 0) return { low: null, high: null }
	const rng = mulberry32(BOOTSTRAP_SEED)
	const estimates: number[] = []
	for (let b = 0; b < BOOTSTRAP_RESAMPLES; b++) {
		let sum = 0, count = 0
		for (let ai = 0; ai < assets.length; ai++) {
			const asset = assets[Math.floor(rng() * assets.length)]!
			const clusters = [...byAsset.get(asset)!.values()]
			for (let ci = 0; ci < clusters.length; ci++) {
				const sampled = clusters[Math.floor(rng() * clusters.length)]!
				for (const value of sampled) { sum += value; count++ }
			}
		}
		if (count > 0) estimates.push(sum / count)
	}
	estimates.sort((a, b) => a - b)
	return { low: percentile(estimates, 0.025), high: percentile(estimates, 0.975) }
}
function labelAt(rows: readonly StatefulApexRow[], confirmationIndex: number, side: ApexEventSide): ApexOutcomeLabel | null {
	const event: StatefulApexEvent = {
		id: `random:${rows[confirmationIndex]!.timestamp}:${side}`,
		side,
		episodeStartIndex: confirmationIndex,
		innerTouchIndex: confirmationIndex,
		confirmationIndex,
		confirmationTimestamp: rows[confirmationIndex]!.timestamp,
		entryIndex: confirmationIndex + 1 < rows.length ? confirmationIndex + 1 : null,
		entryTimestamp: confirmationIndex + 1 < rows.length ? rows[confirmationIndex + 1]!.timestamp : null,
		features: undefined as never,
	}
	return labelStatefulApexEvent(rows, event, ONE_WAY_COST_BPS)
}
function deterministicRandomBaseline(rows: readonly StatefulApexRow[], primary: readonly StatefulApexEvent[], series: ManifestSeries): EconomicEvent[] {
	const rng = mulberry32(Number.parseInt(createHash('sha256').update(`random-baseline:${series.file}`).digest('hex').slice(0, 8), 16))
	const used = new Set<number>()
	const output: EconomicEvent[] = []
	for (const source of primary) {
		const candidates: number[] = []
		const sourceMonth = new Date(source.confirmationTimestamp).toISOString().slice(0, 7)
		for (let i = 0; i + 1 < rows.length; i++) {
			if (used.has(i)) continue
			const row = rows[i]!
			if (new Date(row.timestamp).toISOString().slice(0, 7) !== sourceMonth) continue
			if (source.side === 'long' ? row.close < row.mean : row.close > row.mean) candidates.push(i)
		}
		if (candidates.length === 0) continue
		const index = candidates[Math.floor(rng() * candidates.length)]!
		used.add(index)
		output.push({
			id: `random:${series.file}:${index}:${source.side}`,
			symbol: series.symbol,
			series: series.file,
			timestamp: rows[index]!.timestamp,
			month: new Date(rows[index]!.timestamp).toISOString().slice(0, 7),
			side: source.side,
			label: labelAt(rows, index, source.side),
		})
	}
	return output
}
function reportSplit(split: ManifestSplit, primary: EconomicEvent[], random: EconomicEvent[]): SplitReport {
	const symbols = [...new Set(primary.map((event) => event.symbol))].sort()
	const series = [...new Set(primary.map((event) => event.series))].sort()
	const bySymbol = symbols.map((symbol) => ({ symbol, metrics: metrics(primary.filter((event) => event.symbol === symbol)) }))
	const bySeries = series.map((name) => ({ series: name, symbol: primary.find((event) => event.series === name)!.symbol, metrics: metrics(primary.filter((event) => event.series === name)) }))
	const symbolTotals = bySymbol.map(({ symbol, metrics: value }) => ({ symbol, total: economicValues(primary.filter((event) => event.symbol === symbol)).reduce((a, b) => a + b, 0), mean: value.meanR }))
	const pooledTotal = symbolTotals.reduce((sum, item) => sum + item.total, 0)
	const positiveSymbols = symbolTotals.filter((item) => item.mean != null && item.mean > 0).length
	const positiveSeries = bySeries.filter((item) => item.metrics.meanR != null && item.metrics.meanR > 0).length
	const leaveOneSymbolOut = symbols.map((omitted) => ({ omitted, meanR: mean(economicValues(primary.filter((event) => event.symbol !== omitted))) }))
	return {
		split,
		primary: metrics(primary),
		ci95: { method: 'hierarchical percentile cluster bootstrap: outer symbol, inner symbol×calendar-month', resamples: BOOTSTRAP_RESAMPLES, seed: BOOTSTRAP_SEED, ...clusterBootstrap(primary) },
		bySymbol,
		bySeries,
		bySide: (['long', 'short'] as const).map((side) => ({ side, metrics: metrics(primary.filter((event) => event.side === side)) })),
		breadth: {
			positiveSymbols,
			symbols: symbols.length,
			positiveSymbolFraction: symbols.length === 0 ? 0 : positiveSymbols / symbols.length,
			positiveSeries,
			series: series.length,
			maxSymbolContributionFraction: pooledTotal <= 0 ? null : Math.max(...symbolTotals.map((item) => item.total)) / pooledTotal,
			leaveOneSymbolOut,
			allLeaveOneOutPositive: leaveOneSymbolOut.length > 0 && leaveOneSymbolOut.every((item) => item.meanR != null && item.meanR > 0),
		},
		randomMatchedBaseline: metrics(random),
	}
}
function fmt(value: number | null, digits = 4): string {
	return value == null ? 'n/a' : value.toFixed(digits)
}

function main(): void {
	const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as FrozenManifest
	const integrityErrors: string[] = []
	if (manifest.config.protocolVersion !== 'apex-state-v1') integrityErrors.push('protocolVersion mismatch')
	if (manifest.config.oneWayCostBps !== ONE_WAY_COST_BPS) integrityErrors.push('cost mismatch')
	if (manifest.config.vendorShapesInFeaturesOrTargets !== false) integrityErrors.push('vendor shape prohibition mismatch')
	if (sha256Text(JSON.stringify(manifest.config)) !== manifest.configHash) integrityErrors.push('config hash mismatch')
	if (sha256File('ci/research/lib/statefulApexEvents.ts') !== manifest.codeHashes.stateMachine) integrityErrors.push('state-machine hash mismatch')
	if (sha256File('ci/research/runStatefulApexS1.ts') !== manifest.codeHashes.runner) integrityErrors.push('S1 runner hash mismatch')
	if (sha256File('tests/statefulApexEvents.test.ts') !== manifest.codeHashes.tests) integrityErrors.push('state-machine test hash mismatch')

	const bySplit = new Map<ManifestSplit, EconomicEvent[]>([['train', []], ['validation', []], ['untouched-oos', []]])
	const randomBySplit = new Map<ManifestSplit, EconomicEvent[]>([['train', []], ['validation', []], ['untouched-oos', []]])
	const preparedOos: Array<{ series: ManifestSeries; rows: StatefulApexRow[]; events: StatefulApexEvent[] }> = []

	for (const series of manifest.series) {
		if (sha256File(series.file) !== series.sha256) integrityErrors.push(`data hash mismatch: ${series.file}`)
		if (statefulApexSplit(series.symbol) !== series.split as ApexSplit) integrityErrors.push(`split mismatch: ${series.file}`)
		const parsed = parseExactIndicatorCsv(readFileSync(resolve(series.file), 'utf8'), { allowIrregularBars: true, allowInvalidBandOrder: true })
		// Vendor BUY/SELL Shapes are deliberately discarded before detection and never enter features or labels.
		const rows: StatefulApexRow[] = parsed.map(({ buy: _buy, sell: _sell, ...row }) => row).slice(manifest.config.warmupBars)
		if (parsed.length !== series.rows || rows.length !== series.eligibleRows) integrityErrors.push(`row count mismatch: ${series.file}`)
		const detection = detectStatefulApexEvents(rows)
		if (detection.events.length !== series.primaryEvents) integrityErrors.push(`event count mismatch: ${series.file}`)
		if (detection.events.filter((event) => event.entryIndex == null).length !== series.censoredNoNextBar) integrityErrors.push(`next-bar censor mismatch: ${series.file}`)
		if (series.split === 'untouched-oos') {
			preparedOos.push({ series, rows, events: detection.events })
			continue
		}
		const primary = detection.events.map((event): EconomicEvent => ({
			id: `${series.file}:${event.id}`,
			symbol: series.symbol,
			series: series.file,
			timestamp: event.confirmationTimestamp,
			month: new Date(event.confirmationTimestamp).toISOString().slice(0, 7),
			side: event.side,
			label: labelStatefulApexEvent(rows, event, ONE_WAY_COST_BPS),
		}))
		bySplit.get(series.split)!.push(...primary)
		randomBySplit.get(series.split)!.push(...deterministicRandomBaseline(rows, detection.events, series))
	}
	if (integrityErrors.length > 0) throw new Error(`Frozen-manifest integrity failure:\n${integrityErrors.join('\n')}`)

	const train = reportSplit('train', bySplit.get('train')!, randomBySplit.get('train')!)
	// Frozen choice: the sole primary threshold-free confirmed-event arm. A0/A1 are not used because
	// their concrete episode/cooldown semantics were not frozen sufficiently for an attribution run.
	const frozenSelection = {
		arm: 'primary-threshold-free-all-confirmed-events',
		selectedBeforeValidation: true,
		selectionRule: 'No train optimization; only the preregistered primary arm is eligible.',
		attributionArms: 'A0/A1 not implemented and not eligible as winners.',
	}
	const validation = reportSplit('validation', bySplit.get('validation')!, randomBySplit.get('validation')!)
	const validationAdvance = validation.primary.meanR != null && validation.primary.meanR > 0
	let oos: SplitReport | null = null
	let oosRevealCount = 0
	if (validationAdvance) {
		// This is the sole point at which untouched-OOS labels are computed.
		for (const item of preparedOos) {
			const primary = item.events.map((event): EconomicEvent => ({
				id: `${item.series.file}:${event.id}`,
				symbol: item.series.symbol,
				series: item.series.file,
				timestamp: event.confirmationTimestamp,
				month: new Date(event.confirmationTimestamp).toISOString().slice(0, 7),
				side: event.side,
				label: labelStatefulApexEvent(item.rows, event, ONE_WAY_COST_BPS),
			}))
			bySplit.get('untouched-oos')!.push(...primary)
			randomBySplit.get('untouched-oos')!.push(...deterministicRandomBaseline(item.rows, item.events, item.series))
		}
		oosRevealCount = 1
		oos = reportSplit('untouched-oos', bySplit.get('untouched-oos')!, randomBySplit.get('untouched-oos')!)
	}
	const success = oos != null
		&& oos.primary.meanR != null && oos.primary.meanR > 0
		&& oos.ci95.low != null && oos.ci95.low > 0
		&& oos.breadth.positiveSymbolFraction >= 0.60
		&& oos.breadth.positiveSeries >= 2
		&& oos.breadth.maxSymbolContributionFraction != null && oos.breadth.maxSymbolContributionFraction <= 0.50
		&& oos.breadth.allLeaveOneOutPositive
	const inconclusive = oos != null && (oos.breadth.symbols < 2 || oos.primary.count < 30)
	const verdict = !validationAdvance ? 'KILL_VALIDATION_NO_EDGE' : success ? 'SUCCESS' : inconclusive ? 'INCONCLUSIVE' : 'KILL_OOS_NO_EDGE'
	const output = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		protocol: {
			manifest: 'ci-results/stateful-apex-s1-manifest.json',
			manifestConfigHash: manifest.configHash,
			stateMachineHash: manifest.codeHashes.stateMachine,
			oneWayCostBps: ONE_WAY_COST_BPS,
			bootstrapSeed: BOOTSTRAP_SEED,
			bootstrapResamples: BOOTSTRAP_RESAMPLES,
			vendorShapesUsed: false,
			stateMachineChanged: false,
			splitsChanged: false,
			primaryLabelsChanged: false,
			integrityErrors,
		},
		frozenSelection,
		train,
		validation,
		validationDecision: validationAdvance ? 'ADVANCE_PRIMARY_AS_FROZEN' : 'KILL_V1_NO_OOS_REVEAL',
		oosRevealCount,
		untouchedOos: oos,
		preregisteredProjectBaseline: {
			source: 'docs/strategies/zonda-reversal.md §3',
			note: 'Independent OWN2 project baseline uses a different 7 bps/side universe/execution and is contextual, not a like-for-like selection target.',
			rows: [
				{ mode: 'Safe', meanR: -0.063, ci95: [-0.130, 0.003], profitFactor: 0.779, count: 398 },
				{ mode: 'Risk', meanR: -0.016, ci95: [-0.100, 0.072], profitFactor: 0.961, count: 422 },
				{ mode: 'Standard', meanR: 0.017, ci95: [-0.105, 0.133], profitFactor: 1.032, count: 322 },
			],
		},
		verdict,
		successGate: {
			netMeanPositive: oos?.primary.meanR != null && oos.primary.meanR > 0,
			ciLowPositive: oos?.ci95.low != null && oos.ci95.low > 0,
			positiveAssetFractionAtLeast60Pct: oos != null && oos.breadth.positiveSymbolFraction >= 0.60,
			atLeastTwoPositiveSeries: oos != null && oos.breadth.positiveSeries >= 2,
			noAssetOver50PctPooledNetR: oos?.breadth.maxSymbolContributionFraction != null && oos.breadth.maxSymbolContributionFraction <= 0.50,
			leaveOneAssetOutKeepsPositiveSign: oos != null && oos.breadth.allLeaveOneOutPositive,
		},
		limitations: [
			'Censored outcomes are published and excluded from realised meanR/PF/WR because no realised target/stop R exists.',
			'Pooled drawdown orders simultaneous cross-series events by timestamp then series name; per-series drawdowns are also published.',
			'Funding is unavailable in OHLCV and is not invented; futures results therefore omit funding.',
			'A0/A1 were not run because the frozen docs name them but do not fully freeze independent episode/cooldown semantics.',
		],
	}
	writeFileSync(JSON_OUT, JSON.stringify(output, null, 2) + '\n')

	const splitLines = (title: string, report: SplitReport | null): string[] => report == null ? [`## ${title}`, '', 'Not revealed (validation kill).', ''] : [
		`## ${title}`,
		'',
		`- Events / valid / resolved / censored: ${report.primary.events} / ${report.primary.validLabels} / ${report.primary.resolved} / ${report.primary.censored}`,
		`- Net meanR: **${fmt(report.primary.meanR)}**; CI95: [${fmt(report.ci95.low)}, ${fmt(report.ci95.high)}]`,
		`- PF / WR / max DD: ${fmt(report.primary.profitFactor)} / ${fmt(report.primary.winRate)} / ${fmt(report.primary.maxDrawdownR)}R`,
		`- Mean future MFE / MAE: ${fmt(report.primary.meanMfeR)}R / ${fmt(report.primary.meanMaeR)}R`,
		`- Target / stop / censored: ${report.primary.targetBeforeStop.target} / ${report.primary.targetBeforeStop.stop} / ${report.primary.targetBeforeStop.censored}`,
		`- Positive symbols: ${report.breadth.positiveSymbols}/${report.breadth.symbols}; positive series: ${report.breadth.positiveSeries}/${report.breadth.series}`,
		`- Random matched baseline meanR: ${fmt(report.randomMatchedBaseline.meanR)} (N=${report.randomMatchedBaseline.count})`,
		'',
		'| symbol | N | meanR | PF | WR | DD |',
		'|---|---:|---:|---:|---:|---:|',
		...report.bySymbol.map((x) => `| ${x.symbol} | ${x.metrics.count} | ${fmt(x.metrics.meanR)} | ${fmt(x.metrics.profitFactor)} | ${fmt(x.metrics.winRate)} | ${fmt(x.metrics.maxDrawdownR)} |`),
		'',
		'| series | N | meanR | PF | WR | DD |',
		'|---|---:|---:|---:|---:|---:|',
		...report.bySeries.map((x) => `| ${x.series} | ${x.metrics.count} | ${fmt(x.metrics.meanR)} | ${fmt(x.metrics.profitFactor)} | ${fmt(x.metrics.winRate)} | ${fmt(x.metrics.maxDrawdownR)} |`),
		'',
	]
	const md = [
		'# Stateful Apex S2 — preregistered economics and one OOS gate',
		'',
		`- Frozen manifest config: \`${manifest.configHash}\``,
		`- Frozen state-machine hash: \`${manifest.codeHashes.stateMachine}\``,
		`- Arm: \`${frozenSelection.arm}\` (no thresholds, no train selection)`,
		'- Vendor Shapes used as target/feature: **no**',
		`- Validation decision: **${output.validationDecision}**`,
		`- Untouched-OOS reveal count: **${oosRevealCount}**`,
		`- Final verdict: **${verdict}**`,
		'',
		...splitLines('Train', train),
		...splitLines('Validation', validation),
		...splitLines('Untouched OOS', oos),
		'## Success gate',
		'',
		`- net meanR > 0: ${output.successGate.netMeanPositive}`,
		`- CI95 low > 0: ${output.successGate.ciLowPositive}`,
		`- ≥60% positive assets: ${output.successGate.positiveAssetFractionAtLeast60Pct}`,
		`- ≥2 positive series: ${output.successGate.atLeastTwoPositiveSeries}`,
		`- no asset >50% pooled net R: ${output.successGate.noAssetOver50PctPooledNetR}`,
		`- leave-one-asset-out stays positive: ${output.successGate.leaveOneAssetOutKeepsPositiveSign}`,
		'',
		'## Protocol notes / limitations',
		'',
		...output.limitations.map((line) => `- ${line}`),
		'- Cluster CI is hierarchical percentile bootstrap with outer symbol and inner symbol×calendar-month clusters, 10,000 resamples, seed 20260820.',
		'- Frozen OWN2 baseline is included in JSON as contextual comparison only; it is not like-for-like (7 bps/side and a different universe/execution).',
	]
	writeFileSync(MD_OUT, md.join('\n') + '\n')
	console.log(`Validation: ${output.validationDecision}`)
	console.log(`OOS reveals: ${oosRevealCount}`)
	console.log(`Verdict: ${verdict}`)
	console.log(`Wrote ${JSON_OUT}`)
	console.log(`Wrote ${MD_OUT}`)
}

main()
