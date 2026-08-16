// D4b-OOS — честная out-of-sample проверка гейта «high-vol-only on/off» (трек D, docs/ROADMAP.md).
//
// Контекст: сырые бакеты D4b показали, что low-vol сделки значимо отрицательны
//   (low_all −0.135 CI [−0.214,−0.053]; low_long −0.181 CI [−0.303,−0.064], оба исключают 0),
//   а high-vol ≈ безубыток (high_all +0.017). Это full-history ЛИД, который надо провалидировать
//   OOS, прежде чем называть реальным риск-фильтром. Этот раннер — честная OOS-проверка:
//   НИКАКИХ новых порогов (тот же VOL_WINDOW=120, VOL_MEDIAN_WINDOW=1000 режим, §2.1).
//
// Метод: генерация сделок, stats-хелперы, Row-loop и причинный BTC-2h realized-vol режим
//   скопированы ВЕРБАТИМ из tools/research/regimeGateD4Vol.ts (§2.3: src не тронут). Все сделки по
//   5 активам × 3 ТФ пулятся в Row[], тегируются vol-режимом BTC-2h на момент signalAt.
//   Три набора участия (on/off, обе стороны): baseline_all / high_only / low_only.
//   Для каждого — full / train(65%) / OOS(35%) по времени с bootstrap CI.
// §2.1: порогов нет, окна заранее заданы и НЕ свипаются. §2.3: src не тронут, replayStatic +
//   stats-хелперы + Row-loop + режим скопированы вербатим. Данные — офлайн кэш.
// Запуск: npx tsx tools/research/regimeGateD4bHighVolOos.ts.

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

// ⚠ окна режима — заранее заданные нейтральные прокси, НЕ свипаются (§2.1). Те же, что в D4b.
const VOL_WINDOW = 120 // ≈10 дней на 2h; горизонт реализованной волатильности
const VOL_MEDIAN_WINDOW = 1000 // трейлинг-окно для порога high/low (медиана realizedVol)

type VolRegime = 'high' | 'low' | null
type Outcome = 'full-tp' | 'stop' | 'timeout' | 'open'
interface Row { asset: string; timeframe: string; side: ArrowSide; netR: number; outcome: Outcome; signalAt: number; quarter: string; cluster: string; volRegime: VolRegime }

const favorableWick = (side: ArrowSide, c: Candle, lvl: number) => side === 'long' ? c.high >= lvl : c.low <= lvl
const adverseWick = (side: ArrowSide, c: Candle, lvl: number) => side === 'long' ? c.low <= lvl : c.high >= lvl
const directionalPnl = (side: ArrowSide, entry: number, exit: number) => side === 'long' ? exit - entry : entry - exit

// —— replayStatic скопирован ВЕРБАТИМ из regimeGateD4Vol.ts (§2.3: src не тронут) ——
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

// —— stats helpers скопированы ВЕРБАТИМ из regimeGateD4Vol.ts ——
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
// STEP 1 — Причинный (causal) BTC-2h realized-vol режим — ВЕРБАТИМ из regimeGateD4Vol.ts.
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

	const logRet: (number | null)[] = btc.map((c, i) => {
		if (i === 0) return null
		const prev = btc[i - 1]!.close, cur = c.close
		if (!(prev > 0) || !(cur > 0)) return null
		return Math.log(cur / prev)
	})

	const realizedVol: (number | null)[] = btc.map((_c, i) => {
		if (i < VOL_WINDOW) return null
		const window: number[] = []
		for (let j = i - VOL_WINDOW + 1; j <= i; j++) { const r = logRet[j]; if (r == null || !Number.isFinite(r)) return null; window.push(r) }
		if (window.length < 2) return null
		const mean = window.reduce((a, b) => a + b, 0) / window.length
		let ss = 0; for (const r of window) ss += (r - mean) * (r - mean)
		return Math.sqrt(ss / (window.length - 1))
	})

	btcRegime = btc.map((_c, i) => {
		const rv = realizedVol[i]
		if (rv == null) return null
		const defined: number[] = []
		for (let j = i; j >= 0 && defined.length < VOL_MEDIAN_WINDOW; j--) { const v = realizedVol[j]; if (v != null) defined.push(v) }
		if (defined.length < VOL_MEDIAN_WINDOW) return null
		const med = quantile(defined, 0.5)
		if (med == null) return null
		const reg: VolRegime = rv > med ? 'high' : 'low'
		if (reg === 'high') btcHighBars++; else btcLowBars++
		return reg
	})
}

