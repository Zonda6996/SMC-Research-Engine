// B1 — filter-benchmark харнесс (трек B из docs/ROADMAP.md).
//
// Что это: одна таблица «где что работает» по матрице filter × asset × TF × mode с train/OOS-сплитом,
//   издержками, детерминированным bootstrap CI, кластерами (4h+сторона) и срезами long/short + по активам.
// Причинность: используется ПРИЧИННЫЙ A1-путь допуска (admitArrowSignals -> replayAdmittedArrowSignals),
//   POI-зоны для liquidity/combo строятся на причинной массе (notionalAsOf, notionalSchedule сохранён).
//
// §2.1: НИ ОДНОГО нового порога/правила не введено. Определения фильтров (evaluateFilterMode + averageRange)
//   скопированы ВЕРБАТИМ из tools/visualizer/server.ts; издержки/сплит/CI/кластеры — из эталонного раннера
//   ci-results/run-zonda-profitability-cycle.ts. §2.3: движок (src/**) и существующие раннеры не тронуты.
//
// Данные — офлайн из кэша tools/batch/cache/{ASSET}-USDT_{tf}_20000_futures.json (как эталон). Отсутствует
//   файл — пара (asset,tf) пропускается с логом. Запуск: npx tsx tools/research/filterBenchmark.ts
//
// Дата сборки: 2026-08-14.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { admitArrowSignals, detectArrowSignalCandidates, type ArrowMode, type ArrowSignal } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayAdmittedArrowSignals, type ArrowTrade } from '../../src/core/signals/ArrowTradeReplay.js'
import { runAnalysis } from '../../src/core/analysis/runAnalysis.js'
import { detectLiquidityHeatmap, heatmapConfigForTf, inferTfMs } from '../../src/core/liquidity/LiquidityHeatmapEngine.js'
import { detectLiquidityPoi } from '../../src/core/confirmation/LiquidityPoiCalibration.js'
import { liquidityPoiProfileForTf } from '../shared/poiProfiles.js'

// ---- фиксировано ДО прогона (константы из эталонного раннера) ----
const ASSETS = ['SOL', 'BTC', 'ETH', 'XRP', 'BNB'] as const
const TIMEFRAMES = ['30m', '1h', '2h'] as const
const MODES: ArrowMode[] = ['safe', 'risk', 'standard']
const FILTERS = ['off', 'slope', 'reversal', 'contraction', 'exhaustion', 'liquidity', 'combo'] as const
type Filter = (typeof FILTERS)[number]
const TRAIN_FRACTION = 0.65
const ONE_WAY_COST_BPS = 7 // издержки уже применены в ARROW_MODE_CONFIGS (oneWayCostBps=7); здесь — для протокола
const CLUSTER_MS = 4 * 60 * 60 * 1000
const BOOTSTRAP_SAMPLES = 2000
const BOOTSTRAP_SEED = 20260807

type Split = 'train' | 'oos'
type TradeRow = ArrowTrade & { asset: string; timeframe: string; filter: Filter; mode: ArrowMode; split: Split; cluster: string }

// ---- VERBATIM из tools/visualizer/server.ts (averageRange) ----
function averageRange(candles: readonly Candle[], from: number, until: number): number {
	let sum = 0
	for (let i = from; i < until; i++) sum += candles[i]!.high - candles[i]!.low
	return until > from ? sum / (until - from) : 0
}

