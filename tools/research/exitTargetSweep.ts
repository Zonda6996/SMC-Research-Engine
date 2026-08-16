// D1.2 — свип target-multiple для STATIC-выхода (трек D, docs/ROADMAP.md).
//
// Решение автора (2026-08-14): цели 2× / 2.5× / 3× step. Стоп/геометрия/издержки не меняются.
// D1 показал: static-выход >> dynamic (mean-revert режет победителей). Вопрос: даёт ли ещё более
//   далёкая фикс-цель дополнительный прирост.
//
// §2.3: движок (src/**) НЕ тронут. Множитель цели в ArrowTradeReplay зашит константой (2×), не поле
//   конфига → static-путь реплея здесь ВОСПРОИЗВЕДЁН ВЕРБАТИМ (та же арифметика: step=5.5·atr200/stepDivisor,
//   add, stop=stopSteps·step, порядок в баре add→stop→target, oneR=|avgFullEntry−stop|·2, издержки 7bps,
//   turnover), параметризован ТОЛЬКО targetSteps. Встроенная валидация: target=2 обязан совпасть с
//   safe/static из ci-results/exit-benchmark-d1.json.
// §2.1: 2/2.5/3 — явное решение автора.
//
// Данные — офлайн кэш. Запуск: npx tsx tools/research/exitTargetSweep.ts. Дата: 2026-08-14.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { admitArrowSignals, detectArrowSignalCandidates, type ArrowMode, type ArrowSide, type ArrowSignal } from '../../src/core/signals/ArrowSignalEngine.js'
import { ARROW_MODE_CONFIGS } from '../../src/core/signals/ArrowTradeReplay.js'

const ASSETS = ['SOL', 'BTC', 'ETH', 'XRP', 'BNB'] as const
const TIMEFRAMES = ['30m', '1h', '2h'] as const
const GEOMETRIES: ArrowMode[] = ['safe', 'standard', 'risk']
const TARGET_STEPS = [2, 2.5, 3] as const // ← решение автора
const TRAIN_FRACTION = 0.65
const CLUSTER_MS = 4 * 60 * 60 * 1000
const BOOTSTRAP_SAMPLES = 2000
const BOOTSTRAP_SEED = 20260807

type Split = 'train' | 'oos'
type Outcome = 'full-tp' | 'stop' | 'timeout' | 'open'
interface Row { asset: string; timeframe: string; variant: string; side: ArrowSide; netR: number; outcome: Outcome; signalAt: number; entryAt: number; holdingBars: number; split: Split; cluster: string }

const favorableWick = (side: ArrowSide, c: Candle, lvl: number) => side === 'long' ? c.high >= lvl : c.low <= lvl
const adverseWick = (side: ArrowSide, c: Candle, lvl: number) => side === 'long' ? c.low <= lvl : c.high >= lvl
const directionalPnl = (side: ArrowSide, entry: number, exit: number) => side === 'long' ? exit - entry : entry - exit

