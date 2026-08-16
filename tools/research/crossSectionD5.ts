// D5 — кросс-секция / relative-value (трек D из docs/ROADMAP.md). Пред-регистрированный прогон (дефолты).
//
// Мотив (из NEGATIVE-KNOWLEDGE §8, находка D-lead): long и short в противофазе по кварталам —
//   сигнал стреляет в обе стороны корректно, но безусловный результат ≈0, потому что его топит ОБЩЕЕ
//   движение рынка (бета). Гипотеза D5: если вычесть рынок (рыночно-нейтральная пара), останется только
//   «обогнал ли фаворит рынок» → бета уходит, и виден чистый вклад сигнала (если он есть).
//
// Дизайн (дефолты; §2.1 — ни одного нового порога):
//   Тот же допущенный набор стрелок (admitArrowSignals, filter=off, A1-путь), 5 активов × 3 ТФ.
//   Горизонт удержания H = ARROW_MODE_CONFIGS.safe.maxHoldingBars (существующая константа).
//   Вход = open следующего бара после сигнала; выход = close через H баров (или конец истории).
//   Две руки на ОДНОЙ выборке (единственное отличие — вычитание хеджа):
//     - directional  : pnl = side * rA                 (как торгуем сейчас, «в лоб»)
//     - relative-value: pnl = side * (rA - basketRet)  (long фаворит / short корзина остальных)
//   rA — простая доходность сигнальной монеты за окно; basketRet — средняя доходность ОСТАЛЬНЫХ активов
//   вселенной на том же ТФ за то же календарное окно (равный вес). Хедж по дефолту = корзина остальных.
//   Издержки: 7 bps/side. directional = 2 стороны (0.14%); relative-value = 4 стороны (2 ноги, 0.28%).
//   Метрика — доходность на сделку (в %, не R): для кросс-секции корректно мерить доходности, а не R-стопы.
//   Честная планка: train/OOS 65/35 по времени + bootstrap CI + per-asset breadth + per-quarter.
//
// §2.3: src не тронут. Данные — офлайн кэш. Запуск: npx tsx tools/research/crossSectionD5.ts.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { admitArrowSignals, detectArrowSignalCandidates, type ArrowSide } from '../../src/core/signals/ArrowSignalEngine.js'
import { ARROW_MODE_CONFIGS } from '../../src/core/signals/ArrowTradeReplay.js'

const ASSETS = ['SOL', 'BTC', 'ETH', 'XRP', 'BNB'] as const
const TIMEFRAMES = ['30m', '1h', '2h'] as const
const H = ARROW_MODE_CONFIGS.safe.maxHoldingBars // существующая константа, НЕ новое число
const COST_SIDE = 7 / 10_000 // 7 bps/side
const COST_DIRECTIONAL = 2 * COST_SIDE // вход+выход, 1 нога
const COST_RV = 4 * COST_SIDE // вход+выход, 2 ноги
const TRAIN_FRACTION = 0.65
const CLUSTER_MS = 4 * 60 * 60 * 1000
const BOOTSTRAP_SAMPLES = 2000
const BOOTSTRAP_SEED = 20260807

type Split = 'train' | 'oos'
interface Row { asset: string; timeframe: string; side: ArrowSide; signalAt: number; base: number; rv: number; quarter: string; cluster: string }

