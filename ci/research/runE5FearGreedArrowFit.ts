/**
 * E5-fg-fit — REVERSE-ENGINEERING стрелки вендора (по явному запросу автора; §2.1 снят автором).
 *
 * Подсказки автора: GGI Buy/Sell = позиция в зоне (GGI Zone = наш Apex, уже используем) +
 * «упрощённая формула СТРАХА/ЖАДНОСТИ», чисто по свечам (PineScript invite-only → без внешних данных).
 * Наш OWN2 вместо F&G берёт relVol+направление свечи — вероятная причина расхождения (×2-4 плотность, recall 10-22%).
 *
 * Гипотеза: стрелка = Apex-зона (экстремум) + свечной F&G-осциллятор на экстремуме/кроссе.
 * F&G = w·RSI(n) + (1−w)·StochPos(n), оба [0..100], причинно. Long — фаза страха (F&G низко),
 * short — жадности (F&G высоко). Триггер: level (F&G за порогом) или cross (возврат из-за порога).
 *
 * Ground-truth: 1692 РЕАЛЬНЫХ scalp-алерта вендора (`tg_topic_16293_scalp.json`). Фит = максимум recall
 * (±1 бар, та же сторона) при плотности ≈ вендорской (не переполнять). Baseline — наш OWN2 relVol1.4.
 * Движок/детектор НЕ трогаю — это отдельный экспериментальный триггер в раннере.
 *
 * Запуск: npx tsx ci/research/runE5FearGreedArrowFit.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS, type ApexBand } from '../../src/core/signals/ApexEngine.js'
import { detectArrowSignalCandidates } from '../../src/core/signals/ArrowSignalEngine.js'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'
import { TF_MS } from '../../tools/shared/candleFetcher.js'

const CACHE = resolve('tmp/viz-archive-cache')
const PAIRS: Array<[string, number, string]> = [
	['VIRTUAL', 5, '5m'], ['BNB', 5, '5m'], ['ETH', 5, '5m'],
	['OP', 15, '15m'], ['CRV', 15, '15m'], ['ONDO', 15, '15m'],
]
const MIN_ALERTS = 8

interface Alert { symbol: string; tfMin: number; side: 'long' | 'short'; timeMs: number }
function loadVendorAlerts(): Alert[] {
	const raw = JSON.parse(readFileSync(resolve('data/vendor-exports/tg_topic_16293_scalp.json'), 'utf8')) as Array<{ date: string; text: string }>
	const out: Alert[] = []
	for (const m of raw) {
		const mm = (m.text || '').match(/Сигнал в (ЛОНГ|ШОРТ)\s+([A-Z0-9]+)USDT\.P\s+(\d+)/)
		if (!mm) continue
		out.push({ symbol: mm[2]!, tfMin: Number(mm[3]), side: mm[1] === 'ЛОНГ' ? 'long' : 'short', timeMs: Date.parse(m.date) })
	}
	return out
}

// causal RSI (Wilder)
function rsiSeries(c: Candle[], n: number): number[] {
	const out = new Array<number>(c.length).fill(NaN)
	let au = 0, ad = 0
	for (let i = 1; i < c.length; i++) {
		const ch = c[i]!.close - c[i - 1]!.close
		const u = Math.max(0, ch), d = Math.max(0, -ch)
		if (i <= n) { au += u; ad += d; if (i === n) { au /= n; ad /= n; out[i] = ad === 0 ? 100 : 100 - 100 / (1 + au / ad) } }
		else { au = (au * (n - 1) + u) / n; ad = (ad * (n - 1) + d) / n; out[i] = ad === 0 ? 100 : 100 - 100 / (1 + au / ad) }
	}
	return out
}
// causal stochastic position (close vs rolling hi/lo)
function stochSeries(c: Candle[], n: number): number[] {
	const out = new Array<number>(c.length).fill(NaN)
	for (let i = n - 1; i < c.length; i++) {
		let hi = -Infinity, lo = Infinity
		for (let j = i - n + 1; j <= i; j++) { hi = Math.max(hi, c[j]!.high); lo = Math.min(lo, c[j]!.low) }
		out[i] = hi > lo ? 100 * (c[i]!.close - lo) / (hi - lo) : 50
	}
	return out
}

interface Cfg { n: number; w: number; tLo: number; tHi: number; trig: 'level' | 'cross'; zone: boolean; spacing: number }
interface Arrow { b: number; side: 'long' | 'short' }

function genArrows(c: Candle[], bands: ApexBand[], fg: number[], cfg: Cfg, tfMs: number): Arrow[] {
	const raw: Array<{ i: number; side: 'long' | 'short' }> = []
	for (let i = 210; i < c.length; i++) {
		const b = bands[i]; if (!b || !Number.isFinite(b.mean) || !Number.isFinite(b.s)) continue
		const f = fg[i]!, fp = fg[i - 1]!
		if (!Number.isFinite(f) || !Number.isFinite(fp)) continue
		// zone gate (Apex extreme): цена достаточно далеко от mean в сторону зоны
		const distPct = Math.abs(c[i]!.close - b.mean) / b.mean * 100
		const bandStdPct = b.s * 100
		const minDist = Math.min(3, Math.max(0.15, bandStdPct * 0.8))
		const inZoneLong = c[i]!.close < b.mean && (!cfg.zone || distPct >= minDist)
		const inZoneShort = c[i]!.close > b.mean && (!cfg.zone || distPct >= minDist)
		// F&G trigger
		let longSig = false, shortSig = false
		if (cfg.trig === 'level') { longSig = f <= cfg.tLo; shortSig = f >= cfg.tHi }
		else { longSig = fp <= cfg.tLo && f > cfg.tLo; shortSig = fp >= cfg.tHi && f < cfg.tHi } // cross back out
		if (longSig && inZoneLong) raw.push({ i, side: 'long' })
		else if (shortSig && inZoneShort) raw.push({ i, side: 'short' })
	}
	// greedy min-spacing (bars), global
	const out: Arrow[] = []
	let last = -Infinity
	for (const r of raw) { if (r.i - last < cfg.spacing) continue; out.push({ b: Math.floor(c[r.i]!.timestamp / tfMs) * tfMs, side: r.side }); last = r.i }
	return out
}

const bar = (ms: number, tfMs: number) => Math.floor(ms / tfMs) * tfMs

interface Score { vendorN: number; ourN: number; recall: number; precision: number; density: number }
function score(alerts: Alert[], arrows: Arrow[], tfMs: number): Score {
	const byBar = new Map<number, Set<'long' | 'short'>>()
	for (const a of arrows) { const s = byBar.get(a.b) ?? new Set(); s.add(a.side); byBar.set(a.b, s) }
	const near = (b: number) => [...(byBar.get(b - tfMs) ?? []), ...(byBar.get(b) ?? []), ...(byBar.get(b + tfMs) ?? [])]
	let matched = 0
	for (const a of alerts) { if (near(bar(a.timeMs, tfMs)).includes(a.side)) matched++ }
	const vendorBars = new Set(alerts.map((a) => bar(a.timeMs, tfMs)))
	let hit = 0
	for (const a of arrows) if (vendorBars.has(a.b - tfMs) || vendorBars.has(a.b) || vendorBars.has(a.b + tfMs)) hit++
	return { vendorN: alerts.length, ourN: arrows.length, recall: alerts.length ? matched / alerts.length : 0, precision: arrows.length ? hit / arrows.length : 0, density: alerts.length ? arrows.length / alerts.length : 0 }
}

// grid
const GRID: Cfg[] = []
for (const n of [7, 14, 21]) for (const w of [1, 0.5, 0]) for (const [tLo, tHi] of [[20, 80], [25, 75], [30, 70], [35, 65]] as Array<[number, number]>)
	for (const trig of ['level', 'cross'] as const) for (const zone of [true, false]) for (const spacing of [3, 10])
		GRID.push({ n, w, tLo, tHi, trig, zone, spacing })

async function main() {
	const all = loadVendorAlerts()
	// подготовка данных по парам
	interface Prep { key: string; alerts: Alert[]; candles: Candle[]; bands: ApexBand[]; tfMs: number; own2: Arrow[] }
	const preps: Prep[] = []
	for (const [sym, tfMin, tfName] of PAIRS) {
		const alerts = all.filter((a) => a.symbol === sym && a.tfMin === tfMin)
		if (alerts.length < MIN_ALERTS) continue
		const tfMs = TF_MS[tfName]!
		const times = alerts.map((a) => a.timeMs).sort((x, y) => x - y)
		let candles: Candle[]
		try { candles = await fetchArchiveKlines(`${sym}/USDT`, tfName, 'futures', times[0]! - 500 * tfMs, times[times.length - 1]! + tfMs, { cacheDir: CACHE, parallel: 8 }) } catch { continue }
		if (!candles || candles.length < 400) continue
		const bands = computeApexBands(candles, APEX_PARAMS)
		const lo = times[0]! - tfMs, hi = times[times.length - 1]! + tfMs
		const own2raw = detectArrowSignalCandidates(candles, APEX_PARAMS, { minimumRelativeVolume: 1.4 }).candidates
		const own2 = own2raw.filter((c) => c.signalAt >= lo && c.signalAt <= hi).map((c) => ({ b: bar(c.signalAt, tfMs), side: c.side as 'long' | 'short' }))
		preps.push({ key: `${tfName} ${sym}`, alerts, candles, bands, tfMs, own2 })
		console.log(`prep ${tfName} ${sym}: alerts=${alerts.length} candles=${candles.length}`)
	}

	// precompute FG series per prep per n
	const fgCache = new Map<string, number[]>()
	const fgOf = (p: Prep, n: number, w: number): number[] => {
		const rk = `${p.key}|rsi${n}`, sk = `${p.key}|st${n}`
		if (!fgCache.has(rk)) fgCache.set(rk, rsiSeries(p.candles, n))
		if (!fgCache.has(sk)) fgCache.set(sk, stochSeries(p.candles, n))
		const r = fgCache.get(rk)!, s = fgCache.get(sk)!
		return r.map((rv, i) => w * rv + (1 - w) * s[i]!)
	}

	// baseline OWN2 aggregate
	const aggScore = (fn: (p: Prep) => Arrow[]) => {
		let sv = 0, so = 0, rm = 0, hitSum = 0
		for (const p of preps) { const sc = score(p.alerts, fn(p), p.tfMs); sv += sc.vendorN; so += sc.ourN; rm += sc.recall * sc.vendorN; hitSum += sc.precision * sc.ourN }
		return { vendorN: sv, ourN: so, recall: sv ? rm / sv : 0, precision: so ? hitSum / so : 0, density: sv ? so / sv : 0 }
	}
	const own2Agg = aggScore((p) => p.own2)

	// grid search
	interface Row { cfg: Cfg; agg: ReturnType<typeof aggScore> }
	const rows: Row[] = []
	for (const cfg of GRID) {
		const agg = aggScore((p) => genArrows(p.candles, p.bands, fgOf(p, cfg.n, cfg.w), cfg, p.tfMs))
		rows.push({ cfg, agg })
	}
	// ранжируем: recall при плотности в [0.6, 1.6] (не переполнять и не пусто); tie → precision
	const eligible = rows.filter((r) => r.agg.density >= 0.6 && r.agg.density <= 1.6)
	const rank = (eligible.length ? eligible : rows).sort((a, b) => b.agg.recall - a.agg.recall || b.agg.precision - a.agg.precision)
	const top = rank.slice(0, 15)

	const cfgStr = (c: Cfg) => `n${c.n} w${c.w} T${c.tLo}/${c.tHi} ${c.trig} zone:${c.zone ? 'on' : 'off'} sp${c.spacing}`
	const pc = (x: number) => (x * 100).toFixed(0) + '%'

	const md: string[] = []
	md.push('# E5 — reverse-engineering стрелки: F&G-осциллятор поверх Apex vs OWN2 (fit к 1692 алертам вендора)')
	md.push('')
	md.push('F&G = w·RSI(n) + (1−w)·StochPos(n) (свечной, причинный). Long — фаза страха, short — жадности. Триггер level/cross, зона Apex on/off.')
	md.push('Fit к реальным scalp-алертам (`tg_topic_16293_scalp.json`), фид futures, матч ±1 бар, та же сторона. Метрика: recall при density∈[0.6,1.6].')
	md.push('')
	md.push(`**Baseline OWN2 (relVol1.4):** vendorN=${own2Agg.vendorN} ourN=${own2Agg.ourN} density=×${own2Agg.density.toFixed(1)} recall=${pc(own2Agg.recall)} precision=${pc(own2Agg.precision)}`)
	md.push('')
	md.push('## Топ-15 F&G-конфигов (по recall при разумной плотности)')
	md.push('')
	md.push('| конфиг | density | recall | precision |')
	md.push('|---|---|---|---|')
	for (const r of top) md.push(`| ${cfgStr(r.cfg)} | ×${r.agg.density.toFixed(1)} | ${pc(r.agg.recall)} | ${pc(r.agg.precision)} |`)
	md.push('')
	// лучший конфиг — разбивка по парам
	const best = rank[0]!
	md.push(`## Лучший конфиг по парам: ${cfgStr(best.cfg)}`)
	md.push('')
	md.push('| пара | vendorN | ourN | density | recall | precision |  OWN2 recall |')
	md.push('|---|---|---|---|---|---|---|')
	for (const p of preps) {
		const sc = score(p.alerts, genArrows(p.candles, p.bands, fgOf(p, best.cfg.n, best.cfg.w), best.cfg, p.tfMs), p.tfMs)
		const o = score(p.alerts, p.own2, p.tfMs)
		md.push(`| ${p.key} | ${sc.vendorN} | ${sc.ourN} | ×${sc.density.toFixed(1)} | ${pc(sc.recall)} | ${pc(sc.precision)} | ${pc(o.recall)} |`)
	}
	md.push('')
	writeFileSync(resolve('ci-results/e5-fg-arrow-fit.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/e5-fg-arrow-fit.json'), JSON.stringify({ generatedAt: new Date().toISOString(), own2: own2Agg, top: top.map((r) => ({ ...r.cfg, ...r.agg })), gridSize: GRID.length }, null, 2))

	console.log(`\nOWN2 baseline: recall=${pc(own2Agg.recall)} precision=${pc(own2Agg.precision)} density=×${own2Agg.density.toFixed(1)}`)
	console.log('Топ F&G:')
	for (const r of top.slice(0, 8)) console.log(`  ${cfgStr(r.cfg).padEnd(46)} density=×${r.agg.density.toFixed(1)} recall=${pc(r.agg.recall)} precision=${pc(r.agg.precision)}`)
	console.log('\n[fg-fit] written ci-results/e5-fg-arrow-fit.{md,json}')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((e) => { console.error(e); process.exitCode = 1 })
}