// ---- VERBATIM из tools/visualizer/server.ts (evaluateFilterMode) ----
function evaluateFilterMode(candles: readonly Candle[], bands: any[], signal: any, filterMode: string, poiCandidates?: any[]): boolean {
	if (filterMode === 'off') return true
	const i = signal.signalIndex, side = signal.side === 'long' ? 1 : -1

	if ((filterMode === 'liquidity' || filterMode === 'combo') && poiCandidates) {
		if (filterMode === 'combo' && signal.trigger?.relativeVolume >= 0.8) return false

		const activeZone = poiCandidates.find(zone => {
			if (zone.knownAt > signal.signalAt) return false
			if (zone.lifecycleState === 'spent' && zone.spentAt < signal.signalAt) return false

			if (signal.side === 'long' && zone.direction === 'long') {
				return candles[i]!.low <= Math.max(zone.near, zone.far)
			}
			if (signal.side === 'short' && zone.direction === 'short') {
				return candles[i]!.high >= Math.min(zone.near, zone.far)
			}
			return false
		})
		return !!activeZone
	}

	if (i < 200 || bands[i] == null || bands[i - 8] == null) return false
	let adverse = side === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
	for (let j = i - 8; j < i; j++) adverse = side === 1 ? Math.min(adverse, candles[j]!.low) : Math.max(adverse, candles[j]!.high)
	const c = candles[i]!
	const failedContinuation = side === 1 ? c.low >= adverse && c.close > c.open : c.high <= adverse && c.close < c.open
	let trSum = 0
	for (let j = i - 7; j <= i; j++) {
		const x = candles[j]!, p = candles[j - 1]!
		trSum += Math.max(x.high - x.low, Math.abs(x.high - p.close), Math.abs(x.low - p.close))
	}
	const meanSlopeAtr = side * (bands[i]!.mean - bands[i - 8]!.mean) / Math.max(trSum / 8, Number.EPSILON)
	const trendSlope = meanSlopeAtr > -0.25
	const contraction = averageRange(candles, i - 8, i) < averageRange(candles, i - 16, i - 8)
	const directional = side === 1 ? c.close > c.open : c.close < c.open

	if (filterMode === 'slope') return trendSlope
	if (filterMode === 'reversal') return trendSlope && failedContinuation
	if (filterMode === 'contraction') return (Number(failedContinuation) + Number(trendSlope) + Number(contraction) + Number(directional)) >= 3
	if (filterMode === 'exhaustion') return signal.trigger?.relativeVolume < 0.8
	return true
}

// ---- статистика (VERBATIM из ci-results/run-zonda-profitability-cycle.ts) ----
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
function summarize(rows: readonly TradeRow[], includeCosts: boolean, seedSalt: string) {
	const ordered = [...rows].sort((a, b) => a.entryAt - b.entryAt || a.asset.localeCompare(b.asset))
	const values = ordered.map(t => includeCosts ? t.netR : t.grossR).filter(Number.isFinite)
	const gains = values.filter(x => x > 0).reduce((a, b) => a + b, 0), losses = -values.filter(x => x < 0).reduce((a, b) => a + b, 0)
	const full = rows.filter(t => t.outcome === 'full-tp').length, partial = rows.filter(t => t.outcome === 'partial-be' || t.outcome === 'partial-stop').length, stop = rows.filter(t => t.outcome === 'stop').length
	const finalized = full + partial + stop
	const from = ordered[0]?.entryAt ?? null, to = ordered.at(-1)?.entryAt ?? null
	const months = from != null && to != null ? Math.max(1 / 30.4375, (to - from) / (30.4375 * 86400000)) : null
	const ci = bootstrapCI(values, seedSalt)
	return {
		signals: rows.length, finalized, open: rows.filter(t => t.outcome === 'open').length, timeout: rows.filter(t => t.outcome === 'timeout').length,
		totalR: values.reduce((a, b) => a + b, 0), meanR: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, medianR: median(values),
		ci95MeanR: ci, profitFactor: losses > 0 ? gains / losses : gains > 0 ? 'Infinity' : null,
		positiveRate: values.length ? values.filter(x => x > 0).length / values.length : null,
		vendorStyleWR: finalized ? (full + partial) / finalized : 0, maxDrawdownR: maxDrawdown(values),
		tradesPerMonth: months ? rows.length / months : null,
		clusters: new Set(rows.map(t => t.cluster)).size,
	}
}

// ---- построение причинных POI-зон для одной серии (зеркало tmp/reproFiltersCausal.ts prepare()) ----
function buildCausalPoi(candles: Candle[]): any[] {
	const snapshot = runAnalysis(candles)
	const tfMs = inferTfMs(snapshot.candles)
	const hmBase = heatmapConfigForTf(tfMs)
	const poolsCausal = detectLiquidityHeatmap(snapshot.candles, hmBase, undefined) // NO heatmapAux (fail-soft путь)
	const poiProfile = liquidityPoiProfileForTf(tfMs)
	return detectLiquidityPoi(snapshot.candles, snapshot.events, {
		structure: snapshot.structure,
		protectedHistory: snapshot.market.protectedHistory,
		heatmapPools: poolsCausal,
		config: poiProfile,
	})
}

