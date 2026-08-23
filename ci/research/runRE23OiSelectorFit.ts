/**
 * RE23 — открытый интерес (OI) как НЕ-OHLCV рычаг: отделяет ли OI бар со стрелкой от прочих касаний?
 *
 * Гипотеза: бар со стрелкой вендора отличается от прочих баров, которые тоже касаются ВНУТРЕННЕЙ полосы
 * зоны, экстремумом/всплеском ОТКРЫТОГО ИНТЕРЕСА (OI). Это единственный доступный НЕ-OHLCV фид
 * (funding в Pine напрямую не тянется — вычеркнут в RE19–22). Селектор: «касание внутр. полосы (как RE20)
 * + OI-условие». Референс: RE20-гейт (только касание, F1 ~0.14–0.20), RE21/RE22 (F1 0.12–0.16, лифта над
 * gate не дали).
 *
 * ДАННЫЕ OI: Binance USDT-M futures GET https://fapi.binance.com/futures/data/openInterestHist
 *   symbol (ETHUSDT|BNBUSDT), period=5m (минимальный шаг), limit≤500, startTime/endTime (мс).
 *   Отдаёт [{symbol, sumOpenInterest, sumOpenInterestValue, timestamp(мс)}, ...] по возрастанию времени.
 *   ДОСТУПНО ТОЛЬКО ПОСЛЕДНИЕ ~30 дней. Используем sumOpenInterest как OI-ряд.
 *   OI — ПЕРП-метрика; для ETH-файлов (спот) это оговорка (см. .md), но тест конкуренции валиден.
 *
 * АЛГОРИТМ (по каждой паре arrowFile↔oiSymbol):
 *   1. Загрузить стрелочный CSV (13 колонок, time в СЕКУНДАХ). OI-окно = [max(firstBar*1000,
 *      serverTime-29д), lastBar*1000+300000]. Пусто — skip. Стянуть OI (пагинация окнами по 500×300000мс,
 *      пауза ~150мс, dedupe, кэш в csv/oi/<SYM>_5m_oi.json).
 *   2. Выравнивание: для каждого бара floor(barTimeMs/300000)=ключ 5m OI-бара; OI на ключе (или ближайший
 *      ≤ ключа в пределах 5m). Бары без OI (вне 30д) → noOi, ИСКЛЮЧАЕМ из популяции (но считаем, сколько
 *      shapes выпало — цифра покрытия).
 *   3. Причинные OI-фичи (только по OI ≤ текущего ключа): oiZ=(oi-mean(W))/std(W), W=48; oiDeltaZ по
 *      Δoi=oi-oi_prev; oiTrailMax/Min по L=48 → atTrailHigh/atTrailLow (причинный экстремум). Без будущего.
 *   4. Популяция кандидатов = касания внутр. полосы с rearm ТОЧНО как RE20 (armedBuy при close≥mean,
 *      armedSell при close≤mean; buy fire при low≤loInner & armed; sell при high≥upInner & armed; после
 *      срабатывания сторона снимается). Тот же знаменатель precision, что RE20-гейт.
 *   5. Селектор fire = касание И OI-условие(cfg). OI-условия: none(=gate), absZ≥thr, deltaZ≥thr (всплеск),
 *      atTrailExtremum(любой), signedByDir (buy: atTrailLow ИЛИ oiZ≤−thr; sell: atTrailHigh ИЛИ oiZ≥+thr).
 *      thr∈{0.5,1,1.5,2}. tol∈{0,1,2}.
 *   6. Матч против vendor shapes (та же сторона, |Δ|≤tol, greedy ближайший, один fire↔один shape) как RE20.
 *   7. GATE-baseline (none) recall/prec/F1. Ранг best по F1 при density≤8.
 *   8. train/OOS 65/35 хронологически (best на train, отчёт на OOS). shapes-в-OI-окне < 12 → underpowered.
 *   9. КОНТРАСТ: на барах-СТРЕЛКАХ vs всех касаниях — медиана oiZ, |oiDeltaZ|, доля atTrailHigh/atTrailLow.
 *      Если у стрелок OI-фичи ≈ как у прочих касаний — OI не разделяет.
 *
 * §2.1: ничего не выдумываем — линии зоны вендорские, OI реальный (Binance), пороги свипаны; нет сети из
 * tsx → явная ошибка и ненулевой код (данные НЕ фабрикуем). src/core НЕ тронут — чистый раннер поверх CSV+API.
 *
 * Запуск: npx tsx "ci/research/runRE23OiSelectorFit.ts"
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

// ── глобальный fetch (Node 18+); НЕ добавляем библиотек ────────────────────────────────────────────
declare const fetch: (input: string, init?: unknown) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> }>

const OI_ENDPOINT = 'https://fapi.binance.com/futures/data/openInterestHist'
const TIME_ENDPOINT = 'https://fapi.binance.com/fapi/v1/time'
const STEP_MS = 300000 // 5m
const LIMIT = 500
const AVAIL_MS = 29 * 86400000 // ~29 дней «с запасом» под 30-дневный лимит
const W = 48 // трейлинг-окно z-score (~4ч на 5m)
const L = 48 // трейлинг-окно экстремума

const num = (x: string | undefined): number => { const n = Number((x ?? '').trim()); return Number.isFinite(n) ? n : NaN }
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const median = (a: number[]): number => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2 }
const r2 = (x: number): string => Number.isFinite(x) ? x.toFixed(2) : 'n/a'
const pct = (x: number): string => Number.isFinite(x) ? (x * 100).toFixed(0) + '%' : 'n/a'

// ── бары стрелочного CSV (парсинг как RE20) ───────────────────────────────────────────────────────
interface Bar { t: number; o: number; h: number; l: number; c: number; mean: number; upInner: number; loInner: number; buy: boolean; sell: boolean; vol: number }
function loadBars(file: string): Bar[] {
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
	out.sort((a, b) => a.t - b.t)
	return out
}

// ── OI: загрузка с пагинацией + кэш ──────────────────────────────────────────────────────────────
interface OiPoint { ts: number; oi: number }
interface OiCache { symbol: string; fetchedAt: string; coverStartMs: number; coverEndMs: number; points: OiPoint[] }

async function serverTime(): Promise<number> {
	const res = await fetch(TIME_ENDPOINT)
	if (!res.ok) throw new Error(`serverTime HTTP ${res.status}`)
	const j = (await res.json()) as { serverTime: number }
	return j.serverTime
}

async function fetchOiWindow(symbol: string, startMs: number, endMs: number): Promise<OiPoint[]> {
	const map = new Map<number, number>() // dedupe по timestamp
	let cursor = startMs
	while (cursor < endMs) {
		const winEnd = Math.min(cursor + LIMIT * STEP_MS, endMs)
		const url = `${OI_ENDPOINT}?symbol=${symbol}&period=5m&limit=${LIMIT}&startTime=${cursor}&endTime=${winEnd}`
		const res = await fetch(url)
		if (!res.ok) throw new Error(`openInterestHist HTTP ${res.status} (${symbol})`)
		const arr = (await res.json()) as Array<{ sumOpenInterest: string; timestamp: number }>
		if (!Array.isArray(arr)) throw new Error(`openInterestHist: неожиданный ответ (${symbol})`)
		if (arr.length === 0) { cursor = winEnd; continue }
		for (const it of arr) { const oi = Number(it.sumOpenInterest); if (Number.isFinite(oi)) map.set(it.timestamp, oi) }
		const lastTs = arr[arr.length - 1]!.timestamp
		// продвигаемся строго вперёд от последнего полученного бара
		const next = Math.max(winEnd, lastTs + STEP_MS)
		cursor = next
		await sleep(150)
	}
	return [...map.entries()].map(([ts, oi]) => ({ ts, oi })).sort((a, b) => a.ts - b.ts)
}

async function loadOi(symbol: string, needStartMs: number, needEndMs: number): Promise<OiPoint[]> {
	const dir = resolve('csv/oi')
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
	const path = resolve(dir, `${symbol}_5m_oi.json`)
	if (existsSync(path)) {
		try {
			const c = JSON.parse(readFileSync(path, 'utf8')) as OiCache
			if (c.points?.length && c.coverStartMs <= needStartMs + STEP_MS && c.coverEndMs >= needEndMs - STEP_MS) {
				console.log(`  OI ${symbol}: переиспользую кэш (${c.points.length} точек, ${new Date(c.coverStartMs).toISOString()}..${new Date(c.coverEndMs).toISOString()})`)
				return c.points
			}
		} catch { /* повреждён кэш — перезагрузим */ }
	}
	console.log(`  OI ${symbol}: тяну сеть ${new Date(needStartMs).toISOString()}..${new Date(needEndMs).toISOString()} ...`)
	const points = await fetchOiWindow(symbol, needStartMs, needEndMs)
	const cache: OiCache = { symbol, fetchedAt: new Date().toISOString(), coverStartMs: needStartMs, coverEndMs: needEndMs, points }
	writeFileSync(path, JSON.stringify(cache))
	console.log(`  OI ${symbol}: стянуто ${points.length} точек, кэш → csv/oi/${symbol}_5m_oi.json`)
	return points
}

