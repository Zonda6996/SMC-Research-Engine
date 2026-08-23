import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { detectArrowSignalsFromBands, type ArrowSide } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayArrowSignals } from '../../src/core/signals/ArrowTradeReplay.js'
import type { ApexBand } from '../../src/core/signals/ApexEngine.js'
import { fetchFundingHistory } from '../../tools/shared/fundingFetcher.js'
import { parseExactIndicatorCsv } from './lib/exactIndicatorExport.js'
import {
	decideFundingSign,
	fundingContributionR,
	pairedUtcDayClusterBootstrap,
	type PairedOpportunity,
	type SettledFunding,
} from './lib/own2FundingSignResearch.js'

const CSV_PATH = 'csv/BINANCE_AVAXUSDT.P, 60.csv'
const EXPECTED_CSV_SHA256 = '63d3716eb8feb891c19786e5c27a989bdae78629c390474904f651098f488dae'
const AMENDMENT_PATH = 'ci-results/own2-funding-sign-avax-diagnostic-amendment.md'
const EXPECTED_AMENDMENT_SHA256 = 'faf09ed3b260d96f3f0d45dec7d7f94b8f12208e6666f8e2da95c76f319e9a63'
const FUNDING_PATH = 'data/own2-funding-sign-avax/AVAXUSDT-funding.json'
const DATA_MANIFEST_PATH = 'data/own2-funding-sign-avax/manifest.json'
const RESULT_JSON_PATH = 'ci-results/own2-funding-sign-avax-diagnostic.json'
const RESULT_MD_PATH = 'ci-results/own2-funding-sign-avax-diagnostic.md'
const STATUS_PATH = 'ci-results/own2-funding-sign-reveal-status.json'
const SAMPLES = 10_000
const SEED = 25_082_026
const HOUR = 3_600_000
const DAY = 86_400_000
const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const fileHash = (path: string): string => sha256(readFileSync(resolve(path)))
const iso = (x: number): string => new Date(x).toISOString()

const bandsFromRows = (rows: ReturnType<typeof parseExactIndicatorCsv>): ApexBand[] => rows.map((row) => ({
	mean: row.mean,
	s: row.mean > 0 ? Math.abs(row.upperInner - row.mean) / row.mean : Number.NaN,
	redLo: row.upperInner,
	redHi: row.upperOuter,
	greenHi: row.lowerInner,
	greenLo: row.lowerOuter,
}))

interface EconomicRow {
	decisionAt: number
	side: ArrowSide
	priceGrossR: number
	feeR: number
	fundingR: number
	netR: number
	retained: boolean
	ageMs: number | null
	decision: string
}
interface Metrics { n: number; totalR: number; meanR: number | null; pf: number | null; wr: number | null; maxDdR: number }
function metrics(rows: readonly EconomicRow[], value: (row: EconomicRow) => number): Metrics {
	const ordered = [...rows].sort((a, b) => a.decisionAt - b.decisionAt)
	const values = ordered.map(value).filter(Number.isFinite)
	const gains = values.filter((x) => x > 0).reduce((a, b) => a + b, 0)
	const losses = -values.filter((x) => x < 0).reduce((a, b) => a + b, 0)
	let equity = 0, peak = 0, maxDdR = 0
	for (const x of values) { equity += x; peak = Math.max(peak, equity); maxDdR = Math.max(maxDdR, peak - equity) }
	return { n: values.length, totalR: values.reduce((a, b) => a + b, 0), meanR: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, pf: losses > 0 ? gains / losses : gains > 0 ? Number.POSITIVE_INFINITY : null, wr: values.length ? values.filter((x) => x > 0).length / values.length : null, maxDdR }
}
function quantile(values: readonly number[], p: number): number | null {
	if (!values.length) return null
	const sorted = [...values].sort((a, b) => a - b)
	return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!
}
function sideBreakdown(rows: readonly EconomicRow[], value: (row: EconomicRow) => number): Record<ArrowSide, Metrics> {
	return { long: metrics(rows.filter((x) => x.side === 'long'), value), short: metrics(rows.filter((x) => x.side === 'short'), value) }
}
function concentration(rows: readonly EconomicRow[], value: (row: EconomicRow) => number): { topUtcDayAbsShare: number | null; topTradeAbsShare: number | null } {
	const abs = rows.map((x) => Math.abs(value(x)))
	const totalAbs = abs.reduce((a, b) => a + b, 0)
	const byDay = new Map<string, number>()
	for (const row of rows) { const day = iso(row.decisionAt).slice(0, 10); byDay.set(day, (byDay.get(day) ?? 0) + Math.abs(value(row))) }
	return { topUtcDayAbsShare: totalAbs ? Math.max(...byDay.values()) / totalAbs : null, topTradeAbsShare: totalAbs ? Math.max(...abs) / totalAbs : null }
}
function fmt(x: number | null, digits = 5): string { return x == null ? 'n/a' : Number.isFinite(x) ? x.toFixed(digits) : '∞' }

