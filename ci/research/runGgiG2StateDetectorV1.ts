import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseExactIndicatorCsv, sha256File, type ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import { trueRangeSma, validGgiBand } from './lib/ggiCorrectedReplay.js'
import { replayDm3Trade, WARMUP, type Dm3Trade } from './runDm3StaticExit.js'
import { bodySma20 } from './runOwn1Generator.js'
import { matchNullSignals, type DatasetSpec, type Signal } from './runGgiOwn1PathRegimeAuditV1.js'

export const G2_VERSION = 'ggi-g2-state-detector-v1'
export const G2_BODY_K = 1.5
export const G2_DROUGHT = 10
export const G2_COOLDOWN = 40
export const G2_RECOVERY = 0.25
export const G2_TEST_SPLIT = 0.70
export const G2_COST_BPS_PER_SIDE = 6
export const G2_NULL_DRAWS = 100

export interface G2DatasetSpec extends DatasetSpec {
	role: 'development' | 'transfer'
}

export const G2_DATASETS: G2DatasetSpec[] = [
	{ id: 'btc-2h', asset: 'BTC', file: 'data/vendor-exports/incoming-2026-08/BYBIT_BTCUSDT.P_2h_full20k_vol.csv', timeframeMinutes: 120, group: 'reference', role: 'development', requiredForFullHoldout: false },
	{ id: 'ondo-2h', asset: 'ONDO', file: 'data/vendor-exports/incoming-2026-08/BYBIT_ONDOUSDT.P_2h.csv', timeframeMinutes: 120, group: 'reference', role: 'transfer', requiredForFullHoldout: false },
	{ id: 'ondo-15m', asset: 'ONDO', file: 'data/vendor-exports/incoming-2026-08/BYBIT_ONDOUSDT.P_15m.csv', timeframeMinutes: 15, group: 'reference', role: 'transfer', requiredForFullHoldout: false },
	{ id: 'btc-15m', asset: 'BTC', file: 'data/vendor-exports/incoming-2026-08/BYBIT_BTCUSDT.P_15m.csv', timeframeMinutes: 15, group: 'reference', role: 'transfer', requiredForFullHoldout: false },
	{ id: 'xrp-3m', asset: 'XRP', file: 'data/vendor-exports/incoming-2026-08/BINANCE_XRPUSDT_3m_vol.csv', timeframeMinutes: 3, group: 'auxiliary', role: 'transfer', requiredForFullHoldout: false },
]

