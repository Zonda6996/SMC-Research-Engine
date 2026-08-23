/**
 * E5-reproduce — строгий reproduce LDO 15m GGI Buy/Sell на КАНОНИЧЕСКОМ движке,
 * но на ФИДЕ ВЕНДОРА: Binance **SPOT** (у нас baseline гонялся на USDT-M perp).
 *
 * Контекст (см. HANDOFF / e5-ggi-meanfix.md): reproduce LDO m15 не сошёлся на perp-20k
 * (BASE −5.54R / WR 81.7% / n72 против автора +15.25R / WR 62.9% / n89). Две неучтённые
 * переменные: (1) фид — вендор торгует spot, не perp; (2) окно — у нас было 20k свечей,
 * TV мог показывать ~40k. Здесь закрываем ОБЕ: тянем полную spot-историю из архивов
 * (`fetchArchiveKlines`, без лимита API) и считаем на срезах last-20k и last-40k.
 *
 * Ничего в движке/детекторе НЕ меняется (§2.1/2.3): OWN2 relVol 1.4, mode=safe, канон-геометрия.
 * Это ДИАГНОСТИКА объекта (gross-of-placebo, БЕЗ OOS) — сверяем «сошлось / не сошлось»
 * с точной таблицей вендора (LONG 41 / SHORT 48 / TOTAL 89, WR 58.5/66.7/62.9,
 * take 24/32/56, stop 17/16/33, ResultR +4.2 / +11.17 / +15.25).
 *
 * Запуск: npx tsx ci/research/runE5GgiLdoSpotReproduce.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { detectArrowSignalCandidates } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayArrowSignals, type ArrowModeConfig, type ArrowTrade } from '../../src/core/signals/ArrowTradeReplay.js'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'

const SYMBOL = 'LDO/USDT'
const TF = '15m'
const REL_VOL = 1.4 // frozen OWN2
const FROM = Date.UTC(2024, 6, 1) // с запасом под 40k×15m (~417д) — режем срезами ниже
const CACHE = resolve('tmp/viz-archive-cache')

interface Arm { name: string; override: Partial<ArrowModeConfig> }
const ARMS: Arm[] = [
	{ name: 'BASE (канон Safe: partial25%+moving, add, stop2x)', override: {} },
	{ name: 'MEANFIX -add (fix100%@mean, no add, stop2x)', override: { fullFixAtMean: true, addEnabled: false } },
	{ name: 'MEANFIX -add stop1x (короче, НЕ канон — арм с WR≈62%)', override: { fullFixAtMean: true, addEnabled: false, stopSteps: 1 } },
]

/** Точная таблица вендора (скрин ТГ), Binance spot LDO 15m. */
const VENDOR = {
	long: { trades: 41, wr: 58.5, take: 24, stop: 17, resultPct: 7.96, avgStopPct: -1.9, resultR: 4.2 },
	short: { trades: 48, wr: 66.7, take: 32, stop: 16, resultPct: 20.37, avgStopPct: -1.82, resultR: 11.17 },
	total: { trades: 89, wr: 62.9, take: 56, stop: 33, resultPct: 28.32, avgStopPct: -1.86, resultR: 15.25 },
}

function riskPct(t: ArrowTrade, addEnabled: boolean): number {
	const oneR = addEnabled === false ? Math.abs(t.entry - t.stop) : Math.abs((t.entry + t.add) / 2 - t.stop) * 2
	return t.entry > 0 && oneR > 0 ? (oneR / t.entry) * 100 : 0
}

interface Stats { trades: number; take: number; partial: number; stop: number; timeout: number; open: number; wr: number; resultR: number; resultPct: number; avgStopPct: number | null }

