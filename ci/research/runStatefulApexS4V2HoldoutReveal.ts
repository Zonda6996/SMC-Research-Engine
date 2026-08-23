import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { computeApexBands } from '../../src/core/signals/ApexEngine.js'
import type { Candle } from '../../src/models/price/Candle.js'
import { detectStatefulApexEvents, labelStatefulApexEvent, type ApexOutcomeLabel, type StatefulApexRow } from './lib/statefulApexEvents.js'

const UNIVERSE = 'ci-results/stateful-apex-s4-holdout-universe-freeze.json'
const ACQUISITION = 'ci-results/stateful-apex-s4-holdout-acquisition.json'
const RULE = 'ci-results/stateful-apex-s4-v2-freeze.json'
const RULE_MD = 'ci-results/stateful-apex-s4-v2-freeze.md'
const STATE_MACHINE = 'ci/research/lib/statefulApexEvents.ts'
const APEX_ENGINE = 'src/core/signals/ApexEngine.ts'
const OUT_JSON = 'ci-results/stateful-apex-s4-v2-holdout-reveal.json'
const OUT_MD = 'ci-results/stateful-apex-s4-v2-holdout-reveal.md'
const EXPECTED_UNIVERSE_HASH = '0f72ae18bfadef715bec8bfa7372f6551825f6c9b6256afafa2858ef71761c94'
const EXPECTED_RULE_CONFIG_HASH = '6b5fa5c9de7f26ac3f71ba258065c5ab5a22fd4eb17b57d7634013acc42b765f'
const EXPECTED_RULE_PROTOCOL_HASH = 'b7119204cb71c3ccb3582e4dfd1c5cfc03943a46ff6e370cd5e8257ee8e7fc70'
const EXPECTED_STATE_MACHINE_HASH = '5f82d45de35ede30e08599372e5cabd46bb04402ddc47de488fad1bfecb449c8'
const EXPECTED_APEX_ENGINE_HASH = '0857b29aef879a3de56641f4a49cf405ffad8226df19f6e24e8ab91597cb2af7'
const CUTOFF = 0.3203983409316291
const COST_BPS = 5
const RESAMPLES = 10_000
const SEED = 20260821

interface Universe { status: string; freezeHash: string; selectedSymbols: Array<{ canonicalSymbol: string }>; dataProtocol: { warmupBars: number; rowTargetPerSymbol: number }; revealCounters: Record<string, number> }
interface Acquisition { status: string; blocker: null; protocol: { freezeHash: string }; series: Array<{ symbol: string; file: string; rows: number; sha256: string; missingBars: number; schemaErrors: number; duplicateBars: number; offGridBars: number }>; revealCounters: Record<string, number> }
interface Rule { status: string; configHash: string; protocolHash: string; config: { rule: { formula: string; cutoff: number }; execution: { costBpsPerSide: number }; bootstrap: { resamples: number; seed: number }; decisionGates: unknown }; holdout: { revealCounters: Record<string, number> }; codeHashes: { stateMachine: string } }
interface Event { id: string; symbol: string; series: string; timestamp: number; month: string; admitted: boolean; label: ApexOutcomeLabel | null }
interface Metrics { detectedN: number; admittedN: number; validLabelN: number; resolvedN: number; censoredN: number; meanNetR: number | null; profitFactor: number | null; winRate: number | null; maxDrawdownR: number }
interface Ci { low: number | null; high: number | null }

