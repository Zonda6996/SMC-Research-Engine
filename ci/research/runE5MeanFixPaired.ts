/**
 * E5 — Mean-fix paired-arm под E3-протоколом (net + плацебо).
 *
 * Вопрос автора: если выходить ПОЛНОЙ фиксацией у mean (band centerline) вместо
 * базового управления (partial 25% + static TP), меняется ли результат — и есть ли
 * там эдж, который base-выход «недобирает»? Тест только на ноге, где под short-beta
 * есть положительный остаток: pd_premium (D3). ZC5 = чистая short-beta → сюда не берём.
 *
 * Дизайн = E3 (см. runE3PlaceboNet.ts), НО:
 *  - только Leg B (pd_premium): ArrowSignal detector relVol 1.4 + premium-4h;
 *  - ДВА arm-а на общем наборе сигналов и плацебо (paired): BASE vs MEANFIX;
 *  - свип LTF ∈ {5m, 15m, 30m, 1h} (5m — приоритет автора; данные gate-ятся hasKlines);
 *  - вывод даёт Result R (Σ netR) и Result % (Σ net%), как на скринах автора (avg stop опущен).
 *
 * arm-ы (различаются ТОЛЬКО правилом выхода, стоп/timestop/costs общие):
 *  - BASE    = { partial 25% у mean_{i-1}, static TP по inner band, stop 12×TR55 } — «до».
 *  - MEANFIX = { полная (100%) фиксация у первого касания mean_{i-1}, stop 12×TR55 } — «после».
 *
 * Общие фиксы E3 (внутри replayE5Trade): per-mode gate OFF (1 сигнал=1 сделка), НЕ
 * выбрасываем End mark (timestop mark-to-market), mean_{i-1}, validGgiBand не пропускает
 * проверку стопа, NET (7 bps/сторона). Timestop калибруется на BASE per-TF (медиана длин
 * закрытых сделок) и общий для обоих arm-ов, чтобы горизонт был одинаков.
 *
 * Kill-criteria (per arm, как E3): KILL если ЛЮБОЕ — mean excess < +0.05R (net) ИЛИ
 * bootstrap p > 0.0167 ИЛИ mean excess < 0 на OOS. Иначе SURVIVES.
 *
 * EXPLORATORY. Данные — офлайн raw OHLCV из tools/batch/cache.
 * Запуск: npx tsx ci/research/runE5MeanFixPaired.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { trueRangeSma, validGgiBand, type CorrectedGgiSide } from './lib/ggiCorrectedReplay.js'
import type { ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import { buildRows } from './runFwd1TelegramForwardAudit.js'
import { mulberry32 } from './runSur1SurrogateSignal.js'
// —— src/core (frozen, только чтение через публичные экспорты; НЕ модифицируется) ——
import { APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { admitArrowSignals, detectArrowSignalCandidates } from '../../src/core/signals/ArrowSignalEngine.js'
import { runAnalysis } from '../../src/core/analysis/runAnalysis.js'
import { buildHtfContext, htfContextAt, type HtfContext } from '../../src/core/analysis/htfContext.js'

// ============================================================================
// Config & constants
// ============================================================================
const SEED = 20260807
const K_PLACEBO = 20
const PLACEBO_WINDOW_MS = 30 * 86_400_000 // ±30 дней
const BOOTSTRAP_SAMPLES = 2000
const CLUSTER_MS = 4 * 60 * 60 * 1000 // 4h кластерное окно
const KILL_EXCESS_MIN = 0.05
const KILL_P_MAX = 0.0167
const HTF_ANCHOR_MS = 14_400_000 // 4h (pd/premium anchor, как в D3)
const HTF_PIVOT_WINDOW = 2
const COST_BPS = 0.0007 // 7 bps/сторона

interface E5Config { partialFrac: number; breakeven: boolean; stopMult: number; addOn: boolean; fullFixAtMean: boolean }
// «До»: базовое управление (ZC5/VAR1) — partial 25%, static TP, stop 12×TR55, без BE/add.
const BASE: E5Config = { partialFrac: 0.25, breakeven: false, stopMult: 12, addOn: false, fullFixAtMean: false }
// «После»: полная фиксация у mean (идея автора; E5 «full-fix-at-mean»).
const MEANFIX: E5Config = { partialFrac: 1, breakeven: false, stopMult: 12, addOn: false, fullFixAtMean: true }

// pd_premium LTF свип (D3 исходно 30m/1h/2h; +5m/15m по запросу автора). Данные gate-ятся.
const LTF_MINUTES = [5, 15, 30, 60]

// Активы E3 (та же урезанная выборка для сопоставимости с e3-placebo-net).
const IN_SAMPLE = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE']
const OOS = ['1000PEPE', 'AAVE', 'ARB', 'ENA', 'OP', 'SUI']

// ============================================================================
// DATA ADAPTER — raw OHLCV JSON (как в E3)
// ============================================================================
interface Kline { t: number; o: number; h: number; l: number; c: number; v: number }
interface RawCandle { timestamp: number; open: number; high: number; low: number; close: number; volume: number }

const TF_NAME: Record<number, string> = { 5: '5m', 15: '15m', 30: '30m', 60: '1h', 120: '2h', 240: '4h' }
const cachePath = (symbol: string, tfMinutes: number) => resolve('tools/batch/cache', `${symbol}-USDT_${TF_NAME[tfMinutes]}_20000_futures.json`)
const hasKlines = (symbol: string, tfMinutes: number) => existsSync(cachePath(symbol, tfMinutes))

function loadKlines(symbol: string, tfMinutes: number): Kline[] | null {
	const path = cachePath(symbol, tfMinutes)
	if (!existsSync(path)) return null
	let parsed: unknown
	try { parsed = JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
	let arr: unknown[]
	if (Array.isArray(parsed)) arr = parsed
	else if (parsed && typeof parsed === 'object') {
		const o = parsed as Record<string, unknown>
		const cand = (o.candles ?? o.rows ?? o.data) as unknown
		if (!Array.isArray(cand)) return null
		arr = cand
	} else return null
	const num = (v: unknown): number => typeof v === 'string' ? Number(v) : (v as number)
	const out: Kline[] = []
	for (const raw of arr) {
		if (raw == null) continue
		if (Array.isArray(raw)) {
			const t = num(raw[0]); const o = num(raw[1]); const h = num(raw[2]); const l = num(raw[3]); const c = num(raw[4]); const v = num(raw[5])
			if (Number.isFinite(t) && Number.isFinite(o)) out.push({ t: t < 1e12 ? t * 1000 : t, o, h, l, c, v: Number.isFinite(v) ? v : 0 })
			continue
		}
		const r = raw as Record<string, unknown>
		const t = num(r.timestamp ?? r.t ?? r.time ?? r.openTime)
		const o = num(r.open ?? r.o)
		const h = num(r.high ?? r.h)
		const l = num(r.low ?? r.l)
		const c = num(r.close ?? r.c)
		const v = num(r.volume ?? r.v ?? r.vol ?? 0)
		if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) continue
		out.push({ t: t < 1e12 ? t * 1000 : t, o, h, l, c, v: Number.isFinite(v) ? v : 0 })
	}
	out.sort((a, b) => a.t - b.t)
	return out.length ? out : null
}

const toRawCandles = (k: Kline[]): RawCandle[] => k.map((x) => ({ timestamp: x.t, open: x.o, high: x.h, low: x.l, close: x.c, volume: x.v }))

// ============================================================================
// replayE5Trade — форк replayE3Trade + arm MEANFIX + netPct для Result %.
// ============================================================================
const favWick = (side: CorrectedGgiSide, r: ExactIndicatorRow, lvl: number) => (side === 1 ? r.high >= lvl : r.low <= lvl)
const advWick = (side: CorrectedGgiSide, r: ExactIndicatorRow, lvl: number) => (side === 1 ? r.low <= lvl : r.high >= lvl)

interface E5Trade {
	outcome: 'Stop' | 'Partial' | 'Full fix' | 'Timestop'
	netR: number
	grossR: number
	costR: number
	netPct: number // net P&L в % цены (для Result %); = netR × plannedRiskPct
	holdingBars: number
	hitTimestop: boolean
}

function replayE5Trade(
	rows: readonly ExactIndicatorRow[],
	tr55: readonly (number | null)[],
	signalIndex: number,
	side: CorrectedGgiSide,
	cfg: E5Config,
	timestop: number,
): E5Trade | null {
	const signal = rows[signalIndex]
	const entryRow = rows[signalIndex + 1]
	const vol = tr55[signalIndex]
	if (signal == null || entryRow == null || vol == null || vol <= 0 || !validGgiBand(signal) || !validGgiBand(entryRow)) return null
	const entryPrice = entryRow.open
	const entryIndex = signalIndex + 1
	const stopDistance = vol * cfg.stopMult
	const oneR = stopDistance
	const staticTp = side === 1 ? signal.upperInner : signal.lowerInner
	const addLevel = entryPrice - side * 0.5 * stopDistance
	const plannedRiskPct = ((cfg.addOn ? 0.75 * stopDistance : stopDistance) / entryPrice) * 100

	let stop = entryPrice - side * stopDistance
	let partialDone = false
	let addDone = false
	let realisedPct = 0
	let activeWeight = cfg.addOn ? 0.5 : 1
	let avgEntry = entryPrice
	let turnoverNotional = Math.abs(entryPrice) * activeWeight

	const pnlPct = (to: number, w: number, from: number) => ((side * (to - from)) / entryPrice) * w * 100

	const finish = (outcome: E5Trade['outcome'], exitPrice: number, curIndex: number, hitTimestop: boolean): E5Trade => {
		turnoverNotional += Math.abs(exitPrice) * activeWeight
		const grossPct = realisedPct + pnlPct(exitPrice, activeWeight, avgEntry)
		const grossR = grossPct / plannedRiskPct
		const costR = (turnoverNotional * COST_BPS) / oneR
		const netR = grossR - costR
		return { outcome, netR, grossR, costR, netPct: netR * plannedRiskPct, holdingBars: curIndex - entryIndex + 1, hitTimestop }
	}

	const maxIndex = timestop > 0 && Number.isFinite(timestop)
		? Math.min(rows.length - 1, entryIndex + timestop - 1)
		: rows.length - 1

	for (let i = entryIndex; i <= maxIndex; i++) {
		const bar = rows[i]!
		const bandValid = validGgiBand(bar)
		// 0) add-on (в обоих arm-ах выключен)
		if (bandValid && cfg.addOn && !addDone && advWick(side, bar, addLevel) && !advWick(side, bar, stop)) {
			avgEntry = (avgEntry * activeWeight + addLevel * 0.5) / (activeWeight + 0.5)
			turnoverNotional += Math.abs(addLevel) * 0.5
			activeWeight += 0.5
			addDone = true
		}
		// 1) adverse first: stop (проверяется ВСЕГДА)
		if (advWick(side, bar, stop)) return finish(partialDone ? 'Partial' : 'Stop', stop, i, false)
		if (!bandValid) continue
		// 2) mean_{i-1}: MEANFIX → полная фиксация; BASE → partial 25%
		const prevMean = rows[i - 1]!.mean
		if (Number.isFinite(prevMean) && favWick(side, bar, prevMean)) {
			if (cfg.fullFixAtMean) return finish('Full fix', prevMean, i, false)
			if (!partialDone) {
				partialDone = true
				const w = activeWeight * cfg.partialFrac
				realisedPct += pnlPct(prevMean, w, avgEntry)
				turnoverNotional += Math.abs(prevMean) * w
				activeWeight -= w
				if (cfg.breakeven) stop = avgEntry
			}
		}
		// 3) full по static TP wick (только BASE — в MEANFIX сюда не дойдём)
		if (favWick(side, bar, staticTp)) return finish('Full fix', staticTp, i, false)
	}
	const mmBar = rows[maxIndex]
	if (mmBar == null) return null
	return finish('Timestop', mmBar.close, maxIndex, true)
}

// ============================================================================
// pd_premium (D3) signal source — ArrowSignal detector relVol 1.4 + HTF premium 4h
// ============================================================================
interface RealSignal { symbol: string; side: CorrectedGgiSide; signalIndex: number; t: number; bucket4h: number }

const htfCtxCache = new Map<string, HtfContext | null>()
function htfContextFor(symbol: string): HtfContext | null {
	if (htfCtxCache.has(symbol)) return htfCtxCache.get(symbol)!
	const k4 = loadKlines(symbol, 240)
	if (!k4 || k4.length < 300) { htfCtxCache.set(symbol, null); return null }
	const snap = runAnalysis(toRawCandles(k4))
	const ctx = buildHtfContext(snap, HTF_ANCHOR_MS, HTF_PIVOT_WINDOW)
	htfCtxCache.set(symbol, ctx)
	return ctx
}

interface Collected { rows: ExactIndicatorRow[]; tr55: Array<number | null>; signals: RealSignal[] }

function collectPdPremium(symbol: string, tfMinutes: number): Collected | null {
	const kl = loadKlines(symbol, tfMinutes)
	if (!kl || kl.length < 400) return null
	const snap = runAnalysis(toRawCandles(kl))
	const candles = snap.candles
	const rowsKlines: Kline[] = candles.map((c) => ({ t: c.timestamp, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume }))
	const rows = buildRows(rowsKlines)
	const tr55 = trueRangeSma(rows, 55)
	const htfCtx = htfContextFor(symbol)
	if (htfCtx == null) return null
	const detection = detectArrowSignalCandidates(candles, APEX_PARAMS, { minimumRelativeVolume: 1.4 })
	const out: RealSignal[] = []
	for (const signal of admitArrowSignals(detection.candidates)) {
		const entryIndex = signal.signalIndex + 1
		const entryCandle = candles[entryIndex]
		if (entryCandle == null) continue
		const side: CorrectedGgiSide = signal.side === 'long' ? 1 : -1
		const h = htfContextAt(htfCtx, entryCandle.timestamp, entryCandle.open, signal.side)
		if (h.pdZone !== 'premium') continue
		out.push({ symbol, side, signalIndex: signal.signalIndex, t: candles[signal.signalIndex]!.timestamp, bucket4h: Math.floor(entryCandle.timestamp / CLUSTER_MS) })
	}
	return { rows, tr55, signals: out }
}

// ============================================================================
// Placebo draws + trade result assembly
// ============================================================================
interface TradeResult {
	symbol: string
	side: CorrectedGgiSide
	bucket4h: number
	realNetR: number
	realNetPct: number
	realHitTimestop: boolean
	placeboMeanNetR: number
	excess: number
}

function eligiblePlaceboIndices(rows: readonly ExactIndicatorRow[], tr55: readonly (number | null)[], centerTs: number): number[] {
	const lo = centerTs - PLACEBO_WINDOW_MS
	const hi = centerTs + PLACEBO_WINDOW_MS
	const out: number[] = []
	for (let i = 0; i < rows.length - 1; i++) {
		const r = rows[i]!
		if (r.timestamp < lo || r.timestamp > hi) continue
		if (!validGgiBand(r)) continue
		if (tr55[i] == null || !(tr55[i]! > 0)) continue
		out.push(i)
	}
	return out
}

function measureSymbol(d: Collected, cfg: E5Config, timestop: number, rng: () => number): TradeResult[] {
	const results: TradeResult[] = []
	for (const sig of d.signals) {
		const real = replayE5Trade(d.rows, d.tr55, sig.signalIndex, sig.side, cfg, timestop)
		if (!real) continue
		const pool = eligiblePlaceboIndices(d.rows, d.tr55, sig.t)
		const placeboRs: number[] = []
		if (pool.length > 0) {
			for (let k = 0; k < K_PLACEBO; k++) {
				const idx = pool[(rng() * pool.length) | 0]!
				const p = replayE5Trade(d.rows, d.tr55, idx, sig.side, cfg, timestop)
				if (p) placeboRs.push(p.netR)
			}
		}
		const placeboMean = placeboRs.length ? placeboRs.reduce((a, b) => a + b, 0) / placeboRs.length : NaN
		results.push({
			symbol: sig.symbol, side: sig.side, bucket4h: sig.bucket4h,
			realNetR: real.netR, realNetPct: real.netPct, realHitTimestop: real.hitTimestop,
			placeboMeanNetR: placeboMean,
			excess: Number.isFinite(placeboMean) ? real.netR - placeboMean : NaN,
		})
	}
	return results
}

// Timestop калибруется на BASE per-TF (медиана длин закрытых сделок), общий для обоих arm-ов.
function calibrateTimestop(perSymbol: Collected[]): number {
	const holdings: number[] = []
	for (const s of perSymbol) {
		for (const sig of s.signals) {
			const t = replayE5Trade(s.rows, s.tr55, sig.signalIndex, sig.side, BASE, Infinity)
			if (t && (t.outcome === 'Stop' || t.outcome === 'Partial' || t.outcome === 'Full fix')) holdings.push(t.holdingBars)
		}
	}
	if (!holdings.length) return 200
	holdings.sort((a, b) => a - b)
	const mid = Math.floor(holdings.length / 2)
	const med = holdings.length % 2 ? holdings[mid]! : (holdings[mid - 1]! + holdings[mid]!) / 2
	return Math.max(1, Math.round(med))
}

// ============================================================================
// Aggregation + cluster-aware bootstrap
// ============================================================================
interface GroupStats {
	n: number
	endMarkRate: number
	sumNetR: number
	sumNetPct: number
	meanNetR: number
	meanExcess: number
	pValue: number
	clusters: number
	shortShare: number
}

const mean = (a: readonly number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0)

function bootstrapClusterP(results: readonly TradeResult[], rng: () => number): { p: number; clusters: number } {
	const valid = results.filter((r) => Number.isFinite(r.excess))
	const clusterMap = new Map<string, number[]>()
	for (const r of valid) {
		const key = `${r.side}|${r.bucket4h}`
		const arr = clusterMap.get(key) ?? []
		if (!clusterMap.has(key)) clusterMap.set(key, arr)
		arr.push(r.excess)
	}
	const clusters = [...clusterMap.values()]
	const C = clusters.length
	if (C < 2) return { p: NaN, clusters: C }
	let leZero = 0
	for (let b = 0; b < BOOTSTRAP_SAMPLES; b++) {
		let s = 0
		let cnt = 0
		for (let i = 0; i < C; i++) {
			const cl = clusters[(rng() * C) | 0]!
			for (const x of cl) { s += x; cnt++ }
		}
		if (cnt > 0 && s / cnt <= 0) leZero++
	}
	return { p: leZero / BOOTSTRAP_SAMPLES, clusters: C }
}

function summarizeGroup(results: readonly TradeResult[], rng: () => number): GroupStats {
	const n = results.length
	const nets = results.map((r) => r.realNetR).filter(Number.isFinite)
	const netPcts = results.map((r) => r.realNetPct).filter(Number.isFinite)
	const excesses = results.map((r) => r.excess).filter(Number.isFinite)
	const endMarks = results.filter((r) => r.realHitTimestop).length
	const shorts = results.filter((r) => r.side === -1).length
	const { p, clusters } = bootstrapClusterP(results, rng)
	return {
		n,
		endMarkRate: n ? endMarks / n : NaN,
		sumNetR: sum(nets),
		sumNetPct: sum(netPcts),
		meanNetR: mean(nets),
		meanExcess: mean(excesses),
		pValue: p,
		clusters,
		shortShare: n ? shorts / n : NaN,
	}
}

interface KillEval { killed: boolean; reasons: string[] }
function evaluateKill(inSample: GroupStats, oos: GroupStats): KillEval {
	const reasons: string[] = []
	if (!(inSample.meanExcess >= KILL_EXCESS_MIN)) reasons.push(`in-sample excess ${fmt(inSample.meanExcess)}R < +${KILL_EXCESS_MIN}R`)
	if (!(inSample.pValue <= KILL_P_MAX)) reasons.push(`bootstrap p ${fmt(inSample.pValue)} > ${KILL_P_MAX}`)
	if (!(oos.meanExcess >= 0)) reasons.push(`OOS excess ${fmt(oos.meanExcess)}R < 0`)
	return { killed: reasons.length > 0, reasons }
}

const fmt = (x: number, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a')
const pct = (x: number) => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a')
const sr = (x: number) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(2) : 'n/a')

// ============================================================================
// Main
// ============================================================================
interface ArmResult { arm: string; inSample: GroupStats; oos: GroupStats; kill: KillEval }
interface TfResult { tfMinutes: number; tfName: string; inAssets: string[]; oosAssets: string[]; timestop: number; arms: ArmResult[] }

async function main() {
	console.log('[e5] mean-fix paired-arm под E3-протоколом (только pd_premium)')
	const rng = mulberry32(SEED)
	const tfResults: TfResult[] = []

	for (const tf of LTF_MINUTES) {
		const tfName = TF_NAME[tf]!
		const inAssets = IN_SAMPLE.filter((s) => hasKlines(s, tf) && hasKlines(s, 240))
		const oosAssets = OOS.filter((s) => hasKlines(s, tf) && hasKlines(s, 240))
		if (!inAssets.length) { console.log(`[e5] ${tfName}: НЕТ данных in-sample — пропуск ТФ`); continue }
		console.log(`\n[e5] === ТФ ${tfName} === in=${inAssets.join(',')} | oos=${oosAssets.join(',') || '—'}`)

		const inData = inAssets.map((s) => collectPdPremium(s, tf)).filter((x): x is Collected => x != null)
		const oosData = oosAssets.map((s) => collectPdPremium(s, tf)).filter((x): x is Collected => x != null)
		const timestop = calibrateTimestop(inData)
		console.log(`[e5] ${tfName}: timestop(BASE, in-sample median)=${timestop} bars; сигналы in=${sum(inData.map((d) => d.signals.length))} oos=${sum(oosData.map((d) => d.signals.length))}`)

		const arms: ArmResult[] = []
		for (const [armName, cfg] of [['BASE', BASE], ['MEANFIX', MEANFIX]] as const) {
			const inRes: TradeResult[] = []
			for (const d of inData) inRes.push(...measureSymbol(d, cfg, timestop, rng))
			const oosRes: TradeResult[] = []
			for (const d of oosData) oosRes.push(...measureSymbol(d, cfg, timestop, rng))
			const inG = summarizeGroup(inRes, rng)
			const oosG = summarizeGroup(oosRes, rng)
			arms.push({ arm: armName, inSample: inG, oos: oosG, kill: evaluateKill(inG, oosG) })
		}
		tfResults.push({ tfMinutes: tf, tfName, inAssets, oosAssets, timestop, arms })
	}

	// —— JSON ——
	writeFileSync(resolve('ci-results/e5-meanfix-paired.json'), JSON.stringify({
		generatedAt: new Date().toISOString(),
		protocol: 'E5-meanfix-paired-1.0 (fork of E3-placebo-net)',
		leg: 'pd_premium (D3, relVol 1.4, premium-4h)',
		config: { seed: SEED, kPlacebo: K_PLACEBO, placeboWindowDays: 30, bootstrapSamples: BOOTSTRAP_SAMPLES, cost: '7bps/side', base: BASE, meanfix: MEANFIX, killCriteria: { excessMin: KILL_EXCESS_MIN, pMax: KILL_P_MAX, oosExcessMin: 0 }, inSample: IN_SAMPLE, oos: OOS, ltfMinutes: LTF_MINUTES },
		tfResults,
	}, null, 2))

	// —— Markdown (RU) ——
	const md: string[] = []
	md.push('# E5 — Mean-fix paired-arm (pd_premium), before/after по ТФ')
	md.push('')
	md.push('EXPLORATORY. Форк E3-протокола (NET 7bps/сторона, 5 фиксов, плацебо K=20 ±30дн same symbol+side,')
	md.push(`cluster-bootstrap ${BOOTSTRAP_SAMPLES}, seed ${SEED}). Нога: pd_premium (D3, relVol 1.4, premium-4h).`)
	md.push('BASE = partial 25% у mean + static TP. MEANFIX = полная фиксация у mean. Стоп 12×TR55, timestop общий (BASE-калибровка).')
	md.push('')
	md.push('**Result R** = Σ netR по сделкам сплита; **Result %** = Σ net% (P&L в % цены). **excess** = netR − mean(плацебо) — метрика kill.')
	md.push(`Kill (per arm): excess < +${KILL_EXCESS_MIN}R (in), ИЛИ p > ${KILL_P_MAX}, ИЛИ excess < 0 (OOS).`)
	md.push('')
	const row = (tfName: string, arm: string, split: string, g: GroupStats) =>
		`| ${tfName} | ${arm} | ${split} | ${g.n} | ${pct(g.endMarkRate)} | ${sr(g.sumNetR)}R | ${sr(g.sumNetPct)}% | ${fmt(g.meanNetR)} | ${fmt(g.meanExcess)} | ${fmt(g.pValue)} | ${pct(g.shortShare)} |`
	for (const tfr of tfResults) {
		md.push(`## ТФ ${tfr.tfName} (timestop=${tfr.timestop} bars; in=${tfr.inAssets.join(',')}; oos=${tfr.oosAssets.join(',') || '—'})`)
		md.push('')
		md.push('| ТФ | arm | split | n | End-mark | Result R | Result % | mean netR | mean excess | p | short-share |')
		md.push('|---|---|---|---|---|---|---|---|---|---|---|')
		for (const a of tfr.arms) {
			md.push(row(tfr.tfName, a.arm, 'IN', a.inSample))
			md.push(row(tfr.tfName, a.arm, 'OOS', a.oos))
		}
		md.push('')
		for (const a of tfr.arms) md.push(`- **${a.arm}: ${a.kill.killed ? '❌ KILLED' : '✅ SURVIVES'}**${a.kill.reasons.length ? ' — ' + a.kill.reasons.join('; ') : ''}`)
		md.push('')
	}
	writeFileSync(resolve('ci-results/e5-meanfix-paired.md'), md.join('\n'))

	// —— Console summary ——
	console.log('\n===== E5 SUMMARY (pd_premium; BASE vs MEANFIX) =====')
	for (const tfr of tfResults) {
		console.log(`\n[ТФ ${tfr.tfName}] timestop=${tfr.timestop}`)
		for (const a of tfr.arms) {
			console.log(`  ${a.arm.padEnd(7)} IN : n=${a.inSample.n} ResultR=${sr(a.inSample.sumNetR)} Result%=${sr(a.inSample.sumNetPct)} meanNetR=${fmt(a.inSample.meanNetR)} excess=${fmt(a.inSample.meanExcess)} p=${fmt(a.inSample.pValue)}`)
			console.log(`  ${a.arm.padEnd(7)} OOS: n=${a.oos.n} ResultR=${sr(a.oos.sumNetR)} Result%=${sr(a.oos.sumNetPct)} meanNetR=${fmt(a.oos.meanNetR)} excess=${fmt(a.oos.meanExcess)} p=${fmt(a.oos.pValue)}`)
			console.log(`  ${a.arm.padEnd(7)} → ${a.kill.killed ? 'KILLED' : 'SURVIVES'}${a.kill.reasons.length ? ' [' + a.kill.reasons.join('; ') + ']' : ''}`)
		}
	}
	console.log('\n[e5] written ci-results/e5-meanfix-paired.{json,md}')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => { console.error(err); process.exit(1) })
}
