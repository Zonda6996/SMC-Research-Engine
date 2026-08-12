import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseExactIndicatorCsv, sha256File, type ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import { trueRangeSma, validGgiBand, type CorrectedGgiSide } from './lib/ggiCorrectedReplay.js'
import { replayDm3Trade, WARMUP, type Dm3Trade } from './runDm3StaticExit.js'
import { bodySma20 } from './runOwn1Generator.js'

export const OWN2_VERSION = 'ggi-own2-expectancy-ranker-v1'
export const OWN2_COST_BPS_PER_SIDE = 6
export const OWN2_PRIOR_WEIGHT = 15
export const OWN2_RETENTIONS = [0.10, 0.20, 0.35] as const
export const OWN2_COOLDOWN = 20
export const OWN2_DROUGHT = 8
export const OWN2_FIT = 0.50
export const OWN2_VALIDATION = 0.20
export const OWN2_FEATURE_NAMES = [
	'bodyRatio', 'episodeAge', 'recoveryInner', 'directionalCloseLocation',
	'meanGapInner', 'innerWidthRatio', 'extensionRatio', 'directionalMeanSlope',
] as const
export type Own2FeatureName = (typeof OWN2_FEATURE_NAMES)[number]
export interface Candidate { idx: number; side: CorrectedGgiSide; features: Record<Own2FeatureName, number> }
export interface TradeEval { candidate: Candidate; trade: Dm3Trade | null; grossR: number | null; netR: number | null }
export interface Own2Model { cuts: Record<Own2FeatureName, number[]>; values: Record<Own2FeatureName, number[]>; globalMean: number }
export interface Own2Summary { signals: number; closed: number; meanGrossR: number | null; meanNetR: number | null; pfNet: number | null; winRate: number | null; partial: number; stop: number; full: number; best1RemovedNetR: number | null }

function mean(xs: readonly number[]): number | null { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null }
function quantile(xs: readonly number[], p: number): number { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]! }
function pf(xs: readonly number[]): number | null { const w = xs.filter((x) => x > 0).reduce((a, b) => a + b, 0); const l = Math.abs(xs.filter((x) => x < 0).reduce((a, b) => a + b, 0)); return l ? w / l : w ? Infinity : null }
function percentileBin(value: number, cuts: readonly number[]): number { let b = 0; while (b < cuts.length && value > cuts[b]!) b++; return b }
function side(row: ExactIndicatorRow): CorrectedGgiSide | null {
	if (row.close < row.mean && row.close > row.open) return 1
	if (row.close > row.mean && row.close < row.open) return -1
	return null
}
function signRelative(s: CorrectedGgiSide, x: number): number { return s === 1 ? x : -x }
function safeRatio(x: number, d: number): number { return Number.isFinite(x) && Number.isFinite(d) && Math.abs(d) > Number.EPSILON ? x / d : 0 }