async function main(): Promise<void> {
	if (fileHash(CSV_PATH) !== EXPECTED_CSV_SHA256) throw new Error('Frozen AVAX candle SHA-256 mismatch')
	if (fileHash(AMENDMENT_PATH) !== EXPECTED_AMENDMENT_SHA256) throw new Error('Immutable amendment SHA-256 mismatch')
	const rows = parseExactIndicatorCsv(readFileSync(resolve(CSV_PATH), 'utf8'), { expectedTimeframeMs: HOUR, allowInvalidBandOrder: true })
	const bands = bandsFromRows(rows)
	const detection = detectArrowSignalsFromBands(rows, bands, { warmupBars: 200, relativeVolumePeriod: 20, minimumRelativeVolume: 1.4, minimumDistanceMeanPct: 3, minimumPenetrationInner: -0.35 })
	const baseline0 = replayArrowSignals(rows, bands, detection.candidates, 'safe', { oneWayCostBps: 0 })
	const baseline5 = replayArrowSignals(rows, bands, detection.candidates, 'safe', { oneWayCostBps: 5 })
	if (baseline0.trades.length !== baseline5.trades.length || baseline0.trades.some((t, i) => t.signalAt !== baseline5.trades[i]?.signalAt)) throw new Error('Cost arms changed baseline opportunity set')

	const fromMs = rows[0]!.timestamp - DAY
	const untilMs = rows.at(-1)!.timestamp + HOUR
	const funding = await fetchFundingHistory('AVAXUSDT', fromMs, untilMs, { cacheDir: resolve('tmp/own2-funding-sign-avax-cache'), preferApi: true }) as SettledFunding[]
	if (!funding.length) throw new Error('Official Binance USD-M funding coverage is empty')
	mkdirSync(resolve('data/own2-funding-sign-avax'), { recursive: true })
	const fundingText = `${JSON.stringify({ schemaVersion: 1, source: 'Binance USD-M /fapi/v1/fundingRate', symbol: 'AVAXUSDT', interval: { fromInclusiveUtc: iso(fromMs), untilExclusiveUtc: iso(untilMs) }, rows: funding }, null, 2)}\n`
	writeFileSync(resolve(FUNDING_PATH), fundingText)

	const economic: EconomicRow[] = baseline5.trades.map((trade, index) => {
		const zero = baseline0.trades[index]!
		const decision = decideFundingSign(trade.side, trade.signalAt, funding)
		const fundingR = fundingContributionR(trade, funding)
		return { decisionAt: trade.signalAt, side: trade.side, priceGrossR: zero.grossR, feeR: trade.costR, fundingR, netR: trade.netR + fundingR, retained: decision.decision === 'retain', ageMs: decision.ageMs, decision: decision.decision }
	})
	const retained = economic.filter((x) => x.retained)
	const vetoed = economic.filter((x) => !x.retained)
	const value0 = (x: EconomicRow): number => x.priceGrossR + x.fundingR
	const value5 = (x: EconomicRow): number => x.netR
	const zeroFiltered = (x: EconomicRow): number => x.retained ? value0(x) : 0
	const netFiltered = (x: EconomicRow): number => x.retained ? value5(x) : 0
	const paired: PairedOpportunity[] = economic.map((x) => ({ symbol: 'AVAXUSDT', timeframe: '1h', decisionAt: x.decisionAt, baselineNetR: value5(x), filteredNetR: netFiltered(x), retained: x.retained }))
	const bootstrap = pairedUtcDayClusterBootstrap(paired, SAMPLES, SEED)
	const pairedDeltaTotalR = paired.reduce((sum, x) => sum + x.filteredNetR - x.baselineNetR, 0)
	const ages = economic.flatMap((x) => x.ageMs == null ? [] : [x.ageMs / HOUR])
	const byDecision = Object.fromEntries(['retain', 'veto-sign', 'veto-zero', 'veto-missing'].map((d) => [d, economic.filter((x) => x.decision === d).length]))
	const settledBeforeFirstDecision = funding.some((x) => x.timestamp < Math.min(...economic.map((x) => x.decisionAt)))
	const dataManifest = {
		schemaVersion: 1, generatedAtUtc: new Date().toISOString(), officialSource: 'https://fapi.binance.com/fapi/v1/fundingRate',
		candle: { path: CSV_PATH, expectedSha256: EXPECTED_CSV_SHA256, actualSha256: fileHash(CSV_PATH), rows: rows.length, firstUtc: iso(rows[0]!.timestamp), lastUtc: iso(rows.at(-1)!.timestamp) },
		funding: { path: FUNDING_PATH, sha256: sha256(fundingText), rows: funding.length, firstUtc: iso(funding[0]!.timestamp), lastUtc: iso(funding.at(-1)!.timestamp), requestedFromUtc: iso(fromMs), requestedUntilExclusiveUtc: iso(untilMs), settledBeforeFirstDecision },
		amendment: { path: AMENDMENT_PATH, sha256: EXPECTED_AMENDMENT_SHA256 },
	}
	writeFileSync(resolve(DATA_MANIFEST_PATH), `${JSON.stringify(dataManifest, null, 2)}\n`)
	const result = {
		schemaVersion: 1, classification: 'INCONCLUSIVE SMALL-N', diagnosticDirection: pairedDeltaTotalR > 0 ? 'point estimate supports filter' : pairedDeltaTotalR < 0 ? 'point estimate rejects filter' : 'point estimate neutral',
		frozenRuleChangedAfterOutcomes: false, series: { symbol: 'AVAXUSDT', market: 'futures', timeframe: '1h', split: 'S1 untouched-oos before this reveal' },
		provenance: dataManifest, bootstrap: { method: 'paired UTC-calendar-day block/cluster', samples: SAMPLES, seed: SEED, ci95: bootstrap },
		counts: { rawBaselineCandidates: detection.candidates.length, baselineOpportunities: economic.length, baselineExecutedTrades: economic.length, retained: retained.length, vetoed: vetoed.length, retainedRate: economic.length ? retained.length / economic.length : 0, byDecision },
		metrics: {
			baseline: { gross0IncludingFunding: metrics(economic, value0), net5IncludingFunding: metrics(economic, value5) },
			filtered: { gross0IncludingFunding: metrics(economic, zeroFiltered), net5IncludingFundingPerBaselineOpportunity: metrics(economic, netFiltered), net5ExecutedRetainedOnly: metrics(retained, value5) },
			primaryComparison: { baselineMeanNetPerOpportunity: metrics(economic, value5).meanR, baselineTotalNetR: metrics(economic, value5).totalR, filteredMeanNetPerOpportunity: metrics(economic, netFiltered).meanR, filteredTotalNetR: metrics(economic, netFiltered).totalR, pairedDeltaMeanR: economic.length ? pairedDeltaTotalR / economic.length : 0, pairedDeltaTotalR },
			retainedSubsetBaselineBeforeFilter: { gross0IncludingFunding: metrics(retained, value0), net5IncludingFunding: metrics(retained, value5) },
			vetoedCounterfactualBaseline: { gross0IncludingFunding: metrics(vetoed, value0), net5IncludingFunding: metrics(vetoed, value5) },
		},
		fundingDecomposition: { baselinePriceGrossR: economic.reduce((s, x) => s + x.priceGrossR, 0), baselineFundingR: economic.reduce((s, x) => s + x.fundingR, 0), baselineFeeDragR: economic.reduce((s, x) => s + x.feeR, 0), retainedPriceGrossR: retained.reduce((s, x) => s + x.priceGrossR, 0), retainedFundingR: retained.reduce((s, x) => s + x.fundingR, 0), retainedFeeDragR: retained.reduce((s, x) => s + x.feeR, 0), latestRateAgeHours: { min: quantile(ages, 0), median: quantile(ages, 0.5), p90: quantile(ages, 0.9), max: quantile(ages, 1) } },
		breakdown: { baselineNet5BySide: sideBreakdown(economic, value5), filteredRetainedNet5BySide: sideBreakdown(retained, value5), vetoedNet5BySide: sideBreakdown(vetoed, value5), baselineConcentration: concentration(economic, value5), filteredRetainedConcentration: concentration(retained, value5) },
		limitations: ['Single symbol: no cross-symbol breadth or generalization.', `Baseline N=${economic.length}, below frozen 250 gate.`, `Retained N=${retained.length}, ${retained.length < 100 ? 'below' : 'at/above'} frozen 100 gate.`, 'This diagnostic cannot produce a clean multi-symbol GO.'],
	}
	writeFileSync(resolve(RESULT_JSON_PATH), `${JSON.stringify(result, null, 2)}\n`)
	const b0 = result.metrics.baseline.gross0IncludingFunding, b5 = result.metrics.baseline.net5IncludingFunding
	const f0 = result.metrics.filtered.gross0IncludingFunding, f5o = result.metrics.filtered.net5IncludingFundingPerBaselineOpportunity, f5t = result.metrics.filtered.net5ExecutedRetainedOnly
	const rr = result.metrics.retainedSubsetBaselineBeforeFilter.net5IncludingFunding, vv = result.metrics.vetoedCounterfactualBaseline.net5IncludingFunding
	const lines = [
		'# OWN2 + funding-sign — AVAX-only one-time diagnostic reveal', '', `# \`${result.classification}\``, '',
		`Точечное направление: **${result.diagnosticDirection}**. Это не общий GO: раскрыт один symbol, baseline N=${economic.length}<250.`, '',
		'## Counts', `- Raw OWN2 candidates: ${detection.candidates.length}; baseline opportunities/executed trades: ${economic.length}/${economic.length}.`, `- Retained: ${retained.length}; vetoed: ${vetoed.length}; retained rate ${(result.counts.retainedRate * 100).toFixed(2)}%.`, `- Decisions: ${JSON.stringify(byDecision)}.`, '',
		'## Economics (R)', '| arm / cost | N | total R | mean R | PF | WR | max DD R |', '|---|---:|---:|---:|---:|---:|---:|',
		`| baseline gross 0 bps + actual funding | ${b0.n} | ${fmt(b0.totalR)} | ${fmt(b0.meanR)} | ${fmt(b0.pf)} | ${fmt(b0.wr)} | ${fmt(b0.maxDdR)} |`,
		`| baseline net 5 bps + actual funding | ${b5.n} | ${fmt(b5.totalR)} | ${fmt(b5.meanR)} | ${fmt(b5.pf)} | ${fmt(b5.wr)} | ${fmt(b5.maxDdR)} |`,
		`| filtered gross 0 bps, veto=0/opportunity | ${f0.n} | ${fmt(f0.totalR)} | ${fmt(f0.meanR)} | ${fmt(f0.pf)} | ${fmt(f0.wr)} | ${fmt(f0.maxDdR)} |`,
		`| filtered net 5 bps, veto=0/opportunity | ${f5o.n} | ${fmt(f5o.totalR)} | ${fmt(f5o.meanR)} | ${fmt(f5o.pf)} | ${fmt(f5o.wr)} | ${fmt(f5o.maxDdR)} |`,
		`| filtered net 5 bps, executed retained only | ${f5t.n} | ${fmt(f5t.totalR)} | ${fmt(f5t.meanR)} | ${fmt(f5t.pf)} | ${fmt(f5t.wr)} | ${fmt(f5t.maxDdR)} |`, '',
		'## Primary paired comparison', `- Mean/total baseline net per opportunity: ${fmt(result.metrics.primaryComparison.baselineMeanNetPerOpportunity)} / ${fmt(result.metrics.primaryComparison.baselineTotalNetR)}R.`, `- Mean/total filtered net per opportunity (veto=0): ${fmt(result.metrics.primaryComparison.filteredMeanNetPerOpportunity)} / ${fmt(result.metrics.primaryComparison.filteredTotalNetR)}R.`, `- Paired delta mean/total: ${fmt(result.metrics.primaryComparison.pairedDeltaMeanR)} / ${fmt(result.metrics.primaryComparison.pairedDeltaTotalR)}R.`, `- UTC-day bootstrap CI95 (10k, seed 25082026): [${fmt(bootstrap.lower)}, ${fmt(bootstrap.upper)}], median ${fmt(bootstrap.median)} R/opportunity.`, '',
		'## Selection effect and veto counterfactual', `- Retained subset baseline-before-filter @5: N=${rr.n}, total ${fmt(rr.totalR)}R, mean ${fmt(rr.meanR)}, PF ${fmt(rr.pf)}, WR ${fmt(rr.wr)}, DD ${fmt(rr.maxDdR)}R.`, `- Vetoed counterfactual baseline @5: N=${vv.n}, total ${fmt(vv.totalR)}R, mean ${fmt(vv.meanR)}, PF ${fmt(vv.pf)}, WR ${fmt(vv.wr)}, DD ${fmt(vv.maxDdR)}R.`, '',
		'## Funding, sides, concentration', `- Baseline decomposition: price gross ${fmt(result.fundingDecomposition.baselinePriceGrossR)}R; funding ${fmt(result.fundingDecomposition.baselineFundingR)}R; fee drag ${fmt(result.fundingDecomposition.baselineFeeDragR)}R.`, `- Retained decomposition: price gross ${fmt(result.fundingDecomposition.retainedPriceGrossR)}R; funding ${fmt(result.fundingDecomposition.retainedFundingR)}R; fee drag ${fmt(result.fundingDecomposition.retainedFeeDragR)}R.`, `- Latest settled-rate age, hours: min ${fmt(result.fundingDecomposition.latestRateAgeHours.min, 2)}, median ${fmt(result.fundingDecomposition.latestRateAgeHours.median, 2)}, p90 ${fmt(result.fundingDecomposition.latestRateAgeHours.p90, 2)}, max ${fmt(result.fundingDecomposition.latestRateAgeHours.max, 2)}.`, `- Baseline net @5 sides: long ${JSON.stringify(result.breakdown.baselineNet5BySide.long)}, short ${JSON.stringify(result.breakdown.baselineNet5BySide.short)}.`, `- Retained net @5 sides: long ${JSON.stringify(result.breakdown.filteredRetainedNet5BySide.long)}, short ${JSON.stringify(result.breakdown.filteredRetainedNet5BySide.short)}.`, `- Concentration (share of absolute net R): baseline top day ${fmt(result.breakdown.baselineConcentration.topUtcDayAbsShare, 4)}, top trade ${fmt(result.breakdown.baselineConcentration.topTradeAbsShare, 4)}; retained top day ${fmt(result.breakdown.filteredRetainedConcentration.topUtcDayAbsShare, 4)}, top trade ${fmt(result.breakdown.filteredRetainedConcentration.topTradeAbsShare, 4)}.`, '',
		'## Ограничения простыми словами', 'Это один AVAX и небольшое число сделок. Результат может быть особенностью именно AVAX или данного периода; проверить переносимость на другие рынки невозможно. Bootstrap оценивает временную неопределённость внутри этой серии, но не заменяет независимые symbols. Поэтому независимо от знака point estimate итог остаётся `INCONCLUSIVE SMALL-N`, а не clean multi-symbol GO.', '',
		'## Provenance', `- Amendment SHA-256: \`${EXPECTED_AMENDMENT_SHA256}\`.`, `- Candle SHA-256: \`${EXPECTED_CSV_SHA256}\` (PASS).`, `- Funding rows: ${funding.length}, ${iso(funding[0]!.timestamp)} — ${iso(funding.at(-1)!.timestamp)}, SHA-256 \`${sha256(fundingText)}\`.`, `- Machine-readable result: \`${RESULT_JSON_PATH}\`; data audit: \`${DATA_MANIFEST_PATH}\`.`,
	]
	writeFileSync(resolve(RESULT_MD_PATH), `${lines.join('\n')}\n`)
	const status = { schemaVersion: 1, split: 'stateful-apex-s1 untouched-oos', wholeSplitRevealCount: 0, wholeSplitStatus: 'partially-revealed', series: [
		{ file: CSV_PATH, symbol: 'AVAXUSDT', market: 'futures', timeframe: '1h', status: 'revealed-diagnostic', revealArtifact: RESULT_JSON_PATH },
		{ file: 'csv/BINANCE_AVAXUSDT, 5.csv', symbol: 'AVAXUSDT', market: 'spot', timeframe: '5m', status: 'untouched' },
		{ file: 'csv/BINANCE_LINKUSDT, 15.csv', symbol: 'LINKUSDT', market: 'spot', timeframe: '15m', status: 'untouched' },
		{ file: 'csv/BINANCE_LINKUSDT, 60.csv', symbol: 'LINKUSDT', market: 'spot', timeframe: '1h', status: 'untouched' },
		{ file: 'csv/BINANCE_SOLUSDT, 120.csv', symbol: 'SOLUSDT', market: 'spot', timeframe: '2h', status: 'untouched' },
	], note: 'Granular status: one of five series revealed. wholeSplitRevealCount remains 0 because the entire S1 split was not revealed.' }
	writeFileSync(resolve(STATUS_PATH), `${JSON.stringify(status, null, 2)}\n`)
	console.log(lines.slice(0, 32).join('\n'))
}

void main()
