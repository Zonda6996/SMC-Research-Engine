// D1 — exit-benchmark (трек D из docs/ROADMAP.md).
//
// Гипотеза (из NEGATIVE-KNOWLEDGE §8): baseline даёт vendor-WR ~0.83 при meanR≈0 → утечка R в
//   геометрии ВЫХОДА, а не в селекции входа. Здесь фиксируем вход (весь допущенный набор стрелок,
//   filter=off) и варьируем ТОЛЬКО выход, меряем OOS с CI и breadth.
//
// §2.1: НИ ОДНОГО нового порога. Первый срез — рекомбинация УЖЕ существующих констант
//   ARROW_MODE_CONFIGS (src/core/signals/ArrowTradeReplay.ts):
//     geometry (stepDivisor+stopSteps) из safe/standard/risk  ×  exitStyle:
//       - dyn+partial   = management 'dynamic-partial', partialFraction 0.25 (как safe/risk)
//       - dyn+nopartial = management 'dynamic-partial', partialFraction 0    (0 уже есть у standard)
//       - static        = management 'static-full'      (тейк 2×step, как standard)
//   Все числа (1/1.17/1.43; 2/1.75; 0.25/0; 7bps) уже в движке. Новые множители/трейл-к-структуре —
//   отдельный шаг D1.2, ⚠ решает автор.
//
// Стат/сплит/издержки/кластеры/CI — как в B1 (ci-results/run-zonda-profitability-cycle.ts).
// Данные — офлайн кэш. Запуск: npx tsx tools/research/exitBenchmark.ts. Дата: 2026-08-14.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { admitArrowSignals, detectArrowSignalCandidates, type ArrowMode } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayAdmittedArrowSignals, type ArrowModeConfig, type ArrowTrade } from '../../src/core/signals/ArrowTradeReplay.js'

const ASSETS = ['SOL', 'BTC', 'ETH', 'XRP', 'BNB'] as const
const TIMEFRAMES = ['30m', '1h', '2h'] as const
const TRAIN_FRACTION = 0.65
const CLUSTER_MS = 4 * 60 * 60 * 1000
const BOOTSTRAP_SAMPLES = 2000
const BOOTSTRAP_SEED = 20260807

// Геометрия стопа (источник stepDivisor+stopSteps) и стиль выхода — только существующие значения.
const GEOMETRIES: ArrowMode[] = ['safe', 'standard', 'risk']
const EXIT_STYLES: Array<{ style: string; override: Partial<ArrowModeConfig> }> = [
	{ style: 'dyn+partial', override: { management: 'dynamic-partial', partialFraction: 0.25 } },
	{ style: 'dyn+nopartial', override: { management: 'dynamic-partial', partialFraction: 0 } },
	{ style: 'static', override: { management: 'static-full', partialFraction: 0 } },
]

type Split = 'train' | 'oos'
type TradeRow = ArrowTrade & { asset: string; timeframe: string; geo: ArrowMode; style: string; variant: string; split: Split; cluster: string }

function median(xs: readonly number[]): number | null {
	if (!xs.length) return null
	const a = [...xs].sort((x, y) => x - y), m = Math.floor(a.length / 2)
	return a.length % 2 ? a[m]! : (a[m - 1]! + a[m]!) / 2
}
function quantile(xs: readonly number[], q: number): number | null {
	if (!xs.length) return null
	const a = [...xs].sort((x, y) => x - y), p = (a.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p)
	return a[lo]! + (a[hi]! - a[lo]!) * (p - lo)
}
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296) }
function bootstrapCI(values: readonly number[], seedSalt: string): [number | null, number | null] {
	if (values.length < 2) return [null, null]
	const hash = createHash('sha256').update(seedSalt).digest().readUInt32LE(0)
	const random = rng(BOOTSTRAP_SEED ^ hash), means: number[] = []
	for (let b = 0; b < BOOTSTRAP_SAMPLES; b++) { let sum = 0; for (let i = 0; i < values.length; i++) sum += values[Math.floor(random() * values.length)]!; means.push(sum / values.length) }
	return [quantile(means, 0.025), quantile(means, 0.975)]
}
function maxDrawdown(values: readonly number[]): number { let equity = 0, peak = 0, dd = 0; for (const v of values) { equity += v; peak = Math.max(peak, equity); dd = Math.max(dd, peak - equity) } return dd }
function summarize(rows: readonly TradeRow[], seedSalt: string) {
	const ordered = [...rows].sort((a, b) => a.entryAt - b.entryAt || a.asset.localeCompare(b.asset))
	const values = ordered.map(t => t.netR).filter(Number.isFinite)
	const gains = values.filter(x => x > 0).reduce((a, b) => a + b, 0), losses = -values.filter(x => x < 0).reduce((a, b) => a + b, 0)
	const full = rows.filter(t => t.outcome === 'full-tp').length, partial = rows.filter(t => t.outcome === 'partial-be' || t.outcome === 'partial-stop').length, stop = rows.filter(t => t.outcome === 'stop').length
	const finalized = full + partial + stop
	const from = ordered[0]?.entryAt ?? null, to = ordered.at(-1)?.entryAt ?? null
	const months = from != null && to != null ? Math.max(1 / 30.4375, (to - from) / (30.4375 * 86400000)) : null
	return {
		signals: rows.length, meanR: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, medianR: median(values),
		totalR: values.reduce((a, b) => a + b, 0), ci95MeanR: bootstrapCI(values, seedSalt),
		profitFactor: losses > 0 ? gains / losses : gains > 0 ? 'Infinity' : null,
		positiveRate: values.length ? values.filter(x => x > 0).length / values.length : null,
		vendorStyleWR: finalized ? (full + partial) / finalized : 0, maxDrawdownR: maxDrawdown(values),
		tradesPerMonth: months ? rows.length / months : null, clusters: new Set(rows.map(t => t.cluster)).size,
		avgHoldBars: rows.length ? rows.reduce((s, t) => s + t.holdingBars, 0) / rows.length : null,
	}
}

