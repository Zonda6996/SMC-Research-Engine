// D1 — exit × vol-veto, HELD-OUT вселенная (трек D из docs/ROADMAP.md).
//
// Стресс-тест на устойчивость: те же 4 плеча, что в exitVetoD1.ts (A0 safe/static/T2 vs A1 pure-hold;
//   veto ON=high-vol-only vs OFF), но на активах, которых НЕ было в обучающей вселенной exitVetoD1
//   (SOL/BTC/ETH/XRP/BNB). Held-out: LINK/DOGE/ADA/AVAX/OP. Плюс per-quarter срез meanR для каждого плеча.
//   Вопрос: выживает ли train-плюс pure-hold по всем 4 критериям (train+OOS, CI-low>0, breadth, per-quarter)
//   на активах, которых он «не видел» — или это оверфит окна/BTC-концентрация.
//
// §2.1: ни одного нового числа (A1 = аблация TP-ветки A0; окна волы заранее заданы, НЕ свипаются).
// §2.3: src не тронут; replay/vol/helpers вербатим из regimeGateD4Vol.ts. Vol-режим — тот же причинный BTC-2h.
//   BTC остаётся серией режима (в торговую вселенную held-out НЕ входит). Данные — офлайн кэш.
// Запуск: npx tsx tools/research/exitVetoD1Heldout.ts.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { admitArrowSignals, detectArrowSignalCandidates, type ArrowSide, type ArrowSignal } from '../../src/core/signals/ArrowSignalEngine.js'
import { ARROW_MODE_CONFIGS } from '../../src/core/signals/ArrowTradeReplay.js'

const ASSETS = ['LINK', 'DOGE', 'ADA', 'AVAX', 'OP'] as const // HELD-OUT (не пересекается с обучающей вселенной exitVetoD1)
const TIMEFRAMES = ['30m', '1h', '2h'] as const
const GEO = 'safe' as const
const TARGET_STEPS = 2
const TRAIN_FRACTION = 0.65
const CLUSTER_MS = 4 * 60 * 60 * 1000
const BOOTSTRAP_SAMPLES = 2000
const BOOTSTRAP_SEED = 20260807
const VOL_WINDOW = 120
const VOL_MEDIAN_WINDOW = 1000

type VolRegime = 'high' | 'low' | null
type Outcome = 'full-tp' | 'stop' | 'timeout' | 'open'
type Exit = 'A0' | 'A1'
interface Row { asset: string; timeframe: string; side: ArrowSide; netR: number; outcome: Outcome; signalAt: number; quarter: string; cluster: string; volRegime: VolRegime }

const favorableWick = (side: ArrowSide, c: Candle, lvl: number) => side === 'long' ? c.high >= lvl : c.low <= lvl
const adverseWick = (side: ArrowSide, c: Candle, lvl: number) => side === 'long' ? c.low <= lvl : c.high >= lvl
const directionalPnl = (side: ArrowSide, entry: number, exit: number) => side === 'long' ? exit - entry : entry - exit

