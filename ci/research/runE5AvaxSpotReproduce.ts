/**
 * E5-avax-reproduce — reproduce AVAX 5m Binance SPOT под ДВЕ таблицы вендора.
 *
 * Вендор задал управление явно: «полная фиксация у зоны mean, без частичных и доборов»
 *   → наш арм fullFixAtMean:true, addEnabled:false (mode=safe, канон движок, ничего не выдумываем).
 * Он дал ДВЕ рабочие точки стопа (Avg stop = реализованный % убытка на стоп-сделке):
 *   A «оптимальный»: Trades 67 (L27/S40), WR 91%, Take 61, Stop 6, Result +23.24%, AvgStop −1.7%,  ResultR +12.62R
 *   B «стоп короче»: Trades 68 (L27/S41), WR 47.1%, Take 32, Stop 36, Result +10.73%, AvgStop −0.35%, ResultR +26.25R
 *
 * Мы НЕ знаем его формулу стопа (§2.1 — не выдумываем). Здесь только ПОДГОНЯЕМ реализованный
 * Avg stop под его −1.7% и −0.35% (через stepDivisor/stopSteps override, прод-константы не тронуты)
 * и смотрим, воспроизводятся ли WR / Take / Stop / ResultR и ЧИСЛО сделок (у него счётчик ≈ инвариантен к стопу: 67↔68).
 *
 * Запуск: npx tsx ci/research/runE5AvaxSpotReproduce.ts
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { detectArrowSignalCandidates } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayArrowSignals, type ArrowModeConfig, type ArrowTrade } from '../../src/core/signals/ArrowTradeReplay.js'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'

const SYMBOL = 'AVAX/USDT', TF = '5m', REL_VOL = 1.4
const FROM = Date.UTC(2024, 0, 1)
const CACHE = resolve('tmp/viz-archive-cache')
const WINDOWS: Array<[string, number]> = [['~2 месяца', 17_280], ['~1 год', 105_120]]

const VENDOR = {
	A: { label: 'A «оптимальный» AvgStop −1.7%', total: { trades: 67, wr: 91, take: 61, stop: 6, resultPct: 23.24, resultR: 12.62 }, long: { trades: 27, take: 25, stop: 2, resultR: 5.55 }, short: { trades: 40, take: 36, stop: 4, resultR: 7.07 }, avgStop: -1.7 },
	B: { label: 'B «стоп короче» AvgStop −0.35%', total: { trades: 68, wr: 47.1, take: 32, stop: 36, resultPct: 10.73, resultR: 26.25 }, long: { trades: 27, take: 14, stop: 13, resultR: 12.05 }, short: { trades: 41, take: 18, stop: 23, resultR: 14.2 }, avgStop: -0.35 },
}

const STEP_DIVISORS = [1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28]
const STOP_STEPS = [0.5, 0.75, 1, 1.5, 2]

function riskPct(t: ArrowTrade): number { // addEnabled=false → oneR = |entry−stop|
	const oneR = Math.abs(t.entry - t.stop)
	return t.entry > 0 && oneR > 0 ? (oneR / t.entry) * 100 : 0
}

interface Stat { trades: number; take: number; stop: number; timeout: number; wr: number; resultR: number; resultPct: number; avgStopPct: number | null }
function stat(ts: ArrowTrade[]): Stat {
	const take = ts.filter((t) => t.outcome === 'full-tp').length
	const stop = ts.filter((t) => t.outcome === 'stop').length
	const timeout = ts.filter((t) => t.outcome === 'timeout').length
	const finalized = take + stop
	const wr = finalized ? take / finalized : 0
	const resultR = ts.reduce((a, t) => a + (Number.isFinite(t.netR) ? t.netR : 0), 0)
	const resultPct = ts.reduce((a, t) => a + (Number.isFinite(t.netR) ? t.netR * riskPct(t) : 0), 0)
	const stopped = ts.filter((t) => t.outcome === 'stop')
	const avgStopPct = stopped.length ? stopped.reduce((a, t) => a + t.netR * riskPct(t), 0) / stopped.length : null
	return { trades: finalized, take, stop, timeout, wr, resultR, resultPct, avgStopPct }
}

const sr = (x: number, d = 2) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : 'n/a')

async function main() {
	const full = await fetchArchiveKlines(SYMBOL, TF, 'spot', FROM, Date.now(), { cacheDir: CACHE, parallel: 8 })
	console.log(`[avax] spot доступно ${full.length} свечей: ${new Date(full[0]!.timestamp).toISOString().slice(0, 10)}→${new Date(full.at(-1)!.timestamp).toISOString().slice(0, 10)}`)

	const md: string[] = []
	md.push('# E5 reproduce — AVAX 5m Binance SPOT vs две таблицы вендора')
	md.push('')
	md.push('Управление: `fullFixAtMean:true, addEnabled:false` (полная фиксация у mean, без частичек/доборов) — как описал вендор.')
	md.push('Стоп подгоняется под его Avg stop через override (прод-константы не тронуты, §2.1/2.2). net 7bps в движке.')
	md.push('')

	const jsonOut: unknown[] = []
	for (const [wlabel, wsize] of WINDOWS) {
		const candles: Candle[] = full.slice(-wsize)
		if (candles.length < 2000) continue
		const bands = computeApexBands(candles, APEX_PARAMS)
		const sigs = detectArrowSignalCandidates(candles, APEX_PARAMS, { minimumRelativeVolume: REL_VOL }).candidates
		const days = (candles.at(-1)!.timestamp - candles[0]!.timestamp) / 86_400_000

		// сетка
		interface Row { sd: number; ss: number; total: Stat; long: Stat; short: Stat }
		const rows: Row[] = []
		for (const sd of STEP_DIVISORS) for (const ss of STOP_STEPS) {
			const res = replayArrowSignals(candles, bands, sigs, 'safe', { fullFixAtMean: true, addEnabled: false, stepDivisor: sd, stopSteps: ss })
			rows.push({ sd, ss, total: stat(res.trades), long: stat(res.trades.filter((t) => t.side === 'long')), short: stat(res.trades.filter((t) => t.side === 'short')) })
		}
		const nearest = (target: number) => rows.filter((r) => r.total.avgStopPct != null).sort((a, b) => Math.abs(a.total.avgStopPct! - target) - Math.abs(b.total.avgStopPct! - target))[0]!
		const canon = rows.find((r) => r.sd === 1 && r.ss === 2)!
		const matchA = nearest(VENDOR.A.avgStop)
		const matchB = nearest(VENDOR.B.avgStop)

		console.log(`\n=== AVAX 5m SPOT | окно ${wlabel} = ${candles.length} свечей (${new Date(candles[0]!.timestamp).toISOString().slice(0, 10)}→${new Date(candles.at(-1)!.timestamp).toISOString().slice(0, 10)}, ~${days.toFixed(0)}д) | OWN2=${sigs.length} ===`)
		const show = (tag: string, r: Row) => console.log(`  ${tag.padEnd(30)} sd=${r.sd} ss=${r.ss} | trades=${r.total.trades} WR=${(r.total.wr * 100).toFixed(1)}% take=${r.total.take} stop=${r.total.stop} avgStop=${sr(r.total.avgStopPct ?? NaN)}% ResultR=${sr(r.total.resultR)} Result%=${sr(r.total.resultPct)} (L27?/${r.long.trades} S/${r.short.trades})`)
		show('канон (sd1/ss2)', canon)
		show(`match A (цель ${VENDOR.A.avgStop}%)`, matchA)
		show(`match B (цель ${VENDOR.B.avgStop}%)`, matchB)

		md.push(`## Окно ${wlabel}: ${candles.length} свечей (~${days.toFixed(0)}д), OWN2=${sigs.length}`)
		md.push('')
		const cmp = (v: typeof VENDOR.A, m: Row) => {
			md.push(`### ${v.label} — наш подбор: stepDivisor ${m.sd}, stopSteps ${m.ss}`)
			md.push('')
			md.push('| источник | dir | trades | WR | take | stop | Avg stop % | Result R | Result % |')
			md.push('|---|---|---|---|---|---|---|---|---|')
			md.push(`| вендор | LONG | ${v.long.trades} | — | ${v.long.take} | ${v.long.stop} | ${v.avgStop}% | ${sr(v.long.resultR)}R | — |`)
			md.push(`| **наш** | LONG | ${m.long.trades} | ${(m.long.wr * 100).toFixed(1)}% | ${m.long.take} | ${m.long.stop} | ${sr(m.long.avgStopPct ?? NaN)}% | ${sr(m.long.resultR)}R | ${sr(m.long.resultPct)}% |`)
			md.push(`| вендор | SHORT | ${v.short.trades} | — | ${v.short.take} | ${v.short.stop} | ${v.avgStop}% | ${sr(v.short.resultR)}R | — |`)
			md.push(`| **наш** | SHORT | ${m.short.trades} | ${(m.short.wr * 100).toFixed(1)}% | ${m.short.take} | ${m.short.stop} | ${sr(m.short.avgStopPct ?? NaN)}% | ${sr(m.short.resultR)}R | ${sr(m.short.resultPct)}% |`)
			md.push(`| вендор | TOTAL | ${v.total.trades} | ${v.total.wr}% | ${v.total.take} | ${v.total.stop} | ${v.avgStop}% | ${sr(v.total.resultR)}R | ${sr(v.total.resultPct)}% |`)
			md.push(`| **наш** | TOTAL | ${m.total.trades} | ${(m.total.wr * 100).toFixed(1)}% | ${m.total.take} | ${m.total.stop} | ${sr(m.total.avgStopPct ?? NaN)}% | ${sr(m.total.resultR)}R | ${sr(m.total.resultPct)}% |`)
			md.push('')
		}
		cmp(VENDOR.A, matchA)
		cmp(VENDOR.B, matchB)
		jsonOut.push({ window: wlabel, candles: candles.length, own2: sigs.length, canon, matchA, matchB })
	}

	writeFileSync(resolve('ci-results/e5-avax-spot-reproduce.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/e5-avax-spot-reproduce.json'), JSON.stringify({ generatedAt: new Date().toISOString(), symbol: SYMBOL, tf: TF, vendor: VENDOR, windows: jsonOut }, null, 2))
	console.log('\n[avax] written ci-results/e5-avax-spot-reproduce.{md,json}')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((e) => { console.error(e); process.exitCode = 1 })
}
