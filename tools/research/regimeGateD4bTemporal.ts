// D4b-temporal — устойчив ли high-vol-only OOS-плюс или это одно горячее недавнее окно? (трек D, docs/ROADMAP.md).
//
// Контекст: D4b-OOS нашёл high_only OOS +0.174 [+0.045,+0.318], но train −0.068 (отрицательный) — плюс
//   сконцентрирован в недавнем окне. Прежде чем считать «high-vol → positive» чем-то большим, чем лид,
//   нужен ПОЛНЫЙ временной путь: широко ли отрицательно рано и положительно только в последние периоды
//   (артефакт окна, как D-lead short), или знак переворачивается и держится вокруг структурной даты?
//   И это широко по активам или несут BTC/SOL/BNB.
//
// Метод: генерация сделок, stats-хелперы, Row-loop и причинный BTC-2h realized-vol режим скопированы
//   ВЕРБАТИМ из tools/research/regimeGateD4bHighVolOos.ts / regimeGateD4Vol.ts (§2.3: src не тронут).
//   НИКАКИХ новых порогов (тот же VOL_WINDOW=120, VOL_MEDIAN_WINDOW=1000 режим, §2.1). Офлайн кэш.
// Запуск: npx tsx tools/research/regimeGateD4bTemporal.ts.

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

// —— replayStatic скопирован ВЕРБАТИМ из regimeGateD4bHighVolOos.ts (§2.3: src не тронут) ——
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

// —— stats helpers скопированы ВЕРБАТИМ из regimeGateD4bHighVolOos.ts ——
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

