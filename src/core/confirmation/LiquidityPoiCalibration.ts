import type { Candle } from '../../models/price/Candle.js'
import type { StructureEvent } from '../../models/events/StructureEvent.js'
import type { StructurePoint } from '../../models/structure/StructurePoint.js'
import type { ProtectedLevelLifecycle } from '../../models/structure/ProtectedLevelLifecycle.js'
import type { LiquidityPool } from '../liquidity/LiquidityHeatmapEngine.js'

export const LIQUIDITY_POI_VERSION = 'liquidity-poi-1.2-deduped'

/**
 * Все константы POI-движка (§16.8). Значения согласованы 23.07.2026; менять только по итогам
 * визуального QA с явного согласия пользователя.
 */
export const LIQUIDITY_POI_CONFIG = {
	/** Период ATR (стандартная детекторная константа). */
	atrPeriod: 14,
	/** Глубина поиска реальной ликвидности за near, в ATR ТФ зоны. */
	farLookbackAtr: 2.0,
	/** Порог КАУЗАЛЬНОГО веса пула: ранг среди пулов, живых на момент рождения зоны (не по всей истории). */
	farMinWeight: 0.4,
	/** Гамма кривой веса — та же, что в LIQUIDITY_HEATMAP_CONFIG.gamma. */
	weightGamma: 1.5,
	/** Кластеризация равных экстремумов (local-eq): разброс ≤ этой доли ATR. */
	eqClusterAtr: 0.25,
	/** «Зона отработала» (ran-away): после касания цена ушла от near в сторону реакции на столько ATR по close. */
	spentDistanceAtr: 3.0,
	/** ATR-fallback ширина (только карта; подтверждение такие зоны не торгует — решение №6): лонг/шорт. */
	fallbackLongAtr: 1.0,
	fallbackShortAtr: 0.5,
	/** §16.9: near-дубль — зона той же стороны с near в пределах этой доли ATR и пересекающимся окном. */
	dupNearAtr: 0.25,
} as const

/** §16.9: local-swing удалён (мелкие зоны без ликвидности от каждого внутреннего колена). */
export type LiquidityZoneClass = 'outer-swing' | 'protected-structure' | 'local-eq'
export type BoundarySource = 'atr-calibration' | 'liquidity-cluster'
export type PdZone = 'premium' | 'discount' | 'none'
export type ZonePriority = 'nearest' | 'outer' | 'secondary'
export type InteractionState = 'untouched' | 'touched' | 'retested'
/**
 * §16.8: использованность (consumed) больше НЕ состояние жизненного цикла, а информационная пометка
 * consumedAt. Терминальные состояния: failed (4h close телом за far), retired (отставка внешнего
 * экстремума), spent (зона отработала: цена ушла от неё в сторону реакции).
 */
export type PoiLifecycleState = 'forming' | 'fresh' | 'in-play' | 'spent' | 'failed' | 'retired'

export interface LiquidityBand { price: number; score: number; touches: number }
export interface LiquidityPoiContext {
	structure?: StructurePoint[]
	protectedHistory?: ProtectedLevelLifecycle[]
	/** v1.0: heatmap-пулы (тот же TF, что и POI) для границы far по реальной ликвидности; без них — fallback на ATR. */
	heatmapPools?: LiquidityPool[]
}
export interface LiquidityPoiCandidate {
	id: string
	version: string
	direction: 'long' | 'short'
	zoneClass: LiquidityZoneClass
	anchorId: string
	componentAnchorIds: string[]
	componentClasses: LiquidityZoneClass[]
	originAt: number
	knownAt: number
	near: number
	far: number
	atr: number
	boundarySource: BoundarySource
	liquidityBands: LiquidityBand[]
	pivotCount: number
	pivotPrices: number[]
	pivotTimes: number[]
	eventType: string | null
	pdZone: PdZone
	pdAligned: boolean | null
	lifecycleState: PoiLifecycleState
	valid: boolean
	active: boolean
	priority: ZonePriority
	interaction: InteractionState
	touchCount: number
	armedAt: number | null
	firstTouchAt: number | null
	/** Информационная пометка «использована»: первый фитиль сквозь near после взведения (все классы одинаково). */
	consumedAt: number | null
	failedAt: number | null
	retiredAt: number | null
	/** «Зона отработала»: цена ушла от near в сторону реакции на spentDistanceAtr×ATR по 4h close после касания. */
	spentAt: number | null
	spentReason: 'ran-away' | null
	/** §16.9: near-дубль старшей зоны — подавлена, не торгуется и не показывается; геометрия не мутирует. */
	duplicateOf: string | null
	geometryKnownAt: number
	lineageSupersededAt: number | null
	supersededAt: number | null
	invalidatedAt: number | null
	endAt: number
	mergedCount: number
	suppressedCount: number
}

