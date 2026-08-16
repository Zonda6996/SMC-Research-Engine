// D3 — структурный/волновой контекст (трек D, docs/ROADMAP.md).
//
// Контекст: B1 → фильтры входа на самом OHLC edge не дают; D-lead → short на safe-геометрии повторяемо
//   положителен. Вопрос ЗДЕСЬ (D3): даёт ли edge СТРУКТУРНАЯ позиция сделки на момент входа — старший тренд/
//   premium-discount HTF и дистанция от последнего структурного слома (BOS/CHoCH)? Это НОВАЯ информация
//   (не тот же OHLC-тупик, что B1). Проверяем через ТОТ ЖЕ харнесс, что D4: train/OOS 65/35 по времени +
//   bootstrap CI + breadth по активам + кварталы.
//
// Метод: генерация сделок ВЕРБАТИМ повторяет tools/research/regimeGateD4.ts (safe-геометрия, static-тейк
//   2×step, cost-путь). Отличие: пул собирается по snapshot.candles = runAnalysis(rawCandles).candles
//   (причинная консистентность индексов, как в tools/research/filterBenchmark.ts), чтобы структурная
//   разметка (HTF-контекст + события BOS/CHoCH из snapshot) была согласована со свечами replay/detection.
//
// Разметка каузальна (knownAt <= entryTs / signalAt):
//   (A) HTF trend + premium/discount — готовый модуль src/core/analysis/htfContext.js (buildHtfContext/
//       htfContextAt), HTF-якорь = 4h для ВСЕХ LTF (⚠ нейтральный дефолт, решает автор, НЕ свипается).
//   (B) дистанция от BOS — последнее событие snapshot.events с type!=='unlabeled' и confirmTimestamp<=signalAt;
//       barsSinceBos = signal.signalIndex - lastEvent.confirmIndex. Бакетизация — МЕДИАННЫЙ сплит по TRAIN
//       (⚠ нейтральный дефолт, решает автор, НЕ свипается).
//
// §2.1: НИ ОДНОГО выдуманного порога — только нейтральные дефолты, помеченные «⚠ решает автор», НЕ свипаются.
//   §2.3: src (src/**) и существующие раннеры не тронуты; replayStatic + stats-хелперы + Row-loop скопированы
//   ВЕРБАТИМ из regimeGateD4.ts (тег регима/BTC-загрузка убраны); htfContext — готовый модуль.
// Данные — офлайн кэш. Запуск: npx tsx tools/research/structureContextD3.ts. Дата: 2026-08-14.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { admitArrowSignals, detectArrowSignalCandidates, type ArrowSide, type ArrowSignal } from '../../src/core/signals/ArrowSignalEngine.js'
import { ARROW_MODE_CONFIGS } from '../../src/core/signals/ArrowTradeReplay.js'
import { runAnalysis } from '../../src/core/analysis/runAnalysis.js'
import { buildHtfContext, htfContextAt, type HtfContext } from '../../src/core/analysis/htfContext.js'

const ASSETS = ['SOL', 'BTC', 'ETH', 'XRP', 'BNB'] as const
const TIMEFRAMES = ['30m', '1h', '2h'] as const
const GEO = 'safe' as const
const TARGET_STEPS = 2 // валидированный baseline из D1/D1.2
const CLUSTER_MS = 4 * 60 * 60 * 1000
const BOOTSTRAP_SAMPLES = 2000
const BOOTSTRAP_SEED = 20260807

// ⚠ HTF-якорь — единый старший ТФ (4h) для ВСЕХ LTF; нейтральный дефолт, финальное определение — решение автора, НЕ свипается (§2.1).
const HTF_ANCHOR = '4h' as const
const HTF_ANCHOR_MS = 14_400_000 // 4h в мс
const HTF_PIVOT_WINDOW = 2 // дефолт runAnalysis (pivotWindow=2)

type Outcome = 'full-tp' | 'stop' | 'timeout' | 'open'
type PdZone = 'premium' | 'discount' | 'none'
interface Row {
	asset: string
	timeframe: string
	side: ArrowSide
	netR: number
	outcome: Outcome
	signalAt: number
	quarter: string
	cluster: string
	// D3 структурная разметка (каузальна на момент входа):
	trendAligned: boolean | null
	pdAligned: boolean | null
	pdZone: PdZone
	barsSinceBos: number | null
}

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

// train/OOS 65/35 split BY TIME (ВЕРБАТИМ из regimeGateD4.ts)
function splitByTime(rows: readonly Row[]): { train: Row[]; oos: Row[] } {
	const sorted = [...rows].sort((a, b) => a.signalAt - b.signalAt)
	const cut = Math.floor(sorted.length * 0.65)
	return { train: sorted.slice(0, cut), oos: sorted.slice(cut) }
}

