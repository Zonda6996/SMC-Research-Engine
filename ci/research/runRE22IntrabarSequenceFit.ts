/**
 * RE22 — интрабарная ПОСЛЕДОВАТЕЛЬНОСТЬ как селектор стрелки: recall/precision против shapes.
 *
 * RE20 смотрел только фитиль самого coarse-бара (один агрегат: low≤LoInner / high≥UpInner + объём + rearm)
 * и показал, что касание внутренней полосы — необходимое, но НЕ достаточное условие (precision ~1–18%,
 * density до 47× на fine ТФ). RE21 добавил F&G-экстремум среди касаний и тоже не разделил (F1 ~0.12–0.16).
 *
 * Гипотеза RE22: бар со стрелкой отличается от прочих касаний ИНТРАБАРНОЙ последовательностью — тем, КАК
 * цена ходила ВНУТРИ coarse-бара. Реконструируем путь внутри каждого coarse-бара по РЕАЛЬНЫМ младшим (fine)
 * барам того же временного окна (near-tick файлы вложены в правый конец длинных coarse-файлов) и проверяем
 * селектор:
 *   «касание внутренней полосы COARSE-бара (это ТФ стрелки) + объёмный всплеск на ТОМ ЖЕ (или соседнем)
 *    младшем суб-баре (coincide: |touchSubIdx − volSpikeSubIdx| ≤ 1) + учёт числа касаний внутри бара
 *    (nTouches; гипотезы «первое/редкое касание» maxTouches и «повторность» minTouches)».
 *
 * Популяция касаний (знаменатель precision) — как в RE20: coarse-бары в перекрытии, чей фитиль касается
 * внутренней полосы, со взводом стороны (rearm) по возврату close к mean. Матчинг против vendor shapes
 * (coarse buy=col10 / sell=col11) — greedy как в RE20 (та же сторона, |Δ|≤tol, один fire↔один shape,
 * ближайший). Свип: requireCoincide×maxTouches×minTouches×tol. Плюс baseline-гейт «просто интрабар-касание»
 * (аналог RE20-гейта). Ранг best по F1 при density≤8. train/OOS 65/35 хронологически (если shapes-в-перекрытии
 * < 12 — не делим, помечаем underpowered — это допустимый результат: лимит данных).
 *
 * Линии зоны — вендорские (§2.1), не выдуманы; пороги свипаны. src/core НЕ тронут. Чистый исследовательский
 * раннер поверх CSV.
 *
 * Запуск: npx tsx "ci/research/runRE22IntrabarSequenceFit.ts"
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const num = (x: string | undefined): number => { const n = Number((x ?? '').trim()); return Number.isFinite(n) ? n : NaN }

interface Bar {
	t: number; o: number; h: number; l: number; c: number
	mean: number; upInner: number; loInner: number
	buy: boolean; sell: boolean; vol: number
}

function load(file: string): Bar[] {
	const lines = readFileSync(resolve(file), 'utf8').split(/\r?\n/).filter((l) => l.length > 0)
	const out: Bar[] = []
	for (let i = 1; i < lines.length; i++) {
		const p = lines[i]!.split(',')
		if (p.length < 13) continue
		const t = num(p[0]), o = num(p[1]), h = num(p[2]), l = num(p[3]), c = num(p[4])
		const mean = num(p[5]), upInner = num(p[7]), loInner = num(p[8])
		if (![t, o, h, l, c, mean, upInner, loInner].every(Number.isFinite)) continue
		out.push({ t, o, h, l, c, mean, upInner, loInner, buy: (p[10] ?? '0').trim() === '1', sell: (p[11] ?? '0').trim() === '1', vol: num(p[12]) || 0 })
	}
	// гарантируем хронологический порядок
	out.sort((a, b) => a.t - b.t)
	return out
}

// ТФ coarse-бара в секундах из имени файла: "5"→300, "1"→60, "15"→900, "5S"→5, "10S"→10, "1S"→1
function tfSecFromName(f: string): number {
	const m = /,\s*(\d+)(S)?\.csv/.exec(f)
	if (!m) return NaN
	const n = Number(m[1])
	return m[2] ? n : n * 60
}
function tfLabel(f: string): string {
	const m = /,\s*(\d+)(S)?\.csv/.exec(f)
	if (!m) return '?'
	const n = Number(m[1])
	return m[2] ? `${n}s` : (n >= 60 ? `${n / 60}h` : `${n}m`)
}

type Side = 'buy' | 'sell'
const median = (a: number[]): number => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2 }
const r2 = (x: number) => Number.isFinite(x) ? x.toFixed(2) : 'n/a'
const pct = (x: number) => Number.isFinite(x) ? (x * 100).toFixed(0) + '%' : 'n/a'

// --- Кандидат-касание (популяция), с интрабар-фичами ---
interface Cand {
	i: number            // индекс coarse-бара
	t: number            // время coarse-бара
	side: Side
	isShape: boolean     // vendor нарисовал стрелку на этом баре (той же стороны)
	hasFine: boolean     // ≥2 fine суб-баров в окне
	touchSubIdx: number  // индекс первого суб-бара, касающегося inner (по coarse-линиям)
	volSpikeSubIdx: number
	nTouches: number
	nSub: number
	coincide: boolean
}

/**
 * Строим популяцию касаний по coarse-барам в окне перекрытия (rearm как в RE20) и
 * для каждого собираем интрабар-фичи по fine суб-барам того же временного окна.
 * bar не является интрабар-касанием (исключаем), если fine есть, но ни один суб-бар не касается inner.
 */