// regimeAsOf — ВЕРБАТИМ из regimeGateD4Vol.ts: режим последнего BTC-бара с ts<=signalAt (бинпоиск).
function regimeAsOf(signalAt: number): VolRegime {
	if (!btcTimestamps.length) return null
	let lo = 0, hi = btcTimestamps.length - 1, idx = -1
	while (lo <= hi) {
		const mid = (lo + hi) >> 1
		if (btcTimestamps[mid]! <= signalAt) { idx = mid; lo = mid + 1 } else { hi = mid - 1 }
	}
	if (idx < 0) return null
	return btcRegime[idx] ?? null
}

// ============================================================================
// STEP 1 — сбор пула сделок (ВЕРБАТИМ логика Row-loop) + тег vol-режима.
// ============================================================================
const all: Row[] = []
const skipped: string[] = []
for (const asset of ASSETS) for (const timeframe of TIMEFRAMES) {
	const path = resolve(`tools/batch/cache/${asset}-USDT_${timeframe}_20000_futures.json`)
	if (!existsSync(path)) { skipped.push(`${asset} ${timeframe}`); continue }
	const candles = JSON.parse(readFileSync(path, 'utf8')) as Candle[]
	const detection = detectArrowSignalCandidates(candles, APEX_PARAMS)
	for (const signal of admitArrowSignals(detection.candidates)) {
		const t = replayStatic(candles, signal)
		if (t == null) continue
		all.push({ asset, timeframe, side: t.side, netR: t.netR, outcome: t.outcome, signalAt: t.signalAt, quarter: quarterOf(t.signalAt), cluster: `${Math.floor(t.signalAt / CLUSTER_MS)}-${t.side}`, volRegime: regimeAsOf(t.signalAt) })
	}
	process.stdout.write(`ok ${asset} ${timeframe}\n`)
}

const n2 = (x: any) => x == null ? 'n/a' : (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(3) : String(x))

// ============================================================================
// STEP 2 — исключаем warmup (null режим) и определяем три набора участия (on/off, обе стороны).
// ============================================================================
const noRegimeRows = all.filter(t => t.volRegime == null)
const gated = all.filter(t => t.volRegime != null)

const sets: Record<'baseline_all' | 'high_only' | 'low_only', Row[]> = {
	baseline_all: gated,                                   // торгуем всегда
	high_only: gated.filter(t => t.volRegime === 'high'),  // пропускаем low-vol (обе стороны)
	low_only: gated.filter(t => t.volRegime === 'low'),    // подозреваемый drag (обе стороны)
}

// train/OOS 65/35 split BY TIME (та же логика, что в D4b)
function splitByTime(rows: readonly Row[]): { train: Row[]; oos: Row[] } {
	const sorted = [...rows].sort((a, b) => a.signalAt - b.signalAt)
	const cut = Math.floor(sorted.length * 0.65)
	return { train: sorted.slice(0, cut), oos: sorted.slice(cut) }
}

// ============================================================================
// STEP 3 — для КАЖДОГО набора: full / train(65%) / OOS(35%) с различными bootstrap-солями.
// ============================================================================
const setResults: Record<string, { full: ReturnType<typeof summ>; train: ReturnType<typeof summ>; oos: ReturnType<typeof summ> }> = {}
for (const [name, rows] of Object.entries(sets)) {
	const { train, oos } = splitByTime(rows)
	setResults[name] = {
		full: summ(rows, `d4b-oos-${name}-full`),
		train: summ(train, `d4b-oos-${name}-train`),
		oos: summ(oos, `d4b-oos-${name}-oos`),
	}
}

