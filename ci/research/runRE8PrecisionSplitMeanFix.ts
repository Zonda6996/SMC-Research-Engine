/**
 * RE8 — split full-fix-at-mean сделок на MATCHED (наш OWN2-сигнал совпадает с
 * vendor CSV-shape той же стороны в пределах ±1 бара) vs EXTRA (нет vendor-shape),
 * и сравнение их экономики.
 *
 * Мотив: плохая статистика mean-fix (E5) может идти либо ОТ СТРАТЕГИИ (плохие сделки
 * даже на настоящих vendor-сетапах), либо ОТ OWN2-ПЕРЕИЗЛУЧЕНИЯ (низкая precision:
 * триггер ставит стрелки там, где vendor молчит). Если MATCHED meanR >> EXTRA meanR
 * и EXTRA тянет агрегат вниз → стратегия ок на настоящих сетапах, проблема = precision.
 * Если MATCHED тоже слабый → слаба сама стратегия.
 *
 * §2.2: правило анализа НЕ придумывается — используются подтверждённые сигнатуры движка.
 * Движок src/core НЕ трогается — это измерительный харнесс.
 * Только 3 серии 5m имеют vendor CSV-shapes: VIRTUAL(author)/BNB/BTC. LDO/AVAX/ONDO исключены.
 *
 * Запуск: npx tsx ci/research/runRE8PrecisionSplitMeanFix.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { detectArrowSignalCandidates } from '../../src/core/signals/ArrowSignalEngine.js'
import { computeApexBands, APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { replayArrowSignals } from '../../src/core/signals/ArrowTradeReplay.js'
import type { ArrowTrade, ArrowModeConfig } from '../../src/core/signals/ArrowTradeReplay.js'

const REL_VOL = 1.4

const FILES: Array<{ key: string; file: string; author?: boolean }> = [
	{ key: 'VIRTUAL.P 5m', file: 'csv/BINANCE_VIRTUALUSDT.P, 5.csv', author: true },
	{ key: 'BNB.P 5m', file: 'csv/BINANCE_BNBUSDT.P, 5.csv' },
	{ key: 'BTC.P 5m', file: 'csv/BINANCE_BTCUSDT.P, 5.csv' },
]

const num = (x: string | undefined): number => { const n = Number((x ?? '').trim()); return Number.isFinite(n) ? n : NaN }

interface Loaded {
	candles: Candle[]
	shapes: Array<{ i: number; side: 'buy' | 'sell' }>
}

/** Adapted from ci/research/runRE6LocalPivotFit.ts loadCsv. col0=ts(sec)→*1000. */
function loadCsv(file: string): Loaded {
	const lines = readFileSync(resolve(file), 'utf8').split(/\r?\n/).filter((l) => l.length > 0)
	const candles: Candle[] = []
	const shapes: Array<{ i: number; side: 'buy' | 'sell' }> = []
	for (let li = 1; li < lines.length; li++) {
		const p = lines[li]!.split(',')
		if (p.length < 13) continue
		const ts = num(p[0]), o = num(p[1]), h = num(p[2]), l = num(p[3]), c = num(p[4])
		if (![ts, o, h, l, c].every(Number.isFinite)) continue
		const i = candles.length
		candles.push({ timestamp: ts * 1000, open: o, high: h, low: l, close: c, volume: num(p[12]) || 0 })
		const buy = (p[10] ?? '0').trim() === '1'
		const sell = (p[11] ?? '0').trim() === '1'
		if (buy) shapes.push({ i, side: 'buy' })
		else if (sell) shapes.push({ i, side: 'sell' })
	}
	return { candles, shapes }
}

type Bucket = 'ALL' | 'MATCHED' | 'EXTRA'

interface Metrics {
	n: number
	wr: number // count(netR>0)/N
	vendorWr: number // count(outcome full-tp|partial-be)/N
	totalR: number
	meanR: number
	pf: number | null
}

