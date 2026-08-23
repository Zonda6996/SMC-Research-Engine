/**
 * RE12c — вендор-СЫРАЯ таксономия исходов (ETH/SOL 2h), partial+add, БЕЗ full-fix-at-mean, только safe.
 *
 * ПОЧЕМУ ЭТОТ РАННЕР. RE12b показал partial=0% и раздутый stop-rate (ETH 38.3% / SOL 32.8%),
 * который не калибруется к вендорским 19%/11.4%. Причина — НЕ в сигналах и НЕ в движке, а в
 * сопоставлении исходов с корзинами вендора:
 *   - движок берёт частичку (partialTaken=true, 25% у mean), но НИКОГДА не выдаёт исход `partial-be`
 *     (БУ-хвост убран из этой версии) — а RE12b считал Partial ТОЛЬКО как `partial-be` ⇒ всегда 0%;
 *   - `partial-stop` (взяли частичку → остаток по стопу) RE12b валил в Stop ⇒ stop-rate раздут.
 *
 * ЧТО ГОВОРИТ АВТОР (задал явно, §2.1 — правило НЕ выдумано мной): таблица вендора — это СЫРЫЕ
 * ярлыки, без экономики. Грубо три корзины: stop / take(fullfix) / partial. Если была частичка,
 * а потом стоп — вендор относит это к **Partial и считает ВЫИГРЫШЕМ** (не в Stop).
 *
 * Здесь считаем НЕСКОЛЬКО версий классификации на одних и тех же сделках:
 *   V-WIN   (основная, по автору): FullFix = full-tp; Partial = partialTaken && исход ≠ full-tp
 *                                  (partial-stop и «частичка→timeout»); Stop = полный stop без частички.
 *                                  WR = (Partial + FullFix) / (Stop + Partial + FullFix). Partial = WIN.
 *   V-STRICT (вилка снизу): «частичка→стоп» относим к Stop (старый смысл RE12b) — чтобы видеть разброс.
 *   Справочно: WR-money (netR>0) и сырые счётчики исходов движка.
 *
 * КАЛИБРОВКА СТОПА — под stop-rate вендора, но теперь по V-WIN-определению stop-rate
 * (полные стопы без частички / все терминальные). Это и должно посадить stop-rate к 19%/11.4%.
 *
 * Экономика (totalR/meanR/PF) считается по netR движка и от версии таксономии НЕ зависит —
 * ярлыки влияют только на профиль корзин и WR, не на деньги.
 *
 * §2.2: движок src/core НЕ тронут — только этот research-раннер и его классификатор.
 * Входы = стрелки vendor CSV shapes; геометрия — каноничные Apex-полосы; base {fullFixAtMean:false, addEnabled:true}; mode safe.
 *
 * Запуск: npx tsx "ci/research/runRE12cVendorRawTaxonomy.ts"
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { arrowAtr200, ARROW_SIGNAL_VERSION } from '../../src/core/signals/ArrowSignalEngine.js'
import type { ArrowSignal, ArrowSide, ArrowMode } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayAdmittedArrowSignals } from '../../src/core/signals/ArrowTradeReplay.js'
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

const MODES: ArrowMode[] = ['safe']
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

// Сырые счётчики исходов движка.
interface RawCounts { fullTp: number; partialStop: number; stop: number; timeout: number; partialTaken: number; total: number }
function rawCountsOf(trades: ArrowTrade[]): RawCounts {
	let fullTp = 0, partialStop = 0, stop = 0, timeout = 0, partialTaken = 0
	for (const t of trades) {
		if (t.outcome === 'full-tp') fullTp++
		else if (t.outcome === 'partial-stop') partialStop++
		else if (t.outcome === 'stop') stop++
		else if (t.outcome === 'timeout') timeout++
		if (t.partialTaken) partialTaken++
	}
	return { fullTp, partialStop, stop, timeout, partialTaken, total: trades.length }
}

// Одна версия таксономии → корзины stop/partial/fullfix (терминальные) + WR по ярлыкам.
interface Taxonomy { stop: number; partial: number; fullfix: number; excluded: number }
// V-WIN (по автору): FullFix=full-tp; Partial=partialTaken && исход≠full-tp; Stop=полный stop без частички.
function taxonomyWin(trades: ArrowTrade[]): Taxonomy {
	let stop = 0, partial = 0, fullfix = 0, excluded = 0
	for (const t of trades) {
		if (t.outcome === 'full-tp') fullfix++
		else if (t.partialTaken) partial++ // partial-stop или «частичка→timeout» — засчитывается как WIN
		else if (t.outcome === 'stop') stop++
		else excluded++ // timeout без частички — у вендора такого нет, исключаем из терминальных
	}
	return { stop, partial, fullfix, excluded }
}
// V-STRICT (вилка): «частичка→стоп» считаем как Stop (старый смысл RE12b).
function taxonomyStrict(trades: ArrowTrade[]): Taxonomy {
	let stop = 0, partial = 0, fullfix = 0, excluded = 0
	for (const t of trades) {
		if (t.outcome === 'full-tp') fullfix++
		else if (t.outcome === 'stop' || t.outcome === 'partial-stop') stop++
		else if (t.partialTaken) partial++ // только «частичка→timeout»
		else excluded++
	}
	return { stop, partial, fullfix, excluded }
}

interface TaxProfile { wr: number; stopRate: number; partialPct: number; fullfixPct: number; terminal: number }
function profileOf(tx: Taxonomy): TaxProfile {
	const terminal = tx.stop + tx.partial + tx.fullfix
	if (!terminal) return { wr: NaN, stopRate: NaN, partialPct: NaN, fullfixPct: NaN, terminal: 0 }
	return { wr: (tx.partial + tx.fullfix) / terminal, stopRate: tx.stop / terminal, partialPct: tx.partial / terminal, fullfixPct: tx.fullfix / terminal, terminal }
}

interface Econ { n: number; wrMoney: number; totalR: number; meanR: number; pf: number | null }
function econOf(trades: ArrowTrade[]): Econ {
	const n = trades.length
	if (!n) return { n: 0, wrMoney: NaN, totalR: 0, meanR: 0, pf: null }
	const wins = trades.filter((t) => t.netR > 0).length
	const totalR = trades.reduce((s, t) => s + t.netR, 0)
	const gains = trades.filter((t) => t.netR > 0).reduce((s, t) => s + t.netR, 0)
	const losses = -trades.filter((t) => t.netR < 0).reduce((s, t) => s + t.netR, 0)
	const pf = losses > 0 ? gains / losses : (gains > 0 ? Number.POSITIVE_INFINITY : null)
	return { n, wrMoney: wins / n, totalR, meanR: totalR / n, pf }
}

// base: full-fix-at-mean OFF, добор ON (как в RE12b) + postExitBars:0.
// postExitBars:0 — по уточнению автора: у вендора кулдаун = ТОЛЬКО occupancy («одна сделка за раз,
// следующая только после стопа/фулла»), БЕЗ лишней тишины после выхода и БЕЗ таймаутов. Дефолт 3
// бара (на 2h = 6 часов) искусственно выбивал ~24-30 стрелок вендора (N 60 вместо 84/88).
const BASE: Partial<ArrowModeConfig> = { fullFixAtMean: false, addEnabled: true, postExitBars: 0 }

function run(loaded: Loaded, mode: ArrowMode, override: Partial<ArrowModeConfig>): ArrowTrade[] {
	const bands = computeApexBands([...loaded.candles], APEX_PARAMS)
	const atr = arrowAtr200(loaded.candles)
	const signals = signalsFromShapes(loaded.candles, bands, atr, loaded.shapes)
	// replayAdmittedArrowSignals: КАЖДАЯ стрелка = своя сделка, без повторной occupancy-cooldown.
	// occupancy вендора уже зашита в набор CSV-shapes (они непересекающиеся: следующая только после
	// стопа/фулла предыдущей). Повторное наложение occupancy при реплее дропало ~24-30 стрелок из-за
	// того, что НАШ выход по времени позже вендорского. Для воспроизведения его таблицы (N=84/88)
	// считаем каждую стрелку независимо.
	const replay = replayAdmittedArrowSignals(loaded.candles, bands, signals, mode, { ...BASE, ...override })
	return replay.trades.filter((t) => t.outcome !== 'open')
}

function pct(x: number): string { return Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a' }
function pf2(x: number | null): string { return x == null ? 'n/a' : (x === Number.POSITIVE_INFINITY ? '∞' : x.toFixed(2)) }
function r3(x: number): string { return Number.isFinite(x) ? x.toFixed(3) : 'n/a' }

// Калибровка стопа под vendor stop-rate по V-WIN-определению (полные стопы без частички / терминальные).
function calibrateStopByWinStopRate(loaded: Loaded, mode: ArrowMode, targetStopRate: number): { steps: number; stopRate: number } {
	let bestSteps = STOP_GRID[0]!, bestRate = NaN, bestDelta = Infinity
	for (const stopSteps of STOP_GRID) {
		const p = profileOf(taxonomyWin(run(loaded, mode, { oneWayCostBps: 0, stopSteps })))
		if (!Number.isFinite(p.stopRate)) continue
		const d = Math.abs(p.stopRate - targetStopRate)
		if (d < bestDelta) { bestDelta = d; bestSteps = stopSteps; bestRate = p.stopRate }
	}
	return { steps: bestSteps, stopRate: bestRate }
}

interface CostRow { bps: number; econ: Econ }
interface ModeResult {
	mode: ArrowMode
	matchedStopSteps: number
	achievedStopRateWin: number
	raw: RawCounts
	win: TaxProfile
	strict: TaxProfile
	byCost: CostRow[]
}
interface SeriesResult { s: Series; modes: ModeResult[] }

function main() {
	const results: SeriesResult[] = []
	for (const s of SERIES) {
		let l: Loaded
		try { l = loadCsv(s.file) } catch (e) { console.log(`skip ${s.key}: ${(e as Error).message}`); continue }
		if (l.candles.length < 400) { console.log(`skip ${s.key}: rows=${l.candles.length}`); continue }
		const target = s.vendorStopRatePct / 100
		const modes: ModeResult[] = []
		for (const mode of MODES) {
			const cal = calibrateStopByWinStopRate(l, mode, target)
			const trades0 = run(l, mode, { oneWayCostBps: 0, stopSteps: cal.steps })
			const raw = rawCountsOf(trades0)
			const win = profileOf(taxonomyWin(trades0))
			const strict = profileOf(taxonomyStrict(trades0))
			const byCost = COST_BPS.map((bps) => ({ bps, econ: econOf(run(l, mode, { oneWayCostBps: bps, stopSteps: cal.steps })) }))
			modes.push({ mode, matchedStopSteps: cal.steps, achievedStopRateWin: cal.stopRate, raw, win, strict, byCost })
			console.log(`prep ${s.key}/${mode}: stopSteps=${cal.steps} V-WIN stop-rate ${pct(cal.stopRate)} vs vendor ${s.vendorStopRatePct}%`)
		}
		results.push({ s, modes })
	}
	if (!results.length) throw new Error('Нет загруженных 2h CSV.')

	const md: string[] = []
	md.push('# RE12c — вендор-сырая таксономия (ETH/SOL 2h), partial+add, без full-fix-at-mean, только safe')
	md.push('')
	md.push('**Причина RE12c:** RE12b давал partial=0% и stop-rate 38%/33% из-за неверного сопоставления исходов движка с корзинами вендора (Partial считался как мёртвый исход `partial-be`; `partial-stop` шёл в Stop). Здесь классификация — по СЫРЫМ ярлыкам, как в таблице автора (задано автором, §2.1): грубо stop / take(fullfix) / partial; **частичка→стоп у вендора = Partial и WIN**.')
	md.push('')
	md.push('> §2.2: движок `src/core` НЕ тронут — правится только классификатор в research-раннере. base `{fullFixAtMean:false, addEnabled:true}`, mode `safe`. Стоп калибруется под vendor stop-rate по V-WIN-определению (полные стопы без частички / терминальные). Экономика (totalR/meanR/PF) — по `netR` движка, от версии таксономии не зависит.')
	md.push('')
	md.push('**Версии классификации:** `V-WIN` (по автору: FullFix=full-tp; Partial=взята частичка и не дошли до полной цели, включая частичка→стоп, = WIN; Stop=полный стоп без частички). `V-STRICT` (вилка снизу: частичка→стоп относим к Stop).')
	md.push('')

	for (const r of results) {
		const mr = r.modes[0]!
		md.push(`## ${r.s.key}`)
		md.push('')
		md.push(`Вендор: N=${r.s.vendorTrades}, WR=${r.s.vendorWR}%, Stop=${r.s.vendorStopRatePct}%, Partial=${r.s.vendorPartialPct}%, FullFix=${r.s.vendorFullFixPct}%.`)
		md.push('')
		md.push(`Подобранный stopSteps=${mr.matchedStopSteps}. Сырые исходы движка (0 bps, N=${mr.raw.total}): full-tp=${mr.raw.fullTp}, partial-stop=${mr.raw.partialStop}, stop=${mr.raw.stop}, timeout=${mr.raw.timeout}; из них с частичкой (partialTaken)=${mr.raw.partialTaken}.`)
		md.push('')
		md.push('**Профиль по версиям таксономии (0 bps, терминальные корзины) vs вендор:**')
		md.push('')
		md.push('| версия | WR наши / вендор | Stop наши / вендор | Partial наши / вендор | FullFix наши / вендор |')
		md.push('|---|---|---|---|---|')
		md.push(`| V-WIN | ${pct(mr.win.wr)} / ${r.s.vendorWR}% | ${pct(mr.win.stopRate)} / ${r.s.vendorStopRatePct}% | ${pct(mr.win.partialPct)} / ${r.s.vendorPartialPct}% | ${pct(mr.win.fullfixPct)} / ${r.s.vendorFullFixPct}% |`)
		md.push(`| V-STRICT | ${pct(mr.strict.wr)} / ${r.s.vendorWR}% | ${pct(mr.strict.stopRate)} / ${r.s.vendorStopRatePct}% | ${pct(mr.strict.partialPct)} / ${r.s.vendorPartialPct}% | ${pct(mr.strict.fullfixPct)} / ${r.s.vendorFullFixPct}% |`)
		md.push('')
		md.push('**Экономика (net, по netR движка — от версии таксономии не зависит):**')
		md.push('')
		md.push('| комиссия bps/side | N | WR-money | totalR | meanR | PF |')
		md.push('|---|---|---|---|---|---|')
		for (const c of mr.byCost) md.push(`| ${c.bps} | ${c.econ.n} | ${pct(c.econ.wrMoney)} | ${r3(c.econ.totalR)} | ${r3(c.econ.meanR)} | ${pf2(c.econ.pf)} |`)
		md.push('')
	}

	md.push('## Вердикт')
	md.push('')
	for (const r of results) {
		const mr = r.modes[0]!
		const g5 = mr.byCost[mr.byCost.length - 1]!.econ
		const profileDistWin = Math.abs((mr.win.stopRate * 100) - r.s.vendorStopRatePct) + Math.abs((mr.win.partialPct * 100) - r.s.vendorPartialPct) + Math.abs((mr.win.fullfixPct * 100) - r.s.vendorFullFixPct)
		md.push(`- **${r.s.key}** (safe, stopSteps=${mr.matchedStopSteps}): V-WIN — WR ${pct(mr.win.wr)} vs вендор ${r.s.vendorWR}%, Partial ${pct(mr.win.partialPct)} vs ${r.s.vendorPartialPct}%, Stop ${pct(mr.win.stopRate)} vs ${r.s.vendorStopRatePct}%, FullFix ${pct(mr.win.fullfixPct)} vs ${r.s.vendorFullFixPct}%. Профиль-Δ (сумма |Δ|) = ${profileDistWin.toFixed(1)} п.п. Net на 5 bps: totalR=${r3(g5.totalR)}, meanR=${r3(g5.meanR)}, PF=${pf2(g5.pf)} → ${g5.totalR > 0 ? 'ПОЛОЖИТЕЛЕН' : 'НЕ положителен'}.`)
	}
	md.push('')
	md.push('_Оговорки: таксономия — сырые ярлыки по описанию автора (частичка→стоп = Partial/WIN), без экономики позиции; экономика totalR/meanR/PF отдельно по netR (с учётом добора: oneR по усреднённому входу). Стоп подобран под vendor stop-rate (V-WIN), реальное правило стопа автора неизвестно (§2.1). Издержки — симметричный taker-прокси 5 bps/side (BingX VIP0 0.05%), спот, без funding. Входы = vendor CSV shapes; геометрия — каноничные Apex-полосы. base {fullFixAtMean:false, addEnabled:true}, mode safe._')
	md.push('')
	writeFileSync(resolve('ci-results/re12c-vendor-raw-taxonomy.md'), md.join('\n'))

	const jsonOut = {
		generatedAt: new Date().toISOString(),
		note: 'RE12c: vendor-raw label taxonomy (partial-then-stop = Partial/WIN per author), partial+add, no full-fix-at-mean, safe only (ETH/SOL 2h). Entries = vendor CSV shapes into canonical ArrowTradeReplay. Stop calibrated by V-WIN stop-rate. base {fullFixAtMean:false, addEnabled:true}. Engine src/core untouched.',
		modes: MODES,
		costBps: COST_BPS,
		stopGrid: STOP_GRID,
		series: results.map((r) => ({
			key: r.s.key,
			vendor: { wr: r.s.vendorWR, stopRatePct: r.s.vendorStopRatePct, partialPct: r.s.vendorPartialPct, fullFixPct: r.s.vendorFullFixPct, trades: r.s.vendorTrades },
			modes: r.modes.map((mr) => ({
				mode: mr.mode,
				matchedStopSteps: mr.matchedStopSteps,
				achievedStopRateWin: mr.achievedStopRateWin,
				raw: mr.raw,
				taxonomyWin: mr.win,
				taxonomyStrict: mr.strict,
				byCost: mr.byCost.map((c) => ({ bps: c.bps, ...c.econ })),
			})),
		})),
	}
	writeFileSync(resolve('ci-results/re12c-vendor-raw-taxonomy.json'), JSON.stringify(jsonOut, null, 2))

	console.log('\n=== RE12c vendor-raw taxonomy (V-WIN primary) ===')
	for (const r of results) {
		const mr = r.modes[0]!
		console.log(`  ${r.s.key} (вендор WR=${r.s.vendorWR}% Stop=${r.s.vendorStopRatePct}% Partial=${r.s.vendorPartialPct}% FullFix=${r.s.vendorFullFixPct}% N=${r.s.vendorTrades}):`)
		console.log(`    raw: full-tp=${mr.raw.fullTp} partial-stop=${mr.raw.partialStop} stop=${mr.raw.stop} timeout=${mr.raw.timeout} partialTaken=${mr.raw.partialTaken} (N=${mr.raw.total})`)
		console.log(`    V-WIN:    WR=${pct(mr.win.wr)} stop=${pct(mr.win.stopRate)} partial=${pct(mr.win.partialPct)} fullfix=${pct(mr.win.fullfixPct)} (stopSteps=${mr.matchedStopSteps})`)
		console.log(`    V-STRICT: WR=${pct(mr.strict.wr)} stop=${pct(mr.strict.stopRate)} partial=${pct(mr.strict.partialPct)} fullfix=${pct(mr.strict.fullfixPct)}`)
		for (const c of mr.byCost) console.log(`       ${c.bps} bps: WR-money=${pct(c.econ.wrMoney)} totalR=${r3(c.econ.totalR)} meanR=${r3(c.econ.meanR)} PF=${pf2(c.econ.pf)} (N=${c.econ.n})`)
	}
	console.log('Записано: ci-results/re12c-vendor-raw-taxonomy.{md,json}')
}

main()
