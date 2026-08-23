import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeApexBands } from '../../src/core/signals/ApexEngine.js'
import { detectArrowSignalsFromBands, type ArrowSide } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayArrowSignals, type ArrowTrade } from '../../src/core/signals/ArrowTradeReplay.js'
import type { Candle } from '../../src/models/price/Candle.js'
import { fetchFundingHistory } from '../../tools/shared/fundingFetcher.js'
import {
	decideFundingSign, fundingContributionR, pairedUtcDayClusterBootstrap,
	type PairedOpportunity, type SettledFunding,
} from './lib/own2FundingSignResearch.js'

const HOUR = 3_600_000
const DAY = 86_400_000
const CUTOFF = Date.parse('2025-09-17T17:00:00.000Z')
const SAMPLES = 10_000
const SEED = 25_082_026
const PREREG_PATH = 'ci-results/own2-funding-sign-btc-eth-sol-preregistration.md'
const PREREG_SHA256 = '6442965a30ddb0546b82cbd29529ab27d1de79539dc143f4503d261d40f183d9'
const ACQUISITION_FREEZE_PATH = 'data/own2-funding-sign-btc-eth-sol/acquisition-manifest.md'
const ACQUISITION_FREEZE_SHA256 = '80ea6a481a3d987210ee36c1365f21990d9f497cb8423527114ec5d6617b3586'
const DATA_DIR = 'data/own2-funding-sign-btc-eth-sol'
const DATA_MANIFEST_PATH = `${DATA_DIR}/manifest.json`
const RESULT_JSON_PATH = 'ci-results/own2-funding-sign-btc-eth-sol-results.json'
const RESULT_MD_PATH = 'ci-results/own2-funding-sign-btc-eth-sol-results.md'
const SERIES = [
	{ symbol: 'BTCUSDT', path: 'csv/BINANCE_BTCUSDT.P, 60.csv', sha256: '951065dc48e419e0f5d9e457a49a35273d4683697795b846e9a60e2bcc8d046b' },
	{ symbol: 'ETHUSDT', path: 'csv/BINANCE_ETHUSDT.P, 60.csv', sha256: 'ea7945859ffe6fad7ee0d0792de617e6362841aaacb5627009e34555c18a3fb5' },
	{ symbol: 'SOLUSDT', path: 'csv/BINANCE_SOLUSDT.P, 60.csv', sha256: '2bd807c921e6df886feff8e37afe07275ffbc99cc4bcce5863d4b3ce27876d85' },
] as const

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const fileHash = (path: string): string => sha256(readFileSync(resolve(path)))
const iso = (x: number): string => new Date(x).toISOString()
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)
const quantile = (xs: readonly number[], p: number): number | null => {
	if (!xs.length) return null
	const sorted = [...xs].sort((a, b) => a - b)
	return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!
}
const fmt = (x: number | null, d = 5): string => x == null ? 'n/a' : Number.isFinite(x) ? x.toFixed(d) : '∞'

export interface CandleAudit {
	rows: number; malformedRows: number; firstUtc: string; lastUtc: string; monotonic: boolean
	duplicateTimestamps: number; missingHourlyBars: number; irregularIntervals: number
	ohlcInvalid: number; volumeInvalid: number; exactHourAligned: boolean
}

