// D5-rank — кросс-секция top-1 vs аутсайдер по относительному импульсу (вариант A). Трек D, docs/ROADMAP.md.
//
// Идея (по решению автора): не хеджировать все сигналы корзиной (это D5-default), а в момент сигнала
//   ранжировать монеты по «силе» = относительному импульсу и торговать ТОЛЬКО крайних:
//   long самого сильного / short самого слабого (топ-1 против аутсайдера).
//
// «Сила» = относительный импульс: доходность монеты за последние H баров ДО сигнала (H = maxHoldingBars,
//   существующая константа, §2.1 — нового числа нет). Ранжирование по прошлому (строго причинно).
//   Вычитание корзины из импульса не меняет РАНГ (монотонно) → ранжируем по сырой прошлой доходности.
//
// Две руки (одна выборка сигналов-событий как «часы»):
//   1) signal-gated-top1 — берём сделку ТОЛЬКО если сигнальная монета сама является крайней в сторону
//      сигнала (long-сигнал → монета = лидер импульса; short-сигнал → монета = аутсайдер). Направление
//      от сигнала. long-нога и short-нога = крайние по импульсу. Это «злая» версия, что просил автор.
//   2) momentum-only (КОНТРОЛЬ) — в момент каждого сигнала просто long лидер / short аутсайдер, БЕЗ учёта
//      стороны и того, какая монета сигналила. Ответ на вопрос: платит ли САМ сигнал, или это чистый моментум.
//
// pnl = longRet − shortRet за окно [вход, вход+H], издержки 4×7bps (2 ноги). Метрика — доходность %/сделку.
// Планка: train/OOS 65/35 + bootstrap CI + per-asset breadth + per-quarter. §2.3: src не тронут.
// Запуск: npx tsx tools/research/crossSectionD5Rank.ts.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { admitArrowSignals, detectArrowSignalCandidates, type ArrowSide } from '../../src/core/signals/ArrowSignalEngine.js'
import { ARROW_MODE_CONFIGS } from '../../src/core/signals/ArrowTradeReplay.js'

const ASSETS = ['SOL', 'BTC', 'ETH', 'XRP', 'BNB'] as const
const TIMEFRAMES = ['30m', '1h', '2h'] as const
const H = ARROW_MODE_CONFIGS.safe.maxHoldingBars // горизонт удержания И окно импульса (существующая константа)
const COST_SIDE = 7 / 10_000
const COST_RV = 4 * COST_SIDE // 2 ноги × вход/выход
const TRAIN_FRACTION = 0.65
const CLUSTER_MS = 4 * 60 * 60 * 1000
const BOOTSTRAP_SAMPLES = 2000
const BOOTSTRAP_SEED = 20260807