// ── причинные OI-фичи по 5m-ключам ────────────────────────────────────────────────────────────────
interface OiFeat { oi: number; oiZ: number; oiDeltaZ: number; atTrailHigh: boolean; atTrailLow: boolean }
function buildOiFeatures(points: OiPoint[]): Map<number, OiFeat> {
	const feat = new Map<number, OiFeat>()
	for (let i = 0; i < points.length; i++) {
		const cur = points[i]!
		// трейлинг по прошлым OI-барам (i-W..i-1) — без текущего и без будущего
		const lo = Math.max(0, i - W)
		let sum = 0, n = 0
		for (let j = lo; j < i; j++) { sum += points[j]!.oi; n++ }
		const mean = n ? sum / n : NaN
		let varSum = 0
		for (let j = lo; j < i; j++) { const d = points[j]!.oi - mean; varSum += d * d }
		const std = n > 1 ? Math.sqrt(varSum / (n - 1)) : NaN
		const oiZ = (Number.isFinite(std) && std > 0) ? (cur.oi - mean) / std : NaN
		// delta z-score
		const dLo = Math.max(1, i - W)
		let dSum = 0, dN = 0
		for (let j = dLo; j < i; j++) { dSum += points[j]!.oi - points[j - 1]!.oi; dN++ }
		const dMean = dN ? dSum / dN : NaN
		let dVar = 0
		for (let j = dLo; j < i; j++) { const d = (points[j]!.oi - points[j - 1]!.oi) - dMean; dVar += d * d }
		const dStd = dN > 1 ? Math.sqrt(dVar / (dN - 1)) : NaN
		const curDelta = i >= 1 ? cur.oi - points[i - 1]!.oi : NaN
		const oiDeltaZ = (Number.isFinite(dStd) && dStd > 0) ? (curDelta - dMean) / dStd : NaN
		// трейлинг-экстремум по прошлым L барам (причинный: включая текущий против прошлого окна)
		const eLo = Math.max(0, i - L)
		let tMax = -Infinity, tMin = Infinity
		for (let j = eLo; j < i; j++) { const v = points[j]!.oi; if (v > tMax) tMax = v; if (v < tMin) tMin = v }
		const atTrailHigh = Number.isFinite(tMax) && tMax > -Infinity ? cur.oi >= tMax : false
		const atTrailLow = Number.isFinite(tMin) && tMin < Infinity ? cur.oi <= tMin : false
		feat.set(cur.ts, { oi: cur.oi, oiZ, oiDeltaZ, atTrailHigh, atTrailLow })
	}
	return feat
}

