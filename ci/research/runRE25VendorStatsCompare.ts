/**
 * RE25 — простое сравнение НАШ OWN2 vs вендор-статистика (16 активов/ТФ, ворд GGI_Trading_Statistics).
 *
 * Вендор в этой версии индикатора отдаёт по каждому активу/ТФ: Trades, Winrate, Partial%, Stop%, Full-fix%
 * (Result-R и Avg-stop БОЛЬШЕ НЕ даёт). Поэтому:
 *   - калибруем наш стоп под его Stop-RATE (как RE12, а не под Avg-stop);
 *   - выдаём НАШУ таксономию (Trades/WR/Partial/Stop/Full) рядом с его — для наглядного сравнения тейков/стопов;
 *   - НАШ net R (0/5/7 bps) в абсолюте (у вендора R нет — сравнить R с ним по этим файлам нельзя).
 * Входы = собственные сигналы OWN2 (детектор канон {1.4,3,−0.35}). base {fullFixAtMean:true, addEnabled:false}, safe.
 *
 * §2.1/§2.3: свипаем только СВОЙ стоп (под его stop-rate), правил вендора не выдумываем. src/core не тронут.
 * Запуск: npx tsx "ci/research/runRE25VendorStatsCompare.ts"
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
const COST_BPS = [0, 5, 7]
const BASE: Partial<ArrowModeConfig> = { fullFixAtMean: true, addEnabled: false }

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

interface Res { v: Vendor; ourShapes: number; nCanon: number; stopSteps: number; ourAvgStopPct: number; byCost: Array<{ bps: number; t: Tax }> }

function main(): void {
	const results: Res[] = []
	for (const v of VENDOR) {
		if (!existsSync(resolve(v.file))) { console.log(`skip ${v.key}: нет файла ${v.file}`); continue }
		const { candles, shapes } = loadCsv(v.file)
		if (candles.length < 400) { console.log(`skip ${v.key}: баров ${candles.length}`); continue }
		const bands = computeApexBands([...candles], APEX_PARAMS)
		const canon = detectArrowSignalCandidates(candles, APEX_PARAMS, CANON).candidates as ArrowSignal[]

		// калибровка стопа под вендорский Stop-RATE
		let bestStop = STOP_GRID[0]!, bestDelta = Infinity
		for (const st of STOP_GRID) {
			const tx = taxonomy(replay(candles, bands, canon, st, 0))
			const d = Math.abs(tx.stopPct * 100 - v.stopPct)
			if (Number.isFinite(d) && d < bestDelta) { bestDelta = d; bestStop = st }
		}
		const byCost = COST_BPS.map((bps) => ({ bps, t: taxonomy(replay(candles, bands, canon, bestStop, bps)) }))
		const our0 = byCost[0]!.t
		results.push({ v, ourShapes: shapes, nCanon: canon.length, stopSteps: bestStop, ourAvgStopPct: our0.avgStopPct, byCost })

		const o5 = byCost.find((c) => c.bps === 5)!.t
		console.log(`\n=== ${v.key} ===`)
		console.log(`  ВЕНДОР:  сделок ${v.trades} | WR ${v.wr}% | Partial ${v.partialPct}% | Stop ${v.stopPct}% | Full ${v.fullPct}%`)
		console.log(`  НАШ OWN2 (shapes в файле ${shapes}, наших сигналов ${canon.length}; стоп×${bestStop}=${r2(our0.avgStopPct)}%):`)
		console.log(`           сделок ${our0.n} | WR ${pct1(our0.wr)}% | Partial ${pct1(our0.partialPct)}% | Stop ${pct1(our0.stopPct)}% | Full ${pct1(our0.fullPct)}%`)
		console.log(`           net@0 ${r2(byCost[0]!.t.totalR)}R | net@5 ${r2(o5.totalR)}R | net@7 ${r2(byCost[2]!.t.totalR)}R | meanR@5 ${r3(o5.meanR)}`)
	}
	if (!results.length) throw new Error('RE25: ни одной серии.')

	// агрегат
	let ourTot0 = 0, ourTot5 = 0, ourTot7 = 0, ourN = 0, posSeries5 = 0
	for (const r of results) {
		ourTot0 += r.byCost[0]!.t.totalR; ourTot5 += r.byCost[1]!.t.totalR; ourTot7 += r.byCost[2]!.t.totalR
		ourN += r.byCost[0]!.t.n; if (r.byCost[1]!.t.totalR > 0) posSeries5++
	}

	const md: string[] = []
	md.push('# RE25 — наш OWN2 vs вендор-статистика (16 активов/ТФ)')
	md.push('')
	md.push('> Вендор в этой версии даёт только Trades/WR/Partial%/Stop%/Full% (Result-R и Avg-stop — НЕ даёт). Наш стоп калиброван под его **Stop-rate**. Наш net R — в абсолюте (сравнить R с вендором по этим файлам нельзя — у него R нет). Входы = собственные сигналы OWN2 (канон), base `{fullFixAtMean:true, addEnabled:false}`, mode `safe`. src/core не тронут.')
	md.push('')
	md.push('| актив/ТФ | сделок В/Н | WR В/Н | Partial В/Н | Stop В/Н | Full В/Н | наш стоп% | net@0 | net@5 | net@7 |')
	md.push('|---|---|---|---|---|---|---|---|---|---|')
	for (const r of results) {
		const o0 = r.byCost[0]!.t, o5 = r.byCost[1]!.t, o7 = r.byCost[2]!.t
		md.push(`| ${r.v.key} | ${r.v.trades}/${o0.n} | ${r.v.wr}/${pct1(o0.wr)} | ${r.v.partialPct}/${pct1(o0.partialPct)} | ${r.v.stopPct}/${pct1(o0.stopPct)} | ${r.v.fullPct}/${pct1(o0.fullPct)} | ${r2(o0.avgStopPct)} | ${r2(o0.totalR)}R | **${r2(o5.totalR)}R** | ${r2(o7.totalR)}R |`)
	}
	md.push('')
	md.push(`**Агрегат (16 серий):** наш net@0 ${r2(ourTot0)}R · net@5 ${r2(ourTot5)}R · net@7 ${r2(ourTot7)}R · сделок ${ourN} · meanR@5 ${r3(ourTot5 / ourN)} · серий в плюсе @5 ${posSeries5}/${results.length}.`)
	md.push('')
	md.push('_«В/Н» = Вендор/Наш. WR/Partial/Stop/Full — проценты. Наш стоп калиброван под вендорский Stop-rate (в этой версии Avg-stop не дан). net = сумма netR по всем нашим сделкам серии._')

	if (!existsSync(resolve('ci-results'))) mkdirSync(resolve('ci-results'), { recursive: true })
	writeFileSync(resolve('ci-results/re25-vendor-stats-compare.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/re25-vendor-stats-compare.json'), JSON.stringify({ generatedAt: new Date().toISOString(), stopGrid: STOP_GRID, costBps: COST_BPS, canon: CANON, results }, null, 2))
	console.log(`\nАГРЕГАТ: net@0 ${r2(ourTot0)}R net@5 ${r2(ourTot5)}R net@7 ${r2(ourTot7)}R | сделок ${ourN} | серий+@5 ${posSeries5}/${results.length}`)
	console.log('Записано: ci-results/re25-vendor-stats-compare.{md,json}')
}

main()