// ============================================================================
// STEP 4 — breadth per asset (high_only, low_only), full + OOS; per-quarter для обоих.
// ============================================================================
function breadth(rows: readonly Row[], tag: string) {
	const { oos } = splitByTime(rows)
	const oosSet = new Set(oos) // объектные ссылки уникальны (Row[])
	return ASSETS.map(a => {
		const full = summ(rows.filter(t => t.asset === a), `d4b-oos-${tag}-full-${a}`)
		const oosA = summ(oos.filter(t => t.asset === a), `d4b-oos-${tag}-oos-${a}`)
		void oosSet
		return { asset: a, fullN: full.N, fullMeanR: full.meanR, oosN: oosA.N, oosMeanR: oosA.meanR }
	})
}
const breadthHighOnly = breadth(sets.high_only, 'high')
const breadthLowOnly = breadth(sets.low_only, 'low')

function perQuarter(rows: readonly Row[], tag: string) {
	const quarters = [...new Set(rows.map(t => t.quarter))].sort()
	const table = quarters.map(q => { const s = summ(rows.filter(t => t.quarter === q), `d4b-oos-${tag}-${q}`); return { quarter: q, N: s.N, meanR: s.meanR, ci: s.ci, pf: s.pf } }).filter(r => r.N > 0)
	const withData = table.filter(r => r.N >= 10)
	const positive = withData.filter(r => (r.meanR ?? 0) > 0).length
	return { table, withData: withData.length, positive, frac: withData.length ? positive / withData.length : null }
}
const pqHigh = perQuarter(sets.high_only, 'high')
const pqLow = perQuarter(sets.low_only, 'low')

// ============================================================================
// STEP 5 — console output.
// ============================================================================
console.log(`\n===== D4b-OOS — честная OOS-проверка гейта «high-vol-only on/off» (BTC-2h realized-vol) =====`)
console.log(`BTC-2h баров загружено: ${btcBarsLoaded}; VOL_WINDOW=${VOL_WINDOW}; VOL_MEDIAN_WINDOW=${VOL_MEDIAN_WINDOW} (те же окна, что в D4b — §2.1)`)
console.log(`BTC-баров high-vol: ${btcHighBars}; low-vol: ${btcLowBars}`)
console.log(`Пул сделок всего: ${all.length}; no-regime (warmup) исключено: ${noRegimeRows.length}; в наборах: ${gated.length}`)
console.log(`Размеры наборов: baseline_all=${sets.baseline_all.length}; high_only=${sets.high_only.length}; low_only=${sets.low_only.length}`)
if (skipped.length) console.log(`Пропущено кэшей: ${skipped.join(', ')}`)

console.log(`\n----- (a) 3 набора × {full, train, OOS} -----`)
const setRows: any[] = []
for (const name of ['baseline_all', 'high_only', 'low_only']) {
	const r = setResults[name]!
	for (const split of ['full', 'train', 'oos'] as const) {
		const s = r[split]
		setRows.push({ set: name, split, N: s.N, meanR: n2(s.meanR), CIlo: n2(s.ci[0]), CIhi: n2(s.ci[1]), PF: n2(s.pf), clusters: s.clusters })
	}
}
console.table(setRows)

console.log(`\n----- (b) breadth per asset: high_only vs low_only (full + OOS) -----`)
console.table(ASSETS.map(a => {
	const h = breadthHighOnly.find(x => x.asset === a)!, l = breadthLowOnly.find(x => x.asset === a)!
	return { asset: a, highFullN: h.fullN, highFullMeanR: n2(h.fullMeanR), highOosN: h.oosN, highOosMeanR: n2(h.oosMeanR), lowFullN: l.fullN, lowFullMeanR: n2(l.fullMeanR), lowOosN: l.oosN, lowOosMeanR: n2(l.oosMeanR) }
}))