function stats(trades: ArrowTrade[], side: 'long' | 'short' | null, addEnabled: boolean): Stats {
	const ts = side ? trades.filter((t) => t.side === side) : trades
	const take = ts.filter((t) => t.outcome === 'full-tp').length
	const partial = ts.filter((t) => t.outcome === 'partial-be' || t.outcome === 'partial-stop').length
	const stop = ts.filter((t) => t.outcome === 'stop').length
	const timeout = ts.filter((t) => t.outcome === 'timeout').length
	const open = ts.filter((t) => t.outcome === 'open').length
	const finalized = take + partial + stop
	const wr = finalized ? (take + partial) / finalized : 0
	const resultR = ts.reduce((a, t) => a + (Number.isFinite(t.netR) ? t.netR : 0), 0)
	const resultPct = ts.reduce((a, t) => a + (Number.isFinite(t.netR) ? t.netR * riskPct(t, addEnabled) : 0), 0)
	const stopped = ts.filter((t) => t.outcome === 'stop')
	const avgStopPct = stopped.length ? stopped.reduce((a, t) => a + t.netR * riskPct(t, addEnabled), 0) / stopped.length : null
	// «Trades» у вендора = финализированные (take+stop), т.к. 41+48=89=56+33; timeout/open он не учитывает.
	return { trades: finalized, take, partial, stop, timeout, open, wr, resultR, resultPct, avgStopPct }
}

function loadFuturesCache(): Candle[] | null {
	const path = resolve('tools/batch/cache', `LDO-USDT_${TF}_20000_futures.json`)
	if (!existsSync(path)) return null
	try {
		const arr = JSON.parse(readFileSync(path, 'utf8')) as Array<Record<string, number>>
		return arr.map((r) => ({ timestamp: r.timestamp!, open: r.open!, high: r.high!, low: r.low!, close: r.close!, volume: r.volume ?? 0 }))
			.filter((c) => [c.timestamp, c.open, c.high, c.low, c.close].every(Number.isFinite))
			.sort((a, b) => a.timestamp - b.timestamp)
	} catch { return null }
}

const sr = (x: number, d = 2) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : 'n/a')
const dstr = (ms: number) => new Date(ms).toISOString().slice(0, 10)

interface Section { label: string; candles: number; from: string; to: string; days: number; own2: number; arms: Array<{ arm: string; total: Stats; long: Stats; short: Stats; addEnabled: boolean }> }

function runOn(label: string, candles: Candle[]): Section {
	const bands = computeApexBands(candles, APEX_PARAMS)
	const detection = detectArrowSignalCandidates(candles, APEX_PARAMS, { minimumRelativeVolume: REL_VOL })
	const sigs = detection.candidates
	const days = (candles.at(-1)!.timestamp - candles[0]!.timestamp) / 86_400_000
	const section: Section = { label, candles: candles.length, from: dstr(candles[0]!.timestamp), to: dstr(candles.at(-1)!.timestamp), days, own2: sigs.length, arms: [] }
	for (const arm of ARMS) {
		const addEnabled = arm.override.addEnabled !== false
		const res = replayArrowSignals(candles, bands, sigs, 'safe', arm.override)
		section.arms.push({ arm: arm.name, addEnabled, total: stats(res.trades, null, addEnabled), long: stats(res.trades, 'long', addEnabled), short: stats(res.trades, 'short', addEnabled) })
	}
	return section
}

function vendorBlock(): string[] {
	const md: string[] = []
	md.push('### Таблица вендора (Binance spot, эталон)')
	md.push('')
	md.push('| GGI | Trades | WR | Take | Stop | Result % | Avg stop % | Result R |')
	md.push('|---|---|---|---|---|---|---|---|')
	for (const [k, v] of [['LONG', VENDOR.long], ['SHORT', VENDOR.short], ['TOTAL', VENDOR.total]] as const) {
		md.push(`| ${k} | ${v.trades} | ${v.wr}% | ${v.take} | ${v.stop} | ${sr(v.resultPct)}% | ${v.avgStopPct}% | ${sr(v.resultR)}R |`)
	}
	md.push('')
	return md
}

function statRow(name: string, s: Stats): string {
	return `| ${name} | ${s.trades} | ${(s.wr * 100).toFixed(1)}% | ${s.take} | ${s.stop} | ${sr(s.resultPct)}% | ${s.avgStopPct == null ? 'n/a' : sr(s.avgStopPct)}% | ${sr(s.resultR)}R | ${s.timeout}/${s.open} |`
}