export function g2Signals(
	rows: readonly ExactIndicatorRow[],
	bodySma: readonly (number | null)[],
	from = 0,
	to = rows.length,
): Signal[] {
	const out: Signal[] = []
	let lastMeanTouch = -1e9
	let lastBuy = -1e9
	let lastSell = -1e9
	let longEpisodeStart: number | null = null
	let shortEpisodeStart: number | null = null
	let longLows: number[] = []
	let shortHighs: number[] = []
	for (let i = 0; i < Math.min(to, rows.length); i++) {
		const row = rows[i]!
		if (!validGgiBand(row)) continue
		const meanTouched = row.low <= row.mean && row.mean <= row.high
		if (meanTouched) {
			lastMeanTouch = i
			longEpisodeStart = null
			shortEpisodeStart = null
			longLows = []
			shortHighs = []
		}
		if (i < Math.max(WARMUP, from) || i >= rows.length - 2) continue
		const body = Math.abs(row.close - row.open)
		const b = bodySma[i]
		if (b == null || b <= 0) continue
		const longSide = row.close < row.mean && row.close > row.open
		const shortSide = row.close > row.mean && row.close < row.open
		if (longEpisodeStart == null && row.low < row.mean) longEpisodeStart = i
		if (shortEpisodeStart == null && row.high > row.mean) shortEpisodeStart = i
		if (longEpisodeStart != null && row.low < row.mean) {
			if (!longLows.length || row.low < longLows.at(-1)!) longLows.push(row.low)
		}
		if (shortEpisodeStart != null && row.high > row.mean) {
			if (!shortHighs.length || row.high > shortHighs.at(-1)!) shortHighs.push(row.high)
		}
		const next = rows[i + 1]!
		if (longSide && longEpisodeStart != null && i - lastMeanTouch >= G2_DROUGHT && body >= G2_BODY_K * b && longLows.length >= 3) {
			const previousExtension = longLows.at(-3)! - longLows.at(-2)!
			const latestExtension = longLows.at(-2)! - longLows.at(-1)!
			const recoveryWidth = row.mean - row.lowerInner
			const recovery = (row.close - longLows.at(-1)!) / Math.max(recoveryWidth, Number.EPSILON)
			const weakening = latestExtension >= 0 && previousExtension >= latestExtension
			const episodeLow = longLows.at(-1)!
			const confirmed = next.low >= episodeLow && next.close > row.close && next.high < next.mean && next.close < next.mean
			if (recovery >= G2_RECOVERY && weakening && confirmed && i + 1 - lastBuy > G2_COOLDOWN) {
				out.push({ idx: i + 1, side: 1 })
				lastBuy = i + 1
			}
		}
		if (shortSide && shortEpisodeStart != null && i - lastMeanTouch >= G2_DROUGHT && body >= G2_BODY_K * b && shortHighs.length >= 3) {
			const previousExtension = shortHighs.at(-2)! - shortHighs.at(-3)!
			const latestExtension = shortHighs.at(-1)! - shortHighs.at(-2)!
			const recoveryWidth = row.upperInner - row.mean
			const recovery = (shortHighs.at(-1)! - row.close) / Math.max(recoveryWidth, Number.EPSILON)
			const weakening = latestExtension >= 0 && previousExtension >= latestExtension
			const episodeHigh = shortHighs.at(-1)!
			const confirmed = next.high <= episodeHigh && next.close < row.close && next.low > next.mean && next.close > next.mean
			if (recovery >= G2_RECOVERY && weakening && confirmed && i + 1 - lastSell > G2_COOLDOWN) {
				out.push({ idx: i + 1, side: -1 })
				lastSell = i + 1
			}
		}
	}
	return out.sort((a, b) => a.idx - b.idx)
}

interface EvaluatedTrade {
	signal: Signal
	trade: Dm3Trade | null
	netR: number | null
}

interface Summary {
	signals: number
	closed: number
	meanGrossR: number | null
	meanNetR: number | null
	profitFactorNet: number | null
	winRate: number | null
	partial: number
	stop: number
	full: number
	fullStop: number | null
	best1RemovedNetR: number | null
}

function mean(values: readonly number[]): number | null { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null }
function profitFactor(values: readonly number[]): number | null {
	const wins = values.filter((x) => x > 0).reduce((a, b) => a + b, 0)
	const losses = Math.abs(values.filter((x) => x < 0).reduce((a, b) => a + b, 0))
	return losses > 0 ? wins / losses : wins > 0 ? Number.POSITIVE_INFINITY : null
}
function summary(evaluated: readonly EvaluatedTrade[]): Summary {
	const closed = evaluated.filter((x): x is EvaluatedTrade & { trade: Dm3Trade; netR: number } => x.trade != null && x.trade.outcome !== 'End mark' && x.netR != null)
	const gross = closed.map((x) => x.trade.grossR)
	const net = closed.map((x) => x.netR)
	const sorted = [...net].sort((a, b) => b - a)
	const kept = sorted.slice(Math.max(1, Math.ceil(sorted.length * 0.01)))
	return {
		signals: evaluated.length,
		closed: closed.length,
		meanGrossR: mean(gross),
		meanNetR: mean(net),
		profitFactorNet: profitFactor(net),
		winRate: mean(net.map((x) => x > 0 ? 1 : 0)),
		partial: closed.filter((x) => x.trade.outcome === 'Partial').length,
		stop: closed.filter((x) => x.trade.outcome === 'Stop').length,
		full: closed.filter((x) => x.trade.outcome === 'Full fix').length,
		fullStop: closed.some((x) => x.trade.outcome === 'Stop') ? closed.filter((x) => x.trade.outcome === 'Full fix').length / closed.filter((x) => x.trade.outcome === 'Stop').length : null,
		best1RemovedNetR: mean(kept),
	}
}