// halfOf — календарный полугодовой ярлык (H1 = месяцы 0-5, H2 = месяцы 6-11).
const halfOf = (ms: number) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${d.getUTCMonth() <= 5 ? 'H1' : 'H2'}` }

// ============================================================================
// STEP 1 — Причинный (causal) BTC-2h realized-vol режим — ВЕРБАТИМ из regimeGateD4bHighVolOos.ts.
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

// regimeAsOf — ВЕРБАТИМ: режим последнего BTC-бара с ts<=signalAt (бинпоиск).
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
// STEP 2 — исключаем warmup (null режим) и определяем наборы участия (обе стороны).
// ============================================================================
const noRegimeRows = all.filter(t => t.volRegime == null)
const gated = all.filter(t => t.volRegime != null)

const sets: Record<'baseline_all' | 'high_only' | 'low_only', Row[]> = {
	baseline_all: gated,                                   // торгуем всегда
	high_only: gated.filter(t => t.volRegime === 'high'),  // пропускаем low-vol (обе стороны)
	low_only: gated.filter(t => t.volRegime === 'low'),    // подозреваемый drag (обе стороны)
}

// ============================================================================
// STEP 3 — per-half-year декомпозиция для каждого набора (half, N, meanR, CI, PF), хронологически.
// ============================================================================
function perHalf(rows: readonly Row[], tag: string) {
	const halves = [...new Set(rows.map(t => halfOf(t.signalAt)))].sort()
	return halves.map(h => {
		const s = summ(rows.filter(t => halfOf(t.signalAt) === h), `d4b-temporal-${tag}-${h}`)
		return { half: h, N: s.N, meanR: s.meanR, ci: s.ci, pf: s.pf }
	}).filter(r => r.N > 0)
}
const phHigh = perHalf(sets.high_only, 'high')
const phLow = perHalf(sets.low_only, 'low')
const phBase = perHalf(sets.baseline_all, 'base')

// ============================================================================
// STEP 4 — cumulative high_only meanR по half-year (chronological, up-to-and-including).
// ============================================================================
const highSortedForCum = [...sets.high_only].sort((a, b) => a.signalAt - b.signalAt)
const cumHighHalves = [...new Set(highSortedForCum.map(t => halfOf(t.signalAt)))].sort()
const cumulativeHighOnly = cumHighHalves.map(h => {
	const upTo = highSortedForCum.filter(t => halfOf(t.signalAt) <= h)
	const v = upTo.map(t => t.netR).filter(Number.isFinite)
	return { half: h, cumN: upTo.length, cumMeanR: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
})

// ============================================================================
// STEP 5 — per-asset × TF breadth (high_only): FULL + OOS (last 35% of high_only by time).
// ============================================================================
const highSorted = [...sets.high_only].sort((a, b) => a.signalAt - b.signalAt)
const oosCut = Math.floor(highSorted.length * 0.65)
const highOosSet = new Set(highSorted.slice(oosCut))

function cellSumm(rows: readonly Row[], tag: string) {
	const s = summ(rows, tag)
	return { N: s.N, meanR: s.meanR, ci: s.N >= 10 ? s.ci : [null, null] as [number | null, number | null] }
}

const breadthHighOnlyByAssetTf: any[] = []
for (const a of ASSETS) for (const tf of TIMEFRAMES) {
	const cellFull = sets.high_only.filter(t => t.asset === a && t.timeframe === tf)
	const cellOos = cellFull.filter(t => highOosSet.has(t))
	const f = cellSumm(cellFull, `d4b-temporal-high-${a}-${tf}-full`)
	const o = cellSumm(cellOos, `d4b-temporal-high-${a}-${tf}-oos`)
	breadthHighOnlyByAssetTf.push({ asset: a, timeframe: tf, fullN: f.N, fullMeanR: f.meanR, fullCI: f.ci, oosN: o.N, oosMeanR: o.meanR, oosCI: o.ci })
}

const breadthHighOnlyByAsset = ASSETS.map(a => {
	const full = sets.high_only.filter(t => t.asset === a)
	const oos = full.filter(t => highOosSet.has(t))
	const f = cellSumm(full, `d4b-temporal-high-${a}-pooled-full`)
	const o = cellSumm(oos, `d4b-temporal-high-${a}-pooled-oos`)
	return { asset: a, fullN: f.N, fullMeanR: f.meanR, fullCI: f.ci, oosN: o.N, oosMeanR: o.meanR, oosCI: o.ci }
})

// ============================================================================
// STEP 6 — console output.
// ============================================================================
console.log(`\n===== D4b-temporal — структурный сдвиг или одно горячее недавнее окно? (BTC-2h realized-vol) =====`)
console.log(`BTC-2h баров загружено: ${btcBarsLoaded}; VOL_WINDOW=${VOL_WINDOW}; VOL_MEDIAN_WINDOW=${VOL_MEDIAN_WINDOW} (те же окна, что в D4b — §2.1)`)
console.log(`BTC-баров high-vol: ${btcHighBars}; low-vol: ${btcLowBars}`)
console.log(`Пул сделок всего: ${all.length}; no-regime (warmup) исключено: ${noRegimeRows.length}; в наборах: ${gated.length}`)
console.log(`Размеры наборов: baseline_all=${sets.baseline_all.length}; high_only=${sets.high_only.length}; low_only=${sets.low_only.length}`)
console.log(`high_only OOS split cut (last 35% by time): index ${oosCut}, OOS N=${highOosSet.size}`)
if (skipped.length) console.log(`Пропущено кэшей: ${skipped.join(', ')}`)

console.log(`\n----- (a) per-half-year high_only -----`)
console.table(phHigh.map(r => ({ half: r.half, N: r.N, meanR: n2(r.meanR), CIlo: n2(r.ci[0]), CIhi: n2(r.ci[1]), PF: n2(r.pf) })))

console.log(`\n----- (a) per-half-year low_only -----`)
console.table(phLow.map(r => ({ half: r.half, N: r.N, meanR: n2(r.meanR), CIlo: n2(r.ci[0]), CIhi: n2(r.ci[1]), PF: n2(r.pf) })))

console.log(`\n----- (a) per-half-year baseline_all -----`)
console.table(phBase.map(r => ({ half: r.half, N: r.N, meanR: n2(r.meanR), CIlo: n2(r.ci[0]), CIhi: n2(r.ci[1]), PF: n2(r.pf) })))

console.log(`\n----- (b) cumulative high_only meanR by half-year -----`)
console.table(cumulativeHighOnly.map(r => ({ half: r.half, cumN: r.cumN, cumMeanR: n2(r.cumMeanR) })))

console.log(`\n----- (c) per-asset × TF breadth high_only (full + OOS) -----`)
console.table(breadthHighOnlyByAssetTf.map(r => ({ asset: r.asset, tf: r.timeframe, fullN: r.fullN, fullMeanR: n2(r.fullMeanR), fullCIlo: n2(r.fullCI[0]), fullCIhi: n2(r.fullCI[1]), oosN: r.oosN, oosMeanR: n2(r.oosMeanR), oosCIlo: n2(r.oosCI[0]), oosCIhi: n2(r.oosCI[1]) })))

console.log(`\n----- (c) per-asset pooled high_only (full + OOS) -----`)
console.table(breadthHighOnlyByAsset.map(r => ({ asset: r.asset, fullN: r.fullN, fullMeanR: n2(r.fullMeanR), fullCIlo: n2(r.fullCI[0]), fullCIhi: n2(r.fullCI[1]), oosN: r.oosN, oosMeanR: n2(r.oosMeanR), oosCIlo: n2(r.oosCI[0]), oosCIhi: n2(r.oosCI[1]) })))

// one-line plain-language read: last N halves positivity + single-half vs sustained flip.
const LAST_N = 4
const lastHalves = phHigh.slice(-LAST_N)
const lastPositive = lastHalves.filter(r => (r.meanR ?? 0) > 0).length
// detect longest trailing run of positive halves
let trailingPosRun = 0
for (let i = phHigh.length - 1; i >= 0; i--) { if ((phHigh[i]!.meanR ?? 0) > 0) trailingPosRun++; else break }
const flipKind = trailingPosRun >= 2 ? `sustained run of ${trailingPosRun} trailing positive halves` : trailingPosRun === 1 ? 'single trailing positive half (window-like)' : 'no trailing positive half'
console.log(`\n----- ЧТЕНИЕ (temporal) -----`)
console.log(`high_only: последних ${lastHalves.length} полугодий → положительных ${lastPositive}/${lastHalves.length}; ${flipKind}.`)

// ============================================================================
// STEP 7 — write JSON artifact.
// ============================================================================
writeFileSync(resolve('ci-results/regime-gate-d4b-temporal.json'), JSON.stringify({
	generatedAt: new Date().toISOString(),
	protocol: 'D4b-temporal-highvol-stability-1.0',
	fixedStrategy: { geometry: GEO, exit: 'static-full', targetSteps: TARGET_STEPS, costsBps: 7 },
	regimeProxy: {
		series: 'BTC-2h',
		rule: 'realized-vol (std of log-returns) vs trailing median',
		volWindow: VOL_WINDOW,
		medianWindow: VOL_MEDIAN_WINDOW,
		causal: true,
		note: 'same pre-registered regime as D4b, no new thresholds (§2.1)',
	},
	perHalfYear: {
		high_only: phHigh,
		low_only: phLow,
		baseline_all: phBase,
	},
	cumulativeHighOnly,
	breadthHighOnlyByAssetTf,
	breadthHighOnlyByAsset,
	noRegimeRowCount: noRegimeRows.length,
	btcBarsLoaded,
	btcHighBars,
	btcLowBars,
	skipped,
	note: '§2.1 соблюдён: те же заранее заданные окна VOL_WINDOW+VOL_MEDIAN_WINDOW, что в D4b, порогов не свипаем. §2.3 соблюдён: src не тронут, replayStatic + stats-хелперы + Row-loop + причинный режим скопированы вербатим из regimeGateD4bHighVolOos.ts.',
}, null, 2))
console.log(`\nWrote ci-results/regime-gate-d4b-temporal.json`)
