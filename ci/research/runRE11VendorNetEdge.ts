/**
 * RE11 — решающий net-тест: есть ли edge при ЕГО дистанции стопа ПОСЛЕ комиссий?
 *
 * RE10 показал: при gross + стопе ≈ его «Avg stop» цифры автора воспроизводятся. Но всё было GROSS.
 * Его же оговорка: узкий стоп → комиссии в R растут (costR = turnover·bps/oneR, oneR↓ ⇒ costR↑).
 * RE11 для каждой серии подбирает stopSteps, дающий реальный %-стоп ≈ его AvgStop, и меряет NET
 * при нескольких уровнях издержек: 0 (gross-реф), 5 (VIP taker), 7 (канон движка), 10 bps/side
 * (Binance spot taker 0.1%). Это отвечает: остаётся ли плюс после комиссий на ЕГО стопе.
 *
 * §2.1/§2.2: правила не придумываются. Стоп подобран под его AvgStop — эксперимент (точное правило
 * стопа автора неизвестно). Движок src/core НЕ тронут — только config-override. Геометрия — каноничные
 * Apex-полосы (RE3 ~0.05% к линиям вендора). Входы = vendor CSV shapes напрямую.
 *
 * Запуск: npx tsx ci/research/runRE11VendorNetEdge.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { arrowAtr200, ARROW_SIGNAL_VERSION } from '../../src/core/signals/ArrowSignalEngine.js'
import type { ArrowSignal, ArrowSide } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayArrowSignals } from '../../src/core/signals/ArrowTradeReplay.js'
import type { ArrowTrade, ArrowModeConfig } from '../../src/core/signals/ArrowTradeReplay.js'

interface Series { key: string; file: string; authorRefR: number; authorWR: number; authorAvgStopPct: number; authorTrades: number }

const SERIES: Series[] = [
	{ key: 'LDO 15m', file: 'csv/BINANCE_LDOUSDT, 15.csv', authorRefR: 15.25, authorWR: 62.9, authorAvgStopPct: 1.86, authorTrades: 89 },
	{ key: 'AVAX 5m', file: 'csv/BINANCE_AVAXUSDT, 5.csv', authorRefR: 12.62, authorWR: 91.0, authorAvgStopPct: 1.70, authorTrades: 67 },
	{ key: 'ONDO 5m', file: 'csv/BINANCE_ONDOUSDT, 5.csv', authorRefR: 12.12, authorWR: 83.7, authorAvgStopPct: 2.14, authorTrades: 92 },
	{ key: 'VIRTUAL 5m spot', file: 'csv/BINANCE_VIRTUALUSDT, 5.csv', authorRefR: 15.24, authorWR: 78.7, authorAvgStopPct: 1.58, authorTrades: 108 },
]

const STOP_GRID = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5]
const COST_BPS = [0, 5, 7, 10]

const num = (x: string | undefined): number => { const n = Number((x ?? '').trim()); return Number.isFinite(n) ? n : NaN }

interface Loaded { candles: Candle[]; shapes: Array<{ i: number; side: 'buy' | 'sell' }> }

function loadCsv(file: string): Loaded {
	const lines = readFileSync(resolve(file), 'utf8').split(/\r?\n/).filter((l) => l.length > 0)
	const candles: Candle[] = []
	const shapes: Array<{ i: number; side: 'buy' | 'sell' }> = []
	for (let li = 1; li < lines.length; li++) {
		const p = lines[li]!.split(',')
		if (p.length < 13) continue
		const ts = num(p[0]), o = num(p[1]), h = num(p[2]), l = num(p[3]), c = num(p[4])
		if (![ts, o, h, l, c].every(Number.isFinite)) continue
		const i = candles.length
		candles.push({ timestamp: ts * 1000, open: o, high: h, low: l, close: c, volume: num(p[12]) || 0 })
		const buy = (p[10] ?? '0').trim() === '1'
		const sell = (p[11] ?? '0').trim() === '1'
		if (buy) shapes.push({ i, side: 'buy' })
		else if (sell) shapes.push({ i, side: 'sell' })
	}
	return { candles, shapes }
}

function signalsFromShapes(candles: readonly Candle[], bands: ReturnType<typeof computeApexBands>, atr: readonly number[], shapes: ReadonlyArray<{ i: number; side: 'buy' | 'sell' }>): ArrowSignal[] {
	const out: ArrowSignal[] = []
	for (const s of shapes) {
		const i = s.i, candle = candles[i], band = bands[i]
		if (candle == null || band == null) continue
		if (!Number.isFinite(band.mean) || !Number.isFinite(band.s)) continue
		const a = atr[i]
		if (a == null || !Number.isFinite(a) || a <= 0) continue
		const side: ArrowSide = s.side === 'buy' ? 'long' : 'short'
		const inner = side === 'long' ? band.greenHi : band.redLo
		const outer = side === 'long' ? band.greenLo : band.redHi
		if (!Number.isFinite(inner) || !Number.isFinite(outer)) continue
		out.push({ version: ARROW_SIGNAL_VERSION, signalIndex: i, signalAt: candle.timestamp, side, close: candle.close, mean: band.mean, inner, outer, atr200: a, trigger: { family: 'own2-extension', penetrationInner: NaN, distanceMeanPct: NaN, relativeVolume: NaN } })
	}
	out.sort((x, y) => x.signalIndex - y.signalIndex)
	return out
}

interface Metrics { n: number; wr: number; totalR: number; meanR: number; pf: number | null; avgStopPct: number }
function metricsOf(trades: ArrowTrade[]): Metrics {
	const n = trades.length
	if (n === 0) return { n: 0, wr: 0, totalR: 0, meanR: 0, pf: null, avgStopPct: NaN }
	const wins = trades.filter((t) => t.netR > 0).length
	const totalR = trades.reduce((s, t) => s + t.netR, 0)
	const gains = trades.filter((t) => t.netR > 0).reduce((s, t) => s + t.netR, 0)
	const losses = -trades.filter((t) => t.netR < 0).reduce((s, t) => s + t.netR, 0)
	const pf = losses > 0 ? gains / losses : (gains > 0 ? Number.POSITIVE_INFINITY : null)
	const avgStopPct = trades.reduce((s, t) => s + Math.abs(t.entry - t.stop) / t.entry * 100, 0) / n
	return { n, wr: wins / n, totalR, meanR: totalR / n, pf, avgStopPct }
}

const BASE: Partial<ArrowModeConfig> = { fullFixAtMean: true, addEnabled: false }

function run(loaded: Loaded, override: Partial<ArrowModeConfig>): { bands: ReturnType<typeof computeApexBands>; trades: ArrowTrade[] } {
	const bands = computeApexBands([...loaded.candles], APEX_PARAMS)
	const atr = arrowAtr200(loaded.candles)
	const signals = signalsFromShapes(loaded.candles, bands, atr, loaded.shapes)
	const replay = replayArrowSignals(loaded.candles, bands, signals, 'safe', { ...BASE, ...override })
	return { bands, trades: replay.trades.filter((t) => t.outcome !== 'open') }
}

function pct(x: number): string { return Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a' }
function pf2(x: number | null): string { return x == null ? 'n/a' : (x === Number.POSITIVE_INFINITY ? '∞' : x.toFixed(2)) }
function r3(x: number): string { return Number.isFinite(x) ? x.toFixed(3) : 'n/a' }
function p2(x: number): string { return Number.isFinite(x) ? x.toFixed(2) + '%' : 'n/a' }

interface SeriesResult { s: Series; matchedStopSteps: number; matchedStopPct: number; byCost: Array<{ bps: number; m: Metrics }> }

function main() {
	const results: SeriesResult[] = []
	for (const s of SERIES) {
		let l: Loaded
		try { l = loadCsv(s.file) } catch (e) { console.log(`skip ${s.key}: ${(e as Error).message}`); continue }
		if (l.candles.length < 400) { console.log(`skip ${s.key}: rows=${l.candles.length}`); continue }
		// подобрать stopSteps, дающий реальный %-стоп ближе всего к его AvgStop (замер на gross, стоп от %-стопа не зависит по издержкам)
		let bestSteps = STOP_GRID[0]!, bestPct = NaN, bestDelta = Infinity
		for (const stopSteps of STOP_GRID) {
			const { trades } = run(l, { oneWayCostBps: 0, stopSteps })
			const m = metricsOf(trades)
			const d = Math.abs(m.avgStopPct - s.authorAvgStopPct)
			if (d < bestDelta) { bestDelta = d; bestSteps = stopSteps; bestPct = m.avgStopPct }
		}
		const byCost = COST_BPS.map((bps) => ({ bps, m: metricsOf(run(l, { oneWayCostBps: bps, stopSteps: bestSteps }).trades) }))
		results.push({ s, matchedStopSteps: bestSteps, matchedStopPct: bestPct, byCost })
		console.log(`prep ${s.key}: matched stopSteps=${bestSteps} (стоп ${p2(bestPct)} vs автор ${s.authorAvgStopPct}%)`)
	}
	if (!results.length) throw new Error('Нет загруженных SPOT CSV.')

	const md: string[] = []
	md.push('# RE11 — net-edge на ЕГО дистанции стопа (свип издержек)')
	md.push('')
	md.push('**Цель:** RE10 воспроизвёл автора в GROSS при стопе ≈ его «Avg stop». RE11 меряет то же самое NET — при уровнях издержек 0/5/7/10 bps/side (10 ≈ Binance spot taker 0.1%), чтобы ответить: остаётся ли плюс ПОСЛЕ комиссий на его узком стопе.')
	md.push('')
	md.push('> §2.1/§2.2: стоп подобран под его AvgStop (эксперимент, точное правило стопа автора неизвестно). Движок `src/core` НЕ тронут. Входы = vendor SPOT CSV shapes; геометрия — каноничные Apex-полосы. base `{fullFixAtMean:true, addEnabled:false}`, mode `safe`.')
	md.push('')
	md.push('| серия | подобр. стоп (vs автор) | N | комиссия bps/side | WR | totalR | meanR | PF |')
	md.push('|---|---|---|---|---|---|---|---|')
	for (const r of results) {
		r.byCost.forEach((c, idx) => {
			const stopCol = idx === 0 ? `${p2(r.matchedStopPct)} (автор ${r.s.authorAvgStopPct}%)` : ''
			const nCol = idx === 0 ? String(c.m.n) : ''
			const keyCol = idx === 0 ? r.s.key : ''
			md.push(`| ${keyCol} | ${stopCol} | ${nCol} | ${c.bps} | ${pct(c.m.wr)} | ${r3(c.m.totalR)} | ${r3(c.m.meanR)} | ${pf2(c.m.pf)} |`)
		})
	}
	md.push('')
	// агрегат по 4 сериям на каждом уровне издержек
	md.push('## Агрегат по сериям (сумма totalR, средневзвеш. meanR)')
	md.push('')
	md.push('| комиссия bps/side | сумма totalR | сделок | meanR (все сделки) | серий в плюсе |')
	md.push('|---|---|---|---|---|')
	for (let ci = 0; ci < COST_BPS.length; ci++) {
		const bps = COST_BPS[ci]!
		let totR = 0, totN = 0, pos = 0
		for (const r of results) { const c = r.byCost[ci]!; totR += c.m.totalR; totN += c.m.n; if (c.m.totalR > 0) pos++ }
		md.push(`| ${bps} | ${r3(totR)} | ${totN} | ${r3(totN ? totR / totN : 0)} | ${pos}/${results.length} |`)
	}
	md.push('')
	md.push('## Вывод (черновой)')
	md.push('')
	const grossAgg = results.reduce((a, r) => a + r.byCost[0]!.m.totalR, 0)
	const spotAgg = results.reduce((a, r) => a + r.byCost[COST_BPS.length - 1]!.m.totalR, 0)
	md.push(`- **Gross (0 bps) агрегат:** ${r3(grossAgg)}R — воспроизводит масштаб автора (сумма его реф ~+55R по 4 сериям, у нас на подобранном стопе — см. таблицу).`)
	md.push(`- **Spot taker (10 bps/side) агрегат:** ${r3(spotAgg)}R. Разница gross→spot = стоимость комиссий на узком стопе.`)
	md.push('- **Читать по строкам:** если на 7–10 bps meanR по сериям остаётся > 0 — edge переживает реалистичные спот-издержки; если схлопывается в ноль/минус — «плюс» автора во многом gross-артефакт узкого стопа (его же оговорка).')
	md.push('')
	md.push('_Оговорки: подобранный стоп кратен ATR-шагу (не точное правило автора); издержки — симметричный taker-прокси, без funding (спот) и без учёта скидок BNB; геометрия — каноничные Apex-полосы._')
	md.push('')
	writeFileSync(resolve('ci-results/re11-vendor-net-edge.md'), md.join('\n'))

	const jsonOut = {
		generatedAt: new Date().toISOString(),
		note: 'NET edge at stop matched to author AvgStop, cost sweep 0/5/7/10 bps/side. Entries = vendor SPOT CSV shapes; base {fullFixAtMean:true, addEnabled:false}, mode safe.',
		costBps: COST_BPS,
		series: results.map((r) => ({ key: r.s.key, author: { refR: r.s.authorRefR, wr: r.s.authorWR, avgStopPct: r.s.authorAvgStopPct, trades: r.s.authorTrades }, matchedStopSteps: r.matchedStopSteps, matchedStopPct: r.matchedStopPct, byCost: r.byCost })),
	}
	writeFileSync(resolve('ci-results/re11-vendor-net-edge.json'), JSON.stringify(jsonOut, null, 2))

	console.log('\n=== RE11 net-edge at author stop ===')
	for (const r of results) {
		console.log(`  ${r.s.key} (стоп ${p2(r.matchedStopPct)} vs автор ${r.s.authorAvgStopPct}%, N=${r.byCost[0]!.m.n}, автор +${r.s.authorRefR}R):`)
		for (const c of r.byCost) console.log(`     ${c.bps} bps/side: WR=${pct(c.m.wr)} totalR=${r3(c.m.totalR)} meanR=${r3(c.m.meanR)} PF=${pf2(c.m.pf)}`)
	}
	console.log('Агрегат totalR по уровням издержек:')
	for (let ci = 0; ci < COST_BPS.length; ci++) { let t = 0; for (const r of results) t += r.byCost[ci]!.m.totalR; console.log(`  ${COST_BPS[ci]} bps/side: ${r3(t)}R`) }
	console.log('Записано: ci-results/re11-vendor-net-edge.{md,json}')
}

main()