function netFromGross(rows: readonly ExactIndicatorRow[], tr55: readonly (number | null)[], signal: Signal, grossR: number): number | null {
	const entry = rows[signal.idx + 1]
	const volatility = tr55[signal.idx]
	if (!entry || volatility == null || volatility <= 0 || entry.open <= 0) return null
	const plannedRiskPct = volatility * 12 / entry.open * 100
	const roundTripCostPct = G2_COST_BPS_PER_SIDE * 2 / 100
	return grossR - roundTripCostPct / plannedRiskPct
}

function evaluate(rows: readonly ExactIndicatorRow[], tr55: readonly (number | null)[], signals: readonly Signal[]): EvaluatedTrade[] {
	return signals.map((signal) => {
		const trade = replayDm3Trade(rows, tr55, signal.idx, signal.side, 'V2_movP_staticTPwick')
		return { signal, trade, netR: trade && trade.outcome !== 'End mark' ? netFromGross(rows, tr55, signal, trade.grossR) : null }
	})
}

function randomSummaries(rows: readonly ExactIndicatorRow[], tr55: readonly (number | null)[], template: readonly Signal[], from: number, to: number, seed: number): Summary[] {
	const out: Summary[] = []
	for (let draw = 0; draw < G2_NULL_DRAWS; draw++) {
		const matched = matchNullSignals(rows, tr55, template, from, to, seed + draw * 104729, 'primary-regime-matched')
		const signals = matched.filter((x) => x.idx >= 0).map(({ idx, side }) => ({ idx, side }))
		out.push(summary(evaluate(rows, tr55, signals)))
	}
	return out
}

function aggregateRandom(summaries: readonly Summary[]): Summary {
	return {
		signals: Math.round(mean(summaries.map((x) => x.signals)) ?? 0),
		closed: Math.round(mean(summaries.map((x) => x.closed)) ?? 0),
		meanGrossR: mean(summaries.map((x) => x.meanGrossR).filter((x): x is number => x != null)),
		meanNetR: mean(summaries.map((x) => x.meanNetR).filter((x): x is number => x != null)),
		profitFactorNet: mean(summaries.map((x) => x.profitFactorNet).filter((x): x is number => x != null && Number.isFinite(x))),
		winRate: mean(summaries.map((x) => x.winRate).filter((x): x is number => x != null)),
		partial: Math.round(mean(summaries.map((x) => x.partial)) ?? 0),
		stop: Math.round(mean(summaries.map((x) => x.stop)) ?? 0),
		full: Math.round(mean(summaries.map((x) => x.full)) ?? 0),
		fullStop: mean(summaries.map((x) => x.fullStop).filter((x): x is number => x != null)),
		best1RemovedNetR: mean(summaries.map((x) => x.best1RemovedNetR).filter((x): x is number => x != null)),
	}
}

function loadRows(spec: G2DatasetSpec): { rows: ExactIndicatorRow[]; tr55: Array<number | null>; body: Array<number | null> } | null {
	if (!existsSync(resolve(spec.file))) return null
	const rows = parseExactIndicatorCsv(readFileSync(resolve(spec.file), 'utf8'), { allowInvalidBandOrder: true, allowIrregularBars: true })
	return { rows, tr55: trueRangeSma(rows, 55), body: bodySma20(rows) }
}

interface MissingCell {
	id: string
	available: false
	role: G2DatasetSpec['role']
	timeframeMinutes: number
	file: string
}

interface AvailableCell {
	id: string
	available: true
	role: G2DatasetSpec['role']
	asset: string
	timeframeMinutes: number
	rows: number
	sha256: string
	fromIndex: number
	toIndex: number
	g2: Summary
	matchedNull: Summary
	deltaNetR: number | null
	proximity: { exact: number | null; plusMinus1: number | null; plusMinus3: number | null }
}

