/**
 * D6-flash — TERMINAL REVEAL (одноразовый): Flash-книга, пропорциональные окна, 18 рук.
 *
 * Протокол: ci-results/d6-flash-preregistration.md (FROZEN). 16 мид-капов Б, 6 ТФ (окно = 8 баров
 * своего ТФ: 5м→40м … 4ч→32ч) × 3 режима (RISK −12 / STANDARD −15 / SAFE −20, цена −5%).
 * Сделка: LONG next-open, стоп flushLow(8)−0.5×ATR200(ТФ) (стоп первым), ТОЛЬКО таймаут 72ч,
 * net 5bps/сторону + фактический funding. Arm-вердикт: GO ⇔ CI-low>0 и N≥30; N<10 → INCONCLUSIVE.
 * Отчёт: сводная таблица + пер-символьная статистика (топ-3 детально, все — в JSON).
 *
 * Prereg SHA-256: (пинован в PREREG_SHA256)
 * Manifest SHA-256: f5d92f0f344e8301c50d75e9910ac11d2da67a288f2c39b415484f67c7bd6f2e
 * Запуск: npx tsx ci/research/runD6FlashReveal.ts
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { alignArchiveMetrics, fetchArchiveMetrics } from '../../tools/shared/archiveMetrics.js'
import { arrowAtr200 } from '../../src/core/signals/ArrowSignalEngine.js'

const PREREG_PATH = 'ci-results/d6-flash-preregistration.md'
const PREREG_SHA256 = createHash('sha256').update(readFileSync(resolve(PREREG_PATH))).digest('hex')
const MANIFEST_PATH = 'data/d6-flash/manifest.json'
const MANIFEST_SHA256 = 'f5d92f0f344e8301c50d75e9910ac11d2da67a288f2c39b415484f67c7bd6f2e'
const DATA_DIR = 'data/d6-flash'
const OUT_JSON = 'ci-results/d6-flash-results.json'
const OUT_MD = 'ci-results/d6-flash-results.md'
const HOUR = 3_600_000
const WINDOW_BARS = 8
const GAP_BARS = 8
const HOLD_HOURS = 72
const ROUND_TRIP_COST = 0.001
const SAMPLES = 10_000
const SEED = 25_082_026
const TF_MS: Record<string, number> = { '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000, '2h': 7_200_000, '4h': 14_400_000 }
const TFS = ['5m', '15m', '30m', '1h', '2h', '4h'] as const
const MODES = [
	{ id: 'RISK', oiDrop: -0.12 },
	{ id: 'STANDARD', oiDrop: -0.15 },
	{ id: 'SAFE', oiDrop: -0.2 },
] as const

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

function ci(rows: ReadonlyArray<{ day: string; v: number }>): { lower: number; upper: number } {
	const groups = new Map<string, number[]>()
	for (const r of rows) { const g = groups.get(r.day) ?? []; g.push(r.v); groups.set(r.day, g) }
	const days = [...groups.keys()].sort()
	if (!days.length) return { lower: NaN, upper: NaN }
	const random = rng(SEED)
	const means: number[] = []
	for (let s = 0; s < SAMPLES; s++) {
		let total = 0, count = 0
		for (let i = 0; i < days.length; i++) for (const v of groups.get(days[Math.floor(random() * days.length)]!)!) { total += v; count++ }
		if (count) means.push(total / count)
	}
	means.sort((a, b) => a - b)
	return { lower: means[Math.floor(0.025 * means.length)]!, upper: means[Math.floor(0.975 * means.length)]! }
}

interface SettledFunding { timestamp: number; rate: number; markPrice: number }
interface Trade { tf: string; mode: string; symbol: string; day: string; v: number; outcome: string }

async function main(): Promise<void> {
	if (fileHash(PREREG_PATH) !== PREREG_SHA256) throw new Error('prereg changed after freeze')
	if (fileHash(MANIFEST_PATH) !== MANIFEST_SHA256) throw new Error('manifest hash mismatch')
	const manifest = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8')) as { symbols: Array<{ symbol: string; fundingFile: string; fundingSha256: string; tf: Record<string, { file: string; sha256: string }> }> }

	const trades: Trade[] = []
	for (const entry of manifest.symbols) {
		if (fileHash(resolve(DATA_DIR, entry.fundingFile)) !== entry.fundingSha256) throw new Error(`${entry.symbol}: funding hash`)
		const funding = JSON.parse(readFileSync(resolve(DATA_DIR, entry.fundingFile), 'utf8')) as SettledFunding[]
		for (const tf of TFS) {
			const f = entry.tf[tf]!
			if (fileHash(resolve(DATA_DIR, f.file)) !== f.sha256) throw new Error(`${entry.symbol} ${tf}: hash`)
			const candles = JSON.parse(readFileSync(resolve(DATA_DIR, f.file), 'utf8')) as Candle[]
			const points = await fetchArchiveMetrics(entry.symbol, candles[0]!.timestamp, candles[candles.length - 1]!.timestamp + TF_MS[tf]!)
			const oi = alignArchiveMetrics(points, candles).oi
			const atr200 = arrowAtr200(candles)
			const closes = candles.map((c) => c.close)
			const holdBars = Math.floor(HOLD_HOURS * HOUR / TF_MS[tf]!)
			for (const mode of MODES) {
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
					if (entryIdx + holdBars - 1 > candles.length - 1) continue
					const entryOpen = candles[entryIdx]!.open
					const flushLow = Math.min(...candles.slice(i - WINDOW_BARS + 1, i + 1).map((c) => c.low))
					const stop = flushLow - 0.5 * atr!
					let exitIdx = entryIdx + holdBars - 1
					let exitPrice = candles[exitIdx]!.close
					let outcome = 'timeout'
					for (let k = entryIdx; k <= exitIdx; k++) {
						if (candles[k]!.low <= stop) { exitIdx = k; exitPrice = stop; outcome = 'stop'; break }
					}
					let fundingQuote = 0
					for (const f2 of funding) {
						if (f2.timestamp < candles[entryIdx]!.timestamp || f2.timestamp >= candles[exitIdx]!.timestamp) continue
						fundingQuote += -f2.rate * f2.markPrice
					}
					trades.push({ tf, mode: mode.id, symbol: entry.symbol, day: dayKey(candles[entryIdx]!.timestamp), v: exitPrice / entryOpen - 1 + fundingQuote / entryOpen - ROUND_TRIP_COST, outcome })
				}
			}
		}
		console.log(`${entry.symbol}: готово (пул ${trades.length})`)
	}

	interface ArmStat { tf: string; mode: string; n: number; wr: number | null; meanNet: number | null; ci: { lower: number; upper: number }; stops: number; timeouts: number; symbolsWithEvents: number; verdict: string }
	const arms: ArmStat[] = []
	for (const tf of TFS) {
		for (const mode of MODES) {
			const rows = trades.filter((t) => t.tf === tf && t.mode === mode.id)
			const vals = rows.map((r) => r.v)
			const ci95 = ci(rows)
			const verdict = vals.length < 10 ? 'INCONCLUSIVE DATA' : ci95.lower > 0 && vals.length >= 30 ? 'GO' : 'KILL'
			arms.push({
				tf, mode: mode.id, n: vals.length,
				wr: vals.length ? vals.filter((x) => x > 0).length / vals.length : null,
				meanNet: vals.length ? sum(vals) / vals.length : null,
				ci: ci95, stops: rows.filter((r) => r.outcome === 'stop').length, timeouts: rows.filter((r) => r.outcome === 'timeout').length,
				symbolsWithEvents: new Set(rows.map((r) => r.symbol)).size, verdict,
			})
			console.log(`${tf} ${mode.id}: N=${vals.length} WR=${pct(arms[arms.length - 1]!.wr, 1)} net=${pct(arms[arms.length - 1]!.meanNet)} ${verdict}`)
		}
	}

	// Пер-символьная статистика: для каждого ТФ — все символы с событиями (STANDARD как опорный режим + RISK/SAFE в JSON)
	const perSymbol = TFS.map((tf) => ({
		tf,
		symbols: [...new Set(trades.filter((t) => t.tf === tf).map((t) => t.symbol))].map((symbol) => ({
			symbol,
			modes: MODES.map((mode) => {
				const rows = trades.filter((t) => t.tf === tf && t.mode === mode.id && t.symbol === symbol)
				const vals = rows.map((r) => r.v)
				return { mode: mode.id, n: vals.length, wr: vals.length ? vals.filter((x) => x > 0).length / vals.length : null, meanNet: vals.length ? sum(vals) / vals.length : null }
			}),
		})).sort((a, b) => {
			const na = a.modes.reduce((s, m) => s + m.n, 0)
			const nb = b.modes.reduce((s, m) => s + m.n, 0)
			return nb - na
		}),
	}))

	writeFileSync(resolve(OUT_JSON), JSON.stringify({
		studyId: 'd6-flash',
		generatedAt: new Date().toISOString(),
		preregistrationSha256: PREREG_SHA256,
		manifestSha256: MANIFEST_SHA256,
		universe: manifest.symbols.map((s) => s.symbol),
		arms,
		perSymbol,
	}, null, 2))

	const top3 = perSymbol[0]!.symbols.slice(0, 3)
	const md = [
		'# D6-flash — TERMINAL REVEAL: Flash-книга, пропорциональные окна, 6 ТФ × 3 режима',
		'',
		'Окно = 8 баров своего ТФ (5м→40м … 4ч→32ч) — каждое ТФ видит своё явление. Сделка: лонг next-open,',
		'стоп структурный (стоп первым), выход только по таймауту 72ч, net 5bps + funding. 16 мид-капов Б.',
		'',
		'| ТФ | режим | N | WR | средняя net | CI95 | стопов | таймаутов | символов | вердикт |',
		'|---|---|---:|---:|---:|---|---:|---:|---:|---|',
		...arms.map((a) => `| ${a.tf} | ${a.mode} | ${a.n} | ${pct(a.wr, 1)} | ${pct(a.meanNet)} | [${pct(a.ci.lower)}; ${pct(a.ci.upper)}] | ${a.stops} | ${a.timeouts} | ${a.symbolsWithEvents}/16 | **${a.verdict}** |`),
		'',
		`Arm-гейт: GO ⇔ CI-low>0 и N≥30; N<10 → INCONCLUSIVE. Суммарно сделок: ${trades.length}.`,
		'',
		'## Пер-символьная статистика — ТФ ' + perSymbol[0]!.tf + ' (топ-3 по числу событий; все символы — в JSON)',
		'',
		'| символ | режим | N | WR | средняя net |',
		'|---|---|---:|---:|---:|',
		...top3.flatMap((s) => s.modes.map((m) => `| ${s.symbol.replace('USDT', '')} | ${m.mode} | ${m.n} | ${pct(m.wr, 1)} | ${pct(m.meanNet)} |`)),
		'',
		'⚠ In-sample пороги; флэш-руки редки по природе (окно 40м на 5м). После reveal Б сожжена для класса.',
		'',
		`Prereg \`${PREREG_SHA256}\`; manifest \`${MANIFEST_SHA256}\`; seed ${SEED}.`,
	]
	writeFileSync(resolve(OUT_MD), md.join('\n'))
	console.log('\nЗаписано: ci-results/d6-flash-results.{json,md}')
}

void main()
