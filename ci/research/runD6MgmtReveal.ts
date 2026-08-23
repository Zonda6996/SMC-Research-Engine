/**
 * D6-mgmt — TERMINAL REVEAL (одноразовый): шесть co-primary рук управления каскадной сделки.
 *
 * Протокол: ci-results/d6-mgmt-preregistration.md (+amendment №1: ранг углублён до 80).
 * Событие как в d6-cascade: ΔOI_8h≤−15% И ΔP_8h≤−3% → LONG next-open, gap 8.
 * Руки: 1 H24-nostop · 2 H24-stopStruct(flushLow−0.5ATR) · 3 H24-stopWide(entry−5ATR)
 *       4 Reclaim-stopStruct(close≥refLevel=close[i-8], max72) · 5 H72-stopStruct · 6 H12-stopStruct.
 * Консервативный порядок в баре: СТОП ПЕРВЫМ. Все руки объявлены заранее; правило «лучшая рука»
 * заморожено в prereg §4. Net % @5bps/side + фактический funding; UTC-day cluster CI95,
 * 10k, seed 24082026; power gate ≥100 событий; терминально.
 *
 * Prereg SHA-256: 365f4e8c74651b07f4aa80d1882442440e5bab17bc253239bd5e28450fb57fdd
 * Запуск: npx tsx ci/research/runD6MgmtReveal.ts   (метрики кэшируются, докачивает)
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { alignArchiveMetrics, fetchArchiveMetrics } from '../../tools/shared/archiveMetrics.js'
import { arrowAtr200 } from '../../src/core/signals/ArrowSignalEngine.js'

const PREREG_PATH = 'ci-results/d6-mgmt-preregistration.md'
const PREREG_SHA256 = '365f4e8c74651b07f4aa80d1882442440e5bab17bc253239bd5e28450fb57fdd'
const AMENDMENT1_PATH = 'ci-results/d6-mgmt-amendment-1.md'
const AMENDMENT1_SHA256 = '1004952eb6404c9589b4cced33a296117e5a2928f6f968d55871d78605b84b80'
const MANIFEST_PATH = 'data/d6-mgmt/manifest.json'
const MANIFEST_SHA256 = '5ed29eb914d138349040de555ee7ef4560f3107dd2a9cded21eef243f9cb50d6'
const DATA_DIR = 'data/d6-mgmt'
const OUT_JSON = 'ci-results/d6-mgmt-results.json'
const OUT_MD = 'ci-results/d6-mgmt-results.md'
const HOUR = 3_600_000
const WINDOW_BARS = 8
const OI_DROP = -0.15
const PRICE_DROP = -0.03
const GAP_BARS = 8
const ROUND_TRIP_COST = 0.001
const SAMPLES = 10_000
const SEED = 24_082_026
const POWER_GATE = 100
const BREADTH_MIN = 9

interface ManifestSymbol { symbol: string; candleFile: string; candleSha256: string; fundingFile: string }
interface SettledFunding { timestamp: number; rate: number; markPrice: number }

const fileHash = (path: string): string => createHash('sha256').update(readFileSync(resolve(path))).digest('hex')
const iso = (x: number): string => new Date(x).toISOString()
const dayKey = (x: number): string => iso(x).slice(0, 10)
const fmt = (x: number | null | undefined, d = 5): string => x == null || !Number.isFinite(x) ? 'n/a' : x.toFixed(d)
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)

function rng(seed: number): () => number {
	let x = seed >>> 0
	return () => {
		x += 0x6d2b79f5
		let t = x
		t = Math.imul(t ^ t >>> 15, t | 1)
		t ^= t + Math.imul(t ^ t >>> 7, t | 61)
		return ((t ^ t >>> 14) >>> 0) / 4_294_967_296
	}
}

function dayClusterMeanCi(rows: ReadonlyArray<{ day: string; v: number }>): { lower: number; median: number; upper: number } {
	const groups = new Map<string, number[]>()
	for (const row of rows) {
		const g = groups.get(row.day) ?? []
		g.push(row.v)
		groups.set(row.day, g)
	}
	const days = [...groups.keys()].sort()
	if (!days.length) return { lower: NaN, median: NaN, upper: NaN }
	const random = rng(SEED)
	const means: number[] = []
	for (let s = 0; s < SAMPLES; s++) {
		let total = 0
		let count = 0
		for (let i = 0; i < days.length; i++) {
			for (const v of groups.get(days[Math.floor(random() * days.length)]!)!) { total += v; count++ }
		}
		if (count) means.push(total / count)
	}
	means.sort((a, b) => a - b)
	const q = (p: number): number => means[Math.min(means.length - 1, Math.floor(p * means.length))]!
	return { lower: q(0.025), median: q(0.5), upper: q(0.975) }
}

interface TradeStat { v: number; grossV: number; symbol: string; day: string; outcome: string }

function evaluate(rows: readonly TradeStat[], universeSize: number): ArmResult {
	const values = rows.map((r) => r.v).filter(Number.isFinite)
	const gains = sum(values.filter((x) => x > 0))
	const losses = -sum(values.filter((x) => x < 0))
	let equity = 0
	let peak = 0
	let dd = 0
	for (const v of values) { equity += v; peak = Math.max(peak, equity); dd = Math.max(dd, peak - equity) }
	const bySymbol = new Map<string, number>()
	for (const r of rows) bySymbol.set(r.symbol, (bySymbol.get(r.symbol) ?? 0) + r.v)
	const positiveSymbols = [...bySymbol.values()].filter((x) => x > 0).length
	const ci95 = dayClusterMeanCi(rows.map((r) => ({ day: r.day, v: r.v })))
	return {
		n: values.length,
		mean: values.length ? sum(values) / values.length : null,
		total: sum(values),
		pf: losses > 0 ? gains / losses : gains > 0 ? Number.POSITIVE_INFINITY : null,
		wr: values.length ? values.filter((x) => x > 0).length / values.length : null,
		maxDd: dd,
		breadthPositiveSymbols: `${positiveSymbols}/${universeSize}`,
		outcomes: rows.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] ?? 0) + 1 }), {}),
		ci95,
		gatePower: values.length >= POWER_GATE,
		verdict: values.length < POWER_GATE ? 'INCONCLUSIVE DATA' : ci95.lower > 0 ? 'GO' : 'KILL',
	}
}

interface ArmResult {
	n: number
	mean: number | null
	total: number
	pf: number | null
	wr: number | null
	maxDd: number
	breadthPositiveSymbols: string
	outcomes: Record<string, number>
	ci95: { lower: number; median: number; upper: number }
	gatePower: boolean
	verdict: 'GO' | 'KILL' | 'INCONCLUSIVE DATA'
}

async function main(): Promise<void> {
	for (const [path, expected] of [[PREREG_PATH, PREREG_SHA256], [AMENDMENT1_PATH, AMENDMENT1_SHA256], [MANIFEST_PATH, MANIFEST_SHA256]] as const) {
		if (fileHash(path) !== expected) throw new Error(`Immutable hash mismatch: ${path}`)
	}
	const manifest = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8')) as { symbols: ManifestSymbol[] }

	interface Loaded { symbol: string; candles: Candle[]; oi: Array<number | null>; atr200: number[]; funding: SettledFunding[] }
	const loaded: Loaded[] = []
	for (const entry of manifest.symbols) {
		if (fileHash(resolve(DATA_DIR, entry.candleFile)) !== entry.candleSha256) throw new Error(`${entry.symbol}: candle hash mismatch`)
		const candles = JSON.parse(readFileSync(resolve(DATA_DIR, entry.candleFile), 'utf8')) as Candle[]
		const points = await fetchArchiveMetrics(entry.symbol, candles[0]!.timestamp, candles[candles.length - 1]!.timestamp + HOUR)
		const oi = alignArchiveMetrics(points, candles).oi
		const funding = JSON.parse(readFileSync(resolve(DATA_DIR, entry.fundingFile), 'utf8')) as SettledFunding[]
		loaded.push({ symbol: entry.symbol, candles, oi, atr200: arrowAtr200(candles), funding })
		console.log(`${entry.symbol}: баров ${candles.length}, метрик ${points.length}`)
	}

	interface Event { symbol: string; index: number }
	const events: Event[] = []
	for (const item of loaded) {
		const closes = item.candles.map((c) => c.close)
		let lastAdmitted = -Infinity
		for (let i = WINDOW_BARS; i + 1 < item.candles.length; i++) {
			const oiNow = item.oi[i]
			const oiPast = item.oi[i - WINDOW_BARS]!
			if (oiNow == null || oiPast == null || oiPast <= 0) continue
			if (!(oiNow / oiPast - 1 <= OI_DROP && closes[i]! / closes[i - WINDOW_BARS]! - 1 <= PRICE_DROP)) continue
			if (i - lastAdmitted < GAP_BARS) continue
			lastAdmitted = i
			events.push({ symbol: item.symbol, index: i })
		}
	}
	console.log(`\nСобытий всего: ${events.length}`)

	type ArmId = 'H24-nostop' | 'H24-stopStruct' | 'H24-stopWide' | 'Reclaim-stopStruct' | 'H72-stopStruct' | 'H12-stopStruct'
	const ARM_IDS: ArmId[] = ['H24-nostop', 'H24-stopStruct', 'H24-stopWide', 'Reclaim-stopStruct', 'H72-stopStruct', 'H12-stopStruct']
	const results = new Map<ArmId, { rows: TradeStat[]; excludedNoHorizon: number }>()
	for (const id of ARM_IDS) results.set(id, { rows: [], excludedNoHorizon: 0 })

	for (const ev of events) {
		const item = loaded.find((l) => l.symbol === ev.symbol)!
		const i = ev.index
		const entryIdx = i + 1
		const entryBar = item.candles[entryIdx]!
		const entryOpen = entryBar.open
		const flushLow = Math.min(...item.candles.slice(i - WINDOW_BARS + 1, i + 1).map((c) => c.low))
		const atr = item.atr200[i]
		if (!Number.isFinite(atr) || atr <= 0) continue
		const refLevel = item.candles[i - WINDOW_BARS]!.close
		const lastIdx = item.candles.length - 1
		const stops = {
			struct: flushLow - 0.5 * atr,
			wide: entryOpen - 5 * atr,
		}

		const runTrade = (id: ArmId, stopLevel: number | null, horizonBars: number | null, reclaim: boolean): void => {
			const bucket = results.get(id)!
			const exitIdxCap = horizonBars != null ? Math.min(entryIdx + horizonBars - 1, lastIdx) : Math.min(entryIdx + 71, lastIdx)
			if ((horizonBars != null && entryIdx + horizonBars - 1 > lastIdx) || (reclaim && entryIdx + 71 > lastIdx)) {
				bucket.excludedNoHorizon++
				return
			}
			let exitIdx = exitIdxCap
			let exitPrice = item.candles[exitIdxCap]!.close
			let outcome = horizonBars != null ? `h${horizonBars}` : 'reclaim-timeout'
			if (reclaim) outcome = 'timeout72'
			for (let k = entryIdx; k <= exitIdxCap; k++) {
				const bar = item.candles[k]!
				if (stopLevel != null && bar.low <= stopLevel) {
					exitIdx = k
					exitPrice = stopLevel
					outcome = 'stop'
					break
				}
				if (reclaim && bar.close >= refLevel) {
					exitIdx = k
					exitPrice = bar.close
					outcome = 'reclaim'
					break
				}
			}
			let fundingQuote = 0
			for (const f of item.funding) {
				const startTs = entryBar.timestamp
				const endTs = item.candles[exitIdx]!.timestamp
				if (f.timestamp < startTs || f.timestamp >= endTs) continue
				fundingQuote += -f.rate * f.markPrice
			}
			const priceRet = exitPrice / entryOpen - 1
			bucket.rows.push({ v: priceRet + fundingQuote / entryOpen - ROUND_TRIP_COST, grossV: priceRet + fundingQuote / entryOpen, symbol: ev.symbol, day: dayKey(entryBar.timestamp), outcome })
		}

		runTrade('H24-nostop', null, 24, false)
		runTrade('H24-stopStruct', stops.struct, 24, false)
		runTrade('H24-stopWide', stops.wide, 24, false)
		runTrade('Reclaim-stopStruct', stops.struct, null, true)
		runTrade('H72-stopStruct', stops.struct, 72, false)
		runTrade('H12-stopStruct', stops.struct, 12, false)
	}

	const armResults = new Map<ArmId, ArmResult & { grossMean: number | null; excludedNoHorizon: number }>()
	for (const id of ARM_IDS) {
		const bucket = results.get(id)!
		armResults.set(id, { ...evaluate(bucket.rows, loaded.length), grossMean: bucket.rows.length ? sum(bucket.rows.map((r) => r.grossV)) / bucket.rows.length : null, excludedNoHorizon: bucket.excludedNoHorizon })
		console.log(`${id}: N=${armResults.get(id)!.n} mean=${fmt(armResults.get(id)!.mean! * 100, 3)}% CI=[${fmt(armResults.get(id)!.ci95.lower * 100, 3)}; ${fmt(armResults.get(id)!.ci95.upper * 100, 3)}]% ${armResults.get(id)!.verdict}`)
	}

	const linePowerOk = events.length >= POWER_GATE
	const eligibleForBest = ARM_IDS.filter((id) => {
		const a = armResults.get(id)!
		return a.verdict === 'GO' && Number(a.breadthPositiveSymbols.split('/')[0]) >= BREADTH_MIN
	})
	let bestArm: { id: ArmId; ciLow: number } | null = null
	if (linePowerOk && eligibleForBest.length) {
		bestArm = eligibleForBest.map((id) => ({ id, ciLow: armResults.get(id)!.ci95.lower })).sort((a, b) => b.ciLow - a.ciLow)[0]!
	}
	const lineVerdict: 'GO' | 'KILL' | 'INCONCLUSIVE DATA' = !linePowerOk ? 'INCONCLUSIVE DATA' : eligibleForBest.length ? 'GO' : 'KILL'

	writeFileSync(resolve(OUT_JSON), JSON.stringify({
		studyId: 'd6-mgmt',
		generatedAt: new Date().toISOString(),
		lineVerdict,
		bestArmFrozenRule: 'among GO arms with breadth>=9/12 pick highest CI-lower',
		bestArm,
		preregistrationSha256: PREREG_SHA256,
		amendment1Sha256: AMENDMENT1_SHA256,
		manifestSha256: MANIFEST_SHA256,
		eventsTotal: events.length,
		universe: loaded.map((l) => l.symbol),
		arms: Object.fromEntries(ARM_IDS.map((id) => [id, armResults.get(id)])),
	}, null, 2))

	const md = [
		'# D6-mgmt — TERMINAL REVEAL: управление каскадной сделки (6 co-primary рук)',
		'',
		`# Вердикт линии: \`${lineVerdict}\`${bestArm ? ` · Лучшая рука по замороженному правилу: **${bestArm.id}**` : ''}`,
		'',
		`Событий: ${events.length} на 12 symbol-fresh символах (${loaded.map((l) => l.symbol.replace('USDT', '')).join(', ')}).`,
		'',
		'| рука | стоп | выход | N | WR | PF | средняя net | CI95 low | CI95 high | breadth | вердикт |',
		'|---|---|---|---:|---:|---:|---:|---:|---:|---|---|',
		...ARM_IDS.map((id) => {
			const a = armResults.get(id)!
			const meta: Record<ArmId, string> = {
				'H24-nostop': 'нет', 'H24-stopStruct': 'flushLow−0.5ATR', 'H24-stopWide': 'entry−5ATR',
				'Reclaim-stopStruct': 'flushLow−0.5ATR', 'H72-stopStruct': 'flushLow−0.5ATR', 'H12-stopStruct': 'flushLow−0.5ATR',
			}
			const ex: Record<ArmId, string> = {
				'H24-nostop': '24ч', 'H24-stopStruct': '24ч', 'H24-stopWide': '24ч',
				'Reclaim-stopStruct': 'close≥refLevel/max72ч', 'H72-stopStruct': '72ч', 'H12-stopStruct': '12ч',
			}
			return `| ${id} | ${meta[id]} | ${ex[id]} | ${a.n} | ${a.wr != null ? (a.wr * 100).toFixed(1) + '%' : '—'} | ${fmt(a.pf ?? Number.NaN, 2)} | ${a.mean != null ? (a.mean * 100).toFixed(3) + '%' : '—'} | ${(a.ci95.lower * 100).toFixed(3)}% | ${(a.ci95.upper * 100).toFixed(3)}% | ${a.breadthPositiveSymbols} | **${a.verdict}** |`
		}),
		'',
		'Все цифры net: 5bps/side + фактический funding. Стоп проверяется ПЕРВЫМ внутри бара.',
		`Правило «лучшая рука»: GO + breadth ≥${BREADTH_MIN}/12 → максимальный CI-low. Power gate: ≥${POWER_GATE} событий.`,
		'После reveal вселенная сожжена для D6-класса гипотез.',
		'',
		`Prereg \`${PREREG_SHA256}\`; amendment \`${AMENDMENT1_SHA256}\`; manifest \`${MANIFEST_SHA256}\`; seed ${SEED}.`,
	]
	writeFileSync(resolve(OUT_MD), md.join('\n'))
	console.log(`\nLINE VERDICT: ${lineVerdict}${bestArm ? ` | BEST: ${bestArm.id} (CI-low ${(bestArm.ciLow * 100).toFixed(3)}%)` : ''}`)
	console.log('Записано: ci-results/d6-mgmt-results.{json,md}')
}

void main()
