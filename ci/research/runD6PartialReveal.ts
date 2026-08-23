/**
 * D6-partial — TERMINAL REVEAL (одноразовый): частички и безубыток против контроля.
 *
 * Протокол: ci-results/d6-partial-preregistration.md (FROZEN, SHA 8e2afcd6…).
 * Событие: ΔOI_8h≤−15% И ΔP_8h≤−5% → LONG next-open, gap 8, 12 мажоров (data/d6-partial).
 * База: стоп flushLow−0.5×ATR200 (стоп первым), таймаут close[entry+71].
 * Руки co-primary: C-H72 / P1R / P1R-BE / P15R / P15R-BE (частичка 50%, TP = entryOpen + k×riskDist;
 * BE: после бара касания стоп остатка → entryOpen, со следующего бара).
 * Net: вход 5bps + выходные колена 5bps + funding (вес 1.0 до бара частички, 0.5 с бара частички).
 * UTC-day cluster bootstrap CI95, 10k, seed 25082026; power gate ≥100; лучшая рука:
 * среди GO с breadth ≥9/12 — max CI-low. MFE-диагностика на контроле. Терминально.
 *
 * Prereg SHA-256: 8e2afcd6deeae676051279653db1852678e04c1cc7d472850c4c7f5122089d5b
 * Manifest SHA-256: ffbc2f36fa25b0ae903a55c105ad6a46f0f13c3102b243ab179fc843c067403c
 * Запуск: npx tsx ci/research/runD6PartialReveal.ts
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { alignArchiveMetrics, fetchArchiveMetrics } from '../../tools/shared/archiveMetrics.js'
import { arrowAtr200 } from '../../src/core/signals/ArrowSignalEngine.js'

const PREREG_PATH = 'ci-results/d6-partial-preregistration.md'
const PREREG_SHA256 = '8e2afcd6deeae676051279653db1852678e04c1cc7d472850c4c7f5122089d5b'
const MANIFEST_PATH = 'data/d6-partial/manifest.json'
const MANIFEST_SHA256 = 'ffbc2f36fa25b0ae903a55c105ad6a46f0f13c3102b243ab179fc843c067403c'
const DATA_DIR = 'data/d6-partial'
const OUT_JSON = 'ci-results/d6-partial-results.json'
const OUT_MD = 'ci-results/d6-partial-results.md'
const HOUR = 3_600_000
const WINDOW_BARS = 8
const OI_DROP = -0.15
const PRICE_DROP = -0.05
const GAP_BARS = 8
const HOLD_BARS = 72
const PARTIAL_FRACTION = 0.5
const FEE_SIDE = 0.0005
const SAMPLES = 10_000
const SEED = 25_082_026
const POWER_GATE = 100
const BREADTH_MIN = 9
const MFE_THRESHOLDS_R = [1, 1.5, 2, 3] as const

interface ManifestSymbol { symbol: string; candleFile: string; candleSha256: string; fundingFile: string; fundingSha256: string }
interface SettledFunding { timestamp: number; rate: number; markPrice: number }

const fileHash = (path: string): string => createHash('sha256').update(readFileSync(resolve(path))).digest('hex')
const dayKey = (x: number): string => new Date(x).toISOString().slice(0, 10)
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

interface TradeStat { v: number; grossV: number; symbol: string; day: string; outcome: string; mfeR: number | null }

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

async function main(): Promise<void> {
	for (const [path, expected] of [[PREREG_PATH, PREREG_SHA256], [MANIFEST_PATH, MANIFEST_SHA256]] as const) {
		if (fileHash(path) !== expected) throw new Error(`Immutable hash mismatch: ${path}`)
	}
	const manifest = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8')) as { symbols: ManifestSymbol[] }

	interface Loaded { symbol: string; candles: Candle[]; oi: Array<number | null>; atr200: number[]; funding: SettledFunding[] }
	const loaded: Loaded[] = []
	for (const entry of manifest.symbols) {
		if (fileHash(resolve(DATA_DIR, entry.candleFile)) !== entry.candleSha256) throw new Error(`${entry.symbol}: candle hash mismatch`)
		if (fileHash(resolve(DATA_DIR, entry.fundingFile)) !== entry.fundingSha256) throw new Error(`${entry.symbol}: funding hash mismatch`)
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

	type ArmId = 'C-H72' | 'P1R' | 'P1R-BE' | 'P15R' | 'P15R-BE'
	const ARM_IDS: ArmId[] = ['C-H72', 'P1R', 'P1R-BE', 'P15R', 'P15R-BE']
	const TP_MULT: Record<ArmId, number | null> = { 'C-H72': null, 'P1R': 1, 'P1R-BE': 1, 'P15R': 1.5, 'P15R-BE': 1.5 }
	const BE_ENABLED: Record<ArmId, boolean> = { 'C-H72': false, 'P1R': false, 'P1R-BE': true, 'P15R': false, 'P15R-BE': true }
	const results = new Map<ArmId, { rows: TradeStat[]; excludedNoHorizon: number }>()
	for (const id of ARM_IDS) results.set(id, { rows: [], excludedNoHorizon: 0 })

	for (const ev of events) {
		const item = loaded.find((l) => l.symbol === ev.symbol)!
		const i = ev.index
		const entryIdx = i + 1
		const entryBar = item.candles[entryIdx]!
		const entryOpen = entryBar.open
		const atr = item.atr200[i]
		if (!Number.isFinite(atr) || atr! <= 0) continue
		const flushLow = Math.min(...item.candles.slice(i - WINDOW_BARS + 1, i + 1).map((c) => c.low))
		const stopLevel = flushLow - 0.5 * atr!
		const riskDist = entryOpen - stopLevel
		const lastIdx = item.candles.length - 1

		for (const id of ARM_IDS) {
			const bucket = results.get(id)!
			if (entryIdx + HOLD_BARS - 1 > lastIdx) { bucket.excludedNoHorizon++; continue }
			const tpLevel = TP_MULT[id] != null ? entryOpen + TP_MULT[id]! * riskDist : null
			let currentStop = stopLevel
			let beArmed = false
			let partialTaken = false
			let partialIdx: number | null = null
			let exitIdx = entryIdx + HOLD_BARS - 1
			let remainderExit = item.candles[exitIdx]!.close
			let outcome = 'timeout'
			let mfeR: number | null = id === 'C-H72' ? 0 : null
			for (let k = entryIdx; k <= exitIdx; k++) {
				const bar = item.candles[k]!
				if (mfeR != null) mfeR = Math.max(mfeR, (bar.high - entryOpen) / riskDist)
				if (bar.low <= currentStop) {
					exitIdx = k
					remainderExit = currentStop
					outcome = beArmed ? 'be-stop' : partialTaken ? 'post-partial-stop' : 'stop'
					break
				}
				if (tpLevel != null && !partialTaken && bar.high >= tpLevel) {
					partialTaken = true
					partialIdx = k
				}
				if (BE_ENABLED[id] && partialTaken && !beArmed && k < exitIdx) {
					beArmed = true
					currentStop = entryOpen
				}
			}
			const remainderFraction = partialTaken ? 1 - PARTIAL_FRACTION : 1
			let fundingQuote = 0
			for (const f of item.funding) {
				const startTs = entryBar.timestamp
				const endTs = item.candles[exitIdx]!.timestamp
				if (f.timestamp < startTs || f.timestamp >= endTs) continue
				const weight = partialTaken && partialIdx != null && f.timestamp >= item.candles[partialIdx]!.timestamp ? remainderFraction : 1
				fundingQuote += -f.rate * f.markPrice * weight
			}
			const remainderRet = remainderExit / entryOpen - 1
			const partialRet = partialTaken && tpLevel != null ? tpLevel / entryOpen - 1 : null
			const priceRet = (partialTaken && partialRet != null ? PARTIAL_FRACTION * partialRet + remainderFraction * remainderRet : remainderRet)
			bucket.rows.push({ v: priceRet + fundingQuote / entryOpen - 2 * FEE_SIDE, grossV: priceRet + fundingQuote / entryOpen, symbol: ev.symbol, day: dayKey(entryBar.timestamp), outcome, mfeR: id === 'C-H72' ? mfeR : null })
		}
	}

	const armResults = new Map<ArmId, ArmResult & { grossMean: number | null; excludedNoHorizon: number }>()
	for (const id of ARM_IDS) {
		const bucket = results.get(id)!
		armResults.set(id, { ...evaluate(bucket.rows, loaded.length), grossMean: bucket.rows.length ? sum(bucket.rows.map((r) => r.grossV)) / bucket.rows.length : null, excludedNoHorizon: bucket.excludedNoHorizon })
		console.log(`${id}: N=${armResults.get(id)!.n} mean=${fmt(armResults.get(id)!.mean! * 100, 3)}% CI=[${fmt(armResults.get(id)!.ci95.lower * 100, 3)}; ${fmt(armResults.get(id)!.ci95.upper * 100, 3)}]% ${armResults.get(id)!.verdict}`)
	}

	const controlRows = results.get('C-H72')!.rows.filter((r) => r.mfeR != null)
	const mfeDiagnostics = {
		arm: 'C-H72',
		n: controlRows.length,
		note: 'доля сделок с максимальным благоприятным ходом (high от entryOpen) ≥ порога до выхода; диагностическая метрика',
		thresholds: MFE_THRESHOLDS_R.map((thr) => ({
			r: thr,
			count: controlRows.filter((row) => row.mfeR! >= thr).length,
			share: controlRows.length ? controlRows.filter((row) => row.mfeR! >= thr).length / controlRows.length : null,
		})),
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
		studyId: 'd6-partial',
		generatedAt: new Date().toISOString(),
		lineVerdict,
		bestArmFrozenRule: 'among GO arms with breadth>=9/12 pick highest CI-lower',
		bestArm,
		preregistrationSha256: PREREG_SHA256,
		manifestSha256: MANIFEST_SHA256,
		eventsTotal: events.length,
		universe: loaded.map((l) => l.symbol),
		mfeDiagnostics,
		arms: Object.fromEntries(ARM_IDS.map((id) => [id, armResults.get(id)])),
	}, null, 2))

	const md = [
		'# D6-partial — TERMINAL REVEAL: частички и безубыток против контроля (5 co-primary рук)',
		'',
		`# Вердикт линии: \`${lineVerdict}\`${bestArm ? ` · Лучшая рука по замороженному правилу: **${bestArm.id}**` : ''}`,
		'',
		`Событий: ${events.length} на 12 мажорах (${loaded.map((l) => l.symbol.replace('USDT', '')).join(', ')}).`,
		'',
		'| рука | частичка | безубыток | N | WR | PF | средняя net | CI95 low | CI95 high | breadth | вердикт |',
		'|---|---|---|---:|---:|---:|---:|---:|---:|---|---|',
		...ARM_IDS.map((id) => {
			const a = armResults.get(id)!
			const take = TP_MULT[id] != null ? `50% @+${TP_MULT[id]}R` : 'нет'
			return `| ${id} | ${take} | ${BE_ENABLED[id] ? 'да' : 'нет'} | ${a.n} | ${a.wr != null ? (a.wr * 100).toFixed(1) + '%' : '—'} | ${fmt(a.pf ?? Number.NaN, 2)} | ${a.mean != null ? (a.mean * 100).toFixed(3) + '%' : '—'} | ${(a.ci95.lower * 100).toFixed(3)}% | ${(a.ci95.upper * 100).toFixed(3)}% | ${a.breadthPositiveSymbols} | **${a.verdict}** |`
		}),
		'',
		'Исходы сделок:',
		'',
		'| рука | stop | be-stop | post-partial-stop | timeout | исключено без горизонта | gross mean |',
		'|---|---:|---:|---:|---:|---:|---:|',
		...ARM_IDS.map((id) => {
			const a = armResults.get(id)!
			const o = a.outcomes
			return `| ${id} | ${o['stop'] ?? 0} | ${o['be-stop'] ?? 0} | ${o['post-partial-stop'] ?? 0} | ${o['timeout'] ?? 0} | ${a.excludedNoHorizon} | ${a.grossMean != null ? (a.grossMean * 100).toFixed(3) + '%' : '—'} |`
		}),
		'',
		'## MFE-диагностика (контрольная рука C-H72)',
		'',
		'| порог | сделок | доля |',
		'|---|---:|---:|',
		...MFE_THRESHOLDS_R.map((thr) => {
			const count = controlRows.filter((row) => row.mfeR! >= thr).length
			return `| ≥${thr}R | ${count} | ${controlRows.length ? (count / controlRows.length * 100).toFixed(1) + '%' : '—'} |`
		}),
		'',
		'Все цифры net: 5bps/side (вход + колена) + фактический funding за удержание остатка.',
		'Внутри бара: стоп первым, частичка вторым, безубыток — со следующего бара после касания (prereg §2).',
		`Правило «лучшая рука»: GO + breadth ≥${BREADTH_MIN}/12 → максимальный CI-low. Power gate: ≥${POWER_GATE}.`,
		'⚠ Событие (−15%/−5%) выбрано по census-карте на этой же истории (in-sample): сравнение рук валидно,',
		'подтверждение уровня сигнала — вселенная Б / paper-forward. После reveal вселенная сожжена для D6-класса.',
		'',
		`Prereg \`${PREREG_SHA256}\`; manifest \`${MANIFEST_SHA256}\`; seed ${SEED}.`,
	]
	writeFileSync(resolve(OUT_MD), md.join('\n'))
	console.log(`\nLINE VERDICT: ${lineVerdict}${bestArm ? ` | BEST: ${bestArm.id} (CI-low ${(bestArm.ciLow * 100).toFixed(3)}%)` : ''}`)
	console.log(`MFE (C-H72): ${MFE_THRESHOLDS_R.map((thr) => `≥${thr}R: ${controlRows.filter((row) => row.mfeR! >= thr).length}/${controlRows.length}`).join('; ')}`)
	console.log('Записано: ci-results/d6-partial-results.{json,md}')
}

void main()
