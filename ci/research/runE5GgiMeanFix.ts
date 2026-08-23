/**
 * E5 (попытка 2, faithful) — GGI Buy/Sell + фикс у mean на КАНОНИЧЕСКОМ движке.
 *
 * В отличие от runE5MeanFixPaired.ts (невалиден: pd_premium-шорт-бук на VAR1-форке),
 * здесь всё каноническое:
 *  - сигнал = OWN2-стрелка `detectArrowSignalCandidates(candles, APEX_PARAMS, {minimumRelativeVolume:1.4})`,
 *    лонг+шорт (это и есть «GGI Buy/Sell»);
 *  - реплей = `replayArrowSignals` (per-mode occupancy, как у вендора ~85-90 стрелок);
 *  - геометрия Safe: step=5.5·atr200, стоп=stopSteps·step; тейки/добор — из ArrowTradeReplay.
 *
 * Варианты (arms) — идея автора «фикс 100% у mean, тейк-или-стоп» через флаги движка (default-off):
 *  - BASE           — канон Safe (partial 25% у mean + движущийся opposite-inner, add on, стоп 2×).
 *  - MEANFIX+add    — fullFixAtMean (100% у движущейся mean), add ВКЛ, стоп 2×.
 *  - MEANFIX−add    — fullFixAtMean, add ВЫКЛ (oneR=|entry−stop|), стоп 2× (ближе всего к словам автора).
 *  - MEANFIX−add s1 — то же, стоп короче (stopSteps=1) — ⚠ НЕ авторское число, разведка (§2.1).
 *  - MEANFIX−add s1.5 — то же, stopSteps=1.5 — ⚠ разведка.
 *
 * НЕ строгий reproduce: у нас 20k свечей, у вендора TV-подписка 20k/40k (другое окно) → сверяем
 * «похоже/не похоже», а не пиксель-в-пиксель. Это ДИАГНОСТИКА объекта, БЕЗ плацебо/OOS —
 * честный слой (OOS на невиданных + плацебо + kill «net Result R>0») — отдельным шагом, если похоже.
 *
 * Метрики как на скринах автора: Result R (Σ netR), Result % (Σ per-trade netR·riskPct), WR, take/stop.
 * Запуск: npx tsx ci/research/runE5GgiMeanFix.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { detectArrowSignalCandidates } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayArrowSignals, type ArrowModeConfig, type ArrowTrade } from '../../src/core/signals/ArrowTradeReplay.js'

const ASSETS = ['LDO', 'AVAX', 'ONDO', 'VIRTUAL']
const TFS: Array<[string, string]> = [['5m', '5m'], ['15m', '15m']]
const REL_VOL = 1.4 // frozen OWN2

interface Arm { name: string; override: Partial<ArrowModeConfig> }
const ARMS: Arm[] = [
	{ name: 'BASE (Safe: partial25%+moving, add, stop2x)', override: {} },
	{ name: 'MEANFIX +add (fix100%@mean, add on, stop2x)', override: { fullFixAtMean: true } },
	{ name: 'MEANFIX -add (fix100%@mean, no add, stop2x)', override: { fullFixAtMean: true, addEnabled: false } },
	{ name: 'MEANFIX -add stop1x (короче, НЕ канон)', override: { fullFixAtMean: true, addEnabled: false, stopSteps: 1 } },
	{ name: 'MEANFIX -add stop1.5x (короче, НЕ канон)', override: { fullFixAtMean: true, addEnabled: false, stopSteps: 1.5 } },
]

const cachePath = (asset: string, tfName: string) => resolve('tools/batch/cache', `${asset}-USDT_${tfName}_20000_futures.json`)

function loadCandles(asset: string, tfName: string): Candle[] | null {
	const path = cachePath(asset, tfName)
	if (!existsSync(path)) return null
	let parsed: unknown
	try { parsed = JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
	const arr = Array.isArray(parsed) ? parsed : null
	if (!arr) return null
	const num = (v: unknown): number => typeof v === 'string' ? Number(v) : (v as number)
	const out: Candle[] = []
	for (const raw of arr) {
		if (raw == null) continue
		const r = raw as Record<string, unknown>
		const timestamp = num(r.timestamp ?? r.t ?? r.time ?? r.openTime)
		const open = num(r.open ?? r.o)
		const high = num(r.high ?? r.h)
		const low = num(r.low ?? r.l)
		const close = num(r.close ?? r.c)
		const volume = num(r.volume ?? r.v ?? r.vol ?? 0)
		if (![timestamp, open, high, low, close].every(Number.isFinite)) continue
		out.push({ timestamp: timestamp < 1e12 ? timestamp * 1000 : timestamp, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 })
	}
	out.sort((a, b) => a.timestamp - b.timestamp)
	return out.length ? out : null
}

/** Per-trade риск в % цены: oneR/entry·100. oneR зависит от addEnabled (как в движке). */
function riskPct(t: ArrowTrade, addEnabled: boolean): number {
	const oneR = addEnabled === false
		? Math.abs(t.entry - t.stop)
		: Math.abs((t.entry + t.add) / 2 - t.stop) * 2
	return t.entry > 0 && oneR > 0 ? (oneR / t.entry) * 100 : 0
}