// Воспроизведение static-full пути replayArrowTrade с параметризованной целью targetSteps.
function replayStatic(candles: readonly Candle[], signal: ArrowSignal, geo: ArrowMode, targetSteps: number): Omit<Row, 'asset' | 'timeframe' | 'variant' | 'split' | 'cluster'> | null {
	const cfg = ARROW_MODE_CONFIGS[geo]
	const entryIndex = signal.signalIndex + 1
	const entryCandle = candles[entryIndex]
	if (entryCandle == null || !Number.isFinite(signal.atr200) || signal.atr200 <= 0) return null
	const step = 5.5 * signal.atr200 / cfg.stepDivisor
	const entry = entryCandle.open
	if (!(entry > 0) || !(step > 0)) return null
	const add = signal.side === 'long' ? entry - step : entry + step
	const stop = signal.side === 'long' ? entry - cfg.stopSteps * step : entry + cfg.stopSteps * step
	const staticFull = signal.side === 'long' ? entry + targetSteps * step : entry - targetSteps * step
	const averageFullEntry = (entry + add) / 2
	const oneR = Math.abs(averageFullEntry - stop) * 2
	if (!(oneR > 0)) return null

	let addFilled = false, weight = 1, averageEntry = entry, turnoverNotional = Math.abs(entry)
	let exitIndex: number | null = null, exitPrice = entry
	let outcome: Outcome = 'open'
	const lastIndex = Math.min(candles.length - 1, entryIndex + cfg.maxHoldingBars - 1)

	for (let index = entryIndex; index <= lastIndex; index++) {
		const candle = candles[index]!
		if (!addFilled && adverseWick(signal.side, candle, add)) {
			addFilled = true
			averageEntry = (averageEntry * weight + add) / (weight + 1)
			weight += 1
			turnoverNotional += Math.abs(add)
		}
		if (adverseWick(signal.side, candle, stop)) {
			exitIndex = index; exitPrice = stop; outcome = 'stop'
			turnoverNotional += Math.abs(stop) * weight
			break
		}
		if (favorableWick(signal.side, candle, staticFull)) {
			exitIndex = index; exitPrice = staticFull; outcome = 'full-tp'
			turnoverNotional += Math.abs(staticFull) * weight
			break
		}
	}
	if (exitIndex == null && lastIndex < candles.length - 1) {
		exitIndex = lastIndex; exitPrice = candles[lastIndex]!.close; outcome = 'timeout'
		turnoverNotional += Math.abs(exitPrice) * weight
	} else if (exitIndex == null) {
		exitPrice = candles[candles.length - 1]!.close; outcome = 'open'
	}

	const grossR = (directionalPnl(signal.side, averageEntry, exitPrice) * weight) / oneR
	const costR = (turnoverNotional * cfg.oneWayCostBps / 10_000) / oneR
	return {
		side: signal.side, netR: grossR - costR, outcome,
		signalAt: signal.signalAt, entryAt: entryCandle.timestamp,
		holdingBars: (exitIndex ?? candles.length - 1) - entryIndex + 1,
	}
}

function median(xs: readonly number[]): number | null { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y), m = Math.floor(a.length / 2); return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2 }
function quantile(xs: readonly number[], q: number): number | null { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y), p = (a.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return a[lo]! + (a[hi]! - a[lo]!) * (p - lo) }
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296) }
function bootstrapCI(values: readonly number[], seedSalt: string): [number | null, number | null] {
	if (values.length < 2) return [null, null]
	const hash = createHash('sha256').update(seedSalt).digest().readUInt32LE(0)
	const random = rng(BOOTSTRAP_SEED ^ hash), means: number[] = []
	for (let b = 0; b < BOOTSTRAP_SAMPLES; b++) { let sum = 0; for (let i = 0; i < values.length; i++) sum += values[Math.floor(random() * values.length)]!; means.push(sum / values.length) }
	return [quantile(means, 0.025), quantile(means, 0.975)]
}
function summarize(rows: readonly Row[], seedSalt: string) {
	const ordered = [...rows].sort((a, b) => a.entryAt - b.entryAt || a.asset.localeCompare(b.asset))
	const values = ordered.map(t => t.netR).filter(Number.isFinite)
	const gains = values.filter(x => x > 0).reduce((a, b) => a + b, 0), losses = -values.filter(x => x < 0).reduce((a, b) => a + b, 0)
	const full = rows.filter(t => t.outcome === 'full-tp').length, stop = rows.filter(t => t.outcome === 'stop').length
	return {
		signals: rows.length, meanR: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, medianR: median(values),
		totalR: values.reduce((a, b) => a + b, 0), ci95MeanR: bootstrapCI(values, seedSalt),
		profitFactor: losses > 0 ? gains / losses : gains > 0 ? 'Infinity' : null,
		positiveRate: values.length ? values.filter(x => x > 0).length / values.length : null,
		winRate: rows.length ? full / rows.length : 0, stopRate: rows.length ? stop / rows.length : 0,
		avgHoldBars: rows.length ? rows.reduce((s, t) => s + t.holdingBars, 0) / rows.length : null, clusters: new Set(rows.map(t => t.cluster)).size,
	}
}