function buildCandidates(coarse: Bar[], fine: Bar[], tfSec: number, ovStart: number, ovEnd: number): { cands: Cand[]; noFineShapes: number } {
	// индексы fine, отсортированы по времени → бинарный поиск окна
	const fineT = fine.map((b) => b.t)
	function fineRange(barT: number): [number, number] {
		const lo = barT, hi = barT + tfSec
		// первый fine с t ≥ lo
		let a = 0, b = fineT.length
		while (a < b) { const m = (a + b) >> 1; if (fineT[m]! < lo) a = m + 1; else b = m }
		const start = a
		// первый fine с t ≥ hi
		a = start; b = fineT.length
		while (a < b) { const m = (a + b) >> 1; if (fineT[m]! < hi) a = m + 1; else b = m }
		return [start, a]
	}

	const cands: Cand[] = []
	let noFineShapes = 0
	let armedBuy = true, armedSell = true
	for (let i = 0; i < coarse.length; i++) {
		const b = coarse[i]!
		// rearm по возврату coarse close к mean
		if (b.c >= b.mean) armedBuy = true
		if (b.c <= b.mean) armedSell = true
		// только бары внутри окна перекрытия
		if (b.t < ovStart || b.t >= ovEnd) continue

		// сторона касания фитилём внутренней полосы coarse-бара
		const touchBuy = b.l <= b.loInner
		const touchSell = b.h >= b.upInner
		if (!touchBuy && !touchSell) continue

		let side: Side
		if (touchBuy && touchSell) {
			// оба: берём сторону, где касание глубже относительно своей denom (mean→inner)
			const denomBuy = b.mean - b.loInner
			const denomSell = b.upInner - b.mean
			const depthBuy = denomBuy > 0 ? (b.mean - b.l) / denomBuy : -Infinity
			const depthSell = denomSell > 0 ? (b.h - b.mean) / denomSell : -Infinity
			side = depthBuy >= depthSell ? 'buy' : 'sell'
		} else side = touchBuy ? 'buy' : 'sell'

		// rearm-гейт (касание засчитывается только если сторона взведена) — как в RE20
		if (side === 'buy') { if (!armedBuy) continue } else { if (!armedSell) continue }

		const isShape = side === 'buy' ? b.buy : b.sell

		// fine суб-бары в окне [t, t+tfSec)
		const [fs, fe] = fineRange(b.t)
		const nSub = fe - fs
		if (nSub < 2) {
			// нет интрабар-данных: исключаем из интрабар-статистики, но фиксируем shape без fine
			if (isShape) noFineShapes++
			cands.push({ i, t: b.t, side, isShape, hasFine: false, touchSubIdx: -1, volSpikeSubIdx: -1, nTouches: 0, nSub, coincide: false })
			// сторону НЕ гасим (нет валидного интрабар-касания)
			continue
		}

		// touchSubIdx: первый суб-бар, касающийся inner (по ВНУТРЕННИМ линиям COARSE-бара — ТФ стрелки)
		let touchSubIdx = -1, nTouches = 0
		let volSpikeSubIdx = 0, volMax = -Infinity
		for (let k = fs; k < fe; k++) {
			const sub = fine[k]!
			const rel = k - fs
			const touched = side === 'buy' ? sub.l <= b.loInner : sub.h >= b.upInner
			if (touched) { nTouches++; if (touchSubIdx < 0) touchSubIdx = rel }
			if (sub.vol > volMax) { volMax = sub.vol; volSpikeSubIdx = rel }
		}
		if (touchSubIdx < 0) {
			// fine есть, но ни один суб-бар не касается inner → не интрабар-касание, исключаем
			continue
		}
		const coincide = Math.abs(touchSubIdx - volSpikeSubIdx) <= 1
		cands.push({ i, t: b.t, side, isShape, hasFine: true, touchSubIdx, volSpikeSubIdx, nTouches, nSub, coincide })

		// гасим сторону после валидного интрабар-касания (rearm-механика)
		if (side === 'buy') armedBuy = false; else armedSell = false
	}
	return { cands, noFineShapes }
}

