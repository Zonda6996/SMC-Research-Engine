// D4b — рыночный режим-гейт по РЕАЛИЗОВАННОЙ ВОЛАТИЛЬНОСТИ BTC (трек D, docs/ROADMAP.md).
//
// Контекст: D4 гейтил активную сторону макро-трендом BTC (SMA). ЗДЕСЬ — тот же вопрос, но
//   режим определяется РЕАЛИЗОВАННОЙ ВОЛАТИЛЬНОСТЬЮ BTC-2h (std лог-доходностей vs трейлинг-медиана).
//   Нейтральная гипотеза directional-мэппинга: risk-off (high-vol) → short, risk-on (low-vol) → long.
//
// Метод: генерация сделок ВЕРБАТИМ повторяет tools/research/regimeGateD4.ts (который сам зеркалит
//   shortStaticWalkForward.ts): safe-геометрия, static-тейк 2×step, cost-путь. Все сделки по 5 активам × 3 ТФ
//   пулятся в Row[]. Затем каждая сделка тегируется vol-режимом BTC-2h на момент signalAt и сравниваются гейты.
// §2.1: порогов нет, окна VOL_WINDOW+VOL_MEDIAN_WINDOW заранее заданы и НЕ свипаются. §2.3: src не тронут,
//   replayStatic + stats-хелперы + Row-loop скопированы вербатим из regimeGateD4.ts.
// Данные — офлайн кэш. Запуск: npx tsx tools/research/regimeGateD4Vol.ts. Дата: 2026-08-14.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { admitArrowSignals, detectArrowSignalCandidates, type ArrowSide, type ArrowSignal } from '../../src/core/signals/ArrowSignalEngine.js'
import { ARROW_MODE_CONFIGS } from '../../src/core/signals/ArrowTradeReplay.js'

const ASSETS = ['SOL', 'BTC', 'ETH', 'XRP', 'BNB'] as const
const TIMEFRAMES = ['30m', '1h', '2h'] as const
const GEO = 'safe' as const
const TARGET_STEPS = 2 // валидированный baseline из D1/D1.2
const CLUSTER_MS = 4 * 60 * 60 * 1000
const BOOTSTRAP_SAMPLES = 2000
const BOOTSTRAP_SEED = 20260807

// E1-фикс: frozen relVol≥1.4 (zonda-reversal.md) передаём ЯВНО 3-м аргументом detectArrowSignalCandidates.
// Дефолт движка minimumRelativeVolume=0.0 (DEFAULT_ARROW_SIGNAL_CONFIG) — без этого фильтр объёма ВЫКЛЮЧЕН.
// §2.1: значение заранее задано (frozen), НЕ свипается. §2.3: движок не тронут — только явный аргумент.
const FROZEN_REL_VOL = 1.4

// ⚠ окна режима — заранее заданные нейтральные прокси, НЕ свипаются (§2.1, во избежание selection bias). Финальное определение режима — решение автора.
const VOL_WINDOW = 120 // ≈10 дней на 2h; горизонт реализованной волатильности (число баров в трейлинг-std лог-доходностей)
const VOL_MEDIAN_WINDOW = 1000 // трейлинг-окно для порога high/low (медиана realizedVol)

type VolRegime = 'high' | 'low' | null
type Outcome = 'full-tp' | 'stop' | 'timeout' | 'open'
interface Row { asset: string; timeframe: string; side: ArrowSide; netR: number; outcome: Outcome; signalAt: number; quarter: string; cluster: string; volRegime: VolRegime }

const favorableWick = (side: ArrowSide, c: Candle, lvl: number) => side === 'long' ? c.high >= lvl : c.low <= lvl
const adverseWick = (side: ArrowSide, c: Candle, lvl: number) => side === 'long' ? c.low <= lvl : c.high >= lvl
const directionalPnl = (side: ArrowSide, entry: number, exit: number) => side === 'long' ? exit - entry : entry - exit