/** Parses only OHLCV. Vendor GGI lines/shapes are deliberately ignored. */
export function parseAndAuditOwn2Csv(text: string): { candles: Candle[]; audit: CandleAudit } {
	const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((x) => x.trim().length > 0)
	if (lines.length < 2) throw new Error('CSV is empty')
	const header = lines[0]!.split(',')
	if (header[0] !== 'time' || header[1] !== 'open' || header[2] !== 'high' || header[3] !== 'low' || header[4] !== 'close' || header.at(-1) !== 'Volume') {
		throw new Error(`Unexpected OHLCV header: ${header.join(',')}`)
	}
	const candles: Candle[] = []
	let malformedRows = 0, duplicateTimestamps = 0, missingHourlyBars = 0, irregularIntervals = 0, ohlcInvalid = 0, volumeInvalid = 0
	let monotonic = true, exactHourAligned = true
	for (let i = 1; i < lines.length; i++) {
		const fields = lines[i]!.split(',')
		const seconds = Number(fields[0]); const open = Number(fields[1]); const high = Number(fields[2]); const low = Number(fields[3]); const close = Number(fields[4]); const volume = Number(fields.at(-1))
		if (fields.length !== header.length || !Number.isSafeInteger(seconds) || ![open, high, low, close, volume].every(Number.isFinite)) { malformedRows++; continue }
		const timestamp = seconds * 1000
		if (timestamp % HOUR !== 0) exactHourAligned = false
		const previous = candles.at(-1)
		if (previous != null) {
			const delta = timestamp - previous.timestamp
			if (delta <= 0) monotonic = false
			if (delta === 0) duplicateTimestamps++
			if (delta !== HOUR) { irregularIntervals++; if (delta > HOUR && delta % HOUR === 0) missingHourlyBars += delta / HOUR - 1 }
		}
		if (!(open > 0 && high > 0 && low > 0 && close > 0 && low <= Math.min(open, close) && high >= Math.max(open, close) && low <= high)) ohlcInvalid++
		if (!(volume >= 0)) volumeInvalid++
		candles.push({ timestamp, open, high, low, close, volume })
	}
	if (!candles.length) throw new Error('No parseable candle rows')
	return { candles, audit: { rows: candles.length, malformedRows, firstUtc: iso(candles[0]!.timestamp), lastUtc: iso(candles.at(-1)!.timestamp), monotonic, duplicateTimestamps, missingHourlyBars, irregularIntervals, ohlcInvalid, volumeInvalid, exactHourAligned } }
}

interface FundingAudit {
	rows: number; firstUtc: string | null; lastUtc: string | null; sorted: boolean
	duplicateTimestamps: number; conflictingDuplicates: number; cadenceHours: Record<string, number>
	irregularCadenceCount: number
}
function auditFunding(rows: readonly SettledFunding[]): FundingAudit {
	let sorted = true, duplicateTimestamps = 0, conflictingDuplicates = 0, irregularCadenceCount = 0
	const cadence = new Map<string, number>(); const seen = new Map<number, SettledFunding>()
	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]!; const previous = rows[i - 1]
		if (previous != null) {
			if (row.timestamp < previous.timestamp) sorted = false
			const hours = (row.timestamp - previous.timestamp) / HOUR
			const key = Number.isInteger(hours) ? String(hours) : hours.toFixed(6)
			cadence.set(key, (cadence.get(key) ?? 0) + 1)
			if (hours <= 0 || hours > 8.01 || hours < 3.99) irregularCadenceCount++
		}
		const old = seen.get(row.timestamp)
		if (old != null) { duplicateTimestamps++; if (old.rate !== row.rate || old.markPrice !== row.markPrice) conflictingDuplicates++ }
		seen.set(row.timestamp, row)
	}
	return { rows: rows.length, firstUtc: rows[0] ? iso(rows[0].timestamp) : null, lastUtc: rows.at(-1) ? iso(rows.at(-1)!.timestamp) : null, sorted, duplicateTimestamps, conflictingDuplicates, cadenceHours: Object.fromEntries([...cadence.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))), irregularCadenceCount }
}