interface Cfg { requireCoincide: boolean; maxTouches: number; minTouches: number; tol: number }
function fires(cands: Cand[], cfg: Cfg): Cand[] {
	return cands.filter((c) => {
		if (!c.hasFine) return false
		if (cfg.requireCoincide && !c.coincide) return false
		if (c.nTouches > cfg.maxTouches) return false
		if (c.nTouches < cfg.minTouches) return false
		return true
	})
}

interface Score { recall: number; precision: number; f1: number; shapes: number; nFires: number; matched: number; density: number }
// shapesList — список shape-баров (i, side) в перекрытии; fireList — кандидаты, прошедшие селектор
function score(shapesList: Array<{ i: number; side: Side }>, fireList: Cand[], tol: number): Score {
	const used = new Array(fireList.length).fill(false)
	let matched = 0
	for (const sh of shapesList) {
		let best = -1, bestD = Infinity
		for (let k = 0; k < fireList.length; k++) {
			if (used[k]) continue
			const f = fireList[k]!
			if (f.side !== sh.side) continue
			const d = Math.abs(f.i - sh.i)
			if (d <= tol && d < bestD) { bestD = d; best = k }
		}
		if (best >= 0) { used[best] = true; matched++ }
	}
	const recall = shapesList.length ? matched / shapesList.length : NaN
	const precision = fireList.length ? matched / fireList.length : NaN
	const f1 = (recall > 0 && precision > 0) ? 2 * recall * precision / (recall + precision) : 0
	return { recall, precision, f1, shapes: shapesList.length, nFires: fireList.length, matched, density: shapesList.length ? fireList.length / shapesList.length : NaN }
}

// свип
const REQ = [false, true]
const MAXT = [Infinity, 1, 2, 3]
const MINT = [1, 2]
const TOLS = [0, 1, 2]
const GATE: Cfg = { requireCoincide: false, maxTouches: Infinity, minTouches: 1, tol: 1 }

function allCfgs(): Cfg[] {
	const out: Cfg[] = []
	for (const requireCoincide of REQ) for (const maxTouches of MAXT) for (const minTouches of MINT) for (const tol of TOLS) {
		out.push({ requireCoincide, maxTouches, minTouches, tol })
	}
	return out
}
function cfgLabel(c: Cfg): string {
	return `coinc=${c.requireCoincide ? 'Y' : 'N'},maxT=${c.maxTouches === Infinity ? '∞' : c.maxTouches},minT=${c.minTouches},±${c.tol}`
}