interface Pivot { type: 'low' | 'high'; i: number; price: number; known: number; atr: number; segment: number }
interface Anchor {
	id: string
	direction: 'long' | 'short'
	zoneClass: LiquidityZoneClass
	i: number
	knownAt: number
	eventType: string | null
	pivots: Pivot[]
	segment: number
	supersededAt: number | null
	invalidatedAt: number | null
	active: boolean
	retiredAt: number | null
}
interface AreaCandidate extends LiquidityPoiCandidate { segment: number }

function atr(c: Candle[], i: number, n = LIQUIDITY_POI_CONFIG.atrPeriod): number {
	let sum = 0, count = 0
	for (let j = Math.max(1, i - n + 1); j <= i; j++) {
		const x = c[j], p = c[j - 1]
		if (!x || !p) continue
		sum += Math.max(x.high - x.low, Math.abs(x.high - p.close), Math.abs(x.low - p.close))
		count++
	}
	return count ? sum / count : 0
}

function eventSegment(events: StructureEvent[], index: number): number {
	return events.findLastIndex(e => e.confirmIndex <= index)
}

function pivots(c: Candle[], events: StructureEvent[]): Pivot[] {
	const out: Pivot[] = []
	// §16.8: фрактал 2+2 подтверждается ЗАКРЫТИЕМ бара i+2 — knownAt = его open + tfMs (раньше брали
	// open, что делало локальные зоны известными на один бар раньше возможного — look-ahead).
	const tfMs = c.length > 1 ? c[1]!.timestamp - c[0]!.timestamp : 0
	for (let i = 2; i < c.length - 2; i++) {
		const x = c[i]!, a = atr(c, i)
		if (!a) continue
		const left = c.slice(i - 2, i), right = c.slice(i + 1, i + 3)
		const known = c[i + 2]!.timestamp + tfMs
		const segment = eventSegment(events, i)
		if (segment < 0) continue
		if (left.every(v => x.low < v.low) && right.every(v => x.low < v.low)) out.push({ type: 'low', i, price: x.low, known, atr: a, segment })
		if (left.every(v => x.high > v.high) && right.every(v => x.high > v.high)) out.push({ type: 'high', i, price: x.high, known, atr: a, segment })
	}
	return out
}

/** Existing BTC visual-calibration geometry. No new boundary coefficient. */
function calibratedFar(direction: 'long' | 'short', near: number, a: number): number {
	return direction === 'long' ? near - LIQUIDITY_POI_CONFIG.fallbackLongAtr * a : near + LIQUIDITY_POI_CONFIG.fallbackShortAtr * a
}

/**
 * v1.1: граница far по реальным heatmap-пулам с КАУЗАЛЬНЫМ весом — ранг по notional среди пулов,
 * живых на момент рождения зоны (та же кривая (rank/count)^gamma, что в heatmap). Глобальный вес
 * из движка heatmap ранжируется по всей загруженной истории, включая будущие пулы: от него геометрия
 * зон менялась в зависимости от limit (36% зон, в среднем 0.87 ATR). Fallback — старая ATR-геометрия.
 */
