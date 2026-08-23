/**
 * RE3-alt — свип «ГЛУБИНЫ ПРОНИКНОВЕНИЯ» зоны (альтернатива без CSV из TradingView).
 *
 * Контекст (Трек RE, docs/ROADMAP.md). RE2 (`runE5ZoneLagDiagnostic.ts`) показал две крайности
 * определения «зона активна»:
 *   • «мягкая» (distPct-от-mean ≥ minDist) активна на ~75% ВСЕХ баров → тривиальна, мусор;
 *   • «строгое касание края Apex» (f=1.0): cover@±1 = inner 20.6% / outer 0.3% — стрелки вендора
 *     там почти НЕ стоят.
 * Вывод RE2: порог «экстремума» вендора лежит ГДЕ-ТО МЕЖДУ средней и краем полос Apex.
 *
 * Что делает этот раннер. Вместо фиксированного minDist или «касания края» вводит НЕПРЕРЫВНУЮ
 * глубину проникновения f ∈ (0..1] как ДОЛЮ ПУТИ от mean до ВНЕШНЕГО края (redHi / greenLo):
 *   short-порог(f) = mean + f·(redHi − mean),   активация short: high ≥ порог;
 *   long-порог(f)  = mean − f·(mean − greenLo),  активация long:  low  ≤ порог.
 * f→0 ≈ у средней (≈ «мягкая», ~75% баров); f=1 = внешний край (≈ RE2 outer, 0.3%). Свипаем f
 * и ищем глубину, которая ЛУЧШЕ ВСЕГО кроет стрелки вендора ПРИ ВЕНДОРСКОЙ ПЛОТНОСТИ (density∈[0.6,1.6]),
 * и сравниваем recall@±1 с baseline OWN2 (relVol 1.4).
 *
 * Причинность строго трейлинговая (i от WARMUP=210), матч «та же сторона», допуск ±1 бар.
 * Движок src/core НЕ трогается (§2.3/§2.4). Данные/пары/загрузка/скоринг — 1-в-1 из runE5ZoneLagDiagnostic.ts.
 *
 * Запуск: npx tsx ci/research/runRE3PenetrationDepthSweep.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
const WARMUP = 210
const REL_VOL_PERIOD = 20

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

const bar = (ms: number, tfMs: number) => Math.floor(ms / tfMs) * tfMs

interface Arrow { b: number; side: 'long' | 'short' }

/** Причинный relativeVolume: volume[i] / mean(volume, i-period..i-1). Как в ArrowSignalEngine. */
function relativeVolumeAt(candles: Candle[], i: number, period: number): number {
	if (i < period) return 0
	let sum = 0
	for (let j = i - period; j < i; j++) sum += candles[j]!.volume
	return sum > 0 ? candles[i]!.volume / (sum / period) : 0
}

/**
 * Активна ли зона глубины f нужной стороны на баре i.
 * f — доля пути mean→ВНЕШНИЙ край. short: high≥mean+f(redHi−mean); long: low≤mean−f(mean−greenLo).
 */
function depthActiveAt(candles: Candle[], bands: ApexBand[], i: number, side: 'long' | 'short', f: number): boolean {
	if (i < 0 || i >= candles.length) return false
	const b = bands[i]
	if (!b || !Number.isFinite(b.mean) || !Number.isFinite(b.s)) return false
	const c = candles[i]!
	if (side === 'short') {
		const thr = b.mean + f * (b.redHi - b.mean)
		return c.high >= thr
	}
	const thr = b.mean - f * (b.mean - b.greenLo)
	return c.low <= thr
}