function replayStaticA0(candles: readonly Candle[], signal: ArrowSignal): { side: ArrowSide; netR: number; outcome: Outcome; signalAt: number } | null {
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

function replayPureHoldA1(candles: readonly Candle[], signal: ArrowSignal): { side: ArrowSide; netR: number; outcome: Outcome; signalAt: number } | null {
	const cfg = ARROW_MODE_CONFIGS[GEO]
	const entryIndex = signal.signalIndex + 1
	const entryCandle = candles[entryIndex]
	if (entryCandle == null || !Number.isFinite(signal.atr200) || signal.atr200 <= 0) return null
	const step = 5.5 * signal.atr200 / cfg.stepDivisor
	const entry = entryCandle.open
	if (!(entry > 0) || !(step > 0)) return null
	const add = signal.side === 'long' ? entry - step : entry + step
	const stop = signal.side === 'long' ? entry - cfg.stopSteps * step : entry + cfg.stopSteps * step
	const oneR = Math.abs((entry + add) / 2 - stop) * 2
	if (!(oneR > 0)) return null
	let addFilled = false, weight = 1, averageEntry = entry, turnover = Math.abs(entry)
	let exitIndex: number | null = null, exitPrice = entry, outcome: Outcome = 'open'
	const lastIndex = Math.min(candles.length - 1, entryIndex + cfg.maxHoldingBars - 1)
	for (let i = entryIndex; i <= lastIndex; i++) {
		const c = candles[i]!
		if (!addFilled && adverseWick(signal.side, c, add)) { addFilled = true; averageEntry = (averageEntry * weight + add) / (weight + 1); weight += 1; turnover += Math.abs(add) }
		if (adverseWick(signal.side, c, stop)) { exitIndex = i; exitPrice = stop; outcome = 'stop'; turnover += Math.abs(stop) * weight; break }
		// НЕТ take-profit ветки — pure-hold
	}
	if (exitIndex == null && lastIndex < candles.length - 1) { exitIndex = lastIndex; exitPrice = candles[lastIndex]!.close; outcome = 'timeout'; turnover += Math.abs(exitPrice) * weight }
	else if (exitIndex == null) { exitPrice = candles[candles.length - 1]!.close; outcome = 'open' }
	const grossR = (directionalPnl(signal.side, averageEntry, exitPrice) * weight) / oneR
	const costR = (turnover * cfg.oneWayCostBps / 10_000) / oneR
	return { side: signal.side, netR: grossR - costR, outcome, signalAt: signal.signalAt }
}

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

// —— causal BTC-2h realized-vol регим ВЕРБАТИМ из regimeGateD4Vol.ts (BTC = серия режима, не торговый актив) ——
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

const rowsByExit: Record<Exit, Row[]> = { A0: [], A1: [] }
const sources: any[] = []
const skipped: string[] = []
for (const asset of ASSETS) for (const timeframe of TIMEFRAMES) {
	const path = resolve(`tools/batch/cache/${asset}-USDT_${timeframe}_20000_futures.json`)
	if (!existsSync(path)) { skipped.push(`${asset} ${timeframe}`); continue }
	const candles = JSON.parse(readFileSync(path, 'utf8')) as Candle[]
	const detection = detectArrowSignalCandidates(candles, APEX_PARAMS)
	const admitted = admitArrowSignals(detection.candidates)
	sources.push({ asset, timeframe, bars: candles.length, admitted: admitted.length })
	for (const signal of admitted) {
		const reg = regimeAsOf(signal.signalAt)
		const a0 = replayStaticA0(candles, signal)
		if (a0 != null) rowsByExit.A0.push({ asset, timeframe, side: a0.side, netR: a0.netR, outcome: a0.outcome, signalAt: a0.signalAt, quarter: quarterOf(a0.signalAt), cluster: `${Math.floor(a0.signalAt / CLUSTER_MS)}-${a0.side}`, volRegime: reg })
		const a1 = replayPureHoldA1(candles, signal)
		if (a1 != null) rowsByExit.A1.push({ asset, timeframe, side: a1.side, netR: a1.netR, outcome: a1.outcome, signalAt: a1.signalAt, quarter: quarterOf(a1.signalAt), cluster: `${Math.floor(a1.signalAt / CLUSTER_MS)}-${a1.side}`, volRegime: reg })
	}
	process.stdout.write(`ok ${asset} ${timeframe}: bars=${candles.length} admitted=${admitted.length}\n`)
}

function splitByTime(rows: readonly Row[]): { train: Row[]; oos: Row[] } {
	const sorted = [...rows].sort((a, b) => a.signalAt - b.signalAt)
	const cut = Math.floor(sorted.length * TRAIN_FRACTION)
	return { train: sorted.slice(0, cut), oos: sorted.slice(cut) }
}

const warmupExcluded = rowsByExit.A0.filter(t => t.volRegime == null).length
const EXITS: Exit[] = ['A0', 'A1']
const VETOS = ['vetoOFF', 'vetoON'] as const

const arms: Record<string, any> = {}
for (const exit of EXITS) for (const veto of VETOS) {
	const gated = rowsByExit[exit].filter(t => t.volRegime != null)
	const rows = veto === 'vetoON' ? gated.filter(t => t.volRegime === 'high') : gated
	const { train, oos } = splitByTime(rows)
	const key = `${exit}/${veto}`
	const breadthByAssetOOS = ASSETS.map(a => { const s = summ(oos.filter(t => t.asset === a), `${key}-oos-${a}`); return { asset: a, N: s.N, meanR: s.meanR } })
	// per-quarter (весь пул плеча), N>=10 для сравнения
	const quarters = [...new Set(rows.map(t => t.quarter))].sort()
	const perQuarter = quarters.map(q => { const s = summ(rows.filter(t => t.quarter === q), `${key}-q-${q}`); return { quarter: q, N: s.N, meanR: s.meanR, ci: s.ci } }).filter(r => r.N > 0)
	const qEligible = perQuarter.filter(r => r.N >= 10)
	const qPositive = qEligible.filter(r => (r.meanR ?? 0) > 0).length
	arms[key] = {
		full: summ(rows, `${key}-full`),
		train: summ(train, `${key}-train`),
		oos: summ(oos, `${key}-oos`),
		breadthByAssetOOS,
		perQuarter,
		quartersEligible: qEligible.length,
		quartersPositive: qPositive,
	}
}

const n2 = (x: any) => x == null ? 'n/a' : (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(3) : String(x))

console.log(`\n===== D1 exit × vol-veto — HELD-OUT (${ASSETS.join('/')}) =====`)
console.log(`BTC-2h баров: ${btcBarsLoaded}; high=${btcHighBars} low=${btcLowBars}`)
console.log(`Пул A0: ${rowsByExit.A0.length}; пул A1: ${rowsByExit.A1.length}; warmup исключено (на плечо): ${warmupExcluded}`)
if (skipped.length) console.log(`Пропущено кэшей: ${skipped.join(', ')}`)

console.log(`\n----- train / OOS по 4 плечам (net after 7bps) -----`)
const table: any[] = []
for (const exit of EXITS) for (const veto of VETOS) {
	const r = arms[`${exit}/${veto}`]
	for (const split of ['train', 'oos'] as const) {
		const s = r[split]
		table.push({ arm: `${exit}/${veto}`, split, N: s.N, meanR: n2(s.meanR), CIlo: n2(s.ci[0]), CIhi: n2(s.ci[1]), PF: n2(s.pf), clusters: s.clusters })
	}
}
console.table(table)

console.log(`\n----- per-asset breadth (OOS) -----`)
for (const exit of EXITS) for (const veto of VETOS) {
	const key = `${exit}/${veto}`
	console.log(`  ${key}:`)
	console.table(arms[key].breadthByAssetOOS.map((b: any) => ({ asset: b.asset, N: b.N, meanR: n2(b.meanR) })))
}

console.log(`\n----- per-quarter meanR (весь пул плеча, N>=10) -----`)
for (const exit of EXITS) for (const veto of VETOS) {
	const key = `${exit}/${veto}`, r = arms[key]
	console.log(`  ${key}: кварталов N>=10: ${r.quartersEligible}, из них meanR>0: ${r.quartersPositive}`)
	console.table(r.perQuarter.filter((q: any) => q.N >= 10).map((q: any) => ({ quarter: q.quarter, N: q.N, meanR: n2(q.meanR), CIlo: n2(q.ci[0]), CIhi: n2(q.ci[1]) })))
}

const result = {
	generatedAt: new Date().toISOString(),
	protocol: 'D1-exit-veto-heldout-1.0 (held-out universe LINK/DOGE/ADA/AVAX/OP; A0 safe/static/T2 vs A1 pure-hold; veto ON=high-vol-only vs OFF; filter=off, A1 admission path; + per-quarter)',
	heldOutRationale: 'Активы вне обучающей вселенной exitVetoD1 (SOL/BTC/ETH/XRP/BNB). Стресс: выживает ли train-плюс pure-hold по train+OOS, CI-low>0, breadth, per-quarter.',
	preregistration: {
		universe: ASSETS, timeframes: TIMEFRAMES, geometry: GEO,
		exits: { A0: 'safe/static-full, target 2×step (референс)', A1: 'pure-hold: без фикс-TP, выход по стопу/maxHoldingBars' },
		vetoDefinition: 'ON = только high-vol (low-vol дроп, D4b); OFF = high∪low; warmup исключён из обоих',
		volWindow: VOL_WINDOW, medianWindow: VOL_MEDIAN_WINDOW, trainFraction: TRAIN_FRACTION,
		costs: '7 bps/side; funding omitted', bootstrap: `${BOOTSTRAP_SAMPLES} resamples, seed ${BOOTSTRAP_SEED}`,
		note: '§2.1: ни одного нового числа. §2.3: src не тронут, replay/vol/helpers вербатим из regimeGateD4Vol.ts. Режим причинный BTC-2h.',
	},
	sources, skipped, btcBarsLoaded, btcHighBars, btcLowBars, warmupExcluded, arms,
}
writeFileSync(resolve('ci-results/exit-veto-d1-heldout.json'), JSON.stringify(result, null, 2))
console.log(`\nWrote ci-results/exit-veto-d1-heldout.json`)
