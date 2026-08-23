/**
 * RE12 — воспроизведение 2h (120-min) статистики вендора GGI Reversal для ETH и SOL.
 *
 * ЦЕЛЬ: скормить СОБСТВЕННЫЕ стрелки вендора (shapes из CSV) как входы в канонический
 * replay-движок (ArrowTradeReplay), воспроизвести его табличные цифры (Winrate, Partial,
 * Stop, Full fix) на 2h и измерить NET-edge после реалистичных taker-издержек.
 *
 * КАЛИБРОВКА СТОПА — по STOP-RATE (не по Avg-stop%): в этой версии индикатора НЕТ колонок
 * Avg-stop и Result-R, поэтому калибровать стоп по %-стопу нельзя. Вместо этого свипаем
 * stopSteps по сетке и выбираем тот, чей итоговый stop-rate (стопнутые / все завершённые)
 * ближе всего к stop-rate вендора (ETH 19.0%, SOL 11.4%). Калибровка на 0 bps (stop-rate
 * от издержек не зависит). Матч stopSteps и достигнутый stop-rate печатаются рядом с целью.
 *
 * ИЗДЕРЖКИ: market/taker вход. Меряем на 0 bps (gross-реф) и 5 bps/side (BingX VIP0 taker
 * 0.05% — новый стандарт стоимости проекта). base = { fullFixAtMean: true, addEnabled: false }
 * идентично RE11 во всех трёх режимах для сопоставимости; разницу задаёт только параметр mode.
 *
 * §2.1/§2.2: правила НЕ придумываются. Стоп подобран под stop-rate вендора — это эксперимент,
 * точное правило стопа автора неизвестно. Движок src/core НЕ тронут — только config-override.
 * Геометрия — каноничные Apex-полосы. Входы = стрелки vendor CSV shapes напрямую.
 *
 * Запуск: npx tsx ci/research/runRE12Vendor2hReproduce.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { arrowAtr200, ARROW_SIGNAL_VERSION } from '../../src/core/signals/ArrowSignalEngine.js'
import type { ArrowSignal, ArrowSide, ArrowMode } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayArrowSignals } from '../../src/core/signals/ArrowTradeReplay.js'
import type { ArrowTrade, ArrowModeConfig } from '../../src/core/signals/ArrowTradeReplay.js'

interface Series {
	key: string
	file: string
	vendorWR: number
	vendorStopRatePct: number
	vendorPartialPct: number
	vendorFullFixPct: number
	vendorTrades: number
}

// Референс вендора для 2h. Winrate = 100% - Stop%. Partial + FullFix == wins.
const SERIES: Series[] = [
	{ key: 'ETH 2h', file: 'csv/BINANCE_ETHUSDT, 120.csv', vendorWR: 81.0, vendorStopRatePct: 19.0, vendorPartialPct: 28.6, vendorFullFixPct: 52.4, vendorTrades: 84 },
	{ key: 'SOL 2h', file: 'csv/BINANCE_SOLUSDT, 120.csv', vendorWR: 88.6, vendorStopRatePct: 11.4, vendorPartialPct: 28.4, vendorFullFixPct: 60.2, vendorTrades: 88 },
]

const MODES: ArrowMode[] = ['safe', 'standard', 'risk']
const STOP_GRID = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0]
const COST_BPS = [0, 5]

const num = (x: string | undefined): number => { const n = Number((x ?? '').trim()); return Number.isFinite(n) ? n : NaN }

interface Loaded { candles: Candle[]; shapes: Array<{ i: number; side: 'buy' | 'sell' }> }

/** col0=ts(sec)→*1000; cols1-4 OHLC; col10=buy, col11=sell, col12=volume (13-колоночный vendor CSV). */
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

function signalsFromShapes(candles: readonly Candle[], bands: ReturnType<typeof computeApexBands>, atr: readonly number[], shapes: ReadonlyArray<{ i: number; side: 'buy' | 'sell' }>): ArrowSignal[] {
	const out: ArrowSignal[] = []
	for (const s of shapes) {
		const i = s.i, candle = candles[i], band = bands[i]
		if (candle == null || band == null) continue
		if (!Number.isFinite(band.mean) || !Number.isFinite(band.s)) continue
		const a = atr[i]
		if (a == null || !Number.isFinite(a) || a <= 0) continue
		const side: ArrowSide = s.side === 'buy' ? 'long' : 'short'
		const inner = side === 'long' ? band.greenHi : band.redLo
		const outer = side === 'long' ? band.greenLo : band.redHi
		if (!Number.isFinite(inner) || !Number.isFinite(outer)) continue
		out.push({ version: ARROW_SIGNAL_VERSION, signalIndex: i, signalAt: candle.timestamp, side, close: candle.close, mean: band.mean, inner, outer, atr200: a, trigger: { family: 'own2-extension', penetrationInner: NaN, distanceMeanPct: NaN, relativeVolume: NaN } })
	}
	out.sort((x, y) => x.signalIndex - y.signalIndex)
	return out
}

