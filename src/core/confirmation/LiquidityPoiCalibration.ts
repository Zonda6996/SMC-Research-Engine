import type { Candle } from '../../models/price/Candle.js'
import type { StructureEvent } from '../../models/events/StructureEvent.js'
import type { StructurePoint } from '../../models/structure/StructurePoint.js'
import type { ProtectedLevelLifecycle } from '../../models/structure/ProtectedLevelLifecycle.js'
import type { LiquidityPool } from '../liquidity/LiquidityHeatmapEngine.js'

export const LIQUIDITY_POI_VERSION = 'liquidity-poi-1.0-liquidity-bound'
export type LiquidityZoneClass = 'outer-swing' | 'protected-structure' | 'local-eq' | 'local-swing'
export type BoundarySource = 'atr-calibration' | 'liquidity-cluster'
export type PdZone = 'premium' | 'discount' | 'none'
export type ZonePriority = 'nearest' | 'outer' | 'secondary'
export type InteractionState = 'untouched' | 'touched' | 'retested'
export type PoiLifecycleState = 'forming' | 'fresh' | 'in-play' | 'consumed' | 'failed' | 'retired'

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
	consumedAt: number | null
	failedAt: number | null
	retiredAt: number | null
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

function atr(c: Candle[], i: number, n = 14): number {
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
	for (let i = 2; i < c.length - 2; i++) {
		const x = c[i]!, a = atr(c, i)
		if (!a) continue
		const left = c.slice(i - 2, i), right = c.slice(i + 1, i + 3)
		const known = c[i + 2]!.timestamp
		const segment = eventSegment(events, i)
		if (segment < 0) continue
		if (left.every(v => x.low < v.low) && right.every(v => x.low < v.low)) out.push({ type: 'low', i, price: x.low, known, atr: a, segment })
		if (left.every(v => x.high > v.high) && right.every(v => x.high > v.high)) out.push({ type: 'high', i, price: x.high, known, atr: a, segment })
	}
	return out
}

/** Existing BTC visual-calibration geometry. No new boundary coefficient. */
function calibratedFar(direction: 'long' | 'short', near: number, a: number): number {
	return direction === 'long' ? near - a : near + 0.5 * a
}

const LIQ_FAR_LOOKBACK_ATR = 2.0
const LIQ_FAR_MIN_WEIGHT = 0.4

