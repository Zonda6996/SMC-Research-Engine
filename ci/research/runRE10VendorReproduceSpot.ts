/**
 * RE10 — reproduce автора: full-fix-at-mean на РЕАЛЬНЫХ вендор-стрелках его SPOT-активов,
 * с разложением NET vs GROSS и свипом дистанции стопа.
 *
 * Мотив (RE9): на VIRTUAL WR совпал с таблицей автора (80.0% vs 78.7%) ⇒ логика входа/выхода
 * воспроизведена, но итог в R разошёлся (+1.54R наш vs +15.24R автор). Две гипотезы разрыва:
 *   (1) издержки — движок вычитает 7 bps/side, таблицы автора gross;
 *   (2) дистанция стопа — наш канон 2×step ≠ его фиксированный «Avg stop» ~1.6–2.1%.
 * RE10 проверяет обе на его СПОТ-CSV: NET-2× (как RE9), GROSS-2× (oneWayCostBps=0), и GROSS-свип
 * по stopSteps с замером РЕАЛЬНОГО %-стопа (|entry−stop|/entry), чтобы найти строку, где наш
 * %-стоп ≈ его AvgStop, и сравнить R с его референсом.
 *
 * §2.1/§2.2: правила анализа НЕ придумываются. Свип стопа — ЭКСПЕРИМЕНТ (точное правило стопа
 * автора неизвестно; известны только тейк=mean и отсутствие add/partial). Движок src/core НЕ тронут —
 * всё через config-override к replayArrowSignals. Геометрия — каноничные Apex-полосы (RE3: ~0.05% к линиям вендора).
 *
 * Запуск: npx tsx ci/research/runRE10VendorReproduceSpot.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { arrowAtr200, ARROW_SIGNAL_VERSION } from '../../src/core/signals/ArrowSignalEngine.js'
import type { ArrowSignal, ArrowSide } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayArrowSignals } from '../../src/core/signals/ArrowTradeReplay.js'
import type { ArrowTrade, ArrowModeConfig } from '../../src/core/signals/ArrowTradeReplay.js'

interface Series {
	key: string
	file: string
	authorRefR: number
	authorWR: number
	authorAvgStopPct: number
	authorTrades: number
}

const SERIES: Series[] = [
	{ key: 'LDO 15m', file: 'csv/BINANCE_LDOUSDT, 15.csv', authorRefR: 15.25, authorWR: 62.9, authorAvgStopPct: 1.86, authorTrades: 89 },
	{ key: 'AVAX 5m', file: 'csv/BINANCE_AVAXUSDT, 5.csv', authorRefR: 12.62, authorWR: 91.0, authorAvgStopPct: 1.70, authorTrades: 67 },
	{ key: 'ONDO 5m', file: 'csv/BINANCE_ONDOUSDT, 5.csv', authorRefR: 12.12, authorWR: 83.7, authorAvgStopPct: 2.14, authorTrades: 92 },
	{ key: 'VIRTUAL 5m spot', file: 'csv/BINANCE_VIRTUALUSDT, 5.csv', authorRefR: 15.24, authorWR: 78.7, authorAvgStopPct: 1.58, authorTrades: 108 },
]

const STOP_SWEEP = [0.5, 0.75, 1, 1.5, 2, 3]

const num = (x: string | undefined): number => { const n = Number((x ?? '').trim()); return Number.isFinite(n) ? n : NaN }

interface Loaded {
	candles: Candle[]
	shapes: Array<{ i: number; side: 'buy' | 'sell' }>
}

/** col0=ts(sec)→*1000; cols 1-4 OHLC; col10=buy, col11=sell, col12=volume (как в RE9/CSV вендора). */
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

/** Входы = vendor CSV shapes напрямую (buy→long, sell→short); поля ArrowSignal из свечи + каноничных Apex-полос. */
function signalsFromShapes(
	candles: readonly Candle[],
	bands: ReturnType<typeof computeApexBands>,
	atr: readonly number[],
	shapes: ReadonlyArray<{ i: number; side: 'buy' | 'sell' }>,
): ArrowSignal[] {
	const out: ArrowSignal[] = []
	for (const s of shapes) {
		const i = s.i
		const candle = candles[i]
		const band = bands[i]
		if (candle == null || band == null) continue
		if (!Number.isFinite(band.mean) || !Number.isFinite(band.s)) continue
		const a = atr[i]
		if (a == null || !Number.isFinite(a) || a <= 0) continue
		const side: ArrowSide = s.side === 'buy' ? 'long' : 'short'
		const inner = side === 'long' ? band.greenHi : band.redLo
		const outer = side === 'long' ? band.greenLo : band.redHi
		if (!Number.isFinite(inner) || !Number.isFinite(outer)) continue
		out.push({
			version: ARROW_SIGNAL_VERSION,
			signalIndex: i,
			signalAt: candle.timestamp,
			side,
			close: candle.close,
			mean: band.mean,
			inner,
			outer,
			atr200: a,
			trigger: { family: 'own2-extension', penetrationInner: NaN, distanceMeanPct: NaN, relativeVolume: NaN },
		})
	}
	out.sort((x, y) => x.signalIndex - y.signalIndex)
	return out
}