// ── кандидаты-касания (rearm как RE20) + привязка OI ────────────────────────────────────────────────
type Side = 'buy' | 'sell'
interface Cand { i: number; t: number; side: Side; isShape: boolean; hasOi: boolean; feat: OiFeat | null }

function oiFeatForBar(barMs: number, feat: Map<number, OiFeat>): OiFeat | null {
	const key = Math.floor(barMs / STEP_MS) * STEP_MS
	const exact = feat.get(key)
	if (exact) return exact
	// ближайший ≤ ключа в пределах 5m
	const prev = feat.get(key - STEP_MS)
	return prev ?? null
}

interface BuildOut { cands: Cand[]; shapesInWindow: number; shapesNoOi: number }
function buildCandidates(bars: Bar[], feat: Map<number, OiFeat>, oiStartMs: number, oiEndMs: number): BuildOut {
	const cands: Cand[] = []
	let shapesInWindow = 0, shapesNoOi = 0
	let armedBuy = true, armedSell = true
	for (let i = 0; i < bars.length; i++) {
		const b = bars[i]!
		const barMs = b.t * 1000
		if (b.c >= b.mean) armedBuy = true
		if (b.c <= b.mean) armedSell = true
		const inWindow = barMs >= oiStartMs && barMs < oiEndMs
		const isShape = b.buy || b.sell
		if (isShape && inWindow) {
			shapesInWindow++
			const f = oiFeatForBar(barMs, feat)
			if (!f) shapesNoOi++
		}
		// касание с rearm
		let side: Side | null = null
		if (armedBuy && b.l <= b.loInner) side = 'buy'
		else if (armedSell && b.h >= b.upInner) side = 'sell'
		if (side == null) continue
		// снимаем взвод стороны (как RE20)
		if (side === 'buy') armedBuy = false; else armedSell = false
		if (!inWindow) continue
		const f = oiFeatForBar(barMs, feat)
		if (!f) continue // noOi — исключаем из популяции
		cands.push({ i, t: b.t, side, isShape: (side === 'buy' ? b.buy : b.sell), hasOi: true, feat: f })
	}
	return { cands, shapesInWindow, shapesNoOi }
}

