/**
 * RE7 — многокомпонентный «упрощённый Fear&Greed» осциллятор поверх вендорской зоны,
 * фит к CSV-shapes вендора (закрытые бары, детерминированный таргет, НЕ telegram).
 *
 * Цель: проверить, воспроизводит ли 6-компонентный F&G-осциллятор вендорские стрелки (Shapes)
 * ЛУЧШЕ текущего OWN2-триггера (detectArrowSignalCandidates, relVol 1.4).
 *
 * §2.1/§2.3: движок src/core НЕ трогается; формулы (rsi, стохастик, rollingZ, ema, детект-стейт-машина,
 * коэффициенты масштабирования) переиспользованы 1:1 из searchReversalFearGreedV5.ts и
 * searchReversalVolumeFearGreedV6.ts. Ничего нового не изобретается.
 *
 * Данные (таргет): вендорские CSV в csv/ (парсер parseExactIndicatorCsv, объём инлайн, ground-truth exactEvents).
 * Сплит: chronologicalSlices (fit 0-50%, validation 50-75%, sealed 75-100%). FIT/селекция — только dev
 * (btc-5m, btc-15m). Победитель отчитывается на sealed-test (dev) + все OOS целиком.
 * Матчер: matchDirectionalEvents, основной допуск ±1 бар, дополнительно exact 0.
 *
 * Запуск: npx tsx ci/research/runRE7CompositeFearGreedCsvFit.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { detectArrowSignalCandidates } from '../../src/core/signals/ArrowSignalEngine.js'
import { parseExactIndicatorCsv, exactEvents, type ExactDirection, type ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import { matchDirectionalEvents, type EventMetrics, type TimedDirectionalEvent } from './lib/eventMetrics.js'

// ---------------------------------------------------------------------------
// Датасеты (роли задают участие в FIT/селекции vs OOS)
// ---------------------------------------------------------------------------
type Role = 'development' | 'oos-asset' | 'oos-timeframe' | 'oos-asset-tf'
interface DatasetSpec { id: string; file: string; timeframeMs: number; role: Role }

const DATASETS: DatasetSpec[] = [
	{ id: 'btc-5m', file: 'csv/BINANCE_BTCUSDT.P, 5.csv', timeframeMs: 300000, role: 'development' },
	{ id: 'btc-15m', file: 'csv/BINANCE_BTCUSDT.P, 15.csv', timeframeMs: 900000, role: 'development' },
	{ id: 'bnb-5m', file: 'csv/BINANCE_BNBUSDT.P, 5.csv', timeframeMs: 300000, role: 'oos-asset' },
	{ id: 'virtual-5m', file: 'csv/BINANCE_VIRTUALUSDT.P, 5.csv', timeframeMs: 300000, role: 'oos-asset' },
	{ id: 'btc-60m', file: 'csv/BINANCE_BTCUSDT.P, 60.csv', timeframeMs: 3600000, role: 'oos-timeframe' },
	{ id: 'bnb-1m', file: 'csv/BINANCE_BNBUSDT.P, 1.csv', timeframeMs: 60000, role: 'oos-asset-tf' },
]

interface Dataset {
	id: string
	timeframeMs: number
	role: Role
	rows: ExactIndicatorRow[]
	// аномалии данных
	zeroVolumeBars: number
	gaps: number
}

// chronologicalSlices эквивалент (fit 0-50%, validation 50-75%, sealed 75-100%) — как в config/reversalDatasets.ts
type Part = 'fit' | 'validation' | 'sealed-test'
function sliceBounds(d: Dataset, part: Part): { lo: number; hi: number } {
	const n = d.rows.length
	const fitEnd = Math.floor(n * 0.5)
	const validationEnd = Math.floor(n * 0.75)
	let fromIndex = 0, toIndexExclusive = n
	if (part === 'fit') { fromIndex = 0; toIndexExclusive = fitEnd }
	else if (part === 'validation') { fromIndex = fitEnd; toIndexExclusive = validationEnd }
	else { fromIndex = validationEnd; toIndexExclusive = n }
	const lo = d.rows[fromIndex]!.timestamp
	const hi = toIndexExclusive < n ? d.rows[toIndexExclusive]!.timestamp : Infinity
	return { lo, hi }
}

// ---------------------------------------------------------------------------
// Индикаторы (verbatim из v5/v6 — те же формулы и коэффициенты масштабирования)
// ---------------------------------------------------------------------------
// rollingZ: v5/v6 — окно n, clip[-4,4]
function rollingZ(v: number[], n: number): number[] {
	return v.map((x, i) => {
		if (i < n) return NaN
		const a = v.slice(i - n, i)
		const m = a.reduce((s, q) => s + q, 0) / a.length
		const sd = Math.sqrt(a.reduce((s, q) => s + (q - m) ** 2, 0) / a.length)
		return sd ? Math.max(-4, Math.min(4, (x - m) / sd)) : 0
	})
}
// rsi: v5/v6 — простой (не Wilder), окно n, 0..100
function rsi(v: number[], n: number): number[] {
	return v.map((_, i) => {
		if (i < n) return NaN
		let u = 0, d = 0
		for (let j = i - n + 1; j <= i; j++) { const x = v[j]! - v[j - 1]!; u += Math.max(0, x); d += Math.max(0, -x) }
		return d === 0 ? 100 : 100 - 100 / (1 + u / d)
	})
}
// стохастик-позиция: v5 st() — окно n, 0..100
function stoch(rows: ExactIndicatorRow[], n: number): number[] {
	return rows.map((x, i) => {
		if (i < n - 1) return NaN
		const a = rows.slice(i - n + 1, i + 1)
		const lo = Math.min(...a.map((q) => q.low))
		const hi = Math.max(...a.map((q) => q.high))
		return 100 * (x.close - lo) / Math.max(1e-12, hi - lo)
	})
}
// ema: v5/v6 — сглаживание, пропускает NaN
function ema(v: number[], n: number): number[] {
	const a = 2 / (n + 1)
	const o = new Array<number>(v.length).fill(NaN)
	let x = NaN
	for (let i = 0; i < v.length; i++) {
		if (!Number.isFinite(v[i])) continue
		x = Number.isFinite(x) ? a * v[i]! + (1 - a) * x : v[i]!
		o[i] = x
	}
	return o
}

// ---------------------------------------------------------------------------
// F&G score — 6 взвешенных причинных компонентов.
// Коэффициенты масштабирования скопированы из v5/v6:
//   momentum:   z(roc,50), clip[-4,4] уже в rollingZ, затем 6.25*z clip[-25,25]  (v6)
//   volatility: z(range,50)*sign(close-open), 6.25*z clip[-25,25]                 (v6)
//   volume:     z(log(vol/SMA20),50)*sign, 6.25*z clip[-25,25]                    (v6)
//   dist:       (close-mean)/half clip[-2,2], apex=12.5*dist                      (v6)
//   rsi/stoch:  центрируются -50, масштаб 0.8 в v5-стиле взвеш.суммы             (v5)
// Итог: центр 50, взвешенная сумма/сумму весов, затем EMA(smooth).
// Семьи весов (staged): [rsi+stoch], [momentum], [vol+volatility(range)], [dist] ∈ {0,1,2}.
// ---------------------------------------------------------------------------
interface Weights { osc: number; mom: number; volrange: number; dist: number }
interface Config {
	weights: Weights
	smooth: number
	arm: number
	release: number
	cooldown: number
	memory: number
	directional: boolean
}

interface Components {
	rsi: number      // -50..50
	stoch: number    // -50..50
	momentum: number // -25..25
	volatility: number // -25..25 (знаковая)
	volume: number   // -25..25 (знаковый)
	apex: number     // -25..25 (позиция в зоне)
}

function components(d: Dataset): Components[] {
	const rows = d.rows
	const close = rows.map((x) => x.close)
	const rr = rsi(close, 14)
	const ss = stoch(rows, 14)
	const roc = close.map((x, i) => (i < 12 ? NaN : 100 * (x / close[i - 12]! - 1)))
	const mz = rollingZ(roc, 50)
	const ranges = rows.map((x) => (x.high - x.low) / Math.max(1e-12, x.close))
	const rz = rollingZ(ranges, 50)
	// rel: log(volume / SMA20(volume)) — как в v6 (rel в v6)
	const rel = rows.map((x, i) => {
		if (i < 20) return NaN
		const a = rows.slice(i - 20, i)
		const m = a.reduce((s, q) => s + q.volume, 0) / 20
		return m > 0 && x.volume > 0 ? Math.log(x.volume / m) : 0
	})
	const vz = rollingZ(rel, 50)
	return rows.map((x, i) => {
		const half = Math.max(1e-12, (x.upperInner - x.lowerInner) / 2)
		const dist = Math.max(-2, Math.min(2, (x.close - x.mean) / half))
		const sign = x.close > x.open ? 1 : x.close < x.open ? -1 : 0
		return {
			rsi: Number.isFinite(rr[i]) ? rr[i]! - 50 : NaN,
			stoch: Number.isFinite(ss[i]) ? ss[i]! - 50 : NaN,
			momentum: Number.isFinite(mz[i]) ? Math.max(-25, Math.min(25, 6.25 * mz[i]!)) : NaN,
			volatility: Number.isFinite(rz[i]) ? Math.max(-25, Math.min(25, 6.25 * rz[i]! * sign)) : NaN,
			volume: Number.isFinite(vz[i]) ? Math.max(-25, Math.min(25, 6.25 * vz[i]! * sign)) : NaN,
			apex: 12.5 * dist,
		}
	})
}

// score 0..100, 50 нейтраль; НИЗКО=страх(LONG), ВЫСОКО=жадность(SHORT)
function scoreSeries(cp: Components[], c: Config): number[] {
	const w = c.weights
	const raw = cp.map((x) => {
		// osc-семья: RSI+Stoch (v5-стиль, центр -50, масштаб 0.8)
		const oscTerm = w.osc * ((Number.isFinite(x.rsi) ? x.rsi : 0) + (Number.isFinite(x.stoch) ? x.stoch : 0)) / 2
		const momTerm = w.mom * (Number.isFinite(x.momentum) ? x.momentum : 0)
		const vrTerm = w.volrange * (((Number.isFinite(x.volume) ? x.volume : 0) + (Number.isFinite(x.volatility) ? x.volatility : 0)) / 2)
		const distTerm = w.dist * x.apex
		const sum = Math.max(1, w.osc + w.mom + w.volrange + w.dist)
		return Math.max(0, Math.min(100, 50 + (oscTerm + momTerm + vrTerm + distTerm) / sum))
	})
	return ema(raw, c.smooth)
}

// Детектор — как v6 detectFromScore.
// НИЗКО=страх=LONG, ВЫСОКО=жадность=SHORT. Взвод стороны когда её экстремум за arm;
// сигнал на кросс-обратно через release; направленная свеча; кулдаун; inner-memory.
function detectFromScore(d: Dataset, c: Config, s: number[]): TimedDirectionalEvent[] {
	const out: TimedDirectionalEvent[] = []
	const lastInner: Record<ExactDirection, number | null> = { long: null, short: null }
	const armed: Record<ExactDirection, boolean> = { long: false, short: false }
	let last = -Infinity
	for (let i = 1; i < d.rows.length; i++) {
		const x = d.rows[i]!
		if (x.low <= x.lowerInner) lastInner.long = i
		if (x.high >= x.upperInner) lastInner.short = i
		// v: насколько далеко в сторону экстремума (long: 50-score растёт при страхе; short: score-50)
		for (const side of ['long', 'short'] as const) {
			const v = side === 'long' ? 50 - s[i]! : s[i]! - 50
			if (Number.isFinite(v) && v >= c.arm) armed[side] = true
		}
		if (i - last < c.cooldown) continue
		for (const side of ['long', 'short'] as const) {
			const v = side === 'long' ? 50 - s[i]! : s[i]! - 50
			const p = side === 'long' ? 50 - s[i - 1]! : s[i - 1]! - 50
			const memory = lastInner[side] != null && i - lastInner[side]! <= c.memory
			const cross = p > c.release && v <= c.release
			const directional = side === 'long' ? x.close > x.open : x.close < x.open
			if (armed[side] && memory && cross && Number.isFinite(v) && Number.isFinite(p) && (!c.directional || directional)) {
				out.push({ at: x.timestamp, direction: side })
				last = i
				armed[side] = false
				break
			}
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// Метрики
// ---------------------------------------------------------------------------
type S = Omit<EventMetrics, 'matches'>
interface X { datasetId: string; metrics: S }
function strip(x: EventMetrics): S { const { matches: _m, ...s } = x; return s }
function agg(xs: X[]): S {
	const tp = xs.reduce((s, x) => s + x.metrics.tp, 0)
	const fp = xs.reduce((s, x) => s + x.metrics.fp, 0)
	const fn = xs.reduce((s, x) => s + x.metrics.fn, 0)
	return { tp, fp, fn, precision: tp / Math.max(1, tp + fp), recall: tp / Math.max(1, tp + fn), f1: 2 * tp / Math.max(1, 2 * tp + fp + fn), predictions: tp + fp, truth: tp + fn }
}
function windowFilter<T extends { at: number }>(v: T[], lo: number, hi: number): T[] { return v.filter((x) => x.at >= lo && x.at < hi) }

// объективная функция — как v6 obj
function obj(x: S): number {
	if (x.predictions === 0) return -10
	const q = x.predictions / Math.max(1, x.truth)
	const recallPenalty = x.recall < 0.15 ? (0.15 - x.recall) : 0
	return x.f1 + 0.4 * x.precision + 0.15 * x.recall - 0.04 * Math.abs(Math.log(Math.max(1e-6, q))) - recallPenalty
}

// ---------------------------------------------------------------------------
// score cache (по семье весов + smooth) — как cachedScore в v5/v6
// ---------------------------------------------------------------------------
const compCache = new Map<string, Components[]>()
function cachedComponents(d: Dataset): Components[] {
	let cp = compCache.get(d.id)
	if (!cp) { cp = components(d); compCache.set(d.id, cp) }
	return cp
}
const scoreCache = new Map<string, number[]>()
function cachedScore(d: Dataset, c: Config): number[] {
	const k = `${d.id}|${c.weights.osc}-${c.weights.mom}-${c.weights.volrange}-${c.weights.dist}|${c.smooth}`
	let s = scoreCache.get(k)
	if (!s) { s = scoreSeries(cachedComponents(d), c); scoreCache.set(k, s) }
	return s
}

function evalFG(ds: Dataset[], c: Config, part: Part | 'all', tolerance: number): X[] {
	return ds.map((d) => {
		const t = exactEvents(d.rows)
		const p = detectFromScore(d, c, cachedScore(d, c))
		let lo = -Infinity, hi = Infinity
		if (part !== 'all') { const b = sliceBounds(d, part); lo = b.lo; hi = b.hi }
		return { datasetId: d.id, metrics: strip(matchDirectionalEvents(windowFilter(t, lo, hi), windowFilter(p, lo, hi), d.timeframeMs, tolerance)) }
	})
}

// ---------------------------------------------------------------------------
// OWN2 baseline — detectArrowSignalCandidates(candles, APEX_PARAMS, {minimumRelativeVolume:1.4})
// как в runE5FearGreedArrowFit.ts / runRE3VendorZoneFit.ts
// ---------------------------------------------------------------------------
const own2Cache = new Map<string, TimedDirectionalEvent[]>()
function own2Predictions(d: Dataset): TimedDirectionalEvent[] {
	let p = own2Cache.get(d.id)
	if (!p) {
		const candles: Candle[] = d.rows.map((r) => ({ timestamp: r.timestamp, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }))
		const cand = detectArrowSignalCandidates(candles, APEX_PARAMS, { minimumRelativeVolume: 1.4 }).candidates
		p = cand.map((c) => ({ at: c.signalAt, direction: c.side as ExactDirection }))
		own2Cache.set(d.id, p)
	}
	return p
}
function evalOwn2(ds: Dataset[], part: Part | 'all', tolerance: number): X[] {
	return ds.map((d) => {
		const t = exactEvents(d.rows)
		const p = own2Predictions(d)
		let lo = -Infinity, hi = Infinity
		if (part !== 'all') { const b = sliceBounds(d, part); lo = b.lo; hi = b.hi }
		return { datasetId: d.id, metrics: strip(matchDirectionalEvents(windowFilter(t, lo, hi), windowFilter(p, lo, hi), d.timeframeMs, tolerance)) }
	})
}

// ---------------------------------------------------------------------------
// GRID (staged, как v6)
// ---------------------------------------------------------------------------
function fullGrid(): Config[] {
	const z: Config[] = []
	for (const osc of [0, 1, 2]) for (const mom of [0, 1, 2]) for (const volrange of [0, 1, 2]) for (const dist of [0, 1, 2]) {
		if (osc + mom + volrange + dist === 0) continue
		for (const smooth of [3, 5, 8, 13]) for (const arm of [15, 20, 25, 30]) for (const release of [5, 10, 15, 20]) for (const cooldown of [12, 20, 32]) for (const memory of [96, 128, 192, 256]) {
			z.push({ weights: { osc, mom, volrange, dist }, smooth, arm, release, cooldown, memory, directional: true })
		}
	}
	// пара пресетов из v5/v6 (баланс osc + apex, без volume)
	z.push({ weights: { osc: 1, mom: 1, volrange: 0, dist: 1 }, smooth: 5, arm: 20, release: 10, cooldown: 20, memory: 192, directional: true })
	z.push({ weights: { osc: 1, mom: 1, volrange: 1, dist: 1 }, smooth: 5, arm: 20, release: 10, cooldown: 20, memory: 192, directional: true })
	return z
}

// ---------------------------------------------------------------------------
// вывод
// ---------------------------------------------------------------------------
const pct = (x: number): string => (Number.isFinite(x) ? `${(100 * x).toFixed(2)}%` : 'n/a')
const ratio = (x: S): string => (x.truth ? (x.predictions / x.truth).toFixed(2) : 'n/a')

function tableRows(xs: X[]): string {
	return xs.map((x) => `| ${x.datasetId} | ${x.metrics.tp} | ${x.metrics.fp} | ${x.metrics.fn} | ${pct(x.metrics.precision)} | ${pct(x.metrics.recall)} | ${x.metrics.predictions} | ${ratio(x.metrics)} |`).join('\n')
}

function loadDataset(spec: DatasetSpec): Dataset {
	const txt = readFileSync(resolve(spec.file), 'utf8')
	const rows = parseExactIndicatorCsv(txt, { expectedTimeframeMs: spec.timeframeMs, allowIrregularBars: true, allowInvalidBandOrder: true })
	let zeroVolumeBars = 0
	let gaps = 0
	for (let i = 0; i < rows.length; i++) {
		if (!(rows[i]!.volume > 0)) zeroVolumeBars++
		if (i > 0 && rows[i]!.timestamp - rows[i - 1]!.timestamp !== spec.timeframeMs) gaps++
	}
	return { id: spec.id, timeframeMs: spec.timeframeMs, role: spec.role, rows, zeroVolumeBars, gaps }
}

function main(): void {
	// --- загрузка ---
	const datasets: Dataset[] = []
	const anomalies: string[] = []
	for (const spec of DATASETS) {
		try {
			const d = loadDataset(spec)
			datasets.push(d)
			const buys = d.rows.filter((r) => r.buy).length
			const sells = d.rows.filter((r) => r.sell).length
			if (d.zeroVolumeBars > 0) anomalies.push(`${d.id}: zero-volume bars ${d.zeroVolumeBars}/${d.rows.length}`)
			if (d.gaps > 0) anomalies.push(`${d.id}: irregular/gap bars ${d.gaps}`)
			console.log(`loaded ${d.id}: rows=${d.rows.length} buys=${buys} sells=${sells} zeroVol=${d.zeroVolumeBars} gaps=${d.gaps} role=${d.role}`)
		} catch (e) {
			const msg = `${spec.id}: PARSER FAILED — ${(e as Error).message}`
			anomalies.push(msg)
			console.error(msg)
		}
	}
	if (!datasets.length) throw new Error('Ни один CSV не загрузился — проверь папку csv/.')

	const dev = datasets.filter((d) => d.role === 'development')
	const oos = datasets.filter((d) => d.role !== 'development')
	if (!dev.length) throw new Error('Нет development-датасетов (btc-5m/btc-15m).')

	const grid = fullGrid()
	console.log(`RE7 grid size = ${grid.length}`)

	// --- STAGE 1: семьи компонентов (фиксированные score/state параметры) ---
	const familyKeys = new Set<string>()
	for (const c of grid) familyKeys.add(`${c.weights.osc}-${c.weights.mom}-${c.weights.volrange}-${c.weights.dist}`)
	const stage1 = [...familyKeys].map((key) => {
		const [osc, mom, volrange, dist] = key.split('-').map(Number)
		const config: Config = { weights: { osc: osc!, mom: mom!, volrange: volrange!, dist: dist! }, smooth: 5, arm: 20, release: 10, cooldown: 20, memory: 192, directional: true }
		const s = evalFG(dev, config, 'fit', 1)
		const a = agg(s)
		return { config, fitAggregate: a, objective: obj(a) }
	}).sort((a, b) => b.objective - a.objective).slice(0, 10)
	const topFamilies = new Set(stage1.map((x) => `${x.config.weights.osc}-${x.config.weights.mom}-${x.config.weights.volrange}-${x.config.weights.dist}`))
	console.log(`stage1: ${familyKeys.size} families -> top ${topFamilies.size}`)

	// --- STAGE 2: score-параметры (smooth/arm/release) на top-семьях, фикс state ---
	const stage2Grid = grid.filter((c) => topFamilies.has(`${c.weights.osc}-${c.weights.mom}-${c.weights.volrange}-${c.weights.dist}`) && c.cooldown === 20 && c.memory === 192)
	const stage2 = stage2Grid.map((config) => {
		const s = evalFG(dev, config, 'fit', 1)
		const a = agg(s)
		return { config, fitAggregate: a, objective: obj(a) }
	}).sort((a, b) => b.objective - a.objective).slice(0, 20)
	const scoreKeys = new Set(stage2.map((x) => `${x.config.weights.osc}-${x.config.weights.mom}-${x.config.weights.volrange}-${x.config.weights.dist}|${x.config.smooth}|${x.config.arm}|${x.config.release}`))
	console.log(`stage2: ${stage2Grid.length} candidates -> top ${scoreKeys.size} score-configs`)

	// --- STAGE 3: state-параметры (cooldown/memory) для отобранных score-конфигов ---
	const stage3Grid = grid.filter((c) => scoreKeys.has(`${c.weights.osc}-${c.weights.mom}-${c.weights.volrange}-${c.weights.dist}|${c.smooth}|${c.arm}|${c.release}`))
	interface FitR { config: Config; fit: X[]; fitAggregate: S; objective: number; validation?: X[]; validationAggregate?: S }
	const fit: FitR[] = stage3Grid.map((config) => {
		const s = evalFG(dev, config, 'fit', 1)
		const a = agg(s)
		return { config, fit: s, fitAggregate: a, objective: obj(a) }
	}).sort((a, b) => b.objective - a.objective)
	console.log(`stage3: ${stage3Grid.length} state-configs evaluated on fit`)

	// --- VALIDATION: top на dev/validation ---
	const val = fit.slice(0, 100).map((x) => {
		const s = evalFG(dev, x.config, 'validation', 1)
		const a = agg(s)
		return { ...x, validation: s, validationAggregate: a, objective: obj(a) }
	}).sort((a, b) => b.objective - a.objective)
	const winner = val[0]!
	console.log(`winner selected on validation; obj=${winner.objective.toFixed(4)}`)

	// --- ПОБЕДИТЕЛЬ: sealed (dev) + OOS целиком, tolerance 0 и 1 ---
	const fgSealed1 = evalFG(dev, winner.config, 'sealed-test', 1)
	const fgSealed0 = evalFG(dev, winner.config, 'sealed-test', 0)
	const fgOos1 = evalFG(oos, winner.config, 'all', 1)
	const fgOos0 = evalFG(oos, winner.config, 'all', 0)
	const fgFit1 = evalFG(dev, winner.config, 'fit', 1)
	const fgVal1 = evalFG(dev, winner.config, 'validation', 1)

	// OWN2 baseline на тех же сплитах, tolerance 0 и 1
	const own2Fit1 = evalOwn2(dev, 'fit', 1)
	const own2Val1 = evalOwn2(dev, 'validation', 1)
	const own2Sealed1 = evalOwn2(dev, 'sealed-test', 1)
	const own2Sealed0 = evalOwn2(dev, 'sealed-test', 0)
	const own2Oos1 = evalOwn2(oos, 'all', 1)
	const own2Oos0 = evalOwn2(oos, 'all', 0)

	const fgFitAgg = agg(fgFit1), fgValAgg = agg(fgVal1), fgSealedAgg1 = agg(fgSealed1), fgSealedAgg0 = agg(fgSealed0), fgOosAgg1 = agg(fgOos1), fgOosAgg0 = agg(fgOos0)
	const own2FitAgg = agg(own2Fit1), own2ValAgg = agg(own2Val1), own2SealedAgg1 = agg(own2Sealed1), own2SealedAgg0 = agg(own2Sealed0), own2OosAgg1 = agg(own2Oos1), own2OosAgg0 = agg(own2Oos0)

	// --- вердикт: бьёт ли F&G OWN2 на OOS (±1 бар, по F1 и recall) ---
	const beatsRecall = fgOosAgg1.recall > own2OosAgg1.recall
	const beatsF1 = fgOosAgg1.f1 > own2OosAgg1.f1
	const verdict = (beatsRecall && beatsF1)
		? 'F&G БЬЁТ OWN2 на OOS (и recall, и F1 выше)'
		: (beatsRecall || beatsF1)
			? `F&G ЧАСТИЧНО бьёт OWN2 на OOS (recall ${beatsRecall ? '>' : '≤'}, F1 ${beatsF1 ? '>' : '≤'})`
			: 'F&G НЕ бьёт OWN2 на OOS'

	// --- JSON ---
	const report = {
		generatedAt: new Date().toISOString(),
		corpus: 'csv/ BINANCE (vendor zone+shapes+volume inline)',
		datasets: datasets.map((d) => ({ id: d.id, role: d.role, timeframeMs: d.timeframeMs, rows: d.rows.length, buys: d.rows.filter((r) => r.buy).length, sells: d.rows.filter((r) => r.sell).length, zeroVolumeBars: d.zeroVolumeBars, gaps: d.gaps })),
		gridSize: grid.length,
		stages: { families: familyKeys.size, topFamilies: topFamilies.size, stage2Candidates: stage2Grid.length, scoreConfigs: scoreKeys.size, stage3Configs: stage3Grid.length },
		anomalies,
		own2: {
			fit: { slices: own2Fit1, aggregate: own2FitAgg },
			validation: { slices: own2Val1, aggregate: own2ValAgg },
			sealed: { tolerance1: { slices: own2Sealed1, aggregate: own2SealedAgg1 }, tolerance0: { slices: own2Sealed0, aggregate: own2SealedAgg0 } },
			oos: { tolerance1: { slices: own2Oos1, aggregate: own2OosAgg1 }, tolerance0: { slices: own2Oos0, aggregate: own2OosAgg0 } },
		},
		winnerConfig: winner.config,
		fg: {
			fit: { slices: fgFit1, aggregate: fgFitAgg },
			validation: { slices: fgVal1, aggregate: fgValAgg },
			sealed: { tolerance1: { slices: fgSealed1, aggregate: fgSealedAgg1 }, tolerance0: { slices: fgSealed0, aggregate: fgSealedAgg0 } },
			oos: { tolerance1: { slices: fgOos1, aggregate: fgOosAgg1 }, tolerance0: { slices: fgOos0, aggregate: fgOosAgg0 } },
		},
		verdict,
		topN: val.slice(0, 15).map((x) => ({ config: x.config, validationAggregate: x.validationAggregate, objective: x.objective })),
	}

	// --- MD ---
	const md: string[] = []
	md.push('# RE7 — многокомпонентный Fear&Greed осциллятор vs OWN2 (фит к CSV-shapes вендора)')
	md.push('')
	md.push('6 причинных компонентов: (1) RSI(14), (2) стохастик-позиция(14), (3) моментум ROC(12) z(50), (4) волатильность range z(50) знаковая, (5) объём log(vol/SMA20) z(50) знаковый, (6) позиция-в-зоне (close-mean)/half. Score 0..100, 50 нейтраль; НИЗКО=страх(LONG), ВЫСОКО=жадность(SHORT); EMA-сглаживание. Формулы/масштабы — из searchReversalFearGreedV5/V6, движок src/core не тронут.')
	md.push('')
	md.push('Таргет: вендорские Shapes из `csv/` (закрытые бары, детерминированный, НЕ telegram). Матч: `matchDirectionalEvents`, основной допуск **±1 бар** (доп. exact 0), та же сторона. FIT/селекция — только development (btc-5m, btc-15m); победитель отчитан на sealed-test (dev) и на всех OOS целиком.')
	md.push('')
	md.push(`Grid size: **${grid.length}** (staged: ${familyKeys.size} семей → top ${topFamilies.size} → ${scoreKeys.size} score-конфигов → ${stage3Grid.length} state-конфигов → top100 validation).`)
	md.push('')
	md.push('## OWN2 (relVol 1.4) vs лучший F&G — агрегаты, ±1 бар')
	md.push('')
	md.push('| split | OWN2 precision | OWN2 recall | OWN2 F1 | F&G precision | F&G recall | F&G F1 |')
	md.push('|---|---:|---:|---:|---:|---:|---:|')
	md.push(`| fit (dev) | ${pct(own2FitAgg.precision)} | ${pct(own2FitAgg.recall)} | ${pct(own2FitAgg.f1)} | ${pct(fgFitAgg.precision)} | ${pct(fgFitAgg.recall)} | ${pct(fgFitAgg.f1)} |`)
	md.push(`| validation (dev) | ${pct(own2ValAgg.precision)} | ${pct(own2ValAgg.recall)} | ${pct(own2ValAgg.f1)} | ${pct(fgValAgg.precision)} | ${pct(fgValAgg.recall)} | ${pct(fgValAgg.f1)} |`)
	md.push(`| sealed (dev) | ${pct(own2SealedAgg1.precision)} | ${pct(own2SealedAgg1.recall)} | ${pct(own2SealedAgg1.f1)} | ${pct(fgSealedAgg1.precision)} | ${pct(fgSealedAgg1.recall)} | ${pct(fgSealedAgg1.f1)} |`)
	md.push(`| **OOS (все)** | **${pct(own2OosAgg1.precision)}** | **${pct(own2OosAgg1.recall)}** | **${pct(own2OosAgg1.f1)}** | **${pct(fgOosAgg1.precision)}** | **${pct(fgOosAgg1.recall)}** | **${pct(fgOosAgg1.f1)}** |`)
	md.push('')
	md.push(`Exact (±0 бар) на OOS: OWN2 ${pct(own2OosAgg0.precision)}/${pct(own2OosAgg0.recall)} — F&G ${pct(fgOosAgg0.precision)}/${pct(fgOosAgg0.recall)}.`)
	md.push('')
	md.push('## По датасетам (±1 бар)')
	md.push('')
	md.push('### F&G — sealed (dev) + OOS')
	md.push('| dataset | TP | FP | FN | precision | recall | pred | ratio |')
	md.push('|---|---:|---:|---:|---:|---:|---:|---:|')
	md.push(tableRows([...fgSealed1, ...fgOos1]))
	md.push('')
	md.push('### OWN2 — sealed (dev) + OOS')
	md.push('| dataset | TP | FP | FN | precision | recall | pred | ratio |')
	md.push('|---|---:|---:|---:|---:|---:|---:|---:|')
	md.push(tableRows([...own2Sealed1, ...own2Oos1]))
	md.push('')
	md.push('## Победивший F&G-конфиг')
	md.push('')
	md.push('```json')
	md.push(JSON.stringify(winner.config, null, 2))
	md.push('```')
	md.push('')
	if (anomalies.length) {
		md.push('## Аномалии данных')
		md.push('')
		for (const a of anomalies) md.push(`- ${a}`)
		md.push('')
	}
	md.push('## Вердикт')
	md.push('')
	md.push(`**${verdict}** (OOS ±1 бар: recall F&G ${pct(fgOosAgg1.recall)} vs OWN2 ${pct(own2OosAgg1.recall)}; F1 F&G ${pct(fgOosAgg1.f1)} vs OWN2 ${pct(own2OosAgg1.f1)}).`)
	md.push('')

	mkdirSync(resolve('ci-results'), { recursive: true })
	writeFileSync(resolve('ci-results/re7-fear-greed-csv-shapes.json'), JSON.stringify(report, null, 2))
	writeFileSync(resolve('ci-results/re7-fear-greed-csv-shapes.md'), md.join('\n'))

	// --- консоль: ключевые числа ---
	console.log('\n=== RE7 итог (OOS, ±1 бар) ===')
	console.log(`OWN2  OOS: precision=${pct(own2OosAgg1.precision)} recall=${pct(own2OosAgg1.recall)} f1=${pct(own2OosAgg1.f1)} (pred=${own2OosAgg1.predictions}, truth=${own2OosAgg1.truth})`)
	console.log(`F&G   OOS: precision=${pct(fgOosAgg1.precision)} recall=${pct(fgOosAgg1.recall)} f1=${pct(fgOosAgg1.f1)} (pred=${fgOosAgg1.predictions}, truth=${fgOosAgg1.truth})`)
	console.log(`sealed(dev): OWN2 r=${pct(own2SealedAgg1.recall)}/p=${pct(own2SealedAgg1.precision)} — F&G r=${pct(fgSealedAgg1.recall)}/p=${pct(fgSealedAgg1.precision)}`)
	console.log(`winner: ${JSON.stringify(winner.config)}`)
	console.log(`ВЕРДИКТ: ${verdict}`)
	if (anomalies.length) { console.log('Аномалии:'); for (const a of anomalies) console.log(`  - ${a}`) }
	console.log('\n[re7] written ci-results/re7-fear-greed-csv-shapes.{md,json}')
}

main()