// ---- прогон ----
const all: TradeRow[] = []
const sources: any[] = []
const skipped: string[] = []

for (const asset of ASSETS) for (const timeframe of TIMEFRAMES) {
	const path = resolve(`tools/batch/cache/${asset}-USDT_${timeframe}_20000_futures.json`)
	if (!existsSync(path)) { skipped.push(`${asset} ${timeframe} (нет кэша: ${path})`); continue }
	const rawCandles = JSON.parse(readFileSync(path, 'utf8')) as Candle[]
	// Единый массив свечей для detection/replay/POI (причинная консистентность индексов).
	const snapshot = runAnalysis(rawCandles)
	const candles = snapshot.candles
	const detection = detectArrowSignalCandidates(candles, APEX_PARAMS)
	const start = candles[0]!.timestamp, end = candles.at(-1)!.timestamp, boundary = start + (end - start) * TRAIN_FRACTION
	const poi = buildCausalPoi(rawCandles)
	sources.push({ asset, timeframe, bars: candles.length, poiZones: poi.length, from: new Date(start).toISOString(), to: new Date(end).toISOString(), splitAt: new Date(boundary).toISOString() })

	for (const filter of FILTERS) {
		const poiArg = filter === 'liquidity' || filter === 'combo' ? poi : undefined
		const filtered = detection.candidates.filter((s: ArrowSignal) => evaluateFilterMode(candles, detection.bands as any, s, filter, poiArg))
		const admitted = admitArrowSignals(filtered)
		for (const mode of MODES) {
			const replay = replayAdmittedArrowSignals(candles, detection.bands, admitted, mode)
			for (const t of replay.trades) {
				all.push({ ...t, asset, timeframe, filter, mode, split: (t.signalAt < boundary ? 'train' : 'oos') as Split, cluster: `${Math.floor(t.signalAt / CLUSTER_MS)}-${t.side}` })
			}
		}
	}
	process.stdout.write(`ok ${asset} ${timeframe}: bars=${candles.length} poi=${poi.length} cand=${detection.candidates.length}\n`)
}

// ---- агрегаты: filter × mode × split ----
const aggregate: any[] = []
for (const filter of FILTERS) for (const mode of MODES) for (const split of ['train', 'oos'] as Split[]) {
	const rows = all.filter(t => t.filter === filter && t.mode === mode && t.split === split)
	aggregate.push({ filter, mode, split, net: summarize(rows, true, `${filter}-${mode}-${split}-net`), gross: summarize(rows, false, `${filter}-${mode}-${split}-gross`) })
}

// ---- per-cell: asset × tf × filter × mode × split (OOS-фокус) ----
const cells: any[] = []
for (const asset of ASSETS) for (const timeframe of TIMEFRAMES) for (const filter of FILTERS) for (const mode of MODES) for (const split of ['train', 'oos'] as Split[]) {
	const rows = all.filter(t => t.asset === asset && t.timeframe === timeframe && t.filter === filter && t.mode === mode && t.split === split)
	if (!rows.length) continue
	cells.push({ asset, timeframe, filter, mode, split, net: summarize(rows, true, `${asset}-${timeframe}-${filter}-${mode}-${split}`) })
}

// ---- срезы breadth (OOS): по активу и по стороне ----
const slices: any[] = []
for (const filter of FILTERS) for (const mode of MODES) for (const dimension of ['asset', 'side'] as const) {
	const keys = dimension === 'asset' ? [...ASSETS] : ['long', 'short']
	for (const key of keys) {
		const rows = all.filter(t => t.filter === filter && t.mode === mode && t.split === 'oos' && (t as any)[dimension] === key)
		slices.push({ filter, mode, split: 'oos', dimension, key, net: summarize(rows, true, `${filter}-${mode}-oos-${dimension}-${key}`) })
	}
}