// --- Скоринг recall/precision с допуском tol баров (та же сторона) --- (1-в-1 из RE2)
interface Score { vendorN: number; ourN: number; recall: number; precision: number; density: number }
function scoreTol(alerts: Alert[], arrows: Arrow[], tfMs: number, tolBars: number): Score {
	const byBar = new Map<number, Set<'long' | 'short'>>()
	for (const a of arrows) { const s = byBar.get(a.b) ?? new Set<'long' | 'short'>(); s.add(a.side); byBar.set(a.b, s) }
	let matched = 0
	for (const a of alerts) {
		const ab = bar(a.timeMs, tfMs)
		let hit = false
		for (let d = -tolBars; d <= tolBars && !hit; d++) {
			const s = byBar.get(ab + d * tfMs)
			if (s && s.has(a.side)) hit = true
		}
		if (hit) matched++
	}
	const vendorByBar = new Map<number, Set<'long' | 'short'>>()
	for (const a of alerts) { const ab = bar(a.timeMs, tfMs); const s = vendorByBar.get(ab) ?? new Set<'long' | 'short'>(); s.add(a.side); vendorByBar.set(ab, s) }
	let hitArrows = 0
	for (const a of arrows) {
		let hit = false
		for (let d = -tolBars; d <= tolBars && !hit; d++) {
			const s = vendorByBar.get(a.b + d * tfMs)
			if (s && s.has(a.side)) hit = true
		}
		if (hit) hitArrows++
	}
	return {
		vendorN: alerts.length,
		ourN: arrows.length,
		recall: alerts.length ? matched / alerts.length : 0,
		precision: arrows.length ? hitArrows / arrows.length : 0,
		density: alerts.length ? arrows.length / alerts.length : 0,
	}
}

interface Prep { key: string; alerts: Alert[]; candles: Candle[]; bands: ApexBand[]; tfMs: number; own2: Arrow[] }

interface DepthCfg { f: number; relVolMin: number; spacing: number }
function depthFilterCount(c: DepthCfg): number { return (c.relVolMin > 0 ? 1 : 0) }

/** Генерация стрелок по глубине f для одной пары (без armReset — чистый геометрический зонд). */
function genDepthArrows(candles: Candle[], bands: ApexBand[], tfMs: number, cfg: DepthCfg): Arrow[] {
	const raw: Array<{ i: number; side: 'long' | 'short' }> = []
	for (let i = WARMUP; i < candles.length; i++) {
		const b = bands[i]
		if (!b || !Number.isFinite(b.mean) || !Number.isFinite(b.s)) continue
		const relVolOk = cfg.relVolMin <= 0 || relativeVolumeAt(candles, i, REL_VOL_PERIOD) >= cfg.relVolMin
		if (!relVolOk) continue
		// приоритет: если бар пробил обе стороны (редко) — берём более глубокое проникновение как short/long по факту
		if (depthActiveAt(candles, bands, i, 'long', cfg.f)) raw.push({ i, side: 'long' })
		else if (depthActiveAt(candles, bands, i, 'short', cfg.f)) raw.push({ i, side: 'short' })
	}
	// greedy min-spacing per side (в барах)
	const out: Arrow[] = []
	let lastLong = Number.NEGATIVE_INFINITY, lastShort = Number.NEGATIVE_INFINITY
	for (const r of raw) {
		const last = r.side === 'long' ? lastLong : lastShort
		if (r.i - last < cfg.spacing) continue
		out.push({ b: bar(candles[r.i]!.timestamp, tfMs), side: r.side })
		if (r.side === 'long') lastLong = r.i; else lastShort = r.i
	}
	return out
}