// —— replayStatic скопирован ВЕРБАТИМ из regimeGateD4.ts (§2.3: src не тронут) ——
function replayStatic(candles: readonly Candle[], signal: ArrowSignal): { side: ArrowSide; netR: number; outcome: Outcome; signalAt: number } | null {
	const cfg = ARROW_MODE_CONFIGS[GEO]
	const entryIndex = signal.signalIndex + 1
	const entryCandle = candles[entryIndex]
	if (entryCandle == null || !Number.isFinite(signal.atr200) || signal.atr200 <= 0) return null
	const step = 5.5 * signal.atr200 / cfg.stepDivisor
	const entry = entryCandle.open
	if (!(entry > 0) || !(step > 0)) return null
	const add = signal.side === 'long' ? entry - step : entry + step
	const stop = signal.side === 'long' ? entry - cfg.stopSteps * step : entry + cfg.stopSteps * step
	const staticFull = signal.side === 'long' ? entry + TARGET_STEPS * step : entry - TARGET_STEPS * step
	const oneR = Math.abs((entry + add) / 2 - stop) * 2
	if (!(oneR > 0)) return null
	let addFilled = false, weight = 1, averageEntry = entry, turnover = Math.abs(entry)
	let exitIndex: number | null = null, exitPrice = entry, outcome: Outcome = 'open'
	const lastIndex = Math.min(candles.length - 1, entryIndex + cfg.maxHoldingBars - 1)
	for (let i = entryIndex; i <= lastIndex; i++) {
		const c = candles[i]!
		if (!addFilled && adverseWick(signal.side, c, add)) { addFilled = true; averageEntry = (averageEntry * weight + add) / (weight + 1); weight += 1; turnover += Math.abs(add) }
		if (adverseWick(signal.side, c, stop)) { exitIndex = i; exitPrice = stop; outcome = 'stop'; turnover += Math.abs(stop) * weight; break }
		if (favorableWick(signal.side, c, staticFull)) { exitIndex = i; exitPrice = staticFull; outcome = 'full-tp'; turnover += Math.abs(staticFull) * weight; break }
	}
	if (exitIndex == null && lastIndex < candles.length - 1) { exitIndex = lastIndex; exitPrice = candles[lastIndex]!.close; outcome = 'timeout'; turnover += Math.abs(exitPrice) * weight }
	else if (exitIndex == null) { exitPrice = candles[candles.length - 1]!.close; outcome = 'open' }
	const grossR = (directionalPnl(signal.side, averageEntry, exitPrice) * weight) / oneR
	const costR = (turnover * cfg.oneWayCostBps / 10_000) / oneR
	return { side: signal.side, netR: grossR - costR, outcome, signalAt: signal.signalAt }
}