interface EconomicRow {
	symbol: string; decisionAt: number; side: ArrowSide; trade: ArrowTrade
	priceGrossR: number; costR: number; fundingR: number; netR: number
	retained: boolean; decision: string; ageHours: number | null
}
interface Metrics {
	n: number; totalR: number; meanR: number | null; meanPerBaselineOpportunity: number | null
	pf: number | null; wr: number | null; maxDdR: number; fundingR: number; costsR: number
	meanHoldingBars: number | null; medianHoldingBars: number | null
}
function metrics(
	rows: readonly EconomicRow[],
	value: (x: EconomicRow) => number,
	baselineN = rows.length,
	exposureRows: readonly EconomicRow[] = rows,
): Metrics {
	const ordered = [...rows].sort((a, b) => a.decisionAt - b.decisionAt || a.symbol.localeCompare(b.symbol))
	const values = ordered.map(value).filter(Number.isFinite); const gains = sum(values.filter((x) => x > 0)); const losses = -sum(values.filter((x) => x < 0))
	let equity = 0, peak = 0, maxDdR = 0
	for (const x of values) { equity += x; peak = Math.max(peak, equity); maxDdR = Math.max(maxDdR, peak - equity) }
	const holding = exposureRows.map((x) => x.trade.holdingBars)
	return { n: values.length, totalR: sum(values), meanR: values.length ? sum(values) / values.length : null, meanPerBaselineOpportunity: baselineN ? sum(values) / baselineN : null, pf: losses > 0 ? gains / losses : gains > 0 ? Number.POSITIVE_INFINITY : null, wr: values.length ? values.filter((x) => x > 0).length / values.length : null, maxDdR, fundingR: sum(exposureRows.map((x) => x.fundingR)), costsR: sum(exposureRows.map((x) => x.costR)), meanHoldingBars: holding.length ? sum(holding) / holding.length : null, medianHoldingBars: quantile(holding, 0.5) }
}
function breakdown(rows: readonly EconomicRow[], baselineN: number): Record<string, Metrics> {
	return Object.fromEntries(['long', 'short'].map((side) => [side, metrics(rows.filter((x) => x.side === side), (x) => x.netR, baselineN)]))
}
function concentration(rows: readonly EconomicRow[]): object {
	const totalAbs = sum(rows.map((x) => Math.abs(x.netR)))
	const byDay = new Map<string, number>()
	for (const x of rows) { const key = iso(x.decisionAt).slice(0, 10); byDay.set(key, (byDay.get(key) ?? 0) + x.netR) }
	const topTrades = [...rows].sort((a, b) => Math.abs(b.netR) - Math.abs(a.netR)).slice(0, 10).map((x) => ({ symbol: x.symbol, decisionUtc: iso(x.decisionAt), side: x.side, netR: x.netR, retained: x.retained }))
	return { topTradeAbsShare: totalAbs ? Math.max(...rows.map((x) => Math.abs(x.netR))) / totalAbs : null, topUtcDayAbsShare: totalAbs ? Math.max(...[...byDay.values()].map(Math.abs)) / totalAbs : null, topTrades }
}

