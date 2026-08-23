/**
 * RE18 — быстрый тест: стоп-в-БУ после частички (breakevenAfterPartial) vs без него.
 *
 * Идея автора: после частичной фиксации у mean перенести стоп в безубыток — тогда «частичка→стоп»
 * превращается в «частичка→BE» (маленький плюс вместо полного лосса на остатке). Может поднять
 * expectancy без изменения входов.
 *
 * Движок: добавлена опция `breakevenAfterPartial` (default off, аддитивно). Здесь сравниваем на всех
 * 12 вендор-CSV две руки dynamic-partial (safe, partial 0.25, добор on, стоп 2×step, admitted-реплей):
 *   BASE — как есть (стоп фиксирован);
 *   BE   — breakevenAfterPartial:true.
 * Метрики 5 bps/side + OOS meanR@5 (хвост 35%). §2.1/§2.2: правило БУ — по явному запросу автора.
 *
 * Запуск: npx tsx "ci/research/runRE18BreakevenAfterPartial.ts"
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS, type ApexBand } from '../../src/core/signals/ApexEngine.js'
import { arrowAtr200, ARROW_SIGNAL_VERSION } from '../../src/core/signals/ArrowSignalEngine.js'
import type { ArrowSignal, ArrowSide } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayAdmittedArrowSignals } from '../../src/core/signals/ArrowTradeReplay.js'
import type { ArrowTrade, ArrowModeConfig } from '../../src/core/signals/ArrowTradeReplay.js'

const STOP_STEPS = 2
const OOS_FRACTION = 0.35
const BASE: Partial<ArrowModeConfig> = { fullFixAtMean: false, addEnabled: true, partialFraction: 0.25, management: 'dynamic-partial', stopSteps: STOP_STEPS }
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
function run(p: Prep, be: boolean): ArrowTrade[] {
	const replay = replayAdmittedArrowSignals(p.candles, p.bands, p.signals, 'safe', { ...BASE, breakevenAfterPartial: be, oneWayCostBps: 5 })
	return replay.trades.filter((t) => t.outcome !== 'open')
}
interface M { n: number; wr: number; meanR: number; totalR: number; pf: number | null; partialStop: number }
function metricsOf(ts: ArrowTrade[]): M {
	const n = ts.length
	if (!n) return { n: 0, wr: NaN, meanR: 0, totalR: 0, pf: null, partialStop: 0 }
	const gains = ts.filter((t) => t.netR > 0).reduce((s, t) => s + t.netR, 0)
	const losses = -ts.filter((t) => t.netR < 0).reduce((s, t) => s + t.netR, 0)
	const totalR = ts.reduce((s, t) => s + t.netR, 0)
	return { n, wr: ts.filter((t) => t.netR > 0).length / n, meanR: totalR / n, totalR, pf: losses > 0 ? gains / losses : (gains > 0 ? Infinity : null), partialStop: ts.filter((t) => t.outcome === 'partial-stop').length }
}
function oosMean(ts: ArrowTrade[]): number {
	const s = [...ts].sort((a, b) => a.entryAt - b.entryAt)
	const sl = s.slice(Math.floor(s.length * (1 - OOS_FRACTION)))
	return sl.length ? sl.reduce((a, t) => a + t.netR, 0) / sl.length : NaN
}
function parseName(file: string): { asset: string; tf: string; market: string } {
	const m = /BINANCE_([A-Z]+)USDT(\.P)?,\s*(\d+)\.csv/.exec(file)
	if (!m) return { asset: file, tf: '?', market: '?' }
	const minutes = Number(m[3])
	return { asset: m[1]!, tf: minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`, market: m[2] ? 'perp' : 'spot' }
}
const pct = (x: number) => Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a'
const r3 = (x: number) => Number.isFinite(x) ? x.toFixed(3) : 'n/a'
const r2 = (x: number) => Number.isFinite(x) ? x.toFixed(2) : 'n/a'
const pf2 = (x: number | null) => x == null ? 'n/a' : (x === Infinity ? '∞' : x.toFixed(2))

interface Row { asset: string; tf: string; market: string; base: M; be: M; baseOos: number; beOos: number }

function main() {
	const files = readdirSync(resolve('csv')).filter((f) => f.endsWith('.csv')).sort()
	const rows: Row[] = []
	for (const f of files) {
		let l: Loaded
		try { l = loadCsv(`csv/${f}`) } catch (e) { console.log(`skip ${f}: ${(e as Error).message}`); continue }
		if (l.candles.length < 400 || l.shapes.length < 5) { console.log(`skip ${f}`); continue }
		const meta = parseName(f)
		const p = prep(l)
		const tb = run(p, false), tbe = run(p, true)
		rows.push({ ...meta, base: metricsOf(tb), be: metricsOf(tbe), baseOos: oosMean(tb), beOos: oosMean(tbe) })
		const b = rows[rows.length - 1]!
		console.log(`${meta.asset} ${meta.tf} ${meta.market}: BASE meanR=${r3(b.base.meanR)} (oos ${r3(b.baseOos)}) WR=${pct(b.base.wr)} | BE meanR=${r3(b.be.meanR)} (oos ${r3(b.beOos)}) WR=${pct(b.be.wr)} Δ=${r3(b.be.meanR - b.base.meanR)}`)
	}
	if (!rows.length) throw new Error('Нет CSV.')

	const sum = (sel: (r: Row) => number) => rows.reduce((s, r) => s + (Number.isFinite(sel(r)) ? sel(r) : 0), 0)
	const aggBaseTotal = sum((r) => r.base.totalR), aggBeTotal = sum((r) => r.be.totalR)
	const aggBaseMean = sum((r) => r.base.meanR) / rows.length, aggBeMean = sum((r) => r.be.meanR) / rows.length
	const basePosFull = rows.filter((r) => r.base.totalR > 0).length, bePosFull = rows.filter((r) => r.be.totalR > 0).length
	const basePosOos = rows.filter((r) => r.baseOos > 0).length, bePosOos = rows.filter((r) => r.beOos > 0).length
	const beBetter = rows.filter((r) => r.be.meanR > r.base.meanR).length

	const md: string[] = []
	md.push('# RE18 — стоп-в-БУ после частички (breakevenAfterPartial) vs BASE')
	md.push('')
	md.push('safe, dynamic-partial (partial 0.25), добор on, стоп 2×step, admitted-реплей, 5 bps/side. BASE = стоп фиксирован; BE = после частички стоп → averageEntry. OOS = хвост 35%.')
	md.push('')
	md.push('## Агрегат (5 bps, 12 серий)')
	md.push('')
	md.push('| рука | Σ totalR | ср. meanR | серий плюс (full) | серий плюс (OOS) |')
	md.push('|---|---|---|---|---|')
	md.push(`| BASE | ${r2(aggBaseTotal)} | ${r3(aggBaseMean)} | ${basePosFull}/${rows.length} | ${basePosOos}/${rows.length} |`)
	md.push(`| BE (стоп-в-БУ) | ${r2(aggBeTotal)} | ${r3(aggBeMean)} | ${bePosFull}/${rows.length} | ${bePosOos}/${rows.length} |`)
	md.push('')
	md.push(`BE лучше BASE по meanR на **${beBetter}/${rows.length}** сериях.`)
	md.push('')
	md.push('## Per-series (meanR@5, OOS в скобках)')
	md.push('')
	md.push('| актив | ТФ | рынок | BASE meanR (oos) | BE meanR (oos) | Δ meanR | BASE WR | BE WR |')
	md.push('|---|---|---|---|---|---|---|---|')
	for (const r of rows) md.push(`| ${r.asset} | ${r.tf} | ${r.market} | ${r3(r.base.meanR)} (${r3(r.baseOos)}) | ${r3(r.be.meanR)} (${r3(r.beOos)}) | ${r3(r.be.meanR - r.base.meanR)} | ${pct(r.base.wr)} | ${pct(r.be.wr)} |`)
	md.push('')
	md.push('_БУ после частички = штатная опция движка `breakevenAfterPartial` (default off, добавлена RE18). Плюсы — кандидаты, требуют строгого OOS перед любым выводом об edge._')
	writeFileSync(resolve('ci-results/re18-breakeven-after-partial.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/re18-breakeven-after-partial.json'), JSON.stringify({ generatedAt: new Date().toISOString(), stopSteps: STOP_STEPS, oosFraction: OOS_FRACTION, base: BASE, rows, aggregate: { aggBaseTotal, aggBeTotal, aggBaseMean, aggBeMean, basePosFull, bePosFull, basePosOos, bePosOos, beBetter } }, null, 2))

	console.log('\n=== RE18 агрегат (5 bps) ===')
	console.log(`  BASE: Σtotal=${r2(aggBaseTotal)} meanR=${r3(aggBaseMean)} +full=${basePosFull}/${rows.length} +OOS=${basePosOos}/${rows.length}`)
	console.log(`  BE:   Σtotal=${r2(aggBeTotal)} meanR=${r3(aggBeMean)} +full=${bePosFull}/${rows.length} +OOS=${bePosOos}/${rows.length}; BE>BASE на ${beBetter}/${rows.length}`)
	console.log('Записано: ci-results/re18-breakeven-after-partial.{md,json}')
}

main()