// —— stats helpers скопированы ВЕРБАТИМ из regimeGateD4.ts ——
function quantile(xs: readonly number[], q: number): number | null { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y), p = (a.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return a[lo]! + (a[hi]! - a[lo]!) * (p - lo) }
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296) }
function bootstrapCI(values: readonly number[], seedSalt: string): [number | null, number | null] {
	if (values.length < 2) return [null, null]
	const hash = createHash('sha256').update(seedSalt).digest().readUInt32LE(0)
	const random = rng(BOOTSTRAP_SEED ^ hash), means: number[] = []
	for (let b = 0; b < BOOTSTRAP_SAMPLES; b++) { let sum = 0; for (let i = 0; i < values.length; i++) sum += values[Math.floor(random() * values.length)]!; means.push(sum / values.length) }
	return [quantile(means, 0.025), quantile(means, 0.975)]
}
function summ(rows: readonly Row[], salt: string) {
	const v = rows.map(t => t.netR).filter(Number.isFinite)
	const gains = v.filter(x => x > 0).reduce((a, b) => a + b, 0), losses = -v.filter(x => x < 0).reduce((a, b) => a + b, 0)
	return { N: rows.length, meanR: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, totalR: v.reduce((a, b) => a + b, 0), ci: bootstrapCI(v, salt), pf: losses > 0 ? gains / losses : gains > 0 ? 'Infinity' : null, clusters: new Set(rows.map(t => t.cluster)).size }
}
const quarterOf = (ms: number) => { const d = new Date(ms); return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}` }

// ============================================================================
// STEP 2 — Причинный (causal) рыночный режим по РЕАЛИЗОВАННОЙ ВОЛАТИЛЬНОСТИ BTC-2h.
// ⚠ Причинность (no look-ahead):
//   realizedVol[i] = выборочное стд лог-доходностей за трейлинг VOL_WINDOW баров, заканчивающихся на i (bars <= i).
//   med[i]         = медиана realizedVol за трейлинг VOL_MEDIAN_WINDOW ОПРЕДЕЛЁННЫХ значений, заканчивающихся на i.
//   regime[i]      = 'high' если realizedVol[i] > med[i] иначе 'low'; undefined пока обоих окон не хватает.
//   regimeAsOf     = режим последнего ПОЛНОСТЬЮ ЗАКРЫТОГО BTC-бара (openTs + barMs <= signalAt; бинпоиск). null если бара нет / warmup.
//   => трейлинг-std + трейлинг-медиана + последний ЗАКРЫТЫЙ бар — никакого будущего (timestamp = время ОТКРЫТИЯ бара).
// ============================================================================
const btcRegimePath = resolve(`tools/batch/cache/BTC-USDT_2h_20000_futures.json`)
let btcTimestamps: number[] = []
let btcRegime: VolRegime[] = []
let btcBarsLoaded = 0
let btcHighBars = 0
let btcLowBars = 0
if (existsSync(btcRegimePath)) {
	const btc = JSON.parse(readFileSync(btcRegimePath, 'utf8')) as Candle[]
	btcBarsLoaded = btc.length
	btcTimestamps = btc.map(c => c.timestamp)

	// лог-доходности r_k = ln(close_k / close_{k-1}); logRet[0] undefined (нет предыдущего бара)
	const logRet: (number | null)[] = btc.map((c, i) => {
		if (i === 0) return null
		const prev = btc[i - 1]!.close, cur = c.close
		if (!(prev > 0) || !(cur > 0)) return null
		return Math.log(cur / prev)
	})

	// realizedVol[i]: выборочное стд последних VOL_WINDOW лог-доходностей, заканчивающихся на баре i (строго causal, bars <= i)
	const realizedVol: (number | null)[] = btc.map((_c, i) => {
		if (i < VOL_WINDOW) return null // недостаточно баров/доходностей для окна
		const window: number[] = []
		for (let j = i - VOL_WINDOW + 1; j <= i; j++) { const r = logRet[j]; if (r == null || !Number.isFinite(r)) return null; window.push(r) }
		if (window.length < 2) return null
		const mean = window.reduce((a, b) => a + b, 0) / window.length
		let ss = 0; for (const r of window) ss += (r - mean) * (r - mean)
		return Math.sqrt(ss / (window.length - 1)) // выборочное (n-1) стандартное отклонение
	})

	// med[i]: медиана realizedVol за трейлинг VOL_MEDIAN_WINDOW ОПРЕДЕЛЁННЫХ значений, заканчивающихся на i (causal)
	btcRegime = btc.map((_c, i) => {
		const rv = realizedVol[i]
		if (rv == null) return null
		const defined: number[] = []
		for (let j = i; j >= 0 && defined.length < VOL_MEDIAN_WINDOW; j--) { const v = realizedVol[j]; if (v != null) defined.push(v) }
		if (defined.length < VOL_MEDIAN_WINDOW) return null // недостаточно определённых значений для медианного окна
		const med = quantile(defined, 0.5)
		if (med == null) return null
		const reg: VolRegime = rv > med ? 'high' : 'low'
		if (reg === 'high') btcHighBars++; else btcLowBars++
		return reg
	})
}

// regimeAsOf: режим последнего ПОЛНОСТЬЮ ЗАКРЫТОГО BTC-бара (openTs + barMs <= signalAt; бинпоиск).
// null если закрытого бара нет / warmup. Причинно: только трейлинг-std, трейлинг-медиана и последний
// ЗАКРЫТЫЙ бар. Важно: timestamp свечи = время ОТКРЫТИЯ бара, поэтому close бара, который на момент
// signalAt ещё не закрылся (openTs+barMs>signalAt), — это look-ahead; такой бар пропускаем.
function regimeAsOf(signalAt: number): VolRegime {
	if (btcTimestamps.length < 2) return null
	const barMs = btcTimestamps[1]! - btcTimestamps[0]! // шаг сетки = длительность бара (2h)
	let lo = 0, hi = btcTimestamps.length - 1, idx = -1
	while (lo <= hi) {
		const mid = (lo + hi) >> 1
		if (btcTimestamps[mid]! + barMs <= signalAt) { idx = mid; lo = mid + 1 } else { hi = mid - 1 }
	}
	if (idx < 0) return null
	return btcRegime[idx] ?? null
}

// ============================================================================
// STEP 1 + 3 — сбор пула сделок (ВЕРБАТИМ логика Row-loop) + тег vol-режима.
// ============================================================================
const all: Row[] = []
const skipped: string[] = []
for (const asset of ASSETS) for (const timeframe of TIMEFRAMES) {
	const path = resolve(`tools/batch/cache/${asset}-USDT_${timeframe}_20000_futures.json`)
	if (!existsSync(path)) { skipped.push(`${asset} ${timeframe}`); continue }
	const candles = JSON.parse(readFileSync(path, 'utf8')) as Candle[]
	const detection = detectArrowSignalCandidates(candles, APEX_PARAMS, { minimumRelativeVolume: FROZEN_REL_VOL })
	for (const signal of admitArrowSignals(detection.candidates)) {
		const t = replayStatic(candles, signal)
		if (t == null) continue
		all.push({ asset, timeframe, side: t.side, netR: t.netR, outcome: t.outcome, signalAt: t.signalAt, quarter: quarterOf(t.signalAt), cluster: `${Math.floor(t.signalAt / CLUSTER_MS)}-${t.side}`, volRegime: regimeAsOf(t.signalAt) })
	}
	process.stdout.write(`ok ${asset} ${timeframe}\n`)
}

const n2 = (x: any) => x == null ? 'n/a' : (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(3) : String(x))

// STEP 3 — исключаем no-regime (warmup) строки из гейт-сравнений.
const noRegimeRows = all.filter(t => t.volRegime == null)
const gated = all.filter(t => t.volRegime != null)

// ============================================================================
// STEP 4 — гейты/бакеты на ОДНОМ пуле (только строки с определённым vol-режимом).
// ============================================================================
// A) Сырой per-bucket разбор (ничего не спрятано)
const buckets: Record<string, Row[]> = {
	high_all: gated.filter(t => t.volRegime === 'high'),
	high_long: gated.filter(t => t.volRegime === 'high' && t.side === 'long'),
	high_short: gated.filter(t => t.volRegime === 'high' && t.side === 'short'),
	low_all: gated.filter(t => t.volRegime === 'low'),
	low_long: gated.filter(t => t.volRegime === 'low' && t.side === 'long'),
	low_short: gated.filter(t => t.volRegime === 'low' && t.side === 'short'),
}
const bucketResults: Record<string, ReturnType<typeof summ>> = {}
for (const [name, rows] of Object.entries(buckets)) bucketResults[name] = summ(rows, `d4b-bucket-${name}`)

// B) directional мэппинг (нейтральная гипотеза risk-off→short / risk-on→long) + C) baseline
const isAligned = (t: Row) => (t.side === 'long' && t.volRegime === 'low') || (t.side === 'short' && t.volRegime === 'high')
const isAnti = (t: Row) => (t.side === 'long' && t.volRegime === 'high') || (t.side === 'short' && t.volRegime === 'low')

const gateRows: Record<string, Row[]> = {
	baseline_all: gated,
	vol_aligned: gated.filter(isAligned),
	vol_anti: gated.filter(isAnti),
}

// train/OOS 65/35 split BY TIME
function splitByTime(rows: readonly Row[]): { train: Row[]; oos: Row[] } {
	const sorted = [...rows].sort((a, b) => a.signalAt - b.signalAt)
	const cut = Math.floor(sorted.length * 0.65)
	return { train: sorted.slice(0, cut), oos: sorted.slice(cut) }
}

const gateResults: Record<string, { full: ReturnType<typeof summ>; train: ReturnType<typeof summ>; oos: ReturnType<typeof summ> }> = {}
for (const [name, rows] of Object.entries(gateRows)) {
	const { train, oos } = splitByTime(rows)
	gateResults[name] = {
		full: summ(rows, `d4b-${name}-full`),
		train: summ(train, `d4b-${name}-train`),
		oos: summ(oos, `d4b-${name}-oos`),
	}
}

// ============================================================================
// STEP 5 — breadth + per-quarter aligned.
// ============================================================================
const breadthAligned = ASSETS.map(a => { const s = summ(gateRows.vol_aligned!.filter(t => t.asset === a), `d4b-aligned-${a}`); return { asset: a, N: s.N, meanR: s.meanR } })
const breadthBaseline = ASSETS.map(a => { const s = summ(gateRows.baseline_all!.filter(t => t.asset === a), `d4b-baseline-${a}`); return { asset: a, N: s.N, meanR: s.meanR } })

const alignedRows = gateRows.vol_aligned!
const quarters = [...new Set(alignedRows.map(t => t.quarter))].sort()
const perQuarterAligned = quarters.map(q => { const s = summ(alignedRows.filter(t => t.quarter === q), `d4b-aligned-${q}`); return { quarter: q, N: s.N, meanR: s.meanR, ci: s.ci, pf: s.pf } }).filter(r => r.N > 0)
const quartersWithAlignedData = perQuarterAligned.filter(r => r.N >= 10)
const alignedPositiveQuarters = quartersWithAlignedData.filter(r => (r.meanR ?? 0) > 0).length

// ============================================================================
// STEP 6 — console output.
// ============================================================================
console.log(`\n===== D4b — рыночный режим-гейт (BTC-2h realized-vol) =====`)
console.log(`BTC-2h баров загружено: ${btcBarsLoaded}; VOL_WINDOW=${VOL_WINDOW}; VOL_MEDIAN_WINDOW=${VOL_MEDIAN_WINDOW}`)
console.log(`BTC-баров high-vol: ${btcHighBars}; low-vol: ${btcLowBars}`)
console.log(`Пул сделок всего: ${all.length}; no-regime (warmup) исключено: ${noRegimeRows.length}; в гейтах: ${gated.length}`)
if (skipped.length) console.log(`Пропущено кэшей: ${skipped.join(', ')}`)

console.log(`\n----- (A) сырой per-bucket разбор (high/low × all/long/short) -----`)
console.table(Object.entries(bucketResults).map(([name, r]) => ({ bucket: name, N: r.N, meanR: n2(r.meanR), CIlo: n2(r.ci[0]), CIhi: n2(r.ci[1]), PF: n2(r.pf), clusters: r.clusters })))

console.log(`\n----- (B+C) aligned / anti / baseline (full-history) -----`)
console.table(Object.entries(gateResults).map(([name, r]) => ({ gate: name, N: r.full.N, meanR: n2(r.full.meanR), CIlo: n2(r.full.ci[0]), CIhi: n2(r.full.ci[1]), PF: n2(r.full.pf), clusters: r.full.clusters })))

console.log(`\n----- train/OOS 65-35 по времени (baseline / aligned / anti) -----`)
const oosGates = ['baseline_all', 'vol_aligned', 'vol_anti']
const oosRows: any[] = []
for (const name of oosGates) {
	const r = gateResults[name]!
	oosRows.push({ gate: name, split: 'train', N: r.train.N, meanR: n2(r.train.meanR), CIlo: n2(r.train.ci[0]), CIhi: n2(r.train.ci[1]), PF: n2(r.train.pf) })
	oosRows.push({ gate: name, split: 'OOS', N: r.oos.N, meanR: n2(r.oos.meanR), CIlo: n2(r.oos.ci[0]), CIhi: n2(r.oos.ci[1]), PF: n2(r.oos.pf) })
}
console.table(oosRows)

console.log(`\n----- breadth: aligned vs baseline (per asset) -----`)
console.table(ASSETS.map(a => {
	const al = breadthAligned.find(x => x.asset === a)!, ba = breadthBaseline.find(x => x.asset === a)!
	return { asset: a, alignedN: al.N, alignedMeanR: n2(al.meanR), baselineN: ba.N, baselineMeanR: n2(ba.meanR) }
}))

console.log(`\n----- per-quarter (vol_aligned) -----`)
console.table(perQuarterAligned.map(r => ({ quarter: r.quarter, N: r.N, meanR: n2(r.meanR), CIlo: n2(r.ci[0]), CIhi: n2(r.ci[1]), PF: n2(r.pf) })))
console.log(`Кварталов с N(aligned)>=10: ${quartersWithAlignedData.length}; из них meanR>0: ${alignedPositiveQuarters} (${quartersWithAlignedData.length ? (100 * alignedPositiveQuarters / quartersWithAlignedData.length).toFixed(0) : 0}%)`)

// ============================================================================
// STEP 7 — write JSON artifact.
// ============================================================================
writeFileSync(resolve('ci-results/regime-gate-d4b-vol.json'), JSON.stringify({
	generatedAt: new Date().toISOString(),
	protocol: 'D4b-market-regime-gate-realized-vol-1.0',
	fixedStrategy: { geometry: GEO, exit: 'static-full', targetSteps: TARGET_STEPS, costsBps: 7 },
	regimeProxy: {
		series: 'BTC-2h',
		rule: 'realized-vol (std of log-returns) vs trailing median',
		volWindow: VOL_WINDOW,
		medianWindow: VOL_MEDIAN_WINDOW,
		mapping: 'aligned = long in low-vol / short in high-vol',
		causal: true,
		note: 'pre-registered, NOT swept (§2.1); directional mapping is a stated neutral hypothesis, raw per-bucket long/short also reported',
	},
	buckets: bucketResults,
	gates: gateResults,
	breadthAligned,
	breadthBaseline,
	perQuarterAligned,
	alignedPositiveQuarters,
	quartersWithAlignedData: quartersWithAlignedData.length,
	noRegimeRowCount: noRegimeRows.length,
	btcBarsLoaded,
	btcHighBars,
	btcLowBars,
	skipped,
	note: '§2.1 соблюдён: единственные заранее заданные окна VOL_WINDOW+VOL_MEDIAN_WINDOW, порогов/окон не свипаем. §2.3 соблюдён: src не тронут, replayStatic и stats-хелперы + Row-loop скопированы вербатим из regimeGateD4.ts. Режим строго причинный (трейлинг-std лог-доходностей + трейлинг-медиана + последний BTC-бар с ts<=signalAt).',
}, null, 2))
console.log(`\nWrote ci-results/regime-gate-d4b-vol.json`)
