/**
 * E5-zone-lag-diagnostic — ДИАГНОСТИКА реверс-инжиниринга стрелки GGI Buy/Sell.
 *
 * Контекст. Прошлый прогон (e5-fg-arrow-fit) показал: наш OWN2 при плотности ×3.3 ловит
 * лишь ~19% алертов вендора (recall 19% / precision 6%), а F&G-триггер поверх той же зоны
 * даёт ~1%. Диагноз оттуда: узкое место — слой ЗОНЫ (Apex vs GGI Zone). ~80% стрелок вендора
 * стоят на барах, где НАША зона молчит. То есть проблема не в свечном триггере, а в геометрии
 * зоны и/или в тайминге постинга алерта.
 *
 * Что делает этот раннер (НЕинвазивно; src/core НЕ трогается — все вариации через
 * Partial<ApexParams> в computeApexBands, §2.4). Разделяет ДВЕ причины разрыва:
 *   (C) ЛАГ ТАЙМИНГА — вендор постит стрелку с задержкой/раньше нашего бара. Меряется
 *       лаг-кривой recall/precision по допуску tol∈{0,1,2,3,5,8} баров: если recall
 *       насыщается к ±2–3 барам — разрыв это лаг, а не несовпадение.
 *   (A) РЕАЛЬНОЕ НЕСОВПАДЕНИЕ ЗОНЫ — на баре алерта наша зона нужной стороны неактивна.
 *       Меряется прямым «zone coverage» на канонической геометрии (БЛОК 2), и лечится ли
 *       разрыв пере-калибровкой геометрии зоны — гео-свипом Partial<ApexParams> (БЛОК 3).
 *
 * Причинность строго трейлинговая, как в образце (i от 210). Никакого look-ahead.
 * Матч всегда «та же сторона». Данные/пары/загрузка — 1-в-1 из runE5FearGreedArrowFit.ts.
 *
 * Запуск: npx tsx ci/research/runE5ZoneLagDiagnostic.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands, APEX_PARAMS, type ApexBand, type ApexParams } from '../../src/core/signals/ApexEngine.js'
import { detectArrowSignalCandidates } from '../../src/core/signals/ArrowSignalEngine.js'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'
import { TF_MS } from '../../tools/shared/candleFetcher.js'

const CACHE = resolve('tmp/viz-archive-cache')
const PAIRS: Array<[string, number, string]> = [
	['VIRTUAL', 5, '5m'], ['BNB', 5, '5m'], ['ETH', 5, '5m'],
	['OP', 15, '15m'], ['CRV', 15, '15m'], ['ONDO', 15, '15m'],
]
const MIN_ALERTS = 8
const WARMUP = 210 // как в образце: трейлингово, i от 210

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

// --- Прикреплённая свеча по времени бара. Индекс i свечи по бару (первый с этим bar-ts). ---
function barIndexOf(candles: Candle[], tfMs: number, barMs: number): number {
	// свечи упорядочены по времени; ищем свечу, чей bar совпадает с barMs
	for (let i = 0; i < candles.length; i++) {
		if (bar(candles[i]!.timestamp, tfMs) === barMs) return i
	}
	return -1
}

// --- Активна ли зона нужной стороны на баре i (zone-gate как в образце) ---
function zoneActiveAt(candles: Candle[], bands: ApexBand[], i: number, side: 'long' | 'short', distMult: number): boolean {
	if (i < 0 || i >= candles.length) return false
	const b = bands[i]
	if (!b || !Number.isFinite(b.mean) || !Number.isFinite(b.s)) return false
	const close = candles[i]!.close
	const distPct = Math.abs(close - b.mean) / b.mean * 100
	const bandStdPct = b.s * 100
	const minDist = Math.min(3, Math.max(0.15, bandStdPct * distMult))
	if (side === 'long') return close < b.mean && distPct >= minDist
	return close > b.mean && distPct >= minDist
}

// зона активна на i хоть в пределах ±tolBars (для нужной стороны)
function zoneActiveNear(candles: Candle[], bands: ApexBand[], i: number, side: 'long' | 'short', distMult: number, tolBars: number): boolean {
	for (let d = -tolBars; d <= tolBars; d++) {
		if (zoneActiveAt(candles, bands, i + d, side, distMult)) return true
	}
	return false
}

// =====================================================================================
// СТРОГОЕ КАСАНИЕ КРАЯ APEX (канон detectReversals / apexStateAt; геометрия НЕ трогается).
// Поля ApexBand: redLo=inner-верх (kInner), redHi=outer-верх (kOuter),
//                greenHi=inner-низ (kInner), greenLo=outer-низ (kOuter).
//   OUTER-touch: long → low<=greenLo; short → high>=redHi  (край detectReversals).
//   INNER-touch: long → low<=greenHi; short → high>=redLo  (край apexStateAt).
// =====================================================================================
type EdgeMode = 'inner' | 'outer'

/** Строгое касание края Apex нужной стороны на баре i. */
function edgeTouchAt(candles: Candle[], bands: ApexBand[], i: number, side: 'long' | 'short', edge: EdgeMode): boolean {
	if (i < 0 || i >= candles.length) return false
	const b = bands[i]
	if (!b || !Number.isFinite(b.mean) || !Number.isFinite(b.s)) return false
	const c = candles[i]!
	if (edge === 'outer') {
		return side === 'long' ? c.low <= b.greenLo : c.high >= b.redHi
	}
	return side === 'long' ? c.low <= b.greenHi : c.high >= b.redLo
}

