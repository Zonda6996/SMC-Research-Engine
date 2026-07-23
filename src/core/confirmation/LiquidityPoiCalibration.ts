import type { Candle } from '../../models/price/Candle.js'
import type { StructureEvent } from '../../models/events/StructureEvent.js'
import type { StructurePoint } from '../../models/structure/StructurePoint.js'
import type { ProtectedLevelLifecycle } from '../../models/structure/ProtectedLevelLifecycle.js'
import type { LiquidityPool } from '../liquidity/LiquidityHeatmapEngine.js'

// SPEC §16.12 (v2.0, утверждено 23.07.2026): ЗОНЫ РОЖДАЮТСЯ ОТ ЛИКВИДНОСТИ, структура — пометка.
// Три раунда визуального QA показали: генерация от структурных записей (protected/EQ/outer) даёт карту,
// расходящуюся с ручной картой пользователя, у которого каждая зона = жирная СВЕЖАЯ полка heatmap +
// ближайший невыметенный экстремум. v2.0: полка (стек живых свежих пулов) значима по силе×свежести →
// зона [near=wick экстремума перед полкой или край полки, far=конец стека]; жизнь зоны = жизнь её стека.
// Правило ran-away («3 ATR от near») ОТМЕНЕНО; отставка по CHoCH не применяется. Подтверждение (1.6)
// работает без изменений — интерфейс LiquidityPoiCandidate сохранён.
export const LIQUIDITY_POI_VERSION = 'liquidity-poi-2.0-liquidity-first'

/**
 * Все константы POI-движка (§16.12). Значения стартовые, калибруются по визуальному QA;
 * менять только с явного согласия пользователя.
 */
export const LIQUIDITY_POI_CONFIG = {
	/** Период ATR (стандартная детекторная константа). */
	atrPeriod: 14,
	/** Стек: соседний пул присоединяется к полке при перекрытии или разрыве ≤ этой доли ATR (§16.10). */
	stackGapAtr: 0.5,
	/** Потолок высоты полки/зоны, в ATR — лестница ликвидаций почти непрерывна (§16.10). */
	stackMaxAtr: 6.0,
	/** Значимость: полка рождает зону, только если входит в топ-N по notional на свою сторону. */
	shelfTopN: 5,
	/** Свежесть: пул участвует в полке, пока прошло ≤ этого числа баров ТФ зоны от его последнего
	 * пополнения (согласовано с age-фильтром heatmap-вьюера — пользователь смотрит 500). */
	shelfFreshBars: 500,
	/** Near = точный wick невыметенного 4h-экстремума, если он в пределах этой доли ATR от ближнего
	 * края полки (§12.1); иначе near = край полки. */
	nearTolAtr: 0.5,
	/** «Стек снят»: зона отработана, когда снято ≥ этой доли суммарного notional её полки. */
	stackConsumedShare: 0.5,
	/** §16.9: near-дубль — зона той же стороны с near в пределах этой доли ATR и пересекающимся окном. */
	dupNearAtr: 0.25,
	/** §16.11: дубль и по перекрытию — диапазоны одной стороны пересекаются на эту долю меньшей зоны. */
	dupOverlapShare: 0.6,
	/** Идентичность полки между барами при сканировании (анти-спам эмиссии): перекрытие ≥ этой доли. */
	shelfIdentityShare: 0.6,
	/** Значимость-пол: полка рождает зону, только если её notional ≥ этой доли суммы свежих пулов стороны
	 * (отсекает одинокие тонкие пулы лестницы ликвидаций, пролезающие в топ-N в тонкие периоды). */
	shelfMinShare: 0.05,
	/** Перерождение полки: если ≥ этой доли notional текущей полки — из пулов, которых не было в прошлых
	 * эмиссиях этого места, полка считается НОВЫМ поколением и рождает зону заново (re-accumulation). */
	shelfNoveltyShare: 0.5,
} as const

/** §16.12: структурные классы зон больше не рождаются; значение оставлено одно + легаси для типов. */
export type LiquidityZoneClass = 'liquidity-shelf' | 'outer-swing' | 'protected-structure' | 'local-eq'
export type BoundarySource = 'atr-calibration' | 'liquidity-cluster'
export type PdZone = 'premium' | 'discount' | 'none'
export type ZonePriority = 'nearest' | 'outer' | 'secondary'
export type InteractionState = 'untouched' | 'touched' | 'retested'
/**
 * Терминальные состояния: failed (4h close телом за far), spent (стек снят насквозь/по объёму или
 * взяли тейк — confirmation), retired (легаси, v2-зоны не ретирятся). Использованность (consumed) —
 * информационная пометка consumedAt, окно торговли не закрывает (§16.8).
 */