// ── OI-условия селектора ────────────────────────────────────────────────────────────────────────
type OiMode = 'none' | 'absZ' | 'deltaZ' | 'atTrailExtremum' | 'signedByDir'
interface Cfg { oi: OiMode; thr: number; tol: number }
function passOi(c: Cand, cfg: Cfg): boolean {
	const f = c.feat!
	switch (cfg.oi) {
		case 'none': return true
		case 'absZ': return Number.isFinite(f.oiZ) && Math.abs(f.oiZ) >= cfg.thr
		case 'deltaZ': return Number.isFinite(f.oiDeltaZ) && Math.abs(f.oiDeltaZ) >= cfg.thr
		case 'atTrailExtremum': return f.atTrailHigh || f.atTrailLow
		case 'signedByDir':
			return c.side === 'buy'
				? (f.atTrailLow || (Number.isFinite(f.oiZ) && f.oiZ <= -cfg.thr))
				: (f.atTrailHigh || (Number.isFinite(f.oiZ) && f.oiZ >= cfg.thr))
	}
}
function fires(cands: Cand[], cfg: Cfg): Cand[] { return cands.filter((c) => passOi(c, cfg)) }

// ── матчинг против vendor shapes (greedy, как RE20) ──────────────────────────────────────────────
interface Score { recall: number; precision: number; f1: number; shapes: number; nFires: number; matched: number; density: number }
function score(shapes: Array<{ i: number; side: Side }>, fireList: Cand[], tol: number): Score {
	const used = new Array(fireList.length).fill(false)
	let matched = 0
	for (const sh of shapes) {
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
	const recall = shapes.length ? matched / shapes.length : NaN
	const precision = fireList.length ? matched / fireList.length : NaN
	const f1 = (recall > 0 && precision > 0) ? 2 * recall * precision / (recall + precision) : 0
	return { recall, precision, f1, shapes: shapes.length, nFires: fireList.length, matched, density: shapes.length ? fireList.length / shapes.length : NaN }
}

// ── сетка ──────────────────────────────────────────────────────────────────────────────────────
const OI_MODES: OiMode[] = ['none', 'absZ', 'deltaZ', 'atTrailExtremum', 'signedByDir']
const THRS = [0.5, 1.0, 1.5, 2.0]
const TOLS = [0, 1, 2]
const GATE: Cfg = { oi: 'none', thr: 0, tol: 1 }

function allCfgs(): Cfg[] {
	const out: Cfg[] = []
	for (const oi of OI_MODES) {
		const thrs = (oi === 'none' || oi === 'atTrailExtremum') ? [0] : THRS
		for (const thr of thrs) for (const tol of TOLS) out.push({ oi, thr, tol })
	}
	return out
}
function cfgLabel(c: Cfg): string { return `oi=${c.oi}${(c.oi === 'none' || c.oi === 'atTrailExtremum') ? '' : ',thr' + c.thr},±${c.tol}` }

function shapesInWindowList(bars: Bar[], oiStartMs: number, oiEndMs: number): Array<{ i: number; side: Side }> {
	const out: Array<{ i: number; side: Side }> = []
	for (let i = 0; i < bars.length; i++) {
		const b = bars[i]!, ms = b.t * 1000
		if (ms < oiStartMs || ms >= oiEndMs) continue
		if (b.buy) out.push({ i, side: 'buy' }); else if (b.sell) out.push({ i, side: 'sell' })
	}
	return out
}

function bestOn(shapes: Array<{ i: number; side: Side }>, cands: Cand[], cfgs: Cfg[]): { s: Score; cfg: Cfg } {
	let best: Score | null = null, bestCfg: Cfg = GATE
	for (const cfg of cfgs) {
		const s = score(shapes, fires(cands, cfg), cfg.tol)
		if (s.density <= 8 && (best == null || s.f1 > best.f1)) { best = s; bestCfg = cfg }
	}
	if (best == null) best = score(shapes, fires(cands, GATE), GATE.tol)
	return { s: best, cfg: bestCfg }
}

// ── контраст стрелки vs все касания ──────────────────────────────────────────────────────────────
interface Contrast {
	medZArrows: number; medZTouches: number
	medAbsDeltaArrows: number; medAbsDeltaTouches: number
	trailHighArrows: number; trailHighTouches: number
	trailLowArrows: number; trailLowTouches: number
}
function contrast(cands: Cand[]): Contrast {
	const arrows = cands.filter((c) => c.isShape)
	const zA = arrows.map((c) => c.feat!.oiZ).filter(Number.isFinite)
	const zT = cands.map((c) => c.feat!.oiZ).filter(Number.isFinite)
	const dA = arrows.map((c) => Math.abs(c.feat!.oiDeltaZ)).filter(Number.isFinite)
	const dT = cands.map((c) => Math.abs(c.feat!.oiDeltaZ)).filter(Number.isFinite)
	const frac = (a: Cand[], pred: (c: Cand) => boolean): number => a.length ? a.filter(pred).length / a.length : NaN
	return {
		medZArrows: median(zA), medZTouches: median(zT),
		medAbsDeltaArrows: median(dA), medAbsDeltaTouches: median(dT),
		trailHighArrows: frac(arrows, (c) => c.feat!.atTrailHigh), trailHighTouches: frac(cands, (c) => c.feat!.atTrailHigh),
		trailLowArrows: frac(arrows, (c) => c.feat!.atTrailLow), trailLowTouches: frac(cands, (c) => c.feat!.atTrailLow),
	}
}

// ── тип результата по паре ────────────────────────────────────────────────────────────────────────
interface PairRes {
	arrowFile: string; oiSymbol: string; spot: boolean
	firstBarSec: number; lastBarSec: number; oiStartMs: number; oiEndMs: number; oiPoints: number
	shapesInWindow: number; shapesNoOi: number; nTouches: number
	gate: Score; best: Score; bestCfg: Cfg
	oos: { mode: 'split'; train: Score; oos: Score; cfg: Cfg } | { mode: 'underpowered'; n: number; full: Score; cfg: Cfg }
	contrast: Contrast
	arrowRows: Array<{ tSec: number; side: Side; oiZ: number; oiDeltaZ: number; atTrailHigh: boolean; atTrailLow: boolean }>
}

async function analyzePair(arrowFile: string, oiSymbol: string, serverTimeMs: number): Promise<PairRes | null> {
	const path = `csv/${arrowFile}`
	if (!existsSync(resolve(path))) { console.log(`skip (нет файла): ${arrowFile}`); return null }
	const bars = loadBars(path)
	if (bars.length < 10) { console.log(`skip (мало баров): ${arrowFile}`); return null }
	const firstBarSec = bars[0]!.t, lastBarSec = bars[bars.length - 1]!.t
	const spot = !/\.P,/.test(arrowFile)

	const oiStartMs = Math.max(firstBarSec * 1000, serverTimeMs - AVAIL_MS)
	const oiEndMs = lastBarSec * 1000 + STEP_MS
	if (oiEndMs <= oiStartMs) { console.log(`skip (OI-окно пусто): ${arrowFile}`); return null }

	// сколько стрелок вообще попадает в OI-окно (быстрая проверка ≥1)
	const shapesPre = bars.filter((b) => (b.buy || b.sell) && b.t * 1000 >= oiStartMs && b.t * 1000 < oiEndMs).length
	if (shapesPre < 1) { console.log(`skip (0 стрелок в OI-окне): ${arrowFile}`); return null }

	const points = await loadOi(oiSymbol, oiStartMs, oiEndMs)
	if (!points.length) throw new Error(`RE23: пустой OI-ряд для ${oiSymbol}`)
	const feat = buildOiFeatures(points)

	const { cands, shapesInWindow, shapesNoOi } = buildCandidates(bars, feat, oiStartMs, oiEndMs)
	const shapes = shapesInWindowList(bars, oiStartMs, oiEndMs)

	const gate = score(shapes, fires(cands, GATE), GATE.tol)
	const { s: best, cfg: bestCfg } = bestOn(shapes, cands, allCfgs())

	let oos: PairRes['oos']
	if (shapes.length < 12) {
		const { s: full, cfg } = bestOn(shapes, cands, allCfgs())
		oos = { mode: 'underpowered', n: shapes.length, full, cfg }
	} else {
		const splitT = oiStartMs + (oiEndMs - oiStartMs) * 0.65
		const trShapes = shapes.filter((s) => bars[s.i]!.t * 1000 < splitT)
		const osShapes = shapes.filter((s) => bars[s.i]!.t * 1000 >= splitT)
		const trCands = cands.filter((c) => c.t * 1000 < splitT)
		const osCands = cands.filter((c) => c.t * 1000 >= splitT)
		const { cfg } = bestOn(trShapes, trCands, allCfgs())
		const train = score(trShapes, fires(trCands, cfg), cfg.tol)
		const oosScore = score(osShapes, fires(osCands, cfg), cfg.tol)
		oos = { mode: 'split', train, oos: oosScore, cfg }
	}

	const con = contrast(cands)
	const arrowRows = cands.filter((c) => c.isShape).map((c) => ({ tSec: c.t, side: c.side, oiZ: c.feat!.oiZ, oiDeltaZ: c.feat!.oiDeltaZ, atTrailHigh: c.feat!.atTrailHigh, atTrailLow: c.feat!.atTrailLow }))

	return {
		arrowFile, oiSymbol, spot,
		firstBarSec, lastBarSec, oiStartMs, oiEndMs, oiPoints: points.length,
		shapesInWindow, shapesNoOi, nTouches: cands.length,
		gate, best, bestCfg, oos, contrast: con, arrowRows,
	}
}

// пары (arrowFile, oiSymbol)
const PAIRS: Array<[string, string]> = [
	['BINANCE_ETHUSDT, 1.csv', 'ETHUSDT'],
	['BINANCE_ETHUSDT, 5.csv', 'ETHUSDT'],
	['BINANCE_BNBUSDT.P, 5.csv', 'BNBUSDT'],
	['BINANCE_BNBUSDT.P, 1.csv', 'BNBUSDT'],
	['BINANCE_BNBUSDT, 1.csv', 'BNBUSDT'],
]

async function main(): Promise<void> {
	let serverTimeMs: number
	try {
		serverTimeMs = await serverTime()
		console.log(`serverTime = ${serverTimeMs} (${new Date(serverTimeMs).toISOString()})`)
	} catch (e) {
		console.error(`RE23: нет доступа к сети из tsx, нужен ручной экспорт OI — ${(e as Error).message}`)
		process.exit(1)
		return
	}

	const rows: PairRes[] = []
	for (const [arrowFile, oiSymbol] of PAIRS) {
		console.log(`\n=== ${arrowFile} ↔ ${oiSymbol} ===`)
		let r: PairRes | null
		try {
			r = await analyzePair(arrowFile, oiSymbol, serverTimeMs)
		} catch (e) {
			console.error(`RE23: нет доступа к сети из tsx, нужен ручной экспорт OI — ${(e as Error).message}`)
			process.exit(1)
			return
		}
		if (r == null) continue
		rows.push(r)
		const c = r.contrast
		const oosStr = r.oos.mode === 'underpowered'
			? `underpowered: N=${r.oos.n} (FULL best ${cfgLabel(r.oos.cfg)} r ${pct(r.oos.full.recall)} p ${pct(r.oos.full.precision)} F1 ${r2(r.oos.full.f1)})`
			: `OOS(${cfgLabel(r.oos.cfg)}): r ${pct(r.oos.oos.recall)} p ${pct(r.oos.oos.precision)} F1 ${r2(r.oos.oos.f1)} | train F1 ${r2(r.oos.train.f1)}`
		console.log(`  shapes(в OI-окне)=${r.shapesInWindow} (noOi выпало=${r.shapesNoOi}) | касаний=${r.nTouches}`)
		console.log(`  GATE: recall ${pct(r.gate.recall)} prec ${pct(r.gate.precision)} F1 ${r2(r.gate.f1)} dens ${r2(r.gate.density)}`)
		console.log(`  BEST(${cfgLabel(r.bestCfg)}): recall ${pct(r.best.recall)} prec ${pct(r.best.precision)} F1 ${r2(r.best.f1)} dens ${r2(r.best.density)}`)
		console.log(`  ${oosStr}`)
		console.log(`  КОНТРАСТ стрелки/касания: oiZ med ${r2(c.medZArrows)}/${r2(c.medZTouches)} | |ΔZ| med ${r2(c.medAbsDeltaArrows)}/${r2(c.medAbsDeltaTouches)} | atHigh ${pct(c.trailHighArrows)}/${pct(c.trailHighTouches)} | atLow ${pct(c.trailLowArrows)}/${pct(c.trailLowTouches)}`)
	}

	if (!rows.length) { console.error('RE23: ни одной пары не прошло (нет стрелок в OI-окне или нет файлов).'); process.exit(1); return }

	// ── .md ────────────────────────────────────────────────────────────────────────────────────────
	const md: string[] = []
	md.push('# RE23 — открытый интерес (OI) как селектор стрелки: касание inner + экстремум/всплеск OI vs shapes')
	md.push('')
	md.push('> **Не-OHLCV фид.** OI — метрика Binance USDT-M **перп** (`futures/data/openInterestHist`, period=5m, `sumOpenInterest`). ETH-файлы (`BINANCE_ETHUSDT, *`) — **спотовые**, поэтому применение перп-OI к ним — оговорка (несовпадение инструмента), но тест конкуренции «отделяет ли OI стрелку от прочих касаний» валиден. Линии зоны — **вендорские** (§2.1 «ничего не выдумываем»); OI реальный (сеть), пороги свипаны. **src/core не тронут** — чистый исследовательский раннер поверх CSV + публичного API. OI доступен только за последние ~30 дней, бары вне окна помечены noOi и исключены (в колонке noOi — сколько стрелок из-за этого выпало).')
	md.push('')
	md.push('Селектор `fire` = касание внутр. полосы (rearm как RE20) **И** OI-условие. OI-условия: `none`(=GATE), `absZ≥thr`, `deltaZ≥thr` (всплеск), `atTrailExtremum` (OI на трейлинг-макс/мин), `signedByDir` (buy: trail-min ИЛИ oiZ≤−thr; sell: trail-max ИЛИ oiZ≥+thr). Причинные фичи по прошлым OI-барам (W=L=48≈4ч). Матч greedy (та же сторона, ±tol, один↔один). `density=fires/shape` (≤8 для best). Ранг best по F1. train/OOS 65/35 хронологически; shapes<12 → underpowered.')
	md.push('')
	md.push('| arrowFile | oiSymbol | shapes(OI-окно) | noOi выпало | касаний | GATE r/p/F1 (dens) | BEST cfg | BEST r/p/F1 (dens) | OOS / underpowered |')
	md.push('|---|---|---|---|---|---|---|---|---|')
	for (const r of rows) {
		const oosCell = r.oos.mode === 'underpowered'
			? `underpowered: N=${r.oos.n} (FULL F1 ${r2(r.oos.full.f1)})`
			: `OOS r ${pct(r.oos.oos.recall)}/p ${pct(r.oos.oos.precision)}/F1 ${r2(r.oos.oos.f1)} (train F1 ${r2(r.oos.train.f1)})`
		md.push(`| ${r.arrowFile} | ${r.oiSymbol}${r.spot ? ' (спот↔перп-OI)' : ''} | ${r.shapesInWindow} | ${r.shapesNoOi} | ${r.nTouches} | ${pct(r.gate.recall)}/${pct(r.gate.precision)}/${r2(r.gate.f1)} (${r2(r.gate.density)}) | ${cfgLabel(r.bestCfg)} | ${pct(r.best.recall)}/${pct(r.best.precision)}/${r2(r.best.f1)} (${r2(r.best.density)}) | ${oosCell} |`)
	}
	md.push('')
	md.push('### Контраст: бары-стрелки vs все касания-кандидаты (OI-фичи)')
	md.push('')
	md.push('| arrowFile | oiZ med (стрелки/касания) | \\|ΔZ\\| med (стрелки/касания) | atTrailHigh (стрелки/касания) | atTrailLow (стрелки/касания) |')
	md.push('|---|---|---|---|---|')
	for (const r of rows) {
		const c = r.contrast
		md.push(`| ${r.arrowFile} | ${r2(c.medZArrows)} / ${r2(c.medZTouches)} | ${r2(c.medAbsDeltaArrows)} / ${r2(c.medAbsDeltaTouches)} | ${pct(c.trailHighArrows)} / ${pct(c.trailHighTouches)} | ${pct(c.trailLowArrows)} / ${pct(c.trailLowTouches)} |`)
	}
	md.push('')
	md.push('## Как читать')
	md.push('- **BEST F1 ≫ GATE F1 при живом recall (и на OOS, не только train)** ⇒ экстремум/всплеск OI добавляет precision сверх простого касания — гипотеза RE23 подтверждается.')
	md.push('- **BEST F1 ≈ GATE F1** (и/или best cfg сводится к `none`) ⇒ OI НИЧЕГО не добавляет сверх касания.')
	md.push('- **Контраст: у стрелок oiZ/\\|ΔZ\\|/доли atHigh/atLow ≈ как у всех касаний** ⇒ OI не разделяет стрелку от прочих касаний (доп. подтверждение отсутствия сигнала), даже если best cfg случайно набрал F1 на train.')
	md.push('- **OOS F1 ≪ train F1** ⇒ best cfg — переобучение in-sample; смотреть на OOS/underpowered.')
	md.push('- **underpowered** = shapes-в-OI-окне < 12: делить train/OOS нет смысла — честный лимит данных (OI только ~30д).')
	md.push('')
	md.push('## Сравнение с RE20 / RE21 / RE22')
	md.push('- **RE20-gate** (касание+объём+rearm): best F1 ~0.14–0.20, precision 1–18%.')
	md.push('- **RE21** (F&G-экстремум среди касаний): F1 ~0.12–0.16, лифта над gate нет.')
	md.push('- **RE22** (интрабар-последовательность): лифта над gate нет (OOS схлопывается).')
	md.push('- **RE23** (эта работа, OI-экстремум/всплеск среди касаний): вывод — добавляет ли OI precision сверх RE20-гейта — в строке-вердикте консоли и в колонках GATE vs BEST/OOS + контрасте выше.')

	if (!existsSync(resolve('ci-results'))) mkdirSync(resolve('ci-results'), { recursive: true })
	writeFileSync(resolve('ci-results/re23-oi-selector-fit.md'), md.join('\n'))

	// ── .json ────────────────────────────────────────────────────────────────────────────────────
	const json = {
		generatedAt: new Date().toISOString(),
		oiSource: { endpoint: OI_ENDPOINT, period: '5m', field: 'sumOpenInterest', availabilityDays: 30, serverTimeMs, note: 'Binance USDT-M perp OI; ETH arrow files are spot (caveat)' },
		grid: { oiModes: OI_MODES, thrs: THRS, tols: TOLS, W, L, trainOosSplit: 0.65 },
		pairs: rows.map((r) => ({
			arrowFile: r.arrowFile, oiSymbol: r.oiSymbol, spot: r.spot,
			window: { firstBarSec: r.firstBarSec, lastBarSec: r.lastBarSec, oiStartMs: r.oiStartMs, oiEndMs: r.oiEndMs, oiPoints: r.oiPoints },
			shapesInWindow: r.shapesInWindow, shapesNoOi: r.shapesNoOi, nTouches: r.nTouches,
			gate: r.gate, best: r.best, bestCfg: r.bestCfg,
			oos: r.oos, contrast: r.contrast,
			arrows: r.arrowRows,
		})),
	}
	writeFileSync(resolve('ci-results/re23-oi-selector-fit.json'), JSON.stringify(json, null, 2))
	console.log('\nЗаписано: ci-results/re23-oi-selector-fit.{md,json}')
}

main().catch((e) => { console.error(`RE23: непредвиденная ошибка — ${(e as Error).message}`); process.exit(1) })
