/**
 * RE19 — микроструктура стрелки на near-tick данных (ETH/BTC/BNB, 5m→1s), по РЕАЛЬНЫМ линиям зоны вендора.
 *
 * Новые CSV содержат линии зоны вендора в каждом баре (cols 5-9: Mean, UpOuter, UpInner, LoInner, LoOuter)
 * + shapes (col10 buy / col11 sell) + volume (col12). На 1s/5s бар ≈ тик → триггер стрелки виден почти
 * без интрабар-неоднозначности. Цель: точно измерить, ГДЕ и ПРИ ЧЁМ рождается стрелка.
 *
 * Для каждой стрелки (по её же ТФ) считаем по ВЕНДОРСКИМ линиям того же бара:
 *   f = глубина проникновения к своей стороне зоны как доля пути mean→ВНЕШНИЙ край.
 *       buy(long): низ зоны, denom = mean - LoOuter; f_close=(mean-close)/denom; f_wick=(mean-low)/denom.
 *       sell(short): верх, denom = UpOuter - mean; f_close=(close-mean)/denom; f_wick=(high-mean)/denom.
 *   innerFrac = доля пути до ВНУТРЕННЕЙ полосы (buy: (mean-LoInner)/denom; sell: (UpInner-mean)/denom).
 *   candleDir (close vs open), momentum (close vs close[-k]), volRatio (vol / средн. trailing).
 * Сводка per-file: медиана/p10/p90 f_close, f_wick, innerFrac; доля «фитиль≥inner, close<inner» (интрабар-прокол);
 * распределение направления свечи; сравнение с baseline (медиана |f| по ВСЕМ барам, чтобы видеть, глубже ли стрелка).
 *
 * Ничего не выдумываем (§2.1): используем линии вендора как есть. src/core не тронут. Чистая диагностика.
 * Запуск: npx tsx "ci/research/runRE19ArrowMicrostructure.ts"
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const num = (x: string | undefined): number => { const n = Number((x ?? '').trim()); return Number.isFinite(n) ? n : NaN }

interface Bar { t: number; o: number; h: number; l: number; c: number; mean: number; upOuter: number; upInner: number; loInner: number; loOuter: number; buy: boolean; sell: boolean; vol: number }
function load(file: string): Bar[] {
	const lines = readFileSync(resolve(file), 'utf8').split(/\r?\n/).filter((l) => l.length > 0)
	const out: Bar[] = []
	for (let i = 1; i < lines.length; i++) {
		const p = lines[i]!.split(',')
		if (p.length < 13) continue
		const t = num(p[0]), o = num(p[1]), h = num(p[2]), l = num(p[3]), c = num(p[4])
		const mean = num(p[5]), upOuter = num(p[6]), upInner = num(p[7]), loInner = num(p[8]), loOuter = num(p[9])
		if (![t, o, h, l, c, mean].every(Number.isFinite)) continue
		out.push({ t, o, h, l, c, mean, upOuter, upInner, loInner, loOuter, buy: (p[10] ?? '0').trim() === '1', sell: (p[11] ?? '0').trim() === '1', vol: num(p[12]) || 0 })
	}
	return out
}

const median = (a: number[]): number => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2 }
const quantile = (a: number[], q: number): number => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))]! }
const mean = (a: number[]): number => a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN

interface Feat { side: 'buy' | 'sell'; fClose: number; fWick: number; innerFrac: number; dir: number; mom: number; volRatio: number }
function featAt(bars: Bar[], i: number, side: 'buy' | 'sell'): Feat | null {
	const b = bars[i]!
	if (![b.mean, b.upOuter, b.loOuter, b.upInner, b.loInner].every(Number.isFinite)) return null
	let denom: number, fClose: number, fWick: number, innerFrac: number
	if (side === 'buy') {
		denom = b.mean - b.loOuter
		if (!(denom > 0)) return null
		fClose = (b.mean - b.c) / denom
		fWick = (b.mean - b.l) / denom
		innerFrac = (b.mean - b.loInner) / denom
	} else {
		denom = b.upOuter - b.mean
		if (!(denom > 0)) return null
		fClose = (b.c - b.mean) / denom
		fWick = (b.h - b.mean) / denom
		innerFrac = (b.upInner - b.mean) / denom
	}
	const dir = Math.sign(b.c - b.o)
	const k = 5
	const past = bars[i - k]
	const mom = past ? (b.c - past.c) / (past.c || 1) : NaN
	const win = 20
	let vs = 0, vn = 0
	for (let j = Math.max(0, i - win); j < i; j++) { vs += bars[j]!.vol; vn++ }
	const volRatio = vn && vs > 0 ? b.vol / (vs / vn) : NaN
	return { side, fClose, fWick, innerFrac, dir, mom, volRatio }
}

function tfFromName(f: string): string {
	const m = /,\s*(\d+)(S)?\.csv/.exec(f)
	if (!m) return '?'
	const n = Number(m[1])
	if (m[2]) return `${n}s`
	return n >= 60 ? `${n / 60}h` : `${n}m`
}

interface FileResult {
	file: string; tf: string; bars: number; nBuy: number; nSell: number
	medFClose: number; p10FClose: number; p90FClose: number
	medFWick: number; medInnerFrac: number
	pctWickReachInner: number; pctCloseReachInner: number; pctIntrabarPoke: number
	dirUp: number; dirDown: number; dirFlat: number
	medMomPct: number; medVolRatio: number
	baselineMedAbsFClose: number
	arrows: Feat[]
}

function analyzeFile(file: string): FileResult | null {
	const bars = load(`csv/${file}`)
	if (bars.length < 300) return null
	const feats: Feat[] = []
	for (let i = 0; i < bars.length; i++) {
		const b = bars[i]!
		if (b.buy) { const f = featAt(bars, i, 'buy'); if (f) feats.push(f) }
		else if (b.sell) { const f = featAt(bars, i, 'sell'); if (f) feats.push(f) }
	}
	// baseline: медиана |f_close| по всем барам (насколько типичный бар близок к своей стороне зоны)
	const baseAbs: number[] = []
	for (let i = 0; i < bars.length; i++) {
		const b = bars[i]!
		const side: 'buy' | 'sell' = b.c < b.mean ? 'buy' : 'sell'
		const f = featAt(bars, i, side)
		if (f && Number.isFinite(f.fClose)) baseAbs.push(f.fClose)
	}
	if (!feats.length) return null
	const fc = feats.map((f) => f.fClose).filter(Number.isFinite)
	const fw = feats.map((f) => f.fWick).filter(Number.isFinite)
	const infr = feats.map((f) => f.innerFrac).filter(Number.isFinite)
	const wickReachInner = feats.filter((f) => f.fWick >= f.innerFrac).length
	const closeReachInner = feats.filter((f) => f.fClose >= f.innerFrac).length
	const poke = feats.filter((f) => f.fWick >= f.innerFrac && f.fClose < f.innerFrac).length
	return {
		file, tf: tfFromName(file), bars: bars.length, nBuy: bars.filter((b) => b.buy).length, nSell: bars.filter((b) => b.sell).length,
		medFClose: median(fc), p10FClose: quantile(fc, 0.1), p90FClose: quantile(fc, 0.9),
		medFWick: median(fw), medInnerFrac: median(infr),
		pctWickReachInner: wickReachInner / feats.length, pctCloseReachInner: closeReachInner / feats.length, pctIntrabarPoke: poke / feats.length,
		dirUp: feats.filter((f) => f.dir > 0).length, dirDown: feats.filter((f) => f.dir < 0).length, dirFlat: feats.filter((f) => f.dir === 0).length,
		medMomPct: median(feats.map((f) => f.mom).filter(Number.isFinite)) * 100,
		medVolRatio: median(feats.map((f) => f.volRatio).filter(Number.isFinite)),
		baselineMedAbsFClose: median(baseAbs),
		arrows: feats,
	}
}

const r2 = (x: number) => Number.isFinite(x) ? x.toFixed(2) : 'n/a'
const r3 = (x: number) => Number.isFinite(x) ? x.toFixed(3) : 'n/a'
const pct = (x: number) => Number.isFinite(x) ? (x * 100).toFixed(0) + '%' : 'n/a'

function main() {
	// все новые near-tick файлы с линиями зоны (ETH полный набор + BTC/BNB мелкие)
	const targets = readdirSync(resolve('csv')).filter((f) => /BINANCE_(ETH|BTC|BNB)USDT,\s*(\d+)(S)?\.csv/.test(f)).sort()
	const results: FileResult[] = []
	for (const f of targets) {
		const r = analyzeFile(f)
		if (r == null) { console.log(`skip ${f}`); continue }
		results.push(r)
		console.log(`${f} [${r.tf}] N=${r.nBuy + r.nSell} (b${r.nBuy}/s${r.nSell}): f_close med ${r2(r.medFClose)} [${r2(r.p10FClose)}..${r2(r.p90FClose)}], f_wick med ${r2(r.medFWick)}, innerFrac ${r2(r.medInnerFrac)} | wick≥inner ${pct(r.pctWickReachInner)}, close≥inner ${pct(r.pctCloseReachInner)}, poke ${pct(r.pctIntrabarPoke)} | dir +${r.dirUp}/-${r.dirDown}/0${r.dirFlat} mom ${r2(r.medMomPct)}% vol× ${r2(r.medVolRatio)} | baseline|f| ${r2(r.baselineMedAbsFClose)}`)
	}
	if (!results.length) throw new Error('Нет near-tick CSV с линиями зоны.')

	const md: string[] = []
	md.push('# RE19 — микроструктура стрелки по реальным линиям зоны (near-tick)')
	md.push('')
	md.push('f = глубина к своей стороне зоны (доля пути mean→ВНЕШНИЙ край) по ВЕНДОРСКИМ линиям бара. innerFrac ≈ где внутренняя полоса (~0.58). f_close по close, f_wick по фитилю (low buy / high sell). «poke» = фитиль дошёл до inner, а close вернулся внутрь (интрабар-прокол). baseline|f| = медиана глубины по ВСЕМ барам (для контраста).')
	md.push('')
	md.push('| файл | ТФ | N (b/s) | f_close med [p10..p90] | f_wick med | innerFrac | wick≥inner | close≥inner | intrabar-poke | dir +/−/0 | mom% | vol× | baseline\\|f\\| |')
	md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
	for (const r of results) {
		md.push(`| ${r.file} | ${r.tf} | ${r.nBuy + r.nSell} (${r.nBuy}/${r.nSell}) | ${r2(r.medFClose)} [${r2(r.p10FClose)}..${r2(r.p90FClose)}] | ${r2(r.medFWick)} | ${r2(r.medInnerFrac)} | ${pct(r.pctWickReachInner)} | ${pct(r.pctCloseReachInner)} | ${pct(r.pctIntrabarPoke)} | ${r.dirUp}/${r.dirDown}/${r.dirFlat} | ${r2(r.medMomPct)} | ${r2(r.medVolRatio)} | ${r2(r.baselineMedAbsFClose)} |`)
	}
	md.push('')
	md.push('## Как читать')
	md.push('- **f_close ≈ innerFrac (~0.58)** и **close≥inner высокий %** ⇒ стрелка рождается когда ЗАКРЫТИЕ у внутренней полосы (порог по close).')
	md.push('- **f_wick ≥ inner, но intrabar-poke высокий** ⇒ триггер интрабарный: фитиль прокалывает inner, close возвращается (репейнт-механика).')
	md.push('- **f_close заметно > baseline|f|** ⇒ стрелка глубже типичного бара (зона реально дискриминирует).')
	md.push('- **dir**: buy обычно на медвежьей свече (−) у низа, sell на бычьей (+) у верха — проверка «контр-свеча».')
	md.push('')
	writeFileSync(resolve('ci-results/re19-arrow-microstructure.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/re19-arrow-microstructure.json'), JSON.stringify({
		generatedAt: new Date().toISOString(),
		note: 'RE19 arrow microstructure using vendor zone lines (cols 5-9). f=penetration fraction mean->outer, per arrow bar. near-tick ETH/BTC/BNB. Diagnostic only, engine untouched.',
		results: results.map((r) => ({ ...r, arrows: r.arrows })),
	}, null, 2))
	console.log('\nЗаписано: ci-results/re19-arrow-microstructure.{md,json}')
}

main()