function liquidityFar(
	direction: 'long' | 'short', near: number, a: number, knownAt: number, pools: LiquidityPool[] | undefined,
): { far: number; boundarySource: BoundarySource; liquidityBands: LiquidityBand[] } {
	const cfg = LIQUIDITY_POI_CONFIG
	const fallback = calibratedFar(direction, near, a)
	const side = direction === 'long' ? 'buy-side' : 'sell-side'
	const lookback = a * cfg.farLookbackAtr
	// Каузально живые пулы В ПОЛОСЕ ПОИСКА [near − lookback, near] (для шорта зеркально): ранг считается
	// по локальной популяции, чтобы пулы из далёкой истории/других цен не сдвигали веса — иначе граница
	// far менялась от того, сколько истории загружено.
	const band = (pools ?? []).filter(p => p.side === side
		&& p.startAt <= knownAt && (p.sweptAt == null || p.sweptAt > knownAt)
		&& (direction === 'long'
			? p.bandLow <= near && p.bandLow >= near - lookback
			: p.bandHigh >= near && p.bandHigh <= near + lookback))
	if (!band.length) return { far: fallback, boundarySource: 'atr-calibration', liquidityBands: [] }
	const sorted = [...band].sort((x, y) => x.notional - y.notional)
	const causalWeight = new Map(sorted.map((p, i) => [p, Math.pow((i + 1) / sorted.length, cfg.weightGamma)]))
	const candidates = band.filter(p => causalWeight.get(p)! >= cfg.farMinWeight)
	if (!candidates.length) return { far: fallback, boundarySource: 'atr-calibration', liquidityBands: [] }
	const far = direction === 'long' ? Math.min(...candidates.map(p => p.bandLow)) : Math.max(...candidates.map(p => p.bandHigh))
	const liquidityBands: LiquidityBand[] = candidates.map(p => ({ price: p.extremePrice, score: causalWeight.get(p)!, touches: p.contributions }))
	return { far, boundarySource: 'liquidity-cluster', liquidityBands }
}

function pdAt(c: Candle[], structure: StructurePoint[], knownAt: number, price: number, direction: 'long' | 'short'): { pdZone: PdZone; pdAligned: boolean | null } {
	const tfMs = c.length > 1 ? c[1]!.timestamp - c[0]!.timestamp : 0
	let lastHigh: number | null = null, lastLow: number | null = null
	for (const point of [...structure].sort((a, b) => a.index - b.index)) {
		const confirmed = c[point.index + 2]
		if (!confirmed) continue
		const pointKnownAt = confirmed.timestamp + tfMs
		if (pointKnownAt > knownAt) break
		if (point.type === 'high') lastHigh = point.price
		else lastLow = point.price
	}
	if (lastHigh == null || lastLow == null || lastHigh <= lastLow) return { pdZone: 'none', pdAligned: null }
	const pdZone: PdZone = price <= (lastHigh + lastLow) / 2 ? 'discount' : 'premium'
	return { pdZone, pdAligned: direction === 'long' ? pdZone === 'discount' : pdZone === 'premium' }
}

function structuralAnchors(c: Candle[], events: StructureEvent[], context: LiquidityPoiContext): Anchor[] {
	const out: Anchor[] = []
	for (const p of context.protectedHistory ?? []) {
		out.push({ id: p.id, direction: p.direction, zoneClass: 'protected-structure', i: p.point.index,
			knownAt: p.knownAt, eventType: 'protected', pivots: [], segment: eventSegment(events, p.point.index),
			supersededAt: p.supersededAt, invalidatedAt: p.breachedAt, active: p.active, retiredAt: null })
	}
	const structure = context.structure ?? []
	for (const e of events.filter(x => x.type === 'choch')) {
		const candidates = structure.filter(p => p.index < e.breachIndex && p.type === (e.direction === 'up' ? 'low' : 'high'))
		const prevOpposite = [...events].reverse().find(x => x.confirmIndex < e.confirmIndex && x.direction !== e.direction)
		// SPEC §13: без подтверждённого предыдущего противоположного события начало leg неизвестно —
		// кандидат ПРОПУСКАЕТСЯ (подставлять начало датасета запрещено, это баг v0.5.1).
		if (!prevOpposite) continue
		const scoped = candidates.filter(p => p.index > prevOpposite.confirmIndex)
		if (!scoped.length) continue
		const point = e.direction === 'up'
			? scoped.reduce((a, b) => a.price < b.price ? a : b)
			: scoped.reduce((a, b) => a.price > b.price ? a : b)
		const knownAt = c[Math.min(c.length - 1, e.confirmIndex + 1)]?.timestamp ?? e.confirmTimestamp
		out.push({ id: `outer|${e.direction}|${point.index}|${knownAt}`, direction: e.direction === 'up' ? 'long' : 'short',
			zoneClass: 'outer-swing', i: point.index, knownAt, eventType: e.type, pivots: [], segment: eventSegment(events, point.index),
			supersededAt: null, invalidatedAt: null, active: true, retiredAt: null })
	}
	return out
}

