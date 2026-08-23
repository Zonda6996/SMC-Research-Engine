/**
 * RE13 — Фаза 0: ДЕКОМПОЗИЦИЯ ОЖИДАНИЯ по всем вендор-CSV (почему WR не бьётся с деньгами).
 *
 * Вопрос: WR высокий (~0.8), а expectancy ≈0. Формула: E = WR·avgWin − (1−WR)·avgLoss.
 * Значит avgLoss/avgWin ≈ WR/(1−WR). Здесь считаем это ЯВНО по каждому активу/ТФ:
 *   - средний выигрыш R (netR>0), средний проигрыш R (|netR<0|), payoff = avgWin/avgLoss;
 *   - breakeven-WR = 1/(1+payoff) — какой WR нужен, чтобы выйти в ноль;
 *   - зазор actualWR − breakevenWR (>0 → плюс, <0 → минус);
 *   - вклад корзин (fullfix/partial/stop) в totalR.
 *
 * Входы = стрелки vendor CSV shapes (все файлы в csv/). Реплей = `replayAdmittedArrowSignals`
 * (каждая стрелка = сделка; occupancy вендора уже в наборе shapes — см. RE12c). Режим `safe`,
 * base {fullFixAtMean:false, addEnabled:true}, каноничный стоп stopSteps=2 (safe-дефолт, НЕ фит —
 * калибровку под vendor stop-rate тут НЕ делаем, чтобы сравнивать активы на одном стопе).
 * Издержки 0 и 5 bps/side. Таксономия ярлыков — V-WIN (частичка→стоп = Partial/WIN, как у вендора).
 *
 * §2.2: движок src/core НЕ тронут. §2.1: правила не выдуманы — стоп = канон safe, тейк = как в движке
 * (partial у mean, full у внутренней полосы). Экономика по netR (с добором: oneR по усреднённому входу).
 *
 * Запуск: npx tsx "ci/research/runRE13ExpectancyDecomp.ts"
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { arrowAtr200, ARROW_SIGNAL_VERSION } from '../../src/core/signals/ArrowSignalEngine.js'
import type { ArrowSignal, ArrowSide, ArrowMode } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayAdmittedArrowSignals } from '../../src/core/signals/ArrowTradeReplay.js'
import type { ArrowTrade, ArrowModeConfig } from '../../src/core/signals/ArrowTradeReplay.js'

const MODE: ArrowMode = 'safe'
const STOP_STEPS = 2
const COST_BPS = [0, 5]
const BASE: Partial<ArrowModeConfig> = { fullFixAtMean: false, addEnabled: true }

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

function run(loaded: Loaded, cost: number): ArrowTrade[] {
	const bands = computeApexBands([...loaded.candles], APEX_PARAMS)
	const atr = arrowAtr200(loaded.candles)
	const signals = signalsFromShapes(loaded.candles, bands, atr, loaded.shapes)
	const replay = replayAdmittedArrowSignals(loaded.candles, bands, signals, MODE, { ...BASE, stopSteps: STOP_STEPS, oneWayCostBps: cost })
	return replay.trades.filter((t) => t.outcome !== 'open')
}

interface Bucket { n: number; totalR: number }
interface Decomp {
	n: number
	// V-WIN label buckets
	fullfix: number; partial: number; stop: number; excluded: number
	labelWR: number
	// money
	wrMoney: number; avgWin: number; avgLoss: number; payoff: number; breakevenWR: number; edgeWR: number
	totalR: number; meanR: number; pf: number | null
	// per-bucket money contribution (fullfix/partial-stop/stop)
	byBucket: { fullTp: Bucket; partialStop: Bucket; stop: Bucket; timeout: Bucket }
}
function decompose(trades: ArrowTrade[]): Decomp {
	const n = trades.length
	let fullfix = 0, partial = 0, stop = 0, excluded = 0
	const byBucket = { fullTp: { n: 0, totalR: 0 }, partialStop: { n: 0, totalR: 0 }, stop: { n: 0, totalR: 0 }, timeout: { n: 0, totalR: 0 } }
	for (const t of trades) {
		if (t.outcome === 'full-tp') { fullfix++; byBucket.fullTp.n++; byBucket.fullTp.totalR += t.netR }
		else if (t.partialTaken) { partial++; byBucket.partialStop.n++; byBucket.partialStop.totalR += t.netR }
		else if (t.outcome === 'stop') { stop++; byBucket.stop.n++; byBucket.stop.totalR += t.netR }
		else { excluded++; byBucket.timeout.n++; byBucket.timeout.totalR += t.netR }
	}
	const terminal = fullfix + partial + stop
	const labelWR = terminal ? (fullfix + partial) / terminal : NaN
	const winsR = trades.filter((t) => t.netR > 0).map((t) => t.netR)
	const lossesR = trades.filter((t) => t.netR < 0).map((t) => -t.netR)
	const totalR = trades.reduce((s, t) => s + t.netR, 0)
	const gains = winsR.reduce((s, v) => s + v, 0)
	const losses = lossesR.reduce((s, v) => s + v, 0)
	const avgWin = winsR.length ? gains / winsR.length : NaN
	const avgLoss = lossesR.length ? losses / lossesR.length : NaN
	const payoff = Number.isFinite(avgWin) && Number.isFinite(avgLoss) && avgLoss > 0 ? avgWin / avgLoss : NaN
	const breakevenWR = Number.isFinite(payoff) ? 1 / (1 + payoff) : NaN
	const wrMoney = n ? winsR.length / n : NaN
	const edgeWR = Number.isFinite(breakevenWR) ? wrMoney - breakevenWR : NaN
	const pf = losses > 0 ? gains / losses : (gains > 0 ? Number.POSITIVE_INFINITY : null)
	return { n, fullfix, partial, stop, excluded, labelWR, wrMoney, avgWin, avgLoss, payoff, breakevenWR, edgeWR, totalR, meanR: n ? totalR / n : 0, pf, byBucket }
}

// --- имя актива/ТФ из имени файла: "BINANCE_ETHUSDT, 120.csv" / "BINANCE_BNBUSDT.P, 5.csv"
function parseName(file: string): { asset: string; tf: string; market: string } {
	const m = /BINANCE_([A-Z]+)USDT(\.P)?,\s*(\d+)\.csv/.exec(file)
	if (!m) return { asset: file, tf: '?', market: '?' }
	const asset = m[1]!
	const market = m[2] ? 'perp' : 'spot'
	const minutes = Number(m[3])
	const tf = minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`
	return { asset, tf, market }
}

function pct(x: number): string { return Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a' }
function pf2(x: number | null): string { return x == null ? 'n/a' : (x === Number.POSITIVE_INFINITY ? '∞' : x.toFixed(2)) }
function r2(x: number): string { return Number.isFinite(x) ? x.toFixed(2) : 'n/a' }
function r3(x: number): string { return Number.isFinite(x) ? x.toFixed(3) : 'n/a' }

interface Row { file: string; asset: string; tf: string; market: string; d0: Decomp; d5: Decomp }

function main() {
	const files = readdirSync(resolve('csv')).filter((f) => f.endsWith('.csv')).sort()
	const rows: Row[] = []
	for (const f of files) {
		const path = `csv/${f}`
		let l: Loaded
		try { l = loadCsv(path) } catch (e) { console.log(`skip ${f}: ${(e as Error).message}`); continue }
		if (l.candles.length < 400 || l.shapes.length < 5) { console.log(`skip ${f}: rows=${l.candles.length} shapes=${l.shapes.length}`); continue }
		const meta = parseName(f)
		const d0 = decompose(run(l, 0))
		const d5 = decompose(run(l, 5))
		rows.push({ file: f, ...meta, d0, d5 })
		console.log(`${meta.asset} ${meta.tf} ${meta.market}: N=${d0.n} WR=${pct(d0.wrMoney)} avgWin=${r2(d0.avgWin)}R avgLoss=${r2(d0.avgLoss)}R payoff=${r2(d0.payoff)} breakevenWR=${pct(d0.breakevenWR)} edge=${pct(d0.edgeWR)} | totalR@0=${r2(d0.totalR)} @5=${r2(d5.totalR)} meanR@5=${r3(d5.meanR)} PF@5=${pf2(d5.pf)}`)
	}
	if (!rows.length) throw new Error('Нет CSV.')

	const md: string[] = []
	md.push('# RE13 — декомпозиция ожидания по всем вендор-CSV (почему WR ≠ деньги)')
	md.push('')
	md.push('**Вопрос:** WR высокий, expectancy ≈0. `E = WR·avgWin − (1−WR)·avgLoss` ⇒ для плюса нужно `WR > breakevenWR = 1/(1+payoff)`, где `payoff = avgWin/avgLoss` (в R).')
	md.push('')
	md.push(`Входы = vendor CSV shapes; реплей = **admitted** (каждая стрелка = сделка); режим **${MODE}**, base {fullFixAtMean:false, addEnabled:true}, стоп **${STOP_STEPS}×step** (safe-канон, НЕ фит); тейк движка: partial у mean, full у внутренней полосы; издержки 0 и 5 bps/side. Экономика по netR (с добором: oneR по усреднённому входу). Таксономия ярлыков — V-WIN (частичка→стоп = Partial/WIN).`)
	md.push('')
	md.push('## Сводка (на 5 bps, если не указано иное)')
	md.push('')
	md.push('| актив | ТФ | рынок | N | WR (деньги) | avgWin R | avgLoss R | payoff | breakeven-WR | запас WR (факт−безуб.) | totalR@0 | totalR@5 | meanR@5 | PF@5 |')
	md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
	for (const r of rows) {
		md.push(`| ${r.asset} | ${r.tf} | ${r.market} | ${r.d0.n} | ${pct(r.d0.wrMoney)} | ${r2(r.d0.avgWin)} | ${r2(r.d0.avgLoss)} | ${r2(r.d0.payoff)} | ${pct(r.d0.breakevenWR)} | ${pct(r.d0.edgeWR)} | ${r2(r.d0.totalR)} | ${r2(r.d5.totalR)} | ${r3(r.d5.meanR)} | ${pf2(r.d5.pf)} |`)
	}
	md.push('')
	md.push('## Вклад корзин в totalR (0 bps): куда «утекает» R')
	md.push('')
	md.push('| актив | ТФ | full-tp (N / ΣR / avgR) | partial-stop (N / ΣR / avgR) | stop (N / ΣR / avgR) |')
	md.push('|---|---|---|---|---|')
	for (const r of rows) {
		const b = r.d0.byBucket
		const cell = (x: Bucket) => `${x.n} / ${r2(x.totalR)} / ${x.n ? r3(x.totalR / x.n) : 'n/a'}`
		md.push(`| ${r.asset} | ${r.tf} | ${cell(b.fullTp)} | ${cell(b.partialStop)} | ${cell(b.stop)} |`)
	}
	md.push('')
	md.push('## Как читать')
	md.push('')
	md.push('- **payoff < WR/(1−WR)** ⇒ плюс. Эквивалентно: **запас WR = факт.WR − breakeven-WR**; >0 плюс, <0 минус.')
	md.push('- Высокий label-WR (partial+full) обманчив: `partial-stop` — «выигрыш» по ярлыку, но по деньгам часто ≈0/минус (взяли 25% у mean, остаток по стопу). Смотреть колонку avgR у `partial-stop`.')
	md.push('- `full-tp` — единственная реально плюсовая корзина; `stop` — крупный минус (полный лосс). Баланс между ними и решает.')
	md.push('')
	writeFileSync(resolve('ci-results/re13-expectancy-decomposition.md'), md.join('\n'))

	const jsonOut = {
		generatedAt: new Date().toISOString(),
		note: 'RE13 Phase-0 expectancy decomposition across all vendor CSVs. safe, fullFixAtMean:false+add, admitted replay, stopSteps=2 (canonical, not fit), costs 0 & 5 bps. V-WIN labels. Engine untouched.',
		mode: MODE, stopSteps: STOP_STEPS, costBps: COST_BPS,
		rows: rows.map((r) => ({ asset: r.asset, tf: r.tf, market: r.market, file: r.file, cost0: r.d0, cost5: r.d5 })),
	}
	writeFileSync(resolve('ci-results/re13-expectancy-decomposition.json'), JSON.stringify(jsonOut, null, 2))
	console.log('\nЗаписано: ci-results/re13-expectancy-decomposition.{md,json}')
}

main()