function sha256(data: string | Buffer): string { return createHash('sha256').update(data).digest('hex') }
function sha256File(path: string): string { return sha256(readFileSync(resolve(path))) }
function zero(record: Record<string, number>): boolean { return Object.values(record).every((value) => value === 0) }
function mean(values: readonly number[]): number | null { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null }
function net(events: readonly Event[]): number[] { return events.flatMap((event) => event.label?.netR5bps == null ? [] : [event.label.netR5bps]) }
function metrics(events: readonly Event[], detectedN: number): Metrics {
	const values = net(events), valid = events.filter((event) => event.label != null)
	const profit = values.filter((x) => x > 0).reduce((a, b) => a + b, 0), loss = -values.filter((x) => x < 0).reduce((a, b) => a + b, 0)
	let equity = 0, peak = 0, maxDrawdownR = 0
	for (const event of [...events].filter((x) => x.label?.netR5bps != null).sort((a, b) => a.timestamp - b.timestamp || a.series.localeCompare(b.series) || a.id.localeCompare(b.id))) { equity += event.label!.netR5bps!; peak = Math.max(peak, equity); maxDrawdownR = Math.max(maxDrawdownR, peak - equity) }
	return { detectedN, admittedN: events.length, validLabelN: valid.length, resolvedN: values.length, censoredN: valid.length - values.length, meanNetR: mean(values), profitFactor: loss === 0 ? (profit > 0 ? null : 0) : profit / loss, winRate: values.length ? values.filter((x) => x > 0).length / values.length : null, maxDrawdownR }
}
function rng(seed: number): () => number { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
function quantile(values: number[], p: number): number | null { if (!values.length) return null; values.sort((a, b) => a - b); const at = (values.length - 1) * p, lo = Math.floor(at), hi = Math.ceil(at); return values[lo]! + (values[hi]! - values[lo]!) * (at - lo) }
function bootstrap(events: readonly Event[]): { v1: Ci; v2: Ci; delta: Ci; validDraws: number } {
	const bySymbol = new Map<string, Map<string, Event[]>>()
	for (const event of events.filter((x) => x.label?.netR5bps != null)) { let months = bySymbol.get(event.symbol); if (!months) { months = new Map(); bySymbol.set(event.symbol, months) } const bucket = months.get(event.month) ?? []; bucket.push(event); months.set(event.month, bucket) }
	const symbols = [...bySymbol.keys()].sort(), random = rng(SEED), v1: number[] = [], v2: number[] = [], delta: number[] = []
	for (let b = 0; b < RESAMPLES; b++) { const sample: Event[] = []; for (let si = 0; si < symbols.length; si++) { const symbol = symbols[Math.floor(random() * symbols.length)]!, clusters = [...bySymbol.get(symbol)!.values()]; for (let ci = 0; ci < clusters.length; ci++) sample.push(...clusters[Math.floor(random() * clusters.length)]!) } const a = mean(net(sample)), c = mean(net(sample.filter((x) => x.admitted))); if (a != null) v1.push(a); if (c != null) v2.push(c); if (a != null && c != null) delta.push(c - a) }
	const ci = (x: number[]): Ci => ({ low: quantile(x, .025), high: quantile(x, .975) })
	return { v1: ci(v1), v2: ci(v2), delta: ci(delta), validDraws: delta.length }
}
function fmt(value: number | null, d = 5): string { return value == null ? 'n/a' : value.toFixed(d) }

function main(): void {
	if (process.env.S4_HOLDOUT_REVEAL_ACK !== 'single-final-reveal') throw new Error('Explicit single-final-reveal acknowledgement is required.')
	if (existsSync(resolve(OUT_JSON)) || existsSync(resolve(OUT_MD))) throw new Error('Reveal artifact already exists; a second reveal is forbidden.')
	const universeBytes = readFileSync(resolve(UNIVERSE)), acquisitionBytes = readFileSync(resolve(ACQUISITION)), ruleBytes = readFileSync(resolve(RULE)), ruleMdBytes = readFileSync(resolve(RULE_MD))
	const universe = JSON.parse(universeBytes.toString()) as Universe, acquisition = JSON.parse(acquisitionBytes.toString()) as Acquisition, rule = JSON.parse(ruleBytes.toString()) as Rule
	const integrityErrors: string[] = []
	if (universe.status !== 'IMMUTABLE_HOLDOUT_UNIVERSE_FROZEN_NO_OHLCV_READ' || universe.freezeHash !== EXPECTED_UNIVERSE_HASH || !zero(universe.revealCounters)) integrityErrors.push('universe freeze/seal mismatch')
	if (acquisition.status !== 'HOLDOUT_ACQUIRED_VALIDATED_NOT_REVEALED' || acquisition.blocker !== null || acquisition.protocol.freezeHash !== universe.freezeHash || !zero(acquisition.revealCounters)) integrityErrors.push('acquisition/seal mismatch')
	if (rule.status !== 'RULE_FROZEN_HOLDOUT_BLOCKED_NO_REVEAL' || rule.configHash !== EXPECTED_RULE_CONFIG_HASH || rule.protocolHash !== EXPECTED_RULE_PROTOCOL_HASH || !zero(rule.holdout.revealCounters)) integrityErrors.push('frozen rule/seal mismatch')
	if (rule.config.rule.cutoff !== CUTOFF || rule.config.rule.formula !== `admit = (recoveryFromExtremeOverInner >= ${CUTOFF})` || rule.config.execution.costBpsPerSide !== COST_BPS || rule.config.bootstrap.resamples !== RESAMPLES || rule.config.bootstrap.seed !== SEED) integrityErrors.push('frozen evaluation parameters mismatch')
	if (sha256File(STATE_MACHINE) !== EXPECTED_STATE_MACHINE_HASH || rule.codeHashes.stateMachine !== EXPECTED_STATE_MACHINE_HASH) integrityErrors.push('state-machine hash mismatch')
	if (sha256File(APEX_ENGINE) !== EXPECTED_APEX_ENGINE_HASH) integrityErrors.push('Apex engine hash mismatch')
	if (acquisition.series.length !== 3 || JSON.stringify(acquisition.series.map((x) => x.symbol)) !== JSON.stringify(universe.selectedSymbols.map((x) => x.canonicalSymbol))) integrityErrors.push('whole-symbol assignment mismatch')
	for (const series of acquisition.series) if (series.rows !== universe.dataProtocol.rowTargetPerSymbol || series.missingBars || series.schemaErrors || series.duplicateBars || series.offGridBars || sha256File(series.file) !== series.sha256) integrityErrors.push(`series integrity mismatch: ${series.symbol}`)
	if (integrityErrors.length) throw new Error(`Pre-reveal integrity failure:\n${integrityErrors.join('\n')}`)

	const all: Event[] = [], counters = { filesRead: 0, rowsParsed: 0, eligibleRows: 0, eventsDetected: 0, featuresComputed: 0, labelsComputed: 0, pnlComputed: 0, metricsComputed: 0, s1UntouchedOosRevealCount: 0, ondoVirtualReuseCount: 0 }
	for (const series of acquisition.series) {
		const candles = JSON.parse(readFileSync(resolve(series.file), 'utf8')) as Candle[]; counters.filesRead++; counters.rowsParsed += candles.length
		const bands = computeApexBands(candles)
		const rows: StatefulApexRow[] = candles.map((c, i) => ({ timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume, mean: bands[i]!.mean, upperOuter: bands[i]!.redHi, upperInner: bands[i]!.redLo, lowerInner: bands[i]!.greenHi, lowerOuter: bands[i]!.greenLo })).slice(universe.dataProtocol.warmupBars)
		counters.eligibleRows += rows.length
		const detected = detectStatefulApexEvents(rows); counters.eventsDetected += detected.events.length; counters.featuresComputed += detected.events.length
		for (const event of detected.events) { const label = labelStatefulApexEvent(rows, event, COST_BPS); counters.labelsComputed++; if (label?.netR5bps != null) counters.pnlComputed++; all.push({ id: `${series.symbol}:${event.id}`, symbol: series.symbol, series: series.file, timestamp: event.confirmationTimestamp, month: new Date(event.confirmationTimestamp).toISOString().slice(0, 7), admitted: event.features.innerWidth > 0 && event.features.recoveryFromExtreme / event.features.innerWidth >= CUTOFF, label }) }
	}
	const v1 = all, v2 = all.filter((x) => x.admitted), v1Metrics = metrics(v1, all.length), v2Metrics = metrics(v2, all.length), confidence = bootstrap(v1); counters.metricsComputed = 1
	const symbols = acquisition.series.map((x) => x.symbol), bySymbol = symbols.map((symbol) => ({ symbol, v1: metrics(v1.filter((x) => x.symbol === symbol), v1.filter((x) => x.symbol === symbol).length), v2: metrics(v2.filter((x) => x.symbol === symbol), v1.filter((x) => x.symbol === symbol).length) })), bySeries = acquisition.series.map((item) => ({ series: item.file, symbol: item.symbol, v1: metrics(v1.filter((x) => x.series === item.file), v1.filter((x) => x.series === item.file).length), v2: metrics(v2.filter((x) => x.series === item.file), v1.filter((x) => x.series === item.file).length) }))
	const positiveSymbols = bySymbol.filter((x) => x.v2.meanNetR != null && x.v2.meanNetR > 0).length, estimableSymbols = bySymbol.filter((x) => x.v2.meanNetR != null).length, positiveSeries = bySeries.filter((x) => x.v2.meanNetR != null && x.v2.meanNetR > 0).length, estimableSeries = bySeries.filter((x) => x.v2.meanNetR != null).length
	const delta = v1Metrics.meanNetR == null || v2Metrics.meanNetR == null ? null : v2Metrics.meanNetR - v1Metrics.meanNetR
	const gates = { minimumBreadth: estimableSymbols >= 3 && estimableSeries >= 3, v2MeanPositive: v2Metrics.meanNetR != null && v2Metrics.meanNetR > 0, v2CiLowPositive: confidence.v2.low != null && confidence.v2.low > 0, pairedDeltaPositive: delta != null && delta > 0, pairedDeltaCiLowPositive: confidence.delta.low != null && confidence.delta.low > 0, positiveSymbolBreadth60Pct: estimableSymbols > 0 && positiveSymbols / estimableSymbols >= .6, positiveSeriesBreadth60Pct: estimableSeries > 0 && positiveSeries / estimableSeries >= .6 }
	const verdict = Object.values(gates).every(Boolean) ? 'PROMOTE' : 'KILL'
	const output = { schemaVersion: 1, generatedAt: new Date().toISOString(), status: 'FINAL_SINGLE_HOLDOUT_REVEAL', verdict, protocol: { frozenRule: rule.config.rule.formula, oneWayCostBps: COST_BPS, fundingModeled: false, bootstrap: { method: 'paired hierarchical symbol then symbol-calendar-month percentile bootstrap', resamples: RESAMPLES, seed: SEED }, retuned: false, subgroupOrPnlRescue: false, losingSymbolsExcluded: false, vendorShapesUsed: false, revealCount: 1 }, acquisitionProvenance: { universeFreeze: { path: UNIVERSE, sha256: sha256(universeBytes), freezeHash: universe.freezeHash }, acquisition: { path: ACQUISITION, sha256: sha256(acquisitionBytes) }, frozenRule: { path: RULE, sha256: sha256(ruleBytes), markdownSha256: sha256(ruleMdBytes), configHash: rule.configHash, protocolHash: rule.protocolHash }, series: acquisition.series }, integrity: { passed: true, errors: integrityErrors, counters }, v1Unfiltered: { metrics: v1Metrics, ci95: confidence.v1 }, v2Frozen: { metrics: v2Metrics, ci95: confidence.v2 }, pairedDeltaMeanNetR: { estimate: delta, ci95: confidence.delta, validBootstrapDraws: confidence.validDraws }, breadth: { positiveSymbols, estimableSymbols, fractionPositiveSymbols: estimableSymbols ? positiveSymbols / estimableSymbols : null, positiveSeries, estimableSeries, fractionPositiveSeries: estimableSeries ? positiveSeries / estimableSeries : null }, bySymbol, bySeries, gates }
	writeFileSync(resolve(OUT_JSON), JSON.stringify(output, null, 2) + '\n')
	const table = bySymbol.map((x) => `| ${x.symbol} | ${x.v1.resolvedN} | ${fmt(x.v1.meanNetR)} | ${x.v2.resolvedN} | ${fmt(x.v2.meanNetR)} |`).join('\n')
	const md = `# Stateful Apex S4 v2 — final independent holdout reveal\n\n- Final decision: **${verdict}**.\n- Reveal count: **1**. No retune, subgroup/PnL rescue, losing-symbol exclusion, Vendor Shapes, S1 OOS read, or ONDO/VIRTUAL reuse.\n- Integrity: **PASS**; ${counters.filesRead} files, ${counters.rowsParsed} rows, ${counters.eventsDetected} events, ${counters.labelsComputed} labels.\n\n## Aggregate at 5 bps/side\n\n| arm | resolved N | mean netR | CI95 | PF | WR | maxDD R |\n|---|---:|---:|---|---:|---:|---:|\n| unfiltered v1 | ${v1Metrics.resolvedN} | ${fmt(v1Metrics.meanNetR)} | [${fmt(confidence.v1.low)}, ${fmt(confidence.v1.high)}] | ${fmt(v1Metrics.profitFactor)} | ${fmt(v1Metrics.winRate)} | ${fmt(v1Metrics.maxDrawdownR)} |\n| frozen v2 | ${v2Metrics.resolvedN} | ${fmt(v2Metrics.meanNetR)} | [${fmt(confidence.v2.low)}, ${fmt(confidence.v2.high)}] | ${fmt(v2Metrics.profitFactor)} | ${fmt(v2Metrics.winRate)} | ${fmt(v2Metrics.maxDrawdownR)} |\n\nPaired delta v2-v1: **${fmt(delta)}**, CI95 [${fmt(confidence.delta.low)}, ${fmt(confidence.delta.high)}].\n\nBreadth: ${positiveSymbols}/${estimableSymbols} positive symbols; ${positiveSeries}/${estimableSeries} positive independent series.\n\n| symbol | v1 N | v1 mean | v2 N | v2 mean |\n|---|---:|---:|---:|---:|\n${table}\n\n## Frozen gates\n\n${Object.entries(gates).map(([key, pass]) => `- ${key}: **${pass ? 'PASS' : 'FAIL'}**`).join('\n')}\n\nFinal frozen decision: **${verdict}**.\n`
	writeFileSync(resolve(OUT_MD), md)
	console.log(`Single final reveal complete: ${verdict}; v2=${fmt(v2Metrics.meanNetR)}, delta=${fmt(delta)}.`)
}

main()