function localEqAnchors(ps: Pivot[]): Anchor[] {
	const out: Anchor[] = [], used = new Set<number>()
	for (let i = 0; i < ps.length; i++) {
		if (used.has(i)) continue
		const p = ps[i]!, group: Array<{ p: Pivot; j: number }> = []
		for (let j = i; j < ps.length; j++) {
			const q = ps[j]!
			if (used.has(j) || q.type !== p.type || q.segment !== p.segment) continue
			const current = [...group.map(x => x.p.price), q.price]
			if (Math.max(...current) - Math.min(...current) <= LIQUIDITY_POI_CONFIG.eqClusterAtr * Math.max(p.atr, q.atr)) group.push({ p: q, j })
		}
		if (group.length < 2) continue
		group.forEach(x => used.add(x.j))
		const members = group.map(x => x.p)
		const ext = p.type === 'low'
			? members.reduce((a, b) => a.price < b.price ? a : b)
			: members.reduce((a, b) => a.price > b.price ? a : b)
		out.push({ id: `eq|${p.type}|${p.segment}|${members.map(x => x.i).join('-')}`,
			direction: p.type === 'low' ? 'long' : 'short', zoneClass: 'local-eq', i: ext.i,
			knownAt: Math.max(...members.map(x => x.known)), eventType: null, pivots: members, segment: p.segment,
			supersededAt: null, invalidatedAt: null, active: true, retiredAt: null })
	}
	return out
}



function overlaps(a: AreaCandidate, b: AreaCandidate): boolean {
	const aLow = Math.min(a.near, a.far), aHigh = Math.max(a.near, a.far)
	const bLow = Math.min(b.near, b.far), bHigh = Math.max(b.near, b.far)
	return aLow <= bHigh && bLow <= aHigh
}

function classRank(x: LiquidityZoneClass): number {
	return x === 'outer-swing' ? 3 : x === 'protected-structure' ? 2 : 1
}

function isOpen(x: AreaCandidate): boolean {
	return x.lifecycleState === 'forming' || x.lifecycleState === 'fresh' || x.lifecycleState === 'in-play'
}

function mergeArea(a: AreaCandidate, b: AreaCandidate): AreaCandidate {
	const components = [...new Set([...a.componentAnchorIds, ...b.componentAnchorIds])]
	const classes = [...new Set([...a.componentClasses, ...b.componentClasses])]
	const dominant = a.direction === 'long' ? (a.near <= b.near ? a : b) : (a.near >= b.near ? a : b)
	const zoneClass = classes.reduce((best, x) => classRank(x) > classRank(best) ? x : best, dominant.zoneClass)
	const lineageTimes = [a.lineageSupersededAt, b.lineageSupersededAt].filter((x): x is number => x != null)
	const retireTimes = [a.retiredAt, b.retiredAt].filter((x): x is number => x != null)
	const touchTimes = [a.firstTouchAt, b.firstTouchAt].filter((x): x is number => x != null)
	const armedTimes = [a.armedAt, b.armedAt].filter((x): x is number => x != null)
	const consumedTimes = [a.consumedAt, b.consumedAt].filter((x): x is number => x != null)
	return {
		...dominant,
		id: `${LIQUIDITY_POI_VERSION}|area|${components.sort().join('+')}`,
		zoneClass, anchorId: dominant.anchorId, componentAnchorIds: components, componentClasses: classes,
		originAt: Math.min(a.originAt, b.originAt), knownAt: Math.min(a.knownAt, b.knownAt),
		geometryKnownAt: Math.max(a.geometryKnownAt, b.geometryKnownAt),
		near: dominant.near, far: a.direction === 'long' ? Math.min(a.far, b.far) : Math.max(a.far, b.far),
		atr: Math.max(a.atr, b.atr), pivotCount: a.pivotCount + b.pivotCount,
		pivotPrices: [...a.pivotPrices, ...b.pivotPrices], pivotTimes: [...a.pivotTimes, ...b.pivotTimes],
		lineageSupersededAt: lineageTimes.length ? Math.max(...lineageTimes) : null,
		lifecycleState: 'forming', valid: false, active: false, priority: 'secondary',
		interaction: touchTimes.length ? 'touched' : 'untouched', touchCount: a.touchCount + b.touchCount,
		armedAt: armedTimes.length ? Math.min(...armedTimes) : null,
		firstTouchAt: touchTimes.length ? Math.min(...touchTimes) : null,
		consumedAt: consumedTimes.length ? Math.min(...consumedTimes) : null,
		failedAt: null, invalidatedAt: null, spentAt: null, spentReason: null, duplicateOf: null,
		retiredAt: retireTimes.length ? Math.min(...retireTimes) : null,
		supersededAt: null, endAt: Math.max(a.endAt, b.endAt), mergedCount: components.length - 1,
		suppressedCount: 0, segment: dominant.segment,
	}
}

