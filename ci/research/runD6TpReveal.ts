/**
 * D6-tp — TERMINAL REVEAL (одноразовый): фиксированные тейки по R против контроля.
 *
 * Протокол: ci-results/d6-tp-preregistration.md (FROZEN). Событие ИДЕНТИЧНО d6-mgmt:
 * ΔOI_8h≤−15% И ΔP_8h≤−3% → LONG next-open, gap 8. Стоп структурный flushLow−0.5×ATR200,
 * консервативный порядок в баре: СТОП ПЕРВЫМ, затем тейк, затем таймаут close[entry+71].
 * Руки: 1 C-H72 (контроль, без тейка) · 2 TP1R-fullfix · 3 TP2R · 4 TP3R;
 * TP(k) = entryOpen + k×riskDist, riskDist = entryOpen − stopLevel.
 * Диагностика MFE на КОНТРОЛЬНОЙ руке: доли сделок с ходом ≥1R/≥1.5R/≥2R/≥3R до выхода
 * (диагностическая метрика, на гейты не влияет).
 * Net % fixed-notional: 5bps/side (ROUND_TRIP=0.001) + фактический funding; gross@0 дескриптивно.
 * Сделки без полного горизонта исключаются механически со счётом.
 * UTC-day cluster bootstrap CI95, 10k, seed 25082026; power gate ≥100 событий;
 * «лучшая рука»: среди GO с breadth ≥9/12 — максимальный CI-low (как в d6-mgmt §4). Терминально.
 *
 * Prereg SHA-256: 6b6f7465226d413dc4afd7377e410de9b14bb0ac648c4c50ebde83ce347b4862
 * Запуск: npx tsx ci/research/runD6TpReveal.ts   (метрики кэшируются, докачивает)
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { alignArchiveMetrics, fetchArchiveMetrics } from '../../tools/shared/archiveMetrics.js'
import { arrowAtr200 } from '../../src/core/signals/ArrowSignalEngine.js'

const PREREG_PATH = 'ci-results/d6-tp-preregistration.md'
const PREREG_SHA256 = '6b6f7465226d413dc4afd7377e410de9b14bb0ac648c4c50ebde83ce347b4862'
const MANIFEST_PATH = 'data/d6-tp/manifest.json'
const MANIFEST_SHA256 = 'e8eb549a25de84c3922951eead362cce9922ccbd37e5bbaf1ef32901dc2855bd'
const DATA_DIR = 'data/d6-tp'
const OUT_JSON = 'ci-results/d6-tp-results.json'
const OUT_MD = 'ci-results/d6-tp-results.md'
const HOUR = 3_600_000
const WINDOW_BARS = 8
const OI_DROP = -0.15
const PRICE_DROP = -0.03
const GAP_BARS = 8
const HOLD_BARS = 72
const ROUND_TRIP_COST = 0.001
const SAMPLES = 10_000
const SEED = 25_082_026
const POWER_GATE = 100
const BREADTH_MIN = 9
const MFE_THRESHOLDS_R = [1, 1.5, 2, 3] as const

interface ManifestSymbol { symbol: string; candleFile: string; candleSha256: string; fundingFile: string }
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

	type ArmId = 'C-H72' | 'TP1R-fullfix' | 'TP2R' | 'TP3R'
	const ARM_IDS: ArmId[] = ['C-H72', 'TP1R-fullfix', 'TP2R', 'TP3R']
	const TP_MULT: Record<ArmId, number | null> = { 'C-H72': null, 'TP1R-fullfix': 1, 'TP2R': 2, 'TP3R': 3 }
	const results = new Map<ArmId, { rows: TradeStat[]; excludedNoHorizon: number }>()
	for (const id of ARM_IDS) results.set(id, { rows: [], excludedNoHorizon: 0 })

	for (const ev of events) {
		const item = loaded.find((l) => l.symbol === ev.symbol)!
		const i = ev.index
		const entryIdx = i + 1
		const entryBar = item.candles[entryIdx]!
		const entryOpen = entryBar.open
		const atr = item.atr200[i]
		if (!Number.isFinite(atr) || atr <= 0) continue
		const flushLow = Math.min(...item.candles.slice(i - WINDOW_BARS + 1, i + 1).map((c) => c.low))
		const stopLevel = flushLow - 0.5 * atr!
		const riskDist = entryOpen - stopLevel
		const lastIdx = item.candles.length - 1

		for (const id of ARM_IDS) {
			const bucket = results.get(id)!
			if (entryIdx + HOLD_BARS - 1 > lastIdx) { bucket.excludedNoHorizon++; continue }
			const tpLevel = TP_MULT[id] != null ? entryOpen + TP_MULT[id]! * riskDist : null
			let exitIdx = entryIdx + HOLD_BARS - 1
			let exitPrice = item.candles[exitIdx]!.close
			let outcome = 'timeout72'
			const trackMfe = id === 'C-H72'
			let mfeR: number | null = null
			for (let k = entryIdx; k <= exitIdx; k++) {
				const bar = item.candles[k]!
				if (trackMfe) {
					const exc = (bar.high - entryOpen) / riskDist
					mfeR = mfeR == null ? exc : Math.max(mfeR, exc)
				}
				if (bar.low <= stopLevel) { exitIdx = k; exitPrice = stopLevel; outcome = 'stop'; break }
				if (tpLevel != null && bar.high >= tpLevel) { exitIdx = k; exitPrice = tpLevel; outcome = `tp${TP_MULT[id]}r`; break }
			}
			let fundingQuote = 0
			for (const f of item.funding) {
				const startTs = entryBar.timestamp
				const endTs = item.candles[exitIdx]!.timestamp
				if (f.timestamp < startTs || f.timestamp >= endTs) continue
				fundingQuote += -f.rate * f.markPrice
			}
			const priceRet = exitPrice / entryOpen - 1
			bucket.rows.push({ v: priceRet + fundingQuote / entryOpen - ROUND_TRIP_COST, grossV: priceRet + fundingQuote / entryOpen, symbol: ev.symbol, day: dayKey(entryBar.timestamp), outcome, mfeR: trackMfe ? mfeR : null })
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
		studyId: 'd6-tp',
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
		'# D6-tp — TERMINAL REVEAL: фиксированные тейки по R против контроля (4 co-primary руки)',
		'',
		`# Вердикт линии: \`${lineVerdict}\`${bestArm ? ` · Лучшая рука по замороженному правилу: **${bestArm.id}**` : ''}`,
		'',
		`Событий: ${events.length} на 12 symbol-fresh символах (${loaded.map((l) => l.symbol.replace('USDT', '')).join(', ')}).`,
		'',
		'| рука | тейк | N | WR | PF | средняя net | CI95 low | CI95 high | breadth | вердикт |',
		'|---|---|---:|---:|---:|---:|---:|---:|---|---|',
		...ARM_IDS.map((id) => {
			const a = armResults.get(id)!
			const take = TP_MULT[id] != null ? `+${TP_MULT[id]}×riskDist` : 'нет'
			return `| ${id} | ${take} | ${a.n} | ${a.wr != null ? (a.wr * 100).toFixed(1) + '%' : '—'} | ${fmt(a.pf ?? Number.NaN, 2)} | ${a.mean != null ? (a.mean * 100).toFixed(3) + '%' : '—'} | ${(a.ci95.lower * 100).toFixed(3)}% | ${(a.ci95.upper * 100).toFixed(3)}% | ${a.breadthPositiveSymbols} | **${a.verdict}** |`
		}),
		'',
		'Исходы сделок:',
		'',
		'| рука | stop | timeout72 | tp1r | tp2r | tp3r | исключено без горизонта | gross mean |',
		'|---|---:|---:|---:|---:|---:|---:|---:|',
		...ARM_IDS.map((id) => {
			const a = armResults.get(id)!
			const o = a.outcomes
			return `| ${id} | ${o['stop'] ?? 0} | ${o['timeout72'] ?? 0} | ${o['tp1r'] ?? 0} | ${o['tp2r'] ?? 0} | ${o['tp3r'] ?? 0} | ${a.excludedNoHorizon} | ${a.grossMean != null ? (a.grossMean * 100).toFixed(3) + '%' : '—'} |`
		}),
		'',
		'## MFE-диагностика (контрольная рука C-H72)',
		'',
		`Ответ на вопрос «сколько доходит до 1.5R»: из ${controlRows.length} контрольных сделок до уровней дошли:`,
		'',
		'| порог | сделок | доля |',
		'|---|---:|---:|',
		...MFE_THRESHOLDS_R.map((thr) => {
			const count = controlRows.filter((row) => row.mfeR! >= thr).length
			return `| ≥${thr}R | ${count} | ${controlRows.length ? (count / controlRows.length * 100).toFixed(1) + '%' : '—'} |`
		}),
		'',
		'Все цифры net: 5bps/side + фактический funding за фактическое удержание; gross@0 дескриптивно.',
		'Внутри бара СТОП проверяется ПЕРВЫМ (консервативно); тейк — лимитное допущение по цене TP; таймаут close[entry+71].',
		`Правило «лучшая рука»: GO + breadth ≥${BREADTH_MIN}/12 → максимальный CI-low. Power gate: ≥${POWER_GATE} событий.`,
		'После reveal вселенная сожжена для D6-класса гипотез; частичные выходы — только будущая preregistration.',
		'',
		`Prereg \`${PREREG_SHA256}\`; manifest \`${MANIFEST_SHA256}\`; seed ${SEED}.`,
	]
	writeFileSync(resolve(OUT_MD), md.join('\n'))
	console.log(`\nLINE VERDICT: ${lineVerdict}${bestArm ? ` | BEST: ${bestArm.id} (CI-low ${(bestArm.ciLow * 100).toFixed(3)}%)` : ''}`)
	console.log(`MFE (C-H72): ${MFE_THRESHOLDS_R.map((thr) => `≥${thr}R: ${controlRows.filter((row) => row.mfeR! >= thr).length}/${controlRows.length}`).join('; ')}`)
	console.log('Записано: ci-results/d6-tp-results.{json,md}')
}

void main()