function metricsOf(trades: ArrowTrade[]): Metrics {
	const n = trades.length
	if (n === 0) return { n: 0, wr: 0, vendorWr: 0, totalR: 0, meanR: 0, pf: null }
	const wins = trades.filter((t) => t.netR > 0).length
	const vendorWins = trades.filter((t) => t.outcome === 'full-tp' || t.outcome === 'partial-be').length
	const totalR = trades.reduce((s, t) => s + t.netR, 0)
	const gains = trades.filter((t) => t.netR > 0).reduce((s, t) => s + t.netR, 0)
	const losses = -trades.filter((t) => t.netR < 0).reduce((s, t) => s + t.netR, 0)
	const pf = losses > 0 ? gains / losses : (gains > 0 ? Number.POSITIVE_INFINITY : null)
	return { n, wr: wins / n, vendorWr: vendorWins / n, totalR, meanR: totalR / n, pf }
}

/** MATCHED if a vendor shape of the corresponding side exists at signalIndex+d, d∈{-1,0,1}. */
function classifyMatched(trade: ArrowTrade, shapeByIdx: Map<number, Set<'buy' | 'sell'>>): boolean {
	const wantSide: 'buy' | 'sell' = trade.side === 'long' ? 'buy' : 'sell'
	for (let d = -1; d <= 1; d++) {
		const set = shapeByIdx.get(trade.signalIndex + d)
		if (set && set.has(wantSide)) return true
	}
	return false
}

interface SeriesResult {
	key: string
	author: boolean
	own2Signals: number
	vendorShapes: number
	ratio: number
	// primary arm split trades (finalized only) with train/oos flag
	matched: { finalized: ArrowTrade[]; train: ArrowTrade[]; oos: ArrowTrade[] }
	extra: { finalized: ArrowTrade[]; train: ArrowTrade[]; oos: ArrowTrade[] }
}