interface Row {
	asset: string; tf: string; arm: string
	n: number; take: number; stop: number; timeout: number; wr: number
	resultR: number; resultPct: number; meanR: number; pf: number | null
	long: number; short: number; medHold: number | null
}

const fmt = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a')
const sr = (x: number) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(2) : 'n/a')

function main() {
	console.log('[e5-ggi] GGI Buy/Sell + фикс у mean на каноническом движке (диагностика объекта)')
	const rows: Row[] = []
	for (const asset of ASSETS) {
		for (const [tfName] of TFS) {
			const candles = loadCandles(asset, tfName)
			if (!candles || candles.length < 500) { console.log(`[e5-ggi] ${asset} ${tfName}: нет данных — пропуск`); continue }
			const bands = computeApexBands(candles, APEX_PARAMS)
			const detection = detectArrowSignalCandidates(candles, APEX_PARAMS, { minimumRelativeVolume: REL_VOL })
			const sigs = detection.candidates
			const spanDays = (candles.at(-1)!.timestamp - candles[0]!.timestamp) / 86_400_000
			console.log(`\n[e5-ggi] ${asset} ${tfName}: свечей=${candles.length} (~${spanDays.toFixed(0)}д), OWN2-кандидатов=${sigs.length}`)
			for (const arm of ARMS) {
				const res = replayArrowSignals(candles, bands, sigs, 'safe', arm.override)
				const s = res.summary
				const addEnabled = arm.override.addEnabled !== false
				const resultPct = res.trades.reduce((acc, t) => acc + (Number.isFinite(t.netR) ? t.netR * riskPct(t, addEnabled) : 0), 0)
				rows.push({
					asset, tf: tfName, arm: arm.name,
					n: s.signals, take: s.fullTp, stop: s.stop, timeout: s.timeout, wr: s.vendorStyleWinrate,
					resultR: s.totalNetR, resultPct, meanR: s.meanNetR ?? NaN, pf: s.profitFactor,
					long: s.long, short: s.short, medHold: s.medianHoldingBars,
				})
				console.log(`  ${arm.name.padEnd(42)} n=${String(s.signals).padStart(3)} take=${String(s.fullTp).padStart(3)} stop=${String(s.stop).padStart(3)} WR=${(s.vendorStyleWinrate * 100).toFixed(1)}% ResultR=${sr(s.totalNetR)} Result%=${sr(resultPct)} meanR=${fmt(s.meanNetR ?? NaN, 3)} PF=${fmt(s.profitFactor ?? NaN)}`)
			}
		}
	}

	// JSON
	writeFileSync(resolve('ci-results/e5-ggi-meanfix.json'), JSON.stringify({
		generatedAt: new Date().toISOString(),
		protocol: 'E5-ggi-meanfix-1.0 (canonical ArrowTradeReplay, OWN2 relVol1.4, mode=safe)',
		note: 'ДИАГНОСТИКА объекта, gross-of-placebo, БЕЗ OOS. net 7bps внутри движка. 20k свечей (вендор мог видеть 40k).',
		assets: ASSETS, tfs: TFS.map((t) => t[0]), relVol: REL_VOL, arms: ARMS.map((a) => ({ name: a.name, override: a.override })),
		rows,
	}, null, 2))

	// Markdown
	const md: string[] = []
	md.push('# E5 — GGI Buy/Sell + фикс у mean (канонический движок, диагностика)')
	md.push('')
	md.push('OWN2-сигнал (relVol 1.4, лонг+шорт), `replayArrowSignals` mode=safe, net 7bps (в движке).')
	md.push('**НЕ** строгий reproduce (у нас 20k свечей; вендор TV мог видеть 20k/40k). БЕЗ плацебо/OOS —')
	md.push('это проверка «похоже ли на цифры автора». Честный слой (OOS+плацебо+«net Result R>0») — отдельно.')
	md.push('')
	md.push('**Result R** = Σ netR; **Result %** = Σ (netR · risk%_сделки); WR = vendor-style (take+partial)/(take+partial+stop).')
	md.push('')
	let curKey = ''
	for (const r of rows) {
		const key = `${r.asset} ${r.tf}`
		if (key !== curKey) {
			curKey = key
			md.push(`## ${key}`)
			md.push('')
			md.push('| arm | n | take | stop | timeout | WR | Result R | Result % | mean R | PF | L/S | medHold |')
			md.push('|---|---|---|---|---|---|---|---|---|---|---|---|')
		}
		md.push(`| ${r.arm} | ${r.n} | ${r.take} | ${r.stop} | ${r.timeout} | ${(r.wr * 100).toFixed(1)}% | ${sr(r.resultR)}R | ${sr(r.resultPct)}% | ${fmt(r.meanR, 3)} | ${fmt(r.pf ?? NaN)} | ${r.long}/${r.short} | ${r.medHold ?? 'n/a'} |`)
		if (rows.indexOf(r) === rows.length - 1 || `${rows[rows.indexOf(r) + 1]!.asset} ${rows[rows.indexOf(r) + 1]!.tf}` !== key) md.push('')
	}
	writeFileSync(resolve('ci-results/e5-ggi-meanfix.md'), md.join('\n'))
	console.log('\n[e5-ggi] written ci-results/e5-ggi-meanfix.{json,md}')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main()
}
