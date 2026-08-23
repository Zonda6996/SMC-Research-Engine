/**
 * RE5 — фит триггера как «ЭКСТРЕМУМ ВОЛНЫ + подтверждение разворота» (зона = линии вендора из CSV).
 *
 * Мотив (RE4): наивный порог глубины «первый бар, достигший f» воспроизводит shapes плохо (recall
 * 17% train / 11.5% OOS, ниже OWN2 26–31%). Наблюдение автора: сигнал приходит НЕ на касании линии.
 * Гипотеза: стрелка вендора стоит на ЛОКАЛЬНОМ экстремуме волны (глубочайший бар захода в зону) с
 * подтверждением разворота, а НЕ на первом пересечении порога.
 *
 * «Волна» (excursion): период, пока close по одну сторону от mean (down: close<mean → buy-контекст;
 * up: close>mean → sell-контекст). Внутри волны трекаем макс. глубину (доля пути mean→ВНЕШНИЙ край,
 * по фитилю) и её бар. Волна должна достичь глубины ≥ fMin. Режимы триггера:
 *   • 'extreme'      — стрелка на баре макс. глубины (РЕТРОСПЕКТИВНО, look-ahead внутри волны! только
 *                      как ПОТОЛОК recall/референс «плотит ли вендор ровно на экстремуме», НЕ causal).
 *   • 'revCandle'    — первая разворотная свеча после достижения fMin (buy: close>open; sell: close<open). CAUSAL.
 *   • 'closeBackInner' — первый возврат close внутрь (buy: close поднялся выше lowerInner; sell: ниже upperInner). CAUSAL.
 * Одна стрелка на волну; сброс при возврате close к mean. Опц. relVol на баре срабатывания + min-spacing.
 *
 * Матч ±1 бар с реальными shapes. TRAIN (BTC.P 5m/15m + BNB.P 5m) / OOS (BTC.P 1h + VIRTUAL.P 5m).
 * Движок src/core НЕ трогается — измерительный харнесс (§2.2). Зона — из CSV-линий вендора.
 *
 * Запуск: npx tsx ci/research/runRE5ExtremeReversalFit.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const WARMUP = 210
const REL_VOL_PERIOD = 20
const TRAIN = new Set(['BTC.P 5m', 'BTC.P 15m', 'BNB.P 5m'])
const FILES: Array<{ key: string; file: string }> = [
	{ key: 'BTC.P 5m', file: 'csv/BINANCE_BTCUSDT.P, 5.csv' },
	{ key: 'BTC.P 15m', file: 'csv/BINANCE_BTCUSDT.P, 15.csv' },
	{ key: 'BTC.P 1h', file: 'csv/BINANCE_BTCUSDT.P, 60.csv' },
	{ key: 'BNB.P 5m', file: 'csv/BINANCE_BNBUSDT.P, 5.csv' },
	{ key: 'VIRTUAL.P 5m', file: 'csv/BINANCE_VIRTUALUSDT.P, 5.csv' },
]

interface Row {
	open: number; high: number; low: number; close: number; volume: number
	mean: number; upperOuter: number; upperInner: number; lowerInner: number; lowerOuter: number
	buy: boolean; sell: boolean
}
interface Prep { key: string; rows: Row[]; shapeIdx: Array<{ i: number; side: 'buy' | 'sell' }> }
const num = (x: string | undefined): number => { const n = Number((x ?? '').trim()); return Number.isFinite(n) ? n : NaN }

function loadCsv(file: string): Row[] {
	const lines = readFileSync(resolve(file), 'utf8').split(/\r?\n/).filter((l) => l.length > 0)
	const rows: Row[] = []
	for (let li = 1; li < lines.length; li++) {
		const p = lines[li]!.split(',')
		if (p.length < 13) continue
		const o = num(p[1]), h = num(p[2]), l = num(p[3]), c = num(p[4])
		if (![o, h, l, c].every(Number.isFinite)) continue
		rows.push({
			open: o, high: h, low: l, close: c, volume: num(p[12]) || 0,
			mean: num(p[5]), upperOuter: num(p[6]), upperInner: num(p[7]), lowerInner: num(p[8]), lowerOuter: num(p[9]),
			buy: (p[10] ?? '0').trim() === '1', sell: (p[11] ?? '0').trim() === '1',
		})
	}
	return rows
}
function relVolAt(rows: Row[], i: number): number {
	if (i < REL_VOL_PERIOD) return 0
	let sum = 0
	for (let j = i - REL_VOL_PERIOD; j < i; j++) sum += rows[j]!.volume
	return sum > 0 ? rows[i]!.volume / (sum / REL_VOL_PERIOD) : 0
}
function depthBuy(r: Row): number { const path = r.mean - r.lowerOuter; return path > 0 ? (r.mean - r.low) / path : NaN }
function depthSell(r: Row): number { const path = r.upperOuter - r.mean; return path > 0 ? (r.high - r.mean) / path : NaN }

type TrigMode = 'extreme' | 'revCandle' | 'closeBackInner'
interface Cfg { mode: TrigMode; fMin: number; relVolMin: number; spacing: number }

function genArrows(rows: Row[], cfg: Cfg): Array<{ i: number; side: 'buy' | 'sell' }> {
	const raw: Array<{ i: number; side: 'buy' | 'sell' }> = []
	// состояние волны
	let side: 'none' | 'down' | 'up' = 'none'
	let maxDepth = 0, extremeIdx = -1, reachedF = false, fired = false
	const relOk = (i: number) => cfg.relVolMin <= 0 || relVolAt(rows, i) >= cfg.relVolMin
	const closeWave = (endIdx: number) => {
		// на закрытии волны: extreme-режим ставит стрелку ретроспективно на бар экстремума
		if (cfg.mode === 'extreme' && reachedF && !fired && extremeIdx >= 0 && relOk(extremeIdx)) {
			raw.push({ i: extremeIdx, side: side === 'down' ? 'buy' : 'sell' })
		}
		side = 'none'; maxDepth = 0; extremeIdx = -1; reachedF = false; fired = false
	}
	for (let i = WARMUP; i < rows.length; i++) {
		const r = rows[i]!
		if (![r.mean, r.lowerOuter, r.upperOuter, r.lowerInner, r.upperInner].every(Number.isFinite)) continue
		const pos: 'below' | 'above' | 'mid' = r.close < r.mean ? 'below' : r.close > r.mean ? 'above' : 'mid'
		// смена/старт волны
		if (side === 'none') {
			if (pos === 'below') side = 'down'
			else if (pos === 'above') side = 'up'
			else continue
			maxDepth = 0; extremeIdx = -1; reachedF = false; fired = false
		} else if ((side === 'down' && pos === 'above') || (side === 'up' && pos === 'below')) {
			closeWave(i)
			// новая волна с этого бара
			side = pos === 'below' ? 'down' : 'up'
			maxDepth = 0; extremeIdx = -1; reachedF = false; fired = false
		}
		// трекинг внутри волны
		if (side === 'down') {
			const d = depthBuy(r)
			if (Number.isFinite(d) && d > maxDepth) { maxDepth = d; extremeIdx = i }
			if (Number.isFinite(d) && d >= cfg.fMin) reachedF = true
			if (reachedF && !fired && cfg.mode !== 'extreme') {
				const trig = cfg.mode === 'revCandle' ? r.close > r.open : r.close > r.lowerInner
				if (trig && relOk(i)) { raw.push({ i, side: 'buy' }); fired = true }
			}
		} else if (side === 'up') {
			const d = depthSell(r)
			if (Number.isFinite(d) && d > maxDepth) { maxDepth = d; extremeIdx = i }
			if (Number.isFinite(d) && d >= cfg.fMin) reachedF = true
			if (reachedF && !fired && cfg.mode !== 'extreme') {
				const trig = cfg.mode === 'revCandle' ? r.close < r.open : r.close < r.upperInner
				if (trig && relOk(i)) { raw.push({ i, side: 'sell' }); fired = true }
			}
		}
	}
	// min-spacing per side
	raw.sort((a, b) => a.i - b.i)
	const out: Array<{ i: number; side: 'buy' | 'sell' }> = []
	let lastLong = -1e9, lastShort = -1e9
	for (const a of raw) {
		const last = a.side === 'buy' ? lastLong : lastShort
		if (a.i - last < cfg.spacing) continue
		out.push(a); if (a.side === 'buy') lastLong = a.i; else lastShort = a.i
	}
	return out
}

interface Score { shapeN: number; ourN: number; recall: number; precision: number; f1: number; density: number }
function score(prep: Prep, arrows: Array<{ i: number; side: 'buy' | 'sell' }>): Score {
	const ourByIdx = new Map<number, Set<'buy' | 'sell'>>()
	for (const a of arrows) { const s = ourByIdx.get(a.i) ?? new Set<'buy' | 'sell'>(); s.add(a.side); ourByIdx.set(a.i, s) }
	const shapeByIdx = new Map<number, Set<'buy' | 'sell'>>()
	for (const s of prep.shapeIdx) { const set = shapeByIdx.get(s.i) ?? new Set<'buy' | 'sell'>(); set.add(s.side); shapeByIdx.set(s.i, set) }
	let matched = 0
	for (const s of prep.shapeIdx) { let hit = false; for (let d = -1; d <= 1 && !hit; d++) { const set = ourByIdx.get(s.i + d); if (set && set.has(s.side)) hit = true } if (hit) matched++ }
	let hitArrows = 0
	for (const a of arrows) { let hit = false; for (let d = -1; d <= 1 && !hit; d++) { const set = shapeByIdx.get(a.i + d); if (set && set.has(a.side)) hit = true } if (hit) hitArrows++ }
	const recall = prep.shapeIdx.length ? matched / prep.shapeIdx.length : 0
	const precision = arrows.length ? hitArrows / arrows.length : 0
	return { shapeN: prep.shapeIdx.length, ourN: arrows.length, recall, precision, f1: (recall + precision) > 0 ? 2 * recall * precision / (recall + precision) : 0, density: prep.shapeIdx.length ? arrows.length / prep.shapeIdx.length : 0 }
}
function aggScore(preps: Prep[], cfg: Cfg): Score {
	let sN = 0, oN = 0, rw = 0, pw = 0
	for (const p of preps) { const sc = score(p, genArrows(p.rows, cfg)); sN += sc.shapeN; oN += sc.ourN; rw += sc.recall * sc.shapeN; pw += sc.precision * sc.ourN }
	const recall = sN ? rw / sN : 0, precision = oN ? pw / oN : 0
	return { shapeN: sN, ourN: oN, recall, precision, f1: (recall + precision) > 0 ? 2 * recall * precision / (recall + precision) : 0, density: sN ? oN / sN : 0 }
}

function main() {
	const pct = (x: number) => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a')
	const preps: Prep[] = []
	for (const { key, file } of FILES) {
		let rows: Row[]
		try { rows = loadCsv(file) } catch { continue }
		if (rows.length < 400) continue
		const shapeIdx: Array<{ i: number; side: 'buy' | 'sell' }> = []
		rows.forEach((r, i) => { if (r.buy) shapeIdx.push({ i, side: 'buy' }); else if (r.sell) shapeIdx.push({ i, side: 'sell' }) })
		preps.push({ key, rows, shapeIdx })
		console.log(`prep ${key}: rows=${rows.length} shapes=${shapeIdx.length}`)
	}
	if (!preps.length) throw new Error('Нет загруженных CSV из csv/.')
	const trainPreps = preps.filter((p) => TRAIN.has(p.key))
	const oosPreps = preps.filter((p) => !TRAIN.has(p.key))

	const MODES: TrigMode[] = ['extreme', 'revCandle', 'closeBackInner']
	const F_GRID = [0.40, 0.50, 0.55, 0.60, 0.65]
	const REL_GRID = [0, 1.4]
	const SPACING_GRID = [1, 5]
	interface Rowr { cfg: Cfg; train: Score }
	const rows: Rowr[] = []
	for (const mode of MODES) for (const fMin of F_GRID) for (const relVolMin of REL_GRID) for (const spacing of SPACING_GRID) {
		const cfg: Cfg = { mode, fMin, relVolMin, spacing }
		rows.push({ cfg, train: aggScore(trainPreps, cfg) })
	}
	const inBudget = (r: Rowr) => r.train.density >= 0.6 && r.train.density <= 1.6
	// лучший causal (revCandle/closeBackInner) в бюджете по F1
	const causal = rows.filter((r) => r.cfg.mode !== 'extreme' && inBudget(r)).sort((a, b) => b.train.f1 - a.train.f1 || b.train.recall - a.train.recall)
	const bestCausal = causal[0] ?? null
	// лучший extreme (референс-потолок) в бюджете по recall
	const extreme = rows.filter((r) => r.cfg.mode === 'extreme' && inBudget(r)).sort((a, b) => b.train.recall - a.train.recall || b.train.f1 - a.train.f1)
	const bestExtreme = extreme[0] ?? null

	const oosOf = (r: Rowr | null) => r ? aggScore(oosPreps, r.cfg) : null
	const perFileOf = (r: Rowr | null) => r ? preps.map((p) => ({ key: p.key, sc: score(p, genArrows(p.rows, r.cfg)) })) : []
	const bestCausalOos = oosOf(bestCausal), bestExtremeOos = oosOf(bestExtreme)
	const bestCausalPer = perFileOf(bestCausal), bestExtremePer = perFileOf(bestExtreme)

	const md: string[] = []
	md.push('# RE5 — триггер «экстремум волны + подтверждение разворота» vs shapes (зона из CSV вендора)')
	md.push('')
	md.push('Волна = период по одну сторону от mean; трекаем макс. глубину (доля пути mean→внешний край) и её бар; волна должна достичь fMin. Режимы: **extreme** (бар макс. глубины — РЕТРОспективно, look-ahead внутри волны, только как ПОТОЛОК/референс), **revCandle** (первая разворотная свеча после fMin, causal), **closeBackInner** (первый возврат close внутрь полосы, causal). Матч ±1 бар с shapes. TRAIN=BTC.P 5m/15m+BNB.P 5m; OOS=BTC.P 1h+VIRTUAL.P 5m. Движок не тронут.')
	md.push('')
	md.push('## ТОП конфигов на TRAIN (в бюджете плотности density∈[0.6,1.6])')
	md.push('')
	md.push('| mode | fMin | relVol | spacing | density | recall | precision | F1 |')
	md.push('|---|---|---|---|---|---|---|---|')
	for (const r of [...rows].filter(inBudget).sort((a, b) => b.train.f1 - a.train.f1).slice(0, 18))
		md.push(`| ${r.cfg.mode} | ${r.cfg.fMin} | ${r.cfg.relVolMin} | ${r.cfg.spacing} | ×${r.train.density.toFixed(2)} | ${pct(r.train.recall)} | ${pct(r.train.precision)} | ${pct(r.train.f1)} |`)
	md.push('')
	const block = (title: string, best: Rowr | null, oos: Score | null, per: Array<{ key: string; sc: Score }>, note: string) => {
		md.push(`## ${title}`)
		md.push('')
		if (!best || !oos) { md.push('_нет конфигов в бюджете плотности._'); md.push(''); return }
		md.push(note)
		md.push('')
		md.push(`Конфиг: **mode=${best.cfg.mode}, fMin=${best.cfg.fMin}, relVol=${best.cfg.relVolMin}, spacing=${best.cfg.spacing}**.`)
		md.push('')
		md.push('| выборка | shapeN | ourN | density | recall | precision | F1 |')
		md.push('|---|---|---|---|---|---|---|')
		md.push(`| TRAIN | ${best.train.shapeN} | ${best.train.ourN} | ×${best.train.density.toFixed(2)} | ${pct(best.train.recall)} | ${pct(best.train.precision)} | ${pct(best.train.f1)} |`)
		md.push(`| **OOS** | ${oos.shapeN} | ${oos.ourN} | ×${oos.density.toFixed(2)} | **${pct(oos.recall)}** | **${pct(oos.precision)}** | **${pct(oos.f1)}** |`)
		md.push('')
		md.push('| файл | train/oos | shapeN | ourN | density | recall | precision |')
		md.push('|---|---|---|---|---|---|---|')
		for (const pf of per) md.push(`| ${pf.key} | ${TRAIN.has(pf.key) ? 'train' : 'OOS'} | ${pf.sc.shapeN} | ${pf.sc.ourN} | ×${pf.sc.density.toFixed(2)} | ${pct(pf.sc.recall)} | ${pct(pf.sc.precision)} |`)
		md.push('')
	}
	block('ЛУЧШИЙ CAUSAL режим (revCandle/closeBackInner)', bestCausal, bestCausalOos, bestCausalPer, 'Реально реализуемый триггер (без look-ahead). Сравнивать с OWN2 recall ~26–31% (BTC).')
	block('РЕФЕРЕНС: extreme (потолок, НЕ causal)', bestExtreme, bestExtremeOos, bestExtremePer, '⚠ look-ahead внутри волны (бар экстремума известен только постфактум). Показывает ПОТОЛОК: плотит ли вендор ровно на экстремуме волны.')
	md.push('## ВЫВОД (черновой)')
	md.push('')
	const ownRef = 0.28
	if (bestCausal && bestCausalOos) md.push(`1. **Causal-триггер «экстремум+разворот».** Лучший OOS recall = **${pct(bestCausalOos.recall)}** (prec ${pct(bestCausalOos.precision)}, ×${bestCausalOos.density.toFixed(2)}). ${bestCausalOos.recall > ownRef ? 'ОБГОНЯЕТ' : 'НЕ обгоняет'} OWN2 (~28%).`)
	if (bestExtreme && bestExtremeOos) md.push(`2. **Потолок (extreme, look-ahead).** OOS recall = **${pct(bestExtremeOos.recall)}** — насколько вообще стрелки лежат на экстремуме волны. Разрыв между extreme и causal = цена подтверждения/тайминга.`)
	md.push('3. Если даже extreme-потолок невысок — стрелка НЕ на экстремуме волны, и триггер использует иную логику/данные (⚠ решает автор, возможно нужна доп. инфа вне OHLCV: OI/funding/intrabar).')
	md.push('')

	writeFileSync(resolve('ci-results/re5-extreme-reversal-fit.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/re5-extreme-reversal-fit.json'), JSON.stringify({
		generatedAt: new Date().toISOString(),
		train: [...TRAIN], oos: oosPreps.map((p) => p.key),
		grid: { modes: MODES, fMin: F_GRID, relVol: REL_GRID, spacing: SPACING_GRID, warmup: WARMUP, relVolPeriod: REL_VOL_PERIOD },
		densityWindow: [0.6, 1.6],
		bestCausal: bestCausal ? { cfg: bestCausal.cfg, train: bestCausal.train, oos: bestCausalOos, perFile: bestCausalPer.map((p) => ({ key: p.key, ...p.sc })) } : null,
		bestExtremeRef: bestExtreme ? { cfg: bestExtreme.cfg, train: bestExtreme.train, oos: bestExtremeOos, perFile: bestExtremePer.map((p) => ({ key: p.key, ...p.sc })), note: 'look-ahead reference ceiling' } : null,
		allTrain: rows.map((r) => ({ ...r.cfg, ...r.train })),
	}, null, 2))

	console.log('\n=== RE5 ===')
	if (bestCausal && bestCausalOos) console.log(`CAUSAL best: mode=${bestCausal.cfg.mode} fMin=${bestCausal.cfg.fMin} rel=${bestCausal.cfg.relVolMin} sp=${bestCausal.cfg.spacing} | TRAIN recall=${pct(bestCausal.train.recall)} prec=${pct(bestCausal.train.precision)} → OOS recall=${pct(bestCausalOos.recall)} prec=${pct(bestCausalOos.precision)} dens=×${bestCausalOos.density.toFixed(2)}`)
	if (bestExtreme && bestExtremeOos) console.log(`EXTREME ref (look-ahead): mode=extreme fMin=${bestExtreme.cfg.fMin} rel=${bestExtreme.cfg.relVolMin} sp=${bestExtreme.cfg.spacing} | TRAIN recall=${pct(bestExtreme.train.recall)} → OOS recall=${pct(bestExtremeOos.recall)} dens=×${bestExtremeOos.density.toFixed(2)}`)
	console.log('Записано: ci-results/re5-extreme-reversal-fit.{md,json}')
}

main()
