import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'
import { fetchFundingHistory } from '../../tools/shared/fundingFetcher.js'
import { auditSettlements, calendarSplitCutoff, clusterBootstrap, equalSymbolMean, replayFundingOnly, summarizeFundingTrades, type FundingArm, type FundingSettlement, type FundingTrade } from './lib/fundingOnlyResearch.js'

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'] as const
const ARMS: FundingArm[] = ['CONTRARIAN', 'CONTINUATION']
const COSTS = [0, 5] as const
// SOLUSDT is the latest-listed frozen symbol; begin at its launch month for a common universe window.
const FROM = Date.UTC(2020, 8, 1)
// Last fully immutable monthly archive boundary; avoids mixing incomplete daily/API tails.
const UNTIL = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)
const SEED = 24082026
const SAMPLES = 10_000
const DATA_DIR = join(process.cwd(), 'data', 'funding-only')
const RESULT_JSON = join(process.cwd(), 'ci-results', 'funding-only-results.json')
const RESULT_MD = join(process.cwd(), 'ci-results', 'funding-only-results.md')
const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const iso = (x: number) => new Date(x).toISOString()

function pairedRows(primary: readonly FundingTrade[], control: readonly FundingTrade[]): FundingTrade[] {
	const controlByKey = new Map(control.map((t) => [`${t.symbol}|${t.decisionAt}`, t]))
	return primary.flatMap((t) => { const c = controlByKey.get(`${t.symbol}|${t.decisionAt}`); return c ? [{ ...t, netReturn: t.netReturn - c.netReturn }] : [] })
}

