/**
 * RE17 — Фаза 1d: СТРОГАЯ OOS-валидация static-full (решающий go/no-go тест).
 *
 * RE16: static-full (цель 2×step) + широкий стоп (~3) даёт плато с плюсовым агрегатом на 5 bps, но
 * edge тонкий и «OOS» там был лишь хвост 35%. Здесь — честный протокол проекта:
 *   - каждую серию делим хронологически: train = первые 65%, OOS = последние 35%;
 *   - две руки:
 *       (A-priori)  static-full, стоп ФИКС = 3 (выбран заранее из плато RE16, без подгонки под серию);
 *       (Train-sel) на каждой серии выбираем stopSteps по максимуму train-meanR, применяем к OOS
 *                   (проверка: выживает ли подгонка стопа на отложенном окне);
 *   - объединяем OOS-сделки по всем сериям → pooled meanR + bootstrap-95%-CI (seed фикс);
 *   - kill-критерий: OOS pooled meanR CI-low > 0. Иначе edge НЕ подтверждён.
 *
 * Рука: safe, static-full, partialFraction 0, добор on; admitted-реплей; 5 bps/side (целевой taker).
 * ⚠ цель 2×step захардкожена в движке (не config). src/core НЕ тронут.
 *
 * Запуск: npx tsx "ci/research/runRE17OosValidation.ts"
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
const APRIORI_STOP = 3.0
const TRAIN_FRACTION = 0.65
const COST = 5
const BOOT = 3000
const SEED = 20260819
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
function runStop(p: Prep, stopSteps: number): ArrowTrade[] {
	const replay = replayAdmittedArrowSignals(p.candles, p.bands, p.signals, 'safe', { ...ARM, stopSteps, oneWayCostBps: COST })
	return replay.trades.filter((t) => t.outcome !== 'open')
}
// хронологический train/OOS сплит
function split(trades: ArrowTrade[]): { train: ArrowTrade[]; oos: ArrowTrade[] } {
	const s = [...trades].sort((a, b) => a.entryAt - b.entryAt)
	const cut = Math.floor(s.length * TRAIN_FRACTION)
	return { train: s.slice(0, cut), oos: s.slice(cut) }
}
const meanR = (ts: ArrowTrade[]) => ts.length ? ts.reduce((s, t) => s + t.netR, 0) / ts.length : NaN
const totalR = (ts: ArrowTrade[]) => ts.reduce((s, t) => s + t.netR, 0)

// mulberry32 seeded RNG
function rng(seed: number) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }
function bootstrapCI(values: number[], iters: number, seed: number): { mean: number; lo: number; hi: number } {
	const n = values.length
	if (!n) return { mean: NaN, lo: NaN, hi: NaN }
	const rand = rng(seed)
	const means: number[] = []
	for (let b = 0; b < iters; b++) { let s = 0; for (let i = 0; i < n; i++) s += values[Math.floor(rand() * n)]!; means.push(s / n) }
	means.sort((x, y) => x - y)
	const q = (p: number) => means[Math.min(means.length - 1, Math.max(0, Math.floor(p * means.length)))]!
	return { mean: values.reduce((s, v) => s + v, 0) / n, lo: q(0.025), hi: q(0.975) }
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

interface SeriesRow { asset: string; tf: string; market: string; aprTrain: number; aprOos: number; aprN: number; selStop: number; selTrain: number; selOos: number; selN: number }

function main() {
	const files = readdirSync(resolve('csv')).filter((f) => f.endsWith('.csv')).sort()
	const rows: SeriesRow[] = []
	const aprOosPool: number[] = []
	const selOosPool: number[] = []
	for (const f of files) {
		let l: Loaded
		try { l = loadCsv(`csv/${f}`) } catch (e) { console.log(`skip ${f}: ${(e as Error).message}`); continue }
		if (l.candles.length < 400 || l.shapes.length < 12) { console.log(`skip ${f}`); continue }
		const meta = parseName(f)
		const p = prep(l)
		// A-priori stop=3
		const apr = split(runStop(p, APRIORI_STOP))
		aprOosPool.push(...apr.oos.map((t) => t.netR))
		// Train-selected stop
		let selStop = STOP_GRID[0]!, bestTrain = -Infinity, selSplit = apr
		for (const st of STOP_GRID) {
			const sp = split(runStop(p, st))
			const tr = meanR(sp.train)
			if (Number.isFinite(tr) && tr > bestTrain) { bestTrain = tr; selStop = st; selSplit = sp }
		}
		selOosPool.push(...selSplit.oos.map((t) => t.netR))
		rows.push({ ...meta, aprTrain: meanR(apr.train), aprOos: meanR(apr.oos), aprN: apr.oos.length, selStop, selTrain: meanR(selSplit.train), selOos: meanR(selSplit.oos), selN: selSplit.oos.length })
		console.log(`${meta.asset} ${meta.tf} ${meta.market}: [apr s3] train=${r3(meanR(apr.train))} OOS=${r3(meanR(apr.oos))} (N=${apr.oos.length}) | [sel s${selStop}] train=${r3(bestTrain)} OOS=${r3(meanR(selSplit.oos))}`)
	}
	if (!rows.length) throw new Error('Нет CSV.')

	const aprCI = bootstrapCI(aprOosPool, BOOT, SEED)
	const selCI = bootstrapCI(selOosPool, BOOT, SEED + 1)
	const aprPosSeries = rows.filter((r) => r.aprOos > 0).length
	const selPosSeries = rows.filter((r) => r.selOos > 0).length
	const aprKill = Number.isFinite(aprCI.lo) && aprCI.lo > 0
	const selKill = Number.isFinite(selCI.lo) && selCI.lo > 0

	const md: string[] = []
	md.push('# RE17 — строгая OOS-валидация static-full (Фаза 1d, go/no-go)')
	md.push('')
	md.push(`Протокол: хронологический сплит train=${TRAIN_FRACTION * 100}% / OOS=${(1 - TRAIN_FRACTION) * 100}% на каждой серии. static-full (цель 2×step), safe, добор on, без частички, admitted, ${COST} bps/side. Bootstrap ${BOOT} итер, seed ${SEED}. Kill-критерий: pooled OOS meanR CI-low > 0.`)
	md.push('')
	md.push('## Итог (объединённый OOS по всем сериям)')
	md.push('')
	md.push('| рука | pooled OOS meanR | 95% CI | серий OOS+ | вердикт |')
	md.push('|---|---|---|---|---|')
	md.push(`| A-priori (стоп=${APRIORI_STOP}) | ${r3(aprCI.mean)} | [${r3(aprCI.lo)}, ${r3(aprCI.hi)}] | ${aprPosSeries}/${rows.length} | ${aprKill ? 'edge ПОДТВЕРЖДЁН (CI-low>0)' : 'НЕ подтверждён'} |`)
	md.push(`| Train-selected стоп | ${r3(selCI.mean)} | [${r3(selCI.lo)}, ${r3(selCI.hi)}] | ${selPosSeries}/${rows.length} | ${selKill ? 'edge ПОДТВЕРЖДЁН (CI-low>0)' : 'НЕ подтверждён'} |`)
	md.push('')
	md.push('## Per-series (meanR, 5 bps)')
	md.push('')
	md.push('| актив | ТФ | рынок | apr стоп3 train | apr стоп3 OOS | выбр. стоп | sel train | sel OOS |')
	md.push('|---|---|---|---|---|---|---|---|')
	for (const r of rows) md.push(`| ${r.asset} | ${r.tf} | ${r.market} | ${r3(r.aprTrain)} | ${r3(r.aprOos)} | ${r.selStop} | ${r3(r.selTrain)} | ${r3(r.selOos)} |`)
	md.push('')
	md.push('_Train-selected почти всегда деградирует на OOS (подгонка стопа под train). A-priori (стоп фикс из плато) — честнее. Если даже A-priori CI-low ≤ 0 — устойчивого edge на taker-издержках нет, вердикт NO-GO подтверждается. Ось цели захардкожена 2×step (не свипалась)._')
	writeFileSync(resolve('ci-results/re17-oos-validation.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/re17-oos-validation.json'), JSON.stringify({
		generatedAt: new Date().toISOString(),
		note: 'RE17 strict OOS validation of static-full. chrono 65/35 split, apriori stop=3 vs train-selected stop. pooled OOS bootstrap CI. 5 bps. Engine untouched, target hardcoded 2x.',
		trainFraction: TRAIN_FRACTION, aprioriStop: APRIORI_STOP, cost: COST, boot: BOOT, seed: SEED,
		aprioriOos: { ...aprCI, posSeries: aprPosSeries, killPass: aprKill, poolN: aprOosPool.length },
		trainSelectedOos: { ...selCI, posSeries: selPosSeries, killPass: selKill, poolN: selOosPool.length },
		series: rows,
	}, null, 2))

	console.log('\n=== RE17 OOS итог (5 bps) ===')
	console.log(`  A-priori стоп=${APRIORI_STOP}: pooled OOS meanR=${r3(aprCI.mean)} CI[${r3(aprCI.lo)}, ${r3(aprCI.hi)}] +series ${aprPosSeries}/${rows.length} → ${aprKill ? 'ПОДТВЕРЖДЁН' : 'НЕ подтверждён'}`)
	console.log(`  Train-selected: pooled OOS meanR=${r3(selCI.mean)} CI[${r3(selCI.lo)}, ${r3(selCI.hi)}] +series ${selPosSeries}/${rows.length} → ${selKill ? 'ПОДТВЕРЖДЁН' : 'НЕ подтверждён'}`)
	console.log('Записано: ci-results/re17-oos-validation.{md,json}')
}

main()