export function own2Candidates(rows: readonly ExactIndicatorRow[], tr55: readonly (number | null)[], body: readonly (number | null)[], from = 0, to = rows.length): Candidate[] {
	const out: Candidate[] = []
	let lastTouch = -1e9
	let longExtreme = Number.POSITIVE_INFINITY
	let shortExtreme = Number.NEGATIVE_INFINITY
	let longPreviousExtension = 0
	let longCurrentExtension = 0
	let shortPreviousExtension = 0
	let shortCurrentExtension = 0
	for (let i = 0; i < Math.min(to, rows.length); i++) {
		const r = rows[i]!
		if (!validGgiBand(r)) continue
		const touched = r.low <= r.mean && r.mean <= r.high
		if (touched) {
			lastTouch = i
			longExtreme = Number.POSITIVE_INFINITY
			shortExtreme = Number.NEGATIVE_INFINITY
			longPreviousExtension = 0
			longCurrentExtension = 0
			shortPreviousExtension = 0
			shortCurrentExtension = 0
		} else {
			if (r.low < longExtreme) {
				longPreviousExtension = longCurrentExtension
				longCurrentExtension = longExtreme === Number.POSITIVE_INFINITY ? 0 : longExtreme - r.low
				longExtreme = r.low
			}
			if (r.high > shortExtreme) {
				shortPreviousExtension = shortCurrentExtension
				shortCurrentExtension = shortExtreme === Number.NEGATIVE_INFINITY ? 0 : r.high - shortExtreme
				shortExtreme = r.high
			}
		}
		if (i < Math.max(WARMUP, from) || i >= rows.length - 1 || tr55[i] == null || body[i] == null || body[i]! <= 0) continue
		const direction = side(r)
		const candleBody = Math.abs(r.close - r.open)
		if (direction == null || i - lastTouch < OWN2_DROUGHT || candleBody < 0.75 * body[i]!) continue
		const width = direction === 1 ? r.mean - r.lowerInner : r.upperInner - r.mean
		const range = Math.max(r.high - r.low, Number.EPSILON)
		const extreme = direction === 1 ? longExtreme : shortExtreme
		const recovery = direction === 1 ? (r.close - extreme) / Math.max(width, Number.EPSILON) : (extreme - r.close) / Math.max(width, Number.EPSILON)
		const gap = direction === 1 ? (r.mean - r.close) / Math.max(width, Number.EPSILON) : (r.close - r.mean) / Math.max(width, Number.EPSILON)
		const innerWidth = r.upperInner - r.lowerInner
		const priorStart = Math.max(WARMUP, i - 20)
		const priorWidths = rows.slice(priorStart, i).filter(validGgiBand).map((x) => x.upperInner - x.lowerInner)
		const avgWidth = mean(priorWidths) ?? innerWidth
		const slope = i >= 3 ? (r.mean - rows[i - 3]!.mean) / Math.max(tr55[i]!, Number.EPSILON) : 0
		const previousExtension = direction === 1 ? longPreviousExtension : shortPreviousExtension
		const currentExtension = direction === 1 ? longCurrentExtension : shortCurrentExtension
		out.push({ idx: i, side: direction, features: {
			bodyRatio: Math.min(8, candleBody / Math.max(body[i]!, Number.EPSILON)),
			episodeAge: Math.min(100, i - lastTouch),
			recoveryInner: Math.max(-4, Math.min(8, recovery)),
			directionalCloseLocation: direction === 1 ? (r.close - r.low) / range : (r.high - r.close) / range,
			meanGapInner: Math.max(-4, Math.min(8, gap)),
			innerWidthRatio: Math.max(0.1, Math.min(10, safeRatio(innerWidth, avgWidth))),
			extensionRatio: previousExtension > 0 ? Math.max(0, Math.min(5, safeRatio(currentExtension, previousExtension))) : 0,
			directionalMeanSlope: Math.max(-5, Math.min(5, signRelative(direction, slope))),
		} })
	}
	return out
}

