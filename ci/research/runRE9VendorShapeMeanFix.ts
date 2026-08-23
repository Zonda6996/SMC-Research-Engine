/**
 * RE9 — full-fix-at-mean на РЕАЛЬНЫХ вендорских стрелках (входы = shapes из CSV), не через наш детектор.
 *
 * Мотив (RE8): даже на MATCHED-барах (где наш OWN2-детектор совпал с vendor-shape) стратегия full-fix-at-mean
 * теряла (~-0.13R). Но RE8 всё равно шёл через наш детектор — он мог пропускать/сдвигать настоящие стрелки.
 * RE9 изолирует вопрос: «хороша ли стратегия НА САМИХ вендорских стрелках?» — входы берём напрямую из CSV shapes
 * (col10 buy / col11 sell), строим валидные ArrowSignal из свечи/полос на баре стрелки и прогоняем через
 * канонический replayArrowSignals (движок сам применяет occupancy/cooldown — это часть стратегии).
 *
 * §2.2: правила анализа НЕ придумываются — используются подтверждённые сигнатуры движка. Движок src/core НЕ тронут.
 * Входы = vendor CSV shapes; сторона buy→long, sell→short. signalIndex=бар i, signalAt=candles[i].timestamp.
 * ArrowSignal-поля (close/mean/inner/outer/atr200/trigger) заполняются из свечи и канонических Apex-полос на баре i.
 *
 * Плечи управления (заявленная стратегия автора: полная фиксация у движущейся средней, без partial, без добора):
 *   • PRIMARY: safe + { fullFixAtMean:true, addEnabled:false } (канон стоп 2×).
 *   • stop1x : safe + { fullFixAtMean:true, addEnabled:false, stopSteps:1 } (короче стоп).
 * Издержки = дефолт движка (~7 bps/side).
 *
 * Запуск: npx tsx ci/research/runRE9VendorShapeMeanFix.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { arrowAtr200, ARROW_SIGNAL_VERSION } from '../../src/core/signals/ArrowSignalEngine.js'
import type { ArrowSignal, ArrowSide } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayArrowSignals } from '../../src/core/signals/ArrowTradeReplay.js'
import type { ArrowTrade, ArrowModeConfig } from '../../src/core/signals/ArrowTradeReplay.js'

interface Series { key: string; asset: string; tf: string; file: string; author?: boolean }

const SERIES: Series[] = [
	{ key: 'VIRTUAL 5m', asset: 'VIRTUAL', tf: '5m', file: 'csv/BINANCE_VIRTUALUSDT.P, 5.csv', author: true },
	{ key: 'BNB 5m', asset: 'BNB', tf: '5m', file: 'csv/BINANCE_BNBUSDT.P, 5.csv' },
	{ key: 'BTC 5m', asset: 'BTC', tf: '5m', file: 'csv/BINANCE_BTCUSDT.P, 5.csv' },
	{ key: 'BTC 15m', asset: 'BTC', tf: '15m', file: 'csv/BINANCE_BTCUSDT.P, 15.csv' },
	{ key: 'BTC 1h', asset: 'BTC', tf: '1h', file: 'csv/BINANCE_BTCUSDT.P, 60.csv' },
]

const num = (x: string | undefined): number => { const n = Number((x ?? '').trim()); return Number.isFinite(n) ? n : NaN }

interface Loaded {
	candles: Candle[]
	shapes: Array<{ i: number; side: 'buy' | 'sell' }>
}

/** Adapted from ci/research/runRE6LocalPivotFit.ts loadCsv. col0=ts(sec)→*1000; cols 10=buy,11=sell,12=volume. */
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

/**
 * Build valid ArrowSignal[] directly from vendor CSV shapes.
 * Каждый shape на баре i → сигнал с signalIndex=i, signalAt=candles[i].timestamp, side по стороне.
 * Обязательные поля ArrowSignal (close/mean/inner/outer/atr200/trigger) берём из свечи и канонических Apex-полос на баре i.
 * Сигнал пропускается, если геометрия/atr на баре некорректны (движок всё равно вернул бы null).
 * Возвращается по signalIndex ascending.
 */
