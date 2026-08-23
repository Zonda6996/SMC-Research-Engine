/**
 * RE25b — как RE25, но с ПРАВИЛЬНЫМ менеджментом (fullFixAtMean:false → dynamic-partial:
 * частичка у средней + полный тейк у противоположной внутренней полосы), как реально торгует автор
 * (RE12c). fullFixAtMean:true в RE25 обнулял Partial и резал прибыль победителей (ловушка RE12).
 * Здесь Partial/Full и net R сопоставимы с вендор-таблицей.
 *
 * Стоп калиброван под вендорский Stop-rate. Входы = собственные сигналы OWN2 (канон {1.4,3,−0.35}).
 * src/core не тронут. Запуск: npx tsx "ci/research/runRE25bVendorStatsCompareDynamic.ts"
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { detectArrowSignalCandidates } from '../../src/core/signals/ArrowSignalEngine.js'
import type { ArrowSignal } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayArrowSignals } from '../../src/core/signals/ArrowTradeReplay.js'
import type { ArrowTrade, ArrowModeConfig } from '../../src/core/signals/ArrowTradeReplay.js'

interface Vendor { key: string; file: string; trades: number; wr: number; partialPct: number; stopPct: number; fullPct: number }
const VENDOR: Vendor[] = [
	{ key: 'VIRTUAL.P 1h', file: 'csv/BINANCE_VIRTUALUSDT.P, 60.csv', trades: 63, wr: 87.3, partialPct: 39.7, stopPct: 12.7, fullPct: 47.6 },
	{ key: 'ONDO.P 1h', file: 'csv/BINANCE_ONDOUSDT.P, 60.csv', trades: 89, wr: 89.9, partialPct: 30.3, stopPct: 10.1, fullPct: 59.6 },
	{ key: 'LDO.P 1h', file: 'csv/BINANCE_LDOUSDT.P, 60.csv', trades: 79, wr: 87.3, partialPct: 32.9, stopPct: 12.7, fullPct: 54.4 },
	{ key: 'AVAX.P 1h', file: 'csv/BINANCE_AVAXUSDT.P, 60.csv', trades: 83, wr: 91.6, partialPct: 37.3, stopPct: 8.4, fullPct: 54.2 },
	{ key: 'BTC 15m', file: 'csv/BINANCE_BTCUSDT, 15.csv', trades: 87, wr: 82.8, partialPct: 27.6, stopPct: 17.2, fullPct: 55.2 },
	{ key: 'BTC 1h', file: 'csv/BINANCE_BTCUSDT, 60.csv', trades: 90, wr: 85.6, partialPct: 25.6, stopPct: 14.4, fullPct: 60.0 },
	{ key: 'ETH 30m', file: 'csv/BINANCE_ETHUSDT, 30.csv', trades: 90, wr: 91.1, partialPct: 35.6, stopPct: 8.9, fullPct: 55.6 },
	{ key: 'ETH 15m', file: 'csv/BINANCE_ETHUSDT, 15.csv', trades: 85, wr: 77.6, partialPct: 30.6, stopPct: 22.4, fullPct: 47.1 },
	{ key: 'XRP 1h', file: 'csv/BINANCE_XRPUSDT, 60.csv', trades: 66, wr: 81.8, partialPct: 33.3, stopPct: 18.2, fullPct: 48.5 },
	{ key: 'XRP 30m', file: 'csv/BINANCE_XRPUSDT, 30.csv', trades: 83, wr: 88.0, partialPct: 34.9, stopPct: 12.0, fullPct: 53.0 },
	{ key: 'ADA.P 45m', file: 'csv/BINANCE_ADAUSDT.P, 45.csv', trades: 78, wr: 83.3, partialPct: 42.3, stopPct: 16.7, fullPct: 41.0 },
	{ key: 'ADA.P 15m', file: 'csv/BINANCE_ADAUSDT.P, 15.csv', trades: 78, wr: 79.5, partialPct: 30.8, stopPct: 20.5, fullPct: 48.7 },
	{ key: 'LINK 15m', file: 'csv/BINANCE_LINKUSDT, 15.csv', trades: 69, wr: 87.0, partialPct: 26.1, stopPct: 13.0, fullPct: 60.9 },
	{ key: 'LINK 1h', file: 'csv/BINANCE_LINKUSDT, 60.csv', trades: 83, wr: 90.4, partialPct: 37.3, stopPct: 9.6, fullPct: 53.0 },
	{ key: 'DOGE 30m', file: 'csv/BINANCE_DOGEUSDT, 30.csv', trades: 85, wr: 88.2, partialPct: 38.8, stopPct: 11.8, fullPct: 49.4 },
	{ key: 'DOGE 45m', file: 'csv/BINANCE_DOGEUSDT, 45.csv', trades: 82, wr: 89.0, partialPct: 40.2, stopPct: 11.0, fullPct: 48.8 },
]

const CANON = { warmupBars: 200, relativeVolumePeriod: 20, minimumRelativeVolume: 1.4, minimumDistanceMeanPct: 3, minimumPenetrationInner: -0.35 }
const STOP_GRID = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 2.0, 2.5, 3.0]
const SPACING = [0, 20, 50, 100]
const COST_BPS = [0, 5, 7]
// ПРАВИЛЬНЫЙ менеджмент: без fullFixAtMean → mode 'safe' = dynamic-partial (частичка+полный таргет)
const BASE: Partial<ArrowModeConfig> = { fullFixAtMean: false, addEnabled: false }

const num = (x: string | undefined): number => { const n = Number((x ?? '').trim()); return Number.isFinite(n) ? n : NaN }
const pct1 = (x: number): string => Number.isFinite(x) ? (x * 100).toFixed(1) : 'n/a'
const r2 = (x: number): string => Number.isFinite(x) ? x.toFixed(2) : 'n/a'
const r3 = (x: number): string => Number.isFinite(x) ? x.toFixed(3) : 'n/a'

function loadCsv(file: string): { candles: Candle[]; shapes: number } {
	const lines = readFileSync(resolve(file), 'utf8').split(/\r?\n/).filter((l) => l.length > 0)
	const candles: Candle[] = []; let shapes = 0
	for (let li = 1; li < lines.length; li++) {
		const p = lines[li]!.split(',')
		if (p.length < 13) continue
		const ts = num(p[0]), o = num(p[1]), h = num(p[2]), l = num(p[3]), c = num(p[4])
		if (![ts, o, h, l, c].every(Number.isFinite)) continue
		candles.push({ timestamp: ts * 1000, open: o, high: h, low: l, close: c, volume: num(p[12]) || 0 })
		if ((p[10] ?? '0').trim() === '1' || (p[11] ?? '0').trim() === '1') shapes++
	}
	return { candles, shapes }
}
function thin(signals: ArrowSignal[], spacing: number): ArrowSignal[] {
	if (spacing <= 0) return signals
	const out: ArrowSignal[] = []; let last = -Infinity
	for (const s of signals) { if (s.signalIndex - last >= spacing) { out.push(s); last = s.signalIndex } }
	return out
}
function replay(candles: Candle[], bands: ReturnType<typeof computeApexBands>, signals: ArrowSignal[], stopSteps: number, bps: number): ArrowTrade[] {
	return replayArrowSignals(candles, bands, signals, 'safe', { ...BASE, stopSteps, oneWayCostBps: bps }).trades.filter((t) => t.outcome !== 'open' && t.outcome !== 'timeout')
}
interface Tax { n: number; wr: number; partialPct: number; stopPct: number; fullPct: number; totalR: number; meanR: number; avgStopPct: number }
function taxonomy(trades: ArrowTrade[]): Tax {
	const n = trades.length
	if (!n) return { n: 0, wr: NaN, partialPct: NaN, stopPct: NaN, fullPct: NaN, totalR: 0, meanR: NaN, avgStopPct: NaN }
	const full = trades.filter((t) => t.outcome === 'full-tp').length
	const partial = trades.filter((t) => t.outcome === 'partial-be' || t.outcome === 'partial-stop').length
	const stop = trades.filter((t) => t.outcome === 'stop').length
	const totalR = trades.reduce((s, t) => s + t.netR, 0)
	const avgStopPct = trades.reduce((s, t) => s + Math.abs(t.entry - t.stop) / t.entry * 100, 0) / n
	return { n, wr: (full + partial) / n, partialPct: partial / n, stopPct: stop / n, fullPct: full / n, totalR, meanR: totalR / n, avgStopPct }
}

interface Res { v: Vendor; ourShapes: number; nCanon: number; stopSteps: number; byCost: Array<{ bps: number; t: Tax }>; thinned: { spacing: number; stopSteps: number; byCost: Array<{ bps: number; t: Tax }> } }

function main(): void {
	const results: Res[] = []
	for (const v of VENDOR) {
		if (!existsSync(resolve(v.file))) { console.log(`skip ${v.key}: нет файла`); continue }
		const { candles, shapes } = loadCsv(v.file)
		if (candles.length < 400) { console.log(`skip ${v.key}: баров ${candles.length}`); continue }
		const bands = computeApexBands([...candles], APEX_PARAMS)
		const canon = detectArrowSignalCandidates(candles, APEX_PARAMS, CANON).candidates as ArrowSignal[]

		// стоп под вендорский Stop-rate (spacing=0)
		let bestStop = STOP_GRID[0]!, bestDelta = Infinity
		for (const st of STOP_GRID) {
			const tx = taxonomy(replay(candles, bands, canon, st, 0))
			const d = Math.abs(tx.stopPct * 100 - v.stopPct)
			if (Number.isFinite(d) && d < bestDelta) { bestDelta = d; bestStop = st }
		}
		const byCost = COST_BPS.map((bps) => ({ bps, t: taxonomy(replay(candles, bands, canon, bestStop, bps)) }))

		// прореживание переизбытка (RE24-рычаг): spacing×stop → максимум net@5
		let bN5 = -Infinity, bSp = 0, bSt = bestStop
		for (const sp of SPACING) { const sig = thin(canon, sp); for (const st of STOP_GRID) { const n5 = taxonomy(replay(candles, bands, sig, st, 5)).totalR; if (Number.isFinite(n5) && n5 > bN5) { bN5 = n5; bSp = sp; bSt = st } } }
		const bSig = thin(canon, bSp)
		const thinnedByCost = COST_BPS.map((bps) => ({ bps, t: taxonomy(replay(candles, bands, bSig, bSt, bps)) }))

		results.push({ v, ourShapes: shapes, nCanon: canon.length, stopSteps: bestStop, byCost, thinned: { spacing: bSp, stopSteps: bSt, byCost: thinnedByCost } })

		const o0 = byCost[0]!.t, o5 = byCost[1]!.t
		console.log(`\n=== ${v.key} ===`)
		console.log(`  ВЕНДОР: сделок ${v.trades} WR ${v.wr}% Partial ${v.partialPct}% Stop ${v.stopPct}% Full ${v.fullPct}%`)
		console.log(`  НАШ (канон, стоп×${bestStop}): сделок ${o0.n} WR ${pct1(o0.wr)}% Partial ${pct1(o0.partialPct)}% Stop ${pct1(o0.stopPct)}% Full ${pct1(o0.fullPct)}% | net@0 ${r2(o0.totalR)}R net@5 ${r2(o5.totalR)}R meanR@5 ${r3(o5.meanR)}`)
		console.log(`  НАШ (прорежен sp${bSp}/st${bSt}): сделок ${thinnedByCost[0]!.t.n} WR ${pct1(thinnedByCost[0]!.t.wr)}% | net@0 ${r2(thinnedByCost[0]!.t.totalR)}R net@5 ${r2(thinnedByCost[1]!.t.totalR)}R`)
	}
	if (!results.length) throw new Error('RE25b: ни одной серии.')

	let cN0 = 0, cN5 = 0, cn = 0, cPos = 0, tN0 = 0, tN5 = 0, tPos = 0
	for (const r of results) { cN0 += r.byCost[0]!.t.totalR; cN5 += r.byCost[1]!.t.totalR; cn += r.byCost[0]!.t.n; if (r.byCost[1]!.t.totalR > 0) cPos++; tN0 += r.thinned.byCost[0]!.t.totalR; tN5 += r.thinned.byCost[1]!.t.totalR; if (r.thinned.byCost[1]!.t.totalR > 0) tPos++ }

	const md: string[] = []
	md.push('# RE25b — наш OWN2 vs вендор (16 серий), ПРАВИЛЬНЫЙ менеджмент (partial+full target)')
	md.push('')
	md.push('> fullFixAtMean:false (mode safe = dynamic-partial: частичка у mean + полный таргет у внутр. полосы), как реально торгует автор (RE12c). Стоп калиброван под вендорский Stop-rate. Входы = собственные сигналы OWN2 (канон). Вендор R/AvgStop в этой версии не даёт → сравниваем Trades/WR/Partial/Stop/Full; наш net R — абсолют. src/core не тронут.')
	md.push('')
	md.push('## Канон OWN2 (все сигналы), стоп под его Stop-rate')
	md.push('| актив/ТФ | сделок В/Н | WR В/Н | Partial В/Н | Stop В/Н | Full В/Н | net@0 | net@5 | meanR@5 |')
	md.push('|---|---|---|---|---|---|---|---|---|')
	for (const r of results) {
		const o0 = r.byCost[0]!.t, o5 = r.byCost[1]!.t
		md.push(`| ${r.v.key} | ${r.v.trades}/${o0.n} | ${r.v.wr}/${pct1(o0.wr)} | ${r.v.partialPct}/${pct1(o0.partialPct)} | ${r.v.stopPct}/${pct1(o0.stopPct)} | ${r.v.fullPct}/${pct1(o0.fullPct)} | ${r2(o0.totalR)}R | **${r2(o5.totalR)}R** | ${r3(o5.meanR)} |`)
	}
	md.push('')
	md.push(`**Агрегат канон:** net@0 ${r2(cN0)}R · net@5 ${r2(cN5)}R · сделок ${cn} · meanR@5 ${r3(cN5 / cn)} · серий+@5 ${cPos}/${results.length}.`)
	md.push('')
	md.push('## С прореживанием переизбытка (рычаг RE24, spacing+stop под max net@5 — IN-SAMPLE upper bound)')
	md.push('| актив/ТФ | spacing/stop | сделок | WR | net@0 | net@5 |')
	md.push('|---|---|---|---|---|---|')
	for (const r of results) {
		const t0 = r.thinned.byCost[0]!.t, t5 = r.thinned.byCost[1]!.t
		md.push(`| ${r.v.key} | sp${r.thinned.spacing}/st${r.thinned.stopSteps} | ${t0.n} | ${pct1(t0.wr)} | ${r2(t0.totalR)}R | **${r2(t5.totalR)}R** |`)
	}
	md.push('')
	md.push(`**Агрегат прорежен (in-sample):** net@0 ${r2(tN0)}R · net@5 ${r2(tN5)}R · серий+@5 ${tPos}/${results.length}.`)

	if (!existsSync(resolve('ci-results'))) mkdirSync(resolve('ci-results'), { recursive: true })
	writeFileSync(resolve('ci-results/re25b-vendor-stats-compare-dynamic.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/re25b-vendor-stats-compare-dynamic.json'), JSON.stringify({ generatedAt: new Date().toISOString(), stopGrid: STOP_GRID, spacing: SPACING, costBps: COST_BPS, canon: CANON, results }, null, 2))
	console.log(`\nАГРЕГАТ канон: net@0 ${r2(cN0)}R net@5 ${r2(cN5)}R сделок ${cn} серий+@5 ${cPos}/${results.length}`)
	console.log(`АГРЕГАТ прорежен(in-sample): net@0 ${r2(tN0)}R net@5 ${r2(tN5)}R серий+@5 ${tPos}/${results.length}`)
	console.log('Записано: ci-results/re25b-vendor-stats-compare-dynamic.{md,json}')
}

main()