/** v1.0: граница far по реальным heatmap-пулам (каузально: только пулы, существовавшие и ещё не снятые на knownAt). Fallback — старая ATR-геометрия. */
function liquidityFar(
	direction: 'long' | 'short', near: number, a: number, knownAt: number, pools: LiquidityPool[] | undefined,
): { far: number; boundarySource: BoundarySource; liquidityBands: LiquidityBand[] } {
	const fallback = calibratedFar(direction, near, a)
	if (!pools?.length) return { far: fallback, boundarySource: 'atr-calibration', liquidityBands: [] }
	const lookback = a * LIQ_FAR_LOOKBACK_ATR
	const side = direction === 'long' ? 'buy-side' : 'sell-side'
	const alive = (p: LiquidityPool) => p.startAt <= knownAt && (p.sweptAt == null || p.sweptAt > knownAt)
	const candidates = pools.filter(p => p.side === side && p.weight >= LIQ_FAR_MIN_WEIGHT && alive(p)
		&& (direction === 'long'
			? p.bandLow <= near && p.bandLow >= near - lookback
			: p.bandHigh >= near && p.bandHigh <= near + lookback))
	if (!candidates.length) return { far: fallback, boundarySource: 'atr-calibration', liquidityBands: [] }
	const far = direction === 'long' ? Math.min(...candidates.map(p => p.bandLow)) : Math.max(...candidates.map(p => p.bandHigh))
	const liquidityBands: LiquidityBand[] = candidates.map(p => ({ price: p.extremePrice, score: p.weight, touches: p.contributions }))
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
		const scoped = prevOpposite ? candidates.filter(p => p.index > prevOpposite.confirmIndex) : candidates
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
			if (Math.max(...current) - Math.min(...current) <= 0.25 * Math.max(p.atr, q.atr)) group.push({ p: q, j })
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


function localSwingAnchors(c: Candle[], events: StructureEvent[], structure: StructurePoint[]): Anchor[] {
	const grouped = new Map<number, StructurePoint[]>()
	for (const point of structure) {
		const segment = eventSegment(events, point.index)
		if (segment < 0 || !c[point.index + 2]) continue
		const group = grouped.get(segment) ?? []
		group.push(point)
		grouped.set(segment, group)
	}
	const out: Anchor[] = []
	for (const [segment, points] of grouped) {
		for (const type of ['low', 'high'] as const) {
			const side = points.filter(x => x.type === type)
			if (!side.length) continue
			const point = type === 'low'
				? side.reduce((a, b) => a.price < b.price ? a : b)
				: side.reduce((a, b) => a.price > b.price ? a : b)
			const knownAt = c[point.index + 2]!.timestamp
			out.push({ id: `local-swing|${type}|${segment}|${point.index}`, direction: type === 'low' ? 'long' : 'short',
				zoneClass: 'local-swing', i: point.index, knownAt, eventType: 'local-swing', pivots: [], segment,
				supersededAt: null, invalidatedAt: null, active: true, retiredAt: null })
		}
	}
	return out
}

function overlaps(a: AreaCandidate, b: AreaCandidate): boolean {
	const aLow = Math.min(a.near, a.far), aHigh = Math.max(a.near, a.far)
	const bLow = Math.min(b.near, b.far), bHigh = Math.max(b.near, b.far)
	return aLow <= bHigh && bLow <= aHigh
}

function classRank(x: LiquidityZoneClass): number {
	return x === 'outer-swing' ? 4 : x === 'protected-structure' ? 3 : x === 'local-eq' ? 2 : 1
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
		consumedAt: null, failedAt: null, invalidatedAt: null,
		retiredAt: retireTimes.length ? Math.min(...retireTimes) : null,
		supersededAt: null, endAt: Math.max(a.endAt, b.endAt), mergedCount: components.length - 1,
		suppressedCount: components.length - 1, segment: dominant.segment,
	}
}

function evaluateArea(area: AreaCandidate, c: Candle[]): AreaCandidate {
	const start = c.findIndex(x => x.timestamp >= area.geometryKnownAt)
	const lower = Math.min(area.near, area.far), upper = Math.max(area.near, area.far)
	let armedAt = area.armedAt, firstTouchAt = area.firstTouchAt, touchCount = area.touchCount
	let consumedAt: number | null = null, failedAt: number | null = null
	let inside = false
	for (let i = Math.max(0, start); i < c.length; i++) {
		const bar = c[i]!
		if (area.retiredAt != null && bar.timestamp >= area.retiredAt) break
		if (area.direction === 'long' ? bar.close < lower : bar.close > upper) {
			failedAt = bar.timestamp
			break
		}
		if (armedAt == null) {
			if (area.direction === 'long' ? bar.close > upper : bar.close < lower) armedAt = bar.timestamp
			continue
		}
		const overlapsZone = bar.low <= upper && bar.high >= lower
		if (overlapsZone && !inside) {
			touchCount++
			firstTouchAt ??= bar.timestamp
		}
		inside = overlapsZone
		const isLocalClass = area.zoneClass === 'local-eq' || area.zoneClass === 'local-swing'
		const sweptNear = isLocalClass
			? (area.direction === 'long' ? bar.low < area.near : bar.high > area.near)
			: area.zoneClass === 'outer-swing'
				? false
				: (area.direction === 'long' ? bar.close < area.near : bar.close > area.near)
		if (sweptNear) {
			consumedAt = bar.timestamp
			break
		}
	}
	const terminal = [
		failedAt == null ? null : { state: 'failed' as const, at: failedAt },
		consumedAt == null ? null : { state: 'consumed' as const, at: consumedAt },
		area.retiredAt == null ? null : { state: 'retired' as const, at: area.retiredAt },
	].filter((x): x is { state: 'failed' | 'consumed' | 'retired'; at: number } => x != null)
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
		consumedAt: terminal?.state === 'consumed' ? terminal.at : null,
		failedAt: terminal?.state === 'failed' ? terminal.at : null,
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
				const index = areas.findIndex(x => isOpen(x) && x.direction === area.direction && x.zoneClass === area.zoneClass && overlaps(x, area))
				if (index < 0) break
				area = evaluateArea(mergeArea(areas.splice(index, 1)[0]!, area), c)
			}
		}
		areas.push(area)
	}
	const current = c.at(-1)!.close
	const fresh = areas.filter(x => x.valid)
	const distance = (x: AreaCandidate) => {
		const lower = Math.min(x.near, x.far), upper = Math.max(x.near, x.far)
		return current < lower ? lower - current : current > upper ? current - upper : 0
	}
	// При равной дистанции (перекрывающиеся зоны с общей near-границей) nearest получает
	// зона с реальной ликвидностью на far-границе, затем более старший класс зоны.
	const nearestPick = (a: LiquidityPoiCandidate, b: LiquidityPoiCandidate) =>
		distance(a) - distance(b)
		|| Number(b.boundarySource === 'liquidity-cluster') - Number(a.boundarySource === 'liquidity-cluster')
		|| classRank(b.zoneClass) - classRank(a.zoneClass)
	const nearestLong = fresh.filter(x => x.direction === 'long').sort(nearestPick)[0]
	const nearestShort = fresh.filter(x => x.direction === 'short').sort(nearestPick)[0]
	return areas.map(x => {
		const priority: ZonePriority = x.zoneClass === 'outer-swing' && x.valid ? 'outer'
			: x === nearestLong || x === nearestShort ? 'nearest' : 'secondary'
		return { ...x, priority, active: x.valid && priority !== 'secondary' }
	})
}