export type PoiLifecycleState = 'forming' | 'fresh' | 'in-play' | 'spent' | 'failed' | 'retired'

export interface LiquidityBand { price: number; score: number; touches: number }
export interface LiquidityPoiContext {
	structure?: StructurePoint[]
	/** Легаси-вход: v2.0 protected-историю не использует (структура зоны не рождает). */
	protectedHistory?: ProtectedLevelLifecycle[]
	/** Пулы heatmap того же TF — единственный источник зон в v2.0. Без них зон нет. */
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
	/** 'shelf+extremum' — near на невыметенном wick'е перед полкой (§12.1); 'shelf-edge' — near по краю полки. */
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
	/** Информационная пометка «использована»: первый фитиль сквозь near после взведения. */
	consumedAt: number | null
	failedAt: number | null
	retiredAt: number | null
	/** «Зона отработала»: стек снят (насквозь или по объёму). */
	spentAt: number | null
	spentReason: 'swept-through' | 'stack-consumed' | null
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

interface ShelfPoolSnap { notional: number; sweptAt: number | null; lastContributionAt: number }
interface AreaCandidate extends LiquidityPoiCandidate { shelfPools: ShelfPoolSnap[] }
interface Shelf { lo: number; hi: number; notional: number; pools: LiquidityPool[] }

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

interface Fractal { type: 'low' | 'high'; i: number; price: number; known: number; sweptAt: number | null }

/** 4h-фракталы 2+2 с моментом подтверждения (close бара i+2) и моментом снятия wick'а. */
function fractals(c: Candle[]): Fractal[] {
	const out: Fractal[] = []
	const tfMs = c.length > 1 ? c[1]!.timestamp - c[0]!.timestamp : 0
	for (let i = 2; i < c.length - 2; i++) {
		const x = c[i]!
		const left = c.slice(i - 2, i), right = c.slice(i + 1, i + 3)
		const known = c[i + 2]!.timestamp + tfMs
		if (left.every(v => x.low < v.low) && right.every(v => x.low < v.low)) {
			let sweptAt: number | null = null
			for (let k = i + 1; k < c.length; k++) if (c[k]!.low < x.low) { sweptAt = c[k]!.timestamp; break }
			out.push({ type: 'low', i, price: x.low, known, sweptAt })
		}
		if (left.every(v => x.high > v.high) && right.every(v => x.high > v.high)) {
			let sweptAt: number | null = null
			for (let k = i + 1; k < c.length; k++) if (c[k]!.high > x.high) { sweptAt = c[k]!.timestamp; break }
			out.push({ type: 'high', i, price: x.high, known, sweptAt })
		}
	}
	return out
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

/** Кластеризация живых свежих пулов стороны в полки: перекрытие или разрыв ≤ stackGapAtr×ATR. */
function buildShelves(pools: LiquidityPool[], a: number): Shelf[] {
	const cfg = LIQUIDITY_POI_CONFIG
	const sorted = [...pools].sort((x, y) => x.bandLow - y.bandLow)
	const shelves: Shelf[] = []
	for (const p of sorted) {
		const last = shelves.at(-1)
		if (last && p.bandLow <= last.hi + cfg.stackGapAtr * a) {
			last.hi = Math.max(last.hi, p.bandHigh)
			last.lo = Math.min(last.lo, p.bandLow)
			last.notional += p.notional
			last.pools.push(p)
		} else {
			shelves.push({ lo: p.bandLow, hi: p.bandHigh, notional: p.notional, pools: [p] })
		}
	}
	return shelves
}

const overlapShare = (aLo: number, aHi: number, bLo: number, bHi: number): number => {
	const ov = Math.min(aHi, bHi) - Math.max(aLo, bLo)
	if (ov <= 0) return 0
	return ov / Math.max(1e-9, Math.min(aHi - aLo, bHi - bLo))
}

function classRank(_x: LiquidityZoneClass): number {
	return 1
}

function isOpen(x: AreaCandidate): boolean {
	return x.lifecycleState === 'forming' || x.lifecycleState === 'fresh' || x.lifecycleState === 'in-play'
}

/**
 * §16.12: жизнь зоны = жизнь её стека. Терминалы: провал (4h close телом за far), проход насквозь
 * (фитиль за far, момент = закрытие бара прохода), снятие стека по объёму (≥ stackConsumedShare
 * суммарного notional полки — по sweptAt пулов). Ran-away и CHoCH-отставка отменены.
 */
function evaluateArea(area: AreaCandidate, c: Candle[]): AreaCandidate {
	const cfg = LIQUIDITY_POI_CONFIG
	const long = area.direction === 'long'
	const tfMs = c.length > 1 ? c[1]!.timestamp - c[0]!.timestamp : 0
	const start = c.findIndex(x => x.timestamp >= area.geometryKnownAt)
	const lower = Math.min(area.near, area.far), upper = Math.max(area.near, area.far)
	let armedAt = area.armedAt, firstTouchAt = area.firstTouchAt, touchCount = area.touchCount
	let consumedAt: number | null = area.consumedAt, failedAt: number | null = null
	let spentAt: number | null = null, spentKind: 'swept-through' | 'stack-consumed' | null = null
	let inside = false
	for (let i = Math.max(0, start); i < c.length; i++) {
		const bar = c[i]!
		// §14.6/§16.8: провал = close телом за дальней границей.
		if (long ? bar.close < lower : bar.close > upper) {
			failedAt = bar.timestamp
			break
		}
		// §16.10: проход НАСКВОЗЬ — фитиль за far — весь стек снят; момент известен на закрытии бара.
		if (long ? bar.low < lower : bar.high > upper) {
			spentAt = bar.timestamp + tfMs
			spentKind = 'swept-through'
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
		// §16.8: использованность — информационная пометка (первый фитиль сквозь near после взведения).
		if (consumedAt == null && (long ? bar.low < area.near : bar.high > area.near)) consumedAt = bar.timestamp
	}
	// §16.12: снятие стека по объёму — момент, когда снято ≥ stackConsumedShare суммарного notional полки.
	let stackConsumedAt: number | null = null
	const total = area.shelfPools.reduce((s, p) => s + p.notional, 0)
	if (total > 0) {
		const sweeps = area.shelfPools.filter(p => p.sweptAt != null).sort((a, b) => a.sweptAt! - b.sweptAt!)
		let cum = 0
		for (const p of sweeps) {
			cum += p.notional
			if (cum >= cfg.stackConsumedShare * total) { stackConsumedAt = p.sweptAt!; break }
		}
		if (stackConsumedAt != null && stackConsumedAt < area.geometryKnownAt) stackConsumedAt = area.geometryKnownAt
	}
	// §16.12: стек перестал кормиться (все пулы старше shelfFreshBars) → зона устарела (retired).
	// Именно это выключает древние вершины: пулы не сняты, но ликвидность там давно не копится —
	// пользователь такие полки в heatmap-вьюере тоже не видит (age-фильтр).
	const lastFeed = area.shelfPools.reduce((m, p) => Math.max(m, p.lastContributionAt), 0)
	const staleAt = lastFeed + cfg.shelfFreshBars * tfMs
	const dataEnd = c.at(-1)!.timestamp
	type Terminal = { state: 'failed' | 'spent' | 'retired'; at: number; kind: 'swept-through' | 'stack-consumed' | null }
	const terminals: Terminal[] = []
	if (failedAt != null) terminals.push({ state: 'failed', at: failedAt, kind: null })
	if (spentAt != null) terminals.push({ state: 'spent', at: spentAt, kind: spentKind })
	if (stackConsumedAt != null) terminals.push({ state: 'spent', at: stackConsumedAt, kind: 'stack-consumed' })
	if (staleAt <= dataEnd) terminals.push({ state: 'retired', at: Math.max(staleAt, area.geometryKnownAt), kind: null })
	const terminal = terminals.sort((x, y) => x.at - y.at)[0]
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
		retiredAt: terminal?.state === 'retired' ? terminal.at : null,
		spentAt: terminal?.state === 'spent' ? terminal.at : null,
		spentReason: terminal?.state === 'spent' ? terminal.kind : null,
		invalidatedAt: terminal?.state === 'failed' ? terminal.at : null,
		endAt: terminal?.at ?? current.timestamp,
	}
}

/** §16.9/§16.11: подавление дублей (near ≤ dupNearAtr×ATR или перекрытие ≥ dupOverlapShare меньшей). */
function consolidate(raw: AreaCandidate[], c: Candle[]): AreaCandidate[] {
	const cfg = LIQUIDITY_POI_CONFIG
	const areas = [...raw].sort((a, b) => a.knownAt - b.knownAt || a.originAt - b.originAt).map(x => evaluateArea(x, c))
	const bySeniority = [...areas].sort((a, b) => a.knownAt - b.knownAt || a.originAt - b.originAt)
	for (const senior of bySeniority) {
		if (senior.duplicateOf != null) continue
		for (const junior of bySeniority) {
			if (junior === senior || junior.duplicateOf != null) continue
			if (junior.direction !== senior.direction) continue
			if (junior.knownAt < senior.knownAt) continue
			if (!(senior.knownAt < junior.endAt && junior.knownAt < senior.endAt)) continue
			const nearDup = Math.abs(junior.near - senior.near) <= cfg.dupNearAtr * senior.atr
			const sLo = Math.min(senior.near, senior.far), sHi = Math.max(senior.near, senior.far)
			const jLo = Math.min(junior.near, junior.far), jHi = Math.max(junior.near, junior.far)
			const overlapDup = overlapShare(sLo, sHi, jLo, jHi) >= cfg.dupOverlapShare
			if (!nearDup && !overlapDup) continue
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
	// При равной дистанции nearest получает более СИЛЬНАЯ полка (notional стека).
	const nearestPick = (a: AreaCandidate, b: AreaCandidate) =>
		distance(a) - distance(b)
		|| b.shelfPools.reduce((s, p) => s + p.notional, 0) - a.shelfPools.reduce((s, p) => s + p.notional, 0)
	const nearestLong = fresh.filter(x => x.direction === 'long').sort(nearestPick)[0]
	const nearestShort = fresh.filter(x => x.direction === 'short').sort(nearestPick)[0]
	return areas.map(x => {
		const priority: ZonePriority = x === nearestLong || x === nearestShort ? 'nearest' : 'secondary'
		// §16.12: «важные» = ближайшая пара + все свежие непод авленные зоны значимых полок.
		return { ...x, priority, active: x.valid && x.duplicateOf == null }
	})
}

/**
 * §16.12: сканирование полок по времени. На каждом 4h-баре собираются живые СВЕЖИЕ пулы стороны,
 * кластеризуются в полки, берётся топ-N по notional; полка, впервые вошедшая в топ (нет полки с
 * перекрытием ≥ shelfIdentityShare среди значимых на предыдущем баре), рождает зону-кандидата.
 * Геометрия замораживается на knownAt (= закрытие бара); рост стека позже даёт нового кандидата,
 * которого дедуп подавляет, пока старшая зона жива.
 */
export function detectLiquidityPoi(c: Candle[], _events: StructureEvent[] = [], context: LiquidityPoiContext = {}): LiquidityPoiCandidate[] {
	if (!c.length) return []
	const cfg = LIQUIDITY_POI_CONFIG
	const pools = context.heatmapPools ?? []
	if (!pools.length) return []
	const structure = context.structure ?? []
	const tfMs = c.length > 1 ? c[1]!.timestamp - c[0]!.timestamp : 0
	const fr = fractals(c)
	const bySide: Record<'buy-side' | 'sell-side', LiquidityPool[]> = {
		'buy-side': pools.filter(p => p.side === 'buy-side').sort((a, b) => a.startAt - b.startAt),
		'sell-side': pools.filter(p => p.side === 'sell-side').sort((a, b) => a.startAt - b.startAt),
	}
	const raw: AreaCandidate[] = []
	// Реестр эмиссий: полка перерождает зону, только когда её пулы существенно ОБНОВИЛИСЬ
	// (re-accumulation): доля notional новых пулов ≥ shelfNoveltyShare. Непрерывно значимая полка
	// эмитится один раз; её умершая зона (стек снят) перерождается на новых пулах.
	const emissions: Record<'buy-side' | 'sell-side', Array<{ lo: number; hi: number; poolIds: Set<string> }>> = { 'buy-side': [], 'sell-side': [] }
	for (let i = 0; i < c.length; i++) {
		const bar = c[i]!
		const t = bar.timestamp + tfMs // состояние пулов известно на ЗАКРЫТИИ бара
		const a = atr(c, i)
		if (!a) continue
		for (const side of ['buy-side', 'sell-side'] as const) {
			const direction = side === 'buy-side' ? 'long' : 'short'
			// Живые и свежие пулы: родился к t, не снят к t, кормился не дальше shelfFreshBars назад.
			// Строгие границы: пул рождается ВНУТРИ бара startAt (на закрытии предыдущего его ещё нет),
			// снятый на баре sweptAt пул жив ещё на закрытии этого бара.
			const freshPools = bySide[side].filter(p => p.startAt < t
				&& (p.sweptAt == null || p.sweptAt >= t)
				&& t <= p.lastContributionAt + cfg.shelfFreshBars * tfMs)
			if (!freshPools.length) continue
			const sideTotal = freshPools.reduce((sm, p) => sm + p.notional, 0)
			const shelves = buildShelves(freshPools, a)
			const significant = [...shelves].sort((x, y) => y.notional - x.notional).slice(0, cfg.shelfTopN)
				.filter(sh => sh.notional >= cfg.shelfMinShare * sideTotal)
			for (const shelf of significant) {
				const knownIds = new Set<string>()
				for (const e of emissions[side]) {
					if (overlapShare(e.lo, e.hi, shelf.lo, shelf.hi) >= cfg.shelfIdentityShare) for (const id of e.poolIds) knownIds.add(id)
				}
				const novelNotional = shelf.pools.filter(p => !knownIds.has(p.id)).reduce((sm, p) => sm + p.notional, 0)
				if (knownIds.size > 0 && novelNotional < cfg.shelfNoveltyShare * shelf.notional) continue
				emissions[side].push({ lo: shelf.lo, hi: shelf.hi, poolIds: new Set(shelf.pools.map(p => p.id)) })
				// Потолок высоты зоны: стек режется от БЛИЖНЕГО края (для лонга — сверху вниз).
				const edge = direction === 'long' ? shelf.hi : shelf.lo
				const farLimit = direction === 'long' ? edge - cfg.stackMaxAtr * a : edge + cfg.stackMaxAtr * a
				const far = direction === 'long' ? Math.max(shelf.lo, farLimit) : Math.min(shelf.hi, farLimit)
				// Near: точный wick невыметенного экстремума перед полкой (±nearTolAtr от края), иначе край.
				const tol = cfg.nearTolAtr * a
				const candidates = fr.filter(f => f.type === (direction === 'long' ? 'low' : 'high')
					&& f.known <= t && (f.sweptAt == null || f.sweptAt > t)
					&& Math.abs(f.price - edge) <= tol)
				const anchor = candidates.length
					? candidates.reduce((best, f) => Math.abs(f.price - edge) < Math.abs(best.price - edge) ? f : best)
					: null
				const near = anchor ? anchor.price : edge
				const pd = pdAt(c, structure, t, near, direction)
				const sorted = [...shelf.pools].sort((x, y) => x.notional - y.notional)
				const weight = new Map(sorted.map((p, k) => [p, Math.pow((k + 1) / sorted.length, 1.5)]))
				raw.push({
					id: `${LIQUIDITY_POI_VERSION}|shelf|${side}|${i}|${Math.round(shelf.lo)}-${Math.round(shelf.hi)}`,
					version: LIQUIDITY_POI_VERSION,
					direction, zoneClass: 'liquidity-shelf',
					anchorId: `shelf|${side}|${i}|${Math.round(near)}`,
					componentAnchorIds: shelf.pools.map(p => p.id), componentClasses: ['liquidity-shelf'],
					originAt: Math.min(...shelf.pools.map(p => p.startAt)), knownAt: t, geometryKnownAt: t,
					near, far, atr: a, boundarySource: 'liquidity-cluster',
					liquidityBands: shelf.pools.map(p => ({ price: p.extremePrice, score: weight.get(p)!, touches: p.contributions })),
					pivotCount: shelf.pools.length,
					pivotPrices: shelf.pools.map(p => p.extremePrice),
					pivotTimes: shelf.pools.map(p => p.startAt),
					eventType: anchor ? 'shelf+extremum' : 'shelf-edge',
					pdZone: pd.pdZone, pdAligned: pd.pdAligned,
					lifecycleState: 'forming', valid: false, active: false, priority: 'secondary',
					interaction: 'untouched', touchCount: 0, armedAt: null, firstTouchAt: null,
					consumedAt: null, failedAt: null, retiredAt: null, spentAt: null, spentReason: null,
					duplicateOf: null, lineageSupersededAt: null, supersededAt: null, invalidatedAt: null,
					endAt: c.at(-1)!.timestamp, mergedCount: 0, suppressedCount: 0,
					shelfPools: shelf.pools.map(p => ({ notional: p.notional, sweptAt: p.sweptAt, lastContributionAt: p.lastContributionAt })),
				})
			}
		}
	}
	return consolidate(raw, c)
		.sort((a, b) => Number(b.active) - Number(a.active) || Number(b.valid) - Number(a.valid) || b.geometryKnownAt - a.geometryKnownAt)
		.map(({ shelfPools: _shelfPools, ...candidate }) => candidate)
}
