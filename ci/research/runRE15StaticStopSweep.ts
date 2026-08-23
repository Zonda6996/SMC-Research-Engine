/**
 * RE15 — Фаза 1b: свип ШИРИНЫ СТОПА для руки F (static-full), по всем вендор-CSV.
 *
 * RE14: рука F (static-full, фикс цель 2×step, без частички) — лучший payoff (~0.90). Здесь ищем
 * R:R-точку с максимальным meanR@5 и OOS>0, варьируя ШИРИНУ СТОПА.
 *
 * ⚠ ОГРАНИЧЕНИЕ ДВИЖКА (важно): множитель ЦЕЛИ в static-full захардкожен = `entry ± 2×step`
 * (см. ArrowTradeReplay: `staticFull`). Отдельной config-опции «targetSteps» НЕТ. Поэтому здесь
 * свипается ТОЛЬКО ось стопа (`stopSteps`) при фиксированной цели 2×step. Ось цели (2.5/3/4×)
 * потребует либо правки src/core (опция targetSteps), либо runner-local реплея — решает автор (§2.1/§2.2).
 * src/core НЕ тронут.
 *
 * Рука: режим safe, management 'static-full', partialFraction 0, добор on; admitted-реплей.
 * stopSteps ∈ {1.0, 1.5, 2.0, 2.5, 3.0}. Издержки 0 и 5 bps/side; OOS = последние 35% сделок.
 *
 * Запуск: npx tsx "ci/research/runRE15StaticStopSweep.ts"
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS, type ApexBand } from '../../src/core/signals/ApexEngine.js'
import { arrowAtr200, ARROW_SIGNAL_VERSION } from '../../src/core/signals/ArrowSignalEngine.js'
import type { ArrowSignal, ArrowSide } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayAdmittedArrowSignals } from '../../src/core/signals/ArrowTradeReplay.js'
import type { ArrowTrade, ArrowModeConfig } from '../../src/core/signals/ArrowTradeReplay.js'

const STOP_GRID = [1.0, 1.5, 2.0, 2.5, 3.0]
const OOS_FRACTION = 0.35
// Рука F: static-full (цель 2×step захардкожена в движке), без частички, добор on.
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

interface Metrics { n: number; wrMoney: number; avgWin: number; avgLoss: number; payoff: number; totalR: number; meanR: number; pf: number | null }
function metricsOf(trades: ArrowTrade[]): Metrics {
	const n = trades.length
	if (!n) return { n: 0, wrMoney: NaN, avgWin: NaN, avgLoss: NaN, payoff: NaN, totalR: 0, meanR: 0, pf: null }
	const winsR = trades.filter((t) => t.netR > 0).map((t) => t.netR)
	const lossesR = trades.filter((t) => t.netR < 0).map((t) => -t.netR)
	const gains = winsR.reduce((s, v) => s + v, 0), losses = lossesR.reduce((s, v) => s + v, 0)
	const totalR = trades.reduce((s, t) => s + t.netR, 0)
	const avgWin = winsR.length ? gains / winsR.length : NaN
	const avgLoss = lossesR.length ? losses / lossesR.length : NaN
	return { n, wrMoney: winsR.length / n, avgWin, avgLoss, payoff: avgLoss > 0 ? avgWin / avgLoss : NaN, totalR, meanR: totalR / n, pf: losses > 0 ? gains / losses : (gains > 0 ? Number.POSITIVE_INFINITY : null) }
}
function runStop(p: Prep, stopSteps: number, cost: number): ArrowTrade[] {
	const replay = replayAdmittedArrowSignals(p.candles, p.bands, p.signals, 'safe', { ...ARM, stopSteps, oneWayCostBps: cost })
	return replay.trades.filter((t) => t.outcome !== 'open')
}
function oosSlice(trades: ArrowTrade[]): ArrowTrade[] {
	const sorted = [...trades].sort((a, b) => a.entryAt - b.entryAt)
	return sorted.slice(Math.floor(sorted.length * (1 - OOS_FRACTION)))
}
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

interface Cell { stopSteps: number; m5: Metrics; oosMeanR5: number }
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
			const t5 = runStop(p, stopSteps, 5)
			return { stopSteps, m5: metricsOf(t5), oosMeanR5: metricsOf(oosSlice(t5)).meanR }
		})
		series.push({ ...meta, cells })
		const best = [...cells].sort((a, b) => b.m5.meanR - a.m5.meanR)[0]!
		console.log(`${meta.asset} ${meta.tf} ${meta.market}: best stop=${best.stopSteps} meanR@5=${r3(best.m5.meanR)} (oos ${r3(best.oosMeanR5)}) payoff=${r2(best.m5.payoff)} WR=${pct(best.m5.wrMoney)} N=${best.m5.n}`)
	}
	if (!series.length) throw new Error('Нет CSV.')

	const agg = STOP_GRID.map((stopSteps) => {
		const rs = series.map((s) => s.cells.find((c) => c.stopSteps === stopSteps)!)
		return {
			stopSteps,
			sumTotal5: rs.reduce((s, r) => s + (Number.isFinite(r.m5.totalR) ? r.m5.totalR : 0), 0),
			meanMean5: rs.reduce((s, r) => s + (Number.isFinite(r.m5.meanR) ? r.m5.meanR : 0), 0) / rs.length,
			avgPayoff: rs.reduce((s, r) => s + (Number.isFinite(r.m5.payoff) ? r.m5.payoff : 0), 0) / rs.length,
			posFull: rs.filter((r) => r.m5.totalR > 0).length,
			posOos: rs.filter((r) => r.oosMeanR5 > 0).length,
		}
	})

	const md: string[] = []
	md.push('# RE15 — свип ширины стопа для static-full (Фаза 1b)')
	md.push('')
	md.push('Рука F из RE14 (static-full, фикс цель **2×step** — захардкожена в движке, НЕ config; свипается только стоп), режим `safe`, добор on, без частички, admitted-реплей. Метрики 5 bps/side, OOS = последние 35%.')
	md.push('')
	md.push('> ⚠ Ось ЦЕЛИ (2.5/3/4×) недоступна конфигом — множитель цели в `static-full` захардкожен `2×step`. Здесь только ось СТОПА. Для оси цели — правка движка (опция `targetSteps`) или runner-local реплей (решение автора).')
	md.push('')
	md.push('## Агрегат по stopSteps (5 bps, 12 серий)')
	md.push('')
	md.push('| stopSteps | Σ totalR@5 | ср. meanR@5 | avg payoff | серий плюс (full) | серий плюс (OOS) |')
	md.push('|---|---|---|---|---|---|')
	for (const a of agg) md.push(`| ${a.stopSteps} | ${r2(a.sumTotal5)} | ${r3(a.meanMean5)} | ${r2(a.avgPayoff)} | ${a.posFull}/${series.length} | ${a.posOos}/${series.length} |`)
	md.push('')
	md.push('## Per-series: meanR@5 по stopSteps (жирным — лучший стоп на серии)')
	md.push('')
	md.push('| актив | ТФ | ' + STOP_GRID.map((s) => `stop ${s}`).join(' | ') + ' | лучший |')
	md.push('|---|---|' + STOP_GRID.map(() => '---').join('|') + '|---|')
	for (const s of series) {
		const best = Math.max(...s.cells.map((c) => Number.isFinite(c.m5.meanR) ? c.m5.meanR : -Infinity))
		const bestCell = s.cells.find((c) => c.m5.meanR === best)!
		const cells = s.cells.map((c) => c.m5.meanR === best ? `**${r3(c.m5.meanR)}**` : r3(c.m5.meanR))
		md.push(`| ${s.asset} | ${s.tf} | ${cells.join(' | ')} | stop ${bestCell.stopSteps} (oos ${r3(bestCell.oosMeanR5)}) |`)
	}
	md.push('')
	md.push('## Per-series: OOS meanR@5 по stopSteps')
	md.push('')
	md.push('| актив | ТФ | ' + STOP_GRID.map((s) => `stop ${s}`).join(' | ') + ' |')
	md.push('|---|---|' + STOP_GRID.map(() => '---').join('|') + '|')
	for (const s of series) {
		md.push(`| ${s.asset} | ${s.tf} | ${s.cells.map((c) => r3(c.oosMeanR5)).join(' | ')} |`)
	}
	md.push('')
	writeFileSync(resolve('ci-results/re15-static-stop-sweep.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/re15-static-stop-sweep.json'), JSON.stringify({
		generatedAt: new Date().toISOString(),
		note: 'RE15 Phase-1b static-full stop-width sweep across vendor CSVs. Target multiple HARDCODED 2x step in engine (not config); only stop swept. safe, static-full, partial 0, add on, admitted replay. 5 bps + OOS(last 35%).',
		stopGrid: STOP_GRID, oosFraction: OOS_FRACTION, arm: ARM, aggregate: agg, series,
	}, null, 2))

	console.log('\n=== Агрегат static-full по stopSteps (5 bps) ===')
	for (const a of agg) console.log(`  stop=${a.stopSteps}: Σtotal=${r2(a.sumTotal5)} meanMeanR=${r3(a.meanMean5)} payoff=${r2(a.avgPayoff)} plus full=${a.posFull}/${series.length} OOS=${a.posOos}/${series.length}`)
	console.log('Записано: ci-results/re15-static-stop-sweep.{md,json}')
}

main()