// ---- выжившие OOS: meanR>0 И нижняя граница CI>0 ----
const survivors = aggregate
	.filter(a => a.split === 'oos' && a.net.meanR != null && a.net.meanR > 0 && a.net.ci95MeanR[0] != null && a.net.ci95MeanR[0] > 0)
	.map(a => {
		const assetSlice = slices.filter(s => s.filter === a.filter && s.mode === a.mode && s.dimension === 'asset')
		const positiveAssets = assetSlice.filter(s => s.net.meanR != null && s.net.meanR > 0 && s.net.signals > 0).map(s => s.key)
		const longS = slices.find(s => s.filter === a.filter && s.mode === a.mode && s.dimension === 'side' && s.key === 'long')
		const shortS = slices.find(s => s.filter === a.filter && s.mode === a.mode && s.dimension === 'side' && s.key === 'short')
		return {
			filter: a.filter, mode: a.mode, N: a.net.signals, meanR: a.net.meanR, ci: a.net.ci95MeanR, pf: a.net.profitFactor, clusters: a.net.clusters,
			positiveAssetsCount: positiveAssets.length, positiveAssets,
			longMeanR: longS?.net.meanR ?? null, shortMeanR: shortS?.net.meanR ?? null,
		}
	})

// ---- вывод ----
const n2 = (x: any) => x == null ? 'n/a' : (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(3) : String(x))
const oosTable = aggregate.filter(a => a.split === 'oos').map(a => ({
	filter: a.filter, mode: a.mode, N: a.net.signals,
	netMeanR: n2(a.net.meanR), CIlo: n2(a.net.ci95MeanR[0]), CIhi: n2(a.net.ci95MeanR[1]),
	PF: n2(a.net.profitFactor), clusters: a.net.clusters, WR: n2(a.net.vendorStyleWR), posRate: n2(a.net.positiveRate), tpm: n2(a.net.tradesPerMonth),
}))
console.log('\n===== B1 OOS filter × mode (net, after 7bps) =====')
console.table(oosTable)
console.log('\n===== ВЫЖИВШИЕ OOS (meanR>0 И CI-low>0) =====')
if (!survivors.length) console.log('  (нет ни одной ячейки)')
else console.table(survivors.map(s => ({ filter: s.filter, mode: s.mode, N: s.N, meanR: n2(s.meanR), CIlo: n2(s.ci[0]), CIhi: n2(s.ci[1]), PF: n2(s.pf), clusters: s.clusters, '+assets': `${s.positiveAssetsCount}/5`, longR: n2(s.longMeanR), shortR: n2(s.shortMeanR) })))
if (skipped.length) { console.log('\nПропущено (нет кэша):'); for (const s of skipped) console.log('  - ' + s) }

const result = {
	generatedAt: new Date().toISOString(),
	protocol: 'B1-filter-benchmark-1.0 (causal A1 admission path)',
	preregistration: {
		universe: ASSETS, timeframes: TIMEFRAMES, modes: MODES, filters: FILTERS,
		trainFraction: TRAIN_FRACTION, splitRule: 'per asset/tf: first 65% of timestamp span = train; final 35% = oos',
		costs: `BingX VIP0 taker 5 bps + slippage 2 bps = ${ONE_WAY_COST_BPS} bps/side (already in ARROW_MODE_CONFIGS.oneWayCostBps); funding omitted`,
		path: 'detectArrowSignalCandidates -> evaluateFilterMode(verbatim from server.ts) -> admitArrowSignals -> replayAdmittedArrowSignals(mode)',
		poi: 'liquidity/combo use causal POI (notionalAsOf via notionalSchedule); heatmapAux=undefined',
		bootstrap: `${BOOTSTRAP_SAMPLES} trade-level resamples, seed ${BOOTSTRAP_SEED} (deterministic; does NOT remove correlation — clusters reported)`,
		survivorRule: 'OOS net meanR>0 AND CI-low>0 (candidate only; breadth via positiveAssets/long/short)',
	},
	sources, skipped, survivors, aggregate, cells, slices,
	notes: ['A1-путь допуска (не сравним побайтово с frozen baseline на replayArrowSignals — там per-mode кулдаун).', 'Funding отсутствует в кэше OHLCV.', 'Ни один порог не выдуман (§2.1): фильтры/издержки/сплит взяты из существующего кода.'],
}
writeFileSync(resolve('ci-results/filter-benchmark-b1.json'), JSON.stringify(result, null, 2))
console.log(`\nWrote ci-results/filter-benchmark-b1.json (rows=${all.length}, survivors=${survivors.length})`)