async function main(): Promise<void> {
	if (fileHash(PREREG_PATH) !== PREREG_SHA256) throw new Error('Immutable preregistration hash mismatch')
	if (fileHash(ACQUISITION_FREEZE_PATH) !== ACQUISITION_FREEZE_SHA256) throw new Error('Immutable acquisition freeze hash mismatch')
	mkdirSync(resolve(DATA_DIR), { recursive: true })

	const loaded: Array<{ symbol: string; path: string; candles: Candle[]; audit: CandleAudit; funding: SettledFunding[]; fundingAudit: FundingAudit; fundingPath: string; fundingHash: string; requestedFrom: number; requestedUntil: number }> = []
	for (const series of SERIES) {
		if (fileHash(series.path) !== series.sha256) throw new Error(`${series.symbol}: candle SHA-256 mismatch`)
		const { candles, audit } = parseAndAuditOwn2Csv(readFileSync(resolve(series.path), 'utf8'))
		if (audit.rows !== 23_104 || audit.malformedRows || !audit.monotonic || audit.duplicateTimestamps || audit.missingHourlyBars || audit.irregularIntervals || audit.ohlcInvalid || audit.volumeInvalid || !audit.exactHourAligned) throw new Error(`${series.symbol}: candle integrity gate failed: ${JSON.stringify(audit)}`)
		const requestedFrom = candles[0]!.timestamp - DAY
		const requestedUntil = candles.at(-1)!.timestamp + HOUR
		const funding = await fetchFundingHistory(series.symbol, requestedFrom, requestedUntil, { cacheDir: resolve('tmp/own2-funding-sign-btc-eth-sol-cache'), preferApi: true }) as SettledFunding[]
		const fundingAudit = auditFunding(funding)
		if (!funding.length || !fundingAudit.sorted || fundingAudit.duplicateTimestamps || fundingAudit.conflictingDuplicates) throw new Error(`${series.symbol}: funding integrity gate failed`)
		const fundingPath = `${DATA_DIR}/${series.symbol}-funding.json`
		const text = `${JSON.stringify({ schemaVersion: 1, source: 'Binance USD-M /fapi/v1/fundingRate', symbol: series.symbol, requestedInterval: { fromInclusiveUtc: iso(requestedFrom), untilExclusiveUtc: iso(requestedUntil) }, rows: funding }, null, 2)}\n`
		writeFileSync(resolve(fundingPath), text)
		loaded.push({ symbol: series.symbol, path: series.path, candles, audit, funding, fundingAudit, fundingPath, fundingHash: sha256(text), requestedFrom, requestedUntil })
	}
	const firstSets = loaded.map((x) => x.candles[0]!.timestamp), lastSets = loaded.map((x) => x.candles.at(-1)!.timestamp)
	const commonFrom = Math.max(...firstSets), commonUntil = Math.min(...lastSets)
	const timestampAlignment = loaded.every((x) => x.candles.length === loaded[0]!.candles.length && x.candles.every((c, i) => c.timestamp === loaded[0]!.candles[i]!.timestamp))
	if (!timestampAlignment) throw new Error('Cross-symbol candle timestamps are not exactly aligned')
	const dataManifest = {
		schemaVersion: 1, generatedBeforeOutcomeComputation: true, officialSource: 'https://fapi.binance.com/fapi/v1/fundingRate',
		preregistration: { path: PREREG_PATH, sha256: PREREG_SHA256 }, acquisitionFreeze: { path: ACQUISITION_FREEZE_PATH, sha256: ACQUISITION_FREEZE_SHA256 },
		frozenCutoffUtc: iso(CUTOFF), commonOverlap: { fromUtc: iso(commonFrom), untilUtcInclusive: iso(commonUntil), exactTimestampAlignment: timestampAlignment },
		series: loaded.map((x) => ({ symbol: x.symbol, candle: { path: x.path, sha256: fileHash(x.path), ...x.audit }, funding: { path: x.fundingPath, sha256: x.fundingHash, requestedFromUtc: iso(x.requestedFrom), requestedUntilExclusiveUtc: iso(x.requestedUntil), ...x.fundingAudit } })),
	}
	writeFileSync(resolve(DATA_MANIFEST_PATH), `${JSON.stringify(dataManifest, null, 2)}\n`)
	const dataManifestHashBeforeOutcomes = fileHash(DATA_MANIFEST_PATH)

	// Outcome computation starts only below this line, after immutable prereg/acquisition hashes and acquired-data manifest exist.
	const all: EconomicRow[] = []; const countsBySymbol: Record<string, object> = {}
	for (const item of loaded) {
		const bands = computeApexBands(item.candles)
		const detection = detectArrowSignalsFromBands(item.candles, bands, { warmupBars: 200, relativeVolumePeriod: 20, minimumRelativeVolume: 1.4, minimumDistanceMeanPct: 3, minimumPenetrationInner: -0.35 })
		const replay0 = replayArrowSignals(item.candles, bands, detection.candidates, 'safe', { oneWayCostBps: 0 })
		const replay5 = replayArrowSignals(item.candles, bands, detection.candidates, 'safe', { oneWayCostBps: 5 })
		if (replay0.trades.length !== replay5.trades.length || replay0.trades.some((x, i) => x.signalAt !== replay5.trades[i]?.signalAt)) throw new Error(`${item.symbol}: costs changed opportunities`)
		const holdout = replay5.trades.map((trade, index) => ({ trade, zero: replay0.trades[index]! })).filter((x) => x.trade.signalAt >= CUTOFF)
		for (const { trade, zero } of holdout) {
			const decision = decideFundingSign(trade.side, trade.signalAt, item.funding)
			const fundingR = fundingContributionR(trade, item.funding)
			all.push({ symbol: item.symbol, decisionAt: trade.signalAt, side: trade.side, trade, priceGrossR: zero.grossR, costR: trade.costR, fundingR, netR: trade.netR + fundingR, retained: decision.decision === 'retain', decision: decision.decision, ageHours: decision.ageMs == null ? null : decision.ageMs / HOUR })
		}
		countsBySymbol[item.symbol] = { rawCandidatesAll: detection.candidates.length, rawCandidatesHoldout: detection.candidates.filter((x) => x.signalAt >= CUTOFF).length, admittedTradesAll: replay5.trades.length, admittedBaselineHoldout: holdout.length }
	}
	const retained = all.filter((x) => x.retained), vetoed = all.filter((x) => !x.retained)
	const baseline0 = (x: EconomicRow): number => x.priceGrossR + x.fundingR
	const baseline5 = (x: EconomicRow): number => x.netR
	const filtered0 = (x: EconomicRow): number => x.retained ? baseline0(x) : 0
	const filtered5 = (x: EconomicRow): number => x.retained ? baseline5(x) : 0
	const paired: PairedOpportunity[] = all.map((x) => ({ symbol: x.symbol, timeframe: '1h', decisionAt: x.decisionAt, baselineNetR: x.netR, filteredNetR: filtered5(x), retained: x.retained }))
	const bootstrap = pairedUtcDayClusterBootstrap(paired, SAMPLES, SEED)
	const deltaTotal = sum(paired.map((x) => x.filteredNetR - x.baselineNetR)); const deltaMean = all.length ? deltaTotal / all.length : 0
	const perSymbol = Object.fromEntries(SERIES.map(({ symbol }) => {
		const rows = all.filter((x) => x.symbol === symbol), keep = rows.filter((x) => x.retained), reject = rows.filter((x) => !x.retained)
		const delta = sum(rows.map((x) => filtered5(x) - baseline5(x))) / (rows.length || 1)
		return [symbol, { counts: countsBySymbol[symbol], retained: keep.length, vetoed: reject.length, baseline: { gross0: metrics(rows, baseline0), net5: metrics(rows, baseline5) }, filtered: { gross0PerOpportunity: metrics(rows, filtered0, rows.length, keep), net5PerOpportunity: metrics(rows, filtered5, rows.length, keep), net5Executed: metrics(keep, baseline5, rows.length) }, retainedCounterfactual: metrics(keep, baseline5, rows.length), vetoedCounterfactual: metrics(reject, baseline5, rows.length), pairedDeltaMeanPerOpportunity: delta, improved: delta > 0, bySideBaseline: breakdown(rows, rows.length), bySideRetained: breakdown(keep, rows.length), concentrationBaseline: concentration(rows), concentrationRetained: concentration(keep), latestRateAgeHours: { min: quantile(rows.flatMap((x) => x.ageHours == null ? [] : [x.ageHours]), 0), median: quantile(rows.flatMap((x) => x.ageHours == null ? [] : [x.ageHours]), 0.5), p90: quantile(rows.flatMap((x) => x.ageHours == null ? [] : [x.ageHours]), 0.9), max: quantile(rows.flatMap((x) => x.ageHours == null ? [] : [x.ageHours]), 1) } }]
	}))
	const breadth = Object.values(perSymbol).filter((x) => (x as { improved: boolean }).improved).length
	const decisions = Object.fromEntries(['retain', 'veto-sign', 'veto-zero', 'veto-missing'].map((d) => [d, all.filter((x) => x.decision === d).length]))
	const ages = all.flatMap((x) => x.ageHours == null ? [] : [x.ageHours])
	const gates = { baselineOpportunities: all.length >= 250, retainedTrades: retained.length >= 100, filteredNetExpectancyPositive: (metrics(retained, baseline5, all.length).meanR ?? -Infinity) > 0, pairedCiLowerPositive: bootstrap.lower > 0, breadthAtLeastTwoOfThree: breadth >= 2 }
	const nFail = !gates.baselineOpportunities || !gates.retainedTrades
	const verdict = nFail ? 'INCONCLUSIVE DATA' : Object.values(gates).every(Boolean) ? 'GO' : 'KILL'
	const result = {
		schemaVersion: 1, verdict, frozenRuleChangedAfterReveal: false, independence: { protocolHoldout: true, globallyUntouchedGuaranteed: false, note: 'Chronological tail is held out within this frozen corpus, but BTC/ETH/SOL and overlapping dates may have appeared in earlier project research.' },
		provenance: { preregistrationSha256: PREREG_SHA256, acquisitionFreezeSha256: ACQUISITION_FREEZE_SHA256, acquiredDataManifestSha256BeforeOutcomes: dataManifestHashBeforeOutcomes, dataManifestPath: DATA_MANIFEST_PATH },
		config: { universe: SERIES.map((x) => x.symbol), timeframe: '1h', cutoffUtc: iso(CUTOFF), own2: { warmupBars: 200, relativeVolumePeriod: 20, minimumRelativeVolume: 1.4, minimumDistanceMeanPct: 3, minimumPenetrationInner: -0.35 }, management: 'safe', costsBpsPerSidePrimary: 5, grossDiagnosticBps: 0, filter: 'long rate<0; short rate>0; zero/missing veto; latest settlement strictly before decision', bootstrap: { cluster: 'joint UTC day', samples: SAMPLES, seed: SEED } },
		counts: { bySymbol: countsBySymbol, pooledBaselineOpportunities: all.length, pooledBaselineExecutedTrades: all.length, retained: retained.length, vetoed: vetoed.length, retainedRate: all.length ? retained.length / all.length : 0, decisions },
		aggregate: { baseline: { gross0: metrics(all, baseline0), net5: metrics(all, baseline5) }, filtered: { gross0PerBaselineOpportunity: metrics(all, filtered0, all.length, retained), net5PerBaselineOpportunity: metrics(all, filtered5, all.length, retained), net5ExecutedRetainedOnly: metrics(retained, baseline5, all.length) }, retainedBaselineCounterfactual: metrics(retained, baseline5, all.length), vetoedBaselineCounterfactual: metrics(vetoed, baseline5, all.length), paired: { deltaTotalR: deltaTotal, deltaMeanRPerBaselineOpportunity: deltaMean, ci95: bootstrap }, fundingAndAge: { baselineFundingR: sum(all.map((x) => x.fundingR)), retainedFundingR: sum(retained.map((x) => x.fundingR)), baselineCostsR: sum(all.map((x) => x.costR)), retainedCostsR: sum(retained.map((x) => x.costR)), latestRateAgeHours: { min: quantile(ages, 0), median: quantile(ages, 0.5), p90: quantile(ages, 0.9), max: quantile(ages, 1) } }, bySideBaseline: breakdown(all, all.length), bySideRetained: breakdown(retained, all.length), concentrationBaseline: concentration(all), concentrationRetained: concentration(retained) },
		perSymbol, breadth: { improvedSymbols: breadth, required: 2, total: 3 }, gates,
		limitations: ['Protocol holdout is not guaranteed globally untouched because dates/assets overlap earlier research.', 'Only three large-cap perpetual symbols and one timeframe are tested.', 'Bootstrap clusters UTC days but cannot manufacture cross-universe independence.', 'No post-reveal retuning or subgroup rescue is permitted.'],
	}
	writeFileSync(resolve(RESULT_JSON_PATH), `${JSON.stringify(result, null, 2)}\n`)

	const bn = result.aggregate.baseline.net5, fn = result.aggregate.filtered.net5ExecutedRetainedOnly, fo = result.aggregate.filtered.net5PerBaselineOpportunity
	const lines = [
		'# OWN2 + funding-sign — BTC/ETH/SOL perpetual 1h frozen holdout', '', `# Вердикт: \`${verdict}\``, '',
		'## Простыми словами',
		`Проверено заранее замороженное правило: OWN2-сделки LONG разрешались только после отрицательного funding, SHORT — только после положительного. Все остальные baseline-возможности получали нулевую экспозицию в filtered-руке. Порог relVol=1.4 передан детектору явно; vendor GGI lines/shapes не читались как признаки или метки.`,
		`Последние 35% общего календаря — честный protocol holdout этого запуска. Но это не обязательно globally untouched окно: BTC/ETH/SOL и пересекающиеся даты уже могли встречаться в прежних исследованиях. Поэтому даже положительный результат был бы слабее полностью нового внешнего корпуса.`, '',
		'## Данные и честность',
		`- Preregistration SHA-256: \`${PREREG_SHA256}\`.`, `- Pre-outcome acquisition manifest SHA-256: \`${ACQUISITION_FREEZE_SHA256}\`.`, `- Acquired-data manifest SHA-256 before outcomes: \`${dataManifestHashBeforeOutcomes}\`.`,
		`- Common exact timestamps: ${timestampAlignment}; overlap ${iso(commonFrom)} — ${iso(commonUntil)}; cutoff ${iso(CUTOFF)}.`,
		`- Candle QA and official funding QA: \`${DATA_MANIFEST_PATH}\`; no interpolation or assumed cadence.`, '',
		'## Поток наблюдений',
		`- Pooled admitted baseline holdout opportunities/trades: ${all.length}/${all.length}.`, `- Retained: ${retained.length}; vetoed: ${vetoed.length}; retained rate ${(result.counts.retainedRate * 100).toFixed(2)}%.`, `- Funding decisions: ${JSON.stringify(decisions)}.`,
		...SERIES.map(({ symbol }) => `- ${symbol}: ${JSON.stringify(countsBySymbol[symbol])}; retained ${(perSymbol[symbol] as { retained: number }).retained}, vetoed ${(perSymbol[symbol] as { vetoed: number }).vetoed}.`), '',
		'## Aggregate economics', '| arm | N | totalR | meanR/trade | meanR/baseline-opportunity | PF | WR | maxDD | fundingR | costsR | mean/median holding bars |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
		`| baseline gross 0 bps + actual funding | ${result.aggregate.baseline.gross0.n} | ${fmt(result.aggregate.baseline.gross0.totalR)} | ${fmt(result.aggregate.baseline.gross0.meanR)} | ${fmt(result.aggregate.baseline.gross0.meanPerBaselineOpportunity)} | ${fmt(result.aggregate.baseline.gross0.pf)} | ${fmt(result.aggregate.baseline.gross0.wr)} | ${fmt(result.aggregate.baseline.gross0.maxDdR)} | ${fmt(result.aggregate.baseline.gross0.fundingR)} | 0 | ${fmt(result.aggregate.baseline.gross0.meanHoldingBars, 2)}/${fmt(result.aggregate.baseline.gross0.medianHoldingBars, 2)} |`,
		`| baseline net 5 bps + actual funding | ${bn.n} | ${fmt(bn.totalR)} | ${fmt(bn.meanR)} | ${fmt(bn.meanPerBaselineOpportunity)} | ${fmt(bn.pf)} | ${fmt(bn.wr)} | ${fmt(bn.maxDdR)} | ${fmt(bn.fundingR)} | ${fmt(bn.costsR)} | ${fmt(bn.meanHoldingBars, 2)}/${fmt(bn.medianHoldingBars, 2)} |`,
		`| filtered net 5 bps, veto=0 per opportunity | ${fo.n} | ${fmt(fo.totalR)} | ${fmt(fo.meanR)} | ${fmt(fo.meanPerBaselineOpportunity)} | ${fmt(fo.pf)} | ${fmt(fo.wr)} | ${fmt(fo.maxDdR)} | ${fmt(fo.fundingR)} | ${fmt(fo.costsR)} | ${fmt(fo.meanHoldingBars, 2)}/${fmt(fo.medianHoldingBars, 2)} |`,
		`| filtered retained executed only | ${fn.n} | ${fmt(fn.totalR)} | ${fmt(fn.meanR)} | ${fmt(fn.meanPerBaselineOpportunity)} | ${fmt(fn.pf)} | ${fmt(fn.wr)} | ${fmt(fn.maxDdR)} | ${fmt(fn.fundingR)} | ${fmt(fn.costsR)} | ${fmt(fn.meanHoldingBars, 2)}/${fmt(fn.medianHoldingBars, 2)} |`, '',
		'## Per symbol (net 5 bps + actual funding)', '| symbol | baseline N | retained | baseline total/mean | filtered total/mean executed | filtered mean/opportunity | paired delta/opportunity | improved |', '|---|---:|---:|---:|---:|---:|---:|---|',
		...SERIES.map(({ symbol }) => { const x = perSymbol[symbol] as any; return `| ${symbol} | ${x.baseline.net5.n} | ${x.retained} | ${fmt(x.baseline.net5.totalR)}/${fmt(x.baseline.net5.meanR)} | ${fmt(x.filtered.net5Executed.totalR)}/${fmt(x.filtered.net5Executed.meanR)} | ${fmt(x.filtered.net5PerOpportunity.meanPerBaselineOpportunity)} | ${fmt(x.pairedDeltaMeanPerOpportunity)} | ${x.improved ? 'yes' : 'no'} |` }), '',
		'## Paired inference and gates', `- Paired delta: total ${fmt(deltaTotal)}R; mean ${fmt(deltaMean)}R per baseline opportunity.`, `- Joint UTC-day bootstrap CI95: [${fmt(bootstrap.lower)}, ${fmt(bootstrap.upper)}], median ${fmt(bootstrap.median)} (10k, seed 25082026).`, `- Improvement breadth: ${breadth}/3 symbols.`,
		`- Gates: ${JSON.stringify(gates)}.`, `- Frozen classification: **${verdict}**.`, '',
		'## Counterfactuals, sides, concentration and rate age',
		`- Retained baseline counterfactual: ${JSON.stringify(result.aggregate.retainedBaselineCounterfactual)}.`, `- Vetoed baseline counterfactual: ${JSON.stringify(result.aggregate.vetoedBaselineCounterfactual)}.`, `- Baseline long/short: ${JSON.stringify(result.aggregate.bySideBaseline)}.`, `- Retained long/short: ${JSON.stringify(result.aggregate.bySideRetained)}.`, `- Concentration baseline: ${JSON.stringify(result.aggregate.concentrationBaseline)}.`, `- Concentration retained: ${JSON.stringify(result.aggregate.concentrationRetained)}.`, `- Latest settled-rate age hours: ${JSON.stringify(result.aggregate.fundingAndAge.latestRateAgeHours)}.`, '',
		'## Интерпретация и ограничения',
		verdict === 'GO' ? 'Filtered-рука положительна, paired CI исключает ноль, breadth и N gates пройдены: все frozen условия GO выполнены. Это подтверждение только в рамках данного protocol holdout, не гарантия production и не полностью внешний глобальный OOS.' : verdict === 'INCONCLUSIVE DATA' ? 'Размер выборки не прошёл заранее заданный N gate. По протоколу экономический знак не превращается ни в GO, ни в KILL: данных недостаточно.' : 'Хотя фильтр мог улучшить отдельные point estimates, хотя бы один обязательный не-N gate не пройден. По заранее замороженному правилу это KILL: funding-sign не доказал положительный и статистически устойчивый edge.',
		'Не сравниваем recall с expectancy: здесь вопрос только в деньгах на baseline opportunities. Нельзя ретюнить magnitude/z-score/age/side/symbol, исключать проигравший symbol или искать rescue на раскрытом holdout.', '',
		'## Что дальше / чего не делать',
		verdict === 'GO' ? '- Следующий честный шаг: новая globally untouched all-perpetual корзина/период с новой preregistration; до неё production NO-GO.' : '- Не спасать правило подбором порогов на этих outcomes. Возврат возможен только с новой заранее мотивированной гипотезой и новым независимым корпусом.',
		'- Сохранить JSON как полный machine-readable audit; этот Markdown — человекочитаемое объяснение.',
	]
	writeFileSync(resolve(RESULT_MD_PATH), `${lines.join('\n')}\n`)
	console.log(lines.slice(0, 45).join('\n'))
}

const isDirectRun = process.argv[1] != null && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
if (isDirectRun) void main()
