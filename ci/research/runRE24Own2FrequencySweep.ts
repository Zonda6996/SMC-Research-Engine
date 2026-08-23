/**
 * RE24 — свип порогов OWN2 на ОБЪЁМ сигналов: можно ли догнать частоту/WR/net вендора,
 * не гоняясь за точным баром (RE19–23 закрыли exact-bar как неидентифицируемый).
 *
 * Цель кампании (задал автор): OWN2 должен ВЫДАВАТЬ сигналы так же, как вендор —
 * ~2–3 сигнала/мес, WR ~78–84%, gross +12–15R по его фаворитам. Канон OWN2
 * {relVol 1.4, distMean 3, pen −0.35} даёт ~1.1/мес и recall ~20–31% — недобор объёма.
 * Свипаем три порога детектора и меряем: частоту (сигн./мес), recall/precision/F1 против
 * вендор-стрелок (greedy same-side ±1 бар), WR (money = netR>0 и vendor-style), net@0/5 bps.
 *
 * §2.1/§2.2/§2.3: правила НЕ придумываем — свипаем только СОБСТВЕННЫЕ пороги OWN2-детектора
 * (это наш детектор, не вендорское правило). src/core НЕ тронут — чистый раннер поверх движка.
 * Геометрия — каноничные Apex-полосы (RE3 ~0.05% к линиям вендора). Входы OWN2 = сам детектор.
 * Реплей/издержки — как RE11 (base {fullFixAtMean:true, addEnabled:false}, mode 'safe').
 *
 * Запуск: npx tsx "ci/research/runRE24Own2FrequencySweep.ts"
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { detectArrowSignalCandidates } from '../../src/core/signals/ArrowSignalEngine.js'
import type { ArrowSignal } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayArrowSignals } from '../../src/core/signals/ArrowTradeReplay.js'
import type { ArrowTrade, ArrowModeConfig } from '../../src/core/signals/ArrowTradeReplay.js'

// ── серии (вендор-CSV с shapes) + референс автора (gross) ──────────────────────────────────────────
interface Series { key: string; file: string; authorWR: number | null; authorRefR: number | null }
const SERIES: Series[] = [
	{ key: 'VIRTUAL 5m', file: 'csv/BINANCE_VIRTUALUSDT, 5.csv', authorWR: 78.7, authorRefR: 15.24 },
	{ key: 'ONDO 5m', file: 'csv/BINANCE_ONDOUSDT, 5.csv', authorWR: 83.7, authorRefR: 12.12 },
	{ key: 'LDO 15m', file: 'csv/BINANCE_LDOUSDT, 15.csv', authorWR: 62.9, authorRefR: 15.25 },
	{ key: 'AVAX 5m', file: 'csv/BINANCE_AVAXUSDT, 5.csv', authorWR: 91.0, authorRefR: 12.62 },
]

// ── сетка порогов OWN2 ──────────────────────────────────────────────────────────────────────────
const REL_VOL = [0.0, 0.8, 1.0, 1.2, 1.4]
const DIST_MEAN = [0, 1, 2, 3]
const PEN = [-0.6, -0.35, -0.1]
const CANON = { minimumRelativeVolume: 1.4, minimumDistanceMeanPct: 3, minimumPenetrationInner: -0.35 }
const COST_BPS = [0, 5]
const MONTH_MS = 30 * 24 * 3600 * 1000
const BASE: Partial<ArrowModeConfig> = { fullFixAtMean: true, addEnabled: false }

const num = (x: string | undefined): number => { const n = Number((x ?? '').trim()); return Number.isFinite(n) ? n : NaN }
const pct = (x: number): string => Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a'
const r2 = (x: number): string => Number.isFinite(x) ? x.toFixed(2) : 'n/a'
const r3 = (x: number): string => Number.isFinite(x) ? x.toFixed(3) : 'n/a'

// ── загрузка CSV (как RE11) ───────────────────────────────────────────────────────────────────────
interface Loaded { candles: Candle[]; shapes: Array<{ i: number; side: 'buy' | 'sell' }> }
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

// ── матчер OWN2-кандидаты vs вендор-shapes (greedy same-side ±tol) ──────────────────────────────────
interface MatchStat { recall: number; precision: number; f1: number; matched: number; nShapes: number; nSignals: number }
function matchStats(sigIdx: Array<{ i: number; side: 'long' | 'short' }>, shapes: Array<{ i: number; side: 'buy' | 'sell' }>, tol = 1): MatchStat {
	const truth = shapes.map((s) => ({ i: s.i, side: s.side === 'buy' ? 'long' : 'short' as 'long' | 'short' }))
	const used = new Array(sigIdx.length).fill(false)
	let matched = 0
	for (const t of truth) {
		let best = -1, bd = Infinity
		for (let k = 0; k < sigIdx.length; k++) {
			if (used[k]) continue
			const p = sigIdx[k]!
			if (p.side !== t.side) continue
			const d = Math.abs(p.i - t.i)
			if (d <= tol && d < bd) { bd = d; best = k }
		}
		if (best >= 0) { used[best] = true; matched++ }
	}
	const recall = truth.length ? matched / truth.length : NaN
	const precision = sigIdx.length ? matched / sigIdx.length : NaN
	const f1 = (recall > 0 && precision > 0) ? 2 * recall * precision / (recall + precision) : 0
	return { recall, precision, f1, matched, nShapes: truth.length, nSignals: sigIdx.length }
}

// ── метрики по подмножеству сделок ──────────────────────────────────────────────────────────────
interface TradeMetrics { n: number; totalR: number; moneyWR: number; vendorWR: number }
function tradeMetrics(trades: ArrowTrade[]): TradeMetrics {
	const n = trades.length
	if (n === 0) return { n: 0, totalR: 0, moneyWR: NaN, vendorWR: NaN }
	const totalR = trades.reduce((s, t) => s + t.netR, 0)
	const moneyWins = trades.filter((t) => t.netR > 0).length
	// vendor-style (RE12c, автор): full-tp/partial(любой) = WIN, stop = LOSS, timeout/open — вне знаменателя
	const vWin = trades.filter((t) => t.outcome === 'full-tp' || t.outcome === 'partial-be' || t.outcome === 'partial-stop').length
	const vLoss = trades.filter((t) => t.outcome === 'stop').length
	return { n, totalR, moneyWR: moneyWins / n, vendorWR: (vWin + vLoss) > 0 ? vWin / (vWin + vLoss) : NaN }
}

// ── прогон одного конфига по одной серии ──────────────────────────────────────────────────────────
interface Cfg { relVol: number; distMean: number; pen: number }
function cfgLabel(c: Cfg): string { return `rv${c.relVol}/dm${c.distMean}/pen${c.pen}` }

interface CfgResult {
	cfg: Cfg
	freqPerMonth: number
	nSignals: number
	// full + train + oos: recall/prec/f1 + net@0/net@5 + WR
	full: SplitMetrics; train: SplitMetrics; oos: SplitMetrics
}
interface SplitMetrics { match: MatchStat; net0: number; net5: number; moneyWR: number; vendorWR: number; nTrades: number }

function evalConfig(loaded: Loaded, bands: ReturnType<typeof computeApexBands>, cfg: Cfg, splitIdx: number, spanMs: number): CfgResult {
	const detCfg = { warmupBars: 200, relativeVolumePeriod: 20, minimumRelativeVolume: cfg.relVol, minimumDistanceMeanPct: cfg.distMean, minimumPenetrationInner: cfg.pen }
	const cands = detectArrowSignalCandidates(loaded.candles, APEX_PARAMS, detCfg).candidates as ArrowSignal[]
	const sigIdx = cands.map((c) => ({ i: c.signalIndex, side: c.side }))
	const months = spanMs / MONTH_MS
	const freqPerMonth = months > 0 ? cands.length / months : NaN

	// реплей на полном наборе, издержки 0 и 5 — сделки потом режем по signalIndex
	const trades0 = replayArrowSignals(loaded.candles, bands, cands, 'safe', { ...BASE, oneWayCostBps: 0 }).trades.filter((t) => t.outcome !== 'open')
	const trades5 = replayArrowSignals(loaded.candles, bands, cands, 'safe', { ...BASE, oneWayCostBps: 5 }).trades.filter((t) => t.outcome !== 'open')

	const mk = (lo: number, hi: number): SplitMetrics => {
		const sIdx = sigIdx.filter((s) => s.i >= lo && s.i < hi)
		const shp = loaded.shapes.filter((s) => s.i >= lo && s.i < hi)
		const t0 = trades0.filter((t) => t.signalIndex >= lo && t.signalIndex < hi)
		const t5 = trades5.filter((t) => t.signalIndex >= lo && t.signalIndex < hi)
		const m0 = tradeMetrics(t0)
		return { match: matchStats(sIdx, shp), net0: m0.totalR, net5: tradeMetrics(t5).totalR, moneyWR: m0.moneyWR, vendorWR: m0.vendorWR, nTrades: m0.n }
	}
	const N = loaded.candles.length
	return { cfg, freqPerMonth, nSignals: cands.length, full: mk(0, N), train: mk(0, splitIdx), oos: mk(splitIdx, N) }
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────────
function allCfgs(): Cfg[] {
	const out: Cfg[] = []
	for (const relVol of REL_VOL) for (const distMean of DIST_MEAN) for (const pen of PEN) out.push({ relVol, distMean, pen })
	return out
}

interface SeriesOut { key: string; file: string; authorWR: number | null; authorRefR: number | null; nShapesTotal: number; freqShapesPerMonth: number; gate: CfgResult; best: CfgResult; selectedBy: string }

function main(): void {
	const cfgs = allCfgs()
	const seriesOut: SeriesOut[] = []
	for (const s of SERIES) {
		if (!existsSync(resolve(s.file))) { console.log(`skip ${s.key}: нет файла ${s.file}`); continue }
		const loaded = loadCsv(s.file)
		if (loaded.candles.length < 400) { console.log(`skip ${s.key}: баров ${loaded.candles.length}`); continue }
		const bands = computeApexBands([...loaded.candles], APEX_PARAMS)
		const first = loaded.candles[0]!.timestamp, last = loaded.candles[loaded.candles.length - 1]!.timestamp
		const spanMs = last - first
		const splitIdx = Math.floor(loaded.candles.length * 0.65)
		const months = spanMs / MONTH_MS
		const freqShapesPerMonth = months > 0 ? loaded.shapes.length / months : NaN

		console.log(`\n=== ${s.key} (${loaded.candles.length} баров, ${(spanMs / 86400000).toFixed(1)}д, shapes=${loaded.shapes.length}, вендор ${freqShapesPerMonth.toFixed(1)}/мес) ===`)

		const results = cfgs.map((c) => evalConfig(loaded, bands, c, splitIdx, spanMs))
		const gate = evalConfig(loaded, bands, { relVol: CANON.minimumRelativeVolume, distMean: CANON.minimumDistanceMeanPct, pen: CANON.minimumPenetrationInner }, splitIdx, spanMs)

		// отбор на TRAIN: net@5 train ≥ 0 → максимизируем recall train; иначе максимум F1 train
		const eligible = results.filter((r) => Number.isFinite(r.train.net5) && r.train.net5 >= 0 && r.train.match.nSignals > 0)
		let best: CfgResult; let selectedBy: string
		if (eligible.length) {
			best = eligible.reduce((a, b) => (b.train.match.recall > a.train.match.recall ? b : a))
			selectedBy = 'max recall | net@5(train)≥0'
		} else {
			best = results.reduce((a, b) => (b.train.match.f1 > a.train.match.f1 ? b : a))
			selectedBy = 'max F1(train) [нет конфига с net@5≥0]'
		}

		console.log(`  GATE ${cfgLabel(gate.cfg)}: freq ${r2(gate.freqPerMonth)}/мес | recall ${pct(gate.full.match.recall)} F1 ${r2(gate.full.match.f1)} | WR money ${pct(gate.full.moneyWR)} vendor ${pct(gate.full.vendorWR)} | net@0 ${r2(gate.full.net0)}R net@5 ${r2(gate.full.net5)}R`)
		console.log(`  BEST ${cfgLabel(best.cfg)} [${selectedBy}]:`)
		console.log(`     freq ${r2(best.freqPerMonth)}/мес | FULL recall ${pct(best.full.match.recall)} prec ${pct(best.full.match.precision)} F1 ${r2(best.full.match.f1)} | WR money ${pct(best.full.moneyWR)} vendor ${pct(best.full.vendorWR)} | net@0 ${r2(best.full.net0)}R net@5 ${r2(best.full.net5)}R`)
		console.log(`     TRAIN recall ${pct(best.train.match.recall)} F1 ${r2(best.train.match.f1)} net@5 ${r2(best.train.net5)}R | OOS recall ${pct(best.oos.match.recall)} F1 ${r2(best.oos.match.f1)} WR money ${pct(best.oos.moneyWR)} vendor ${pct(best.oos.vendorWR)} net@0 ${r2(best.oos.net0)}R net@5 ${r2(best.oos.net5)}R`)

		seriesOut.push({ key: s.key, file: s.file, authorWR: s.authorWR, authorRefR: s.authorRefR, nShapesTotal: loaded.shapes.length, freqShapesPerMonth, gate, best, selectedBy })
	}

	if (!seriesOut.length) throw new Error('RE24: ни одной серии не загрузилось.')

	// ── .md ────────────────────────────────────────────────────────────────────────────────────────
	const md: string[] = []
	md.push('# RE24 — свип порогов OWN2 на объём сигналов: догоняем ли вендора по частоте/WR/net')
	md.push('')
	md.push('> **Цель (автор):** OWN2 должен ВЫДАВАТЬ сигналы как вендор — не угадать бар (RE19–23 закрыли exact-bar), а выйти на его частоту ~2–3/мес, WR ~78–84%, gross +12–15R. Свипаем ТРИ собственных порога OWN2-детектора: `minimumRelativeVolume`, `minimumDistanceMeanPct`, `minimumPenetrationInner` (§2.1: это наши пороги, не вендорское правило). src/core не тронут; геометрия — каноничные Apex-полосы; реплей — base `{fullFixAtMean:true, addEnabled:false}`, mode `safe`, издержки 0 и 5 bps/side.')
	md.push('')
	md.push('Сетка: relVol {0,0.8,1,1.2,1.4} × distMean {0,1,2,3} × pen {−0.6,−0.35,−0.1} = 60 конфигов. GATE = канон OWN2 {1.4,3,−0.35}. Отбор best на TRAIN (хронo 65/35): net@5(train)≥0 → max recall; иначе max F1(train). WR: money = доля netR>0; vendor = (full+partial)/(full+partial+stop) как RE12c.')
	md.push('')
	md.push('| серия | вендор freq/мес | вендор WR / R | конфиг | freq/мес | recall(full) | F1 | WR money / vendor | net@0 / net@5 (R) |')
	md.push('|---|---|---|---|---|---|---|---|---|')
	for (const so of seriesOut) {
		const av = `${so.authorWR != null ? so.authorWR + '%' : 'n/a'} / ${so.authorRefR != null ? '+' + so.authorRefR + 'R' : 'n/a'}`
		md.push(`| ${so.key} | ${r2(so.freqShapesPerMonth)} | ${av} | GATE ${cfgLabel(so.gate.cfg)} | ${r2(so.gate.freqPerMonth)} | ${pct(so.gate.full.match.recall)} | ${r2(so.gate.full.match.f1)} | ${pct(so.gate.full.moneyWR)} / ${pct(so.gate.full.vendorWR)} | ${r2(so.gate.full.net0)} / ${r2(so.gate.full.net5)} |`)
		md.push(`| ${so.key} | ${r2(so.freqShapesPerMonth)} | ${av} | **BEST ${cfgLabel(so.best.cfg)}** | ${r2(so.best.freqPerMonth)} | ${pct(so.best.full.match.recall)} | ${r2(so.best.full.match.f1)} | ${pct(so.best.full.moneyWR)} / ${pct(so.best.full.vendorWR)} | ${r2(so.best.full.net0)} / ${r2(so.best.full.net5)} |`)
	}
	md.push('')
	md.push('### train vs OOS у BEST-конфига (переобучение?)')
	md.push('')
	md.push('| серия | конфиг | recall train→OOS | F1 train→OOS | net@5 train→OOS (R) | WR money OOS | WR vendor OOS | отбор |')
	md.push('|---|---|---|---|---|---|---|---|')
	for (const so of seriesOut) {
		md.push(`| ${so.key} | ${cfgLabel(so.best.cfg)} | ${pct(so.best.train.match.recall)}→${pct(so.best.oos.match.recall)} | ${r2(so.best.train.match.f1)}→${r2(so.best.oos.match.f1)} | ${r2(so.best.train.net5)}→${r2(so.best.oos.net5)} | ${pct(so.best.oos.moneyWR)} | ${pct(so.best.oos.vendorWR)} | ${so.selectedBy} |`)
	}
	md.push('')
	md.push('## Как читать')
	md.push('- **BEST freq/мес ≈ вендор (2–3) при recall↑ и WR/net не хуже GATE** ⇒ ослабление порогов дало вендорский объём без потери качества — прогресс.')
	md.push('- **freq↑ но net@5→минус или WR↓** ⇒ объём куплен мусорными сигналами (снижаем не тот порог).')
	md.push('- **OOS ≪ train** ⇒ конфиг переобучен на train, не переносится.')
	md.push('- **vendor-WR** сравним с таблицей автора (78–84%); **money-WR** (netR>0) честнее для денег.')

	if (!existsSync(resolve('ci-results'))) mkdirSync(resolve('ci-results'), { recursive: true })
	writeFileSync(resolve('ci-results/re24-own2-frequency-sweep.md'), md.join('\n'))

	const jsonOut = {
		generatedAt: new Date().toISOString(),
		note: 'OWN2 threshold sweep for signal frequency vs vendor. src/core untouched; canonical Apex bands; replay base {fullFixAtMean:true, addEnabled:false} mode safe; costs 0/5 bps. Selection on train: net@5>=0 -> max recall else max F1.',
		grid: { relVol: REL_VOL, distMean: DIST_MEAN, pen: PEN, canon: CANON, costBps: COST_BPS, trainOosSplit: 0.65 },
		series: seriesOut,
	}
	writeFileSync(resolve('ci-results/re24-own2-frequency-sweep.json'), JSON.stringify(jsonOut, null, 2))
	console.log('\nЗаписано: ci-results/re24-own2-frequency-sweep.{md,json}')
}

main()