function evaluateArea(area: AreaCandidate, c: Candle[]): AreaCandidate {
	const cfg = LIQUIDITY_POI_CONFIG
	const long = area.direction === 'long'
	const start = c.findIndex(x => x.timestamp >= area.geometryKnownAt)
	const lower = Math.min(area.near, area.far), upper = Math.max(area.near, area.far)
	let armedAt = area.armedAt, firstTouchAt = area.firstTouchAt, touchCount = area.touchCount
	let consumedAt: number | null = area.consumedAt, failedAt: number | null = null, spentAt: number | null = null
	let inside = false
	for (let i = Math.max(0, start); i < c.length; i++) {
		const bar = c[i]!
		if (area.retiredAt != null && bar.timestamp >= area.retiredAt) break
		// §14.6/§16.8: провал = close телом за дальней границей — единственная ценовая смерть зоны
		// для всех классов (классовые правила смерти из §13.1/13.2 отменены решением №1).
		if (long ? bar.close < lower : bar.close > upper) {
			failedAt = bar.timestamp
			break
		}
		if (armedAt == null) {
			if (long ? bar.close > upper : bar.close < lower) armedAt = bar.timestamp
			continue
		}
		const overlapsZone = bar.low <= upper && bar.high >= lower
		if (overlapsZone && !inside) {
			touchCount++
			firstTouchAt ??= bar.timestamp
		}
		inside = overlapsZone
		// §16.8: использованность — информационная пометка для карты (первый фитиль сквозь near
		// после взведения, одинаково для всех классов), окно торговли она НЕ закрывает.
		if (consumedAt == null && (long ? bar.low < area.near : bar.high > area.near)) consumedAt = bar.timestamp
		// §16.8 «зона отработала» (ran-away): после касания цена ушла от near в сторону реакции
		// на spentDistanceAtr×ATR по close — дальше её не торгуем («поезд уехал, ждём ниже»).
		if (touchCount > 0 && !overlapsZone
			&& (long ? bar.close >= area.near + cfg.spentDistanceAtr * area.atr : bar.close <= area.near - cfg.spentDistanceAtr * area.atr)) {
			spentAt = bar.timestamp
			break
		}
	}
	const terminal = [
		failedAt == null ? null : { state: 'failed' as const, at: failedAt },
		spentAt == null ? null : { state: 'spent' as const, at: spentAt },
		area.retiredAt == null ? null : { state: 'retired' as const, at: area.retiredAt },
	].filter((x): x is { state: 'failed' | 'spent' | 'retired'; at: number } => x != null)
		.sort((a, b) => a.at - b.at)[0]
	const current = c.at(-1)!
	const inPlay = armedAt != null && (current.low <= upper && current.high >= lower)
	let lifecycleState: PoiLifecycleState
	if (terminal) lifecycleState = terminal.state
	else if (armedAt == null) lifecycleState = 'forming'
	else lifecycleState = inPlay ? 'in-play' : 'fresh'
	const interaction: InteractionState = touchCount === 0 ? 'untouched' : touchCount === 1 ? 'touched' : 'retested'
	const valid = terminal == null && armedAt != null
	return {
		...area, lifecycleState, valid, armedAt, firstTouchAt, touchCount, interaction,
		consumedAt,
		failedAt: terminal?.state === 'failed' ? terminal.at : null,
		spentAt: terminal?.state === 'spent' ? terminal.at : null,
		spentReason: terminal?.state === 'spent' ? 'ran-away' : null,
		invalidatedAt: terminal?.state === 'failed' ? terminal.at : null,
		endAt: terminal?.at ?? current.timestamp,
	}
}