async function main() {
	const all = loadVendorAlerts()
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
		const own2 = own2raw
			.filter((c) => c.signalAt >= lo && c.signalAt <= hi)
			.map((c) => ({ b: bar(c.signalAt, tfMs), side: c.side as 'long' | 'short' }))
		preps.push({ key: `${tfName} ${sym}`, alerts, candles, bands, tfMs, own2 })
		console.log(`prep ${tfName} ${sym}: alerts=${alerts.length} candles=${candles.length} own2=${own2.length}`)
	}
	if (!preps.length) throw new Error('Нет пар с достаточным числом алертов / загруженными свечами — данные не сошлись.')

	// baseline OWN2 recall@±1 (взвешенно)
	const aggOwn2 = (): Score => {
		let sv = 0, so = 0, rm = 0, hitSum = 0
		for (const p of preps) { const sc = scoreTol(p.alerts, p.own2, p.tfMs, 1); sv += sc.vendorN; so += sc.ourN; rm += sc.recall * sc.vendorN; hitSum += sc.precision * sc.ourN }
		return { vendorN: sv, ourN: so, recall: sv ? rm / sv : 0, precision: so ? hitSum / so : 0, density: sv ? so / sv : 0 }
	}
	const own2Pm1 = aggOwn2()

	// activationDensity(f): доля ВСЕХ баров (i≥WARMUP), где глубина f активна хоть на какую-то сторону
	const activationDensity = (f: number): number => {
		let total = 0, active = 0
		for (const p of preps) for (let i = WARMUP; i < p.candles.length; i++) {
			total++
			if (depthActiveAt(p.candles, p.bands, i, 'long', f) || depthActiveAt(p.candles, p.bands, i, 'short', f)) active++
		}
		return total ? active / total : 0
	}

	// агрегатор score по конфигу (взвешенно), матч ±1
	interface DepthRow { cfg: DepthCfg; agg: Score; activationDensity: number; perPair: Array<{ key: string; sc: Score }> }
	const evalDepth = (cfg: DepthCfg): DepthRow => {
		let sv = 0, so = 0, rm = 0, hitSum = 0
		const perPair: Array<{ key: string; sc: Score }> = []
		for (const p of preps) {
			const arrows = genDepthArrows(p.candles, p.bands, p.tfMs, cfg)
			const sc = scoreTol(p.alerts, arrows, p.tfMs, 1)
			perPair.push({ key: p.key, sc })
			sv += sc.vendorN; so += sc.ourN; rm += sc.recall * sc.vendorN; hitSum += sc.precision * sc.ourN
		}
		return {
			cfg,
			agg: { vendorN: sv, ourN: so, recall: sv ? rm / sv : 0, precision: so ? hitSum / so : 0, density: sv ? so / sv : 0 },
			activationDensity: activationDensity(cfg.f),
			perPair,
		}
	}

	// ============ БЛОК 1 — f-КРИВАЯ (чистая зона: relVol=0, spacing=1) ============
	const DEPTH_FRAC = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
	const fCurve = DEPTH_FRAC.map((f) => evalDepth({ f, relVolMin: 0, spacing: 1 }))

	// ============ БЛОК 2 — ПОЛНЫЙ СВИП f × relVol × spacing ============
	const REL_GRID = [0, 1.0, 1.4]
	const SPACING_GRID = [1, 3, 10]
	const rows: DepthRow[] = []
	for (const f of DEPTH_FRAC)
		for (const relVolMin of REL_GRID)
			for (const spacing of SPACING_GRID)
				rows.push(evalDepth({ f, relVolMin, spacing }))

	// вендорская плотность: density∈[0.6,1.6]; ранжируем по recall
	const inBudget = rows.filter((r) => r.agg.density >= 0.6 && r.agg.density <= 1.6)
	const ranked = [...inBudget].sort((a, b) => b.agg.recall - a.agg.recall || b.agg.precision - a.agg.precision || a.agg.density - b.agg.density)
	const top15 = ranked.slice(0, 15)
	const best = top15[0] ?? null

	// разбивка лучшего по парам (+ OWN2 recall для сравнения)
	const bestPerPair = best
		? best.perPair.map((pp) => {
			const p = preps.find((x) => x.key === pp.key)!
			const own2sc = scoreTol(p.alerts, p.own2, p.tfMs, 1)
			return { key: pp.key, vendorN: pp.sc.vendorN, ourN: pp.sc.ourN, density: pp.sc.density, recall: pp.sc.recall, precision: pp.sc.precision, own2Recall: own2sc.recall }
		})
		: []

	const beatsOwn2 = best ? best.agg.recall > own2Pm1.recall : false

	// ---------- ВЫВОД ----------
	const pc = (x: number) => (x * 100).toFixed(1) + '%'
	const md: string[] = []
	md.push('# RE3-alt — свип глубины проникновения зоны (доля пути mean→край), без CSV')
	md.push('')
	md.push('Альтернатива RE3 без экспорта TradingView. RE2 показал: «мягкая» зона тривиальна (~75% баров), «касание края» (f=1) стрелки вендора почти не кроет (inner 20.6% / outer 0.3%) → истинный порог экстремума лежит МЕЖДУ средней и краем. Здесь вводим непрерывную глубину f∈(0..1] как долю пути mean→ВНЕШНИЙ край (short: high≥mean+f·(redHi−mean); long: low≤mean−f·(mean−greenLo)) и ищем f, лучше всего кроющую стрелки вендора при вендорской плотности. Движок не трогается. Причинность трейлинговая (i≥210), матч «та же сторона» ±1 бар, фид futures.')
	md.push('')
	md.push(`**Baseline OWN2 (relVol1.4) recall@±1:** vendorN=${own2Pm1.vendorN} ourN=${own2Pm1.ourN} density=×${own2Pm1.density.toFixed(1)} recall=**${pc(own2Pm1.recall)}** precision=${pc(own2Pm1.precision)}`)
	md.push('')
	md.push('## БЛОК 1 — f-КРИВАЯ (чистая зона, relVol=0, spacing=1)')
	md.push('')
	md.push('activationDensity — доля ВСЕХ баров (i≥210) с активной зоной хоть на какую-то сторону (f→0 ≈ мягкая ~75%, f=1 ≈ край RE2). density=×(наши/вендор). recall/precision — матч ±1 бар.')
	md.push('')
	md.push('| f (доля mean→край) | activationDensity | ourN | density | recall | precision |')
	md.push('|---|---|---|---|---|---|')
	for (const r of fCurve) md.push(`| ${r.cfg.f.toFixed(2)} | ${pc(r.activationDensity)} | ${r.agg.ourN} | ×${r.agg.density.toFixed(1)} | ${pc(r.agg.recall)} | ${pc(r.agg.precision)} |`)
	md.push('')
	md.push('## БЛОК 2 — ПОЛНЫЙ СВИП f × relVolMin × spacing (при вендорской плотности)')
	md.push('')
	md.push(`Сетка: f∈{${DEPTH_FRAC.join(',')}} × relVolMin∈{${REL_GRID.join(',')}} × spacing∈{${SPACING_GRID.join(',')}} (${rows.length} конфигов). Отбор: density∈[0.6,1.6] (${inBudget.length} конфигов), ранжирование по recall@±1.`)
	md.push('')
	md.push('ТОП-15 в бюджете плотности:')
	md.push('')
	md.push('| f | relVolMin | spacing | activationDensity | density | recall | precision |')
	md.push('|---|---|---|---|---|---|---|')
	for (const r of top15) md.push(`| ${r.cfg.f.toFixed(2)} | ${r.cfg.relVolMin} | ${r.cfg.spacing} | ${pc(r.activationDensity)} | ×${r.agg.density.toFixed(2)} | ${pc(r.agg.recall)} | ${pc(r.agg.precision)} |`)
	md.push('')
	if (best) {
		md.push('### Разбивка лучшего конфига по парам (+ OWN2 recall)')
		md.push('')
		md.push(`Лучший: f=${best.cfg.f.toFixed(2)} relVolMin=${best.cfg.relVolMin} spacing=${best.cfg.spacing} → density=×${best.agg.density.toFixed(2)} recall=**${pc(best.agg.recall)}** precision=${pc(best.agg.precision)}.`)
		md.push('')
		md.push('| пара | vendorN | ourN | density | recall | precision | OWN2 recall |')
		md.push('|---|---|---|---|---|---|---|')
		for (const r of bestPerPair) md.push(`| ${r.key} | ${r.vendorN} | ${r.ourN} | ×${r.density.toFixed(2)} | ${pc(r.recall)} | ${pc(r.precision)} | ${pc(r.own2Recall)} |`)
		md.push('')
	}
	md.push('## ВЫВОД')
	md.push('')
	md.push(`1. **Есть ли глубина, кроющая вендора лучше OWN2 при вендорской плотности?** OWN2 recall@±1 = **${pc(own2Pm1.recall)}**; лучший depth-конфиг recall@±1 = **${best ? pc(best.agg.recall) : '—'}** (f=${best ? best.cfg.f.toFixed(2) : '—'}, density ×${best ? best.agg.density.toFixed(2) : '—'}) → depth-зона ${beatsOwn2 ? '**ОБГОНЯЕТ** OWN2' : '**НЕ обгоняет** OWN2'}.`)
	md.push(`2. **Где сидит истинный порог?** По f-кривой видно, на какой доле пути mean→край recall максимален при падающей плотности — это оценка глубины «экстремума» вендора без CSV. Точную линию зоны всё равно даст только TradingView-экспорт (RE3 основной).`)
	md.push(`3. Вендорская плотность density∈[0.6,1.6] ${inBudget.length ? '**достижима**' : '**НЕ достигнута** в этой сетке'} (${inBudget.length} конфигов).`)
	md.push('')

	writeFileSync(resolve('ci-results/re3-penetration-depth-sweep.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/re3-penetration-depth-sweep.json'), JSON.stringify({
		generatedAt: new Date().toISOString(),
		definition: {
			depthFraction: 'доля пути mean→ВНЕШНИЙ край (redHi / greenLo)',
			shortActivation: 'high >= mean + f*(redHi - mean)',
			longActivation: 'low <= mean - f*(mean - greenLo)',
			matchTolBars: 1, warmup: WARMUP, relVolPeriod: REL_VOL_PERIOD,
		},
		pairs: preps.map((p) => ({ key: p.key, vendorN: p.alerts.length, candles: p.candles.length, own2: p.own2.length })),
		own2Baseline: own2Pm1,
		grid: { depthFrac: DEPTH_FRAC, relVolMin: REL_GRID, spacing: SPACING_GRID, gridSize: rows.length },
		fCurve: fCurve.map((r) => ({ ...r.cfg, activationDensity: r.activationDensity, ...r.agg })),
		densityWindow: [0.6, 1.6],
		eligibleCount: inBudget.length,
		top15: top15.map((r) => ({ ...r.cfg, activationDensity: r.activationDensity, ...r.agg })),
		best: best ? { ...best.cfg, activationDensity: best.activationDensity, ...best.agg, perPair: bestPerPair } : null,
		beatsOwn2,
		vendorDensityAchievable: inBudget.length > 0,
		all: rows.map((r) => ({ ...r.cfg, activationDensity: r.activationDensity, ...r.agg })),
	}, null, 2))

	console.log('\n=== RE3-alt — f-КРИВАЯ ===')
	for (const r of fCurve) console.log(`f=${r.cfg.f.toFixed(2)} actDens=${pc(r.activationDensity)} ourN=${r.agg.ourN} density=×${r.agg.density.toFixed(1)} recall=${pc(r.agg.recall)} prec=${pc(r.agg.precision)}`)
	console.log(`\nOWN2 baseline recall@±1 = ${pc(own2Pm1.recall)} (density ×${own2Pm1.density.toFixed(1)})`)
	console.log(best ? `BEST in-budget: f=${best.cfg.f.toFixed(2)} relVol=${best.cfg.relVolMin} spacing=${best.cfg.spacing} recall=${pc(best.agg.recall)} density=×${best.agg.density.toFixed(2)} → beatsOwn2=${beatsOwn2}` : 'BEST: нет конфигов в density∈[0.6,1.6]')
	console.log('\nЗаписано: ci-results/re3-penetration-depth-sweep.{md,json}')
}

main().catch((e) => { console.error(e); process.exit(1) })
