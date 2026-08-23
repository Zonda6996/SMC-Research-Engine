/**
 * E3 — Placebo-normalized NET re-measurement of two "positive" findings:
 *   Leg A: ZC5 SELECTIVE (own1 1h trigger, causal 4h pool re-detection, SELECTIVE rule)
 *   Leg B: pd_premium (D3, ArrowSignal detector с minimumRelativeVolume:1.4, premium 4h)
 *
 * Вопрос: переживает ли edge net-costs и плацебо-нормировку, или это просто short-beta.
 *
 * Метод (per E3 spec):
 *  - для каждого РЕАЛЬНОГО сигнала (symbol, side, t) рисуем K=20 плацебо-входов на ТОМ ЖЕ
 *    символе и ТОЙ ЖЕ стороне в случайном баре в пределах ±30 дней от t; единственное
 *    условие допуска — validGgiBand на плацебо-баре;
 *  - каждый вход (реальный и плацебо) реплеится через ОДИН И ТОТ ЖЕ replayE3Trade
 *    (5 фиксов, net costs, фиксированный timestop);
 *  - excess = netR(real) − mean(netR по K плацебо);
 *  - агрегация excess по группам; cluster-aware bootstrap (2000, seed 20260807),
 *    ресемпл по кластерам (same-side, same 4h bucket).
 *
 * 5 ОБЯЗАТЕЛЬНЫХ ФИКСОВ (внутри replayE3Trade, форк от replayVar1Trade):
 *  1. Per-mode gate OFF: 1 сигнал = 1 независимая сделка (без exit-cooldown).
 *  2. НЕ выбрасываем End mark: если ни stop, ни TP не сработали за TIMESTOP баров —
 *     закрываем mark-to-market по close этого бара. Доля timestop-закрытий (End-mark rate)
 *     репортится как первичное число. TIMESTOP = медианная длина удержания (в барах)
 *     сделок, закрывшихся по stop/TP, посчитанная per-leg на in-sample, затем зафиксирована.
 *  3. Partial-триггер использует mean ПРЕДЫДУЩЕГО закрытого бара (mean_{i-1}), а не bar.mean.
 *  4. validGgiBand: если band текущего бара невалиден — НЕ continue до проверки стопа,
 *     стоп проверяется всегда; пропускается только band-зависимая partial/TP логика.
 *  5. NET, не gross. Cost canon (zonda-reversal.md §2): 7 bps на исполненную сторону;
 *     costR = turnoverNotional * 0.0007 / oneR; oneR = stopDistance; turnover учитывает
 *     вход + каждую исполненную ногу выхода (partial close + final close).
 *
 * Kill-criteria (per leg): KILL если ЛЮБОЕ из —
 *   mean excess < +0.05R (net) ИЛИ bootstrap p > 0.0167 ИЛИ mean excess < 0 на OOS.
 *   Иначе SURVIVES.
 *
 * EXPLORATORY re-measurement. Данные — офлайн raw OHLCV из tools/batch/cache.
 * Запуск: npx tsx ci/research/runE3PlaceboNet.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { trueRangeSma, validGgiBand, type CorrectedGgiSide } from './lib/ggiCorrectedReplay.js'
import type { ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import { bodySma20, own1Signals } from './runOwn1Generator.js'
import { buildRows } from './runFwd1TelegramForwardAudit.js'
import { mulberry32 } from './runSur1SurrogateSignal.js'
import { detectLiquidityHeatmap, heatmapConfigForTf, type LiquidityPool } from './lib/liquidityHeatmapEngine.js'
import type { Candle } from './lib/candleType.js'
// —— src/core (frozen, только чтение через публичные экспорты; НЕ модифицируется) ——
import { APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { admitArrowSignals, detectArrowSignalCandidates, type ArrowSignal } from '../../src/core/signals/ArrowSignalEngine.js'
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

// ZC5 base management (см. ZC5/VAR1): partial 25%, stop 12×TR55, без BE и без add.
interface E3Config { partialFrac: number; breakeven: boolean; stopMult: number; addOn: boolean }
const BASE: E3Config = { partialFrac: 0.25, breakeven: false, stopMult: 12, addOn: false }

// ПОЛНЫЙ набор (для перф-причин временно урезан, см. ниже; методика per-asset не меняется):
//   ZC5_SYMBOLS(full) = ['BTC','ETH','SOL','XRP','BNB','DOGE','ADA','LINK','LTC','AVAX','DOT','ATOM']
//   OOS_CANDIDATES(full) = ['1000PEPE','AAVE','APT','ARB','ASTER','ENA','FARTCOIN','HYPE','INJ','NEAR','OP','PUMP','SUI','TAO','TON','UNI','ZEC']
// Урезано по согласованию автора (2026-08-17): Leg A O(сигналы×префикс) → ~5-6 мин/актив;
// каждый оставленный актив считается ПОБИТОВО как раньше, урезана только ШИРОТА выборки.
const ZC5_SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE']
const OOS_CANDIDATES = ['1000PEPE', 'AAVE', 'ARB', 'ENA', 'OP', 'SUI']

// ZC5 pool lifecycle (как в ZC5): age >= 2d (12×4h bars), grace 24h.
const MIN_AGE_MS = 12 * 240 * 60_000
const GRACE_MS = 24 * 3_600_000

// ============================================================================
// DATA ADAPTER — raw OHLCV JSON: [{timestamp,open,high,low,close,volume}, ...]
// (shape подтверждён: массив объектов, timestamp в ms, поля open/high/low/close/volume)
// ============================================================================
interface Kline { t: number; o: number; h: number; l: number; c: number; v: number }
interface RawCandle { timestamp: number; open: number; high: number; low: number; close: number; volume: number }

const TF_NAME: Record<number, string> = { 15: '15m', 30: '30m', 60: '1h', 120: '2h', 240: '4h' }
const cachePath = (symbol: string, tfMinutes: number) => resolve('tools/batch/cache', `${symbol}-USDT_${TF_NAME[tfMinutes]}_20000_futures.json`)
const hasKlines = (symbol: string, tfMinutes: number) => existsSync(cachePath(symbol, tfMinutes))

/** Толерантный загрузчик raw OHLCV → { t(ms), o,h,l,c,v } по возрастанию. */
function loadKlines(symbol: string, tfMinutes: number): Kline[] | null {
	const path = cachePath(symbol, tfMinutes)
	if (!existsSync(path)) return null
	let parsed: unknown
	try { parsed = JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
	// Поддержка array | {candles:[…]} | {rows:[…]} | {data:[…]}
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
			// [t, o, h, l, c, v]
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
const toCandles = (k: Kline[]): Candle[] => k.map((x) => ({ timestamp: x.t, open: x.o, high: x.h, low: x.l, close: x.c, volume: x.v }))

const tfMsOfRows = (rows: readonly ExactIndicatorRow[]): number => {
	if (rows.length < 2) return 3_600_000
	return rows[1]!.timestamp - rows[0]!.timestamp
}

// ============================================================================
// replayE3Trade — форк replayVar1Trade + 5 фиксов. NET, timestop, mean_{i-1}.
// ============================================================================
const favWick = (side: CorrectedGgiSide, r: ExactIndicatorRow, lvl: number) => (side === 1 ? r.high >= lvl : r.low <= lvl)
const advWick = (side: CorrectedGgiSide, r: ExactIndicatorRow, lvl: number) => (side === 1 ? r.low <= lvl : r.high >= lvl)

interface E3Trade {
	outcome: 'Stop' | 'Partial' | 'Full fix' | 'Timestop'
	netR: number
	grossR: number
	costR: number
	holdingBars: number
	hitTimestop: boolean
}

/**
 * Реплей одной сделки под E3-фиксами.
 * @param timestop  фиксированный горизонт в барах (если <=0 или Infinity — эффективно нет
 *                  таймстопа, используется на этапе калибровки для замера длин закрытых сделок).
 */
function replayE3Trade(
	rows: readonly ExactIndicatorRow[],
	tr55: readonly (number | null)[],
	signalIndex: number,
	side: CorrectedGgiSide,
	cfg: E3Config,
	timestop: number,
): E3Trade | null {
	const signal = rows[signalIndex]
	const entryRow = rows[signalIndex + 1]
	const vol = tr55[signalIndex]
	if (signal == null || entryRow == null || vol == null || vol <= 0 || !validGgiBand(signal) || !validGgiBand(entryRow)) return null
	const entryPrice = entryRow.open
	const entryIndex = signalIndex + 1
	const stopDistance = vol * cfg.stopMult
	const oneR = stopDistance // FIX 5: oneR = stopDistance (price units)
	const staticTp = side === 1 ? signal.upperInner : signal.lowerInner
	const addLevel = entryPrice - side * 0.5 * stopDistance
	const plannedRiskPct = ((cfg.addOn ? 0.75 * stopDistance : stopDistance) / entryPrice) * 100

	let stop = entryPrice - side * stopDistance
	let partialDone = false
	let addDone = false
	let realisedPct = 0
	let activeWeight = cfg.addOn ? 0.5 : 1
	let avgEntry = entryPrice
	// FIX 5: turnover в notional (units × price), вход = activeWeight × entryPrice.
	let turnoverNotional = Math.abs(entryPrice) * activeWeight

	const pnlPct = (to: number, w: number, from: number) => ((side * (to - from)) / entryPrice) * w * 100

	const finish = (outcome: E3Trade['outcome'], exitPrice: number, curIndex: number, hitTimestop: boolean): E3Trade => {
		turnoverNotional += Math.abs(exitPrice) * activeWeight // финальная нога выхода
		const grossPct = realisedPct + pnlPct(exitPrice, activeWeight, avgEntry)
		const grossR = grossPct / plannedRiskPct
		// costR = turnoverNotional * 0.0007 / oneR (oneR = stopDistance, price units).
		const costR = (turnoverNotional * 0.0007) / oneR
		return { outcome, netR: grossR - costR, grossR, costR, holdingBars: curIndex - entryIndex + 1, hitTimestop }
	}

	const maxIndex = timestop > 0 && Number.isFinite(timestop)
		? Math.min(rows.length - 1, entryIndex + timestop - 1)
		: rows.length - 1

	for (let i = entryIndex; i <= maxIndex; i++) {
		const bar = rows[i]!
		const bandValid = validGgiBand(bar) // FIX 4: невалидный band не пропускает проверку стопа
		// 0) add-on (в BASE выключен) — только если band валиден
		if (bandValid && cfg.addOn && !addDone && advWick(side, bar, addLevel) && !advWick(side, bar, stop)) {
			avgEntry = (avgEntry * activeWeight + addLevel * 0.5) / (activeWeight + 0.5)
			turnoverNotional += Math.abs(addLevel) * 0.5
			activeWeight += 0.5
			addDone = true
		}
		// 1) adverse first: stop (проверяется ВСЕГДА, FIX 4)
		if (advWick(side, bar, stop)) return finish(partialDone ? 'Partial' : 'Stop', stop, i, false)
		// band-зависимая логика (partial/TP) — только на валидном band-баре (FIX 4)
		if (!bandValid) continue
		// 2) partial по mean ПРЕДЫДУЩЕГО закрытого бара (FIX 3: mean_{i-1})
		const prevMean = rows[i - 1]!.mean
		if (!partialDone && Number.isFinite(prevMean) && favWick(side, bar, prevMean)) {
			partialDone = true
			const w = activeWeight * cfg.partialFrac
			realisedPct += pnlPct(prevMean, w, avgEntry)
			turnoverNotional += Math.abs(prevMean) * w // partial-нога выхода
			activeWeight -= w
			if (cfg.breakeven) stop = avgEntry
		}
		// 3) full по static TP wick
		if (favWick(side, bar, staticTp)) return finish('Full fix', staticTp, i, false)
	}
	// FIX 2: timestop → mark-to-market по close бара maxIndex
	const mmBar = rows[maxIndex]
	if (mmBar == null) return null
	return finish('Timestop', mmBar.close, maxIndex, true)
}

// ============================================================================
// Leg A — ZC5 SELECTIVE signal source (own1 1h trigger + causal 4h pools)
// ============================================================================
interface RealSignal { symbol: string; side: CorrectedGgiSide; signalIndex: number; t: number; bucket4h: number }

/**
 * Собирает ZC5 SELECTIVE реальные сигналы для символа.
 * Возвращает { rows, tr55, signals }. rows/tr55 нужны для последующего плацебо-реплея.
 */
function collectZc5Selective(symbol: string): { rows: ExactIndicatorRow[]; tr55: Array<number | null>; signals: RealSignal[] } | null {
	const k1 = loadKlines(symbol, 60)
	const k4 = loadKlines(symbol, 240)
	if (!k1 || !k4 || k1.length < 400 || k4.length < 500) return null
	const rows = buildRows(k1)
	const tr55 = trueRangeSma(rows, 55)
	const candles4 = toCandles(k4)
	const cfg4h = heatmapConfigForTf(240 * 60_000)
	const sigs = own1Signals(rows, bodySma20(rows), 1.5, 10, 0, rows.length)

	let lastPrefixLen = -1
	let pools: LiquidityPool[] = []
	const out: RealSignal[] = []

	for (const sig of sigs) {
		const bar = rows[sig.idx]!
		const entryRow = rows[sig.idx + 1]
		if (!entryRow || !Number.isFinite(bar.mean)) continue
		// causal 4h prefix, закрытый строго до T = закрытие 1h сигнального бара
		const T = bar.timestamp + 3_600_000
		let prefixLen = 0
		while (prefixLen < candles4.length && candles4[prefixLen]!.timestamp + 240 * 60_000 <= T) prefixLen++
		if (prefixLen < 300) continue
		if (prefixLen !== lastPrefixLen) {
			pools = detectLiquidityHeatmap(candles4.slice(0, prefixLen), cfg4h)
			lastPrefixLen = prefixLen
		}
		const entry = entryRow.open
		const want = sig.side === 1 ? 'buy-side' : 'sell-side'
		const alive = pools.filter((pl) => pl.side === want && pl.startAt + MIN_AGE_MS <= T && (pl.sweptAt == null || T - pl.sweptAt <= GRACE_MS))
		const inBand = (pl: LiquidityPool, tol: number) => {
			const bw = pl.bandHigh - pl.bandLow
			return entry >= pl.bandLow - tol * bw && entry <= pl.bandHigh + tol * bw
		}
		const hit = alive.find((pl) => inBand(pl, 0.5))
		if (!hit) continue
		// causal notional rank среди живых same-side пулов
		let below = 0
		for (const p of alive) if (p !== hit && p.notional < hit.notional) below++
		const rank = alive.length <= 1 ? 0.5 : below / (alive.length - 1)
		const sweptRecently = hit.sweptAt != null && T - hit.sweptAt <= GRACE_MS
		// SELECTIVE: rank < 2/3 (не самый тяжёлый) И entry строго в band И swept за 24h
		if (rank < 2 / 3 && inBand(hit, 0) && sweptRecently) {
			out.push({ symbol, side: sig.side, signalIndex: sig.idx, t: bar.timestamp, bucket4h: Math.floor(T / CLUSTER_MS) })
		}
	}
	return { rows, tr55, signals: out }
}

// ============================================================================
// Leg B — pd_premium (D3) signal source (ArrowSignal detector relVol 1.4 + HTF premium 4h)
// ============================================================================
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

/**
 * Собирает pd_premium (D3) реальные сигналы для символа на выбранном LTF.
 * D3 использует snapshot.candles = runAnalysis(raw).candles (причинная консистентность
 * индексов), ArrowSignal detector с relVol 1.4 (E1-фикс), admitArrowSignals, и
 * premium-бакет HTF 4h на момент входа. Для реплея мы строим ExactIndicatorRow из
 * тех же snapshot.candles через buildRows (Apex bands), чтобы replayE3Trade применялся
 * к единому набору свечей.
 */
function collectPdPremium(symbol: string, tfMinutes: number): { rows: ExactIndicatorRow[]; tr55: Array<number | null>; signals: RealSignal[] } | null {
	const kl = loadKlines(symbol, tfMinutes)
	if (!kl || kl.length < 400) return null
	const snap = runAnalysis(toRawCandles(kl))
	const candles = snap.candles
	// rows для реплея: buildRows поверх snapshot.candles (те же индексы).
	const rowsKlines: Kline[] = candles.map((c) => ({ t: c.timestamp, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume }))
	const rows = buildRows(rowsKlines)
	const tr55 = trueRangeSma(rows, 55)
	const htfCtx = htfContextFor(symbol)
	const detection = detectArrowSignalCandidates(candles, APEX_PARAMS, { minimumRelativeVolume: 1.4 })
	const out: RealSignal[] = []
	for (const signal of admitArrowSignals(detection.candidates)) {
		const entryIndex = signal.signalIndex + 1
		const entryCandle = candles[entryIndex]
		if (entryCandle == null) continue
		const side: CorrectedGgiSide = signal.side === 'long' ? 1 : -1
		// premium bucket (D3): pdZone === 'premium' на момент входа
		if (htfCtx == null) continue
		const h = htfContextAt(htfCtx, entryCandle.timestamp, entryCandle.open, signal.side)
		if (h.pdZone !== 'premium') continue
		out.push({ symbol, side, signalIndex: signal.signalIndex, t: candles[signal.signalIndex]!.timestamp, bucket4h: Math.floor(entryCandle.timestamp / CLUSTER_MS) })
	}
	return { rows, tr55, signals: out }
}

// pd_premium LTF: D3 использует 30m/1h/2h. Берём 1h как единый LTF (наиболее покрытый TF).
const PD_TF_MINUTES = 60

// ============================================================================
// Placebo draws + trade result assembly
// ============================================================================
interface TradeResult {
	symbol: string
	side: CorrectedGgiSide
	bucket4h: number
	realNetR: number
	realOutcome: string
	realHitTimestop: boolean
	placeboMeanNetR: number
	placeboCount: number
	excess: number
}

/** Индексы баров в пределах ±window от t, с валидным band и валидным TR55 (для входа). */
function eligiblePlaceboIndices(rows: readonly ExactIndicatorRow[], tr55: readonly (number | null)[], centerTs: number): number[] {
	const lo = centerTs - PLACEBO_WINDOW_MS
	const hi = centerTs + PLACEBO_WINDOW_MS
	const out: number[] = []
	for (let i = 0; i < rows.length - 1; i++) {
		const r = rows[i]!
		if (r.timestamp < lo || r.timestamp > hi) continue
		if (!validGgiBand(r)) continue // единственное условие допуска — valid band
		if (tr55[i] == null || !(tr55[i]! > 0)) continue
		out.push(i)
	}
	return out
}

/** Реплеит все реальные сигналы одного символа + K плацебо на каждый. */
function measureSymbol(
	rows: ExactIndicatorRow[],
	tr55: Array<number | null>,
	signals: RealSignal[],
	timestop: number,
	rng: () => number,
): TradeResult[] {
	const results: TradeResult[] = []
	for (const sig of signals) {
		const real = replayE3Trade(rows, tr55, sig.signalIndex, sig.side, BASE, timestop)
		if (!real) continue
		const pool = eligiblePlaceboIndices(rows, tr55, sig.t)
		const placeboRs: number[] = []
		if (pool.length > 0) {
			for (let k = 0; k < K_PLACEBO; k++) {
				const idx = pool[(rng() * pool.length) | 0]!
				const p = replayE3Trade(rows, tr55, idx, sig.side, BASE, timestop)
				if (p) placeboRs.push(p.netR)
			}
		}
		const placeboMean = placeboRs.length ? placeboRs.reduce((a, b) => a + b, 0) / placeboRs.length : NaN
		results.push({
			symbol: sig.symbol, side: sig.side, bucket4h: sig.bucket4h,
			realNetR: real.netR, realOutcome: real.outcome, realHitTimestop: real.hitTimestop,
			placeboMeanNetR: placeboMean, placeboCount: placeboRs.length,
			excess: Number.isFinite(placeboMean) ? real.netR - placeboMean : NaN,
		})
	}
	return results
}

// ============================================================================
// Timestop calibration (per leg, on in-sample) — медиана длин stop/TP-закрытых сделок
// ============================================================================
function calibrateTimestop(perSymbol: Array<{ rows: ExactIndicatorRow[]; tr55: Array<number | null>; signals: RealSignal[] }>): number {
	const holdings: number[] = []
	for (const s of perSymbol) {
		for (const sig of s.signals) {
			// реплей БЕЗ таймстопа (Infinity) — интересуют только сделки, закрывшиеся по stop/TP
			const t = replayE3Trade(s.rows, s.tr55, sig.signalIndex, sig.side, BASE, Infinity)
			if (t && (t.outcome === 'Stop' || t.outcome === 'Partial' || t.outcome === 'Full fix')) holdings.push(t.holdingBars)
		}
	}
	if (!holdings.length) return 200 // безопасный дефолт
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
	meanNetR: number
	meanPlaceboR: number
	meanExcess: number
	pValue: number
	clusters: number
	shortShare: number
}

const mean = (a: readonly number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)

/**
 * Cluster-aware bootstrap p-value: H0 = mean excess <= 0.
 * Ресемплим КЛАСТЕРЫ (не отдельные сделки); кластер = (side, bucket4h).
 * p = доля бутстрэп-выборок, где среднее excess <= 0.
 */
function bootstrapClusterP(results: readonly TradeResult[], rng: () => number): { p: number; clusters: number } {
	const valid = results.filter((r) => Number.isFinite(r.excess))
	// сгруппировать excess по кластерам
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
		let sum = 0
		let cnt = 0
		for (let i = 0; i < C; i++) {
			const cl = clusters[(rng() * C) | 0]!
			for (const x of cl) { sum += x; cnt++ }
		}
		if (cnt > 0 && sum / cnt <= 0) leZero++
	}
	return { p: leZero / BOOTSTRAP_SAMPLES, clusters: C }
}

function summarizeGroup(results: readonly TradeResult[], rng: () => number): GroupStats {
	const n = results.length
	const nets = results.map((r) => r.realNetR).filter(Number.isFinite)
	const placebos = results.map((r) => r.placeboMeanNetR).filter(Number.isFinite)
	const excesses = results.map((r) => r.excess).filter(Number.isFinite)
	const endMarks = results.filter((r) => r.realHitTimestop).length
	const shorts = results.filter((r) => r.side === -1).length
	const { p, clusters } = bootstrapClusterP(results, rng)
	return {
		n,
		endMarkRate: n ? endMarks / n : NaN,
		meanNetR: mean(nets),
		meanPlaceboR: mean(placebos),
		meanExcess: mean(excesses),
		pValue: p,
		clusters,
		shortShare: n ? shorts / n : NaN,
	}
}

interface KillEval { killed: boolean; reasons: string[] }
function evaluateKill(inSample: GroupStats, oos: GroupStats): KillEval {
	const reasons: string[] = []
	if (!(inSample.meanExcess >= KILL_EXCESS_MIN)) reasons.push(`mean excess ${fmt(inSample.meanExcess)}R < +${KILL_EXCESS_MIN}R (in-sample)`)
	if (!(inSample.pValue <= KILL_P_MAX)) reasons.push(`bootstrap p ${fmt(inSample.pValue)} > ${KILL_P_MAX}`)
	if (!(oos.meanExcess >= 0)) reasons.push(`OOS mean excess ${fmt(oos.meanExcess)}R < 0`)
	return { killed: reasons.length > 0, reasons }
}

const fmt = (x: number, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a')
const pct = (x: number) => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a')

// ============================================================================
// Main
// ============================================================================
interface LegOutput {
	name: string
	timestop: number
	inSample: GroupStats
	oos: GroupStats
	kill: KillEval
	perAsset: Record<string, { inSample: boolean; n: number; meanNetR: number; meanExcess: number }>
}

async function main() {
	console.log('[e3] запуск placebo-normalized NET re-measurement (E3)')

	// —— доступность символов по нужным TF ——
	const zc5InSample = ZC5_SYMBOLS.filter((s) => {
		const ok = hasKlines(s, 60) && hasKlines(s, 240)
		if (!ok) console.log(`[e3] ZC5 in-sample: пропущен ${s} (нет 1h+4h кэша)`)
		return ok
	})
	const oosSymbols = OOS_CANDIDATES.filter((s) => {
		const okZc5 = hasKlines(s, 60) && hasKlines(s, 240)
		if (!okZc5) console.log(`[e3] OOS: пропущен ${s} (нет 1h+4h кэша для обеих ног)`) // pd_premium тоже требует 4h (HTF)
		return okZc5
	})
	console.log(`[e3] ZC5 in-sample assets: ${zc5InSample.join(', ')}`)
	console.log(`[e3] OOS assets: ${oosSymbols.join(', ')}`)

	// одна общая RNG для воспроизводимости (плацебо + bootstrap)
	const rng = mulberry32(SEED)

	// ============ LEG A: ZC5 SELECTIVE ============
	console.log('\n[e3] === Leg A: ZC5 SELECTIVE ===')
	const zc5InData = zc5InSample.map((s) => { const d = collectZc5Selective(s); if (d) console.log(`[e3][A] ${s}: signals=${d.signals.length}`); return d ? { symbol: s, ...d } : null }).filter((x): x is NonNullable<typeof x> => x != null)
	const zc5OosData = oosSymbols.map((s) => { const d = collectZc5Selective(s); if (d) console.log(`[e3][A][oos] ${s}: signals=${d.signals.length}`); return d ? { symbol: s, ...d } : null }).filter((x): x is NonNullable<typeof x> => x != null)

	const tsA = calibrateTimestop(zc5InData)
	console.log(`[e3][A] TIMESTOP (медиана длин закрытых, in-sample) = ${tsA} баров`)

	const legAInResults: TradeResult[] = []
	const legAPerAsset: LegOutput['perAsset'] = {}
	for (const d of zc5InData) {
		const rs = measureSymbol(d.rows, d.tr55, d.signals, tsA, rng)
		legAInResults.push(...rs)
		legAPerAsset[d.symbol] = { inSample: true, n: rs.length, meanNetR: mean(rs.map((r) => r.realNetR).filter(Number.isFinite)), meanExcess: mean(rs.map((r) => r.excess).filter(Number.isFinite)) }
	}
	const legAOosResults: TradeResult[] = []
	for (const d of zc5OosData) {
		const rs = measureSymbol(d.rows, d.tr55, d.signals, tsA, rng)
		legAOosResults.push(...rs)
		legAPerAsset[d.symbol] = { inSample: false, n: rs.length, meanNetR: mean(rs.map((r) => r.realNetR).filter(Number.isFinite)), meanExcess: mean(rs.map((r) => r.excess).filter(Number.isFinite)) }
	}
	const legAIn = summarizeGroup(legAInResults, rng)
	const legAOos = summarizeGroup(legAOosResults, rng)
	const legAKill = evaluateKill(legAIn, legAOos)
	const legA: LegOutput = { name: 'ZC5 SELECTIVE', timestop: tsA, inSample: legAIn, oos: legAOos, kill: legAKill, perAsset: legAPerAsset }

	// ============ LEG B: pd_premium (D3) ============
	console.log('\n[e3] === Leg B: pd_premium (D3, relVol 1.4, premium-4h) ===')
	const pdInData = zc5InSample.filter((s) => hasKlines(s, PD_TF_MINUTES) && hasKlines(s, 240)).map((s) => { const d = collectPdPremium(s, PD_TF_MINUTES); if (d) console.log(`[e3][B] ${s}: signals=${d.signals.length}`); return d ? { symbol: s, ...d } : null }).filter((x): x is NonNullable<typeof x> => x != null)
	const pdOosData = oosSymbols.filter((s) => hasKlines(s, PD_TF_MINUTES) && hasKlines(s, 240)).map((s) => { const d = collectPdPremium(s, PD_TF_MINUTES); if (d) console.log(`[e3][B][oos] ${s}: signals=${d.signals.length}`); return d ? { symbol: s, ...d } : null }).filter((x): x is NonNullable<typeof x> => x != null)

	const tsB = calibrateTimestop(pdInData)
	console.log(`[e3][B] TIMESTOP (медиана длин закрытых, in-sample) = ${tsB} баров`)

	const legBInResults: TradeResult[] = []
	const legBPerAsset: LegOutput['perAsset'] = {}
	for (const d of pdInData) {
		const rs = measureSymbol(d.rows, d.tr55, d.signals, tsB, rng)
		legBInResults.push(...rs)
		legBPerAsset[d.symbol] = { inSample: true, n: rs.length, meanNetR: mean(rs.map((r) => r.realNetR).filter(Number.isFinite)), meanExcess: mean(rs.map((r) => r.excess).filter(Number.isFinite)) }
	}
	const legBOosResults: TradeResult[] = []
	for (const d of pdOosData) {
		const rs = measureSymbol(d.rows, d.tr55, d.signals, tsB, rng)
		legBOosResults.push(...rs)
		legBPerAsset[d.symbol] = { inSample: false, n: rs.length, meanNetR: mean(rs.map((r) => r.realNetR).filter(Number.isFinite)), meanExcess: mean(rs.map((r) => r.excess).filter(Number.isFinite)) }
	}
	const legBIn = summarizeGroup(legBInResults, rng)
	const legBOos = summarizeGroup(legBOosResults, rng)
	const legBKill = evaluateKill(legBIn, legBOos)
	const legB: LegOutput = { name: 'pd_premium (D3)', timestop: tsB, inSample: legBIn, oos: legBOos, kill: legBKill, perAsset: legBPerAsset }

	// ============ OUTPUT ============
	const legs = [legA, legB]

	// JSON
	writeFileSync(resolve('ci-results/e3-placebo-net.json'), JSON.stringify({
		generatedAt: new Date().toISOString(),
		protocol: 'E3-placebo-net-1.0',
		config: {
			seed: SEED, kPlacebo: K_PLACEBO, placeboWindowDays: 30, bootstrapSamples: BOOTSTRAP_SAMPLES,
			clusterMs: CLUSTER_MS, cost: '7bps/side; costR=turnover*0.0007/oneR; oneR=stopDistance',
			base: BASE, killCriteria: { excessMin: KILL_EXCESS_MIN, pMax: KILL_P_MAX, oosExcessMin: 0 },
			zc5InSample, oosSymbols, pdTfMinutes: PD_TF_MINUTES,
		},
		legs: legs.map((l) => ({
			name: l.name, timestop: l.timestop,
			inSample: l.inSample, oos: l.oos,
			verdict: l.kill.killed ? 'KILLED' : 'SURVIVES', killReasons: l.kill.reasons,
			perAsset: l.perAsset,
		})),
	}, null, 2))

	// Markdown (Russian)
	const md: string[] = []
	md.push('# E3 — Плацебо-нормированный NET-пересчёт (ZC5 SELECTIVE и pd_premium)')
	md.push('')
	md.push('EXPLORATORY re-measurement. NET (7 bps/сторона), 5 фиксов внутри `replayE3Trade`,')
	md.push('плацебо K=20 (±30 дней, valid-band-only, same symbol+side), cluster-aware bootstrap')
	md.push(`(${BOOTSTRAP_SAMPLES} ресемплов, seed ${SEED}, кластер = (side, 4h-bucket)).`)
	md.push('')
	md.push('**Kill-criteria (per leg):** KILL если ЛЮБОЕ — mean excess < +0.05R (net), ИЛИ')
	md.push(`bootstrap p > ${KILL_P_MAX}, ИЛИ mean excess < 0 на OOS. Иначе SURVIVES.`)
	md.push('')
	const groupRow = (label: string, g: GroupStats) => `| ${label} | ${g.n} | ${pct(g.endMarkRate)} | ${fmt(g.meanNetR)} | ${fmt(g.meanPlaceboR)} | ${fmt(g.meanExcess)} | ${fmt(g.pValue, 4)} | ${g.clusters} | ${pct(g.shortShare)} |`
	for (const l of legs) {
		md.push(`## Leg — ${l.name}`)
		md.push('')
		md.push(`TIMESTOP (медиана длин stop/TP-закрытых сделок, in-sample) = **${l.timestop}** баров.`)
		md.push('')
		md.push('| группа | n | End-mark rate | mean netR | mean placebo netR | mean excess | bootstrap p | clusters | short-share |')
		md.push('|---|---|---|---|---|---|---|---|---|')
		md.push(groupRow('IN-SAMPLE (12 ZC5)', l.inSample))
		md.push(groupRow('OOS (unseen)', l.oos))
		md.push('')
		md.push(`**Вердикт: ${l.kill.killed ? '❌ KILLED' : '✅ SURVIVES'}**`)
		if (l.kill.reasons.length) { md.push(''); md.push('Сработавшие kill-условия:'); for (const r of l.kill.reasons) md.push(`- ${r}`) }
		md.push('')
		const shortHi = l.inSample.shortShare > 0.6 || l.oos.shortShare > 0.6
		md.push(`Профиль short-beta: доля шортов in-sample ${pct(l.inSample.shortShare)}, OOS ${pct(l.oos.shortShare)}${shortHi ? ' — перекос в шорт заметен (возможная short-beta).' : ' — выраженного перекоса в шорт нет.'}`)
		md.push('')
		md.push('### Per-asset breakdown')
		md.push('')
		md.push('| asset | split | n | mean netR | mean excess |')
		md.push('|---|---|---|---|---|')
		for (const [sym, a] of Object.entries(l.perAsset)) md.push(`| ${sym} | ${a.inSample ? 'in' : 'oos'} | ${a.n} | ${fmt(a.meanNetR)} | ${fmt(a.meanExcess)} |`)
		md.push('')
	}
	writeFileSync(resolve('ci-results/e3-placebo-net.md'), md.join('\n'))

	// Console summary
	console.log('\n===== E3 SUMMARY =====')
	for (const l of legs) {
		console.log(`\n[${l.name}] timestop=${l.timestop} bars`)
		console.log(`  IN : n=${l.inSample.n} endMark=${pct(l.inSample.endMarkRate)} netR=${fmt(l.inSample.meanNetR)} placebo=${fmt(l.inSample.meanPlaceboR)} excess=${fmt(l.inSample.meanExcess)} p=${fmt(l.inSample.pValue)} clusters=${l.inSample.clusters}`)
		console.log(`  OOS: n=${l.oos.n} endMark=${pct(l.oos.endMarkRate)} netR=${fmt(l.oos.meanNetR)} placebo=${fmt(l.oos.meanPlaceboR)} excess=${fmt(l.oos.meanExcess)} p=${fmt(l.oos.pValue)} clusters=${l.oos.clusters}`)
		console.log(`  ВЕРДИКТ: ${l.kill.killed ? 'KILLED' : 'SURVIVES'}${l.kill.reasons.length ? ' [' + l.kill.reasons.join('; ') + ']' : ''}`)
	}
	console.log('\n[e3] written ci-results/e3-placebo-net.json и ci-results/e3-placebo-net.md')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => { console.error(err); process.exit(1) })
}
