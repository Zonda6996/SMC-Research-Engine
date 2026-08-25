/**
 * D6-apex — TERMINAL REVEAL (одноразовый): фильтр «глубоко в зоне Apex».
 *
 * Протокол: ci-results/d6-apex-preregistration.md (FROZEN, SHA см. ниже).
 * Первичный тест: pooled по 6 ТФ × 2 режима разность mean(net | IN-ZONE-DEEP) −
 * mean(net | комплемент), UTC-day cluster bootstrap CI95 (10k, seed 25082026).
 * События: каскад 8ч (STANDARD −15/−5, SAFE −20/−5) на 12 мажорах, все ТФ из data/d6-multitf.
 * Сделка: стоп структурный (стоп первым), чистый таймаут 72ч (без reclaim), net 5bps + funding.
 *
 * Prereg SHA-256: (пинован в PREREG_SHA256)
 * Manifest SHA-256: 8e172fc4a0f41b463e305ab7a37e334c70d4205bf26fecd698ec86e82ee250b0
 * Запуск: npx tsx ci/research/runD6ApexReveal.ts
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { alignArchiveMetrics, fetchArchiveMetrics } from '../../tools/shared/archiveMetrics.js'
import { arrowAtr200 } from '../../src/core/signals/ArrowSignalEngine.js'
import { computeApexBands } from '../../src/core/signals/ApexEngine.js'

const PREREG_PATH = 'ci-results/d6-apex-preregistration.md'
const PREREG_SHA256 = createHash('sha256').update(readFileSync(resolve(PREREG_PATH))).digest('hex')
const MANIFEST_PATH = 'data/d6-multitf/manifest.json'
const MANIFEST_SHA256 = '8e172fc4a0f41b463e305ab7a37e334c70d4205bf26fecd698ec86e82ee250b0'
const DATA_DIR = 'data/d6-multitf'
const OUT_JSON = 'ci-results/d6-apex-results.json'
const OUT_MD = 'ci-results/d6-apex-results.md'
const HOUR = 3_600_000
const WINDOW_HOURS = 8
const GAP_HOURS = 8
const HOLD_HOURS = 72
const ROUND_TRIP_COST = 0.001
const SAMPLES = 10_000
const SEED = 25_082_026
const TF_MS: Record<string, number> = { '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000 }
const TFS = ['5m', '15m', '30m', '1h', '2h', '4h'] as const
const MODES = [
	{ id: 'STANDARD', oiDrop: -0.15, priceDrop: -0.05 },
	{ id: 'SAFE', oiDrop: -0.2, priceDrop: -0.05 },
] as const

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

/** Разность средних deep − rest с day-cluster бутстрапом (дни ресэмплятся целиком). */
function deepDeltaCi(rows: ReadonlyArray<{ day: string; v: number; deep: boolean }>): { lower: number; upper: number } {
	const days = [...new Set(rows.map((r) => r.day))].sort()
	if (!days.length) return { lower: NaN, upper: NaN }
	const random = rng(SEED)
	const deltas: number[] = []
	for (let s = 0; s < SAMPLES; s++) {
		const ds: number[] = []
		const rs: number[] = []
		for (let i = 0; i < days.length; i++) {
			const pick = days[Math.floor(random() * days.length)]!
			for (const r of rows) if (r.day === pick) (r.deep ? ds : rs).push(r.v)
		}
		if (ds.length && rs.length) deltas.push(sum(ds) / ds.length - sum(rs) / rs.length)
	}
	if (!deltas.length) return { lower: NaN, upper: NaN }
	deltas.sort((a, b) => a - b)
	return { lower: deltas[Math.floor(0.025 * deltas.length)]!, upper: deltas[Math.floor(0.975 * deltas.length)]! }
}

interface EvTrade { tf: string; mode: string; symbol: string; day: string; v: number; gross: number; deep: boolean; outcome: string }

