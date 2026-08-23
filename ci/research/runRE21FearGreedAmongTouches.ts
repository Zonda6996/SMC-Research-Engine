/**
 * RE21 — F&G-экстремум СРЕДИ касаний внутренней полосы (последний прицельный заход по стрелке).
 *
 * RE20: гейт «фитиль≥inner + объём + rearm» = необходимое, но НЕ достаточное (precision ~1-18%, density до 47×).
 * Гипотеза RE21: вендор среди этих касаний выбирает по ЭКСТРЕМУМУ осциллятора страха/жадности.
 * Здесь: тот же гейт касания inner (линии вендора) + ФИЛЬТР осциллятора, и меряем recall/precision против shapes.
 *   buy(long, низ зоны):  low≤LoInner  + осциллятор OVERSOLD  (RSI≤thLo | stochPos≤pLo)
 *   sell(short, верх):    high≥UpInner + осциллятор OVERBOUGHT (RSI≥thHi | stochPos≥pHi)
 *   + опц. volMin, направление свечи; rearm у mean; матч ±tol.
 * Свип: osc{rsi,stoch} × n{7,14,21} × пороги{30/70,25/75,20/80,10/90} × volMin{0,1.4} × dir{off,reject} × tol{1,2}.
 * Ранг по F1 при density ≤ 8. Сравнение с RE20 (гейт без F&G). Если precision прыгает ≫ гейта при живом recall — селектор найден.
 *
 * Осцилляторы причинны (только прошлое). Линии зоны вендорские (§2.1). src/core не тронут.
 * Запуск: npx tsx "ci/research/runRE21FearGreedAmongTouches.ts"
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const num = (x: string | undefined): number => { const n = Number((x ?? '').trim()); return Number.isFinite(n) ? n : NaN }
interface Bar { o: number; h: number; l: number; c: number; mean: number; upInner: number; loInner: number; buy: boolean; sell: boolean; vol: number }
function load(file: string): Bar[] {
	const lines = readFileSync(resolve(file), 'utf8').split(/\r?\n/).filter((l) => l.length > 0)
	const out: Bar[] = []
	for (let i = 1; i < lines.length; i++) {
		const p = lines[i]!.split(',')
		if (p.length < 13) continue
		const o = num(p[1]), h = num(p[2]), l = num(p[3]), c = num(p[4]), mean = num(p[5]), upInner = num(p[7]), loInner = num(p[8])
		if (![o, h, l, c, mean, upInner, loInner].every(Number.isFinite)) continue
		out.push({ o, h, l, c, mean, upInner, loInner, buy: (p[10] ?? '0').trim() === '1', sell: (p[11] ?? '0').trim() === '1', vol: num(p[12]) || 0 })
	}
	return out
}

function rsi(closes: number[], n: number): number[] {
	const out = new Array(closes.length).fill(NaN)
	let avgGain = 0, avgLoss = 0
	for (let i = 1; i < closes.length; i++) {
		const ch = closes[i]! - closes[i - 1]!
		const g = Math.max(0, ch), l = Math.max(0, -ch)
		if (i <= n) { avgGain += g / n; avgLoss += l / n; if (i === n) out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss) }
		else { avgGain = (avgGain * (n - 1) + g) / n; avgLoss = (avgLoss * (n - 1) + l) / n; out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss) }
	}
	return out
}
function stochPos(bars: Bar[], n: number): number[] {
	const out = new Array(bars.length).fill(NaN)
	for (let i = 0; i < bars.length; i++) {
		if (i < n - 1) continue
		let mn = Infinity, mx = -Infinity
		for (let j = i - n + 1; j <= i; j++) { if (bars[j]!.l < mn) mn = bars[j]!.l; if (bars[j]!.h > mx) mx = bars[j]!.h }
		out[i] = mx > mn ? (bars[i]!.c - mn) / (mx - mn) : NaN
	}
	return out
}
function volRatioArr(bars: Bar[], win = 20): number[] {
	const out = new Array(bars.length).fill(NaN)
	for (let i = 0; i < bars.length; i++) { let s = 0, k = 0; for (let j = Math.max(0, i - win); j < i; j++) { s += bars[j]!.vol; k++ } out[i] = k && s > 0 ? bars[i]!.vol / (s / k) : NaN }
	return out
}

type Dir = 'off' | 'reject'
type Osc = 'rsi' | 'stoch'
interface Cfg { osc: Osc; n: number; thLo: number; thHi: number; volMin: number; dir: Dir; tol: number }
interface Fire { i: number; side: 'buy' | 'sell' }

function fires(bars: Bar[], vr: number[], oscArr: number[], cfg: Cfg): Fire[] {
	const out: Fire[] = []
	let armedBuy = true, armedSell = true
	for (let i = 0; i < bars.length; i++) {
		const b = bars[i]!
		if (b.c >= b.mean) armedBuy = true
		if (b.c <= b.mean) armedSell = true
		const volOk = !(cfg.volMin > 0) || (Number.isFinite(vr[i]) && vr[i]! >= cfg.volMin)
		const osc = oscArr[i]
		if (!Number.isFinite(osc)) continue
		if (armedBuy && b.l <= b.loInner && volOk && osc! <= cfg.thLo) {
			const dirOk = cfg.dir === 'off' || b.c > b.o
			if (dirOk) { out.push({ i, side: 'buy' }); armedBuy = false }
		}
		if (armedSell && b.h >= b.upInner && volOk && osc! >= cfg.thHi) {
			const dirOk = cfg.dir === 'off' || b.c < b.o
			if (dirOk) { out.push({ i, side: 'sell' }); armedSell = false }
		}
	}
	return out
}
interface Score { recall: number; precision: number; f1: number; shapes: number; nFires: number; matched: number; density: number }
function score(bars: Bar[], fireList: Fire[], tol: number): Score {
	const shapes: Fire[] = []
	for (let i = 0; i < bars.length; i++) { if (bars[i]!.buy) shapes.push({ i, side: 'buy' }); else if (bars[i]!.sell) shapes.push({ i, side: 'sell' }) }
	const used = new Array(fireList.length).fill(false)
	let matched = 0
	for (const sh of shapes) {
		let best = -1, bestD = Infinity
		for (let k = 0; k < fireList.length; k++) { if (used[k]) continue; const f = fireList[k]!; if (f.side !== sh.side) continue; const d = Math.abs(f.i - sh.i); if (d <= tol && d < bestD) { bestD = d; best = k } }
		if (best >= 0) { used[best] = true; matched++ }
	}
	const recall = shapes.length ? matched / shapes.length : NaN
	const precision = fireList.length ? matched / fireList.length : NaN
	const f1 = (recall > 0 && precision > 0) ? 2 * recall * precision / (recall + precision) : 0
	return { recall, precision, f1, shapes: shapes.length, nFires: fireList.length, matched, density: shapes.length ? fireList.length / shapes.length : NaN }
}
function tfFromName(f: string): string { const m = /,\s*(\d+)(S)?\.csv/.exec(f); if (!m) return '?'; const n = Number(m[1]); return m[2] ? `${n}s` : (n >= 60 ? `${n / 60}h` : `${n}m`) }
const r2 = (x: number) => Number.isFinite(x) ? x.toFixed(2) : 'n/a'
const pct = (x: number) => Number.isFinite(x) ? (x * 100).toFixed(0) + '%' : 'n/a'

const NS = [7, 14, 21]
const THR: Array<[number, number]> = [[30, 70], [25, 75], [20, 80], [10, 90]]
const VOL = [0, 1.4]
const DIRS: Dir[] = ['off', 'reject']
const TOLS = [1, 2]

interface FileRes { file: string; tf: string; shapes: number; best: Score; bestCfg: Cfg }
function analyze(file: string): FileRes | null {
	const bars = load(`csv/${file}`)
	if (bars.length < 300) return null
	const shapesN = bars.filter((b) => b.buy || b.sell).length
	if (shapesN < 3) return null
	const closes = bars.map((b) => b.c)
	const vr = volRatioArr(bars)
	const rsiArr: Record<number, number[]> = {}, stochArr: Record<number, number[]> = {}
	for (const n of NS) { rsiArr[n] = rsi(closes, n); stochArr[n] = stochPos(bars, n) }
	let best: Score | null = null, bestCfg: Cfg | null = null
	for (const osc of ['rsi', 'stoch'] as Osc[]) for (const n of NS) for (const [thLo, thHi] of THR) for (const volMin of VOL) for (const dir of DIRS) for (const tol of TOLS) {
		const oscArr = osc === 'rsi' ? rsiArr[n]! : stochArr[n]!.map((v) => v * 100) // stochPos 0..1 → 0..100
		const cfg: Cfg = { osc, n, thLo, thHi, volMin, dir, tol }
		const s = score(bars, fires(bars, vr, oscArr, cfg), tol)
		if (s.matched >= 3 && s.density <= 8 && (best == null || s.f1 > best.f1)) { best = s; bestCfg = cfg }
	}
	if (best == null || bestCfg == null) return { file, tf: tfFromName(file), shapes: shapesN, best: { recall: 0, precision: 0, f1: 0, shapes: shapesN, nFires: 0, matched: 0, density: NaN }, bestCfg: { osc: 'rsi', n: 14, thLo: 30, thHi: 70, volMin: 0, dir: 'off', tol: 1 } }
	return { file, tf: tfFromName(file), shapes: shapesN, best, bestCfg }
}

function main() {
	const targets = readdirSync(resolve('csv')).filter((f) => /BINANCE_(ETH|BTC|BNB)USDT,\s*(\d+)(S)?\.csv/.test(f)).sort()
	const rows: FileRes[] = []
	for (const f of targets) {
		const r = analyze(f)
		if (r == null) { console.log(`skip ${f}`); continue }
		rows.push(r)
		const c = r.bestCfg
		console.log(`${f} [${r.tf}] shapes=${r.shapes} | BEST ${c.osc}${c.n} thr${c.thLo}/${c.thHi} vol${c.volMin} ${c.dir} ±${c.tol}: recall ${pct(r.best.recall)} prec ${pct(r.best.precision)} F1 ${r2(r.best.f1)} dens ${r2(r.best.density)} (matched ${r.best.matched}/${r.best.shapes}, fires ${r.best.nFires})`)
	}
	if (!rows.length) throw new Error('Нет near-tick CSV.')

	const md: string[] = []
	md.push('# RE21 — F&G-экстремум среди касаний внутренней полосы vs shapes')
	md.push('')
	md.push('Гейт (RE20): фитиль≥inner + rearm у mean [+объём]. ФИЛЬТР: осциллятор oversold(buy)/overbought(sell). Ранг по F1 при density≤8, matched≥3. Осцилляторы причинны. Сравнивать с RE20 (гейт без F&G): там на 1m/5m F1~0.14–0.20, на fine precision 1–7%.')
	md.push('')
	md.push('| файл | ТФ | shapes | BEST cfg | recall | precision | F1 | density | matched/fires |')
	md.push('|---|---|---|---|---|---|---|---|---|')
	for (const r of rows) {
		const c = r.bestCfg
		md.push(`| ${r.file} | ${r.tf} | ${r.shapes} | ${c.osc}${c.n} ${c.thLo}/${c.thHi} vol${c.volMin} ${c.dir} ±${c.tol} | ${pct(r.best.recall)} | ${pct(r.best.precision)} | ${r2(r.best.f1)} | ${r2(r.best.density)} | ${r.best.matched}/${r.best.nFires} |`)
	}
	md.push('')
	md.push('_Вывод-критерий: если precision СРЕДИ касаний прыгает с ~1–18% (RE20) до заметно выше при живом recall — F&G-осциллятор и есть селектор. Если F1 остаётся ~0.2 и ниже (как OWN2) — F&G среди касаний тоже НЕ разделяет ⇒ селектор не на OHLCV (укрепляет §3, закрываем генерацию стрелки). ⚠ best выбран на этих же данных (in-sample, малые выборки на fine ТФ) — завышает; смотреть на порядок, не на точное число._')
	writeFileSync(resolve('ci-results/re21-feargreed-among-touches.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/re21-feargreed-among-touches.json'), JSON.stringify({ generatedAt: new Date().toISOString(), grid: { NS, THR, VOL, DIRS, TOLS }, rows }, null, 2))
	console.log('\nЗаписано: ci-results/re21-feargreed-among-touches.{md,json}')
}

main()