// Vendor-сопоставимые корзины исходов:
//   STOP    = стопнут (loss)                         -> outcome 'stop' | 'partial-stop'
//   PARTIAL = частичная фиксация, затем выход не по TP -> outcome 'partial-be'
//   FULLFIX = полная фиксация у mean/цели (full take) -> outcome 'full-tp'
// timeout считаем незавершённым для vendor-таксономии (у вендора его нет). Считаем только
// терминальные исходы, совпадающие с вендором (stop/partial/fullfix).
interface Buckets { stop: number; partial: number; fullfix: number; timeout: number }
function bucketsOf(trades: ArrowTrade[]): Buckets {
	let stop = 0, partial = 0, fullfix = 0, timeout = 0
	for (const t of trades) {
		if (t.outcome === 'stop' || t.outcome === 'partial-stop') stop++
		else if (t.outcome === 'partial-be') partial++
		else if (t.outcome === 'full-tp') fullfix++
		else if (t.outcome === 'timeout') timeout++
	}
	return { stop, partial, fullfix, timeout }
}

interface Metrics { n: number; wr: number; stopRate: number; partialPct: number; fullfixPct: number; totalR: number; meanR: number; pf: number | null; buckets: Buckets }
function metricsOf(trades: ArrowTrade[]): Metrics {
	const n = trades.length
	const b = bucketsOf(trades)
	if (n === 0) return { n: 0, wr: 0, stopRate: NaN, partialPct: NaN, fullfixPct: NaN, totalR: 0, meanR: 0, pf: null, buckets: b }
	const wins = trades.filter((t) => t.netR > 0).length
	const totalR = trades.reduce((s, t) => s + t.netR, 0)
	const gains = trades.filter((t) => t.netR > 0).reduce((s, t) => s + t.netR, 0)
	const losses = -trades.filter((t) => t.netR < 0).reduce((s, t) => s + t.netR, 0)
	const pf = losses > 0 ? gains / losses : (gains > 0 ? Number.POSITIVE_INFINITY : null)
	// vendor-таксономия терминальна: база = stop + partial + fullfix
	const terminal = b.stop + b.partial + b.fullfix
	const stopRate = terminal ? b.stop / terminal : NaN
	const partialPct = terminal ? b.partial / terminal : NaN
	const fullfixPct = terminal ? b.fullfix / terminal : NaN
	return { n, wr: wins / n, stopRate, partialPct, fullfixPct, totalR, meanR: totalR / n, pf, buckets: b }
}

const BASE: Partial<ArrowModeConfig> = { fullFixAtMean: true, addEnabled: false }

function run(loaded: Loaded, mode: ArrowMode, override: Partial<ArrowModeConfig>): ArrowTrade[] {
	const bands = computeApexBands([...loaded.candles], APEX_PARAMS)
	const atr = arrowAtr200(loaded.candles)
	const signals = signalsFromShapes(loaded.candles, bands, atr, loaded.shapes)
	const replay = replayArrowSignals(loaded.candles, bands, signals, mode, { ...BASE, ...override })
	return replay.trades.filter((t) => t.outcome !== 'open')
}