interface SideMetrics { n: number; totalR: number; meanR: number }
interface Metrics {
	n: number
	wr: number
	vendorWr: number
	totalR: number
	meanR: number
	pf: number | null
	avgStopPct: number // mean(|entry-stop|/entry*100) — реальная дистанция стопа
	long: SideMetrics
	short: SideMetrics
}

function sideMetrics(trades: ArrowTrade[]): SideMetrics {
	const n = trades.length
	const totalR = trades.reduce((s, t) => s + t.netR, 0)
	return { n, totalR, meanR: n ? totalR / n : 0 }
}

function metricsOf(trades: ArrowTrade[]): Metrics {
	const n = trades.length
	if (n === 0) return { n: 0, wr: 0, vendorWr: 0, totalR: 0, meanR: 0, pf: null, avgStopPct: NaN, long: { n: 0, totalR: 0, meanR: 0 }, short: { n: 0, totalR: 0, meanR: 0 } }
	const wins = trades.filter((t) => t.netR > 0).length
	const vendorWins = trades.filter((t) => t.outcome === 'full-tp' || t.outcome === 'partial-be').length
	const totalR = trades.reduce((s, t) => s + t.netR, 0)
	const gains = trades.filter((t) => t.netR > 0).reduce((s, t) => s + t.netR, 0)
	const losses = -trades.filter((t) => t.netR < 0).reduce((s, t) => s + t.netR, 0)
	const pf = losses > 0 ? gains / losses : (gains > 0 ? Number.POSITIVE_INFINITY : null)
	const avgStopPct = trades.reduce((s, t) => s + Math.abs(t.entry - t.stop) / t.entry * 100, 0) / n
	return {
		n, wr: wins / n, vendorWr: vendorWins / n, totalR, meanR: totalR / n, pf, avgStopPct,
		long: sideMetrics(trades.filter((t) => t.side === 'long')),
		short: sideMetrics(trades.filter((t) => t.side === 'short')),
	}
}

const BASE: Partial<ArrowModeConfig> = { fullFixAtMean: true, addEnabled: false }

function runSeries(loaded: Loaded, override: Partial<ArrowModeConfig>): Metrics {
	const bands = computeApexBands([...loaded.candles], APEX_PARAMS)
	const atr = arrowAtr200(loaded.candles)
	const signals = signalsFromShapes(loaded.candles, bands, atr, loaded.shapes)
	const replay = replayArrowSignals(loaded.candles, bands, signals, 'safe', { ...BASE, ...override })
	const finalized = replay.trades.filter((t) => t.outcome !== 'open')
	return metricsOf(finalized)
}