// ============================================================================
// STEP A — HTF-контекст по активу (4h-якорь), кэш переиспользуется для всех 3 LTF.
// ============================================================================
const htfCtxCache = new Map<string, HtfContext | null>()
function htfContextFor(asset: string): HtfContext | null {
	if (htfCtxCache.has(asset)) return htfCtxCache.get(asset)!
	const path = resolve(`tools/batch/cache/${asset}-USDT_${HTF_ANCHOR}_20000_futures.json`)
	if (!existsSync(path)) {
		process.stdout.write(`  ⚠ нет 4h-кэша для ${asset} — labels='none' (${path})\n`)
		htfCtxCache.set(asset, null)
		return null
	}
	const htfRawCandles = JSON.parse(readFileSync(path, 'utf8')) as Candle[]
	const htfSnapshot = runAnalysis(htfRawCandles)
	const ctx = buildHtfContext(htfSnapshot, HTF_ANCHOR_MS, HTF_PIVOT_WINDOW)
	htfCtxCache.set(asset, ctx)
	return ctx
}

// ============================================================================
// STEP B — дистанция от последнего структурного слома (каузально).
// «structural break» = событие с type !== 'unlabeled'. Последнее с confirmTimestamp <= signalAt.
// events отсортированы по confirmIndex (BosChochEngine); линейный проход достаточен.
// ============================================================================
interface StructEventLite { type: string; confirmTimestamp: number; confirmIndex: number }
function lastBreakConfirmIndexAt(events: readonly StructEventLite[], signalAt: number): number | null {
	let last: number | null = null
	for (const e of events) {
		if (e.type === 'unlabeled') continue
		if (e.confirmTimestamp <= signalAt) last = e.confirmIndex
		else break // отсортировано по confirmIndex ~ по времени; дальше только позже
	}
	return last
}

// ============================================================================
// STEP 1 — сбор пула сделок + структурная разметка (каузально на момент входа).
// ============================================================================
const all: Row[] = []
const skipped: string[] = []
const noHtfAssets = new Set<string>()
for (const asset of ASSETS) for (const timeframe of TIMEFRAMES) {
	const path = resolve(`tools/batch/cache/${asset}-USDT_${timeframe}_20000_futures.json`)
	if (!existsSync(path)) { skipped.push(`${asset} ${timeframe}`); continue }
	const rawCandles = JSON.parse(readFileSync(path, 'utf8')) as Candle[]
	const snapshot = runAnalysis(rawCandles)
	const candles = snapshot.candles // причинная консистентность индексов (как filterBenchmark.ts)
	const events = snapshot.events as unknown as StructEventLite[]
	const htfCtx = htfContextFor(asset)
	if (htfCtx == null) noHtfAssets.add(asset)
	const detection = detectArrowSignalCandidates(candles, APEX_PARAMS)
	for (const signal of admitArrowSignals(detection.candidates)) {
		const t = replayStatic(candles, signal)
		if (t == null) continue // entryIndex вне массива / невалидная геометрия — пропускаем синхронно
		// Точка входа как в replayStatic:
		const entryIndex = signal.signalIndex + 1
		const entryCandle = candles[entryIndex]!
		const entryPrice = entryCandle.open
		const entryTs = entryCandle.timestamp
		// (A) HTF trend + premium/discount на момент входа.
		let trendAligned: boolean | null = null
		let pdAligned: boolean | null = null
		let pdZone: PdZone = 'none'
		if (htfCtx != null) {
			const h = htfContextAt(htfCtx, entryTs, entryPrice, signal.side)
			trendAligned = h.trendAligned
			pdAligned = h.pdAligned
			pdZone = h.pdZone
		}
		// (B) дистанция от BOS (каузально, из snapshot.events).
		const lastConfirmIndex = lastBreakConfirmIndexAt(events, signal.signalAt)
		const barsSinceBos = lastConfirmIndex == null ? null : Math.max(0, signal.signalIndex - lastConfirmIndex)
		all.push({
			asset, timeframe, side: t.side, netR: t.netR, outcome: t.outcome, signalAt: t.signalAt,
			quarter: quarterOf(t.signalAt), cluster: `${Math.floor(t.signalAt / CLUSTER_MS)}-${t.side}`,
			trendAligned, pdAligned, pdZone, barsSinceBos,
		})
	}
	process.stdout.write(`ok ${asset} ${timeframe}\n`)
}

const n2 = (x: any) => x == null ? 'n/a' : (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(3) : String(x))

// ⚠ определение ноги импульса (impulse leg) из ROADMAP D3 — НЕ реализовано.
const IMPULSE_LEG_TODO = '⚠ определение ноги импульса не задано автором — не выдумываем (§2.1)'
console.log(`\nTODO: ${IMPULSE_LEG_TODO}`)