console.log(`\n----- (c) per-quarter high_only -----`)
console.table(pqHigh.table.map(r => ({ quarter: r.quarter, N: r.N, meanR: n2(r.meanR), CIlo: n2(r.ci[0]), CIhi: n2(r.ci[1]), PF: n2(r.pf) })))
console.log(`high_only: кварталов с N>=10: ${pqHigh.withData}; из них meanR>0: ${pqHigh.positive} (${pqHigh.frac == null ? 'n/a' : (100 * pqHigh.frac).toFixed(0) + '%'})`)

console.log(`\n----- (c) per-quarter low_only -----`)
console.table(pqLow.table.map(r => ({ quarter: r.quarter, N: r.N, meanR: n2(r.meanR), CIlo: n2(r.ci[0]), CIhi: n2(r.ci[1]), PF: n2(r.pf) })))
console.log(`low_only: кварталов с N>=10: ${pqLow.withData}; из них meanR>0: ${pqLow.positive} (${pqLow.frac == null ? 'n/a' : (100 * pqLow.frac).toFixed(0) + '%'})`)

// one-line plain-language read
const lowOos = setResults.low_only!.oos
const highOos = setResults.high_only!.oos
const baseOos = setResults.baseline_all!.oos
const lowDragPersists = typeof lowOos.ci[1] === 'number' && (lowOos.ci[1] as number) < 0
const highGteBase = (highOos.meanR ?? -Infinity) >= (baseOos.meanR ?? Infinity)
console.log(`\n----- ЧТЕНИЕ (OOS) -----`)
console.log(`low_only OOS CI-high = ${n2(lowOos.ci[1])} → ${lowDragPersists ? 'DRAG СОХРАНЯЕТСЯ (CI-high < 0)' : 'drag НЕ подтверждён OOS (CI-high >= 0)'}; ` +
	`high_only OOS meanR = ${n2(highOos.meanR)} vs baseline OOS meanR = ${n2(baseOos.meanR)} → high_only ${highGteBase ? '>= baseline (гейт не хуже)' : '< baseline (гейт хуже)'}.`)

// ============================================================================
// STEP 6 — write JSON artifact.
// ============================================================================
writeFileSync(resolve('ci-results/regime-gate-d4b-highvol-oos.json'), JSON.stringify({
	generatedAt: new Date().toISOString(),
	protocol: 'D4b-oos-high-vol-only-onoff-1.0',
	fixedStrategy: { geometry: GEO, exit: 'static-full', targetSteps: TARGET_STEPS, costsBps: 7 },
	regimeProxy: {
		series: 'BTC-2h',
		rule: 'realized-vol (std of log-returns) vs trailing median',
		volWindow: VOL_WINDOW,
		medianWindow: VOL_MEDIAN_WINDOW,
		causal: true,
		note: 'same pre-registered regime as D4b, no new thresholds (§2.1)',
	},
	sets: {
		baseline_all: setResults.baseline_all,
		high_only: setResults.high_only,
		low_only: setResults.low_only,
	},
	breadthHighOnly,
	breadthLowOnly,
	perQuarterHighOnly: pqHigh.table,
	perQuarterLowOnly: pqLow.table,
	positiveQuarterFractionHighOnly: { withData: pqHigh.withData, positive: pqHigh.positive, fraction: pqHigh.frac },
	positiveQuarterFractionLowOnly: { withData: pqLow.withData, positive: pqLow.positive, fraction: pqLow.frac },
	noRegimeRowCount: noRegimeRows.length,
	btcBarsLoaded,
	btcHighBars,
	btcLowBars,
	skipped,
	note: '§2.1 соблюдён: те же заранее заданные окна VOL_WINDOW+VOL_MEDIAN_WINDOW, что в D4b, порогов не свипаем. §2.3 соблюдён: src не тронут, replayStatic + stats-хелперы + Row-loop + причинный режим скопированы вербатим из regimeGateD4Vol.ts.',
}, null, 2))
console.log(`\nWrote ci-results/regime-gate-d4b-highvol-oos.json`)