function runCell(spec: G2DatasetSpec, from: number, to: number, seed: number): MissingCell | AvailableCell {
	const loaded = loadRows(spec)
	if (!loaded) return { id: spec.id, available: false, role: spec.role, timeframeMinutes: spec.timeframeMinutes, file: spec.file }
	const signals = g2Signals(loaded.rows, loaded.body, from, to).filter((s) => s.idx >= from && s.idx < to)
	const evaluated = evaluate(loaded.rows, loaded.tr55, signals)
	const randomSummary = aggregateRandom(randomSummaries(loaded.rows, loaded.tr55, signals, from, to, seed))
	const result = summary(evaluated)
	return {
		id: spec.id,
		available: true,
		role: spec.role,
		asset: spec.asset,
		timeframeMinutes: spec.timeframeMinutes,
		rows: loaded.rows.length,
		sha256: sha256File(resolve(spec.file)),
		fromIndex: from,
		toIndex: to,
		g2: result,
		matchedNull: randomSummary,
		deltaNetR: result.meanNetR != null && randomSummary.meanNetR != null ? result.meanNetR - randomSummary.meanNetR : null,
		proximity: (() => {
			const arrows: Signal[] = []
			for (let i = Math.max(WARMUP, from); i < Math.min(to, loaded.rows.length); i++) {
				if (loaded.rows[i]!.buy) arrows.push({ idx: i, side: 1 })
				else if (loaded.rows[i]!.sell) arrows.push({ idx: i, side: -1 })
			}
			const distances = signals.map((signal) => {
				const sameSide = arrows.filter((arrow) => arrow.side === signal.side)
				return sameSide.length ? Math.min(...sameSide.map((arrow) => Math.abs(arrow.idx - signal.idx))) : Number.POSITIVE_INFINITY
			}).filter(Number.isFinite)
			return {
				exact: mean(distances.map((x) => x === 0 ? 1 : 0)),
				plusMinus1: mean(distances.map((x) => x <= 1 ? 1 : 0)),
				plusMinus3: mean(distances.map((x) => x <= 3 ? 1 : 0)),
			}
		})(),
	}
}

export function runG2Research() {
	const datasets = G2_DATASETS.map((spec, order) => {
		const loaded = loadRows(spec)
		if (!loaded) return runCell(spec, 0, 0, 20260805 + order)
		const split = spec.role === 'development' ? Math.floor(loaded.rows.length * G2_TEST_SPLIT) : 0
		return {
			...runCell(spec, split, loaded.rows.length, 20260805 + order),
			train: spec.role === 'development' ? runCell(spec, 0, split, 20260805 + order + 1000) : null,
		}
	})
	const available = datasets.filter((x): x is AvailableCell & { train?: AvailableCell | null } => x.available)
	const transfer = available.filter((x) => x.role === 'transfer')
	const transferNet = transfer.map((x) => x.g2.meanNetR).filter((x): x is number => x != null)
	const btc = available.find((x) => x.id === 'btc-2h')
	const btcTest = btc?.g2 ?? null
	const btcDelta = btc?.deltaNetR ?? null
	const positiveTransfers = transfer.filter((x) => (x.g2.meanNetR ?? -Infinity) > 0).length
	const pooledTransferClosed = transfer.reduce((sum, x) => sum + x.g2.closed, 0)
	const pooledTransfer = pooledTransferClosed > 0
		? transfer.reduce((sum, x) => sum + (x.g2.meanNetR ?? 0) * x.g2.closed, 0) / pooledTransferClosed
		: null
	const pooledTransferBest1Closed = transfer.reduce((sum, x) => sum + (x.g2.best1RemovedNetR == null ? 0 : Math.max(0, x.g2.closed - Math.max(1, Math.ceil(x.g2.closed * 0.01)))), 0)
	const pooledTransferBest1Removed = pooledTransferBest1Closed > 0
		? transfer.reduce((sum, x) => {
			if (x.g2.best1RemovedNetR == null) return sum
			const kept = Math.max(0, x.g2.closed - Math.max(1, Math.ceil(x.g2.closed * 0.01)))
			return sum + x.g2.best1RemovedNetR * kept
		}, 0) / pooledTransferBest1Closed
		: null
	const verdict = btcTest == null || btcTest.meanNetR == null || btcTest.meanNetR <= 0 || (btcDelta ?? -Infinity) <= 0 || pooledTransfer == null || pooledTransfer <= 0
		? 'REJECT G2'
		: positiveTransfers >= 3 && pooledTransfer >= 0.03 && (pooledTransferBest1Removed ?? -Infinity) > 0 ? 'PROMOTE TO FULL HOLDOUT' : 'REGIME-SPECIFIC'
	return {
		schemaVersion: 1,
		version: G2_VERSION,
		generatedAt: new Date().toISOString(),
		protocol: {
			bodyK: G2_BODY_K,
			droughtBars: G2_DROUGHT,
			cooldownBars: G2_COOLDOWN,
			recoveryInnerWidth: G2_RECOVERY,
			entry: 'two bars after candidate close: next confirmation close then next open',
			management: 'DM3 V2 unchanged; estimated net proxy 6 bps per side',
			null: `${G2_NULL_DRAWS} deterministic regime-matched draws`,
		},
		coverage: { available: available.length, expected: G2_DATASETS.length, missing: datasets.filter((x) => !x.available).map((x) => x.id) },
		datasets,
		aggregate: { transferCells: transfer.length, positiveTransfers, pooledTransferClosed, pooledTransferMeanNetR: pooledTransfer, pooledTransferBest1RemovedMeanNetR: pooledTransferBest1Removed, btc2hTestMeanNetR: btcTest?.meanNetR ?? null, btc2hTestDeltaNetR: btcDelta, verdict },
	}
}

