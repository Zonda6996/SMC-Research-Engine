/**
 * RE20 — proof-test интрабарного триггера стрелки: recall/precision против реальных shapes.
 *
 * RE19 (по вендорским линиям зоны): стрелка рождается когда ФИТИЛЬ касается ВНУТРЕННЕЙ полосы
 * (не close!) + всплеск объёма; чем ближе к тику, тем чётче (poke 5m 28% → 1s 80%, vol× ~2+).
 * Здесь строим кандидат-триггер и меряем, насколько он воспроизводит shapes:
 *   fire(buy)  = low  ≤ LoInner  (интрабар касание нижней внутренней полосы)
 *   fire(sell) = high ≥ UpInner  (верхней)
 *   + volRatio = vol / mean(vol, i-20..i-1) ≥ volMin
 *   + перевзвод (rearm): сторона взводится только после возврата close к mean (как detectReversals)
 *   + опц. направление свечи (reject: buy close>open / sell close<open; dip: наоборот)
 * Матч против shapes: та же сторона, в пределах ±tol баров, greedy (один fire ↔ один shape).
 * Метрики: recall = сматченные shapes / все shapes; precision = сматченные fires / все fires; F1; density = fires/shape.
 * Свип: volMin×dirMode×tol. Отчёт: best-F1 и a-priori (volMin 1.4, dir off, ±1). Линии зоны — вендорские (§2.1).
 *
 * Запуск: npx tsx "ci/research/runRE20IntrabarTriggerFit.ts"
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

type Dir = 'off' | 'reject' | 'dip'
interface Cfg { volMin: number; dir: Dir; tol: number }
interface Fire { i: number; side: 'buy' | 'sell' }

function volRatioArr(bars: Bar[], win = 20): number[] {
	const out = new Array(bars.length).fill(NaN)
	for (let i = 0; i < bars.length; i++) {
		let s = 0, n = 0
		for (let j = Math.max(0, i - win); j < i; j++) { s += bars[j]!.vol; n++ }
		out[i] = n && s > 0 ? bars[i]!.vol / (s / n) : NaN
	}
	return out
}

function fires(bars: Bar[], vr: number[], cfg: Cfg): Fire[] {
	const out: Fire[] = []
	let armedBuy = true, armedSell = true
	for (let i = 0; i < bars.length; i++) {
		const b = bars[i]!
		// rearm при возврате close к mean
		if (b.c >= b.mean) armedBuy = true
		if (b.c <= b.mean) armedSell = true
		const volOk = !(cfg.volMin > 0) || (Number.isFinite(vr[i]) && vr[i]! >= cfg.volMin)
		if (armedBuy && b.l <= b.loInner && volOk) {
			const dirOk = cfg.dir === 'off' || (cfg.dir === 'reject' ? b.c > b.o : b.c < b.o)
			if (dirOk) { out.push({ i, side: 'buy' }); armedBuy = false }
		}
		if (armedSell && b.h >= b.upInner && volOk) {
			const dirOk = cfg.dir === 'off' || (cfg.dir === 'reject' ? b.c < b.o : b.c > b.o)
			if (dirOk) { out.push({ i, side: 'sell' }); armedSell = false }
		}
	}
	return out
}

interface Score { recall: number; precision: number; f1: number; shapes: number; nFires: number; matched: number; density: number }
function score(bars: Bar[], fireList: Fire[], tol: number): Score {
	const shapes: Fire[] = []
	for (let i = 0; i < bars.length; i++) { if (bars[i]!.buy) shapes.push({ i, side: 'buy' }); else if (bars[i]!.sell) shapes.push({ i, side: 'sell' }) }
	const usedFire = new Array(fireList.length).fill(false)
	let matched = 0
	for (const sh of shapes) {
		let best = -1, bestD = Infinity
		for (let k = 0; k < fireList.length; k++) {
			if (usedFire[k]) continue
			const f = fireList[k]!
			if (f.side !== sh.side) continue
			const d = Math.abs(f.i - sh.i)
			if (d <= tol && d < bestD) { bestD = d; best = k }
		}
		if (best >= 0) { usedFire[best] = true; matched++ }
	}
	const recall = shapes.length ? matched / shapes.length : NaN
	const precision = fireList.length ? matched / fireList.length : NaN
	const f1 = (recall > 0 && precision > 0) ? 2 * recall * precision / (recall + precision) : 0
	return { recall, precision, f1, shapes: shapes.length, nFires: fireList.length, matched, density: shapes.length ? fireList.length / shapes.length : NaN }
}

function tfFromName(f: string): string {
	const m = /,\s*(\d+)(S)?\.csv/.exec(f)
	if (!m) return '?'
	const n = Number(m[1]); return m[2] ? `${n}s` : (n >= 60 ? `${n / 60}h` : `${n}m`)
}
const r2 = (x: number) => Number.isFinite(x) ? x.toFixed(2) : 'n/a'
const pct = (x: number) => Number.isFinite(x) ? (x * 100).toFixed(0) + '%' : 'n/a'

const VOL = [0, 1.2, 1.4, 1.6, 2.0]
const DIRS: Dir[] = ['off', 'reject', 'dip']
const TOLS = [0, 1, 2]
const APRIORI: Cfg = { volMin: 1.4, dir: 'off', tol: 1 }

interface FileRes { file: string; tf: string; shapes: number; apr: Score; aprCfg: Cfg; best: Score; bestCfg: Cfg }

function analyze(file: string): FileRes | null {
	const bars = load(`csv/${file}`)
	if (bars.length < 300) return null
	const shapesN = bars.filter((b) => b.buy || b.sell).length
	if (shapesN < 3) return null
	const vr = volRatioArr(bars)
	const apr = score(bars, fires(bars, vr, APRIORI), APRIORI.tol)
	let best: Score | null = null, bestCfg = APRIORI
	for (const volMin of VOL) for (const dir of DIRS) for (const tol of TOLS) {
		const s = score(bars, fires(bars, vr, { volMin, dir, tol }), tol)
		// требуем density ≤ 8 (не «зона везде»), ранг по F1
		if (s.density <= 8 && (best == null || s.f1 > best.f1)) { best = s; bestCfg = { volMin, dir, tol } }
	}
	if (best == null) best = apr
	return { file, tf: tfFromName(file), shapes: shapesN, apr, aprCfg: APRIORI, best, bestCfg }
}

function main() {
	const targets = readdirSync(resolve('csv')).filter((f) => /BINANCE_(ETH|BTC|BNB)USDT,\s*(\d+)(S)?\.csv/.test(f)).sort()
	const rows: FileRes[] = []
	for (const f of targets) {
		const r = analyze(f)
		if (r == null) { console.log(`skip ${f}`); continue }
		rows.push(r)
		console.log(`${f} [${r.tf}] shapes=${r.shapes} | A-PRIORI(vol1.4,off,±1): recall ${pct(r.apr.recall)} prec ${pct(r.apr.precision)} F1 ${r2(r.apr.f1)} dens ${r2(r.apr.density)} | BEST(vol${r.bestCfg.volMin},${r.bestCfg.dir},±${r.bestCfg.tol}): recall ${pct(r.best.recall)} prec ${pct(r.best.precision)} F1 ${r2(r.best.f1)} dens ${r2(r.best.density)}`)
	}
	if (!rows.length) throw new Error('Нет near-tick CSV.')

	const md: string[] = []
	md.push('# RE20 — интрабарный триггер (фитиль≥inner + объём + rearm) vs shapes: recall/precision')
	md.push('')
	md.push('fire(buy)=low≤LoInner, fire(sell)=high≥UpInner (линии вендора), +volRatio≥volMin, +rearm у mean, опц. направление. Матч ±tol баров, greedy. density=fires/shape (≤8 для best). recall=сматченные shapes/все; precision=сматченные fires/все.')
	md.push('')
	md.push('| файл | ТФ | shapes | A-priori recall/prec/F1 (dens) | BEST cfg | BEST recall/prec/F1 (dens) |')
	md.push('|---|---|---|---|---|---|')
	for (const r of rows) {
		md.push(`| ${r.file} | ${r.tf} | ${r.shapes} | ${pct(r.apr.recall)} / ${pct(r.apr.precision)} / ${r2(r.apr.f1)} (${r2(r.apr.density)}) | vol${r.bestCfg.volMin},${r.bestCfg.dir},±${r.bestCfg.tol} | ${pct(r.best.recall)} / ${pct(r.best.precision)} / ${r2(r.best.f1)} (${r2(r.best.density)}) |`)
	}
	md.push('')
	md.push('_Ориентир: наш прежний OWN2 на closed-баре давал recall ~26–31% (dev) / ~20% (OOS). Если на 1s/5s recall≫этого при precision≫случайной — интрабар-касание-inner подтверждено как механизм. §2.1: линии зоны вендорские, порог объёма/направление свипаны (не выдуманы). src/core не тронут._')
	writeFileSync(resolve('ci-results/re20-intrabar-trigger-fit.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/re20-intrabar-trigger-fit.json'), JSON.stringify({ generatedAt: new Date().toISOString(), grid: { VOL, DIRS, TOLS }, apriori: APRIORI, rows }, null, 2))
	console.log('\nЗаписано: ci-results/re20-intrabar-trigger-fit.{md,json}')
}

main()
