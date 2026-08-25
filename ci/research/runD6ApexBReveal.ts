/**
 * D6-apex-B — TERMINAL REVEAL (одноразовый): три определения «входа в зону Apex» на вселенной Б.
 *
 * Протокол: ci-results/d6-apex-b-preregistration.md (FROZEN). Пул: STANDARD (−15/−5) + SAFE (−20/−5),
 * 1h, 16 мид-капов, окно 8ч, gap 8ч. Классы co-primary: deep (≤greenHi, depth≥0.5) /
 * inner (≤greenHi) / mean (≤mean) — каждый против своего комплемента.
 * Сделка: стоп flushLow(8ч)−0.5×ATR200 (стоп первым), чистый таймаут 72ч, net 5bps + funding.
 * UTC-day cluster bootstrap CI95, 10k, seed 25082026. Вердикт варианта: GO ⇔ lower>0 при N≥100.
 *
 * Prereg SHA-256: (пинован в PREREG_SHA256)
 * Manifest SHA-256: e877614c3b7f55170ba1b73a291226922c46bb13bdafac6a1374c351b1ae6bf4
 * Запуск: npx tsx ci/research/runD6ApexBReveal.ts
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { alignArchiveMetrics, fetchArchiveMetrics } from '../../tools/shared/archiveMetrics.js'
import { arrowAtr200 } from '../../src/core/signals/ArrowSignalEngine.js'
import { computeApexBands } from '../../src/core/signals/ApexEngine.js'

const PREREG_PATH = 'ci-results/d6-apex-b-preregistration.md'
const PREREG_SHA256 = createHash('sha256').update(readFileSync(resolve(PREREG_PATH))).digest('hex')
const MANIFEST_PATH = 'data/d6-apex-b/manifest.json'
const MANIFEST_SHA256 = 'e877614c3b7f55170ba1b73a291226922c46bb13bdafac6a1374c351b1ae6bf4'
const DATA_DIR = 'data/d6-apex-b'
const OUT_JSON = 'ci-results/d6-apex-b-results.json'
const OUT_MD = 'ci-results/d6-apex-b-results.md'
const HOUR = 3_600_000
const WINDOW_BARS = 8
const GAP_BARS = 8
const HOLD_BARS = 72
const ROUND_TRIP_COST = 0.001
const SAMPLES = 10_000
const SEED = 25_082_026

const fileHash = (p: string): string => createHash('sha256').update(readFileSync(resolve(p))).digest('hex')
const dayKey = (x: number): string => new Date(x).toISOString().slice(0, 10)
const pct = (x: number | null, d = 2): string => x == null || !Number.isFinite(x) ? '—' : (x * 100).toFixed(d) + '%'
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

function classDeltaCi(rows: ReadonlyArray<{ day: string; v: number; inClass: boolean }>): { lower: number; upper: number } {
	const days = [...new Set(rows.map((r) => r.day))].sort()
	if (!days.length) return { lower: NaN, upper: NaN }
	const random = rng(SEED)
	const deltas: number[] = []
	for (let s = 0; s < SAMPLES; s++) {
		const cs: number[] = []
		const rs: number[] = []
		for (let i = 0; i < days.length; i++) {
			const pick = days[Math.floor(random() * days.length)]!
			for (const r of rows) if (r.day === pick) (r.inClass ? cs : rs).push(r.v)
		}
		if (cs.length && rs.length) deltas.push(sum(cs) / cs.length - sum(rs) / rs.length)
	}
	if (!deltas.length) return { lower: NaN, upper: NaN }
	deltas.sort((a, b) => a - b)
	return { lower: deltas[Math.floor(0.025 * deltas.length)]!, upper: deltas[Math.floor(0.975 * deltas.length)]! }
}

interface SettledFunding { timestamp: number; rate: number; markPrice: number }
interface EvTrade { mode: string; symbol: string; day: string; v: number; deep: boolean; inner: boolean; meanTouch: boolean }

async function main(): Promise<void> {
	if (fileHash(PREREG_PATH) !== PREREG_SHA256) throw new Error('prereg changed after freeze')
	if (fileHash(MANIFEST_PATH) !== MANIFEST_SHA256) throw new Error('manifest hash mismatch')
	const manifest = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8')) as { symbols: Array<{ symbol: string; candleFile: string; candleSha256: string; fundingFile: string; fundingSha256: string }> }

	const trades: EvTrade[] = []
	for (const entry of manifest.symbols) {
		if (fileHash(resolve(DATA_DIR, entry.candleFile)) !== entry.candleSha256) throw new Error(`${entry.symbol}: candle hash`)
		if (fileHash(resolve(DATA_DIR, entry.fundingFile)) !== entry.fundingSha256) throw new Error(`${entry.symbol}: funding hash`)
		const candles = JSON.parse(readFileSync(resolve(DATA_DIR, entry.candleFile), 'utf8')) as Candle[]
		const points = await fetchArchiveMetrics(entry.symbol, candles[0]!.timestamp, candles[candles.length - 1]!.timestamp + HOUR)
		const oi = alignArchiveMetrics(points, candles).oi
		const atr200 = arrowAtr200(candles)
		const bands = computeApexBands(candles)
		const funding = JSON.parse(readFileSync(resolve(DATA_DIR, entry.fundingFile), 'utf8')) as SettledFunding[]
		const closes = candles.map((c) => c.close)
		for (const mode of [{ id: 'STANDARD', oiDrop: -0.15 }, { id: 'SAFE', oiDrop: -0.2 }]) {
			let last = -Infinity
			for (let i = WINDOW_BARS; i + 1 < candles.length; i++) {
				const now = oi[i], past = oi[i - WINDOW_BARS]!
				if (now == null || past == null || past <= 0) continue
				if (!(now / past - 1 <= mode.oiDrop && closes[i]! / closes[i - WINDOW_BARS]! - 1 <= -0.05)) continue
				if (i - last < GAP_BARS) continue
				last = i
				const atr = atr200[i]
				if (!Number.isFinite(atr) || atr! <= 0) continue
				const entryIdx = i + 1
				if (entryIdx + HOLD_BARS - 1 > candles.length - 1) continue
				const entryBar = candles[entryIdx]!
				const entryOpen = entryBar.open
				const band = bands[i]!
				const depth = (band.greenHi - entryOpen) / Math.max(band.greenHi - band.greenLo, 1e-12)
				const deep = entryOpen <= band.greenHi && depth >= 0.5
				const inner = entryOpen <= band.greenHi
				const meanTouch = entryOpen <= band.mean
				const flushLow = Math.min(...candles.slice(i - WINDOW_BARS + 1, i + 1).map((c) => c.low))
				const stop = flushLow - 0.5 * atr!
				let exitIdx = entryIdx + HOLD_BARS - 1
				let exitPrice = candles[exitIdx]!.close
				for (let k = entryIdx; k <= exitIdx; k++) {
					if (candles[k]!.low <= stop) { exitIdx = k; exitPrice = stop; break }
				}
				let fundingQuote = 0
				for (const f of funding) {
					if (f.timestamp < entryBar.timestamp || f.timestamp >= candles[exitIdx]!.timestamp) continue
					fundingQuote += -f.rate * f.markPrice
				}
				trades.push({ mode: mode.id, symbol: entry.symbol, day: dayKey(entryBar.timestamp), v: exitPrice / entryOpen - 1 + fundingQuote / entryOpen - ROUND_TRIP_COST, deep, inner, meanTouch })
			}
		}
		console.log(`${entry.symbol}: готово (пул ${trades.length})`)
	}

	const variants = [
		{ id: 'deep', pick: (t: EvTrade) => t.deep },
		{ id: 'inner', pick: (t: EvTrade) => t.inner },
		{ id: 'mean', pick: (t: EvTrade) => t.meanTouch },
	]
	const verdicts = variants.map((v) => {
		const cls = trades.filter(v.pick)
		const rest = trades.filter((t) => !v.pick(t))
		const clsMean = cls.length ? sum(cls.map((t) => t.v)) / cls.length : null
		const restMean = rest.length ? sum(rest.map((t) => t.v)) / rest.length : null
		const ci = classDeltaCi(trades.map((t) => ({ day: t.day, v: t.v, inClass: v.pick(t) })))
		const gate = cls.length >= 100
		const verdict: 'GO' | 'KILL' | 'INCONCLUSIVE DATA' = !gate ? 'INCONCLUSIVE DATA' : ci.lower > 0 ? 'GO' : 'KILL'
		return { id: v.id, classN: cls.length, restN: rest.length, classMean: clsMean, restMean, delta: clsMean != null && restMean != null ? clsMean - restMean : null, ci, gate, verdict }
	})

	writeFileSync(resolve(OUT_JSON), JSON.stringify({
		studyId: 'd6-apex-b',
		generatedAt: new Date().toISOString(),
		preregistrationSha256: PREREG_SHA256,
		manifestSha256: MANIFEST_SHA256,
		eventsTotal: trades.length,
		universe: manifest.symbols.map((s) => s.symbol),
		variants: verdicts,
	}, null, 2))

	const md = [
		'# D6-apex-B — TERMINAL REVEAL: три определения входа в зону Apex (вселенная Б)',
		'',
		`Событий в пуле: ${trades.length} (STANDARD + SAFE, 1h, 16 мид-капов).`,
		'',
		'| класс | N класса | mean класса | mean комплемента | Δ | CI95 | вердикт |',
		'|---|---:|---:|---:|---:|---|---|',
		...verdicts.map((v) => `| ${v.id} | ${v.classN} | ${pct(v.classMean)} | ${pct(v.restMean)} | ${pct(v.delta)} | [${pct(v.ci.lower)}; ${pct(v.ci.upper)}] | **${v.verdict}** |`),
		'',
		'⚠ In-sample по порогам события (census Б); классы зоны — свежие. Сделка обоих классов',
		'идентична: стоп структурный (стоп первым), чистый таймаут 72ч, net 5bps + funding.',
		'После reveal Б сожжена для D6-apex-классов.',
		'',
		`Prereg \`${PREREG_SHA256}\`; manifest \`${MANIFEST_SHA256}\`; seed ${SEED}.`,
	]
	writeFileSync(resolve(OUT_MD), md.join('\n'))
	console.log(md.join('\n'))
}

void main()