function pct(x: number): string { return Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a' }
function pf2(x: number | null): string { return x == null ? 'n/a' : (x === Number.POSITIVE_INFINITY ? '∞' : x.toFixed(2)) }
function r3(x: number): string { return Number.isFinite(x) ? x.toFixed(3) : 'n/a' }
function p2(x: number): string { return Number.isFinite(x) ? x.toFixed(2) + '%' : 'n/a' }

function main() {
	const loaded: Array<{ s: Series; l: Loaded }> = []
	for (const s of SERIES) {
		let l: Loaded
		try { l = loadCsv(s.file) } catch (e) { console.log(`skip ${s.key}: ${(e as Error).message}`); continue }
		if (l.candles.length < 400) { console.log(`skip ${s.key}: rows=${l.candles.length}`); continue }
		loaded.push({ s, l })
		console.log(`prep ${s.key}: candles=${l.candles.length} vendorShapes=${l.shapes.length}`)
	}
	if (!loaded.length) throw new Error('Нет загруженных SPOT CSV из csv/.')

	const net2x = loaded.map(({ s, l }) => ({ s, m: runSeries(l, {}) }))
	const gross2x = loaded.map(({ s, l }) => ({ s, m: runSeries(l, { oneWayCostBps: 0 }) }))
	const sweep = loaded.map(({ s, l }) => ({
		s,
		rows: STOP_SWEEP.map((stopSteps) => ({ stopSteps, m: runSeries(l, { oneWayCostBps: 0, stopSteps }) })),
	}))

	const md: string[] = []
	md.push('# RE10 — reproduce автора: full-fix-at-mean на SPOT-стрелках (NET vs GROSS + свип стопа)')
	md.push('')
	md.push('**Цель:** воспроизвести референс автора, кормя его РЕАЛЬНЫЕ стрелки (CSV shapes его SPOT-активов) в канон-реплей. Разложить разрыв R (RE9: WR совпал, R — нет) на **издержки** (NET vs GROSS) и **дистанцию стопа** (свип stopSteps с замером реального %-стопа).')
	md.push('')
	md.push('> §2.1/§2.2: свип стопа — эксперимент (точное правило стопа автора неизвестно; тейк=mean, add/partial нет). Движок `src/core` НЕ тронут — только config-override. Входы: vendor CSV shapes (col10 buy / col11 sell), buy→long/sell→short; геометрия — каноничные Apex-полосы (RE3 ~0.05% к линиям вендора). Реальный %-стоп = `|entry−stop|/entry`. arm base = `{fullFixAtMean:true, addEnabled:false}`, mode `safe`.')
	md.push('')

	md.push('## 1. NET, канон стоп 2× (как RE9, издержки 7 bps/side) — рядом с референсом автора')
	md.push('')
	md.push('| серия | N | WR | vendorWR | totalR | meanR | PF | наш %-стоп | автор R | автор WR | автор %-стоп | автор N |')
	md.push('|---|---|---|---|---|---|---|---|---|---|---|---|')
	for (const { s, m } of net2x) {
		md.push(`| ${s.key} | ${m.n} | ${pct(m.wr)} | ${pct(m.vendorWr)} | ${r3(m.totalR)} | ${r3(m.meanR)} | ${pf2(m.pf)} | ${p2(m.avgStopPct)} | +${s.authorRefR}R | ${s.authorWR}% | ${s.authorAvgStopPct}% | ${s.authorTrades} |`)
	}
	md.push('')

	md.push('## 2. GROSS, канон стоп 2× (издержки = 0) — рядом с референсом автора')
	md.push('')
	md.push('| серия | N | WR | vendorWR | totalR | meanR | PF | наш %-стоп | автор R | автор WR | автор %-стоп |')
	md.push('|---|---|---|---|---|---|---|---|---|---|---|')
	for (const { s, m } of gross2x) {
		md.push(`| ${s.key} | ${m.n} | ${pct(m.wr)} | ${pct(m.vendorWr)} | ${r3(m.totalR)} | ${r3(m.meanR)} | ${pf2(m.pf)} | ${p2(m.avgStopPct)} | +${s.authorRefR}R | ${s.authorWR}% | ${s.authorAvgStopPct}% |`)
	}
	md.push('')

	md.push('## 3. GROSS свип стопа (stopSteps) — ★ = строка, где наш %-стоп ближе всего к «Avg stop» автора')
	md.push('')
	for (const { s, rows } of sweep) {
		let bestIdx = 0
		let bestDelta = Infinity
		rows.forEach((r, idx) => { const d = Math.abs(r.m.avgStopPct - s.authorAvgStopPct); if (d < bestDelta) { bestDelta = d; bestIdx = idx } })
		md.push(`### ${s.key} — автор: +${s.authorRefR}R, WR ${s.authorWR}%, Avg stop ${s.authorAvgStopPct}%, ${s.authorTrades} сделок`)
		md.push('')
		md.push('| | stopSteps | наш %-стоп | N | WR | vendorWR | totalR | meanR | PF |')
		md.push('|---|---|---|---|---|---|---|---|---|')
		rows.forEach((r, idx) => {
			const mark = idx === bestIdx ? '★' : ''
			md.push(`| ${mark} | ${r.stopSteps} | ${p2(r.m.avgStopPct)} | ${r.m.n} | ${pct(r.m.wr)} | ${pct(r.m.vendorWr)} | ${r3(r.m.totalR)} | ${r3(r.m.meanR)} | ${pf2(r.m.pf)} |`)
		})
		const best = rows[bestIdx]!
		md.push('')
		md.push(`- ★ ближайший к автору (${s.authorAvgStopPct}%): stopSteps=${best.stopSteps}, наш %-стоп ${p2(best.m.avgStopPct)}, totalR **${r3(best.m.totalR)}** vs автор **+${s.authorRefR}R** (WR ${pct(best.m.wr)} vs ${s.authorWR}%).`)
		md.push('')
	}

	md.push('## 4. Вывод (черновой)')
	md.push('')
	const deltaCost = net2x.map((x, i) => gross2x[i]!.m.totalR - x.m.totalR)
	const avgCostLift = deltaCost.reduce((a, b) => a + b, 0) / deltaCost.length
	md.push(`- **Издержки (NET→GROSS):** снятие 7 bps/side поднимает totalR в среднем на +${r3(avgCostLift)}R на серию (по 4 сериям). Таблицы автора — gross, поэтому корректно сравнивать именно GROSS.`)
	md.push('- **Дистанция стопа:** см. §3 — строка ★ показывает наш результат при %-стопе ≈ его «Avg stop». Если там gross totalR приближается к его референсу — разрыв объясняется издержками + риск-юнитом, а не качеством сигнала (WR уже совпадал в RE9/§1–2).')
	md.push('- **Что остаётся неизвестным:** точное правило стопа автора (у нас стоп кратен ATR-шагу, у него — фиксированный %); при равной дистанции стопа набор стоп-аутов может слегка отличаться.')
	md.push('')
	md.push('_Оговорки: фид — SPOT-CSV автора (LDO 15m, AVAX/ONDO/VIRTUAL 5m). Геометрия зоны — каноничные Apex-полосы (RE3 ~0.05% к линиям вендора). Свип стопа — эксперимент, не восстановленное правило автора._')
	md.push('')

	writeFileSync(resolve('ci-results/re10-vendor-reproduce-spot.md'), md.join('\n'))

	const jsonOut = {
		generatedAt: new Date().toISOString(),
		note: 'Entries = vendor SPOT CSV shapes directly (NOT via OWN2 detector). buy→long, sell→short. base override {fullFixAtMean:true, addEnabled:false}, mode safe. GROSS = oneWayCostBps:0. avgStopPct = mean(|entry-stop|/entry*100).',
		series: SERIES,
		net2x: net2x.map(({ s, m }) => ({ key: s.key, author: { refR: s.authorRefR, wr: s.authorWR, avgStopPct: s.authorAvgStopPct, trades: s.authorTrades }, metrics: m })),
		gross2x: gross2x.map(({ s, m }) => ({ key: s.key, author: { refR: s.authorRefR, wr: s.authorWR, avgStopPct: s.authorAvgStopPct, trades: s.authorTrades }, metrics: m })),
		grossSweep: sweep.map(({ s, rows }) => ({ key: s.key, author: { refR: s.authorRefR, wr: s.authorWR, avgStopPct: s.authorAvgStopPct, trades: s.authorTrades }, rows: rows.map((r) => ({ stopSteps: r.stopSteps, metrics: r.m })) })),
	}
	writeFileSync(resolve('ci-results/re10-vendor-reproduce-spot.json'), JSON.stringify(jsonOut, null, 2))

	console.log('\n=== RE10 vendor reproduce (SPOT) ===')
	console.log('NET 2× (7 bps/side):')
	for (const { s, m } of net2x) console.log(`  ${s.key}: N=${m.n} WR=${pct(m.wr)} totalR=${r3(m.totalR)} meanR=${r3(m.meanR)} ourStop=${p2(m.avgStopPct)} | author +${s.authorRefR}R WR${s.authorWR}% stop${s.authorAvgStopPct}%`)
	console.log('GROSS 2× (costs=0):')
	for (const { s, m } of gross2x) console.log(`  ${s.key}: N=${m.n} WR=${pct(m.wr)} totalR=${r3(m.totalR)} meanR=${r3(m.meanR)} ourStop=${p2(m.avgStopPct)} | author +${s.authorRefR}R`)
	console.log('GROSS stop-sweep (★=closest to author Avg stop):')
	for (const { s, rows } of sweep) {
		let bestIdx = 0, bestDelta = Infinity
		rows.forEach((r, idx) => { const d = Math.abs(r.m.avgStopPct - s.authorAvgStopPct); if (d < bestDelta) { bestDelta = d; bestIdx = idx } })
		console.log(`  ${s.key} (author +${s.authorRefR}R @ ${s.authorAvgStopPct}%):`)
		rows.forEach((r, idx) => console.log(`     ${idx === bestIdx ? '★' : ' '} stopSteps=${r.stopSteps} ourStop=${p2(r.m.avgStopPct)} N=${r.m.n} WR=${pct(r.m.wr)} totalR=${r3(r.m.totalR)}`))
	}
	console.log('Записано: ci-results/re10-vendor-reproduce-spot.{md,json}')
}

main()
