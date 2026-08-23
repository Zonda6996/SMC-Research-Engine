/**
 * RE24c — СТРОГАЯ OOS-валидация круга RE24b: настоящий ли net-edge собственных сигналов OWN2?
 *
 * RE24b (in-sample) показал: OWN2-сигналы + прореживание переизбытка + стоп ≈ его AvgStop дают
 * вендорский масштаб (+8…+24R gross) и плюс после 5 bps. НО spacing/стоп подбирались на всём ряду →
 * возможен overfit (RE17 нас на этом жёг). RE24c честно: хронo split 65/35, подбор (spacing,stop)
 * ТОЛЬКО на train по max net@5, замер на OOS. + bootstrap-CI meanR@5 на OOS + a-priori baseline
 * (стоп под его AvgStop, spacing=0 — без подбора). Kill-критерий: net@5 OOS > 0 и CI не пересекает 0.
 *
 * §2.1/§2.3: свипаем СВОИ параметры OWN2 (стоп/интервал), не вендорские правила. src/core не тронут.
 * Запуск: npx tsx "ci/research/runRE24cOwn2Oos.ts"
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { detectArrowSignalCandidates } from '../../src/core/signals/ArrowSignalEngine.js'
import type { ArrowSignal } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayArrowSignals } from '../../src/core/signals/ArrowTradeReplay.js'
import type { ArrowTrade, ArrowModeConfig } from '../../src/core/signals/ArrowTradeReplay.js'

interface Series { key: string; file: string; authorRefR: number; authorAvgStopPct: number }
const SERIES: Series[] = [
	{ key: 'VIRTUAL 5m', file: 'csv/BINANCE_VIRTUALUSDT, 5.csv', authorRefR: 15.24, authorAvgStopPct: 1.58 },
	{ key: 'ONDO 5m', file: 'csv/BINANCE_ONDOUSDT, 5.csv', authorRefR: 12.12, authorAvgStopPct: 2.14 },
	{ key: 'LDO 15m', file: 'csv/BINANCE_LDOUSDT, 15.csv', authorRefR: 15.25, authorAvgStopPct: 1.86 },
	{ key: 'AVAX 5m', file: 'csv/BINANCE_AVAXUSDT, 5.csv', authorRefR: 12.62, authorAvgStopPct: 1.70 },
]

const CANON = { warmupBars: 200, relativeVolumePeriod: 20, minimumRelativeVolume: 1.4, minimumDistanceMeanPct: 3, minimumPenetrationInner: -0.35 }
const STOP_GRID = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 2.0]
const SPACING = [0, 20, 50, 100]
const COST_BPS = [0, 5, 7]
const BASE: Partial<ArrowModeConfig> = { fullFixAtMean: true, addEnabled: false }
const SPLIT = 0.65
const BOOT = 2000

const num = (x: string | undefined): number => { const n = Number((x ?? '').trim()); return Number.isFinite(n) ? n : NaN }
const pct = (x: number): string => Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a'
const r2 = (x: number): string => Number.isFinite(x) ? x.toFixed(2) : 'n/a'
const r3 = (x: number): string => Number.isFinite(x) ? x.toFixed(3) : 'n/a'

function loadCsv(file: string): Candle[] {
	const lines = readFileSync(resolve(file), 'utf8').split(/\r?\n/).filter((l) => l.length > 0)
	const candles: Candle[] = []
	for (let li = 1; li < lines.length; li++) {
		const p = lines[li]!.split(',')
		if (p.length < 13) continue
		const ts = num(p[0]), o = num(p[1]), h = num(p[2]), l = num(p[3]), c = num(p[4])
		if (![ts, o, h, l, c].every(Number.isFinite)) continue
		candles.push({ timestamp: ts * 1000, open: o, high: h, low: l, close: c, volume: num(p[12]) || 0 })
	}
	return candles
}
function thin(signals: ArrowSignal[], spacing: number): ArrowSignal[] {
	if (spacing <= 0) return signals
	const out: ArrowSignal[] = []; let last = -Infinity
	for (const s of signals) { if (s.signalIndex - last >= spacing) { out.push(s); last = s.signalIndex } }
	return out
}
function replay(candles: Candle[], bands: ReturnType<typeof computeApexBands>, signals: ArrowSignal[], stopSteps: number, bps: number): ArrowTrade[] {
	return replayArrowSignals(candles, bands, signals, 'safe', { ...BASE, stopSteps, oneWayCostBps: bps }).trades.filter((t) => t.outcome !== 'open')
}
interface M { n: number; totalR: number; meanR: number; moneyWR: number; vendorWR: number; avgStopPct: number }
function metrics(trades: ArrowTrade[]): M {
	const n = trades.length
	if (!n) return { n: 0, totalR: 0, meanR: NaN, moneyWR: NaN, vendorWR: NaN, avgStopPct: NaN }
	const totalR = trades.reduce((s, t) => s + t.netR, 0)
	const win = trades.filter((t) => t.netR > 0).length
	const vW = trades.filter((t) => t.outcome === 'full-tp' || t.outcome === 'partial-be' || t.outcome === 'partial-stop').length
	const vL = trades.filter((t) => t.outcome === 'stop').length
	const avgStopPct = trades.reduce((s, t) => s + Math.abs(t.entry - t.stop) / t.entry * 100, 0) / n
	return { n, totalR, meanR: totalR / n, moneyWR: win / n, vendorWR: (vW + vL) ? vW / (vW + vL) : NaN, avgStopPct }
}
// детерминированный bootstrap-CI среднего (LCG, чтобы воспроизводимо)
function bootCI(vals: number[]): [number, number] {
	if (vals.length < 3) return [NaN, NaN]
	let seed = 123456789 >>> 0
	const rnd = (): number => { seed = (1103515245 * seed + 12345) >>> 0; return seed / 4294967296 }
	const means: number[] = []
	for (let b = 0; b < BOOT; b++) {
		let s = 0
		for (let i = 0; i < vals.length; i++) s += vals[Math.floor(rnd() * vals.length)]!
		means.push(s / vals.length)
	}
	means.sort((a, b) => a - b)
	return [means[Math.floor(0.025 * BOOT)]!, means[Math.floor(0.975 * BOOT)]!]
}

interface Res {
	key: string; author: Series; nCanon: number
	splitSignalIndex: number
	apriori: { stopSteps: number; stopPct: number; oosByCost: Array<{ bps: number; m: M }> }
	best: { spacing: number; stopSteps: number; trainNet5: number; oosByCost: Array<{ bps: number; m: M }>; oosCI5: [number, number]; oosFreqPerMonth: number }
}

function main(): void {
	const results: Res[] = []
	for (const s of SERIES) {
		if (!existsSync(resolve(s.file))) { console.log(`skip ${s.key}`); continue }
		const candles = loadCsv(s.file)
		if (candles.length < 400) { console.log(`skip ${s.key}: баров ${candles.length}`); continue }
		const bands = computeApexBands([...candles], APEX_PARAMS)
		const splitIdx = Math.floor(candles.length * SPLIT)
		const splitTs = candles[splitIdx]!.timestamp
		const oosMonths = (candles[candles.length - 1]!.timestamp - splitTs) / (30 * 24 * 3600 * 1000)
		const canon = detectArrowSignalCandidates(candles, APEX_PARAMS, CANON).candidates as ArrowSignal[]

		const inTrain = (t: ArrowTrade): boolean => t.signalIndex < splitIdx
		const inOos = (t: ArrowTrade): boolean => t.signalIndex >= splitIdx

		// a-priori: стоп под AvgStop (подбор стопа на TRAIN-сделках по близости стоп%), spacing=0
		let aStop = STOP_GRID[0]!, aPct = NaN, aDelta = Infinity
		for (const st of STOP_GRID) {
			const trTrades = replay(candles, bands, canon, st, 0).filter(inTrain)
			const m = metrics(trTrades)
			const dd = Math.abs(m.avgStopPct - s.authorAvgStopPct)
			if (Number.isFinite(dd) && dd < aDelta) { aDelta = dd; aStop = st; aPct = m.avgStopPct }
		}
		const aprioriOos = COST_BPS.map((bps) => ({ bps, m: metrics(replay(candles, bands, canon, aStop, bps).filter(inOos)) }))

		// best: подбор (spacing,stop) на TRAIN по max net@5(train)
		let bTrain5 = -Infinity, bSpacing = 0, bStop = aStop
		for (const sp of SPACING) {
			const sig = thin(canon, sp)
			for (const st of STOP_GRID) {
				const tr5 = replay(candles, bands, sig, st, 5).filter(inTrain)
				const net5 = metrics(tr5).totalR
				if (Number.isFinite(net5) && net5 > bTrain5) { bTrain5 = net5; bSpacing = sp; bStop = st }
			}
		}
		const bSig = thin(canon, bSpacing)
		const bestOos = COST_BPS.map((bps) => ({ bps, m: metrics(replay(candles, bands, bSig, bStop, bps).filter(inOos)) }))
		const oosTrades5 = replay(candles, bands, bSig, bStop, 5).filter(inOos)
		const ci5 = bootCI(oosTrades5.map((t) => t.netR))
		const oosFreq = oosMonths > 0 ? oosTrades5.length / oosMonths : NaN

		results.push({ key: s.key, author: s, nCanon: canon.length, splitSignalIndex: splitIdx, apriori: { stopSteps: aStop, stopPct: aPct, oosByCost: aprioriOos }, best: { spacing: bSpacing, stopSteps: bStop, trainNet5: bTrain5, oosByCost: bestOos, oosCI5: ci5, oosFreqPerMonth: oosFreq } })

		const bO5 = bestOos.find((c) => c.bps === 5)!.m
		const aO5 = aprioriOos.find((c) => c.bps === 5)!.m
		console.log(`\n=== ${s.key} (канон ${canon.length}; автор +${s.authorRefR}R) ===`)
		console.log(`  A-PRIORI стоп=${aStop} (${r2(aPct)}%): OOS@5 N=${aO5.n} net ${r2(aO5.totalR)}R meanR ${r3(aO5.meanR)} WR ${pct(aO5.vendorWR)}`)
		console.log(`  BEST train-pick spacing=${bSpacing} stop=${bStop} (trainNet5 ${r2(bTrain5)}R):`)
		for (const c of bestOos) console.log(`     OOS ${c.bps}bps: N=${c.m.n} net ${r2(c.m.totalR)}R meanR ${r3(c.m.meanR)} WR money ${pct(c.m.moneyWR)} vendor ${pct(c.m.vendorWR)}`)
		console.log(`     OOS meanR@5 CI95 [${r3(ci5[0])}, ${r3(ci5[1])}] ${ci5[0] > 0 ? '→ >0 (edge держится)' : '→ пересекает 0'} | OOS freq ${r2(oosFreq)}/мес`)
	}
	if (!results.length) throw new Error('RE24c: ни одной серии.')

	// агрегат OOS@5 (pooled meanR + CI по всем OOS-сделкам best)
	const md: string[] = []
	md.push('# RE24c — строгая OOS-валидация net-edge собственных сигналов OWN2')
	md.push('')
	md.push('> Хронo split 65/35. (spacing,stop) подбираются ТОЛЬКО на train по max net@5; замер на OOS. A-priori = стоп под его AvgStop, spacing=0 (без подбора). Kill-критерий: OOS net@5 > 0 И bootstrap-CI95 meanR@5 не пересекает 0. base `{fullFixAtMean:true, addEnabled:false}`, mode `safe`. src/core не тронут.')
	md.push('')
	md.push('| серия | A-priori OOS@5 (net / WR) | BEST spacing/stop | OOS@0 | OOS@5 | OOS@7 | OOS meanR@5 CI95 | OOS freq/мес |')
	md.push('|---|---|---|---|---|---|---|---|')
	for (const r of results) {
		const a5 = r.apriori.oosByCost.find((c) => c.bps === 5)!.m
		const b0 = r.best.oosByCost.find((c) => c.bps === 0)!.m
		const b5 = r.best.oosByCost.find((c) => c.bps === 5)!.m
		const b7 = r.best.oosByCost.find((c) => c.bps === 7)!.m
		md.push(`| ${r.key} | ${r2(a5.totalR)}R / ${pct(a5.vendorWR)} | sp${r.best.spacing}/st${r.best.stopSteps} | ${r2(b0.totalR)}R | **${r2(b5.totalR)}R** | ${r2(b7.totalR)}R | [${r3(r.best.oosCI5[0])}, ${r3(r.best.oosCI5[1])}] | ${r2(r.best.oosFreqPerMonth)} |`)
	}
	md.push('')
	md.push('## Чтение')
	md.push('- **OOS@5 > 0 И CI95 не пересекает 0 на серии** ⇒ edge переносится на этой серии (не in-sample артефакт).')
	md.push('- **A-priori OOS@5 > 0** (без подбора spacing/stop) ⇒ самый честный сигнал: плюс без выбора гиперпараметров.')
	md.push('- **BEST OOS ≪ trainNet5** ⇒ train-подбор переобучился (как RE17); смотреть на CI и a-priori, не на train.')

	if (!existsSync(resolve('ci-results'))) mkdirSync(resolve('ci-results'), { recursive: true })
	writeFileSync(resolve('ci-results/re24c-own2-oos.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/re24c-own2-oos.json'), JSON.stringify({ generatedAt: new Date().toISOString(), split: SPLIT, stopGrid: STOP_GRID, spacing: SPACING, costBps: COST_BPS, boot: BOOT, canon: CANON, series: results }, null, 2))
	console.log('\nЗаписано: ci-results/re24c-own2-oos.{md,json}')
}

main()