const all: Row[] = []
const skipped: string[] = []
for (const asset of ASSETS) for (const timeframe of TIMEFRAMES) {
	const path = resolve(`tools/batch/cache/${asset}-USDT_${timeframe}_20000_futures.json`)
	if (!existsSync(path)) { skipped.push(`${asset} ${timeframe}`); continue }
	const candles = JSON.parse(readFileSync(path, 'utf8')) as Candle[]
	const detection = detectArrowSignalCandidates(candles, APEX_PARAMS)
	const admitted = admitArrowSignals(detection.candidates)
	const start = candles[0]!.timestamp, end = candles.at(-1)!.timestamp, boundary = start + (end - start) * TRAIN_FRACTION
	for (const geo of GEOMETRIES) for (const target of TARGET_STEPS) {
		for (const signal of admitted) {
			const t = replayStatic(candles, signal, geo, target)
			if (t == null) continue
			all.push({ ...t, asset, timeframe, variant: `${geo}/T${target}`, split: (t.signalAt < boundary ? 'train' : 'oos') as Split, cluster: `${Math.floor(t.signalAt / CLUSTER_MS)}-${t.side}` })
		}
	}
	process.stdout.write(`ok ${asset} ${timeframe}: admitted=${admitted.length}\n`)
}

const variants = GEOMETRIES.flatMap(g => TARGET_STEPS.map(t => `${g}/T${t}`))
const aggregate: any[] = []
for (const variant of variants) for (const split of ['train', 'oos'] as Split[]) {
	aggregate.push({ variant, split, net: summarize(all.filter(t => t.variant === variant && t.split === split), `${variant}-${split}`) })
}
const slices: any[] = []
for (const variant of variants) for (const dimension of ['asset', 'side'] as const) {
	const keys = dimension === 'asset' ? [...ASSETS] : ['long', 'short']
	for (const key of keys) slices.push({ variant, dimension, key, net: summarize(all.filter(t => t.variant === variant && t.split === 'oos' && (t as any)[dimension === 'side' ? 'side' : 'asset'] === key), `${variant}-oos-${dimension}-${key}`) })
}
const survivors = aggregate.filter(a => a.split === 'oos' && a.net.meanR != null && a.net.meanR > 0 && a.net.ci95MeanR[0] != null && a.net.ci95MeanR[0] > 0)

const n2 = (x: any) => x == null ? 'n/a' : (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(3) : String(x))
console.log('\n===== D1.2 OOS static target sweep (filter=off, net after 7bps) =====')
console.table(aggregate.filter(a => a.split === 'oos').map(a => ({ variant: a.variant, N: a.net.signals, netMeanR: n2(a.net.meanR), CIlo: n2(a.net.ci95MeanR[0]), CIhi: n2(a.net.ci95MeanR[1]), PF: n2(a.net.profitFactor), winRate: n2(a.net.winRate), holdBars: n2(a.net.avgHoldBars) })))
console.log('\n===== SHORT-сторона OOS по вариантам =====')
console.table(slices.filter(s => s.dimension === 'side' && s.key === 'short').map(s => ({ variant: s.variant, N: s.net.signals, shortMeanR: n2(s.net.meanR), CIlo: n2(s.net.ci95MeanR[0]), PF: n2(s.net.profitFactor) })))
console.log('\n===== ВЫЖИВШИЕ OOS (агрегат meanR>0 И CI-low>0) =====')
console.log(survivors.length ? survivors.map(s => `${s.variant}: ${n2(s.net.meanR)} [${n2(s.net.ci95MeanR[0])}, ${n2(s.net.ci95MeanR[1])}]`).join('\n') : '  (нет)')
console.log('\nВАЛИДАЦИЯ: safe/T2 OOS meanR должен ≈ safe/static из D1 (-0.011).')

writeFileSync(resolve('ci-results/exit-target-sweep-d1_2.json'), JSON.stringify({
	generatedAt: new Date().toISOString(), protocol: 'D1.2-static-target-sweep-1.0',
	preregistration: { universe: ASSETS, timeframes: TIMEFRAMES, geometries: GEOMETRIES, targetSteps: TARGET_STEPS, trainFraction: TRAIN_FRACTION, costs: '7 bps/side', bootstrapSeed: BOOTSTRAP_SEED, note: 'targetSteps 2/2.5/3 — решение автора; static-путь воспроизведён вербатим, src не тронут; safe/T2 = валидация против D1.' },
	skipped, survivors, aggregate, slices,
}, null, 2))
console.log(`\nWrote ci-results/exit-target-sweep-d1_2.json (rows=${all.length}, survivors=${survivors.length})`)