// ============================================================================
// STEP 2 — медианный сплит barsSinceBos ТОЛЬКО по TRAIN-части пула (не подглядывать в OOS).
// ⚠ медианный сплит — нейтральный дефолт бакетизации, решает автор, НЕ свипается (§2.1).
// ============================================================================
const bosRows = all.filter(t => t.barsSinceBos != null)
const { train: bosTrain } = splitByTime(bosRows)
const bosTrainVals = bosTrain.map(t => t.barsSinceBos!).filter(Number.isFinite)
const bosMedianTrain = quantile(bosTrainVals, 0.5) // медиана по TRAIN
const isBosNear = (t: Row) => t.barsSinceBos != null && bosMedianTrain != null && t.barsSinceBos <= bosMedianTrain
const isBosFar = (t: Row) => t.barsSinceBos != null && bosMedianTrain != null && t.barsSinceBos > bosMedianTrain

// ============================================================================
// STEP 3 — гейты (каждый vs baseline).
// ============================================================================
const gateRows: Record<string, Row[]> = {
	baseline_all: all,
	trend_aligned: all.filter(t => t.trendAligned === true),
	trend_counter: all.filter(t => t.trendAligned === false),
	pd_aligned: all.filter(t => t.pdAligned === true),
	pd_counter: all.filter(t => t.pdAligned === false),
	pd_discount: all.filter(t => t.pdZone === 'discount'),
	pd_premium: all.filter(t => t.pdZone === 'premium'),
	bos_near: all.filter(isBosNear),
	bos_far: all.filter(isBosFar),
}

const gateResults: Record<string, { full: ReturnType<typeof summ>; train: ReturnType<typeof summ>; oos: ReturnType<typeof summ> }> = {}
for (const [name, rows] of Object.entries(gateRows)) {
	const { train, oos } = splitByTime(rows)
	gateResults[name] = {
		full: summ(rows, `d3-${name}-full`),
		train: summ(train, `d3-${name}-train`),
		oos: summ(oos, `d3-${name}-oos`),
	}
}

// ============================================================================
// STEP 4 — breadth по активам (OOS) для ключевых гейтов + per-quarter для aligned.
// ============================================================================
const BREADTH_GATES = ['trend_aligned', 'trend_counter', 'pd_aligned', 'pd_counter', 'bos_near', 'bos_far', 'baseline_all'] as const
const breadth: Record<string, { asset: string; N: number; meanR: number | null }[]> = {}
for (const g of BREADTH_GATES) {
	const rows = gateRows[g]!
	const { oos } = splitByTime(rows)
	breadth[g] = ASSETS.map(a => { const s = summ(oos.filter(t => t.asset === a), `d3-${g}-oos-${a}`); return { asset: a, N: s.N, meanR: s.meanR } })
}

function perQuarter(rows: readonly Row[], saltPrefix: string) {
	const quarters = [...new Set(rows.map(t => t.quarter))].sort()
	const rowsQ = quarters.map(q => { const s = summ(rows.filter(t => t.quarter === q), `${saltPrefix}-${q}`); return { quarter: q, N: s.N, meanR: s.meanR, ci: s.ci, pf: s.pf } }).filter(r => r.N > 0)
	const withData = rowsQ.filter(r => r.N >= 10)
	const positive = withData.filter(r => (r.meanR ?? 0) > 0).length
	return { rows: rowsQ, quartersWithData: withData.length, positiveQuarters: positive, positiveShare: withData.length ? positive / withData.length : 0 }
}
const perQuarterTrendAligned = perQuarter(gateRows.trend_aligned!, 'd3-q-trend-aligned')
const perQuarterPdAligned = perQuarter(gateRows.pd_aligned!, 'd3-q-pd-aligned')

// ============================================================================
// STEP 5 — выжившие (правило B1): OOS meanR>0 И ci[0]>0.
// ============================================================================
const survivors = Object.entries(gateResults)
	.filter(([, r]) => r.oos.meanR != null && r.oos.meanR > 0 && r.oos.ci[0] != null && (r.oos.ci[0] as number) > 0)
	.map(([name, r]) => ({ gate: name, N: r.oos.N, meanR: r.oos.meanR, ci: r.oos.ci, pf: r.oos.pf, clusters: r.oos.clusters }))

// ============================================================================
// STEP 6 — console output.
// ============================================================================
console.log(`\n===== D3 — структурный/волновой контекст (HTF-якорь=${HTF_ANCHOR}, pivotWindow=${HTF_PIVOT_WINDOW}) =====`)
console.log(`Пул сделок всего: ${all.length}; с barsSinceBos!=null: ${bosRows.length}; bosMedianTrain=${n2(bosMedianTrain)}`)
if (noHtfAssets.size) console.log(`Активы без 4h-кэша (labels='none'): ${[...noHtfAssets].join(', ')}`)
if (skipped.length) console.log(`Пропущено LTF-кэшей: ${skipped.join(', ')}`)

