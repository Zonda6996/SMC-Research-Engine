/**
 * D6-multitf — TERMINAL REVEAL (одноразовый): один каскад (окно 8ч) — торговля на любом ТФ.
 *
 * Протокол: ci-results/d6-multitf-preregistration.md (FROZEN, SHA df981df1…).
 * Событие на ТФ: ΔOI(8ч) ≤ −15% И ΔP(8ч) ≤ −5%, gap 8ч; LONG next-open.
 * Стоп: flushLow(8ч на ТФ) − 0.5×ATR200(ТФ), стоп первым. Выход: reclaim close ≥ close(8ч назад)
 * или таймаут close[entry+72ч/ТФ−1]. 12 co-primary рук: 6 ТФ × {STANDARD, SAFE}.
 * Net 5bps/сторону + фактический funding. UTC-day cluster bootstrap CI95, 10k, seed 25082026.
 * Power gate: в каждой STANDARD-руке ≥100 событий. Лучшая рука: среди GO с breadth ≥9/12 —
 * max CI-low. In-sample оговорка — в prereg. Терминально.
 *
 * Prereg SHA-256: df981df10ab13ac0b75a81baf21ce25e060c2dcfe750fb21a507eb0247a7b419
 * Manifest SHA-256: 8e172fc4a0f41b463e305ab7a37e334c70d4205bf26fecd698ec86e82ee250b0
 * Запуск: npx tsx ci/research/runD6MultiTfReveal.ts
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { alignArchiveMetrics, fetchArchiveMetrics } from '../../tools/shared/archiveMetrics.js'
import { arrowAtr200 } from '../../src/core/signals/ArrowSignalEngine.js'

const PREREG_PATH = 'ci-results/d6-multitf-preregistration.md'
const PREREG_SHA256 = 'df981df10ab13ac0b75a81baf21ce25e060c2dcfe750fb21a507eb0247a7b419'
const MANIFEST_PATH = 'data/d6-multitf/manifest.json'
const MANIFEST_SHA256 = '8e172fc4a0f41b463e305ab7a37e334c70d4205bf26fecd698ec86e82ee250b0'
const DATA_DIR = 'data/d6-multitf'
const OUT_JSON = 'ci-results/d6-multitf-results.json'
const OUT_MD = 'ci-results/d6-multitf-results.md'
const HOUR = 3_600_000
const WINDOW_HOURS = 8
const GAP_HOURS = 8
const HOLD_HOURS = 72
const ROUND_TRIP_COST = 0.001
const SAMPLES = 10_000
const SEED = 25_082_026
const POWER_GATE = 100
const BREADTH_MIN = 9
const TF_MS: Record<string, number> = { '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000 }
const TFS = ['5m', '15m', '30m', '1h', '2h', '4h'] as const
const MODES = [
	{ id: 'STANDARD', oiDrop: -0.15, priceDrop: -0.05 },
	{ id: 'SAFE', oiDrop: -0.2, priceDrop: -0.05 },
] as const

const fileHash = (p: string): string => createHash('sha256').update(readFileSync(resolve(p))).digest('hex')
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

interface TradeStat { v: number; grossV: number; symbol: string; day: string; outcome: string }

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
	const manifest = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8')) as { symbols: Array<{ symbol: string; fundingFile: string; fundingSha256: string; tf: Record<string, { file: string; sha256: string }> }> }

	interface Loaded { symbol: string; funding: Array<{ timestamp: number; rate: number; markPrice: number }>; perTf: Record<string, { candles: Candle[]; oi: Array<number | null>; atr200: number[] }> }
	const loaded: Loaded[] = []
	for (const entry of manifest.symbols) {
		if (fileHash(resolve(DATA_DIR, entry.fundingFile)) !== entry.fundingSha256) throw new Error(`${entry.symbol}: funding hash`)
		const funding = JSON.parse(readFileSync(resolve(DATA_DIR, entry.fundingFile), 'utf8')) as Array<{ timestamp: number; rate: number; markPrice: number }>
		const perTf: Loaded['perTf'] = {}
		for (const tf of TFS) {
			const f = entry.tf[tf]!
			if (fileHash(resolve(DATA_DIR, f.file)) !== f.sha256) throw new Error(`${entry.symbol} ${tf}: hash mismatch`)
			const candles = JSON.parse(readFileSync(resolve(DATA_DIR, f.file), 'utf8')) as Candle[]
			const points = await fetchArchiveMetrics(entry.symbol, candles[0]!.timestamp, candles[candles.length - 1]!.timestamp + TF_MS[tf]!)
			perTf[tf] = { candles, oi: alignArchiveMetrics(points, candles).oi, atr200: arrowAtr200(candles) }
		}
		loaded.push({ symbol: entry.symbol, funding, perTf })
		console.log(`${entry.symbol}: все ТФ загружены`)
	}

	type ArmId = `${(typeof TFS)[number]}|${(typeof MODES)[number]['id']}`
	const ARM_IDS: ArmId[] = TFS.flatMap((tf) => MODES.map((m) => `${tf}|${m.id}` as ArmId))
	const MODE_BY_ID = new Map(MODES.map((m) => [m.id, m]))
	const results = new Map<ArmId, { rows: TradeStat[]; excludedNoHorizon: number }>()
	for (const id of ARM_IDS) results.set(id, { rows: [], excludedNoHorizon: 0 })

	for (const item of loaded) {
		for (const tf of TFS) {
			const tfMs = TF_MS[tf]!
			const windowBars = Math.floor(WINDOW_HOURS * HOUR / tfMs)
			const gapBars = Math.floor(GAP_HOURS * HOUR / tfMs)
			const holdBars = Math.floor(HOLD_HOURS * HOUR / tfMs)
			const { candles, oi, atr200 } = item.perTf[tf]!
			const closes = candles.map((c) => c.close)
			for (const mode of MODES) {
				const bucket = results.get(`${tf}|${mode.id}` as ArmId)!
				let last = -Infinity
				for (let i = windowBars; i + 1 < candles.length; i++) {
					const now = oi[i], past = oi[i - windowBars]!
					if (now == null || past == null || past <= 0) continue
					if (!(now / past - 1 <= mode.oiDrop && closes[i]! / closes[i - windowBars]! - 1 <= mode.priceDrop)) continue
					if (i - last < gapBars) continue
					last = i
					const atr = atr200[i]
					if (!Number.isFinite(atr) || atr! <= 0) continue
					const entryIdx = i + 1
					if (entryIdx + holdBars - 1 > candles.length - 1) { bucket.excludedNoHorizon++; continue }
					const entryBar = candles[entryIdx]!
					const entryOpen = entryBar.open
					const flushLow = Math.min(...candles.slice(i - windowBars + 1, i + 1).map((c) => c.low))
					const stop = flushLow - 0.5 * atr!
					const refLevel = closes[i - windowBars]!
					let exitIdx = entryIdx + holdBars - 1
					let exitPrice = candles[exitIdx]!.close
					let outcome = 'timeout'
					for (let k = entryIdx; k <= exitIdx; k++) {
						const bar = candles[k]!
						if (bar.low <= stop) { exitIdx = k; exitPrice = stop; outcome = 'stop'; break }
						if (k > entryIdx && bar.close >= refLevel) { exitIdx = k; exitPrice = bar.close; outcome = 'reclaim'; break }
					}
					let fundingQuote = 0
					for (const f of item.funding) {
						if (f.timestamp < entryBar.timestamp || f.timestamp >= candles[exitIdx]!.timestamp) continue
						fundingQuote += -f.rate * f.markPrice
					}
					const priceRet = exitPrice / entryOpen - 1
					bucket.rows.push({ v: priceRet + fundingQuote / entryOpen - ROUND_TRIP_COST, grossV: priceRet + fundingQuote / entryOpen, symbol: item.symbol, day: dayKey(entryBar.timestamp), outcome })
				}
			}
		}
	}

	const armResults = new Map<ArmId, ArmResult & { grossMean: number | null; excludedNoHorizon: number }>()
	for (const id of ARM_IDS) {
		const bucket = results.get(id)!
		armResults.set(id, { ...evaluate(bucket.rows, loaded.length), grossMean: bucket.rows.length ? sum(bucket.rows.map((r) => r.grossV)) / bucket.rows.length : null, excludedNoHorizon: bucket.excludedNoHorizon })
		console.log(`${id}: N=${armResults.get(id)!.n} mean=${fmt(armResults.get(id)!.mean! * 100, 3)}% CI=[${fmt(armResults.get(id)!.ci95.lower * 100, 3)}; ${fmt(armResults.get(id)!.ci95.upper * 100, 3)}]% ${armResults.get(id)!.verdict}`)
	}

	const linePowerOk = ARM_IDS.filter((id) => id.includes('|STANDARD')).every((id) => armResults.get(id)!.n >= POWER_GATE)
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
		studyId: 'd6-multitf',
		generatedAt: new Date().toISOString(),
		lineVerdict,
		bestArmFrozenRule: 'among GO arms with breadth>=9/12 pick highest CI-lower',
		bestArm,
		preregistrationSha256: PREREG_SHA256,
		manifestSha256: MANIFEST_SHA256,
		universe: loaded.map((l) => l.symbol),
		arms: Object.fromEntries(ARM_IDS.map((id) => [id, armResults.get(id)])),
	}, null, 2))

	const md = [
		'# D6-multitf — TERMINAL REVEAL: один каскад — любой ТФ (12 co-primary рук)',
		'',
		`# Вердикт линии: \`${lineVerdict}\`${bestArm ? ` · Лучшая рука по замороженному правилу: **${bestArm.id.replace('|', ' / ')}**` : ''}`,
		'',
		`Событие: каскад 8ч (−15/−5) на ТФ-руках; 12 мажоров; стоп структурный (стоп первым); выход reclaim или 72ч.`,
		'',
		'| ТФ | режим | N | WR | PF | средняя net | CI95 low | CI95 high | breadth | вердикт |',
		'|---|---|---:|---:|---:|---:|---:|---:|---|---|',
		...ARM_IDS.map((id) => {
			const [tf, mode] = id.split('|') as [string, string]
			const a = armResults.get(id)!
			return `| ${tf} | ${mode} | ${a.n} | ${a.wr != null ? (a.wr * 100).toFixed(1) + '%' : '—'} | ${fmt(a.pf ?? Number.NaN, 2)} | ${a.mean != null ? (a.mean * 100).toFixed(3) + '%' : '—'} | ${(a.ci95.lower * 100).toFixed(3)}% | ${(a.ci95.upper * 100).toFixed(3)}% | ${a.breadthPositiveSymbols} | **${a.verdict}** |`
		}),
		'',
		'Все цифры net: 5bps/сторону + фактический funding. Стоп первым; reclaim = close ≥ close(8ч назад).',
		`Power gate: ≥${POWER_GATE} в каждой STANDARD-руке. Лучшая рука: GO + breadth ≥${BREADTH_MIN}/12 → max CI-low.`,
		'⚠ In-sample: правило и окно из census-карт на этой же истории (prereg). Независимое подтверждение — форвард/Б.',
		'После reveal мажоры сожжены для D6-мульти-ТФ.',
		'',
		`Prereg \`${PREREG_SHA256}\`; manifest \`${MANIFEST_SHA256}\`; seed ${SEED}.`,
	]
	writeFileSync(resolve(OUT_MD), md.join('\n'))
	console.log(`\nLINE VERDICT: ${lineVerdict}${bestArm ? ` | BEST: ${bestArm.id}` : ''}`)
	console.log('Записано: ci-results/d6-multitf-results.{json,md}')
}

void main()