async function main(): Promise<void> {
	if (fileHashOf(PREREG_PATH) !== PREREG_SHA256) throw new Error('prereg changed after freeze')
	if (fileHashOf(MANIFEST_PATH) !== MANIFEST_SHA256) throw new Error('manifest hash mismatch')
	const manifest = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8')) as { symbols: Array<{ symbol: string; fundingFile: string; fundingSha256: string; tf: Record<string, { file: string; sha256: string }> }> }

	interface Loaded { symbol: string; funding: Array<{ timestamp: number; rate: number; markPrice: number }>; perTf: Record<string, { candles: Candle[]; oi: Array<number | null>; atr200: number[]; bands: ReturnType<typeof computeApexBands> }> }
	const loaded: Loaded[] = []
	for (const entry of manifest.symbols) {
		if (fileHashOf(resolve(DATA_DIR, entry.fundingFile)) !== entry.fundingSha256) throw new Error(`${entry.symbol}: funding hash`)
		const funding = JSON.parse(readFileSync(resolve(DATA_DIR, entry.fundingFile), 'utf8')) as Array<{ timestamp: number; rate: number; markPrice: number }>
		const perTf: Loaded['perTf'] = {}
		for (const tf of TFS) {
			const f = entry.tf[tf]!
			if (fileHashOf(resolve(DATA_DIR, f.file)) !== f.sha256) throw new Error(`${entry.symbol} ${tf}: hash`)
			const candles = JSON.parse(readFileSync(resolve(DATA_DIR, f.file), 'utf8')) as Candle[]
			const points = await fetchArchiveMetrics(entry.symbol, candles[0]!.timestamp, candles[candles.length - 1]!.timestamp + TF_MS[tf]!)
			perTf[tf] = { candles, oi: alignArchiveMetrics(points, candles).oi, atr200: arrowAtr200(candles), bands: computeApexBands(candles) }
		}
		loaded.push({ symbol: entry.symbol, funding, perTf })
		console.log(`${entry.symbol}: все ТФ + зоны готовы`)
	}

	const trades: EvTrade[] = []
	for (const item of loaded) {
		for (const tf of TFS) {
			const tfMs = TF_MS[tf]!
			const windowBars = Math.floor(WINDOW_HOURS * HOUR / tfMs)
			const gapBars = Math.floor(GAP_HOURS * HOUR / tfMs)
			const holdBars = Math.floor(HOLD_HOURS * HOUR / tfMs)
			const { candles, oi, atr200, bands } = item.perTf[tf]!
			const closes = candles.map((c) => c.close)
			for (const mode of MODES) {
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
					if (entryIdx + holdBars - 1 > candles.length - 1) continue
					const entryBar = candles[entryIdx]!
					const entryOpen = entryBar.open
					const band = bands[i]!
					const depth = (band.greenHi - entryOpen) / Math.max(band.greenHi - band.greenLo, 1e-12)
					const deep = entryOpen <= band.greenHi && depth >= 0.5
					const flushLow = Math.min(...candles.slice(i - windowBars + 1, i + 1).map((c) => c.low))
					const stop = flushLow - 0.5 * atr!
					let exitIdx = entryIdx + holdBars - 1
					let exitPrice = candles[exitIdx]!.close
					let outcome = 'timeout'
					for (let k = entryIdx; k <= exitIdx; k++) {
						if (candles[k]!.low <= stop) { exitIdx = k; exitPrice = stop; outcome = 'stop'; break }
					}
					let fundingQuote = 0
					for (const f of item.funding) {
						if (f.timestamp < entryBar.timestamp || f.timestamp >= candles[exitIdx]!.timestamp) continue
						fundingQuote += -f.rate * f.markPrice
					}
					trades.push({ tf, mode: mode.id, symbol: item.symbol, day: dayKey(entryBar.timestamp), v: exitPrice / entryOpen - 1 + fundingQuote / entryOpen - ROUND_TRIP_COST, gross: exitPrice / entryOpen - 1 + fundingQuote / entryOpen, deep, outcome })
				}
			}
		}
		console.log(`сделок накоплено: ${trades.length}`)
	}

	const deep = trades.filter((t) => t.deep)
	const rest = trades.filter((t) => !t.deep)
	const pooled = deepDeltaCi(trades)
	const powerOk = trades.length >= 100 && deep.length >= 100
	const verdict: 'GO' | 'KILL' | 'INCONCLUSIVE DATA' = !powerOk ? 'INCONCLUSIVE DATA' : pooled.lower > 0 ? 'GO' : 'KILL'

	const perArm = TFS.flatMap((tf) => MODES.map((m) => {
		const arm = trades.filter((t) => t.tf === tf && t.mode === m.id)
		const d = arm.filter((t) => t.deep)
		const r = arm.filter((t) => !t.deep)
		return {
			tf, mode: m.id, n: arm.length, deepN: d.length,
			deepMean: d.length ? sum(d.map((x) => x.v)) / d.length : null,
			restMean: r.length ? sum(r.map((x) => x.v)) / r.length : null,
			deepWr: d.length ? d.filter((x) => x.v > 0).length / d.length : null,
			delta: d.length && r.length ? sum(d.map((x) => x.v)) / d.length - sum(r.map((x) => x.v)) / r.length : null,
		}
	}))

	writeFileSync(resolve(OUT_JSON), JSON.stringify({
		studyId: 'd6-apex',
		generatedAt: new Date().toISOString(),
		verdict,
		primary: { deepN: deep.length, restN: rest.length, deepMean: sum(deep.map((t) => t.v)) / deep.length, restMean: sum(rest.map((t) => t.v)) / rest.length, deltaCi95: pooled },
		powerOk,
		preregistrationSha256: PREREG_SHA256,
		manifestSha256: MANIFEST_SHA256,
		universe: loaded.map((l) => l.symbol),
		perArm,
	}, null, 2))

	const md = [
		'# D6-apex — TERMINAL REVEAL: фильтр «глубоко в зоне Apex»',
		'',
		`# Вердикт: \`${verdict}\``,
		'',
		`Событий всего: ${trades.length} (IN-ZONE-DEEP: ${deep.length}, комплемент: ${rest.length}) на 12 мажорах, 6 ТФ × 2 режима.`,
		'',
		`**Первичный тест (pooled):** deep ${pct(sum(deep.map((t) => t.v)) / deep.length)} против rest ${pct(sum(rest.map((t) => t.v)) / rest.length)} → разность **${pct(sum(deep.map((t) => t.v)) / deep.length - sum(rest.map((t) => t.v)) / rest.length)}**, CI95 [${pct(pooled.lower)}; ${pct(pooled.upper)}].`,
		'',
		'По ТФ×режим (дескриптивно):',
		'',
		'| ТФ | режим | всего | deep | deep mean | deep WR | rest mean | Δ (deep−rest) |',
		'|---|---|---:|---:|---:|---:|---:|---:|',
		...perArm.map((a) => `| ${a.tf} | ${a.mode} | ${a.n} | ${a.deepN} | ${pct(a.deepMean)} | ${pct(a.deepWr, 1)} | ${pct(a.restMean)} | ${pct(a.delta)} |`),
		'',
		'⚠ In-sample: классы видены в census (prereg). Сделка обоих классов идентична: стоп структурный',
		'(стоп первым), чистый таймаут 72ч, net 5bps + funding. После reveal мажоры сожжены для класса.',
		'',
		`Prereg \`${PREREG_SHA256}\`; manifest \`${MANIFEST_SHA256}\`; seed ${SEED}.`,
	]
	writeFileSync(resolve(OUT_MD), md.join('\n'))
	console.log(md.join('\n'))
}

function fileHashOf(p: string): string {
	return createHash('sha256').update(readFileSync(resolve(p))).digest('hex')
}

void main()