function assignOuterRetirement(anchors: Anchor[], events: StructureEvent[], c: Candle[]): void {
	const outers = anchors.filter(x => x.zoneClass === 'outer-swing')
	for (const x of outers) {
		const opposite = events.find(e => e.type === 'choch' && e.confirmTimestamp > x.knownAt
			&& e.direction === (x.direction === 'long' ? 'down' : 'up'))
		const oppositeAt = opposite ? (c[opposite.confirmIndex + 1]?.timestamp ?? opposite.confirmTimestamp) : null
		const nextExtreme = outers.find(y => y !== x && y.direction === x.direction && y.knownAt > x.knownAt
			&& (x.direction === 'long' ? c[y.i]!.low < c[x.i]!.low : c[y.i]!.high > c[x.i]!.high))
		x.retiredAt = [oppositeAt, nextExtreme?.knownAt].filter((v): v is number => v != null).sort((a, b) => a - b)[0] ?? null
	}
}

function consolidate(raw: AreaCandidate[], c: Candle[]): AreaCandidate[] {
	const areas: AreaCandidate[] = []
	for (const source of [...raw].sort((a, b) => a.knownAt - b.knownAt || a.originAt - b.originAt)) {
		let area = evaluateArea(source, c)
		if (isOpen(area)) {
			for (;;) {
				// §16.8 (решение №7): склейка перекрывающихся ОТКРЫТЫХ зон одной стороны независимо
				// от класса — торгово это одна зона/одна позиция; классы компонентов сохраняются в
				// componentClasses. Склейка по пересечению времени жизни (а не «обе ещё открыты»)
				// проверена и ОТКЛОНЕНА: цепочки поглощений строят мега-зоны через месяцы, а каждое
				// поглощение сдвигает geometryKnownAt вперёд и съедает торговое окно подтверждения.
				// Историческая дедупликация умерших дублей — отдельное открытое решение (§16.8).
				const index = areas.findIndex(x => isOpen(x) && x.direction === area.direction && overlaps(x, area))
				if (index < 0) break
				area = evaluateArea(mergeArea(areas.splice(index, 1)[0]!, area), c)
			}
		}
		areas.push(area)
	}
	// §16.9 (решение №20): подавление near-дублей. Зоны одной стороны с near в пределах
	// dupNearAtr×ATR и пересекающимися окнами — одна и та же область: остаётся старшая
	// (класс, затем возраст), младшая помечается duplicateOf и не торгуется/не показывается.
	// Геометрия НЕ мутирует — окна подтверждения стабильны (в отличие от отклонённой
	// склейки по времени жизни). Было 45% дублей — «листаешь одно и то же».
	const bySeniority = [...areas].sort((a, b) =>
		Number(b.boundarySource === 'liquidity-cluster') - Number(a.boundarySource === 'liquidity-cluster')
		|| classRank(b.zoneClass) - classRank(a.zoneClass) || a.knownAt - b.knownAt || a.originAt - b.originAt)
	for (const senior of bySeniority) {
		if (senior.duplicateOf != null) continue
		for (const junior of bySeniority) {
			if (junior === senior || junior.duplicateOf != null) continue
			if (junior.direction !== senior.direction) continue
			if (Math.abs(junior.near - senior.near) > LIQUIDITY_POI_CONFIG.dupNearAtr * senior.atr) continue
			if (!(senior.knownAt < junior.endAt && junior.knownAt < senior.endAt)) continue
			junior.duplicateOf = senior.id
			senior.suppressedCount += 1
		}
	}
	const current = c.at(-1)!.close
	const fresh = areas.filter(x => x.valid && x.duplicateOf == null)
	const distance = (x: AreaCandidate) => {
		const lower = Math.min(x.near, x.far), upper = Math.max(x.near, x.far)
		return current < lower ? lower - current : current > upper ? current - upper : 0
	}
	// При равной дистанции (перекрывающиеся зоны с общей near-границей) nearest получает
	// зона с реальной ликвидностью на far-границе, затем более старший класс зоны.
	const nearestPick = (a: AreaCandidate, b: AreaCandidate) =>
		distance(a) - distance(b)
		|| Number(b.boundarySource === 'liquidity-cluster') - Number(a.boundarySource === 'liquidity-cluster')
		|| classRank(b.zoneClass) - classRank(a.zoneClass)
	const nearestLong = fresh.filter(x => x.direction === 'long').sort(nearestPick)[0]
	const nearestShort = fresh.filter(x => x.direction === 'short').sort(nearestPick)[0]
	return areas.map(x => {
		const priority: ZonePriority = x.zoneClass === 'outer-swing' && x.valid && x.duplicateOf == null ? 'outer'
			: x === nearestLong || x === nearestShort ? 'nearest' : 'secondary'
		return { ...x, priority, active: x.valid && priority !== 'secondary' && x.duplicateOf == null }
	})
}

