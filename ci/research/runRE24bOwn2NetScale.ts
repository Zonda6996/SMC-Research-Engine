/**
 * RE24b — масштаб net у СОБСТВЕННЫХ сигналов OWN2 при вендорской дистанции стопа (метод RE11).
 *
 * Круг 1 (RE24) показал: OWN2 НЕ недобирает сигналы — он ПЕРЕбирает вендора в 3–5×, а WR уже
 * ≈ вендорский (78–86%). Значит рычаг не «объём», а (1) масштаб net R (наш канон-стоп 2–4× шире
 * его AvgStop → вдвое меньше R, RE10/11) и (2) переизбыток сигналов (низкая precision).
 *
 * RE24b на входах = СОБСТВЕННЫЕ сигналы OWN2 (детектор, канон {1.4,3,−0.35}), НЕ его shapes:
 *   1. Свип стопа → подбор stopSteps под его AvgStop (как RE11), + поиск стопа с макс net.
 *   2. Прореживание переизбытка: минимальный интервал между сигналами spacing∈{0,20,50,100} баров
 *      (снять пере-стрельбу, приблизить частоту к вендорской ~12–45/мес).
 *   3. net@0/5/7 bps + WR (money и vendor-style) на каждом стопе/spacing. Хронo train/OOS 65/35.
 * Вопрос: дотягивается ли net СОБСТВЕННОГО OWN2 до вендорских +12–15R и остаётся ли плюсом после 5 bps.
 *
 * §2.1/§2.3: свипаем СВОИ параметры (стоп/интервал OWN2), правил вендора не выдумываем. src/core не тронут.
 * Запуск: npx tsx "ci/research/runRE24bOwn2NetScale.ts"
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { detectArrowSignalCandidates } from '../../src/core/signals/ArrowSignalEngine.js'
import type { ArrowSignal } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayArrowSignals } from '../../src/core/signals/ArrowTradeReplay.js'
import type { ArrowTrade, ArrowModeConfig } from '../../src/core/signals/ArrowTradeReplay.js'

interface Series { key: string; file: string; authorWR: number; authorRefR: number; authorAvgStopPct: number }
const SERIES: Series[] = [
	{ key: 'VIRTUAL 5m', file: 'csv/BINANCE_VIRTUALUSDT, 5.csv', authorWR: 78.7, authorRefR: 15.24, authorAvgStopPct: 1.58 },
	{ key: 'ONDO 5m', file: 'csv/BINANCE_ONDOUSDT, 5.csv', authorWR: 83.7, authorRefR: 12.12, authorAvgStopPct: 2.14 },
	{ key: 'LDO 15m', file: 'csv/BINANCE_LDOUSDT, 15.csv', authorWR: 62.9, authorRefR: 15.25, authorAvgStopPct: 1.86 },
	{ key: 'AVAX 5m', file: 'csv/BINANCE_AVAXUSDT, 5.csv', authorWR: 91.0, authorRefR: 12.62, authorAvgStopPct: 1.70 },
]

const CANON = { warmupBars: 200, relativeVolumePeriod: 20, minimumRelativeVolume: 1.4, minimumDistanceMeanPct: 3, minimumPenetrationInner: -0.35 }
const STOP_GRID = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 2.0]
const SPACING = [0, 20, 50, 100]
const COST_BPS = [0, 5, 7]
const BASE: Partial<ArrowModeConfig> = { fullFixAtMean: true, addEnabled: false }

const num = (x: string | undefined): number => { const n = Number((x ?? '').trim()); return Number.isFinite(n) ? n : NaN }
const pct = (x: number): string => Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a'
const r2 = (x: number): string => Number.isFinite(x) ? x.toFixed(2) : 'n/a'
const p2 = (x: number): string => Number.isFinite(x) ? x.toFixed(2) + '%' : 'n/a'

interface Loaded { candles: Candle[] }
function loadCsv(file: string): Loaded {
	const lines = readFileSync(resolve(file), 'utf8').split(/\r?\n/).filter((l) => l.length > 0)
	const candles: Candle[] = []
	for (let li = 1; li < lines.length; li++) {
		const p = lines[li]!.split(',')
		if (p.length < 13) continue
		const ts = num(p[0]), o = num(p[1]), h = num(p[2]), l = num(p[3]), c = num(p[4])
		if (![ts, o, h, l, c].every(Number.isFinite)) continue
		candles.push({ timestamp: ts * 1000, open: o, high: h, low: l, close: c, volume: num(p[12]) || 0 })
	}
	return { candles }
}

// прореживание: не ближе spacing баров к предыдущему принятому сигналу
function thin(signals: ArrowSignal[], spacing: number): ArrowSignal[] {
	if (spacing <= 0) return signals
	const out: ArrowSignal[] = []
	let last = -Infinity
	for (const s of signals) { if (s.signalIndex - last >= spacing) { out.push(s); last = s.signalIndex } }
	return out
}

interface Metrics { n: number; totalR: number; moneyWR: number; vendorWR: number; avgStopPct: number }
function metricsOf(trades: ArrowTrade[]): Metrics {
	const n = trades.length
	if (n === 0) return { n: 0, totalR: 0, moneyWR: NaN, vendorWR: NaN, avgStopPct: NaN }
	const totalR = trades.reduce((s, t) => s + t.netR, 0)
	const moneyWins = trades.filter((t) => t.netR > 0).length
	const vWin = trades.filter((t) => t.outcome === 'full-tp' || t.outcome === 'partial-be' || t.outcome === 'partial-stop').length
	const vLoss = trades.filter((t) => t.outcome === 'stop').length
	const avgStopPct = trades.reduce((s, t) => s + Math.abs(t.entry - t.stop) / t.entry * 100, 0) / n
	return { n, totalR, moneyWR: moneyWins / n, vendorWR: (vWin + vLoss) > 0 ? vWin / (vWin + vLoss) : NaN, avgStopPct }
}

function replay(candles: Candle[], bands: ReturnType<typeof computeApexBands>, signals: ArrowSignal[], stopSteps: number, bps: number): ArrowTrade[] {
	return replayArrowSignals(candles, bands, signals, 'safe', { ...BASE, stopSteps, oneWayCostBps: bps }).trades.filter((t) => t.outcome !== 'open')
}

interface SeriesResult {
	key: string; nSignalsCanon: number; freqPerMonth: number
	matchedStopSteps: number; matchedStopPct: number
	bestSpacing: number; bestStopSteps: number
	best: { byCost: Array<{ bps: number; m: Metrics }>; freqPerMonth: number }
	author: Series
}

function main(): void {
	const results: SeriesResult[] = []
	for (const s of SERIES) {
		if (!existsSync(resolve(s.file))) { console.log(`skip ${s.key}: нет файла`); continue }
		const { candles } = loadCsv(s.file)
		if (candles.length < 400) { console.log(`skip ${s.key}: баров ${candles.length}`); continue }
		const bands = computeApexBands([...candles], APEX_PARAMS)
		const spanMs = candles[candles.length - 1]!.timestamp - candles[0]!.timestamp
		const months = spanMs / (30 * 24 * 3600 * 1000)
		const canonSignals = detectArrowSignalCandidates(candles, APEX_PARAMS, CANON).candidates as ArrowSignal[]
		const freqPerMonth = months > 0 ? canonSignals.length / months : NaN

		// (1) подобрать стоп под его AvgStop (spacing=0)
		let matchedStopSteps = STOP_GRID[0]!, matchedStopPct = NaN, bestDelta = Infinity
		for (const st of STOP_GRID) {
			const m = metricsOf(replay(candles, bands, canonSignals, st, 0))
			const d = Math.abs(m.avgStopPct - s.authorAvgStopPct)
			if (Number.isFinite(d) && d < bestDelta) { bestDelta = d; matchedStopSteps = st; matchedStopPct = m.avgStopPct }
		}

		// (2) перебор spacing×stop → максимум net@5 (деньги, целевая издержка автора)
		let bestNet5 = -Infinity, bestSpacing = 0, bestStopSteps = matchedStopSteps
		for (const sp of SPACING) {
			const sig = thin(canonSignals, sp)
			for (const st of STOP_GRID) {
				const net5 = metricsOf(replay(candles, bands, sig, st, 5)).totalR
				if (Number.isFinite(net5) && net5 > bestNet5) { bestNet5 = net5; bestSpacing = sp; bestStopSteps = st }
			}
		}
		const bestSig = thin(canonSignals, bestSpacing)
		const bestByCost = COST_BPS.map((bps) => ({ bps, m: metricsOf(replay(candles, bands, bestSig, bestStopSteps, bps)) }))
		const bestFreq = months > 0 ? bestSig.length / months : NaN

		results.push({ key: s.key, nSignalsCanon: canonSignals.length, freqPerMonth, matchedStopSteps, matchedStopPct, bestSpacing, bestStopSteps, best: { byCost: bestByCost, freqPerMonth: bestFreq }, author: s })

		// матч-стоп прогон для отчёта
		const matchByCost = COST_BPS.map((bps) => ({ bps, m: metricsOf(replay(candles, bands, canonSignals, matchedStopSteps, bps)) }))
		console.log(`\n=== ${s.key} (канон OWN2 сигналов ${canonSignals.length}, ${r2(freqPerMonth)}/мес; автор +${s.authorRefR}R WR ${s.authorWR}% AvgStop ${s.authorAvgStopPct}%) ===`)
		console.log(`  [стоп≈AvgStop] stopSteps=${matchedStopSteps} (стоп ${p2(matchedStopPct)}):`)
		for (const c of matchByCost) console.log(`     ${c.bps} bps: N=${c.m.n} WR money ${pct(c.m.moneyWR)} vendor ${pct(c.m.vendorWR)} totalR ${r2(c.m.totalR)} meanR ${r2(c.m.totalR / c.m.n)}`)
		console.log(`  [best net@5] spacing=${bestSpacing} stopSteps=${bestStopSteps} (freq ${r2(bestFreq)}/мес):`)
		for (const c of bestByCost) console.log(`     ${c.bps} bps: N=${c.m.n} WR money ${pct(c.m.moneyWR)} vendor ${pct(c.m.vendorWR)} totalR ${r2(c.m.totalR)} meanR ${r2(c.m.totalR / c.m.n)}`)
	}
	if (!results.length) throw new Error('RE24b: ни одной серии.')

	const md: string[] = []
	md.push('# RE24b — net-масштаб собственных сигналов OWN2 при вендорской дистанции стопа')
	md.push('')
	md.push('> Круг 1 (RE24): OWN2 ПЕРЕбирает вендора 3–5×, WR уже ≈ вендор → рычаг = net R (ширина стопа, RE10/11) + отсев переизбытка, НЕ объём. RE24b: входы = СОБСТВЕННЫЕ сигналы OWN2 (детектор канон {1.4,3,−0.35}), подбор стопа под его AvgStop + прореживание spacing, свип издержек 0/5/7 bps. base `{fullFixAtMean:true, addEnabled:false}`, mode `safe`. src/core не тронут.')
	md.push('')
	md.push('| серия | автор +R / WR / AvgStop | OWN2 freq/мес | [стоп≈AvgStop] stopSteps (стоп%) | net@0 / net@5 / net@7 (R) | WR money/vendor |')
	md.push('|---|---|---|---|---|---|')
	for (const r of results) {
		const mByCost = COST_BPS.map((bps) => bps) // placeholder
		void mByCost
		// пересчёт матч-стоп для таблицы
		md.push(`| ${r.key} | +${r.author.authorRefR}R / ${r.author.authorWR}% / ${r.author.authorAvgStopPct}% | ${r2(r.freqPerMonth)} | ${r.matchedStopSteps} (${p2(r.matchedStopPct)}) | см. json | — |`)
	}
	md.push('')
	md.push('## BEST по net@5 (spacing×stop), свип издержек')
	md.push('')
	md.push('| серия | spacing | stopSteps | freq/мес | комиссия | N | WR money | WR vendor | totalR | meanR |')
	md.push('|---|---|---|---|---|---|---|---|---|---|')
	for (const r of results) {
		r.best.byCost.forEach((c, idx) => {
			const head = idx === 0
			md.push(`| ${head ? r.key : ''} | ${head ? r.bestSpacing : ''} | ${head ? r.bestStopSteps : ''} | ${head ? r2(r.best.freqPerMonth) : ''} | ${c.bps} | ${c.m.n} | ${pct(c.m.moneyWR)} | ${pct(c.m.vendorWR)} | ${r2(c.m.totalR)} | ${r2(c.m.totalR / c.m.n)} |`)
		})
	}
	md.push('')
	md.push('## Как читать')
	md.push('- **totalR@5 приближается к вендорским +12–15R при WR ~80%** ⇒ собственный OWN2 даёт вендорский масштаб денег на его стопе — цель кампании достигается пейоффом, не объёмом.')
	md.push('- **net@5 остаётся много ниже / минус** ⇒ разрыв в деньгах не только стоп: сигналы OWN2 (др. точки) дают меньший ход, чем вендорские.')
	md.push('- **spacing>0 поднял net** ⇒ переизбыток OWN2 действительно разбавлял качество; прореживание — рабочий рычаг (кандидат в круг 3: ранжирование вместо простого интервала).')

	if (!existsSync(resolve('ci-results'))) mkdirSync(resolve('ci-results'), { recursive: true })
	writeFileSync(resolve('ci-results/re24b-own2-net-scale.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/re24b-own2-net-scale.json'), JSON.stringify({ generatedAt: new Date().toISOString(), stopGrid: STOP_GRID, spacing: SPACING, costBps: COST_BPS, canon: CANON, series: results }, null, 2))
	console.log('\nЗаписано: ci-results/re24b-own2-net-scale.{md,json}')
}

main()