function quantile(xs: readonly number[], q: number): number | null { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y), p = (a.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return a[lo]! + (a[hi]! - a[lo]!) * (p - lo) }
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296) }
function bootstrapCI(values: readonly number[], seedSalt: string): [number | null, number | null] {
	if (values.length < 2) return [null, null]
	const hash = createHash('sha256').update(seedSalt).digest().readUInt32LE(0)
	const random = rng(BOOTSTRAP_SEED ^ hash), means: number[] = []
	for (let b = 0; b < BOOTSTRAP_SAMPLES; b++) { let sum = 0; for (let i = 0; i < values.length; i++) sum += values[Math.floor(random() * values.length)]!; means.push(sum / values.length) }
	return [quantile(means, 0.025), quantile(means, 0.975)]
}
function summ(values: readonly number[], salt: string) {
	const v = values.filter(Number.isFinite)
	return {
		N: v.length,
		meanPct: v.length ? 100 * v.reduce((a, b) => a + b, 0) / v.length : null,
		ci: (() => { const c = bootstrapCI(v, salt); return [c[0] == null ? null : 100 * c[0], c[1] == null ? null : 100 * c[1]] as [number | null, number | null] })(),
		posRate: v.length ? v.filter(x => x > 0).length / v.length : null,
	}
}
const quarterOf = (ms: number) => { const d = new Date(ms); return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}` }

// —— загрузка всех активов по ТФ + карта timestamp->candle для хеджа ——
const rows: Row[] = []
const sources: any[] = []
const skipped: string[] = []

for (const timeframe of TIMEFRAMES) {
	const candlesByAsset: Record<string, Candle[]> = {}
	const mapByAsset: Record<string, Map<number, Candle>> = {}
	for (const asset of ASSETS) {
		const path = resolve(`tools/batch/cache/${asset}-USDT_${timeframe}_20000_futures.json`)
		if (!existsSync(path)) { skipped.push(`${asset} ${timeframe}`); continue }
		const candles = JSON.parse(readFileSync(path, 'utf8')) as Candle[]
		candlesByAsset[asset] = candles
		const m = new Map<number, Candle>()
		for (const c of candles) m.set(c.timestamp, c)
		mapByAsset[asset] = m
	}

	for (const asset of ASSETS) {
		const candles = candlesByAsset[asset]
		if (candles == null) continue
		const detection = detectArrowSignalCandidates(candles, APEX_PARAMS)
		const admitted = admitArrowSignals(detection.candidates)
		let used = 0
		for (const signal of admitted) {
			const entryIndex = signal.signalIndex + 1
			const exitIndex = Math.min(candles.length - 1, entryIndex + H - 1)
			const entryCandle = candles[entryIndex]
			const exitCandle = candles[exitIndex]
			if (entryCandle == null || exitCandle == null || exitIndex <= entryIndex) continue
			if (!(entryCandle.open > 0)) continue
			const s = signal.side === 'long' ? 1 : -1
			const rA = (exitCandle.close - entryCandle.open) / entryCandle.open
			const entryTs = entryCandle.timestamp, exitTs = exitCandle.timestamp

			// корзина остальных активов вселенной на том же ТФ за то же календарное окно (равный вес)
			const legRets: number[] = []
			for (const other of ASSETS) {
				if (other === asset) continue
				const om = mapByAsset[other]
				if (om == null) continue
				const oEntry = om.get(entryTs), oExit = om.get(exitTs)
				if (oEntry == null || oExit == null || !(oEntry.open > 0)) continue
				legRets.push((oExit.close - oEntry.open) / oEntry.open)
			}
			if (legRets.length === 0) continue // без хеджа сделку не берём (нужна кросс-секция)
			const basketRet = legRets.reduce((a, b) => a + b, 0) / legRets.length

			const base = s * rA - COST_DIRECTIONAL
			const rv = s * (rA - basketRet) - COST_RV
			rows.push({ asset, timeframe, side: signal.side, signalAt: signal.signalAt, base, rv, quarter: quarterOf(signal.signalAt), cluster: `${Math.floor(signal.signalAt / CLUSTER_MS)}-${signal.side}` })
			used++
		}
		sources.push({ asset, timeframe, bars: candles.length, admitted: admitted.length, used })
		process.stdout.write(`ok ${asset} ${timeframe}: admitted=${admitted.length} used=${used}\n`)
	}
}

function splitByTime(rs: readonly Row[]): { train: Row[]; oos: Row[] } {
	const sorted = [...rs].sort((a, b) => a.signalAt - b.signalAt)
	const cut = Math.floor(sorted.length * TRAIN_FRACTION)
	return { train: sorted.slice(0, cut), oos: sorted.slice(cut) }
}

const { train, oos } = splitByTime(rows)
const ARMS = ['directional', 'relative-value'] as const
const pick = (r: Row, arm: typeof ARMS[number]) => arm === 'directional' ? r.base : r.rv

const arms: Record<string, any> = {}
for (const arm of ARMS) {
	const fullVals = rows.map(r => pick(r, arm))
	const trainVals = train.map(r => pick(r, arm))
	const oosVals = oos.map(r => pick(r, arm))
	const breadthByAssetOOS = ASSETS.map(a => { const s = summ(oos.filter(r => r.asset === a).map(r => pick(r, arm)), `d5-${arm}-oos-${a}`); return { asset: a, N: s.N, meanPct: s.meanPct } })
	const quarters = [...new Set(rows.map(r => r.quarter))].sort()
	const perQuarter = quarters.map(q => { const s = summ(rows.filter(r => r.quarter === q).map(r => pick(r, arm)), `d5-${arm}-q-${q}`); return { quarter: q, N: s.N, meanPct: s.meanPct, ci: s.ci } }).filter(r => r.N > 0)
	const qEligible = perQuarter.filter(r => r.N >= 10)
	const qPositive = qEligible.filter(r => (r.meanPct ?? 0) > 0).length
	arms[arm] = {
		full: summ(fullVals, `d5-${arm}-full`),
		train: summ(trainVals, `d5-${arm}-train`),
		oos: summ(oosVals, `d5-${arm}-oos`),
		breadthByAssetOOS, perQuarter, quartersEligible: qEligible.length, quartersPositive: qPositive,
	}
}

const n2 = (x: any) => x == null ? 'n/a' : (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(3) : String(x))

console.log(`\n===== D5 — кросс-секция / relative-value (дефолты: хедж = корзина остальных, H=${H} баров) =====`)
console.log(`Сделок всего: ${rows.length}; train ${train.length} / OOS ${oos.length}`)
if (skipped.length) console.log(`Пропущено кэшей: ${skipped.join(', ')}`)

console.log(`\n----- directional (в лоб) vs relative-value (минус рынок) — meanReturn %/сделку -----`)
const table: any[] = []
for (const arm of ARMS) for (const split of ['train', 'oos'] as const) {
	const s = arms[arm][split]
	table.push({ arm, split, N: s.N, meanPct: n2(s.meanPct), CIlo: n2(s.ci[0]), CIhi: n2(s.ci[1]), posRate: n2(s.posRate) })
}
console.table(table)

console.log(`\n----- per-asset breadth (OOS), meanReturn % -----`)
for (const arm of ARMS) {
	console.log(`  ${arm}:`)
	console.table(arms[arm].breadthByAssetOOS.map((b: any) => ({ asset: b.asset, N: b.N, meanPct: n2(b.meanPct) })))
}

console.log(`\n----- per-quarter (N>=10) -----`)
for (const arm of ARMS) console.log(`  ${arm}: кварталов N>=10: ${arms[arm].quartersEligible}, из них meanPct>0: ${arms[arm].quartersPositive}`)

const result = {
	generatedAt: new Date().toISOString(),
	protocol: 'D5-cross-section-relative-value-1.0 (defaults: hedge=equal-weight basket of other universe assets; horizon=maxHoldingBars; long signal asset / short basket)',
	preregistration: {
		universe: ASSETS, timeframes: TIMEFRAMES, horizonBars: H,
		hedge: 'equal-weight basket of the OTHER universe assets, same TF, same calendar window (default)',
		arms: { directional: 'side * assetReturn (как сейчас, в лоб)', 'relative-value': 'side * (assetReturn - basketReturn), market-neutral' },
		costs: 'directional 2×7bps, relative-value 4×7bps (2 ноги); funding omitted',
		metric: 'return % per trade (не R — для кросс-секции корректно сравнивать доходности)',
		trainFraction: TRAIN_FRACTION, bootstrap: `${BOOTSTRAP_SAMPLES} resamples, seed ${BOOTSTRAP_SEED}`,
		note: '§2.1: ни одного нового числа (H=maxHoldingBars, издержки штатные, окно фикс.). §2.3: src не тронут. ⚠ Ранжирование top-k и метрика силы сигнала — следующий шаг, решает автор.',
	},
	sources, skipped, totalTrades: rows.length, trainN: train.length, oosN: oos.length, arms,
}
writeFileSync(resolve('ci-results/cross-section-d5.json'), JSON.stringify(result, null, 2))
console.log(`\nWrote ci-results/cross-section-d5.json`)