function markdown(result: ReturnType<typeof runG2Research>): string {
	const lines = ['# GGI-adjacent G2 state detector v1 — results', '', `## Verdict: **${result.aggregate.verdict}**`, '', `Coverage: ${result.coverage.available}/${result.coverage.expected} available datasets. Missing: ${result.coverage.missing.length ? result.coverage.missing.join(', ') : 'none'}.`, '', '| Dataset | Role | G2 n | G2 net R | PF | Null net R | Δ net R | Full:Stop |', '|---|---|---:|---:|---:|---:|---:|---:|']
	for (const dataset of result.datasets) {
		if (!dataset.available) { lines.push(`| ${dataset.id} | ${dataset.role} | unavailable | - | - | - | - | - |`); continue }
		lines.push(`| ${dataset.id} | ${dataset.role} | ${dataset.g2.closed} | ${dataset.g2.meanNetR?.toFixed(4) ?? '-'} | ${dataset.g2.profitFactorNet?.toFixed(3) ?? '-'} | ${dataset.matchedNull.meanNetR?.toFixed(4) ?? '-'} | ${dataset.deltaNetR?.toFixed(4) ?? '-'} | ${dataset.g2.fullStop?.toFixed(2) ?? '-'} |`)
	}
	lines.push('', '## Frozen aggregate gate', '', `- BTC 2h chronological test: mean net R ${result.aggregate.btc2hTestMeanNetR?.toFixed(4) ?? '-'}; matched-null advantage ${result.aggregate.btc2hTestDeltaNetR?.toFixed(4) ?? '-'}.`, `- Pooled transfer (closed-trade weighted, n=${result.aggregate.pooledTransferClosed}): mean net R ${result.aggregate.pooledTransferMeanNetR?.toFixed(4) ?? '-'}.`, `- Pooled transfer after removing the best 1% within each dataset: ${result.aggregate.pooledTransferBest1RemovedMeanNetR?.toFixed(4) ?? '-'}.`, `- Positive transfer datasets: ${result.aggregate.positiveTransfers}/${result.aggregate.transferCells}.`, '', '## Interpretation', '', '- G2 is judged by net expectancy, PF and advantage over the matched null; Full:Stop and win rate are secondary.', '- The dataset role is explicit: BTC 2h is chronological development/test, other available files are transfer diagnostics and are not sealed OOS.', '- GGI proximity is diagnostic only and was not used to choose or promote the detector.', '- No G2 threshold was selected after viewing these results.', '- A rejection means this frozen state grammar did not clear the current test; it does not revive SUR1 or prove that all proprietary signals are impossible.', '')
	return lines.join('\n')
}

export function main() {
	const result = runG2Research()
	writeFileSync(resolve('ci-results/ggi-g2-state-detector-v1.json'), `${JSON.stringify(result, null, 2)}\n`)
	writeFileSync(resolve('ci-results/ggi-g2-state-detector-v1.md'), `${markdown(result)}\n`)
	console.log(JSON.stringify({ output: 'ci-results/ggi-g2-state-detector-v1.json', aggregate: result.aggregate, coverage: result.coverage }, null, 2))
	return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