function signalsFromShapes(
	candles: readonly Candle[],
	bands: ReturnType<typeof computeApexBands>,
	atr: readonly number[],
	shapes: ReadonlyArray<{ i: number; side: 'buy' | 'sell' }>,
): ArrowSignal[] {
	const out: ArrowSignal[] = []
	for (const s of shapes) {
		const i = s.i
		const candle = candles[i]
		const band = bands[i]
		if (candle == null || band == null) continue
		if (!Number.isFinite(band.mean) || !Number.isFinite(band.s)) continue
		const a = atr[i]
		if (a == null || !Number.isFinite(a) || a <= 0) continue
		const side: ArrowSide = s.side === 'buy' ? 'long' : 'short'
		const inner = side === 'long' ? band.greenHi : band.redLo
		const outer = side === 'long' ? band.greenLo : band.redHi
		if (!Number.isFinite(inner) || !Number.isFinite(outer)) continue
		out.push({
			version: ARROW_SIGNAL_VERSION,
			signalIndex: i,
			signalAt: candle.timestamp,
			side,
			close: candle.close,
			mean: band.mean,
			inner,
			outer,
			atr200: a,
			trigger: { family: 'own2-extension', penetrationInner: NaN, distanceMeanPct: NaN, relativeVolume: NaN },
		})
	}
	out.sort((x, y) => x.signalIndex - y.signalIndex)
	return out
}

interface SideMetrics { n: number; totalR: number; meanR: number }
interface Metrics {
	n: number
	wr: number // count(netR>0)/N
	vendorWr: number // (full-tp + partial-be)/N — vendor-style finalized WR
	totalR: number
	meanR: number
	pf: number | null
	long: SideMetrics
	short: SideMetrics
}

function sideMetrics(trades: ArrowTrade[]): SideMetrics {
	const n = trades.length
	const totalR = trades.reduce((s, t) => s + t.netR, 0)
	return { n, totalR, meanR: n ? totalR / n : 0 }
}

function metricsOf(trades: ArrowTrade[]): Metrics {
	const n = trades.length
	if (n === 0) {
		return { n: 0, wr: 0, vendorWr: 0, totalR: 0, meanR: 0, pf: null, long: { n: 0, totalR: 0, meanR: 0 }, short: { n: 0, totalR: 0, meanR: 0 } }
	}
	const wins = trades.filter((t) => t.netR > 0).length
	const vendorWins = trades.filter((t) => t.outcome === 'full-tp' || t.outcome === 'partial-be').length
	const totalR = trades.reduce((s, t) => s + t.netR, 0)
	const gains = trades.filter((t) => t.netR > 0).reduce((s, t) => s + t.netR, 0)
	const losses = -trades.filter((t) => t.netR < 0).reduce((s, t) => s + t.netR, 0)
	const pf = losses > 0 ? gains / losses : (gains > 0 ? Number.POSITIVE_INFINITY : null)
	return {
		n, wr: wins / n, vendorWr: vendorWins / n, totalR, meanR: totalR / n, pf,
		long: sideMetrics(trades.filter((t) => t.side === 'long')),
		short: sideMetrics(trades.filter((t) => t.side === 'short')),
	}
}

interface SeriesArmResult {
	key: string; asset: string; tf: string; author: boolean
	vendorShapes: number // stem entries fed (shapes with valid signal geometry)
	rawShapes: number // total vendor shapes in CSV (before geometry filter)
	finalizedTrades: number // after engine occupancy, outcome != open
	metrics: Metrics
}