function pct(x: number): string { return Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a' }
function pf2(x: number | null): string { return x == null ? 'n/a' : (x === Number.POSITIVE_INFINITY ? '∞' : x.toFixed(2)) }
function r3(x: number): string { return Number.isFinite(x) ? x.toFixed(3) : 'n/a' }

interface ModeResult { mode: ArrowMode; matchedStopSteps: number; achievedStopRate: number; byCost: Array<{ bps: number; m: Metrics }> }
interface SeriesResult { s: Series; modes: ModeResult[] }

function calibrateStopByStopRate(loaded: Loaded, mode: ArrowMode, targetStopRate: number): { steps: number; stopRate: number } {
	let bestSteps = STOP_GRID[0]!, bestRate = NaN, bestDelta = Infinity
	for (const stopSteps of STOP_GRID) {
		const m = metricsOf(run(loaded, mode, { oneWayCostBps: 0, stopSteps }))
		if (!Number.isFinite(m.stopRate)) continue
		const d = Math.abs(m.stopRate - targetStopRate)
		if (d < bestDelta) { bestDelta = d; bestSteps = stopSteps; bestRate = m.stopRate }
	}
	return { steps: bestSteps, stopRate: bestRate }
}

function main() {
	const results: SeriesResult[] = []
	for (const s of SERIES) {
		let l: Loaded
		try { l = loadCsv(s.file) } catch (e) { console.log(`skip ${s.key}: ${(e as Error).message}`); continue }
		if (l.candles.length < 400) { console.log(`skip ${s.key}: rows=${l.candles.length}`); continue }
		const target = s.vendorStopRatePct / 100
		const modes: ModeResult[] = []
		for (const mode of MODES) {
			const cal = calibrateStopByStopRate(l, mode, target)
			const byCost = COST_BPS.map((bps) => ({ bps, m: metricsOf(run(l, mode, { oneWayCostBps: bps, stopSteps: cal.steps })) }))
			modes.push({ mode, matchedStopSteps: cal.steps, achievedStopRate: cal.stopRate, byCost })
			console.log(`prep ${s.key}/${mode}: stopSteps=${cal.steps} stop-rate ${pct(cal.stopRate)} vs vendor ${s.vendorStopRatePct}%`)
		}
		results.push({ s, modes })
	}
	if (!results.length) throw new Error('Нет загруженных 2h CSV.')

	const md: string[] = []
	md.push('# RE12 — воспроизведение 2h статистики вендора (ETH/SOL), NET-edge')
	md.push('')
	md.push('**Цель:** скормить собственные стрелки вендора (CSV shapes) в канонический replay-движок, воспроизвести его 2h-таблицу (Winrate, Partial, Stop, Full fix) и измерить NET-edge после taker-издержек.')
	md.push('')
	md.push('> §2.1/§2.2: стоп подобран под **stop-rate** вендора (не по Avg-stop — его в этой версии нет; не по правилу автора — оно неизвестно). Движок `src/core` НЕ тронут, только config-override. Входы = vendor CSV shapes; геометрия — каноничные Apex-полосы. base `{fullFixAtMean:true, addEnabled:false}`, идентична для всех режимов; различие задаёт только параметр `mode`.')
	md.push('')

	for (const r of results) {
		md.push(`## ${r.s.key}`)
		md.push('')
		md.push(`Вендор: N=${r.s.vendorTrades}, WR=${r.s.vendorWR}%, Stop=${r.s.vendorStopRatePct}%, Partial=${r.s.vendorPartialPct}%, FullFix=${r.s.vendorFullFixPct}%.`)
		md.push('')
		md.push('| mode | подобр. stopSteps | достигнутый stop-rate (vs вендор) | N | комиссия bps/side | WR | stop% | partial% | fullfix% | totalR | meanR | PF |')
		md.push('|---|---|---|---|---|---|---|---|---|---|---|---|')
		for (const mr of r.modes) {
			mr.byCost.forEach((c, idx) => {
				const modeCol = idx === 0 ? mr.mode : ''
				const stepsCol = idx === 0 ? String(mr.matchedStopSteps) : ''
				const rateCol = idx === 0 ? `${pct(mr.achievedStopRate)} (вендор ${r.s.vendorStopRatePct}%)` : ''
				const nCol = idx === 0 ? String(c.m.n) : ''
				md.push(`| ${modeCol} | ${stepsCol} | ${rateCol} | ${nCol} | ${c.bps} | ${pct(c.m.wr)} | ${pct(c.m.stopRate)} | ${pct(c.m.partialPct)} | ${pct(c.m.fullfixPct)} | ${r3(c.m.totalR)} | ${r3(c.m.meanR)} | ${pf2(c.m.pf)} |`)
			})
		}
		md.push('')
		md.push('**Vendor-vs-наши (на 0 bps, терминальная таксономия):**')
		md.push('')
		md.push('| mode | WR наши / вендор | Partial наши / вендор | Stop наши / вендор | FullFix наши / вендор |')
		md.push('|---|---|---|---|---|')
		for (const mr of r.modes) {
			const g = mr.byCost[0]!.m
			md.push(`| ${mr.mode} | ${pct(g.wr)} / ${r.s.vendorWR}% | ${pct(g.partialPct)} / ${r.s.vendorPartialPct}% | ${pct(g.stopRate)} / ${r.s.vendorStopRatePct}% | ${pct(g.fullfixPct)} / ${r.s.vendorFullFixPct}% |`)
		}
		md.push('')
	}

	// Вердикт
	md.push('## Вердикт (честный)')
	md.push('')
	for (const r of results) {
		// ближайший по outcome-профилю режим: минимальная сумма |Δstop|+|Δpartial|+|Δfullfix| на 0 bps
		let bestMode = r.modes[0]!, bestDist = Infinity
		for (const mr of r.modes) {
			const g = mr.byCost[0]!.m
			const dist = Math.abs((g.stopRate * 100) - r.s.vendorStopRatePct) + Math.abs((g.partialPct * 100) - r.s.vendorPartialPct) + Math.abs((g.fullfixPct * 100) - r.s.vendorFullFixPct)
			if (Number.isFinite(dist) && dist < bestDist) { bestDist = dist; bestMode = mr }
		}
		const g0 = bestMode.byCost[0]!.m
		const g5 = bestMode.byCost[bestMode.byCost.length - 1]!.m
		const wrGap = (g0.wr * 100) - r.s.vendorWR
		md.push(`- **${r.s.key}:** ближайший по outcome-профилю режим — \`${bestMode.mode}\` (Δ-сумма ${bestDist.toFixed(1)} п.п.). WR \`${bestMode.mode}\` = ${pct(g0.wr)} vs вендор ${r.s.vendorWR}% (${wrGap >= 0 ? '+' : ''}${wrGap.toFixed(1)} п.п.). Net-edge на 5 bps: totalR=${r3(g5.totalR)}, meanR=${r3(g5.meanR)} → ${g5.totalR > 0 ? 'ПОЛОЖИТЕЛЕН' : 'НЕ положителен'}.`)
	}
	md.push('')
	md.push('_Оговорки: стоп подобран под **stop-rate** вендора, а не под реальное правило автора (оно неизвестно); издержки — симметричный taker-прокси (5 bps/side ≈ BingX VIP0 taker 0.05%), спот, без funding; геометрия — каноничные Apex-полосы. Корзина PARTIAL = терминальный `partial-be` (частичная фиксация, затем выход не по TP); если движок в данном режиме не порождает такой исход, столбец = 0% и это видно в таблице. `timeout` исключён из vendor-таксономии (у вендора его нет)._')
	md.push('')
	writeFileSync(resolve('ci-results/re12-vendor-2h-reproduce.md'), md.join('\n'))

	const jsonOut = {
		generatedAt: new Date().toISOString(),
		note: 'Reproduce vendor 2h GGI Reversal stats (ETH/SOL). Entries = vendor CSV shapes into canonical ArrowTradeReplay. Stop calibrated by matching stop-rate. base {fullFixAtMean:true, addEnabled:false}; modes safe/standard/risk; costs 0 & 5 bps/side.',
		modes: MODES,
		costBps: COST_BPS,
		stopGrid: STOP_GRID,
		series: results.map((r) => ({
			key: r.s.key,
			vendor: { wr: r.s.vendorWR, stopRatePct: r.s.vendorStopRatePct, partialPct: r.s.vendorPartialPct, fullFixPct: r.s.vendorFullFixPct, trades: r.s.vendorTrades },
			modes: r.modes.map((mr) => ({
				mode: mr.mode,
				matchedStopSteps: mr.matchedStopSteps,
				achievedStopRate: mr.achievedStopRate,
				byCost: mr.byCost.map((c) => ({ bps: c.bps, ...c.m })),
			})),
		})),
	}
	writeFileSync(resolve('ci-results/re12-vendor-2h-reproduce.json'), JSON.stringify(jsonOut, null, 2))

	console.log('\n=== RE12 vendor 2h reproduce ===')
	for (const r of results) {
		console.log(`  ${r.s.key} (вендор WR=${r.s.vendorWR}% Stop=${r.s.vendorStopRatePct}% Partial=${r.s.vendorPartialPct}% FullFix=${r.s.vendorFullFixPct}% N=${r.s.vendorTrades}):`)
		for (const mr of r.modes) {
			console.log(`    ${mr.mode}: stopSteps=${mr.matchedStopSteps} stop-rate=${pct(mr.achievedStopRate)}`)
			for (const c of mr.byCost) console.log(`       ${c.bps} bps: WR=${pct(c.m.wr)} stop=${pct(c.m.stopRate)} partial=${pct(c.m.partialPct)} fullfix=${pct(c.m.fullfixPct)} totalR=${r3(c.m.totalR)} meanR=${r3(c.m.meanR)} PF=${pf2(c.m.pf)} (N=${c.m.n})`)
		}
	}
	console.log('Записано: ci-results/re12-vendor-2h-reproduce.{md,json}')
}

main()
