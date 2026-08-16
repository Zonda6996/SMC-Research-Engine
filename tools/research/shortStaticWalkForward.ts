// D-lead — временная стабильность кармана safe/static/SHORT (трек D, docs/ROADMAP.md).
//
// Контекст: B1 → фильтры входа edge не дают; D1 → static-выход >> dynamic; D1.2 → target не рычаг,
//   НО short на safe-геометрии повторяемо положителен (B1, D1, D1.2). CI-low пока <0 → лид, не edge.
// Вопрос ЗДЕСЬ: этот short-плюс стабилен во времени или это одно везучее окно?
//
// Метод: стратегия ЗАФИКСИРОВАНА (safe-геометрия, static-тейк 2×step, SHORT-only) — подгонять нечего.
//   Все сделки по 5 активам × 3 ТФ пулятся и разбиваются по КАЛЕНДАРНЫМ КВАРТАЛАМ. По каждому кварталу —
//   meanR + bootstrap CI + PF + N. Смотрим: в какой доле кварталов short положителен. Long — для контраста.
// §2.1: порогов нет. §2.3: src не тронут (static-путь воспроизведён вербатим, как в exitTargetSweep).
// Данные — офлайн кэш. Запуск: npx tsx tools/research/shortStaticWalkForward.ts. Дата: 2026-08-14.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { admitArrowSignals, detectArrowSignalCandidates, type ArrowSide, type ArrowSignal } from '../../src/core/signals/ArrowSignalEngine.js'
import { ARROW_MODE_CONFIGS } from '../../src/core/signals/ArrowTradeReplay.js'

const ASSETS = ['SOL', 'BTC', 'ETH', 'XRP', 'BNB'] as const
const TIMEFRAMES = ['30m', '1h', '2h'] as const
const GEO = 'safe' as const
const TARGET_STEPS = 2 // валидированный baseline из D1/D1.2
const CLUSTER_MS = 4 * 60 * 60 * 1000
const BOOTSTRAP_SAMPLES = 2000
const BOOTSTRAP_SEED = 20260807

type Outcome = 'full-tp' | 'stop' | 'timeout' | 'open'
interface Row { asset: string; timeframe: string; side: ArrowSide; netR: number; outcome: Outcome; signalAt: number; quarter: string; cluster: string }

const favorableWick = (side: ArrowSide, c: Candle, lvl: number) => side === 'long' ? c.high >= lvl : c.low <= lvl
const adverseWick = (side: ArrowSide, c: Candle, lvl: number) => side === 'long' ? c.low <= lvl : c.high >= lvl
const directionalPnl = (side: ArrowSide, entry: number, exit: number) => side === 'long' ? exit - entry : entry - exit

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

const all: Row[] = []
const skipped: string[] = []
for (const asset of ASSETS) for (const timeframe of TIMEFRAMES) {
	const path = resolve(`tools/batch/cache/${asset}-USDT_${timeframe}_20000_futures.json`)
	if (!existsSync(path)) { skipped.push(`${asset} ${timeframe}`); continue }
	const candles = JSON.parse(readFileSync(path, 'utf8')) as Candle[]
	const detection = detectArrowSignalCandidates(candles, APEX_PARAMS)
	for (const signal of admitArrowSignals(detection.candidates)) {
		const t = replayStatic(candles, signal)
		if (t == null) continue
		all.push({ asset, timeframe, side: t.side, netR: t.netR, outcome: t.outcome, signalAt: t.signalAt, quarter: quarterOf(t.signalAt), cluster: `${Math.floor(t.signalAt / CLUSTER_MS)}-${t.side}` })
	}
	process.stdout.write(`ok ${asset} ${timeframe}\n`)
}

const quarters = [...new Set(all.map(t => t.quarter))].sort()
const n2 = (x: any) => x == null ? 'n/a' : (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(3) : String(x))
const shortRows = all.filter(t => t.side === 'short')
const longRows = all.filter(t => t.side === 'long')

const perQuarter = quarters.map(q => {
	const s = summ(shortRows.filter(t => t.quarter === q), `short-${q}`)
	const l = summ(longRows.filter(t => t.quarter === q), `long-${q}`)
	return { quarter: q, shortN: s.N, shortMeanR: s.meanR, shortCI: s.ci, shortPF: s.pf, longN: l.N, longMeanR: l.meanR }
}).filter(r => r.shortN + r.longN > 0)

const shortQuartersWithData = perQuarter.filter(r => r.shortN >= 10)
const positiveShortQ = shortQuartersWithData.filter(r => (r.shortMeanR ?? 0) > 0).length

console.log('\n===== SHORT safe/static/T2 — по кварталам (net 7bps) =====')
console.table(perQuarter.map(r => ({ quarter: r.quarter, shortN: r.shortN, shortMeanR: n2(r.shortMeanR), CIlo: n2(r.shortCI[0]), CIhi: n2(r.shortCI[1]), PF: n2(r.shortPF), longN: r.longN, longMeanR: n2(r.longMeanR) })))
const sAll = summ(shortRows, 'short-all')
console.log(`\nShort ИТОГО: N=${sAll.N} meanR=${n2(sAll.meanR)} CI=[${n2(sAll.ci[0])}, ${n2(sAll.ci[1])}] PF=${n2(sAll.pf)} clusters=${sAll.clusters}`)
console.log(`Кварталов с N(short)>=10: ${shortQuartersWithData.length}; из них meanR>0: ${positiveShortQ} (${shortQuartersWithData.length ? (100 * positiveShortQ / shortQuartersWithData.length).toFixed(0) : 0}%)`)
if (skipped.length) console.log(`Пропущено: ${skipped.join(', ')}`)

writeFileSync(resolve('ci-results/short-static-walkforward.json'), JSON.stringify({
	generatedAt: new Date().toISOString(), protocol: 'D-lead-short-static-temporal-stability-1.0',
	fixedStrategy: { geometry: GEO, exit: 'static-full', targetSteps: TARGET_STEPS, side: 'short-only', costsBps: 7 },
	note: 'Стратегия зафиксирована (подгонять нечего). Разбивка по календарным кварталам, pooled по 5 активам × 3 ТФ. §2.1/§2.3 соблюдены.',
	shortTotal: sAll, quartersWithShortData: shortQuartersWithData.length, positiveShortQuarters: positiveShortQ, perQuarter, skipped,
}, null, 2))
console.log(`\nWrote ci-results/short-static-walkforward.json`)
