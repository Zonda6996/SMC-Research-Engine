/**
 * RE14 — Фаза 1: МАТРИЦА МЕНЕДЖМЕНТА выхода по всем вендор-CSV (поднять payoff → вытащить expectancy).
 *
 * RE13 показал: payoff ≈ 0.5 везде (avgWin~0.4R vs avgLoss~0.85R), breakeven-WR ~66% — стратегия
 * впритык на нуле. Единственный рычаг — ПЕЙОФФ. Здесь сравниваем руки выхода (всё конфигом, движок не тронут):
 *   A base       — dyn-partial, partialFraction 0.25, добор on  (= RE13; частичка у mean + full у внутр. полосе)
 *   B meanfix+add — fullFixAtMean:true, добор on                (100% фикс у mean — гипотеза автора)
 *   C meanfix-add — fullFixAtMean:true, добор off
 *   D dyn-nopart  — dyn-partial, partialFraction 0, добор on    (весь объём до внутр. полосы, без съёма у mean)
 *   E dyn-p0.5    — dyn-partial, partialFraction 0.5, добор on
 *   F static2R    — management 'static-full' (фикс цель 2×step, без частички) — прокси «дать бежать»
 *
 * Все руки: режим safe, стоп 2×step (канон, НЕ фит), admitted-реплей (каждая стрелка = сделка).
 * Метрики на 0 и 5 bps/side + OOS meanR@5 (последние 35% сделок по времени — kill-критерий проекта:
 * «net Result R>0 на OOS»). §2.1: правила не выдуманы (стоп/тейк — штатные опции движка). §2.2: src/core не тронут.
 *
 * Запуск: npx tsx "ci/research/runRE14ManagementMatrix.ts"
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS, type ApexBand } from '../../src/core/signals/ApexEngine.js'
import { arrowAtr200, ARROW_SIGNAL_VERSION } from '../../src/core/signals/ArrowSignalEngine.js'
import type { ArrowSignal, ArrowSide } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayAdmittedArrowSignals } from '../../src/core/signals/ArrowTradeReplay.js'
import type { ArrowTrade, ArrowModeConfig } from '../../src/core/signals/ArrowTradeReplay.js'

interface Arm { key: string; label: string; override: Partial<ArrowModeConfig> }
const ARMS: Arm[] = [
	{ key: 'A_base', label: 'A base (dyn-partial 0.25 +add)', override: { fullFixAtMean: false, addEnabled: true, partialFraction: 0.25, management: 'dynamic-partial' } },
	{ key: 'B_meanfix_add', label: 'B meanfix +add', override: { fullFixAtMean: true, addEnabled: true } },
	{ key: 'C_meanfix_noadd', label: 'C meanfix -add', override: { fullFixAtMean: true, addEnabled: false } },
	{ key: 'D_dyn_nopart', label: 'D dyn no-partial +add', override: { fullFixAtMean: false, addEnabled: true, partialFraction: 0, management: 'dynamic-partial' } },
	{ key: 'E_dyn_p05', label: 'E dyn partial0.5 +add', override: { fullFixAtMean: false, addEnabled: true, partialFraction: 0.5, management: 'dynamic-partial' } },
	{ key: 'F_static2R', label: 'F static-full 2xstep (-partial)', override: { management: 'static-full', partialFraction: 0, addEnabled: true } },
]
const STOP_STEPS = 2
const OOS_FRACTION = 0.35

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
	const signals = signalsFromShapes(l.candles, bands, atr, l.shapes)
	return { candles: l.candles, bands, signals }
}

interface Metrics { n: number; wrMoney: number; avgWin: number; avgLoss: number; payoff: number; totalR: number; meanR: number; pf: number | null }
function metricsOf(trades: ArrowTrade[]): Metrics {
	const n = trades.length
	if (!n) return { n: 0, wrMoney: NaN, avgWin: NaN, avgLoss: NaN, payoff: NaN, totalR: 0, meanR: 0, pf: null }
	const winsR = trades.filter((t) => t.netR > 0).map((t) => t.netR)
	const lossesR = trades.filter((t) => t.netR < 0).map((t) => -t.netR)
	const gains = winsR.reduce((s, v) => s + v, 0), losses = lossesR.reduce((s, v) => s + v, 0)
	const avgWin = winsR.length ? gains / winsR.length : NaN
	const avgLoss = lossesR.length ? losses / lossesR.length : NaN
	const totalR = trades.reduce((s, t) => s + t.netR, 0)
	return { n, wrMoney: winsR.length / n, avgWin, avgLoss, payoff: avgLoss > 0 ? avgWin / avgLoss : NaN, totalR, meanR: totalR / n, pf: losses > 0 ? gains / losses : (gains > 0 ? Number.POSITIVE_INFINITY : null) }
}

function runArm(p: Prep, arm: Arm, cost: number): ArrowTrade[] {
	const replay = replayAdmittedArrowSignals(p.candles, p.bands, p.signals, 'safe', { ...arm.override, stopSteps: STOP_STEPS, oneWayCostBps: cost })
	return replay.trades.filter((t) => t.outcome !== 'open')
}
function oosSlice(trades: ArrowTrade[]): ArrowTrade[] {
	const sorted = [...trades].sort((a, b) => a.entryAt - b.entryAt)
	const start = Math.floor(sorted.length * (1 - OOS_FRACTION))
	return sorted.slice(start)
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

interface ArmResult { arm: string; m0: Metrics; m5: Metrics; oosMeanR5: number }
interface SeriesResult { asset: string; tf: string; market: string; arms: ArmResult[] }

function main() {
	const files = readdirSync(resolve('csv')).filter((f) => f.endsWith('.csv')).sort()
	const series: SeriesResult[] = []
	for (const f of files) {
		let l: Loaded
		try { l = loadCsv(`csv/${f}`) } catch (e) { console.log(`skip ${f}: ${(e as Error).message}`); continue }
		if (l.candles.length < 400 || l.shapes.length < 5) { console.log(`skip ${f}`); continue }
		const meta = parseName(f)
		const p = prep(l)
		const arms: ArmResult[] = ARMS.map((arm) => {
			const t5 = runArm(p, arm, 5)
			return { arm: arm.key, m0: metricsOf(runArm(p, arm, 0)), m5: metricsOf(t5), oosMeanR5: metricsOf(oosSlice(t5)).meanR }
		})
		series.push({ ...meta, arms })
		const best = [...arms].sort((a, b) => b.m5.meanR - a.m5.meanR)[0]!
		const A = arms.find((a) => a.arm === 'A_base')!, B = arms.find((a) => a.arm === 'B_meanfix_add')!
		console.log(`${meta.asset} ${meta.tf} ${meta.market}: best=${best.arm} meanR@5=${r3(best.m5.meanR)} | A_base @5=${r3(A.m5.meanR)} (oos ${r3(A.oosMeanR5)}) vs B_meanfix @5=${r3(B.m5.meanR)} (oos ${r3(B.oosMeanR5)})`)
	}
	if (!series.length) throw new Error('Нет CSV.')

	// агрегат по рукам (5 bps): сумма totalR, среднее meanR, сколько серий плюсовых (full и OOS)
	const agg = ARMS.map((arm) => {
		const rs = series.map((s) => s.arms.find((a) => a.arm === arm.key)!)
		const sumTotal5 = rs.reduce((s, r) => s + (Number.isFinite(r.m5.totalR) ? r.m5.totalR : 0), 0)
		const meanMean5 = rs.reduce((s, r) => s + (Number.isFinite(r.m5.meanR) ? r.m5.meanR : 0), 0) / rs.length
		const posFull = rs.filter((r) => r.m5.totalR > 0).length
		const posOos = rs.filter((r) => r.oosMeanR5 > 0).length
		const avgPayoff = rs.reduce((s, r) => s + (Number.isFinite(r.m5.payoff) ? r.m5.payoff : 0), 0) / rs.length
		return { arm: arm.key, sumTotal5, meanMean5, posFull, posOos, avgPayoff }
	})

	const md: string[] = []
	md.push('# RE14 — матрица менеджмента выхода (Фаза 1): поднять payoff → expectancy')
	md.push('')
	md.push('Все руки: режим `safe`, стоп `2×step` (канон, НЕ фит), admitted-реплей (каждая стрелка = сделка), входы = vendor CSV shapes. Метрики на 5 bps/side (+0 bps для gross), OOS = последние 35% сделок по времени.')
	md.push('')
	md.push('**Руки:** ' + ARMS.map((a) => `\`${a.key}\` = ${a.label}`).join('; ') + '.')
	md.push('')
	md.push('## Агрегат по рукам (5 bps, по всем 12 сериям)')
	md.push('')
	md.push('| рука | Σ totalR@5 | средний meanR@5 | avg payoff | серий плюс (full) | серий плюс (OOS) |')
	md.push('|---|---|---|---|---|---|')
	for (const a of [...agg].sort((x, y) => y.sumTotal5 - x.sumTotal5)) {
		md.push(`| ${a.arm} | ${r2(a.sumTotal5)} | ${r3(a.meanMean5)} | ${r2(a.avgPayoff)} | ${a.posFull}/${series.length} | ${a.posOos}/${series.length} |`)
	}
	md.push('')
	md.push('## Per-series: meanR@5 по рукам (жирным — лучшая на серии)')
	md.push('')
	md.push('| актив | ТФ | ' + ARMS.map((a) => a.key).join(' | ') + ' |')
	md.push('|---|---|' + ARMS.map(() => '---').join('|') + '|')
	for (const s of series) {
		const best = Math.max(...s.arms.map((a) => Number.isFinite(a.m5.meanR) ? a.m5.meanR : -Infinity))
		const cells = ARMS.map((arm) => {
			const r = s.arms.find((a) => a.arm === arm.key)!
			const v = r3(r.m5.meanR)
			return r.m5.meanR === best ? `**${v}**` : v
		})
		md.push(`| ${s.asset} | ${s.tf} | ${cells.join(' | ')} |`)
	}
	md.push('')
	md.push('## Per-series: OOS meanR@5 по рукам (последние 35%)')
	md.push('')
	md.push('| актив | ТФ | ' + ARMS.map((a) => a.key).join(' | ') + ' |')
	md.push('|---|---|' + ARMS.map(() => '---').join('|') + '|')
	for (const s of series) {
		const cells = ARMS.map((arm) => r3(s.arms.find((a) => a.arm === arm.key)!.oosMeanR5))
		md.push(`| ${s.asset} | ${s.tf} | ${cells.join(' | ')} |`)
	}
	md.push('')
	md.push('_Оговорки: стоп/тейк — штатные опции движка (§2.1); src/core не тронут (§2.2). «Дать выигрышу до внешнего края» конфигом недоступно (full-цель dyn = внутр. полоса хардкодом) — только через правку движка. Издержки — симметричный taker-прокси; спот/перп помечены, funding для перп НЕ смоделирован. Плюсы — кандидаты, не edge, пока не подтверждены на настоящем OOS (не только хвост 35%)._')
	writeFileSync(resolve('ci-results/re14-management-matrix.md'), md.join('\n'))

	writeFileSync(resolve('ci-results/re14-management-matrix.json'), JSON.stringify({
		generatedAt: new Date().toISOString(),
		note: 'RE14 Phase-1 exit management matrix over all vendor CSVs. safe, stopSteps=2, admitted replay, arms via config only (engine untouched). meanR at 0/5 bps + OOS(last 35%) meanR@5.',
		stopSteps: STOP_STEPS, oosFraction: OOS_FRACTION, arms: ARMS.map((a) => ({ key: a.key, label: a.label, override: a.override })),
		aggregate: agg, series,
	}, null, 2))

	console.log('\n=== Агрегат по рукам (5 bps) ===')
	for (const a of [...agg].sort((x, y) => y.sumTotal5 - x.sumTotal5)) {
		console.log(`  ${a.arm}: Σtotal=${r2(a.sumTotal5)} meanMeanR=${r3(a.meanMean5)} payoff=${r2(a.avgPayoff)} plus full=${a.posFull}/${series.length} OOS=${a.posOos}/${series.length}`)
	}
	console.log('Записано: ci-results/re14-management-matrix.{md,json}')
}

main()