interface PairRes {
	coarseFile: string; fineFile: string; coarseTf: string; fineTf: string
	tfSec: number
	ovStartT: number; ovEndT: number; nFineOverlap: number
	shapesOverlap: number
	nCandTouches: number
	nCandWithFine: number
	noFineShapes: number
	gate: Score
	best: Score; bestCfg: Cfg
	oos: { mode: 'split'; train: Score; oos: Score; oosCfg: Cfg } | { mode: 'underpowered'; nOverlapShapes: number; full: Score; fullCfg: Cfg }
	medNTouchesArrows: number; medNTouchesAllTouches: number
	coincideFracArrows: number; coincideFracAllTouches: number
	arrows: Array<{ t: number; side: Side; nTouches: number; coincide: boolean; touchSubIdx: number; volSpikeSubIdx: number; hasFine: boolean }>
}

function bestOn(shapesList: Array<{ i: number; side: Side }>, cands: Cand[], cfgs: Cfg[]): { s: Score; cfg: Cfg } {
	let best: Score | null = null, bestCfg: Cfg = GATE
	for (const cfg of cfgs) {
		const s = score(shapesList, fires(cands, cfg), cfg.tol)
		if (s.density <= 8 && (best == null || s.f1 > best.f1)) { best = s; bestCfg = cfg }
	}
	if (best == null) best = score(shapesList, fires(cands, GATE), GATE.tol)
	return { s: best, cfg: bestCfg }
}

function analyzePair(coarseFile: string, fineFile: string): PairRes | null {
	const cp = `csv/${coarseFile}`, fp = `csv/${fineFile}`
	if (!existsSync(resolve(cp)) || !existsSync(resolve(fp))) { console.log(`skip (нет файла): ${coarseFile} / ${fineFile}`); return null }
	const coarse = load(cp), fine = load(fp)
	if (coarse.length < 2 || fine.length < 2) { console.log(`skip (мало баров): ${coarseFile} / ${fineFile}`); return null }
	const tfSec = tfSecFromName(coarseFile)
	if (!Number.isFinite(tfSec) || tfSec <= 0) { console.log(`skip (ТФ?): ${coarseFile}`); return null }

	const firstCoarseT = coarse[0]!.t, lastCoarseT = coarse[coarse.length - 1]!.t
	const firstFineT = fine[0]!.t, lastFineT = fine[fine.length - 1]!.t
	const ovStart = Math.max(firstFineT, firstCoarseT)
	const ovEnd = Math.min(lastFineT, lastCoarseT) + tfSec
	const nFineOverlap = fine.filter((b) => b.t >= ovStart && b.t < ovEnd).length
	if (nFineOverlap < 300) { console.log(`skip (перекрытие <300 fine-баров = ${nFineOverlap}): ${coarseFile} / ${fineFile}`); return null }

	const { cands, noFineShapes } = buildCandidates(coarse, fine, tfSec, ovStart, ovEnd)

	// shapes coarse в перекрытии (по времени)
	const shapesList: Array<{ i: number; side: Side }> = []
	for (let i = 0; i < coarse.length; i++) {
		const b = coarse[i]!
		if (b.t < ovStart || b.t >= ovEnd) continue
		if (b.buy) shapesList.push({ i, side: 'buy' })
		else if (b.sell) shapesList.push({ i, side: 'sell' })
	}
	const shapesOverlap = shapesList.length

	const gate = score(shapesList, fires(cands, GATE), GATE.tol)
	const { s: best, cfg: bestCfg } = bestOn(shapesList, cands, allCfgs())

	// train/OOS хронологически 65/35 по времени перекрытия
	let oos: PairRes['oos']
	if (shapesOverlap < 12) {
		const { s: full, cfg: fullCfg } = bestOn(shapesList, cands, allCfgs())
		oos = { mode: 'underpowered', nOverlapShapes: shapesOverlap, full, fullCfg }
	} else {
		const splitT = ovStart + (ovEnd - ovStart) * 0.65
		const trainShapes = shapesList.filter((s) => coarse[s.i]!.t < splitT)
		const oosShapes = shapesList.filter((s) => coarse[s.i]!.t >= splitT)
		const trainCands = cands.filter((c) => c.t < splitT)
		const oosCands = cands.filter((c) => c.t >= splitT)
		const { cfg: chosen } = bestOn(trainShapes, trainCands, allCfgs())
		const train = score(trainShapes, fires(trainCands, chosen), chosen.tol)
		const oosScore = score(oosShapes, fires(oosCands, chosen), chosen.tol)
		oos = { mode: 'split', train, oos: oosScore, oosCfg: chosen }
	}

	// интрабар-статистика на барах-стрелках vs на всех касаниях (только с fine)
	const withFine = cands.filter((c) => c.hasFine)
	const arrowsF = withFine.filter((c) => c.isShape)
	const medNTouchesArrows = median(arrowsF.map((c) => c.nTouches))
	const medNTouchesAllTouches = median(withFine.map((c) => c.nTouches))
	const coincideFracArrows = arrowsF.length ? arrowsF.filter((c) => c.coincide).length / arrowsF.length : NaN
	const coincideFracAllTouches = withFine.length ? withFine.filter((c) => c.coincide).length / withFine.length : NaN

	const arrows = cands.filter((c) => c.isShape).map((c) => ({ t: c.t, side: c.side, nTouches: c.nTouches, coincide: c.coincide, touchSubIdx: c.touchSubIdx, volSpikeSubIdx: c.volSpikeSubIdx, hasFine: c.hasFine }))

	return {
		coarseFile, fineFile, coarseTf: tfLabel(coarseFile), fineTf: tfLabel(fineFile), tfSec,
		ovStartT: ovStart, ovEndT: ovEnd, nFineOverlap,
		shapesOverlap, nCandTouches: cands.length, nCandWithFine: withFine.length, noFineShapes,
		gate, best, bestCfg, oos,
		medNTouchesArrows, medNTouchesAllTouches, coincideFracArrows, coincideFracAllTouches,
		arrows,
	}
}

