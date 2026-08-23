/**
 * RE16 — Фаза 1c: расширенный свип ширины стопа для static-full + МЕТРИКИ ХВОСТОВОГО РИСКА.
 *
 * RE15: static-full (цель 2×step хардкод) с широким стопом впервые дал агрегат-плюс на stop=3 (край сетки).
 * Здесь два действия автора:
 *   (1) расширяем сетку стопа: 1.0 … 5.0 — понять, плато это или «убегающий» оптимум (иллюзия широкого стопа);
 *   (2) добавляем риск-метрики: макс-просадка (R), худшая сделка (R), отношение totalR/maxDD —
 *       чтобы поймать хвостовой риск, который meanR маскирует.
 *
 * Рука: режим safe, static-full, partialFraction 0, добор on; admitted-реплей. Издержки 5 bps/side.
 * OOS = последние 35% сделок. ⚠ Множитель ЦЕЛИ по-прежнему захардкожен 2×step (не config). src/core НЕ тронут.
 *
 * Запуск: npx tsx "ci/research/runRE16StaticStopRisk.ts"
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS, type ApexBand } from '../../src/core/signals/ApexEngine.js'
import { arrowAtr200, ARROW_SIGNAL_VERSION } from '../../src/core/signals/ArrowSignalEngine.js'
import type { ArrowSignal, ArrowSide } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayAdmittedArrowSignals } from '../../src/core/signals/ArrowTradeReplay.js'
import type { ArrowTrade, ArrowModeConfig } from '../../src/core/signals/ArrowTradeReplay.js'

const STOP_GRID = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0]
const OOS_FRACTION = 0.35
const ARM: Partial<ArrowModeConfig> = { management: 'static-full', partialFraction: 0, addEnabled: true }

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
		if ((p[10] ?? '0').trim() === '1') shapes.push({ i, side: 'buy' })
		else if ((p[11] ?? '0').trim() === '1') shapes.push({ i, side: 'sell' })
	}
	return { candles, shapes }
}
function signalsFromShapes(candles: readonly Candle[], bands: readonly ApexBand[], atr: readonly number[], shapes: ReadonlyArray<{ i: number; side: 'buy' | 'sell' }>): ArrowSignal[] {
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
interface Prep { candles: Candle[]; bands: ApexBand[]; signals: ArrowSignal[] }
function prep(l: Loaded): Prep {
	const bands = computeApexBands([...l.candles], APEX_PARAMS)
	const atr = arrowAtr200(l.candles)
	return { candles: l.candles, bands, signals: signalsFromShapes(l.candles, bands, atr, l.shapes) }
}

interface Metrics {
	n: number; wrMoney: number; payoff: number; totalR: number; meanR: number; pf: number | null
	maxDD: number; worstR: number; retDD: number // хвостовой риск
}
function chron(trades: ArrowTrade[]): ArrowTrade[] { return [...trades].sort((a, b) => a.entryAt - b.entryAt) }
function metricsOf(tradesIn: ArrowTrade[]): Metrics {
	const trades = chron(tradesIn)
	const n = trades.length
	if (!n) return { n: 0, wrMoney: NaN, payoff: NaN, totalR: 0, meanR: 0, pf: null, maxDD: 0, worstR: 0, retDD: NaN }
	const winsR = trades.filter((t) => t.netR > 0).map((t) => t.netR)
	const lossesR = trades.filter((t) => t.netR < 0).map((t) => -t.netR)
	const gains = winsR.reduce((s, v) => s + v, 0), losses = lossesR.reduce((s, v) => s + v, 0)
	const totalR = trades.reduce((s, t) => s + t.netR, 0)
	const avgWin = winsR.length ? gains / winsR.length : NaN
	const avgLoss = lossesR.length ? losses / lossesR.length : NaN
	// equity-curve max drawdown (в R) и худшая сделка
	let equity = 0, peak = 0, maxDD = 0, worstR = 0
	for (const t of trades) { equity += t.netR; if (equity > peak) peak = equity; const dd = peak - equity; if (dd > maxDD) maxDD = dd; if (t.netR < worstR) worstR = t.netR }
	return {
		n, wrMoney: winsR.length / n, payoff: avgLoss > 0 ? avgWin / avgLoss : NaN, totalR, meanR: totalR / n,
		pf: losses > 0 ? gains / losses : (gains > 0 ? Number.POSITIVE_INFINITY : null),
		maxDD, worstR, retDD: maxDD > 0 ? totalR / maxDD : (totalR > 0 ? Number.POSITIVE_INFINITY : 0),
	}
}
function runStop(p: Prep, stopSteps: number): ArrowTrade[] {
	const replay = replayAdmittedArrowSignals(p.candles, p.bands, p.signals, 'safe', { ...ARM, stopSteps, oneWayCostBps: 5 })
	return replay.trades.filter((t) => t.outcome !== 'open')
}
function oosSlice(trades: ArrowTrade[]): ArrowTrade[] { const s = chron(trades); return s.slice(Math.floor(s.length * (1 - OOS_FRACTION))) }
function parseName(file: string): { asset: string; tf: string; market: string } {
	const m = /BINANCE_([A-Z]+)USDT(\.P)?,\s*(\d+)\.csv/.exec(file)
	if (!m) return { asset: file, tf: '?', market: '?' }
	const minutes = Number(m[3])
	return { asset: m[1]!, tf: minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`, market: m[2] ? 'perp' : 'spot' }
}
const pct = (x: number) => Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a'
const r2 = (x: number) => Number.isFinite(x) ? x.toFixed(2) : 'n/a'
const r3 = (x: number) => Number.isFinite(x) ? x.toFixed(3) : 'n/a'
const pf2 = (x: number | null) => x == null ? 'n/a' : (x === Number.POSITIVE_INFINITY ? '∞' : x.toFixed(2))

interface Cell { stopSteps: number; m: Metrics; oosMeanR: number }
interface SeriesResult { asset: string; tf: string; market: string; cells: Cell[] }

function main() {
	const files = readdirSync(resolve('csv')).filter((f) => f.endsWith('.csv')).sort()
	const series: SeriesResult[] = []
	for (const f of files) {
		let l: Loaded
		try { l = loadCsv(`csv/${f}`) } catch (e) { console.log(`skip ${f}: ${(e as Error).message}`); continue }
		if (l.candles.length < 400 || l.shapes.length < 5) { console.log(`skip ${f}`); continue }
		const meta = parseName(f)
		const p = prep(l)
		const cells: Cell[] = STOP_GRID.map((stopSteps) => {
			const t = runStop(p, stopSteps)
			return { stopSteps, m: metricsOf(t), oosMeanR: metricsOf(oosSlice(t)).meanR }
		})
		series.push({ ...meta, cells })
		const best = [...cells].sort((a, b) => b.m.meanR - a.m.meanR)[0]!
		console.log(`${meta.asset} ${meta.tf} ${meta.market}: best stop=${best.stopSteps} meanR=${r3(best.m.meanR)} maxDD=${r2(best.m.maxDD)}R worst=${r2(best.m.worstR)}R ret/DD=${pf2(best.m.retDD)} WR=${pct(best.m.wrMoney)}`)
	}
	if (!series.length) throw new Error('Нет CSV.')

	const agg = STOP_GRID.map((stopSteps) => {
		const rs = series.map((s) => s.cells.find((c) => c.stopSteps === stopSteps)!)
		const sumTotal = rs.reduce((s, r) => s + (Number.isFinite(r.m.totalR) ? r.m.totalR : 0), 0)
		const sumDD = rs.reduce((s, r) => s + r.m.maxDD, 0)
		return {
			stopSteps, sumTotal,
			meanMean: rs.reduce((s, r) => s + (Number.isFinite(r.m.meanR) ? r.m.meanR : 0), 0) / rs.length,
			avgPayoff: rs.reduce((s, r) => s + (Number.isFinite(r.m.payoff) ? r.m.payoff : 0), 0) / rs.length,
			avgMaxDD: sumDD / rs.length,
			avgWorst: rs.reduce((s, r) => s + r.m.worstR, 0) / rs.length,
			sumRetOverSumDD: sumDD > 0 ? sumTotal / sumDD : NaN,
			posFull: rs.filter((r) => r.m.totalR > 0).length,
			posOos: rs.filter((r) => r.oosMeanR > 0).length,
		}
	})

	const md: string[] = []
	md.push('# RE16 — расширенный стоп-свип static-full + хвостовой риск (Фаза 1c)')
	md.push('')
	md.push('static-full (цель **2×step** хардкод, свипается только стоп), safe, добор on, без частички, admitted-реплей, 5 bps/side. OOS = последние 35%. Добавлены: **maxDD** (макс-просадка equity в R), **worst** (худшая сделка в R), **ret/DD** (totalR/maxDD).')
	md.push('')
	md.push('## Агрегат по stopSteps (5 bps, 12 серий) — плато или дрейф?')
	md.push('')
	md.push('| stopSteps | Σ totalR | ср. meanR | payoff | ср. maxDD (R) | ср. worst (R) | ΣtotalR/ΣmaxDD | плюс full | плюс OOS |')
	md.push('|---|---|---|---|---|---|---|---|---|')
	for (const a of agg) md.push(`| ${a.stopSteps} | ${r2(a.sumTotal)} | ${r3(a.meanMean)} | ${r2(a.avgPayoff)} | ${r2(a.avgMaxDD)} | ${r2(a.avgWorst)} | ${r2(a.sumRetOverSumDD)} | ${a.posFull}/${series.length} | ${a.posOos}/${series.length} |`)
	md.push('')
	md.push('## Per-series: meanR@5 по stopSteps (жирным — лучший)')
	md.push('')
	md.push('| актив | ТФ | ' + STOP_GRID.map((s) => `${s}`).join(' | ') + ' | лучший (maxDD/worst/ret-DD) |')
	md.push('|---|---|' + STOP_GRID.map(() => '---').join('|') + '|---|')
	for (const s of series) {
		const best = Math.max(...s.cells.map((c) => Number.isFinite(c.m.meanR) ? c.m.meanR : -Infinity))
		const bc = s.cells.find((c) => c.m.meanR === best)!
		const cells = s.cells.map((c) => c.m.meanR === best ? `**${r3(c.m.meanR)}**` : r3(c.m.meanR))
		md.push(`| ${s.asset} | ${s.tf} | ${cells.join(' | ')} | stop ${bc.stopSteps} (DD ${r2(bc.m.maxDD)} / worst ${r2(bc.m.worstR)} / r-DD ${pf2(bc.m.retDD)}) |`)
	}
	md.push('')
	md.push('## Per-series: ret/DD (totalR / maxDD) по stopSteps — риск-скорректированное качество')
	md.push('')
	md.push('| актив | ТФ | ' + STOP_GRID.map((s) => `${s}`).join(' | ') + ' |')
	md.push('|---|---|' + STOP_GRID.map(() => '---').join('|') + '|')
	for (const s of series) md.push(`| ${s.asset} | ${s.tf} | ${s.cells.map((c) => pf2(c.m.retDD)).join(' | ')} |`)
	md.push('')
	md.push('_⚠ Широкий стоп повышает WR и meanR, но раздувает maxDD/worst — смотреть ret/DD, а не только meanR. Оптимум у края сетки = дрейф (иллюзия широкого стопа). Ось цели захардкожена 2×step. Лид, не edge — нужен строгий OOS (train/OOS+CI)._')
	writeFileSync(resolve('ci-results/re16-static-stop-risk.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/re16-static-stop-risk.json'), JSON.stringify({
		generatedAt: new Date().toISOString(),
		note: 'RE16 Phase-1c static-full extended stop sweep + tail risk (maxDD, worst, ret/DD). Target hardcoded 2x. safe, static-full, partial 0, add on, admitted, 5 bps. OOS last 35%.',
		stopGrid: STOP_GRID, oosFraction: OOS_FRACTION, arm: ARM, aggregate: agg, series,
	}, null, 2))

	console.log('\n=== Агрегат static-full: стоп vs риск (5 bps) ===')
	for (const a of agg) console.log(`  stop=${a.stopSteps}: Σtotal=${r2(a.sumTotal)} meanR=${r3(a.meanMean)} payoff=${r2(a.avgPayoff)} avgMaxDD=${r2(a.avgMaxDD)}R avgWorst=${r2(a.avgWorst)}R ret/DD=${r2(a.sumRetOverSumDD)} +full=${a.posFull}/${series.length} +OOS=${a.posOos}/${series.length}`)
	console.log('Записано: ci-results/re16-static-stop-risk.{md,json}')
}

main()