console.log(`\n----- гейты (full-history) -----`)
console.table(Object.entries(gateResults).map(([name, r]) => ({ gate: name, N: r.full.N, meanR: n2(r.full.meanR), CIlo: n2(r.full.ci[0]), CIhi: n2(r.full.ci[1]), PF: n2(r.full.pf), clusters: r.full.clusters })))

console.log(`\n----- train/OOS 65-35 по времени -----`)
const oosRows: any[] = []
for (const name of Object.keys(gateResults)) {
	const r = gateResults[name]!
	oosRows.push({ gate: name, split: 'train', N: r.train.N, meanR: n2(r.train.meanR), CIlo: n2(r.train.ci[0]), CIhi: n2(r.train.ci[1]), PF: n2(r.train.pf) })
	oosRows.push({ gate: name, split: 'OOS', N: r.oos.N, meanR: n2(r.oos.meanR), CIlo: n2(r.oos.ci[0]), CIhi: n2(r.oos.ci[1]), PF: n2(r.oos.pf) })
}
console.table(oosRows)

console.log(`\n----- breadth по активам (OOS) -----`)
for (const g of BREADTH_GATES) {
	console.log(`  gate=${g}`)
	console.table(breadth[g]!.map(x => ({ asset: x.asset, N: x.N, meanR: n2(x.meanR) })))
}

console.log(`\n----- per-quarter (trend_aligned) -----`)
console.table(perQuarterTrendAligned.rows.map(r => ({ quarter: r.quarter, N: r.N, meanR: n2(r.meanR), CIlo: n2(r.ci[0]), CIhi: n2(r.ci[1]), PF: n2(r.pf) })))
console.log(`Кварталов N>=10: ${perQuarterTrendAligned.quartersWithData}; из них meanR>0: ${perQuarterTrendAligned.positiveQuarters} (${(100 * perQuarterTrendAligned.positiveShare).toFixed(0)}%)`)

console.log(`\n----- per-quarter (pd_aligned) -----`)
console.table(perQuarterPdAligned.rows.map(r => ({ quarter: r.quarter, N: r.N, meanR: n2(r.meanR), CIlo: n2(r.ci[0]), CIhi: n2(r.ci[1]), PF: n2(r.pf) })))
console.log(`Кварталов N>=10: ${perQuarterPdAligned.quartersWithData}; из них meanR>0: ${perQuarterPdAligned.positiveQuarters} (${(100 * perQuarterPdAligned.positiveShare).toFixed(0)}%)`)

console.log(`\n----- ВЫЖИВШИЕ OOS (meanR>0 И CI-low>0) -----`)
if (!survivors.length) console.log('  (нет ни одного гейта)')
else console.table(survivors.map(s => ({ gate: s.gate, N: s.N, meanR: n2(s.meanR), CIlo: n2(s.ci[0]), CIhi: n2(s.ci[1]), PF: n2(s.pf), clusters: s.clusters })))

// ============================================================================
// STEP 7 — write JSON artifact.
// ============================================================================
writeFileSync(resolve('ci-results/structure-context-d3.json'), JSON.stringify({
	generatedAt: new Date().toISOString(),
	protocol: 'D3-structure-context-1.0',
	fixedStrategy: { geometry: GEO, exit: 'static-full', targetSteps: TARGET_STEPS, costsBps: 7 },
	buckets: {
		htfAnchorTf: HTF_ANCHOR,
		pivotWindow: HTF_PIVOT_WINDOW,
		bosBreakDef: "type!==unlabeled",
		bosSplit: 'median(barsSinceBos) on train',
		bosMedianTrain,
		note: '⚠ дефолты нейтральные, финальные определения корзин — решает автор; НЕ свипались (§2.1)',
	},
	gates: gateResults,
	breadth,
	perQuarter: { trend_aligned: perQuarterTrendAligned, pd_aligned: perQuarterPdAligned },
	survivors,
	impulseLegTodo: IMPULSE_LEG_TODO,
	poolTotal: all.length,
	bosRowCount: bosRows.length,
	noHtfAssets: [...noHtfAssets],
	skipped,
	note: '§2.3: src не тронут, replayStatic/stats вербатим из regimeGateD4.ts; htfContext — готовый модуль; разметка каузальна (knownAt<=entryTs/signalAt)',
}, null, 2))
console.log(`\nWrote ci-results/structure-context-d3.json (pool=${all.length}, survivors=${survivors.length})`)
