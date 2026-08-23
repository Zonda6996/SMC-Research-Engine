/**
 * RE4 — фит триггера стрелки GGI как ПОРОГА ГЛУБИНЫ проникновения в зону вендора (не «касания» линии).
 *
 * Мотив (RE3, `re3-vendor-zone-fit`): геометрия зоны = наш Apex точь-в-точь; стрелки вендора стоят
 * не у внешнего края, а на медианной глубине ~0.54 пути mean→внешний край (внутр. полоса = 0.583).
 * Замечание автора: сигнал приходит НЕ всегда на касании линии — иногда без касания → это ПОРОГ по
 * глубине, а не «дотронулся до полосы». Поэтому здесь триггер = «фитиль достиг доли f пути к внешнему
 * краю» (f — порог), с взводом/перевзводом (fire once, rearm при возврате close к mean) + опциональные
 * подтверждения (relVol, направление свечи) + min-spacing.
 *
 * Зона берётся ПРЯМО из CSV-линий вендора (mean/inner/outer) — самый чистый референс (наш Apex ≡ им).
 * Свипаем порог f × relVol × candleDir × spacing, матч ±1 бар с реальными shapes. Метрики recall/
 * precision/F1/density. Отбор в бюджете вендорской плотности density∈[0.6,1.6]. TRAIN/OOS по ФАЙЛАМ
 * (train = BTC.P 5m/15m + BNB.P 5m; OOS = BTC.P 1h + VIRTUAL.P 5m) — лучший по F1 на train, замер на OOS.
 *
 * Движок src/core НЕ трогается — это ИЗМЕРИТЕЛЬНЫЙ харнесс (§2.2: показать до правки движка).
 * Причинность: relVol по предыдущим барам; триггер трейлинговый (i от WARMUP).
 *
 * Запуск: npx tsx ci/research/runRE4InnerBandTriggerFit.ts
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

// глубина проникновения фитиля в долю пути mean→ВНЕШНИЙ край (buy: low вниз, sell: high вверх)
function depthAt(r: Row, side: 'buy' | 'sell'): number {
	if (![r.mean, r.lowerOuter, r.upperOuter].every(Number.isFinite)) return NaN
	if (side === 'buy') { const path = r.mean - r.lowerOuter; return path > 0 ? (r.mean - r.low) / path : NaN }
	const path = r.upperOuter - r.mean; return path > 0 ? (r.high - r.mean) / path : NaN
}

interface Cfg { f: number; relVolMin: number; candleDir: boolean; spacing: number }

/** Генерация стрелок по порогу глубины f с взводом/перевзводом. */
function genArrows(rows: Row[], cfg: Cfg): Array<{ i: number; side: 'buy' | 'sell' }> {
	const raw: Array<{ i: number; side: 'buy' | 'sell' }> = []
	let armedLong = true, armedShort = true
	for (let i = WARMUP; i < rows.length; i++) {
		const r = rows[i]!
		if (![r.mean, r.lowerOuter, r.upperOuter].every(Number.isFinite)) continue
		// перевзвод возвратом close к средней
		if (!armedLong && r.close >= r.mean) armedLong = true
		if (!armedShort && r.close <= r.mean) armedShort = true
		const rv = cfg.relVolMin > 0 ? relVolAt(rows, i) : Infinity
		const relOk = cfg.relVolMin <= 0 || rv >= cfg.relVolMin
		const dBuy = depthAt(r, 'buy'), dSell = depthAt(r, 'sell')
		const buyDirOk = !cfg.candleDir || r.close > r.open
		const sellDirOk = !cfg.candleDir || r.close < r.open
		// buy — цена ушла ВНИЗ от средней (r.close<r.mean), достигла глубины f
		if (armedLong && r.close < r.mean && Number.isFinite(dBuy) && dBuy >= cfg.f && relOk && buyDirOk) {
			raw.push({ i, side: 'buy' }); armedLong = false
		} else if (armedShort && r.close > r.mean && Number.isFinite(dSell) && dSell >= cfg.f && relOk && sellDirOk) {
			raw.push({ i, side: 'sell' }); armedShort = false
		}
	}
	// min-spacing per side
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
	for (const s of prep.shapeIdx) {
		let hit = false
		for (let d = -1; d <= 1 && !hit; d++) { const set = ourByIdx.get(s.i + d); if (set && set.has(s.side)) hit = true }
		if (hit) matched++
	}
	let hitArrows = 0
	for (const a of arrows) {
		let hit = false
		for (let d = -1; d <= 1 && !hit; d++) { const set = shapeByIdx.get(a.i + d); if (set && set.has(a.side)) hit = true }
		if (hit) hitArrows++
	}
	const recall = prep.shapeIdx.length ? matched / prep.shapeIdx.length : 0
	const precision = arrows.length ? hitArrows / arrows.length : 0
	return {
		shapeN: prep.shapeIdx.length, ourN: arrows.length, recall, precision,
		f1: (recall + precision) > 0 ? 2 * recall * precision / (recall + precision) : 0,
		density: prep.shapeIdx.length ? arrows.length / prep.shapeIdx.length : 0,
	}
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
		try { rows = loadCsv(file) } catch (e) { console.error(`skip ${key}: ${(e as Error).message}`); continue }
		if (rows.length < 400) continue
		const shapeIdx: Array<{ i: number; side: 'buy' | 'sell' }> = []
		rows.forEach((r, i) => { if (r.buy) shapeIdx.push({ i, side: 'buy' }); else if (r.sell) shapeIdx.push({ i, side: 'sell' }) })
		preps.push({ key, rows, shapeIdx })
		console.log(`prep ${key}: rows=${rows.length} shapes=${shapeIdx.length}`)
	}
	if (!preps.length) throw new Error('Нет загруженных CSV из csv/.')
	const trainPreps = preps.filter((p) => TRAIN.has(p.key))
	const oosPreps = preps.filter((p) => !TRAIN.has(p.key))

	// свип
	const F_GRID = [0.35, 0.40, 0.45, 0.50, 0.55, 0.583, 0.60, 0.65, 0.70]
	const REL_GRID = [0, 1.0, 1.4]
	const DIR_GRID = [false, true]
	const SPACING_GRID = [1, 5, 10]
	interface Rowr { cfg: Cfg; train: Score }
	const rows: Rowr[] = []
	for (const f of F_GRID) for (const relVolMin of REL_GRID) for (const candleDir of DIR_GRID) for (const spacing of SPACING_GRID) {
		const cfg: Cfg = { f, relVolMin, candleDir, spacing }
		rows.push({ cfg, train: aggScore(trainPreps, cfg) })
	}
	// отбор по вендорской плотности на TRAIN, ранг по F1
	const inBudget = rows.filter((r) => r.train.density >= 0.6 && r.train.density <= 1.6)
	const eligible = inBudget.length ? inBudget : [...rows].sort((a, b) => Math.abs(a.train.density - 1) - Math.abs(b.train.density - 1)).slice(0, 20)
	const ranked = [...eligible].sort((a, b) => b.train.f1 - a.train.f1 || b.train.recall - a.train.recall)
	const top = ranked.slice(0, 15)
	const best = ranked[0] ?? null

	// OOS замер лучшего train-конфига
	const bestOos = best ? aggScore(oosPreps, best.cfg) : null
	const bestPerFile = best ? preps.map((p) => ({ key: p.key, sc: score(p, genArrows(p.rows, best.cfg)) })) : []

	const md: string[] = []
	md.push('# RE4 — фит триггера стрелки как порога глубины проникновения (зона = линии вендора из CSV)')
	md.push('')
	md.push('Триггер: фитиль достиг доли **f** пути mean→ВНЕШНИЙ край зоны вендора (порог, НЕ «касание линии» — учитывает замечание автора, что сигнал бывает и без касания), со взводом/перевзводом (fire once, rearm при возврате close к mean) + опц. relVol / направление свечи + min-spacing. Матч ±1 бар с реальными shapes. Движок не тронут (измерение).')
	md.push('')
	md.push(`TRAIN: ${[...TRAIN].join(', ')}. OOS: ${oosPreps.map((p) => p.key).join(', ')}.`)
	md.push('')
	md.push('## ТОП-15 по F1 на TRAIN (в бюджете плотности density∈[0.6,1.6])')
	md.push('')
	md.push('| f | relVol | candleDir | spacing | density | recall | precision | F1 |')
	md.push('|---|---|---|---|---|---|---|---|')
	for (const r of top) md.push(`| ${r.cfg.f} | ${r.cfg.relVolMin} | ${r.cfg.candleDir ? 'on' : 'off'} | ${r.cfg.spacing} | ×${r.train.density.toFixed(2)} | ${pct(r.train.recall)} | ${pct(r.train.precision)} | ${pct(r.train.f1)} |`)
	md.push('')
	if (best && bestOos) {
		md.push('## ЛУЧШИЙ конфиг (по TRAIN F1) — проверка на OOS')
		md.push('')
		md.push(`Конфиг: **f=${best.cfg.f}, relVol=${best.cfg.relVolMin}, candleDir=${best.cfg.candleDir ? 'on' : 'off'}, spacing=${best.cfg.spacing}**.`)
		md.push('')
		md.push('| выборка | shapeN | ourN | density | recall | precision | F1 |')
		md.push('|---|---|---|---|---|---|---|')
		md.push(`| TRAIN | ${best.train.shapeN} | ${best.train.ourN} | ×${best.train.density.toFixed(2)} | ${pct(best.train.recall)} | ${pct(best.train.precision)} | ${pct(best.train.f1)} |`)
		md.push(`| **OOS** | ${bestOos.shapeN} | ${bestOos.ourN} | ×${bestOos.density.toFixed(2)} | **${pct(bestOos.recall)}** | **${pct(bestOos.precision)}** | **${pct(bestOos.f1)}** |`)
		md.push('')
		md.push('### По файлам')
		md.push('')
		md.push('| файл | train/oos | shapeN | ourN | density | recall | precision |')
		md.push('|---|---|---|---|---|---|---|')
		for (const pf of bestPerFile) md.push(`| ${pf.key} | ${TRAIN.has(pf.key) ? 'train' : 'OOS'} | ${pf.sc.shapeN} | ${pf.sc.ourN} | ×${pf.sc.density.toFixed(2)} | ${pct(pf.sc.recall)} | ${pct(pf.sc.precision)} |`)
		md.push('')
	}
	md.push('## Сравнение с прежним baseline')
	md.push('')
	md.push('OWN2 (внешний край + relVol1.4) на этих же CSV давал recall ~26–31% (BTC). Если depth-триггер у внутренней полосы поднимает recall при сравнимой плотности — гипотеза RE3 (стрелка привязана к внутренней полосе) подтверждается практически.')
	md.push('')

	writeFileSync(resolve('ci-results/re4-inner-band-trigger-fit.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/re4-inner-band-trigger-fit.json'), JSON.stringify({
		generatedAt: new Date().toISOString(),
		train: [...TRAIN], oos: oosPreps.map((p) => p.key),
		grid: { f: F_GRID, relVol: REL_GRID, candleDir: DIR_GRID, spacing: SPACING_GRID, warmup: WARMUP, relVolPeriod: REL_VOL_PERIOD },
		densityWindow: [0.6, 1.6], eligibleCount: inBudget.length,
		top15: top.map((r) => ({ ...r.cfg, ...r.train })),
		best: best ? { cfg: best.cfg, train: best.train, oos: bestOos, perFile: bestPerFile.map((p) => ({ key: p.key, ...p.sc })) } : null,
		allTrain: rows.map((r) => ({ ...r.cfg, ...r.train })),
	}, null, 2))

	console.log('\n=== RE4 ===')
	for (const r of top.slice(0, 6)) console.log(`f=${r.cfg.f} rel=${r.cfg.relVolMin} dir=${r.cfg.candleDir ? 'on' : 'off'} sp=${r.cfg.spacing} → dens=×${r.train.density.toFixed(2)} recall=${pct(r.train.recall)} prec=${pct(r.train.precision)} F1=${pct(r.train.f1)}`)
	if (best && bestOos) console.log(`\nBEST train F1: f=${best.cfg.f} rel=${best.cfg.relVolMin} dir=${best.cfg.candleDir ? 'on' : 'off'} sp=${best.cfg.spacing} | TRAIN recall=${pct(best.train.recall)} prec=${pct(best.train.precision)} → OOS recall=${pct(bestOos.recall)} prec=${pct(bestOos.precision)} dens=×${bestOos.density.toFixed(2)}`)
	console.log('Записано: ci-results/re4-inner-band-trigger-fit.{md,json}')
}

main()