const all: TradeRow[] = []
const sources: any[] = []
const skipped: string[] = []

for (const asset of ASSETS) for (const timeframe of TIMEFRAMES) {
	const path = resolve(`tools/batch/cache/${asset}-USDT_${timeframe}_20000_futures.json`)
	if (!existsSync(path)) { skipped.push(`${asset} ${timeframe}`); continue }
	const candles = JSON.parse(readFileSync(path, 'utf8')) as Candle[]
	const detection = detectArrowSignalCandidates(candles, APEX_PARAMS)
	const admitted = admitArrowSignals(detection.candidates) // filter=off: весь допущенный набор, один на все варианты
	const start = candles[0]!.timestamp, end = candles.at(-1)!.timestamp, boundary = start + (end - start) * TRAIN_FRACTION
	sources.push({ asset, timeframe, bars: candles.length, admitted: admitted.length, splitAt: new Date(boundary).toISOString() })

	for (const geo of GEOMETRIES) for (const { style, override } of EXIT_STYLES) {
		const replay = replayAdmittedArrowSignals(candles, detection.bands, admitted, geo, override)
		for (const t of replay.trades) {
			all.push({ ...t, asset, timeframe, geo, style, variant: `${geo}/${style}`, split: (t.signalAt < boundary ? 'train' : 'oos') as Split, cluster: `${Math.floor(t.signalAt / CLUSTER_MS)}-${t.side}` })
		}
	}
	process.stdout.write(`ok ${asset} ${timeframe}: bars=${candles.length} admitted=${admitted.length}\n`)
}

const variants = GEOMETRIES.flatMap(g => EXIT_STYLES.map(s => `${g}/${s.style}`))
const aggregate: any[] = []
for (const variant of variants) for (const split of ['train', 'oos'] as Split[]) {
	const rows = all.filter(t => t.variant === variant && t.split === split)
	aggregate.push({ variant, split, net: summarize(rows, `${variant}-${split}`) })
}
const slices: any[] = []
for (const variant of variants) for (const dimension of ['asset', 'side'] as const) {
	const keys = dimension === 'asset' ? [...ASSETS] : ['long', 'short']
	for (const key of keys) {
		const rows = all.filter(t => t.variant === variant && t.split === 'oos' && (t as any)[dimension] === key)
		slices.push({ variant, dimension, key, net: summarize(rows, `${variant}-oos-${dimension}-${key}`) })
	}
}
const survivors = aggregate.filter(a => a.split === 'oos' && a.net.meanR != null && a.net.meanR > 0 && a.net.ci95MeanR[0] != null && a.net.ci95MeanR[0] > 0)

const n2 = (x: any) => x == null ? 'n/a' : (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(3) : String(x))
const oosTable = aggregate.filter(a => a.split === 'oos').map(a => ({
	variant: a.variant, N: a.net.signals, netMeanR: n2(a.net.meanR), CIlo: n2(a.net.ci95MeanR[0]), CIhi: n2(a.net.ci95MeanR[1]),
	PF: n2(a.net.profitFactor), WR: n2(a.net.vendorStyleWR), posRate: n2(a.net.positiveRate), holdBars: n2(a.net.avgHoldBars), clusters: a.net.clusters,
}))
console.log('\n===== D1 OOS exit-variant (filter=off, net after 7bps) =====')
console.table(oosTable)
console.log('\n===== ВЫЖИВШИЕ OOS (meanR>0 И CI-low>0) =====')
if (!survivors.length) console.log('  (нет ни одной ячейки)')
else console.table(survivors.map(s => ({ variant: s.variant, N: s.net.signals, meanR: n2(s.net.meanR), CIlo: n2(s.net.ci95MeanR[0]), PF: n2(s.net.profitFactor) })))
if (skipped.length) console.log(`\nПропущено (нет кэша): ${skipped.join(', ')}`)

const result = {
	generatedAt: new Date().toISOString(), protocol: 'D1-exit-benchmark-1.0 (filter=off, exit-only sweep, threshold-free recombination of ARROW_MODE_CONFIGS)',
	preregistration: {
		universe: ASSETS, timeframes: TIMEFRAMES, geometries: GEOMETRIES, exitStyles: EXIT_STYLES.map(s => s.style),
		trainFraction: TRAIN_FRACTION, costs: '7 bps/side (ARROW_MODE_CONFIGS.oneWayCostBps); funding omitted',
		bootstrap: `${BOOTSTRAP_SAMPLES} trade-level resamples, seed ${BOOTSTRAP_SEED}`,
		note: 'Ни одного нового числа: geometry+exitStyle — рекомбинация существующих констант движка (§2.1).',
	},
	sources, skipped, survivors, aggregate, slices,
}
writeFileSync(resolve('ci-results/exit-benchmark-d1.json'), JSON.stringify(result, null, 2))
console.log(`\nWrote ci-results/exit-benchmark-d1.json (rows=${all.length}, survivors=${survivors.length})`)