function main() {
	return (async () => {
		console.log('[e5-ldo-spot] тяну LDO/USDT 15m SPOT из архивов data.binance.vision …')
		const spotFull = await fetchArchiveKlines(SYMBOL, TF, 'spot', FROM, Date.now(), { cacheDir: CACHE, parallel: 8 })
		console.log(`[e5-ldo-spot] spot доступно ${spotFull.length} свечей: ${dstr(spotFull[0]!.timestamp)} → ${dstr(spotFull.at(-1)!.timestamp)}`)

		const sections: Section[] = []
		const spot40 = spotFull.slice(-40_000)
		const spot20 = spotFull.slice(-20_000)
		if (spot40.length >= 500) sections.push(runOn(`SPOT last-${spot40.length} (~40k гипотеза)`, spot40))
		if (spot20.length >= 500) sections.push(runOn(`SPOT last-${spot20.length} (~20k, окно как у baseline)`, spot20))
		const fut = loadFuturesCache()
		if (fut) sections.push(runOn(`FUTURES ${fut.length} (perp, референс baseline)`, fut))

		for (const s of sections) {
			console.log(`\n=== ${s.label} | свечей=${s.candles} (${s.from}→${s.to}, ~${s.days.toFixed(0)}д) | OWN2=${s.own2} ===`)
			for (const a of s.arms) {
				console.log(`  ${a.arm}`)
				for (const [nm, st] of [['LONG', a.long], ['SHORT', a.short], ['TOTAL', a.total]] as const) {
					console.log(`    ${nm.padEnd(5)} trades=${String(st.trades).padStart(3)} WR=${(st.wr * 100).toFixed(1)}% take=${st.take} stop=${st.stop} ResR=${sr(st.resultR)} Res%=${sr(st.resultPct)} avgStop%=${st.avgStopPct == null ? 'n/a' : sr(st.avgStopPct)}`)
				}
			}
		}

		writeFileSync(resolve('ci-results/e5-ggi-ldo-spot.json'), JSON.stringify({
			generatedAt: new Date().toISOString(),
			protocol: 'E5-ldo-spot-reproduce-1.0 (canonical ArrowTradeReplay, OWN2 relVol1.4, mode=safe, feed=Binance SPOT archives)',
			note: 'ДИАГНОСТИКА объекта, gross-of-placebo, БЕЗ OOS. Фид = Binance spot (как у вендора). net 7bps внутри движка.',
			symbol: SYMBOL, tf: TF, relVol: REL_VOL, vendor: VENDOR, arms: ARMS.map((a) => ({ name: a.name, override: a.override })), sections,
		}, null, 2))

		const md: string[] = []
		md.push('# E5 reproduce — LDO 15m GGI Buy/Sell на Binance SPOT (канонический движок)')
		md.push('')
		md.push('OWN2 (relVol 1.4, лонг+шорт), `replayArrowSignals` mode=safe, net 7bps. Фид — **Binance spot**')
		md.push('(архивы data.binance.vision, без лимита 20k), как у вендора. Движок/детектор не тронуты (§2.1).')
		md.push('ДИАГНОСТИКА: сверяем «сошлось/нет» с эталонной таблицей вендора. БЕЗ плацебо/OOS.')
		md.push('')
		md.push('**Result R** = Σ netR; **Result %** = Σ(netR·risk%); **Avg stop %** = средний netR·risk% по стоп-сделкам; WR = (take+partial)/(take+partial+stop). Trades = финализированные (как у вендора).')
		md.push('')
		md.push(...vendorBlock())
		for (const s of sections) {
			md.push(`## ${s.label}`)
			md.push('')
			md.push(`свечей=${s.candles} · ${s.from} → ${s.to} (~${s.days.toFixed(0)}д) · OWN2-кандидатов=${s.own2}`)
			md.push('')
			for (const a of s.arms) {
				md.push(`### ${a.arm}`)
				md.push('')
				md.push('| dir | trades | WR | take | stop | Result % | Avg stop % | Result R | timeout/open |')
				md.push('|---|---|---|---|---|---|---|---|---|')
				md.push(statRow('LONG', a.long))
				md.push(statRow('SHORT', a.short))
				md.push(statRow('TOTAL', a.total))
				md.push('')
			}
		}
		writeFileSync(resolve('ci-results/e5-ggi-ldo-spot.md'), md.join('\n'))
		console.log('\n[e5-ldo-spot] written ci-results/e5-ggi-ldo-spot.{json,md}')
	})()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((e) => { console.error(e); process.exitCode = 1 })
}