const PAIRS: Array<[string, string]> = [
	['BINANCE_ETHUSDT, 5.csv', 'BINANCE_ETHUSDT, 1.csv'],
	['BINANCE_ETHUSDT, 1.csv', 'BINANCE_ETHUSDT, 5S.csv'],
	['BINANCE_ETHUSDT, 1.csv', 'BINANCE_ETHUSDT, 1S.csv'],
	['BINANCE_ETHUSDT, 5.csv', 'BINANCE_ETHUSDT, 1S.csv'],
	['BINANCE_BNBUSDT, 5.csv', 'BINANCE_BNBUSDT, 1.csv'],
	['BINANCE_BNBUSDT, 1.csv', 'BINANCE_BNBUSDT, 10S.csv'],
	['BINANCE_BNBUSDT, 1.csv', 'BINANCE_BNBUSDT, 1S.csv'],
]

function main() {
	const rows: PairRes[] = []
	for (const [c, f] of PAIRS) {
		const r = analyzePair(c, f)
		if (r == null) continue
		rows.push(r)
		const oosStr = r.oos.mode === 'underpowered'
			? `OOS: underpowered (N_overlap_shapes=${r.oos.nOverlapShapes}); FULL best ${cfgLabel(r.oos.fullCfg)} recall ${pct(r.oos.full.recall)} prec ${pct(r.oos.full.precision)} F1 ${r2(r.oos.full.f1)}`
			: `OOS(${cfgLabel(r.oos.oosCfg)}): recall ${pct(r.oos.oos.recall)} prec ${pct(r.oos.oos.precision)} F1 ${r2(r.oos.oos.f1)} (train F1 ${r2(r.oos.train.f1)})`
		console.log(
			`${r.coarseFile} [${r.coarseTf}] × ${r.fineFile} [${r.fineTf}] | fineOverlap=${r.nFineOverlap} shapes=${r.shapesOverlap} touches=${r.nCandTouches} (fine ${r.nCandWithFine}) noFineShapes=${r.noFineShapes}\n` +
			`  GATE(только касание): recall ${pct(r.gate.recall)} prec ${pct(r.gate.precision)} F1 ${r2(r.gate.f1)} dens ${r2(r.gate.density)}\n` +
			`  BEST(${cfgLabel(r.bestCfg)}): recall ${pct(r.best.recall)} prec ${pct(r.best.precision)} F1 ${r2(r.best.f1)} dens ${r2(r.best.density)} (matched ${r.best.matched}/${r.best.nFires})\n` +
			`  ${oosStr}\n` +
			`  nTouches med — стрелки ${r2(r.medNTouchesArrows)} vs все касания ${r2(r.medNTouchesAllTouches)}; coincide — стрелки ${pct(r.coincideFracArrows)} vs все ${pct(r.coincideFracAllTouches)}`
		)
	}
	if (!rows.length) throw new Error('Нет валидных пар (нет файлов или перекрытие <300 fine-баров).')

	const md: string[] = []
	md.push('# RE22 — интрабарная последовательность как селектор стрелки vs shapes (recall/precision)')
	md.push('')
	md.push('> Линии зоны — **вендорские** (§2.1), не выдуманы; пороги/сетка свипаны. **src/core не тронут** — чистый исследовательский раннер поверх CSV.')
	md.push('')
	md.push('Реконструируем путь внутри каждого coarse-бара по реальным fine суб-барам того же окна `[t, t+tfSec)`. Популяция касаний (знаменатель precision) — coarse-бары в перекрытии, чей фитиль касается внутренней полосы, с rearm по возврату close к mean (как RE20). Селектор `fire`: интрабар-касание inner + (опц.) `coincide` (|touchSubIdx−volSpikeSubIdx|≤1) + условие на `nTouches` (maxTouches «первое/редкое», minTouches «повторность»). Матч против vendor shapes greedy (та же сторона, ±tol, один↔один, ближайший). `density=fires/shape` (≤8 для best). GATE = только касание (аналог RE20-гейта).')
	md.push('')
	md.push('| coarse | fine | shapes(overlap) | touches | GATE r/p/F1 (dens) | BEST cfg | BEST r/p/F1 (dens) | OOS / underpowered | noFineShapes |')
	md.push('|---|---|---|---|---|---|---|---|---|')
	for (const r of rows) {
		const oosCell = r.oos.mode === 'underpowered'
			? `underpowered: N_overlap_shapes=${r.oos.nOverlapShapes} (FULL F1 ${r2(r.oos.full.f1)})`
			: `r ${pct(r.oos.oos.recall)} / p ${pct(r.oos.oos.precision)} / F1 ${r2(r.oos.oos.f1)}`
		md.push(`| ${r.coarseFile} (${r.coarseTf}) | ${r.fineFile} (${r.fineTf}) | ${r.shapesOverlap} | ${r.nCandTouches} (fine ${r.nCandWithFine}) | ${pct(r.gate.recall)} / ${pct(r.gate.precision)} / ${r2(r.gate.f1)} (${r2(r.gate.density)}) | ${cfgLabel(r.bestCfg)} | ${pct(r.best.recall)} / ${pct(r.best.precision)} / ${r2(r.best.f1)} (${r2(r.best.density)}) | ${oosCell} | ${r.noFineShapes} |`)
	}
	md.push('')
	md.push('### Интрабар-профиль: бары-стрелки vs все касания')
	md.push('')
	md.push('| coarse×fine | nTouches med (стрелки) | nTouches med (все) | coincide (стрелки) | coincide (все) |')
	md.push('|---|---|---|---|---|')
	for (const r of rows) {
		md.push(`| ${r.coarseTf}×${r.fineTf} | ${r2(r.medNTouchesArrows)} | ${r2(r.medNTouchesAllTouches)} | ${pct(r.coincideFracArrows)} | ${pct(r.coincideFracAllTouches)} |`)
	}
	md.push('')
	md.push('## Как читать')
	md.push('- **BEST precision ≫ GATE precision при живом recall** ⇒ интрабарная последовательность добавляет разделение сверх простого касания (гипотеза RE22 подтверждается).')
	md.push('- **BEST F1 ≈ GATE F1** (и/или best cfg сводится к GATE) ⇒ последовательность НИЧЕГО не добавляет сверх касания — механизм не в интрабар-пути OHLCV.')
	md.push('- **coincide/nTouches у стрелок ≈ как у всех касаний** ⇒ вендор не отбирает по «объём совпал с касанием» / «первое касание» — доп. подтверждение отсутствия разделения.')
	md.push('- **OOS F1 ≪ train F1** ⇒ best cfg — переобучение на in-sample (особенно на fine ТФ с малыми выборками); смотреть на OOS/underpowered, не на train.')
	md.push('- **underpowered** = shapes-в-перекрытии < 12: делить train/OOS нет смысла; это честный результат лимита данных (near-tick окна короткие).')
	md.push('')
	md.push('## Сравнение с RE20 / RE21')
	md.push('- **RE20** (гейт «фитиль≥inner + объём + rearm», один агрегат по coarse-бару): best F1 ~0.14–0.20 на 1m/5m, precision 1–18%, density до 47× на fine ТФ.')
	md.push('- **RE21** (F&G-экстремум среди касаний): F1 ~0.12–0.16, precision 5–12%, на 1s/5s matched часто 0.')
	md.push('- **RE22** (эта работа): вопрос — добавляет ли интрабар-путь (coincide + nTouches по РЕАЛЬНЫМ fine-барам) precision сверх RE20-гейта. Вывод — в консольной строке-вердикте и в колонках GATE vs BEST/OOS выше.')
	md.push('')
	writeFileSync(resolve('ci-results/re22-intrabar-sequence-fit.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/re22-intrabar-sequence-fit.json'), JSON.stringify({
		generatedAt: new Date().toISOString(),
		note: 'RE22 intrabar-sequence selector over real fine sub-bars vs vendor shapes. Vendor zone lines used as-is (§2.1). src/core untouched.',
		grid: { REQ, MAXT: MAXT.map((m) => m === Infinity ? 'Infinity' : m), MINT, TOLS },
		gateCfg: GATE,
		pairs: rows.map((r) => ({
			coarseFile: r.coarseFile, fineFile: r.fineFile, coarseTf: r.coarseTf, fineTf: r.fineTf, tfSec: r.tfSec,
			overlap: { startT: r.ovStartT, endT: r.ovEndT, nFineOverlap: r.nFineOverlap },
			shapesOverlap: r.shapesOverlap, nCandTouches: r.nCandTouches, nCandWithFine: r.nCandWithFine, noFineShapes: r.noFineShapes,
			gate: r.gate, best: r.best, bestCfg: { ...r.bestCfg, maxTouches: r.bestCfg.maxTouches === Infinity ? 'Infinity' : r.bestCfg.maxTouches },
			oos: r.oos.mode === 'underpowered'
				? { mode: r.oos.mode, nOverlapShapes: r.oos.nOverlapShapes, full: r.oos.full, fullCfg: { ...r.oos.fullCfg, maxTouches: r.oos.fullCfg.maxTouches === Infinity ? 'Infinity' : r.oos.fullCfg.maxTouches } }
				: { mode: r.oos.mode, train: r.oos.train, oos: r.oos.oos, oosCfg: { ...r.oos.oosCfg, maxTouches: r.oos.oosCfg.maxTouches === Infinity ? 'Infinity' : r.oos.oosCfg.maxTouches } },
			intrabarProfile: {
				medNTouchesArrows: r.medNTouchesArrows, medNTouchesAllTouches: r.medNTouchesAllTouches,
				coincideFracArrows: r.coincideFracArrows, coincideFracAllTouches: r.coincideFracAllTouches,
			},
			arrows: r.arrows,
		})),
	}, null, 2))
	console.log('\nЗаписано: ci-results/re22-intrabar-sequence-fit.{md,json}')
}

main()
