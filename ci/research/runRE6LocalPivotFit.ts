/**
 * RE6 — фит триггера как «ЛОКАЛЬНЫЙ свинг-пивот внутри зоны» vs реальные shapes (зона = линии вендора из CSV).
 *
 * Мотив (RE5): «экстремум большой волны mean→mean» воспроизводит shapes плохо, и даже look-ahead-потолок = 5%.
 * Значит стрелка НЕ на экстремуме крупной волны. За один заход цены под/над среднюю вендор ставит НЕСКОЛЬКО
 * стрелок → триггер ЛОКАЛЬНЫЙ. Гипотеза RE6: стрелка стоит на локальном свинг-лоу (buy) / свинг-хай (sell),
 * подтверждённом окном W баров, при условии что бар находится ВНУТРИ зоны (глубина фитиля ≥ f от пути mean→внешний край).
 *
 * Пивот (окно W): buy — low[i] ≤ low[j] для всех j∈[i−W, i+W]; sell — high[i] ≥ high[j]. Сторона зоны: buy при close<mean, sell при close>mean.
 * Два режима постановки стрелки:
 *   • 'pivotBack'   — стрелка НА баре пивота i (нужны W правых баров для подтверждения → look-ahead; ПОТОЛОК/референс,
 *                     как в RE5 'extreme': показывает, лежат ли shapes на локальных свингах вообще).
 *   • 'pivotCausal' — стрелка на баре ПОДТВЕРЖДЕНИЯ i+W (реально реализуемо, без look-ahead).
 * Опц. relVol на баре постановки + min-spacing по стороне. Матч ±1 бар с shapes. TRAIN (BTC.P 5m/15m + BNB.P 5m) / OOS (BTC.P 1h + VIRTUAL.P 5m).
 * Движок src/core НЕ трогается — измерительный харнесс (§2.2). Зона — из CSV-линий вендора.
 *
 * Запуск: npx tsx ci/research/runRE6LocalPivotFit.ts
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

function isSwingLow(rows: Row[], i: number, W: number): boolean {
	if (i - W < 0 || i + W >= rows.length) return false
	const x = rows[i]!.low
	for (let j = i - W; j <= i + W; j++) if (j !== i && rows[j]!.low < x) return false
	return true
}
function isSwingHigh(rows: Row[], i: number, W: number): boolean {
	if (i - W < 0 || i + W >= rows.length) return false
	const x = rows[i]!.high
	for (let j = i - W; j <= i + W; j++) if (j !== i && rows[j]!.high > x) return false
	return true
}

type TrigMode = 'pivotBack' | 'pivotCausal'
interface Cfg { mode: TrigMode; W: number; fMin: number; relVolMin: number; spacing: number }

function genArrows(rows: Row[], cfg: Cfg): Array<{ i: number; side: 'buy' | 'sell' }> {
	const raw: Array<{ i: number; side: 'buy' | 'sell' }> = []
	const relOk = (i: number) => cfg.relVolMin <= 0 || relVolAt(rows, i) >= cfg.relVolMin
	for (let i = WARMUP; i < rows.length - cfg.W; i++) {
		const r = rows[i]!
		if (![r.mean, r.lowerOuter, r.upperOuter, r.lowerInner, r.upperInner].every(Number.isFinite)) continue
		// buy: свинг-лоу ниже средней, глубина ≥ f
		if (r.close < r.mean && isSwingLow(rows, i, cfg.W)) {
			const d = depthBuy(r)
			if (Number.isFinite(d) && d >= cfg.fMin) {
				const at = cfg.mode === 'pivotBack' ? i : i + cfg.W
				if (at < rows.length && relOk(at)) raw.push({ i: at, side: 'buy' })
			}
		}
		// sell: свинг-хай выше средней, глубина ≥ f
		if (r.close > r.mean && isSwingHigh(rows, i, cfg.W)) {
			const d = depthSell(r)
			if (Number.isFinite(d) && d >= cfg.fMin) {
				const at = cfg.mode === 'pivotBack' ? i : i + cfg.W
				if (at < rows.length && relOk(at)) raw.push({ i: at, side: 'sell' })
			}
		}
	}
	// min-spacing по стороне
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

	const MODES: TrigMode[] = ['pivotBack', 'pivotCausal']
	const W_GRID = [2, 3, 5, 8]
	const F_GRID = [0.30, 0.40, 0.50, 0.60]
	const REL_GRID = [0, 1.4]
	const SPACING_GRID = [1, 5]
	interface Rowr { cfg: Cfg; train: Score }
	const rows: Rowr[] = []
	for (const mode of MODES) for (const W of W_GRID) for (const fMin of F_GRID) for (const relVolMin of REL_GRID) for (const spacing of SPACING_GRID) {
		const cfg: Cfg = { mode, W, fMin, relVolMin, spacing }
		rows.push({ cfg, train: aggScore(trainPreps, cfg) })
	}
	const inBudget = (r: Rowr) => r.train.density >= 0.6 && r.train.density <= 1.6
	const causal = rows.filter((r) => r.cfg.mode === 'pivotCausal' && inBudget(r)).sort((a, b) => b.train.f1 - a.train.f1 || b.train.recall - a.train.recall)
	const bestCausal = causal[0] ?? null
	// потолок: pivotBack часто плотнее вендора (объёмные экстремумы) → допускаем плотность до ×3.0, берём макс recall
	const backOk = (r: Rowr) => r.train.density >= 0.6 && r.train.density <= 3.0
	const back = rows.filter((r) => r.cfg.mode === 'pivotBack' && backOk(r)).sort((a, b) => b.train.recall - a.train.recall || b.train.f1 - a.train.f1)
	const bestBack = back[0] ?? null

	const oosOf = (r: Rowr | null) => r ? aggScore(oosPreps, r.cfg) : null
	const perFileOf = (r: Rowr | null) => r ? preps.map((p) => ({ key: p.key, sc: score(p, genArrows(p.rows, r.cfg)) })) : []
	const bestCausalOos = oosOf(bestCausal), bestBackOos = oosOf(bestBack)
	const bestCausalPer = perFileOf(bestCausal), bestBackPer = perFileOf(bestBack)

	const md: string[] = []
	md.push('# RE6 — триггер «локальный свинг-пивот внутри зоны» vs shapes (зона из CSV вендора)')
	md.push('')
	md.push('Пивот окна W (buy=swing low ниже mean / sell=swing high выше mean), бар внутри зоны (глубина фитиля ≥ f от пути mean→внешний край). Режимы: **pivotBack** (стрелка на баре пивота — look-ahead W правых баров, ПОТОЛОК) и **pivotCausal** (стрелка на баре подтверждения i+W, реализуемо). Матч ±1 с shapes. TRAIN=BTC.P 5m/15m+BNB.P 5m; OOS=BTC.P 1h+VIRTUAL.P 5m. Движок не тронут.')
	md.push('')
	md.push('## ТОП конфигов на TRAIN (density∈[0.6,1.6])')
	md.push('')
	md.push('| mode | W | fMin | relVol | spacing | density | recall | precision | F1 |')
	md.push('|---|---|---|---|---|---|---|---|---|')
	for (const r of [...rows].filter(inBudget).sort((a, b) => b.train.f1 - a.train.f1).slice(0, 18))
		md.push(`| ${r.cfg.mode} | ${r.cfg.W} | ${r.cfg.fMin} | ${r.cfg.relVolMin} | ${r.cfg.spacing} | ×${r.train.density.toFixed(2)} | ${pct(r.train.recall)} | ${pct(r.train.precision)} | ${pct(r.train.f1)} |`)
	md.push('')
	const block = (title: string, best: Rowr | null, oos: Score | null, per: Array<{ key: string; sc: Score }>, note: string) => {
		md.push(`## ${title}`)
		md.push('')
		if (!best || !oos) { md.push('_нет конфигов в бюджете плотности._'); md.push(''); return }
		md.push(note)
		md.push('')
		md.push(`Конфиг: **mode=${best.cfg.mode}, W=${best.cfg.W}, fMin=${best.cfg.fMin}, relVol=${best.cfg.relVolMin}, spacing=${best.cfg.spacing}**.`)
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
	block('ЛУЧШИЙ CAUSAL (pivotCausal)', bestCausal, bestCausalOos, bestCausalPer, 'Реализуемый триггер (без look-ahead). Сравнивать с OWN2 recall ~26–31% (BTC).')
	block('РЕФЕРЕНС: pivotBack (потолок, look-ahead W баров)', bestBack, bestBackOos, bestBackPer, '⚠ look-ahead: бар пивота известен только через W правых баров. ПОТОЛОК: лежат ли shapes на локальных свингах вообще.')
	md.push('## ВЫВОД (черновой)')
	md.push('')
	const ownRef = 0.28
	if (bestCausal && bestCausalOos) md.push(`1. **Causal-пивот.** Лучший OOS recall = **${pct(bestCausalOos.recall)}** (prec ${pct(bestCausalOos.precision)}, ×${bestCausalOos.density.toFixed(2)}). ${bestCausalOos.recall > ownRef ? 'ОБГОНЯЕТ' : 'НЕ обгоняет'} OWN2 (~28%).`)
	if (bestBack && bestBackOos) md.push(`2. **Потолок (pivotBack, look-ahead).** OOS recall = **${pct(bestBackOos.recall)}** — насколько shapes вообще лежат на локальных свингах в зоне.`)
	md.push('3. Если даже pivotBack-потолок невысок (≲ OWN2) — стрелка НЕ определяется локальным ценовым свингом; сильный довод, что триггер требует не-OHLCV инфы (intrabar/OI/funding) или иной внутренней серии (см. `NEGATIVE-KNOWLEDGE §3`, D6).')
	md.push('')

	writeFileSync(resolve('ci-results/re6-local-pivot-fit.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/re6-local-pivot-fit.json'), JSON.stringify({
		generatedAt: new Date().toISOString(),
		train: [...TRAIN], oos: oosPreps.map((p) => p.key),
		grid: { modes: MODES, W: W_GRID, fMin: F_GRID, relVol: REL_GRID, spacing: SPACING_GRID, warmup: WARMUP, relVolPeriod: REL_VOL_PERIOD },
		densityWindow: [0.6, 1.6],
		bestCausal: bestCausal ? { cfg: bestCausal.cfg, train: bestCausal.train, oos: bestCausalOos, perFile: bestCausalPer.map((p) => ({ key: p.key, ...p.sc })) } : null,
		bestBackRef: bestBack ? { cfg: bestBack.cfg, train: bestBack.train, oos: bestBackOos, perFile: bestBackPer.map((p) => ({ key: p.key, ...p.sc })), note: 'look-ahead reference ceiling' } : null,
		allTrain: rows.map((r) => ({ ...r.cfg, ...r.train })),
	}, null, 2))

	console.log('\n=== RE6 ===')
	if (bestCausal && bestCausalOos) console.log(`CAUSAL best: W=${bestCausal.cfg.W} fMin=${bestCausal.cfg.fMin} rel=${bestCausal.cfg.relVolMin} sp=${bestCausal.cfg.spacing} | TRAIN recall=${pct(bestCausal.train.recall)} prec=${pct(bestCausal.train.precision)} → OOS recall=${pct(bestCausalOos.recall)} prec=${pct(bestCausalOos.precision)} dens=×${bestCausalOos.density.toFixed(2)}`)
	if (bestBack && bestBackOos) console.log(`BACK ref (look-ahead): W=${bestBack.cfg.W} fMin=${bestBack.cfg.fMin} rel=${bestBack.cfg.relVolMin} sp=${bestBack.cfg.spacing} | TRAIN recall=${pct(bestBack.train.recall)} → OOS recall=${pct(bestBackOos.recall)} dens=×${bestBackOos.density.toFixed(2)}`)
	console.log('Записано: ci-results/re6-local-pivot-fit.{md,json}')
}

main()