export function detectLiquidityPoi(c: Candle[], events: StructureEvent[] = [], context: LiquidityPoiContext = {}): LiquidityPoiCandidate[] {
	if (!c.length) return []
	const structure = context.structure ?? []
	// §16.9: local-swing удалён — экстремум каждого внутреннего колена плодил зоны без ликвидности.
	const anchors = [
		...structuralAnchors(c, events, context),
		...localEqAnchors(pivots(c, events)),
	]
	assignOuterRetirement(anchors, events, c)
	const raw: AreaCandidate[] = []
	for (const x of anchors) {
		const candle = c[x.i], a = atr(c, x.i)
		if (!candle || !a || x.knownAt < candle.timestamp) continue
		const near = x.direction === 'long' ? candle.low : candle.high
		const pd = pdAt(c, structure, x.knownAt, near, x.direction)
		if (x.zoneClass === 'local-eq' && pd.pdAligned === false) continue
		const { far, boundarySource, liquidityBands } = liquidityFar(x.direction, near, a, x.knownAt, context.heatmapPools)
		raw.push({ id: `${LIQUIDITY_POI_VERSION}|${x.id}`, version: LIQUIDITY_POI_VERSION,
			direction: x.direction, zoneClass: x.zoneClass, anchorId: x.id, componentAnchorIds: [x.id], componentClasses: [x.zoneClass],
			originAt: candle.timestamp, knownAt: x.knownAt, geometryKnownAt: x.knownAt, near, far, atr: a,
			boundarySource, liquidityBands, pivotCount: x.pivots.length || 1,
			pivotPrices: x.pivots.length ? x.pivots.map(v => v.price) : [near],
			pivotTimes: x.pivots.length ? x.pivots.map(v => c[v.i]!.timestamp) : [candle.timestamp], eventType: x.eventType,
			pdZone: pd.pdZone, pdAligned: pd.pdAligned, lifecycleState: 'forming', valid: false, active: false,
			priority: 'secondary', interaction: 'untouched', touchCount: 0, armedAt: null, firstTouchAt: null,
			consumedAt: null, failedAt: null, spentAt: null, spentReason: null, duplicateOf: null, retiredAt: x.retiredAt, lineageSupersededAt: x.supersededAt,
			supersededAt: null, invalidatedAt: null, endAt: c.at(-1)!.timestamp, mergedCount: 0, suppressedCount: 0,
			segment: x.segment })
	}
	return consolidate(raw, c)
		.sort((a, b) => Number(b.active) - Number(a.active) || Number(b.valid) - Number(a.valid) || b.geometryKnownAt - a.geometryKnownAt)
		.map(({ segment: _segment, ...candidate }) => candidate)
}
