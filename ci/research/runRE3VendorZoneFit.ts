/**
 * RE3 (основной) — ФИНГЕРПРИНТ реальной GGI Zone по CSV из TradingView.
 *
 * Данные: `csv/BINANCE_*.csv` — экспорт «Export chart data» с включённым GGI Buy/Sell.
 * Колонки: time, open, high, low, close, GGI Mean, GGI Upper Outer, GGI Upper Inner,
 *          GGI Lower Inner, GGI Lower Outer, Shapes(Buy=1), Shapes(Sell=1), Volume.
 * Соответствие полос: mean↔GGI Mean, redHi↔UpperOuter, redLo↔UpperInner,
 *                     greenHi↔LowerInner, greenLo↔LowerOuter.
 *
 * Отвечает на два вопроса, которые НЕ решались по одним свечам (RE1/RE2/RE3-alt упёрлись в стенку):
 *   БЛОК A — ГЕОМЕТРИЯ: насколько наш Apex (computeApexBands из тех же OHLCV) совпадает с реальными
 *            линиями вендора? Per-line %-ошибка (mean/inner/outer, верх/низ), лаг средней, и
 *            АНАЛИТИЧЕСКИ извлечённая геометрия вендора: implied лог-полуширины, симметрия верх/низ,
 *            implied k-ratio (наш 9.6/5.6=1.714), implied widthScale к нашему спреду.
 *   БЛОК B — ЛОКАЛИЗАЦИЯ СТРЕЛКИ vs СОБСТВЕННАЯ зона вендора: где именно (по доле пути mean→внешний
 *            край ЕГО ЖЕ линий) стоит фитиль на баре Buy/Sell и в окне ±W. Касается ли стрелка его
 *            inner/outer вообще. Это прямой замер порога «экстремума» на верной зоне.
 *
 * Движок src/core НЕ трогается (§2.3/§2.4) — только чтение через computeApexBands/detectArrowSignalCandidates.
 * Причинность для БЛОКА A не критична (сверяем геометрию линий в тот же момент); OWN2-recall — трейлингово.
 *
 * Запуск: npx tsx ci/research/runRE3VendorZoneFit.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS, type ApexBand } from '../../src/core/signals/ApexEngine.js'
import { detectArrowSignalCandidates } from '../../src/core/signals/ArrowSignalEngine.js'

const WARMUP = 210
const REL_VOL_MIN = 1.4

const FILES: Array<{ key: string; file: string }> = [
	{ key: 'BTC.P 5m', file: 'csv/BINANCE_BTCUSDT.P, 5.csv' },
	{ key: 'BTC.P 15m', file: 'csv/BINANCE_BTCUSDT.P, 15.csv' },
	{ key: 'BTC.P 1h', file: 'csv/BINANCE_BTCUSDT.P, 60.csv' },
	{ key: 'BNB.P 5m', file: 'csv/BINANCE_BNBUSDT.P, 5.csv' },
	{ key: 'VIRTUAL.P 5m', file: 'csv/BINANCE_VIRTUALUSDT.P, 5.csv' },
]

interface VRow {
	candle: Candle
	mean: number; upperOuter: number; upperInner: number; lowerInner: number; lowerOuter: number
	buy: boolean; sell: boolean
}

function num(x: string | undefined): number { const n = Number((x ?? '').trim()); return Number.isFinite(n) ? n : NaN }

function loadCsv(file: string): VRow[] {
	const txt = readFileSync(resolve(file), 'utf8')
	const lines = txt.split(/\r?\n/).filter((l) => l.length > 0)
	const rows: VRow[] = []
	for (let li = 1; li < lines.length; li++) { // skip header
		const p = lines[li]!.split(',')
		if (p.length < 13) continue
		const t = num(p[0]); const o = num(p[1]); const h = num(p[2]); const l = num(p[3]); const c = num(p[4])
		if (![t, o, h, l, c].every(Number.isFinite)) continue
		rows.push({
			candle: { timestamp: t * 1000, open: o, high: h, low: l, close: c, volume: num(p[12]) || 0 },
			mean: num(p[5]), upperOuter: num(p[6]), upperInner: num(p[7]), lowerInner: num(p[8]), lowerOuter: num(p[9]),
			buy: (p[10] ?? '0').trim() === '1', sell: (p[11] ?? '0').trim() === '1',
		})
	}
	return rows
}

// --- статистика ---
const median = (xs: number[]): number => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2 }
const quantile = (xs: number[], q: number): number => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const i = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1)))); return s[i]! }
const mean = (xs: number[]): number => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN

interface LineFit { median: number; p90: number; max: number; n: number }
function lineFit(ours: number[], vendor: number[]): LineFit {
	const err: number[] = []
	for (let i = 0; i < ours.length; i++) {
		if (i < WARMUP) continue
		const o = ours[i]!, v = vendor[i]!
		if (!Number.isFinite(o) || !Number.isFinite(v) || v === 0) continue
		err.push(Math.abs(o - v) / Math.abs(v) * 100)
	}
	return { median: median(err), p90: quantile(err, 0.9), max: err.length ? Math.max(...err) : NaN, n: err.length }
}

interface ShapeLoc {
	side: 'buy' | 'sell'
	depthOuterAt: number     // доля пути mean→внешний край, достигнутая фитилём НА баре стрелки
	depthOuterBest: number   // максимальная за окно ±W
	touchInnerAt: boolean; touchOuterAt: boolean
	touchInnerWin: boolean; touchOuterWin: boolean
}

async function main() {
	const pc = (x: number) => (Number.isFinite(x) ? (x).toFixed(2) : 'n/a')
	const pct = (x: number) => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a')

	interface PerFile {
		key: string; rows: number; buys: number; sells: number
		fit: { mean: LineFit; upperOuter: LineFit; upperInner: LineFit; lowerInner: LineFit; lowerOuter: LineFit }
		meanLagBest: { lag: number; medErr: number }
		vendorGeom: { innerSymMedPct: number; outerSymMedPct: number; kRatioMed: number; impliedWidthScaleMed: number }
		shapeLoc: ShapeLoc[]
		own2Recall: number; own2N: number
	}
	const perFile: PerFile[] = []
	const allShape: ShapeLoc[] = []
	const W = 2 // окно локализации ±2 бара

	for (const { key, file } of FILES) {
		let rows: VRow[]
		try { rows = loadCsv(file) } catch (e) { console.error(`skip ${key}: ${(e as Error).message}`); continue }
		if (rows.length < 400) { console.error(`skip ${key}: too few rows (${rows.length})`); continue }
		const candles = rows.map((r) => r.candle)
		const bands: ApexBand[] = computeApexBands(candles, APEX_PARAMS)

		// БЛОК A — geometry fit (наш vs вендор), per line
		const oMean = bands.map((b) => b.mean), vMean = rows.map((r) => r.mean)
		const fit = {
			mean: lineFit(oMean, vMean),
			upperOuter: lineFit(bands.map((b) => b.redHi), rows.map((r) => r.upperOuter)),
			upperInner: lineFit(bands.map((b) => b.redLo), rows.map((r) => r.upperInner)),
			lowerInner: lineFit(bands.map((b) => b.greenHi), rows.map((r) => r.lowerInner)),
			lowerOuter: lineFit(bands.map((b) => b.greenLo), rows.map((r) => r.lowerOuter)),
		}
		// лаг средней: сдвиг наш mean на lag баров, ищем минимум медианной %-ошибки
		let meanLagBest = { lag: 0, medErr: Infinity }
		for (let lag = -5; lag <= 5; lag++) {
			const err: number[] = []
			for (let i = WARMUP; i < rows.length; i++) {
				const j = i + lag
				if (j < 0 || j >= rows.length) continue
				const o = oMean[j]!, v = vMean[i]!
				if (!Number.isFinite(o) || !Number.isFinite(v) || v === 0) continue
				err.push(Math.abs(o - v) / Math.abs(v) * 100)
			}
			const me = median(err)
			if (Number.isFinite(me) && me < meanLagBest.medErr) meanLagBest = { lag, medErr: me }
		}

		// БЛОК A2 — аналитическая геометрия вендора (implied)
		const innerSym: number[] = [], outerSym: number[] = [], kRatio: number[] = [], impliedWS: number[] = []
		for (let i = WARMUP; i < rows.length; i++) {
			const r = rows[i]!, b = bands[i]!
			if (![r.mean, r.upperOuter, r.upperInner, r.lowerInner, r.lowerOuter].every(Number.isFinite) || r.mean <= 0) continue
			const upIn = Math.log(r.upperInner / r.mean)   // >0
			const dnIn = Math.log(r.mean / r.lowerInner)   // >0
			const upOut = Math.log(r.upperOuter / r.mean)
			const dnOut = Math.log(r.mean / r.lowerOuter)
			if (upIn > 0 && dnIn > 0) innerSym.push(Math.abs(upIn - dnIn) / ((upIn + dnIn) / 2) * 100)
			if (upOut > 0 && dnOut > 0) outerSym.push(Math.abs(upOut - dnOut) / ((upOut + dnOut) / 2) * 100)
			if (upIn > 0) kRatio.push(upOut / upIn) // наш = kOuter/kInner = 9.6/5.6 = 1.714
			// implied s вендора при НАШЕМ kInner=5.6, из верхней внутренней; наш s из полос
			const sVendor = upIn / APEX_PARAMS.kInner
			const sOurs = Number.isFinite(b.s) ? b.s : NaN
			if (Number.isFinite(sOurs) && sOurs > 0 && Number.isFinite(sVendor) && sVendor > 0) impliedWS.push(sVendor / sOurs)
		}
		const vendorGeom = {
			innerSymMedPct: median(innerSym),
			outerSymMedPct: median(outerSym),
			kRatioMed: median(kRatio),
			impliedWidthScaleMed: median(impliedWS),
		}

		// БЛОК B — локализация стрелок vs собственная зона вендора
		const shapeLoc: ShapeLoc[] = []
		for (let i = 0; i < rows.length; i++) {
			const r = rows[i]!
			if (!r.buy && !r.sell) continue
			const side: 'buy' | 'sell' = r.buy ? 'buy' : 'sell'
			// доля пути mean→внешний край, достигнутая фитилём (buy: low вниз; sell: high вверх)
			const depthFrac = (idx: number): number => {
				const rr = rows[idx]
				if (!rr || ![rr.mean, rr.lowerOuter, rr.upperOuter].every(Number.isFinite)) return NaN
				if (side === 'buy') { const path = rr.mean - rr.lowerOuter; return path > 0 ? (rr.mean - rr.candle.low) / path : NaN }
				const path = rr.upperOuter - rr.mean; return path > 0 ? (rr.candle.high - rr.mean) / path : NaN
			}
			const touchInner = (idx: number): boolean => {
				const rr = rows[idx]; if (!rr) return false
				return side === 'buy' ? rr.candle.low <= rr.lowerInner : rr.candle.high >= rr.upperInner
			}
			const touchOuter = (idx: number): boolean => {
				const rr = rows[idx]; if (!rr) return false
				return side === 'buy' ? rr.candle.low <= rr.lowerOuter : rr.candle.high >= rr.upperOuter
			}
			const depthOuterAt = depthFrac(i)
			let depthOuterBest = depthOuterAt
			let touchInnerWin = false, touchOuterWin = false
			for (let d = -W; d <= W; d++) {
				const j = i + d; if (j < 0 || j >= rows.length) continue
				const df = depthFrac(j); if (Number.isFinite(df) && (!Number.isFinite(depthOuterBest) || df > depthOuterBest)) depthOuterBest = df
				if (touchInner(j)) touchInnerWin = true
				if (touchOuter(j)) touchOuterWin = true
			}
			const loc: ShapeLoc = { side, depthOuterAt, depthOuterBest, touchInnerAt: touchInner(i), touchOuterAt: touchOuter(i), touchInnerWin, touchOuterWin }
			shapeLoc.push(loc); allShape.push(loc)
		}

		// OWN2 recall стрелок вендора (наш детектор на этих же свечах, матч ±1 бар)
		const own2 = detectArrowSignalCandidates(candles, APEX_PARAMS, { minimumRelativeVolume: REL_VOL_MIN }).candidates
		const own2ByIdx = new Map<number, Set<'buy' | 'sell'>>()
		// сопоставим signalAt → индекс бара
		const tsToIdx = new Map<number, number>()
		candles.forEach((c, idx) => tsToIdx.set(c.timestamp, idx))
		for (const c of own2) {
			const idx = tsToIdx.get(Math.floor(c.signalAt / 1) * 1) ?? tsToIdx.get(c.signalAt)
			if (idx === undefined) continue
			const set = own2ByIdx.get(idx) ?? new Set<'buy' | 'sell'>(); set.add(c.side === 'long' ? 'buy' : 'sell'); own2ByIdx.set(idx, set)
		}
		let shapeN = 0, matched = 0
		for (let i = 0; i < rows.length; i++) {
			const r = rows[i]!; if (!r.buy && !r.sell) continue
			const want: 'buy' | 'sell' = r.buy ? 'buy' : 'sell'
			shapeN++
			let hit = false
			for (let d = -1; d <= 1 && !hit; d++) { const s = own2ByIdx.get(i + d); if (s && s.has(want)) hit = true }
			if (hit) matched++
		}

		perFile.push({
			key, rows: rows.length, buys: shapeLoc.filter((s) => s.side === 'buy').length, sells: shapeLoc.filter((s) => s.side === 'sell').length,
			fit, meanLagBest, vendorGeom, shapeLoc, own2Recall: shapeN ? matched / shapeN : 0, own2N: shapeN,
		})
		console.log(`${key}: rows=${rows.length} shapes=${shapeLoc.length} meanErrMed=${pc(fit.mean.median)}% own2Recall=${pct(shapeN ? matched / shapeN : 0)}`)
	}

	if (!perFile.length) throw new Error('Ни один CSV не загрузился — проверь папку csv/.')

	// агрегаты по стрелкам (все файлы)
	const depthAt = allShape.map((s) => s.depthOuterAt).filter(Number.isFinite)
	const depthBest = allShape.map((s) => s.depthOuterBest).filter(Number.isFinite)
	const shareTouchInnerAt = allShape.length ? allShape.filter((s) => s.touchInnerAt).length / allShape.length : NaN
	const shareTouchOuterAt = allShape.length ? allShape.filter((s) => s.touchOuterAt).length / allShape.length : NaN
	const shareTouchInnerWin = allShape.length ? allShape.filter((s) => s.touchInnerWin).length / allShape.length : NaN
	const shareTouchOuterWin = allShape.length ? allShape.filter((s) => s.touchOuterWin).length / allShape.length : NaN

	// ---------- ОТЧЁТ ----------
	const md: string[] = []
	md.push('# RE3 — фингерпринт реальной GGI Zone по CSV (линии вендора + shapes)')
	md.push('')
	md.push('Данные: `csv/BINANCE_*.csv` (Export chart data с включённым GGI Buy/Sell). Соответствие: mean↔GGI Mean, redHi↔UpperOuter, redLo↔UpperInner, greenHi↔LowerInner, greenLo↔LowerOuter. Наш Apex считается из тех же OHLCV (`computeApexBands`, канон APEX_PARAMS), движок не тронут.')
	md.push('')
	md.push('## БЛОК A — ГЕОМЕТРИЯ: наш Apex vs реальные линии вендора')
	md.push('')
	md.push('Медианная / p90 / max абсолютная %-ошибка нашей линии против вендорской (i≥210).')
	md.push('')
	md.push('| файл | mean med/p90/max | UpOuter | UpInner | LoInner | LoOuter | mean-лаг (бар, medErr%) |')
	md.push('|---|---|---|---|---|---|---|')
	for (const f of perFile) {
		const g = (x: LineFit) => `${pc(x.median)}/${pc(x.p90)}/${pc(x.max)}`
		md.push(`| ${f.key} | ${g(f.fit.mean)} | ${g(f.fit.upperOuter)} | ${g(f.fit.upperInner)} | ${g(f.fit.lowerInner)} | ${g(f.fit.lowerOuter)} | ${f.meanLagBest.lag} (${pc(f.meanLagBest.medErr)}%) |`)
	}
	md.push('')
	md.push('### A2 — извлечённая геометрия вендора (аналитически из его линий)')
	md.push('')
	md.push('innerSym/outerSym — насколько лог-полуширины вверх и вниз симметричны (0% = идеальная лог-симметрия, как у нас). kRatio — отношение внешней лог-полуширины к внутренней (наш kOuter/kInner = 9.6/5.6 = **1.714**). impliedWidthScale — во сколько раз спред вендора отличается от нашего (наш s при том же kInner=5.6).')
	md.push('')
	md.push('| файл | innerSym med | outerSym med | kRatio med (наш 1.714) | impliedWidthScale med (наш 1.0) |')
	md.push('|---|---|---|---|---|')
	for (const f of perFile) md.push(`| ${f.key} | ${pc(f.vendorGeom.innerSymMedPct)}% | ${pc(f.vendorGeom.outerSymMedPct)}% | ${pc(f.vendorGeom.kRatioMed)} | ${pc(f.vendorGeom.impliedWidthScaleMed)} |`)
	md.push('')
	md.push('## БЛОК B — ЛОКАЛИЗАЦИЯ СТРЕЛКИ vs СОБСТВЕННАЯ зона вендора')
	md.push('')
	md.push('Для каждой стрелки: доля пути mean→ВНЕШНИЙ край ЕГО ЖЕ линий, достигнутая фитилём (buy: low вниз, sell: high вверх). «At» — на баре стрелки; «Best» — максимум в окне ±2 бара. touchInner/Outer — коснулся ли фитиль соответствующей полосы вендора.')
	md.push('')
	md.push(`Всего стрелок: **${allShape.length}** (buy ${allShape.filter((s) => s.side === 'buy').length} / sell ${allShape.filter((s) => s.side === 'sell').length}).`)
	md.push('')
	md.push('| метрика | значение |')
	md.push('|---|---|')
	md.push(`| depthOuter на баре — median | **${pc(median(depthAt))}** (доля пути к внешнему краю) |`)
	md.push(`| depthOuter на баре — p10 / p90 | ${pc(quantile(depthAt, 0.1))} / ${pc(quantile(depthAt, 0.9))} |`)
	md.push(`| depthOuter best(±2) — median | ${pc(median(depthBest))} |`)
	md.push(`| касание INNER на баре | ${pct(shareTouchInnerAt)} |`)
	md.push(`| касание INNER в окне ±2 | ${pct(shareTouchInnerWin)} |`)
	md.push(`| касание OUTER на баре | ${pct(shareTouchOuterAt)} |`)
	md.push(`| касание OUTER в окне ±2 | ${pct(shareTouchOuterWin)} |`)
	md.push('')
	md.push('### depthOuter «at» — распределение по бакетам (доля стрелок)')
	md.push('')
	const buckets = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, Infinity]
	md.push('| бакет доли пути | доля стрелок |')
	md.push('|---|---|')
	for (let bi = 0; bi < buckets.length - 1; bi++) {
		const lo = buckets[bi]!, hi = buckets[bi + 1]!
		const n = depthAt.filter((d) => d >= lo && d < hi).length
		const label = hi === Infinity ? `≥${lo.toFixed(1)} (за краем)` : `${lo.toFixed(1)}–${hi.toFixed(1)}`
		md.push(`| ${label} | ${pct(allShape.length ? n / allShape.length : 0)} (${n}) |`)
	}
	md.push('')
	md.push('## БЛОК C — recall стрелок вендора нашим OWN2 (relVol1.4) на ЭТИХ свечах')
	md.push('')
	md.push('| файл | shapes | OWN2 recall@±1 |')
	md.push('|---|---|---|')
	for (const f of perFile) md.push(`| ${f.key} | ${f.own2N} | ${pct(f.own2Recall)} |`)
	md.push('')
	md.push('## ВЫВОД (черновой, требует интерпретации автора)')
	md.push('')
	md.push(`1. **Геометрия.** Медианная %-ошибка нашей средней/полос против вендора — см. БЛОК A. Если она мала (доли %), наш Apex совпадает с зоной вендора, и дальше играет только ТРИГГЕР стрелки, не геометрия.`)
	md.push(`2. **Симметрия/k.** innerSym/outerSym ≈ 0% ⇒ вендор строит лог-симметричные полосы (как мы). kRatio ≈ 1.714 ⇒ та же связка внешней/внутренней (9.6/5.6). Отклонения = нюанс геометрии.`)
	md.push(`3. **Где стоит стрелка.** Медиана depthOuter = **${pc(median(depthAt))}** доли пути mean→край; касание INNER в окне ±2 = ${pct(shareTouchInnerWin)}, OUTER = ${pct(shareTouchOuterWin)}. Это ПРЯМОЙ замер порога «экстремума» вендора на верной зоне — впервые без гадания.`)
	md.push('')

	writeFileSync(resolve('ci-results/re3-vendor-zone-fit.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/re3-vendor-zone-fit.json'), JSON.stringify({
		generatedAt: new Date().toISOString(),
		files: FILES.map((f) => f.file),
		warmup: WARMUP, relVolMin: REL_VOL_MIN, localizationWindow: W,
		perFile: perFile.map((f) => ({
			key: f.key, rows: f.rows, buys: f.buys, sells: f.sells,
			fit: f.fit, meanLagBest: f.meanLagBest, vendorGeom: f.vendorGeom,
			own2Recall: f.own2Recall, own2N: f.own2N,
		})),
		shapeAggregate: {
			total: allShape.length,
			buy: allShape.filter((s) => s.side === 'buy').length,
			sell: allShape.filter((s) => s.side === 'sell').length,
			depthOuterAt: { median: median(depthAt), mean: mean(depthAt), p10: quantile(depthAt, 0.1), p90: quantile(depthAt, 0.9) },
			depthOuterBest: { median: median(depthBest), mean: mean(depthBest) },
			touchInnerAt: shareTouchInnerAt, touchInnerWin: shareTouchInnerWin,
			touchOuterAt: shareTouchOuterAt, touchOuterWin: shareTouchOuterWin,
		},
	}, null, 2))

	console.log('\n=== RE3 vendor-zone-fit ===')
	console.log(`shapes total=${allShape.length} depthOuter median(at)=${pc(median(depthAt))} touchInnerWin=${pct(shareTouchInnerWin)} touchOuterWin=${pct(shareTouchOuterWin)}`)
	console.log('Записано: ci-results/re3-vendor-zone-fit.{md,json}')
}

main().catch((e) => { console.error(e); process.exit(1) })
