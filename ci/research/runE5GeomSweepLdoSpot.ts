/**
 * E5-geom-sweep — ДИАГНОСТИЧЕСКИЙ свип геометрии стопа на LDO 15m Binance SPOT.
 *
 * Зачем: reproduce не сошёлся (см. e5-ggi-ldo-spot.md). Якорь расхождения — средний
 * стоп: вендор −1.86%, наш канон (stop 2×, step=5.5·atr200) ~−11%. R-юнит у нас
 * в ~6× шире. Вопрос автора: подобрать geometry (stepDivisor + stopSteps) так, чтобы
 * средний стоп сел на ~1.86%, и посмотреть — станет ли Result R положительным.
 *
 * ⚠ Прод-константы НЕ меняются (§2.2/2.4): step = 5.5·atr200/stepDivisor и stopSteps
 * подаются как override в `replayArrowSignals`. ARROW_MODE_CONFIGS не трогаем.
 * В safe-режиме тейки — у band.mean/opposite-inner (не зависят от step), поэтому
 * сужение стопа реально меняет R:R. Это разведка «какая линейка воспроизводит вендора»,
 * НЕ смена дефолтов и НЕ вывод об эдже (плацебо/OOS — отдельно).
 *
 * Запуск: npx tsx ci/research/runE5GeomSweepLdoSpot.ts
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { detectArrowSignalCandidates } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayArrowSignals, type ArrowModeConfig, type ArrowTrade } from '../../src/core/signals/ArrowTradeReplay.js'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'

const SYMBOL = 'LDO/USDT'
const TF = '15m'
const REL_VOL = 1.4
const FROM = Date.UTC(2024, 6, 1)
const CACHE = resolve('tmp/viz-archive-cache')
const WINDOW = 20_000 // окно как у baseline (spot 40k reproduce был ещё хуже)

const VENDOR = { trades: 89, wr: 62.9, resultR: 15.25, resultPct: 28.32, avgStopPct: -1.86 }
const TARGET_LO = -2.1, TARGET_HI = -1.6 // «сел на ~1.86%»

// Свип: делитель шага (больше → уже стоп) × множитель стопа. Канон safe: stepDivisor 1, stopSteps 2.
const STEP_DIVISORS = [1, 1.5, 2, 3, 4, 5, 6, 7, 8]
const STOP_STEPS = [1, 1.5, 2]

interface Mgmt { name: string; base: Partial<ArrowModeConfig>; addEnabled: boolean }
const MGMTS: Mgmt[] = [
	{ name: 'BASE (dynamic partial25%, add on)', base: {}, addEnabled: true },
	{ name: 'MEANFIX (fix100%@mean, add off)', base: { fullFixAtMean: true, addEnabled: false }, addEnabled: false },
]

function riskPct(t: ArrowTrade, addEnabled: boolean): number {
	const oneR = addEnabled === false ? Math.abs(t.entry - t.stop) : Math.abs((t.entry + t.add) / 2 - t.stop) * 2
	return t.entry > 0 && oneR > 0 ? (oneR / t.entry) * 100 : 0
}

interface Row { mgmt: string; stepDivisor: number; stopSteps: number; trades: number; wr: number; resultR: number; resultPct: number; avgStopPct: number | null; longR: number; shortR: number; hitTarget: boolean }

function evalCombo(mgmt: Mgmt, candles: Candle[], bands: ReturnType<typeof computeApexBands>, sigs: ReturnType<typeof detectArrowSignalCandidates>['candidates'], stepDivisor: number, stopSteps: number): Row {
	const override: Partial<ArrowModeConfig> = { ...mgmt.base, stepDivisor, stopSteps }
	const res = replayArrowSignals(candles, bands, sigs, 'safe', override)
	const ts = res.trades
	const win = (t: ArrowTrade) => t.outcome === 'full-tp' || t.outcome === 'partial-be' || t.outcome === 'partial-stop'
	const take = ts.filter((t) => t.outcome === 'full-tp' || t.outcome === 'partial-be' || t.outcome === 'partial-stop').length
	const stop = ts.filter((t) => t.outcome === 'stop').length
	const finalized = take + stop
	const wr = finalized ? ts.filter(win).length / finalized : 0
	const sum = (arr: ArrowTrade[], f: (t: ArrowTrade) => number) => arr.reduce((a, t) => a + (Number.isFinite(f(t)) ? f(t) : 0), 0)
	const resultR = sum(ts, (t) => t.netR)
	const resultPct = sum(ts, (t) => t.netR * riskPct(t, mgmt.addEnabled))
	const stopped = ts.filter((t) => t.outcome === 'stop')
	const avgStopPct = stopped.length ? sum(stopped, (t) => t.netR * riskPct(t, mgmt.addEnabled)) / stopped.length : null
	const longR = sum(ts.filter((t) => t.side === 'long'), (t) => t.netR)
	const shortR = sum(ts.filter((t) => t.side === 'short'), (t) => t.netR)
	return { mgmt: mgmt.name, stepDivisor, stopSteps, trades: finalized, wr, resultR, resultPct, avgStopPct, longR, shortR, hitTarget: avgStopPct != null && avgStopPct <= TARGET_HI && avgStopPct >= TARGET_LO }
}

const sr = (x: number, d = 2) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(d) : 'n/a')

async function main() {
	console.log('[e5-geom-sweep] LDO/USDT 15m SPOT из архивов …')
	const full = await fetchArchiveKlines(SYMBOL, TF, 'spot', FROM, Date.now(), { cacheDir: CACHE, parallel: 8 })
	const candles = full.slice(-WINDOW)
	const bands = computeApexBands(candles, APEX_PARAMS)
	const sigs = detectArrowSignalCandidates(candles, APEX_PARAMS, { minimumRelativeVolume: REL_VOL }).candidates
	console.log(`[e5-geom-sweep] окно ${candles.length} свечей (${new Date(candles[0]!.timestamp).toISOString().slice(0, 10)}→${new Date(candles.at(-1)!.timestamp).toISOString().slice(0, 10)}), OWN2=${sigs.length}`)

	const rows: Row[] = []
	for (const mgmt of MGMTS) {
		for (const sd of STEP_DIVISORS) {
			for (const ss of STOP_STEPS) rows.push(evalCombo(mgmt, candles, bands, sigs, sd, ss))
		}
	}

	const md: string[] = []
	md.push('# E5 geom-sweep — LDO 15m Binance SPOT: подбор геометрии под стоп ≈ −1.86% (вендор)')
	md.push('')
	md.push(`Окно ${candles.length} свечей, OWN2=${sigs.length}. `)
	md.push('Свип `stepDivisor` × `stopSteps` через override (прод-константы не тронуты, §2.2/2.4). Канон safe = stepDivisor 1, stopSteps 2.')
	md.push('Цель: средний стоп в [−2.1%, −1.6%] (у вендора −1.86%). **★** = попал в цель. Диагностика, БЕЗ плацебо/OOS.')
	md.push('')
	md.push(`**Эталон вендора:** trades ${VENDOR.trades}, WR ${VENDOR.wr}%, avgStop ${VENDOR.avgStopPct}%, Result ${sr(VENDOR.resultR)}R / ${sr(VENDOR.resultPct)}%.`)
	md.push('')
	for (const mgmt of MGMTS) {
		md.push(`## ${mgmt.name}`)
		md.push('')
		md.push('| stepDiv | stopSteps | trades | WR | avgStop % | Result R | (long/short R) | Result % | цель |')
		md.push('|---|---|---|---|---|---|---|---|---|')
		for (const r of rows.filter((x) => x.mgmt === mgmt.name)) {
			const canon = r.stepDivisor === 1 && r.stopSteps === 2 ? ' _(канон)_' : ''
			md.push(`| ${r.stepDivisor}${canon} | ${r.stopSteps} | ${r.trades} | ${(r.wr * 100).toFixed(1)}% | ${r.avgStopPct == null ? 'n/a' : sr(r.avgStopPct)}% | ${sr(r.resultR)}R | ${sr(r.longR)}/${sr(r.shortR)} | ${sr(r.resultPct)}% | ${r.hitTarget ? '★' : ''} |`)
		}
		md.push('')
	}
	const hits = rows.filter((r) => r.hitTarget)
	md.push('## Итог — комбинации, попавшие в стоп ≈ −1.86%')
	md.push('')
	if (!hits.length) md.push('_Ни одна комбинация из сетки не села в целевой диапазон._')
	else {
		md.push('| mgmt | stepDiv | stopSteps | trades | WR | avgStop % | Result R | Result % |')
		md.push('|---|---|---|---|---|---|---|---|')
		for (const r of hits.sort((a, b) => b.resultR - a.resultR)) {
			md.push(`| ${r.mgmt} | ${r.stepDivisor} | ${r.stopSteps} | ${r.trades} | ${(r.wr * 100).toFixed(1)}% | ${sr(r.avgStopPct ?? NaN)}% | ${sr(r.resultR)}R | ${sr(r.resultPct)}% |`)
		}
	}
	md.push('')
	writeFileSync(resolve('ci-results/e5-geom-sweep-ldo-spot.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/e5-geom-sweep-ldo-spot.json'), JSON.stringify({ generatedAt: new Date().toISOString(), protocol: 'E5-geom-sweep-1.0 (override-only, canonical engine, Binance spot)', symbol: SYMBOL, tf: TF, window: candles.length, own2: sigs.length, vendor: VENDOR, target: [TARGET_LO, TARGET_HI], rows }, null, 2))

	// консоль: только цель + канон-строки
	console.log('\nЦелевые комбинации (стоп ≈ −1.86%):')
	if (!hits.length) console.log('  нет попаданий в сетке')
	for (const r of hits.sort((a, b) => b.resultR - a.resultR)) {
		console.log(`  ${r.mgmt.padEnd(34)} stepDiv=${r.stepDivisor} stopSteps=${r.stopSteps} trades=${r.trades} WR=${(r.wr * 100).toFixed(1)}% avgStop=${sr(r.avgStopPct ?? NaN)}% ResultR=${sr(r.resultR)} (L${sr(r.longR)}/S${sr(r.shortR)}) Result%=${sr(r.resultPct)}`)
	}
	console.log('\n[e5-geom-sweep] written ci-results/e5-geom-sweep-ldo-spot.{md,json}')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((e) => { console.error(e); process.exitCode = 1 })
}