interface Row { longAsset: string; timeframe: string; signalAt: number; pnl: number; quarter: string; cluster: string }

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
	const c = bootstrapCI(v, salt)
	return { N: v.length, meanPct: v.length ? 100 * v.reduce((a, b) => a + b, 0) / v.length : null, ci: [c[0] == null ? null : 100 * c[0], c[1] == null ? null : 100 * c[1]] as [number | null, number | null], posRate: v.length ? v.filter(x => x > 0).length / v.length : null }
}
const quarterOf = (ms: number) => { const d = new Date(ms); return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}` }

const gatedRows: Row[] = []
const momoRows: Row[] = []
const sources: any[] = []
const skipped: string[] = []

for (const timeframe of TIMEFRAMES) {
	const candlesByAsset: Record<string, Candle[]> = {}
	const tsToCandle: Record<string, Map<number, Candle>> = {}
	const tsToIndex: Record<string, Map<number, number>> = {}
	for (const asset of ASSETS) {
		const path = resolve(`tools/batch/cache/${asset}-USDT_${timeframe}_20000_futures.json`)
		if (!existsSync(path)) { skipped.push(`${asset} ${timeframe}`); continue }
		const candles = JSON.parse(readFileSync(path, 'utf8')) as Candle[]
		candlesByAsset[asset] = candles
		const mc = new Map<number, Candle>(), mi = new Map<number, number>()
		candles.forEach((c, i) => { mc.set(c.timestamp, c); mi.set(c.timestamp, i) })
		tsToCandle[asset] = mc; tsToIndex[asset] = mi
	}

	// относит. импульс монеты X на момент tSig = доходность X за последние H баров (строго причинно)
	const relMomAt = (X: string, tSig: number): number | null => {
		const idx = tsToIndex[X]?.get(tSig); if (idx == null || idx - H < 0) return null
		const cs = candlesByAsset[X]!; const past = cs[idx - H]!.close, now = cs[idx]!.close
		if (!(past > 0)) return null
		return (now - past) / past
	}
	// доходность ноги за окно удержания [entryTs, exitTs]
	const windowRet = (X: string, entryTs: number, exitTs: number): number | null => {
		const e = tsToCandle[X]?.get(entryTs), x = tsToCandle[X]?.get(exitTs)
		if (e == null || x == null || !(e.open > 0)) return null
		return (x.close - e.open) / e.open
	}

	for (const asset of ASSETS) {
		const candles = candlesByAsset[asset]; if (candles == null) continue
		const detection = detectArrowSignalCandidates(candles, APEX_PARAMS)
		const admitted = admitArrowSignals(detection.candidates)
		let usedGated = 0, usedMomo = 0
		for (const signal of admitted) {
			const tSig = candles[signal.signalIndex]?.timestamp; if (tSig == null) continue
			const entryIndex = signal.signalIndex + 1
			const exitIndex = Math.min(candles.length - 1, entryIndex + H - 1)
			const entryCandle = candles[entryIndex], exitCandle = candles[exitIndex]
			if (entryCandle == null || exitCandle == null || exitIndex <= entryIndex) continue
			const entryTs = entryCandle.timestamp, exitTs = exitCandle.timestamp

			// ранжируем все активы с валидным импульсом на tSig
			const rm: Array<{ a: string; v: number }> = []
			for (const X of ASSETS) { const v = relMomAt(X, tSig); if (v != null) rm.push({ a: X, v }) }
			if (rm.length < 2) continue
			rm.sort((p, q) => q.v - p.v)
			const leader = rm[0]!.a, laggard = rm[rm.length - 1]!.a
			if (leader === laggard) continue

			// --- контроль: momentum-only (long лидер / short аутсайдер) ---
			const lM = windowRet(leader, entryTs, exitTs), sM = windowRet(laggard, entryTs, exitTs)
			if (lM != null && sM != null) { momoRows.push({ longAsset: leader, timeframe, signalAt: signal.signalAt, pnl: lM - sM - COST_RV, quarter: quarterOf(signal.signalAt), cluster: `${Math.floor(signal.signalAt / CLUSTER_MS)}-mo` }); usedMomo++ }

			// --- signal-gated-top1: монета должна быть крайней в сторону сигнала ---
			let longAsset: string | null = null, shortAsset: string | null = null
			if (signal.side === 'long' && asset === leader) { longAsset = asset; shortAsset = laggard }
			else if (signal.side === 'short' && asset === laggard) { shortAsset = asset; longAsset = leader }
			if (longAsset != null && shortAsset != null && longAsset !== shortAsset) {
				const lr = windowRet(longAsset, entryTs, exitTs), sr = windowRet(shortAsset, entryTs, exitTs)
				if (lr != null && sr != null) { gatedRows.push({ longAsset, timeframe, signalAt: signal.signalAt, pnl: lr - sr - COST_RV, quarter: quarterOf(signal.signalAt), cluster: `${Math.floor(signal.signalAt / CLUSTER_MS)}-${signal.side}` }); usedGated++ }
			}
		}
		sources.push({ asset, timeframe, admitted: admitted.length, usedGated, usedMomo })
		process.stdout.write(`ok ${asset} ${timeframe}: admitted=${admitted.length} gated=${usedGated}\n`)
	}
}

function splitByTime(rs: readonly Row[]) { const s = [...rs].sort((a, b) => a.signalAt - b.signalAt); const cut = Math.floor(s.length * TRAIN_FRACTION); return { train: s.slice(0, cut), oos: s.slice(cut) } }
function buildArm(rs: Row[], name: string) {
	const { train, oos } = splitByTime(rs)
	const breadthByLongAssetOOS = ASSETS.map(a => { const s = summ(oos.filter(r => r.longAsset === a).map(r => r.pnl), `${name}-oos-${a}`); return { asset: a, N: s.N, meanPct: s.meanPct } })
	const quarters = [...new Set(rs.map(r => r.quarter))].sort()
	const perQuarter = quarters.map(q => { const s = summ(rs.filter(r => r.quarter === q).map(r => r.pnl), `${name}-q-${q}`); return { quarter: q, N: s.N, meanPct: s.meanPct, ci: s.ci } }).filter(r => r.N > 0)
	const qElig = perQuarter.filter(r => r.N >= 10), qPos = qElig.filter(r => (r.meanPct ?? 0) > 0).length
	return { full: summ(rs.map(r => r.pnl), `${name}-full`), train: summ(train.map(r => r.pnl), `${name}-train`), oos: summ(oos.map(r => r.pnl), `${name}-oos`), breadthByLongAssetOOS, perQuarter, quartersEligible: qElig.length, quartersPositive: qPos }
}

const arms = { 'signal-gated-top1': buildArm(gatedRows, 'gated'), 'momentum-only': buildArm(momoRows, 'momo') }
const n2 = (x: any) => x == null ? 'n/a' : (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(3) : String(x))

console.log(`\n===== D5-rank — top-1 vs аутсайдер, относит. импульс (H=${H}) =====`)
console.log(`gated сделок: ${gatedRows.length}; momentum-only сделок: ${momoRows.length}`)
if (skipped.length) console.log(`Пропущено кэшей: ${skipped.join(', ')}`)
console.log(`\n----- meanReturn %/сделку -----`)
const table: any[] = []
for (const [name, a] of Object.entries(arms)) for (const split of ['train', 'oos'] as const) { const s = (a as any)[split]; table.push({ arm: name, split, N: s.N, meanPct: n2(s.meanPct), CIlo: n2(s.ci[0]), CIhi: n2(s.ci[1]), posRate: n2(s.posRate) }) }
console.table(table)
console.log(`\n----- per-quarter (N>=10) -----`)
for (const [name, a] of Object.entries(arms)) console.log(`  ${name}: Q>=10 ${(a as any).quartersEligible}, из них +: ${(a as any).quartersPositive}`)
console.log(`\n----- breadth OOS (по long-ноге) -----`)
for (const [name, a] of Object.entries(arms)) { console.log(`  ${name}:`); console.table((a as any).breadthByLongAssetOOS.map((b: any) => ({ asset: b.asset, N: b.N, meanPct: n2(b.meanPct) }))) }

writeFileSync(resolve('ci-results/cross-section-d5-rank.json'), JSON.stringify({
	generatedAt: new Date().toISOString(),
	protocol: 'D5-rank-relative-momentum-top1-1.0 (variant A: strength=relative momentum over H bars; long leader / short laggard; signal-gated vs momentum-only control)',
	preregistration: {
		universe: ASSETS, timeframes: TIMEFRAMES, horizonBars: H, momentumLookbackBars: H,
		strength: 'relative momentum = past-H-bar return (causal); ranking by past return (basket subtraction is rank-preserving)',
		arms: { 'signal-gated-top1': 'take only if signaled coin is the extreme in signal direction; long leader / short laggard', 'momentum-only': 'control: long leader / short laggard at each signal-clock, ignoring signal side/asset' },
		topK: '1 (leader) vs 1 (laggard)', costs: '4×7bps (2 legs); funding omitted', metric: 'return % per trade',
		trainFraction: TRAIN_FRACTION, bootstrap: `${BOOTSTRAP_SAMPLES} resamples, seed ${BOOTSTRAP_SEED}`,
		note: '§2.1: H и издержки штатные, метрика силы фикс. (past-H return), НЕ свипается. §2.3: src не тронут. ⚠ top-k, окно импульса, определение силы — уточняет автор.',
	},
	sources, skipped, gatedTrades: gatedRows.length, momoTrades: momoRows.length, arms,
}, null, 2))
console.log(`\nWrote ci-results/cross-section-d5-rank.json`)