function pct(x: number): string { return Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a' }
function pf2(x: number | null): string { return x == null ? 'n/a' : (x === Number.POSITIVE_INFINITY ? '∞' : x.toFixed(2)) }
function r3(x: number): string { return Number.isFinite(x) ? x.toFixed(3) : 'n/a' }

function runArm(loaded: Array<{ s: Series; l: Loaded }>, override: Partial<ArrowModeConfig>): {
	perSeries: SeriesArmResult[]
	aggregate: Metrics
	aggVendorShapes: number
	aggFinalized: number
} {
	const perSeries: SeriesArmResult[] = []
	const aggTrades: ArrowTrade[] = []
	let aggVendorShapes = 0
	for (const { s, l } of loaded) {
		const bands = computeApexBands([...l.candles], APEX_PARAMS)
		const atr = arrowAtr200(l.candles)
		const signals = signalsFromShapes(l.candles, bands, atr, l.shapes)
		const replay = replayArrowSignals(l.candles, bands, signals, 'safe', override)
		const finalized = replay.trades.filter((t) => t.outcome !== 'open')
		perSeries.push({
			key: s.key, asset: s.asset, tf: s.tf, author: !!s.author,
			vendorShapes: signals.length, rawShapes: l.shapes.length,
			finalizedTrades: finalized.length, metrics: metricsOf(finalized),
		})
		aggVendorShapes += signals.length
		for (const t of finalized) aggTrades.push(t)
	}
	const aggFinalized = aggTrades.length
	return { perSeries, aggregate: metricsOf(aggTrades), aggVendorShapes, aggFinalized }
}

function main() {
	const loaded: Array<{ s: Series; l: Loaded }> = []
	for (const s of SERIES) {
		let l: Loaded
		try { l = loadCsv(s.file) } catch (e) { console.log(`skip ${s.key}: ${(e as Error).message}`); continue }
		if (l.candles.length < 400) { console.log(`skip ${s.key}: rows=${l.candles.length}`); continue }
		loaded.push({ s, l })
		console.log(`prep ${s.key}: candles=${l.candles.length} vendorShapes=${l.shapes.length}`)
	}
	if (!loaded.length) throw new Error('Нет загруженных CSV из csv/.')

	const primaryOverride: Partial<ArrowModeConfig> = { fullFixAtMean: true, addEnabled: false }
	const stop1xOverride: Partial<ArrowModeConfig> = { fullFixAtMean: true, addEnabled: false, stopSteps: 1 }

	const primary = runArm(loaded, primaryOverride)
	const stop1x = runArm(loaded, stop1xOverride)

	// ---- MD ----
	const md: string[] = []
	md.push('# RE9 — full-fix-at-mean на РЕАЛЬНЫХ вендорских стрелках (входы = shapes из CSV)')
	md.push('')
	md.push('**Цель:** проверить стратегию автора «полная фиксация у движущейся средней» на САМИХ вендорских стрелках из CSV (col buy/sell), а не через наш OWN2-детектор. Это изолирует вопрос «хороша ли стратегия на настоящих стрелках вендора?» от «может ли наш детектор их найти?». Сравнение — с RE8, где сделки нашего детектора теряли (~-0.13R даже на совпавших барах).')
	md.push('')
	md.push('> §2.2: правила анализа не придумываются — используются подтверждённые сигнатуры движка. Движок `src/core` НЕ тронут (измерительный харнесс). Входы: vendor CSV shapes, buy→long / sell→short, signalIndex=бар, поля ArrowSignal из свечи и канонических Apex-полос на баре. Движок сам применяет occupancy/cooldown (часть стратегии). Издержки = дефолт движка (~7 bps/side). arm=safe + `{fullFixAtMean:true, addEnabled:false}`.')
	md.push('')

	md.push('## 1. Per-series (PRIMARY arm: canon safe, fullFixAtMean, addEnabled:false, стоп 2×)')
	md.push('')
	md.push('| серия (актив+ТФ) | вендор-стрелок | сделок (после occupancy) | N | WR | vendorWR | totalR | meanR | PF |')
	md.push('|---|---|---|---|---|---|---|---|---|')
	for (const r of primary.perSeries) {
		const m = r.metrics
		md.push(`| ${r.key}${r.author ? ' (автор)' : ''} | ${r.vendorShapes} | ${r.finalizedTrades} | ${m.n} | ${pct(m.wr)} | ${pct(m.vendorWr)} | ${r3(m.totalR)} | ${r3(m.meanR)} | ${pf2(m.pf)} |`)
	}
	md.push('')

	md.push('## 2. Long/short split per series (PRIMARY arm)')
	md.push('')
	md.push('| серия | long N | long totalR | long meanR | short N | short totalR | short meanR |')
	md.push('|---|---|---|---|---|---|---|')
	for (const r of primary.perSeries) {
		const m = r.metrics
		md.push(`| ${r.key} | ${m.long.n} | ${r3(m.long.totalR)} | ${r3(m.long.meanR)} | ${m.short.n} | ${r3(m.short.totalR)} | ${r3(m.short.meanR)} |`)
	}
	md.push('')

	const aggTable = (label: string, agg: Metrics, vendorShapes: number, finalized: number): string[] => {
		const out: string[] = []
		out.push(`## ${label}`)
		out.push('')
		out.push('| вендор-стрелок | сделок | N | WR | vendorWR | totalR | meanR | PF | long meanR (N) | short meanR (N) |')
		out.push('|---|---|---|---|---|---|---|---|---|---|')
		out.push(`| ${vendorShapes} | ${finalized} | ${agg.n} | ${pct(agg.wr)} | ${pct(agg.vendorWr)} | ${r3(agg.totalR)} | ${r3(agg.meanR)} | ${pf2(agg.pf)} | ${r3(agg.long.meanR)} (${agg.long.n}) | ${r3(agg.short.meanR)} (${agg.short.n}) |`)
		out.push('')
		return out
	}
	md.push(...aggTable('3. Aggregated — PRIMARY arm (стоп 2×)', primary.aggregate, primary.aggVendorShapes, primary.aggFinalized))
	md.push(...aggTable('4. Aggregated — stop1x arm (stopSteps:1)', stop1x.aggregate, stop1x.aggVendorShapes, stop1x.aggFinalized))

	// ---- Вывод (черновой) ----
	md.push('## 5. Вывод (черновой)')
	md.push('')
	const posSeries = primary.perSeries.filter((r) => r.metrics.n > 0 && r.metrics.meanR > 0).map((r) => r.key)
	const negSeries = primary.perSeries.filter((r) => r.metrics.n > 0 && r.metrics.meanR <= 0).map((r) => r.key)
	const aggPrimaryPos = primary.aggregate.meanR > 0
	md.push(`- **По сериям (PRIMARY, стоп 2×):** ${posSeries.length ? '+R (meanR>0) на: ' + posSeries.join(', ') + '.' : 'ни на одной серии meanR>0.'} ${negSeries.length ? 'Не даёт +R (meanR≤0) на: ' + negSeries.join(', ') + '.' : ''}`)
	md.push(`- **Агрегат (PRIMARY):** meanR=${r3(primary.aggregate.meanR)}, totalR=${r3(primary.aggregate.totalR)} по ${primary.aggregate.n} сделкам — стратегия на настоящих вендорских стрелках ${aggPrimaryPos ? 'В СРЕДНЕМ ПОЛОЖИТЕЛЬНА' : 'в среднем НЕ положительна'}.`)
	md.push(`- **Агрегат (stop1x):** meanR=${r3(stop1x.aggregate.meanR)}, totalR=${r3(stop1x.aggregate.totalR)} по ${stop1x.aggregate.n} сделкам.`)
	md.push(`- **Сравнение с RE8:** в RE8 сделки нашего OWN2-детектора теряли (~-0.13R даже на MATCHED-барах). Здесь входы — сами vendor-стрелки, поэтому результат отражает качество стратегии, а не детектора. ${aggPrimaryPos ? 'Положительный агрегат означает: проблема RE8 была скорее в детекторе/переизлучении, чем в самой стратегии.' : 'Если агрегат тоже ≤0 — сама стратегия слаба даже на настоящих стрелках вендора, проблема не сводится к детектору.'}`)
	md.push(`- **Контекст (референс автора):** LDO m15 +15.25R / WR 62.9% / 89 сделок — но у LDO НЕТ CSV-shapes, поэтому это только контекст, не сопоставимая серия.`)
	md.push('')
	md.push('_Оговорки: фид здесь — Binance **futures** CSV (.P), тогда как референс автора по LDO был на **spot**; каноничный стоп 2× может отличаться от стопа автора; издержки 7 bps/side как в движке. Без overclaiming: vendor-shapes есть только на этих 5 сериях (VIRTUAL/BNB 5m + BTC 5m/15m/1h)._')
	md.push('')

	writeFileSync(resolve('ci-results/re9-vendor-shape-meanfix.md'), md.join('\n'))

	const seriesJson = (arm: ReturnType<typeof runArm>) => arm.perSeries.map((r) => ({
		key: r.key, asset: r.asset, tf: r.tf, author: r.author,
		vendorShapes: r.vendorShapes, rawShapes: r.rawShapes, finalizedTrades: r.finalizedTrades,
		metrics: r.metrics,
	}))
	const jsonOut = {
		generatedAt: new Date().toISOString(),
		note: 'Entries = vendor CSV shapes directly (NOT via OWN2 detector). buy→long, sell→short. Signals built from candle+canon Apex bands at shape bar; engine applies occupancy/cooldown. Costs = engine default ~7bps/side.',
		authorRef: 'LDO m15 +15.25R / WR 62.9% / 89 trades (spot; no CSV shapes for LDO — context only)',
		caveats: 'Feed = Binance futures CSV (.P); author LDO reference was spot; canon stop 2× may differ from author stop.',
		primary: {
			override: primaryOverride,
			aggregate: primary.aggregate, aggVendorShapes: primary.aggVendorShapes, aggFinalized: primary.aggFinalized,
			perSeries: seriesJson(primary),
		},
		stop1x: {
			override: stop1xOverride,
			aggregate: stop1x.aggregate, aggVendorShapes: stop1x.aggVendorShapes, aggFinalized: stop1x.aggFinalized,
			perSeries: seriesJson(stop1x),
		},
	}
	writeFileSync(resolve('ci-results/re9-vendor-shape-meanfix.json'), JSON.stringify(jsonOut, null, 2))

	// ---- console ----
	console.log('\n=== RE9 vendor-shape full-fix-at-mean ===')
	const printSeries = (r: SeriesArmResult) => {
		const m = r.metrics
		console.log(`  ${r.key}${r.author ? ' (author)' : ''}: shapes=${r.vendorShapes} finalized=${r.finalizedTrades} N=${m.n} WR=${pct(m.wr)} totalR=${r3(m.totalR)} meanR=${r3(m.meanR)} PF=${pf2(m.pf)} | long meanR=${r3(m.long.meanR)} (N=${m.long.n}) short meanR=${r3(m.short.meanR)} (N=${m.short.n})`)
	}
	console.log('PRIMARY arm (safe, fullFixAtMean, addEnabled:false, stop 2×):')
	for (const r of primary.perSeries) printSeries(r)
	console.log(`  AGG PRIMARY: shapes=${primary.aggVendorShapes} finalized=${primary.aggFinalized} N=${primary.aggregate.n} meanR=${r3(primary.aggregate.meanR)} totalR=${r3(primary.aggregate.totalR)} PF=${pf2(primary.aggregate.pf)}`)
	console.log('stop1x arm (safe, fullFixAtMean, addEnabled:false, stopSteps:1):')
	for (const r of stop1x.perSeries) printSeries(r)
	console.log(`  AGG stop1x: shapes=${stop1x.aggVendorShapes} finalized=${stop1x.aggFinalized} N=${stop1x.aggregate.n} meanR=${r3(stop1x.aggregate.meanR)} totalR=${r3(stop1x.aggregate.totalR)} PF=${pf2(stop1x.aggregate.pf)}`)
	console.log('Записано: ci-results/re9-vendor-shape-meanfix.{md,json}')
}

main()