async function main(): Promise<void> {
	mkdirSync(DATA_DIR, { recursive: true }); mkdirSync(join(process.cwd(), 'ci-results'), { recursive: true })
	const acquired: Record<string, { settlements: FundingSettlement[]; marks: Array<{ timestamp: number; markPrice: number }>; audit: ReturnType<typeof auditSettlements>['audit'] }> = {}
	for (const symbol of SYMBOLS) {
		const [funding, candles] = await Promise.all([
			fetchFundingHistory(symbol, FROM, UNTIL, { cacheDir: join(process.cwd(), 'tmp', 'funding-only-cache') }),
			fetchArchiveKlines(symbol, '1h', 'futures', FROM, UNTIL, { parallel: 8 }),
		])
		const audited = auditSettlements(funding)
		if (audited.audit.conflictingDuplicates > 0) throw new Error(`${symbol}: conflicting funding duplicates`)
		const marks = candles.map((c) => ({ timestamp: c.timestamp, markPrice: c.open }))
		if (audited.rows.length < 2 || marks.length < 2) throw new Error(`${symbol}: official source returned insufficient data`)
		acquired[symbol] = { settlements: audited.rows, marks, audit: audited.audit }
	}
	const commonFrom = Math.max(...SYMBOLS.map((s) => acquired[s]!.settlements[0]!.timestamp))
	const commonUntil = Math.min(...SYMBOLS.map((s) => acquired[s]!.settlements.at(-1)!.timestamp))
	const files: Record<string, unknown> = {}
	for (const symbol of SYMBOLS) {
		const source = acquired[symbol]!
		const payload = { symbol, funding: source.settlements.filter((x) => x.timestamp >= commonFrom && x.timestamp <= commonUntil), executionPrice1h: source.marks.filter((x) => x.timestamp >= commonFrom && x.timestamp <= commonUntil + 7_200_000) }
		const text = `${JSON.stringify(payload)}\n`; const path = join(DATA_DIR, `${symbol}.json`); writeFileSync(path, text)
		files[symbol] = { path: `data/funding-only/${symbol}.json`, sha256: sha256(text), fundingRows: payload.funding.length, executionRows: payload.executionPrice1h.length, fundingFromUtc: iso(payload.funding[0]!.timestamp), fundingUntilUtc: iso(payload.funding.at(-1)!.timestamp), executionFromUtc: iso(payload.executionPrice1h[0]!.timestamp), executionUntilUtc: iso(payload.executionPrice1h.at(-1)!.timestamp), qa: source.audit }
	}
	const all: FundingTrade[] = []
	for (const symbol of SYMBOLS) {
		const payload = JSON.parse(readFileSync(join(DATA_DIR, `${symbol}.json`), 'utf8')) as { funding: FundingSettlement[]; executionPrice1h: Array<{ timestamp: number; markPrice: number }> }
		for (const cost of COSTS) for (const arm of ARMS) all.push(...replayFundingOnly(symbol, payload.funding, payload.executionPrice1h, arm, cost).map((t) => ({ ...t, feeReturn: t.feeReturn + cost * 0 })))
	}
	const basis = all.filter((t) => t.arm === 'CONTRARIAN' && t.feeReturn === 0)
	const cutoff = calendarSplitCutoff(Object.fromEntries(SYMBOLS.map((s) => [s, basis.filter((t) => t.symbol === s).map((t) => t.decisionAt)])), 0.65)
	const tables: Record<string, unknown> = {}
	for (const split of ['development', 'oos'] as const) for (const cost of COSTS) for (const arm of ARMS) {
		const rows = all.filter((t) => t.arm === arm && Math.round(t.feeReturn * 5_000) === cost && (split === 'development' ? t.decisionAt < cutoff : t.decisionAt >= cutoff))
		tables[`${split}|${cost}|${arm}`] = { equalSymbolMean: equalSymbolMean(rows, SYMBOLS), aggregate: summarizeFundingTrades(rows), bySymbol: Object.fromEntries(SYMBOLS.map((s) => [s, summarizeFundingTrades(rows.filter((t) => t.symbol === s))])) }
	}
	const primary = all.filter((t) => t.arm === 'CONTRARIAN' && Math.round(t.feeReturn * 5_000) === 5 && t.decisionAt >= cutoff)
	const control = all.filter((t) => t.arm === 'CONTINUATION' && Math.round(t.feeReturn * 5_000) === 5 && t.decisionAt >= cutoff)
	const paired = pairedRows(primary, control)
	const primaryCi = clusterBootstrap(primary, SYMBOLS, SAMPLES, SEED)
	const pairedCi = clusterBootstrap(paired, SYMBOLS, SAMPLES, SEED, (rows) => equalSymbolMean(rows, SYMBOLS))
	const counts = Object.fromEntries(SYMBOLS.map((s) => [s, primary.filter((t) => t.symbol === s).length]))
	const pooled = primary.length; const breadth = SYMBOLS.filter((s) => summarizeFundingTrades(primary.filter((t) => t.symbol === s)).mean > 0).length
	const eventGate = pooled >= 750 && SYMBOLS.every((s) => counts[s]! >= 250)
	const verdict = !eventGate ? 'INCONCLUSIVE DATA' : primaryCi.lower > 0 && pairedCi.lower > 0 && breadth >= 2 ? 'GO' : 'KILL'
	const prereg = readFileSync(join(process.cwd(), 'ci-results', 'funding-only-preregistration.md'))
	const manifest = { schemaVersion: 1, frozenUniverse: SYMBOLS, officialSources: { funding: 'https://fapi.binance.com/fapi/v1/fundingRate (paginated)', execution: 'https://data.binance.vision/data/futures/um/{monthly,daily}/klines/{symbol}/1h/ (contract-price open; first observation strictly after settlement)' }, requestedFromUtc: iso(FROM), acquiredUntilExclusiveUtc: iso(UNTIL), commonFromUtc: iso(commonFrom), commonUntilUtc: iso(commonUntil), splitCutoffUtc: iso(cutoff), preregistrationPath: 'ci-results/funding-only-preregistration.md', preregistrationSha256: sha256(prereg), files }
	writeFileSync(join(DATA_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
	const result = { verdict, generatedAtUtc: new Date().toISOString(), manifest, gates: { minimumOosTradesPerSymbol: 250, minimumOosTradesPooled: 750, minimumPositiveBreadth: 2, counts, pooled, breadth, eventGate, primaryCi, pairedCi, primaryCiLowerPositive: primaryCi.lower > 0, pairedCiLowerPositive: pairedCi.lower > 0 }, bootstrap: { cluster: 'UTC decision-settlement day, joint symbols/arms', samples: SAMPLES, seed: SEED }, tables }
	writeFileSync(RESULT_JSON, `${JSON.stringify(result, null, 2)}\n`)
	const p = tables['oos|5|CONTRARIAN'] as { equalSymbolMean: number; aggregate: ReturnType<typeof summarizeFundingTrades> }
	const lines = [`# Funding-only research — frozen OOS result`, ``, `**Verdict: ${verdict}**`, ``, `- Common history: ${iso(commonFrom)} — ${iso(commonUntil)}`, `- Common 65/35 cutoff: ${iso(cutoff)}`, `- OOS trades: ${pooled} (${SYMBOLS.map((s) => `${s} ${counts[s]}`).join(', ')})`, `- CONTRARIAN @5 bps/side equal-symbol mean: ${(p.equalSymbolMean * 10_000).toFixed(4)} bps/trade`, `- Aggregate diagnostic mean: ${(p.aggregate.mean * 10_000).toFixed(4)} bps/trade; PF ${p.aggregate.profitFactor?.toFixed(4) ?? '∞'}; WR ${(p.aggregate.winRate * 100).toFixed(2)}%; max DD ${(p.aggregate.maxDrawdown * 100).toFixed(2)}% fixed-notional`, `- Decomposition: price ${(p.aggregate.priceMean * 10_000).toFixed(4)} bps, funding ${(p.aggregate.fundingMean * 10_000).toFixed(4)} bps, fees ${(p.aggregate.feeMean * 10_000).toFixed(4)} bps/trade`, `- Holding mean: ${p.aggregate.meanHoldingHours.toFixed(2)} h; continuous compounded diagnostic: ${p.aggregate.continuousEquity.toFixed(6)}`, `- Primary cluster CI95: [${(primaryCi.lower * 10_000).toFixed(4)}, ${(primaryCi.upper * 10_000).toFixed(4)}] bps`, `- Paired CONTRARIAN−CONTINUATION CI95: [${(pairedCi.lower * 10_000).toFixed(4)}, ${(pairedCi.upper * 10_000).toFixed(4)}] bps`, `- Breadth: ${breadth}/3 positive symbols`, ``, `No Sharpe is reported. Full development/OOS × arm × cost metrics and provenance are in funding-only-results.json and data/funding-only/manifest.json.`]
	writeFileSync(RESULT_MD, `${lines.join('\n')}\n`); console.log(lines.join('\n'))
}

if (process.argv[1]?.endsWith('runFundingOnlyResearch.ts')) void main()