function netFromGross(rows: readonly ExactIndicatorRow[], tr55: readonly (number | null)[], c: Candidate, gross: number): number | null {
	const entry = rows[c.idx + 1]; const vol = tr55[c.idx]
	if (!entry || vol == null || vol <= 0 || entry.open <= 0) return null
	const riskPct = vol * 12 / entry.open * 100
	return gross - (OWN2_COST_BPS_PER_SIDE * 2 / 100) / riskPct
}
function evaluate(rows: readonly ExactIndicatorRow[], tr55: readonly (number | null)[], candidates: readonly Candidate[]): TradeEval[] {
	return candidates.map((candidate) => { const trade = replayDm3Trade(rows, tr55, candidate.idx, candidate.side, 'V2_movP_staticTPwick'); const grossR = trade && trade.outcome !== 'End mark' ? trade.grossR : null; return { candidate, trade, grossR, netR: grossR == null ? null : netFromGross(rows, tr55, candidate, grossR) } })
}
export function fitOwn2Model(candidates: readonly Candidate[], evals: readonly TradeEval[]): Own2Model {
	const usable = evals.filter((x) => x.netR != null)
	const globalMean = mean(usable.map((x) => x.netR!)) ?? 0
	const cuts = {} as Record<Own2FeatureName, number[]>; const values = {} as Record<Own2FeatureName, number[]>
	for (const name of OWN2_FEATURE_NAMES) {
		const xs = candidates.map((c) => c.features[name]).filter(Number.isFinite)
		cuts[name] = [0.2, 0.4, 0.6, 0.8].map((p) => quantile(xs, p))
		values[name] = Array.from({ length: 5 }, (_, bin) => {
			const ys = usable.filter((x) => percentileBin(x.candidate.features[name], cuts[name]!) === bin).map((x) => x.netR!)
			return (ys.reduce((a, b) => a + b, 0) + OWN2_PRIOR_WEIGHT * globalMean) / (ys.length + OWN2_PRIOR_WEIGHT)
		})
	}
	return { cuts, values, globalMean }
}
export function scoreOwn2(model: Own2Model, c: Candidate): number { return mean(OWN2_FEATURE_NAMES.map((name) => model.values[name]![percentileBin(c.features[name], model.cuts[name]!)]!)) ?? model.globalMean }
function threshold(scores: readonly number[], retention: number): number { return [...scores].sort((a, b) => b - a)[Math.min(scores.length - 1, Math.max(0, Math.ceil(scores.length * retention) - 1))]! }
export function selectOwn2Candidates(candidates: readonly Candidate[], model: Own2Model, cutoff: number): Candidate[] {
	const out: Candidate[] = []; let lastBuy = -1e9; let lastSell = -1e9
	for (const c of candidates) { if (scoreOwn2(model, c) < cutoff) continue; const last = c.side === 1 ? lastBuy : lastSell; if (c.idx - last <= OWN2_COOLDOWN) continue; out.push(c); if (c.side === 1) lastBuy = c.idx; else lastSell = c.idx }
	return out
}
function summarize(evals: readonly TradeEval[]): Own2Summary {
	const closed = evals.filter((x) => x.netR != null); const net = closed.map((x) => x.netR!); const sorted = [...net].sort((a, b) => b - a); const keep = sorted.slice(Math.max(1, Math.ceil(sorted.length * 0.01)))
	return { signals: evals.length, closed: closed.length, meanGrossR: mean(closed.map((x) => x.grossR!)), meanNetR: mean(net), pfNet: pf(net), winRate: mean(net.map((x) => x > 0 ? 1 : 0)), partial: closed.filter((x) => x.trade!.outcome === 'Partial').length, stop: closed.filter((x) => x.trade!.outcome === 'Stop').length, full: closed.filter((x) => x.trade!.outcome === 'Full fix').length, best1RemovedNetR: mean(keep) }
}
function rng(seed: number): () => number { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
function randomNull(rows: readonly ExactIndicatorRow[], tr55: readonly (number | null)[], selected: readonly Candidate[], from: number, to: number, seed: number): Own2Summary {
	const random = rng(seed); const used = new Set<number>(); const out: Candidate[] = []
	for (const c of selected) {
		const eligible: number[] = []; for (let i = Math.max(WARMUP, from); i < Math.min(to, rows.length - 1); i++) if (!used.has(i) && validGgiBand(rows[i]!) && tr55[i] != null && (rows[i]!.close < rows[i]!.mean) === (c.side === 1)) eligible.push(i)
		if (!eligible.length) continue; const idx = eligible[Math.floor(random() * eligible.length)]!; used.add(idx); out.push({ idx, side: c.side, features: c.features })
	}
	return summarize(evaluate(rows, tr55, out))
}
function load(path: string) { const rows = parseExactIndicatorCsv(readFileSync(resolve(path), 'utf8'), { allowInvalidBandOrder: true, allowIrregularBars: true }); return { rows, tr55: trueRangeSma(rows, 55), body: bodySma20(rows) } }

export function runOwn2Research() {
	const trainPath = 'data/vendor-exports/incoming-2026-08/BYBIT_BTCUSDT.P_2h_full20k_vol.csv'
	const transfers = [
		{ id: 'xrp-3m', file: 'data/vendor-exports/incoming-2026-08/BINANCE_XRPUSDT_3m_vol.csv' },
		{ id: 'ondo-2h', file: 'data/vendor-exports/incoming-2026-08/BYBIT_ONDOUSDT.P_2h.csv' },
		{ id: 'ondo-15m', file: 'data/vendor-exports/incoming-2026-08/BYBIT_ONDOUSDT.P_15m.csv' },
		{ id: 'btc-15m', file: 'data/vendor-exports/incoming-2026-08/BYBIT_BTCUSDT.P_15m.csv' },
	]
	const d = load(trainPath); const split1 = Math.floor(d.rows.length * OWN2_FIT); const split2 = Math.floor(d.rows.length * (OWN2_FIT + OWN2_VALIDATION)); const all = own2Candidates(d.rows, d.tr55, d.body)
	const fit = all.filter((c) => c.idx < split1); const val = all.filter((c) => c.idx >= split1 && c.idx < split2); const test = all.filter((c) => c.idx >= split2)
	const fitEval = evaluate(d.rows, d.tr55, fit); const model = fitOwn2Model(fit, fitEval); const fitScores = fit.map((c) => scoreOwn2(model, c)); const retentions = OWN2_RETENTIONS.map((r) => ({ retention: r, cutoff: threshold(fitScores, r) }))
	const validation = retentions.map((r) => { const selected = selectOwn2Candidates(val, model, r.cutoff); return { ...r, summary: summarize(evaluate(d.rows, d.tr55, selected)) } })
	const winner = validation.filter((x) => x.summary.closed >= 20).sort((a, b) => (b.summary.meanNetR ?? -Infinity) - (a.summary.meanNetR ?? -Infinity) || (b.summary.pfNet ?? -Infinity) - (a.summary.pfNet ?? -Infinity))[0] ?? validation[0]!
	const testSelected = selectOwn2Candidates(test, model, winner.cutoff); const testSummary = summarize(evaluate(d.rows, d.tr55, testSelected)); const testNull = randomNull(d.rows, d.tr55, testSelected, split2, d.rows.length, 20260806)
	const testBroad = summarize(evaluate(d.rows, d.tr55, selectOwn2Candidates(test, { cuts: Object.fromEntries(OWN2_FEATURE_NAMES.map((n) => [n, [Infinity, Infinity, Infinity, Infinity]])) as Record<Own2FeatureName, number[]>, values: Object.fromEntries(OWN2_FEATURE_NAMES.map((n) => [n, [0, 0, 0, 0, 0]])) as Record<Own2FeatureName, number[]>, globalMean: 0 }, -Infinity)))
	const transfersResult = transfers.map((x) => { const q = load(x.file); const candidates = own2Candidates(q.rows, q.tr55, q.body); const chosen = selectOwn2Candidates(candidates, model, winner.cutoff); return { id: x.id, summary: summarize(evaluate(q.rows, q.tr55, chosen)), signals: chosen.length } })
	const pooledN = transfersResult.reduce((a, x) => a + (x.summary.closed || 0), 0); const pooled = pooledN ? transfersResult.reduce((a, x) => a + (x.summary.meanNetR ?? 0) * x.summary.closed, 0) / pooledN : null
	const promote = (testSummary.meanNetR ?? -Infinity) >= 0.03 && (testSummary.pfNet ?? -Infinity) >= 1.10 && (testSummary.meanNetR ?? -Infinity) - (testBroad.meanNetR ?? 0) >= 0.03 && (testSummary.meanNetR ?? -Infinity) > (testNull.meanNetR ?? -Infinity) && (testSummary.best1RemovedNetR ?? -Infinity) > 0 && (pooled ?? -Infinity) > 0 && transfersResult.filter((x) => (x.summary.meanNetR ?? -Infinity) > 0).length >= 3
	return { version: OWN2_VERSION, protocol: { sha: sha256File(resolve(trainPath)), fitSplit: split1, validationSplit: split2, costBpsPerSide: OWN2_COST_BPS_PER_SIDE, retentionLevels: OWN2_RETENTIONS, featureNames: OWN2_FEATURE_NAMES }, fit: { candidates: fit.length, globalMean: model.globalMean }, validation, winner, test: { broad: testBroad, selected: testSummary, null: testNull, selectedSignals: testSelected.length }, transfers: transfersResult, aggregate: { pooledTransferMeanNetR: pooled, positiveTransfers: transfersResult.filter((x) => (x.summary.meanNetR ?? -Infinity) > 0).length, verdict: promote ? 'PROMOTE' : 'REJECT OWN2 V1' } }
}
function md(result: ReturnType<typeof runOwn2Research>): string { const lines = [`# OWN2 expectancy ranker v1`, '', `## Verdict: **${result.aggregate.verdict}**`, '', `- Fit candidates: ${result.fit.candidates}; fit global mean net R: ${result.fit.globalMean.toFixed(4)}`, `- Winner: top ${(result.winner.retention * 100).toFixed(0)}%; validation net mean ${(result.winner.summary.meanNetR ?? NaN).toFixed(4)}`, '', '| Split | Stream | n | mean net R | PF | WR | P/S/F | best 1% removed |', '|---|---|---:|---:|---:|---:|---:|---:|']
	const row = (split: string, stream: string, s: Own2Summary) => lines.push(`| ${split} | ${stream} | ${s.closed} | ${(s.meanNetR ?? NaN).toFixed(4)} | ${(s.pfNet ?? NaN).toFixed(3)} | ${((s.winRate ?? NaN) * 100).toFixed(1)}% | ${s.partial}/${s.stop}/${s.full} | ${(s.best1RemovedNetR ?? NaN).toFixed(4)} |`)
	for (const x of result.validation) row('validation', `top ${(x.retention * 100).toFixed(0)}%`, x.summary); row('test', 'selected OWN2', result.test.selected); row('test', 'broad', result.test.broad); row('test', 'regime-null', result.test.null)
	lines.push('', '| Transfer | n | mean net R | PF | WR | P/S/F |', '|---|---:|---:|---:|---:|---:|'); for (const x of result.transfers) lines.push(`| ${x.id} | ${x.summary.closed} | ${(x.summary.meanNetR ?? NaN).toFixed(4)} | ${(x.summary.pfNet ?? NaN).toFixed(3)} | ${((x.summary.winRate ?? NaN) * 100).toFixed(1)}% | ${x.summary.partial}/${x.summary.stop}/${x.summary.full} |`)
	lines.push('', `Pooled transfer mean net R: **${(result.aggregate.pooledTransferMeanNetR ?? NaN).toFixed(4)}**`, '', 'Win rate and Full:Stop are descriptive only; promotion is based on net expectancy, PF, null advantage and transfer consistency.')
	return lines.join('\n') + '\n'
}
export function main() { const result = runOwn2Research(); writeFileSync(resolve('ci-results/ggi-own2-expectancy-ranker-v1.json'), `${JSON.stringify(result, null, 2)}\n`); writeFileSync(resolve('ci-results/ggi-own2-expectancy-ranker-v1.md'), md(result)); console.log(JSON.stringify(result.aggregate, null, 2)); return result }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