/** Касание края хоть в пределах ±tolBars. */
function edgeTouchNear(candles: Candle[], bands: ApexBand[], i: number, side: 'long' | 'short', edge: EdgeMode, tolBars: number): boolean {
	for (let d = -tolBars; d <= tolBars; d++) {
		if (edgeTouchAt(candles, bands, i + d, side, edge)) return true
	}
	return false
}

/** Причинный relativeVolume: volume[i] / mean(volume, i-period..i-1). Как в ArrowSignalEngine. */
function relativeVolumeAt(candles: Candle[], i: number, period: number): number {
	if (i < period) return 0
	let sum = 0
	for (let j = i - period; j < i; j++) sum += candles[j]!.volume
	return sum > 0 ? candles[i]!.volume / (sum / period) : 0
}

// --- Скоринг recall/precision с допуском tol баров (та же сторона) ---
interface Score { vendorN: number; ourN: number; recall: number; precision: number; density: number }
function scoreTol(alerts: Alert[], arrows: Arrow[], tfMs: number, tolBars: number): Score {
	const byBar = new Map<number, Set<'long' | 'short'>>()
	for (const a of arrows) { const s = byBar.get(a.b) ?? new Set(); s.add(a.side); byBar.set(a.b, s) }
	// recall: для каждого алерта есть ли наша стрелка той же стороны в пределах ±tol баров
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
	// precision: доля наших стрелок, у которых есть алерт той же стороны в пределах ±tol
	const vendorByBar = new Map<number, Set<'long' | 'short'>>()
	for (const a of alerts) { const ab = bar(a.timeMs, tfMs); const s = vendorByBar.get(ab) ?? new Set(); s.add(a.side); vendorByBar.set(ab, s) }
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

// --- Гео-свип сетка ---
const GEO_DEV_LOOKBACK = [60, 90, 122, 160]
const GEO_DEV_SIGMA = [3, 4, 5]
const GEO_WIDTH_SCALE = [0.6, 0.8, 1.0]
const GEO_DIST_MULT = [0.4, 0.6, 0.8]

interface GeoCfg { devLookback: number; devSigma: number; widthScale: number; distMult: number }
interface GeoRow { cfg: GeoCfg; activationDensity: number; zoneCoverage: number }

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

	// агрегатор score по парам (взвешенно по vendorN / ourN)
	const aggScoreTol = (tolBars: number): Score => {
		let sv = 0, so = 0, rm = 0, hitSum = 0
		for (const p of preps) {
			const sc = scoreTol(p.alerts, p.own2, p.tfMs, tolBars)
			sv += sc.vendorN; so += sc.ourN; rm += sc.recall * sc.vendorN; hitSum += sc.precision * sc.ourN
		}
		return { vendorN: sv, ourN: so, recall: sv ? rm / sv : 0, precision: so ? hitSum / so : 0, density: sv ? so / sv : 0 }
	}

	// ================= БЛОК 1 — ЛАГ-КРИВАЯ =================
	const TOL_GRID = [0, 1, 2, 3, 5, 8]
	const lagCurve = TOL_GRID.map((tol) => ({ tol, ...aggScoreTol(tol) }))

	// ================= БЛОК 2 — ПОКРЫТИЕ ЗОНЫ НА БАРАХ ВЕНДОРА (канон) =================
	const CANON_DIST_MULT = 0.8
	interface CoverRow { key: string; vendorN: number; cover0: number; coverPm1: number }
	const coverRows: CoverRow[] = []
	let totVendor = 0, totC0 = 0, totCpm1 = 0
	for (const p of preps) {
		let n = 0, c0 = 0, cpm1 = 0
		for (const a of p.alerts) {
			const ab = bar(a.timeMs, p.tfMs)
			const i = barIndexOf(p.candles, p.tfMs, ab)
			if (i < 0) continue // алерт вне окна свечей — не считаем в знаменателе покрытия
			n++
			if (zoneActiveAt(p.candles, p.bands, i, a.side, CANON_DIST_MULT)) c0++
			if (zoneActiveNear(p.candles, p.bands, i, a.side, CANON_DIST_MULT, 1)) cpm1++
		}
		coverRows.push({ key: p.key, vendorN: n, cover0: n ? c0 / n : 0, coverPm1: n ? cpm1 / n : 0 })
		totVendor += n; totC0 += c0; totCpm1 += cpm1
	}
	const coverAgg = { vendorN: totVendor, cover0: totVendor ? totC0 / totVendor : 0, coverPm1: totVendor ? totCpm1 / totVendor : 0 }

	// ================= БЛОК 2b — СТРОГОЕ ПОКРЫТИЕ КРАЯ APEX (inner / outer) =================
	// Определение «зона активна» = строгое касание края (см. edgeTouchAt). Считаем оба режима.
	interface StrictCoverRow { key: string; vendorN: number; cover0: number; coverPm1: number }
	interface StrictCoverBlock {
		perPair: StrictCoverRow[]
		aggregate: { vendorN: number; cover0: number; coverPm1: number }
		activationDensity: number // доля всех баров (i>=WARMUP), где край активен хоть на какую-то сторону
	}
	const strictCoverFor = (edge: EdgeMode): StrictCoverBlock => {
		const rows: StrictCoverRow[] = []
		let tv = 0, tc0 = 0, tcpm1 = 0
		let barsTotal = 0, barsActive = 0
		for (const p of preps) {
			let n = 0, c0 = 0, cpm1 = 0
			for (const a of p.alerts) {
				const ab = bar(a.timeMs, p.tfMs)
				const i = barIndexOf(p.candles, p.tfMs, ab)
				if (i < 0) continue
				n++
				if (edgeTouchAt(p.candles, p.bands, i, a.side, edge)) c0++
				if (edgeTouchNear(p.candles, p.bands, i, a.side, edge, 1)) cpm1++
			}
			rows.push({ key: p.key, vendorN: n, cover0: n ? c0 / n : 0, coverPm1: n ? cpm1 / n : 0 })
			tv += n; tc0 += c0; tcpm1 += cpm1
			// activation density: доля всех баров i>=WARMUP, где край активен хоть на какую-то сторону
			for (let i = WARMUP; i < p.candles.length; i++) {
				barsTotal++
				if (edgeTouchAt(p.candles, p.bands, i, 'long', edge) || edgeTouchAt(p.candles, p.bands, i, 'short', edge)) barsActive++
			}
		}
		return {
			perPair: rows,
			aggregate: { vendorN: tv, cover0: tv ? tc0 / tv : 0, coverPm1: tv ? tcpm1 / tv : 0 },
			activationDensity: barsTotal ? barsActive / barsTotal : 0,
		}
	}
	const strictInner = strictCoverFor('inner')
	const strictOuter = strictCoverFor('outer')

	// ================= БЛОК 4 — МИНИМАЛЬНЫЙ ТРИГГЕР ПОВЕРХ СТРОГОЙ ЗОНЫ =================
	// Кандидат на баре i: строгая зона активна для стороны (edgeMode) + опциональные фильтры.
	// Свип: edgeMode × candleDir × armReset × relVolMin × spacing. Матч ±1 бар, та же сторона.
	const REL_VOL_PERIOD = 20
	interface TrigCfg { edgeMode: EdgeMode; candleDir: boolean; armReset: boolean; relVolMin: number; spacing: number }
	const trigFilterCount = (c: TrigCfg): number => (c.candleDir ? 1 : 0) + (c.armReset ? 1 : 0) + (c.relVolMin > 0 ? 1 : 0)

	// Генерация наших стрелок по строгой зоне для одной пары.
	function genStrictArrows(candles: Candle[], bands: ApexBand[], tfMs: number, cfg: TrigCfg): Arrow[] {
		const raw: Array<{ i: number; side: 'long' | 'short' }> = []
		// armReset: воспроизводим взвод/перевзвод как в detectReversals (сторона взводится, срабатывает
		// один раз при касании края + подтверждении, перевзводится только возвратом close к mean).
		let armedLong = true, armedShort = true
		let pendingLong = false, pendingShort = false
		for (let i = WARMUP; i < candles.length; i++) {
			const c = candles[i]!, b = bands[i]
			if (!b || !Number.isFinite(b.mean) || !Number.isFinite(b.s)) continue
			const rv = cfg.relVolMin > 0 ? relativeVolumeAt(candles, i, REL_VOL_PERIOD) : Infinity
			const relVolOk = cfg.relVolMin <= 0 || rv >= cfg.relVolMin
			const longTouch = edgeTouchAt(candles, bands, i, 'long', cfg.edgeMode)
			const shortTouch = edgeTouchAt(candles, bands, i, 'short', cfg.edgeMode)
			const longDirOk = !cfg.candleDir || c.close > c.open
			const shortDirOk = !cfg.candleDir || c.close < c.open
			if (cfg.armReset) {
				// перевзвод возвратом close к mean
				if (!armedLong && c.close >= b.mean) armedLong = true
				if (!armedShort && c.close <= b.mean) armedShort = true
				if (armedLong && longTouch) pendingLong = true
				if (armedShort && shortTouch) pendingShort = true
				if (pendingLong && armedLong && longDirOk && relVolOk) {
					raw.push({ i, side: 'long' }); armedLong = false; pendingLong = false
				} else if (pendingShort && armedShort && shortDirOk && relVolOk) {
					raw.push({ i, side: 'short' }); armedShort = false; pendingShort = false
				}
				// протухание ожидания при возврате к средней
				if (c.close >= b.mean) pendingLong = false
				if (c.close <= b.mean) pendingShort = false
			} else {
				// off: срабатывает на каждом баре касания (с фильтрами)
				if (longTouch && longDirOk && relVolOk) raw.push({ i, side: 'long' })
				else if (shortTouch && shortDirOk && relVolOk) raw.push({ i, side: 'short' })
			}
		}
		// greedy min-spacing per side (в барах), глобально по стороне
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

	// агрегатор score по конфигу (взвешенно по vendorN / ourN), матч ±1 бар
	interface TrigRow { cfg: TrigCfg; agg: Score; perPair: Array<{ key: string; sc: Score }> }
	const evalTrig = (cfg: TrigCfg): TrigRow => {
		let sv = 0, so = 0, rm = 0, hitSum = 0
		const perPair: Array<{ key: string; sc: Score }> = []
		for (const p of preps) {
			const arrows = genStrictArrows(p.candles, p.bands, p.tfMs, cfg)
			const sc = scoreTol(p.alerts, arrows, p.tfMs, 1)
			perPair.push({ key: p.key, sc })
			sv += sc.vendorN; so += sc.ourN; rm += sc.recall * sc.vendorN; hitSum += sc.precision * sc.ourN
		}
		return {
			cfg,
			agg: { vendorN: sv, ourN: so, recall: sv ? rm / sv : 0, precision: so ? hitSum / so : 0, density: sv ? so / sv : 0 },
			perPair,
		}
	}

	const TRIG_EDGE: EdgeMode[] = ['inner', 'outer']
	const TRIG_CANDLE = [false, true]
	const TRIG_ARM = [false, true]
	const TRIG_RELVOL = [0, 1.0, 1.4]
	const TRIG_SPACING = [1, 3, 10]
	const trigRows: TrigRow[] = []
	for (const edgeMode of TRIG_EDGE)
		for (const candleDir of TRIG_CANDLE)
			for (const armReset of TRIG_ARM)
				for (const relVolMin of TRIG_RELVOL)
					for (const spacing of TRIG_SPACING)
						trigRows.push(evalTrig({ edgeMode, candleDir, armReset, relVolMin, spacing }))

	// ранжируем по recall среди конфигов с density ∈ [0.6, 1.6]; если пусто — ближайшие по density к диапазону
	const inBudget = trigRows.filter((r) => r.agg.density >= 0.6 && r.agg.density <= 1.6)
	const trigEligible = inBudget.length
		? inBudget
		: [...trigRows].sort((a, b) => {
			const da = a.agg.density < 0.6 ? 0.6 - a.agg.density : a.agg.density - 1.6
			const db = b.agg.density < 0.6 ? 0.6 - b.agg.density : b.agg.density - 1.6
			return da - db
		}).slice(0, 15)
	const trigRanked = [...trigEligible].sort((a, b) => b.agg.recall - a.agg.recall || b.agg.precision - a.agg.precision || a.agg.density - b.agg.density)
	const trigTop15 = trigRanked.slice(0, 15)
	const trigBest = trigTop15[0] ?? null

	// «минимальный триггер»: конфиг с наименьшим числом включённых фильтров среди тех, что дают
	// recall в пределах ~2 п.п. от лучшего при density<=1.6.
	const bestRecall = trigBest ? trigBest.agg.recall : 0
	const minimalCandidates = trigRows
		.filter((r) => r.agg.density <= 1.6 && r.agg.recall >= bestRecall - 0.02)
		.sort((a, b) => trigFilterCount(a.cfg) - trigFilterCount(b.cfg) || b.agg.recall - a.agg.recall || a.agg.density - b.agg.density)
	const minimalTrig = minimalCandidates[0] ?? null

	// разбивка лучшего конфига по парам (+ OWN2 recall@±1 для сравнения)
	const bestPerPair = trigBest
		? trigBest.perPair.map((pp) => {
			const p = preps.find((x) => x.key === pp.key)!
			const own2sc = scoreTol(p.alerts, p.own2, p.tfMs, 1)
			return { key: pp.key, vendorN: pp.sc.vendorN, ourN: pp.sc.ourN, density: pp.sc.density, recall: pp.sc.recall, precision: pp.sc.precision, own2Recall: own2sc.recall }
		})
		: []

	// baseline OWN2 recall@±1 (для итоговой строки сравнения)
	const own2Pm1 = aggScoreTol(1)

	// ================= БЛОК 3 — ГЕО-СВИП ЗОНЫ =================
	// zoneCoverage для конфига (допуск ±1 бар, как cover@±1) + activationDensity (доля всех баров с активной зоной)
	const bandsCache = new Map<string, ApexBand[]>()
	const bandsFor = (p: Prep, geo: GeoCfg): ApexBand[] => {
		const k = `${p.key}|${geo.devLookback}|${geo.devSigma}|${geo.widthScale}`
		let b = bandsCache.get(k)
		if (!b) {
			const override: Partial<ApexParams> = { devLookback: geo.devLookback, devSigma: geo.devSigma, widthScale: geo.widthScale }
			b = computeApexBands(p.candles, override)
			bandsCache.set(k, b)
		}
		return b
	}

	const evalGeo = (geo: GeoCfg): GeoRow => {
		let vendorN = 0, covered = 0
		let barsTotal = 0, barsActive = 0
		for (const p of preps) {
			const bands = bandsFor(p, geo)
			// zone coverage на барах вендора (±1)
			for (const a of p.alerts) {
				const ab = bar(a.timeMs, p.tfMs)
				const i = barIndexOf(p.candles, p.tfMs, ab)
				if (i < 0) continue
				vendorN++
				if (zoneActiveNear(p.candles, bands, i, a.side, geo.distMult, 1)) covered++
			}
			// activation density: доля всех баров i>=WARMUP, где зона активна хоть на какую-то сторону
			for (let i = WARMUP; i < p.candles.length; i++) {
				barsTotal++
				if (zoneActiveAt(p.candles, bands, i, 'long', geo.distMult) || zoneActiveAt(p.candles, bands, i, 'short', geo.distMult)) barsActive++
			}
		}
		return {
			cfg: geo,
			activationDensity: barsTotal ? barsActive / barsTotal : 0,
			zoneCoverage: vendorN ? covered / vendorN : 0,
		}
	}

	// канон-строка (для сравнения)
	const canonGeo: GeoCfg = { devLookback: 122, devSigma: 4, widthScale: 1, distMult: 0.8 }
	const canonRow = evalGeo(canonGeo)

	const geoRows: GeoRow[] = []
	for (const devLookback of GEO_DEV_LOOKBACK)
		for (const devSigma of GEO_DEV_SIGMA)
			for (const widthScale of GEO_WIDTH_SCALE)
				for (const distMult of GEO_DIST_MULT)
					geoRows.push(evalGeo({ devLookback, devSigma, widthScale, distMult }))

	// ранжируем по zoneCoverage (tie → меньшая density)
	const geoRanked = [...geoRows].sort((a, b) => b.zoneCoverage - a.zoneCoverage || a.activationDensity - b.activationDensity)
	const geoTop15 = geoRanked.slice(0, 15)

	// лучший конфиг при ограничении density <= канон*1.5
	const densityBudget = canonRow.activationDensity * 1.5
	const constrainedBest = geoRanked.find((r) => r.activationDensity <= densityBudget) ?? null

	// ---------- ВЫВОД ----------
	const pc = (x: number) => (x * 100).toFixed(1) + '%'

	// анализ насыщения лаг-кривой
	const r0 = lagCurve[0]!.recall, r3 = lagCurve.find((r) => r.tol === 3)!.recall, r8 = lagCurve[lagCurve.length - 1]!.recall
	const lagGain03 = r3 - r0
	const lagGain38 = r8 - r3
	const lagSaturates = r8 > 0 && lagGain38 <= Math.max(0.02, lagGain03 * 0.25) // прирост от 3 до 8 мал относительно 0→3
	const geoLifts = constrainedBest ? constrainedBest.zoneCoverage - canonRow.zoneCoverage : (geoTop15[0]!.zoneCoverage - canonRow.zoneCoverage)
	const geoHelps = geoLifts >= 0.10 // «существенно» = +10 п.п. покрытия

	const md: string[] = []
	md.push('# E5 — zone-lag diagnostic: лаг тайминга vs несовпадение зоны (Apex vs GGI Zone)')
	md.push('')
	md.push('Диагностика реверс-инжиниринга стрелки GGI Buy/Sell. Прошлый прогон (e5-fg-arrow-fit): OWN2 при ×3.3 ловит ~19% алертов, F&G-триггер ~1%. Диагноз — узкое место в слое ЗОНЫ (~80% стрелок вендора на барах, где наша зона молчит). Здесь разделяем причину: (C) лаг постинга vs (A) реальное несовпадение зоны, и проверяем лечится ли зона пере-калибровкой геометрии. Движок не трогается — все вариации через `Partial<ApexParams>` в `computeApexBands`. Причинность трейлинговая (i от 210), матч «та же сторона», фид futures.')
	md.push('')
	md.push('## БЛОК 1 — ЛАГ-КРИВАЯ (baseline OWN2 relVol1.4)')
	md.push('')
	md.push('Recall/precision при допуске матча ±tol баров (та же сторона). Если recall насыщается к ±2–3 — разрыв это лаг постинга; если растёт и на ±8 — настоящее несовпадение.')
	md.push('')
	md.push('| tol(±bars) | vendorN | ourN | density | recall | precision |')
	md.push('|---|---|---|---|---|---|')
	for (const r of lagCurve) md.push(`| ${r.tol} | ${r.vendorN} | ${r.ourN} | ×${r.density.toFixed(1)} | ${pc(r.recall)} | ${pc(r.precision)} |`)
	md.push('')
	md.push(`Прирост recall 0→±3: **${(lagGain03 * 100).toFixed(1)} п.п.**; ±3→±8: **${(lagGain38 * 100).toFixed(1)} п.п.** → лаг-кривая ${lagSaturates ? '**насыщается к ±2–3** (разрыв объясним лагом постинга)' : '**НЕ насыщается** (остаётся низкой и на ±8 → настоящее несовпадение зоны, не лаг)'}.`)
	md.push('')
	md.push('## БЛОК 2 — ПОКРЫТИЕ ЗОНЫ НА БАРАХ ВЕНДОРА (каноническая геометрия)')
	md.push('')
	md.push('Доля алертов вендора, у которых наша зона нужной стороны активна на баре алерта (@0) и в пределах ±1 бара (@±1). Прямой замер диагноза «80% вне зоны».')
	md.push('')
	md.push('| пара | vendorN | cover@0 | cover@±1 |')
	md.push('|---|---|---|---|')
	for (const r of coverRows) md.push(`| ${r.key} | ${r.vendorN} | ${pc(r.cover0)} | ${pc(r.coverPm1)} |`)
	md.push(`| **ИТОГО** | **${coverAgg.vendorN}** | **${pc(coverAgg.cover0)}** | **${pc(coverAgg.coverPm1)}** |`)
	md.push('')
	md.push('## БЛОК 2b — СТРОГОЕ ПОКРЫТИЕ КРАЯ APEX (inner / outer)')
	md.push('')
	md.push('«Зона активна для стороны на баре» = СТРОГОЕ касание края Apex (не distPct-от-mean). OUTER: long low≤greenLo / short high≥redHi (край detectReversals). INNER: long low≤greenHi / short high≥redLo (край apexStateAt). cover@0 — касание на баре алерта, cover@±1 — в пределах ±1 бара. activationDensity — доля ВСЕХ баров (i≥210), где край активен хоть на какую-то сторону (для сравнения со «мягкими» ~75%).')
	md.push('')
	const strictBlockMd = (title: string, blk: StrictCoverBlock) => {
		md.push(`### ${title}`)
		md.push('')
		md.push('| пара | vendorN | cover@0 | cover@±1 |')
		md.push('|---|---|---|---|')
		for (const r of blk.perPair) md.push(`| ${r.key} | ${r.vendorN} | ${pc(r.cover0)} | ${pc(r.coverPm1)} |`)
		md.push(`| **ИТОГО** | **${blk.aggregate.vendorN}** | **${pc(blk.aggregate.cover0)}** | **${pc(blk.aggregate.coverPm1)}** |`)
		md.push(`| activationDensity | — | **${pc(blk.activationDensity)}** | — |`)
		md.push('')
	}
	strictBlockMd('INNER-touch', strictInner)
	strictBlockMd('OUTER-touch', strictOuter)

	md.push('## БЛОК 2c — МИНИМАЛЬНЫЙ ТРИГГЕР ПОВЕРХ СТРОГОЙ ЗОНЫ')
	md.push('')
	md.push('Наши стрелки = кандидат на баре i при строгом касании края (edgeMode) + опциональные фильтры. Свип: edgeMode∈{inner,outer} × candleDir∈{off,on} × armReset∈{off,on} × relVolMin∈{0,1.0,1.4} × spacing∈{1,3,10}. relativeVolume=volume[i]/mean(volume,i-20..i-1) (причинно). armReset=on воспроизводит взвод/перевзвод как detectReversals. Матч ±1 бар, та же сторона. Ранжирование по recall среди конфигов с density∈[0.6,1.6].')
	md.push('')
	md.push(`**Baseline OWN2 (relVol1.4) recall@±1:** vendorN=${own2Pm1.vendorN} ourN=${own2Pm1.ourN} density=×${own2Pm1.density.toFixed(1)} recall=**${pc(own2Pm1.recall)}** precision=${pc(own2Pm1.precision)}`)
	md.push('')
	md.push(`ТОП-15 строго-зонного свипа (${inBudget.length ? `в density∈[0.6,1.6], конфигов ${inBudget.length}` : 'диапазон [0.6,1.6] пуст → ближайшие по плотности'}):`)
	md.push('')
	md.push('| edgeMode | candleDir | armReset | relVolMin | spacing | density | recall | precision |')
	md.push('|---|---|---|---|---|---|---|---|')
	for (const r of trigTop15) md.push(`| ${r.cfg.edgeMode} | ${r.cfg.candleDir ? 'on' : 'off'} | ${r.cfg.armReset ? 'on' : 'off'} | ${r.cfg.relVolMin} | ${r.cfg.spacing} | ×${r.agg.density.toFixed(2)} | ${pc(r.agg.recall)} | ${pc(r.agg.precision)} |`)
	md.push('')
	if (minimalTrig) {
		md.push(`**Минимальный триггер** (наименьшее число включённых фильтров при recall в ~2 п.п. от лучшего, density≤1.6): edgeMode=${minimalTrig.cfg.edgeMode} candleDir=${minimalTrig.cfg.candleDir ? 'on' : 'off'} armReset=${minimalTrig.cfg.armReset ? 'on' : 'off'} relVolMin=${minimalTrig.cfg.relVolMin} spacing=${minimalTrig.cfg.spacing} → density=×${minimalTrig.agg.density.toFixed(2)} recall=**${pc(minimalTrig.agg.recall)}** precision=${pc(minimalTrig.agg.precision)} (фильтров: ${trigFilterCount(minimalTrig.cfg)}).`)
	} else {
		md.push('**Минимальный триггер:** не найден (нет конфигов с density≤1.6 и recall у порога).')
	}
	md.push('')
	if (trigBest) {
		md.push(`### Разбивка лучшего строго-зонного конфига по парам`)
		md.push('')
		md.push(`Лучший: edgeMode=${trigBest.cfg.edgeMode} candleDir=${trigBest.cfg.candleDir ? 'on' : 'off'} armReset=${trigBest.cfg.armReset ? 'on' : 'off'} relVolMin=${trigBest.cfg.relVolMin} spacing=${trigBest.cfg.spacing} → density=×${trigBest.agg.density.toFixed(2)} recall=**${pc(trigBest.agg.recall)}** precision=${pc(trigBest.agg.precision)}.`)
		md.push('')
		md.push('| пара | vendorN | ourN | density | recall | precision | OWN2 recall |')
		md.push('|---|---|---|---|---|---|---|')
		for (const r of bestPerPair) md.push(`| ${r.key} | ${r.vendorN} | ${r.ourN} | ×${r.density.toFixed(2)} | ${pc(r.recall)} | ${pc(r.precision)} | ${pc(r.own2Recall)} |`)
		md.push('')
	}
	md.push(`**Сравнение с OWN2:** baseline OWN2 relVol1.4 recall@±1 = **${pc(own2Pm1.recall)}**; лучший строго-зонный триггер recall@±1 = **${trigBest ? pc(trigBest.agg.recall) : '—'}** → строгая зона + простой триггер ${trigBest && trigBest.agg.recall > own2Pm1.recall ? '**ОБГОНЯЕТ** OWN2' : '**НЕ обгоняет** OWN2'}. Вендорская плотность (density∈[0.6,1.6]) ${inBudget.length ? '**достижима**' : '**НЕ достигнута** (диапазон пуст в этой сетке)'}.`)
	md.push('')
	md.push('## БЛОК 3 — ГЕО-СВИП ЗОНЫ (лечится ли зона пере-калибровкой геометрии)')
	md.push('')
	md.push('Сетка: devLookback∈{60,90,122,160} × devSigma∈{3,4,5} × widthScale∈{0.6,0.8,1.0} × distMult∈{0.4,0.6,0.8}. lookback/mean-параметры/kInner/kOuter — канон. zoneCoverage = доля алертов с активной зоной (±1 бар). activationDensity = доля всех баров (i≥210) с активной зоной хоть на какую-то сторону (штрафует «зону везде»).')
	md.push('')
	md.push('| devLookback | devSigma | widthScale | distMult | activationDensity | zoneCoverage |')
	md.push('|---|---|---|---|---|---|')
	md.push(`| **КАНОН 122** | **4** | **1** | **0.8** | **${pc(canonRow.activationDensity)}** | **${pc(canonRow.zoneCoverage)}** |`)
	for (const r of geoTop15) md.push(`| ${r.cfg.devLookback} | ${r.cfg.devSigma} | ${r.cfg.widthScale} | ${r.cfg.distMult} | ${pc(r.activationDensity)} | ${pc(r.zoneCoverage)} |`)
	md.push('')
	if (constrainedBest) {
		md.push(`**Лучший при activationDensity ≤ канон×1.5 (≤ ${pc(densityBudget)}):** devLookback=${constrainedBest.cfg.devLookback} devSigma=${constrainedBest.cfg.devSigma} widthScale=${constrainedBest.cfg.widthScale} distMult=${constrainedBest.cfg.distMult} → zoneCoverage=**${pc(constrainedBest.zoneCoverage)}** (density ${pc(constrainedBest.activationDensity)}). Прирост покрытия над каноном: **+${((constrainedBest.zoneCoverage - canonRow.zoneCoverage) * 100).toFixed(1)} п.п.**`)
	} else {
		md.push(`**Лучший при activationDensity ≤ канон×1.5 (≤ ${pc(densityBudget)}):** не найдено конфигов в бюджете плотности.`)
	}
	md.push('')
	md.push('## ВЫВОД')
	md.push('')
	md.push(`1. **Лаг?** Лаг-кривая ${lagSaturates ? 'насыщается к ±2–3 барам → значимая часть разрыва это ЛАГ ПОСТИНГА алерта, а не несовпадение.' : 'НЕ насыщается (recall остаётся низким даже при ±8) → разрыв это НЕ лаг, а настоящее несовпадение зоны.'} (recall: ±0=${pc(r0)}, ±3=${pc(r3)}, ±8=${pc(r8)}).`)
	md.push(`2. **Лечится ли зона?** Канон-покрытие зоны cover@±1 = ${pc(canonRow.zoneCoverage)}. Лучший гео-свип (в бюджете плотности) даёт ${constrainedBest ? pc(constrainedBest.zoneCoverage) : pc(geoTop15[0]!.zoneCoverage)} → ${geoHelps ? 'гео-свип СУЩЕСТВЕННО поднимает покрытие (проблема лечится пере-калибровкой геометрии зоны).' : 'гео-свип НЕ поднимает покрытие существенно (пере-калибровка геометрии в этой сетке не закрывает разрыв — узкое место глубже, чем devLookback/devSigma/widthScale/distMult).'}`)
	md.push(`3. **Строгая зона (край Apex).** cover@±1: INNER=${pc(strictInner.aggregate.coverPm1)} (activationDensity ${pc(strictInner.activationDensity)}), OUTER=${pc(strictOuter.aggregate.coverPm1)} (activationDensity ${pc(strictOuter.activationDensity)}) — против «мягкой» activationDensity ${pc(canonRow.activationDensity)}. Строгое определение ${strictInner.activationDensity < canonRow.activationDensity || strictOuter.activationDensity < canonRow.activationDensity ? 'РЕЖЕ' : 'НЕ реже'} мягкого.`)
	md.push(`4. **Строгая зона + простой триггер vs OWN2.** OWN2 relVol1.4 recall@±1 = **${pc(own2Pm1.recall)}**; лучший строго-зонный триггер recall@±1 = **${trigBest ? pc(trigBest.agg.recall) : '—'}** (density ×${trigBest ? trigBest.agg.density.toFixed(2) : '—'}) → ${trigBest && trigBest.agg.recall > own2Pm1.recall ? 'строгая зона + простой триггер ПОДНИМАЕТ recall над OWN2.' : 'строгая зона + простой триггер НЕ поднимает recall над OWN2.'} Вендорская плотность density∈[0.6,1.6] ${inBudget.length ? 'ДОСТИЖИМА' : 'НЕ достигнута в этой сетке'}.`)
	md.push('')

	writeFileSync(resolve('ci-results/e5-zone-lag-diagnostic.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/e5-zone-lag-diagnostic.json'), JSON.stringify({
		generatedAt: new Date().toISOString(),
		pairs: preps.map((p) => ({ key: p.key, vendorN: p.alerts.length, candles: p.candles.length, own2: p.own2.length })),
		block1_lagCurve: lagCurve,
		block2_zoneCoverage: { perPair: coverRows, aggregate: coverAgg, canonDistMult: CANON_DIST_MULT },
		strictZoneCoverage: {
			edgeDefinition: {
				outer: { long: 'low<=greenLo', short: 'high>=redHi' },
				inner: { long: 'low<=greenHi', short: 'high>=redLo' },
			},
			inner: strictInner,
			outer: strictOuter,
			softActivationDensityCanon: canonRow.activationDensity, // для сравнения с мягким ~75%
		},
		strictTriggerSweep: {
			grid: { edgeMode: TRIG_EDGE, candleDir: TRIG_CANDLE, armReset: TRIG_ARM, relVolMin: TRIG_RELVOL, spacing: TRIG_SPACING },
			relVolPeriod: REL_VOL_PERIOD,
			matchTolBars: 1,
			densityWindow: [0.6, 1.6],
			own2Baseline: own2Pm1,
			eligibleCount: inBudget.length,
			top15: trigTop15.map((r) => ({ ...r.cfg, filters: trigFilterCount(r.cfg), ...r.agg })),
			best: trigBest ? { ...trigBest.cfg, filters: trigFilterCount(trigBest.cfg), ...trigBest.agg, perPair: bestPerPair } : null,
			minimalTrigger: minimalTrig ? { ...minimalTrig.cfg, filters: trigFilterCount(minimalTrig.cfg), ...minimalTrig.agg } : null,
			beatsOwn2: trigBest ? trigBest.agg.recall > own2Pm1.recall : false,
			vendorDensityAchievable: inBudget.length > 0,
			gridSize: trigRows.length,
			all: trigRows.map((r) => ({ ...r.cfg, filters: trigFilterCount(r.cfg), ...r.agg })),
		},
		block3_geoSweep: {
			canon: canonRow,
			densityBudget,
			top15: geoTop15,
			constrainedBest,
			gridSize: geoRows.length,
			all: geoRows,
		},
		verdict: {
			lagSaturates,
			lagRecall: { pm0: r0, pm3: r3, pm8: r8, gain0to3: lagGain03, gain3to8: lagGain38 },
			geoHelps,
			canonZoneCoverage: canonRow.zoneCoverage,
			bestZoneCoverage: constrainedBest ? constrainedBest.zoneCoverage : geoTop15[0]!.zoneCoverage,
		},
	}, null, 2))

	// консоль
	console.log('\n=== БЛОК 1 — ЛАГ-КРИВАЯ ===')
	for (const r of lagCurve) console.log(`  tol±${r.tol}: vendorN=${r.vendorN} ourN=${r.ourN} density=×${r.density.toFixed(1)} recall=${pc(r.recall)} precision=${pc(r.precision)}`)
	console.log(`  lag saturates: ${lagSaturates} (gain 0→3=${(lagGain03 * 100).toFixed(1)}pp, 3→8=${(lagGain38 * 100).toFixed(1)}pp)`)
	console.log('\n=== БЛОК 2 — ZONE COVERAGE (канон) ===')
	for (const r of coverRows) console.log(`  ${r.key.padEnd(12)} vendorN=${r.vendorN} cover@0=${pc(r.cover0)} cover@±1=${pc(r.coverPm1)}`)
	console.log(`  ИТОГО vendorN=${coverAgg.vendorN} cover@0=${pc(coverAgg.cover0)} cover@±1=${pc(coverAgg.coverPm1)}`)
	console.log('\n=== БЛОК 2b — СТРОГОЕ ПОКРЫТИЕ КРАЯ (inner/outer) ===')
	console.log(`  INNER ИТОГО vendorN=${strictInner.aggregate.vendorN} cover@0=${pc(strictInner.aggregate.cover0)} cover@±1=${pc(strictInner.aggregate.coverPm1)} activationDensity=${pc(strictInner.activationDensity)}`)
	console.log(`  OUTER ИТОГО vendorN=${strictOuter.aggregate.vendorN} cover@0=${pc(strictOuter.aggregate.cover0)} cover@±1=${pc(strictOuter.aggregate.coverPm1)} activationDensity=${pc(strictOuter.activationDensity)}`)
	console.log('\n=== БЛОК 2c — СТРОГО-ЗОННЫЙ ТРИГГЕР ===')
	console.log(`  baseline OWN2 relVol1.4 recall@±1=${pc(own2Pm1.recall)} density=×${own2Pm1.density.toFixed(2)} precision=${pc(own2Pm1.precision)}`)
	for (const r of trigTop15.slice(0, 5)) console.log(`  ${r.cfg.edgeMode} dir:${r.cfg.candleDir ? 'on' : 'off'} arm:${r.cfg.armReset ? 'on' : 'off'} rv${r.cfg.relVolMin} sp${r.cfg.spacing}: density=×${r.agg.density.toFixed(2)} recall=${pc(r.agg.recall)} precision=${pc(r.agg.precision)}`)
	if (minimalTrig) console.log(`  minimalTrigger: ${minimalTrig.cfg.edgeMode} dir:${minimalTrig.cfg.candleDir ? 'on' : 'off'} arm:${minimalTrig.cfg.armReset ? 'on' : 'off'} rv${minimalTrig.cfg.relVolMin} sp${minimalTrig.cfg.spacing} recall=${pc(minimalTrig.agg.recall)} (filters=${trigFilterCount(minimalTrig.cfg)})`)
	console.log(`  beats OWN2: ${trigBest ? trigBest.agg.recall > own2Pm1.recall : false}; vendor density achievable: ${inBudget.length > 0}`)
	console.log('\n=== БЛОК 3 — ГЕО-СВИП (топ-5) ===')
	console.log(`  КАНОН dl122 s4 w1 dm0.8: density=${pc(canonRow.activationDensity)} coverage=${pc(canonRow.zoneCoverage)}`)
	for (const r of geoTop15.slice(0, 5)) console.log(`  dl${r.cfg.devLookback} s${r.cfg.devSigma} w${r.cfg.widthScale} dm${r.cfg.distMult}: density=${pc(r.activationDensity)} coverage=${pc(r.zoneCoverage)}`)
	if (constrainedBest) console.log(`  best≤density×1.5: dl${constrainedBest.cfg.devLookback} s${constrainedBest.cfg.devSigma} w${constrainedBest.cfg.widthScale} dm${constrainedBest.cfg.distMult} coverage=${pc(constrainedBest.zoneCoverage)} density=${pc(constrainedBest.activationDensity)}`)
	console.log(`  geo helps: ${geoHelps}`)
	console.log('\n[zone-lag] written ci-results/e5-zone-lag-diagnostic.{md,json}')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((e) => { console.error(e); process.exitCode = 1 })
}