function pct(x: number): string { return Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a' }
function pf2(x: number | null): string { return x == null ? 'n/a' : (x === Number.POSITIVE_INFINITY ? '∞' : x.toFixed(2)) }
function r2(x: number): string { return x.toFixed(3) }

interface ArmAgg {
	all: Metrics
	matched: Metrics
	extra: Metrics
}

function aggregateArm(loaded: Array<{ key: string; l: Loaded }>, override: Partial<ArrowModeConfig>): {
	arm: ArmAgg
	perSeriesMeanR: Array<{ key: string; matchedMeanR: number; extraMeanR: number; matchedN: number; extraN: number }>
	trainOos: {
		trainMatched: Metrics; trainExtra: Metrics; oosMatched: Metrics; oosExtra: Metrics
	}
} {
	const allT: ArrowTrade[] = []
	const matchedT: ArrowTrade[] = []
	const extraT: ArrowTrade[] = []
	const trainMatchedT: ArrowTrade[] = []
	const trainExtraT: ArrowTrade[] = []
	const oosMatchedT: ArrowTrade[] = []
	const oosExtraT: ArrowTrade[] = []
	const perSeriesMeanR: Array<{ key: string; matchedMeanR: number; extraMeanR: number; matchedN: number; extraN: number }> = []

	for (const { key, l } of loaded) {
		const det = detectArrowSignalCandidates(l.candles, APEX_PARAMS, { minimumRelativeVolume: REL_VOL })
		const bands = computeApexBands([...l.candles], APEX_PARAMS)
		const replay = replayArrowSignals(l.candles, bands, det.candidates, 'safe', override)
		const shapeByIdx = new Map<number, Set<'buy' | 'sell'>>()
		for (const s of l.shapes) { const set = shapeByIdx.get(s.i) ?? new Set<'buy' | 'sell'>(); set.add(s.side); shapeByIdx.set(s.i, set) }

		// train/oos cutoff per series
		const firstTs = l.candles.length ? l.candles[0]!.timestamp : 0
		const lastTs = l.candles.length ? l.candles[l.candles.length - 1]!.timestamp : 0
		const cutoff = firstTs + 0.65 * (lastTs - firstTs)

		const finalized = replay.trades.filter((t) => t.outcome !== 'open')
		let seriesMatched: ArrowTrade[] = []
		let seriesExtra: ArrowTrade[] = []
		for (const t of finalized) {
			const isMatched = classifyMatched(t, shapeByIdx)
			allT.push(t)
			if (isMatched) { matchedT.push(t); seriesMatched.push(t) } else { extraT.push(t); seriesExtra.push(t) }
			const isTrain = t.signalAt <= cutoff
			if (isMatched) { if (isTrain) trainMatchedT.push(t); else oosMatchedT.push(t) }
			else { if (isTrain) trainExtraT.push(t); else oosExtraT.push(t) }
		}
		const mM = metricsOf(seriesMatched)
		const mE = metricsOf(seriesExtra)
		perSeriesMeanR.push({ key, matchedMeanR: mM.meanR, extraMeanR: mE.meanR, matchedN: mM.n, extraN: mE.n })
	}

	return {
		arm: { all: metricsOf(allT), matched: metricsOf(matchedT), extra: metricsOf(extraT) },
		perSeriesMeanR,
		trainOos: {
			trainMatched: metricsOf(trainMatchedT), trainExtra: metricsOf(trainExtraT),
			oosMatched: metricsOf(oosMatchedT), oosExtra: metricsOf(oosExtraT),
		},
	}
}

function main() {
	const loaded: Array<{ key: string; author: boolean; l: Loaded }> = []
	const counts: SeriesResult[] = []
	for (const { key, file, author } of FILES) {
		let l: Loaded
		try { l = loadCsv(file) } catch (e) { console.log(`skip ${key}: ${(e as Error).message}`); continue }
		if (l.candles.length < 400) { console.log(`skip ${key}: rows=${l.candles.length}`); continue }
		const det = detectArrowSignalCandidates(l.candles, APEX_PARAMS, { minimumRelativeVolume: REL_VOL })
		const own2 = det.candidates.length
		const vendor = l.shapes.length
		const ratio = vendor > 0 ? own2 / vendor : NaN
		counts.push({
			key, author: !!author, own2Signals: own2, vendorShapes: vendor, ratio,
			matched: { finalized: [], train: [], oos: [] }, extra: { finalized: [], train: [], oos: [] },
		})
		loaded.push({ key, author: !!author, l })
		console.log(`prep ${key}: candles=${l.candles.length} OWN2=${own2} shapes=${vendor} ratio=${Number.isFinite(ratio) ? ratio.toFixed(2) : 'n/a'}`)
	}
	if (!loaded.length) throw new Error('Нет загруженных CSV из csv/.')

	const primaryOverride: Partial<ArrowModeConfig> = { fullFixAtMean: true, addEnabled: false }
	const stop1xOverride: Partial<ArrowModeConfig> = { fullFixAtMean: true, addEnabled: false, stopSteps: 1 }

	const primary = aggregateArm(loaded.map((x) => ({ key: x.key, l: x.l })), primaryOverride)
	const stop1x = aggregateArm(loaded.map((x) => ({ key: x.key, l: x.l })), stop1xOverride)

	// ---- MD ----
	const md: string[] = []
	md.push('# RE8 — precision-split full-fix-at-mean: MATCHED (vendor-shape) vs EXTRA')
	md.push('')
	md.push('**Цель:** разложить full-fix-at-mean сделки на MATCHED (наш OWN2-сигнал совпадает с vendor CSV-shape той же стороны в пределах ±1 бара) и EXTRA (vendor-shape нет), чтобы понять, идёт ли плохая mean-fix статистика ОТ СТРАТЕГИИ или ОТ OWN2-переизлучения (низкая precision).')
	md.push('')
	md.push('> §2.2: LDO/AVAX/ONDO исключены — у них нет vendor CSV-shapes. Только VIRTUAL(автор)/BNB/BTC 5m содержат shapes. Движок `src/core` не тронут — измерительный харнесс. relVol=1.4, каноничные Apex-полосы, arm=safe + `{fullFixAtMean:true, addEnabled:false}`.')
	md.push('')
	md.push('## 1. Счётчики по сериям')
	md.push('')
	md.push('| серия | OWN2 сигналы | vendor shapes | ratio (OWN2/shapes) |')
	md.push('|---|---|---|---|')
	for (const c of counts) md.push(`| ${c.key}${c.author ? ' (автор)' : ''} | ${c.own2Signals} | ${c.vendorShapes} | ${Number.isFinite(c.ratio) ? '×' + c.ratio.toFixed(2) : 'n/a'} |`)
	md.push('')

	const bucketTable = (agg: ArmAgg): string[] => {
		const rows: Array<[Bucket, Metrics]> = [['ALL', agg.all], ['MATCHED', agg.matched], ['EXTRA', agg.extra]]
		const out: string[] = []
		out.push('| bucket | N | WR (netR>0) | vendorWR | totalR | meanR | PF |')
		out.push('|---|---|---|---|---|---|---|')
		for (const [b, m] of rows) out.push(`| ${b} | ${m.n} | ${pct(m.wr)} | ${pct(m.vendorWr)} | ${r2(m.totalR)} | ${r2(m.meanR)} | ${pf2(m.pf)} |`)
		return out
	}

	md.push('## 2. PRIMARY arm (canon safe, fullFixAtMean, addEnabled:false) — агрегат по 3 сериям')
	md.push('')
	md.push(...bucketTable(primary.arm))
	md.push('')
	md.push('### 2.1 Per-series meanR (MATCHED / EXTRA)')
	md.push('')
	md.push('| серия | MATCHED N | MATCHED meanR | EXTRA N | EXTRA meanR |')
	md.push('|---|---|---|---|---|')
	for (const s of primary.perSeriesMeanR) md.push(`| ${s.key} | ${s.matchedN} | ${r2(s.matchedMeanR)} | ${s.extraN} | ${r2(s.extraMeanR)} |`)
	md.push('')
	md.push('### 2.2 TRAIN / OOS (cutoff = firstTs + 0.65·span, per-series; агрегат)')
	md.push('')
	md.push('| выборка | bucket | N | meanR | totalR |')
	md.push('|---|---|---|---|---|')
	md.push(`| TRAIN | MATCHED | ${primary.trainOos.trainMatched.n} | ${r2(primary.trainOos.trainMatched.meanR)} | ${r2(primary.trainOos.trainMatched.totalR)} |`)
	md.push(`| TRAIN | EXTRA | ${primary.trainOos.trainExtra.n} | ${r2(primary.trainOos.trainExtra.meanR)} | ${r2(primary.trainOos.trainExtra.totalR)} |`)
	md.push(`| OOS | MATCHED | ${primary.trainOos.oosMatched.n} | ${r2(primary.trainOos.oosMatched.meanR)} | ${r2(primary.trainOos.oosMatched.totalR)} |`)
	md.push(`| OOS | EXTRA | ${primary.trainOos.oosExtra.n} | ${r2(primary.trainOos.oosExtra.meanR)} | ${r2(primary.trainOos.oosExtra.totalR)} |`)
	md.push('')

	md.push('## 3. stop1x arm (canon safe, fullFixAtMean, addEnabled:false, stopSteps:1) — агрегат')
	md.push('')
	md.push(...bucketTable(stop1x.arm))
	md.push('')

	// ---- Вывод (черновой) ----
	md.push('## 4. Вывод (черновой)')
	md.push('')
	const pm = primary.arm.matched
	const pe = primary.arm.extra
	const matchedBetter = pm.n > 0 && pe.n > 0 && pm.meanR > pe.meanR
	const matchedStrong = pm.n > 0 && pm.meanR > 0
	const extraDrags = pe.n > 0 && pe.meanR < primary.arm.all.meanR
	if (matchedStrong && matchedBetter && extraDrags) {
		md.push(`- MATCHED meanR (${r2(pm.meanR)}) выше EXTRA meanR (${r2(pe.meanR)}), и EXTRA (meanR ${r2(pe.meanR)}, N=${pe.n}) тянет агрегат (ALL meanR ${r2(primary.arm.all.meanR)}) вниз. Это согласуется с гипотезой «стратегия ОК на настоящих vendor-сетапах, проблема = OWN2-переизлучение / низкая precision». НЕ переинтерпретировать: MATCHED-выборка мала (N=${pm.n}).`)
	} else if (pm.n > 0 && pm.meanR <= 0) {
		md.push(`- MATCHED meanR (${r2(pm.meanR)}) тоже неположителен → сама стратегия слаба даже на настоящих vendor-сетапах; проблема не сводится к переизлучению. EXTRA meanR=${r2(pe.meanR)} (N=${pe.n}).`)
	} else if (matchedBetter) {
		md.push(`- MATCHED meanR (${r2(pm.meanR)}) выше EXTRA (${r2(pe.meanR)}), но картина неоднозначна (ALL meanR ${r2(primary.arm.all.meanR)}). Данных мало для сильного вывода: MATCHED N=${pm.n}, EXTRA N=${pe.n}.`)
	} else {
		md.push(`- Разделение MATCHED (meanR ${r2(pm.meanR)}, N=${pm.n}) vs EXTRA (meanR ${r2(pe.meanR)}, N=${pe.n}) не даёт однозначной картины. Без overclaiming: нужен больший объём vendor-shape сделок.`)
	}
	md.push('')
	md.push('_Числа — сырые netR (с издержками 7 bps/side, как в движке). Без overclaiming: vendor-shapes есть только на 3 сериях 5m._')
	md.push('')

	writeFileSync(resolve('ci-results/re8-precision-split-meanfix.md'), md.join('\n'))

	const jsonOut = {
		generatedAt: new Date().toISOString(),
		relVol: REL_VOL,
		note: 'Only VIRTUAL(author)/BNB/BTC 5m have vendor CSV-shapes; LDO/AVAX/ONDO excluded (§2.2).',
		series: counts.map((c) => ({ key: c.key, author: c.author, own2Signals: c.own2Signals, vendorShapes: c.vendorShapes, ratio: c.ratio })),
		primary: {
			override: primaryOverride,
			buckets: { ALL: primary.arm.all, MATCHED: primary.arm.matched, EXTRA: primary.arm.extra },
			perSeriesMeanR: primary.perSeriesMeanR,
			trainOos: primary.trainOos,
		},
		stop1x: {
			override: stop1xOverride,
			buckets: { ALL: stop1x.arm.all, MATCHED: stop1x.arm.matched, EXTRA: stop1x.arm.extra },
			perSeriesMeanR: stop1x.perSeriesMeanR,
			trainOos: stop1x.trainOos,
		},
	}
	writeFileSync(resolve('ci-results/re8-precision-split-meanfix.json'), JSON.stringify(jsonOut, null, 2))

	// ---- console ----
	console.log('\n=== RE8 precision-split full-fix-at-mean ===')
	console.log('Per-series OWN2 vs vendor shapes:')
	for (const c of counts) console.log(`  ${c.key}${c.author ? ' (author)' : ''}: OWN2=${c.own2Signals} shapes=${c.vendorShapes} ratio=${Number.isFinite(c.ratio) ? '×' + c.ratio.toFixed(2) : 'n/a'}`)
	const printBucket = (label: string, m: Metrics) => console.log(`  ${label}: N=${m.n} WR=${pct(m.wr)} totalR=${r2(m.totalR)} meanR=${r2(m.meanR)} PF=${pf2(m.pf)}`)
	console.log('PRIMARY arm (safe, fullFixAtMean, addEnabled:false):')
	printBucket('ALL    ', primary.arm.all)
	printBucket('MATCHED', primary.arm.matched)
	printBucket('EXTRA  ', primary.arm.extra)
	console.log(`  TRAIN MATCHED meanR=${r2(primary.trainOos.trainMatched.meanR)} (N=${primary.trainOos.trainMatched.n}) | TRAIN EXTRA meanR=${r2(primary.trainOos.trainExtra.meanR)} (N=${primary.trainOos.trainExtra.n})`)
	console.log(`  OOS   MATCHED meanR=${r2(primary.trainOos.oosMatched.meanR)} (N=${primary.trainOos.oosMatched.n}) | OOS   EXTRA meanR=${r2(primary.trainOos.oosExtra.meanR)} (N=${primary.trainOos.oosExtra.n})`)
	console.log('stop1x arm (safe, fullFixAtMean, addEnabled:false, stopSteps:1):')
	printBucket('ALL    ', stop1x.arm.all)
	printBucket('MATCHED', stop1x.arm.matched)
	printBucket('EXTRA  ', stop1x.arm.extra)
	console.log('Записано: ci-results/re8-precision-split-meanfix.{md,json}')
}

main()