export function detectLiquidityPoi(c: Candle[], events: StructureEvent[] = [], context: LiquidityPoiContext = {}): LiquidityPoiCandidate[] {
	if (!c.length) return []
	const structure = context.structure ?? []
	const anchors = [
		...structuralAnchors(c, events, context),
		...localEqAnchors(pivots(c, events)),
		...localSwingAnchors(c, events, structure),
	]
	assignOuterRetirement(anchors, events, c)
	const raw: AreaCandidate[] = []
	for (const x of anchors) {
		const candle = c[x.i], a = atr(c, x.i)
		if (!candle || !a || x.knownAt < candle.timestamp) continue
		const near = x.direction === 'long' ? candle.low : candle.high
		const pd = pdAt(c, structure, x.knownAt, near, x.direction)
		if ((x.zoneClass === 'local-eq' || x.zoneClass === 'local-swing') && pd.pdAligned === false) continue
		const { far, boundarySource, liquidityBands } = liquidityFar(x.direction, near, a, x.knownAt, context.heatmapPools)
		raw.push({ id: `${LIQUIDITY_POI_VERSION}|${x.id}`, version: LIQUIDITY_POI_VERSION,
			direction: x.direction, zoneClass: x.zoneClass, anchorId: x.id, componentAnchorIds: [x.id], componentClasses: [x.zoneClass],
			originAt: candle.timestamp, knownAt: x.knownAt, geometryKnownAt: x.knownAt, near, far, atr: a,
			boundarySource, liquidityBands, pivotCount: x.pivots.length || 1,
			pivotPrices: x.pivots.length ? x.pivots.map(v => v.price) : [near],
			pivotTimes: x.pivots.length ? x.pivots.map(v => c[v.i]!.timestamp) : [candle.timestamp], eventType: x.eventType,
			pdZone: pd.pdZone, pdAligned: pd.pdAligned, lifecycleState: 'forming', valid: false, active: false,
			priority: 'secondary', interaction: 'untouched', touchCount: 0, armedAt: null, firstTouchAt: null,
			consumedAt: null, failedAt: null, retiredAt: x.retiredAt, lineageSupersededAt: x.supersededAt,
			supersededAt: null, invalidatedAt: null, endAt: c.at(-1)!.timestamp, mergedCount: 0, suppressedCount: 0,
			segment: x.segment })
	}
	return consolidate(raw, c)
		.sort((a, b) => Number(b.active) - Number(a.active) || Number(b.valid) - Number(a.valid) || b.geometryKnownAt - a.geometryKnownAt)
		.map(({ segment: _segment, ...candidate }) => candidate)
}
