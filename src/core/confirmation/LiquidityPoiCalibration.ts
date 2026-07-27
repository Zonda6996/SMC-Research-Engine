import type { Candle } from '../../models/price/Candle.js'
import type { StructureEvent } from '../../models/events/StructureEvent.js'
import type { StructurePoint } from '../../models/structure/StructurePoint.js'
import type { ProtectedLevelLifecycle } from '../../models/structure/ProtectedLevelLifecycle.js'
import type { LiquidityPool } from '../liquidity/LiquidityHeatmapEngine.js'

// SPEC §16.12 (v2.0) + §16.13 (v2.1, калибровка 24.07.2026): ЗОНЫ РОЖДАЮТСЯ ОТ ЛИКВИДНОСТИ.
// v2.0: полка (стек живых свежих пулов) значима по силе×свежести → зона [near=wick экстремума перед
// полкой или край полки, far=конец стека]; жизнь зоны = жизнь её стека. Ran-away и CHoCH-отставка отменены.
// v2.1 (диагноз 4-го QA — зоны-гиганты): склейка соседних пулов по краям полос строила мега-цепи
// (48–59k одной зоной), а дистанционная кластеризация ядер не работает в принципе: лестница ликвидаций
// почти непрерывна с шагом в % от цены (бины), а не в ATR. Полка теперь = СУПЕР-ЦЕПЬ (склейка §16.10),
// РАЗРЕЗАННАЯ ПО ПРОВАЛАМ ПЛОТНОСТИ notional-профиля (как провалы в правой панели heatmap, по которым
// пользователь и рисует границы руками). Потолок высоты — % от цены края (ATR-потолок 6.0 дал гигантов
// 9–11k при ATR рождения 1500–1800, а 3 ATR в спокойном режиме резал бы эталонные ручные зоны).
// v2.2 (5-й QA): РОДСТВО СТЕКОВ — зоны, делящие ≥ половины меньшего стека (общие пулы), считаются
// одним объектом: «близнецы» сползших окон и вложенные поколения роста схлопываются; побеждает
// старшая, если тронута до рождения младшей (окно подтверждения в работе), иначе младшая (свежая
// геометрия), старшая отставляется (supersededAt). Плюс дисплей-метрика силы стека (stackShare)
// для фильтра слабых полок в UI. Подтверждение (1.6) работает без изменений.
// v2.3 (§16.15): замещение только при УДЕРЖАНИИ МАССЫ — младшая отставляет нетронутую старшую, лишь
// удерживая ≥ stackKinshipShare СТАРШЕГО стека; сползшее вбок окно (роняющее массу) — дубль.
// v2.4 (§16.16): stack-consumed наступает на ЗАКРЫТИИ бара снятия (+tfMs), консистентно со
// swept-through §16.10 — пересвип внутри бара снятия больше не отрезается окном зоны.
export const LIQUIDITY_POI_VERSION = 'liquidity-poi-2.4-consumed-at-close'

/** Типизированный конфиг движка зон: все значения переопределяемы через LiquidityPoiContext.config. */
export interface LiquidityPoiConfig {
	atrPeriod: number
	stackGapAtr: number
	stackMaxPct: number
	shelfProfileBinPct: number
	shelfValleyShare: number
	shelfValleyMinBins: number
	shelfTopN: number
	shelfFreshBars: number
	nearTolAtr: number
	stackConsumedShare: number
	dupNearAtr: number
	dupOverlapShare: number
	dupMaxHeightRatio: number
	shelfIdentityShare: number
	stackKinshipShare: number
	shelfMinShare: number
	shelfNoveltyShare: number
}

/**
 * Все константы POI-движка (§16.12/§16.13). Значения стартовые, калибруются по визуальному QA;
 * менять только с явного согласия пользователя.
 */
export const LIQUIDITY_POI_CONFIG: LiquidityPoiConfig = {
	/** Период ATR (стандартная детекторная константа). */
	atrPeriod: 14,
	/** Супер-цепь: соседний пул приклеивается при перекрытии или разрыве полос ≤ этой доли ATR (§16.10).
	 * С v2.1 это только ПЕРВЫЙ шаг — границы зон задаёт разрез цепи по провалам плотности. */
	stackGapAtr: 0.5,
	/** §16.13: потолок высоты зоны — доля от цены ближнего края полки (стабильная единица: ручные зоны
	 * пользователя ≤ ~7.8% от края; ATR-потолок был нестабилен между режимами волатильности). */
	stackMaxPct: 0.08,
	/** §16.13: ширина корзины notional-профиля полки (лог-шаг, доля цены) — как бин heatmap 4h. */
	shelfProfileBinPct: 0.004,
	/** §16.13: уровень провала — корзина «пустая», если её notional < этой доли ПИКА профиля цепи. */
	shelfValleyShare: 0.25,
	/** §16.13: разрез цепи там, где подряд ≥ этого числа пустых корзин (≈1.2% цены при бине 0.4%). */
	shelfValleyMinBins: 3,
	/** Значимость: полка рождает зону, только если входит в топ-N по notional на свою сторону. */
	shelfTopN: 5,
	/** §16.13: свежесть 500 → 300 — пул участвует в полке, пока прошло ≤ этого числа баров ТФ зоны от
	 * его последнего пополнения; 500 (83 дня) держало майские мега-полки против текущих. Та же константа
	 * гасит устаревшие зоны (retired), укорачивая линии «через весь график». */
	shelfFreshBars: 300,
	/** Near = точный wick невыметенного 4h-экстремума, если он в пределах этой доли ATR от ближнего
	 * края полки (§12.1); иначе near = край полки. */
	nearTolAtr: 0.5,
	/** «Стек снят»: зона отработана, когда снято ≥ этой доли суммарного notional её полки. */
	stackConsumedShare: 0.5,
	/** §16.9: near-дубль — зона той же стороны с near в пределах этой доли ATR и пересекающимся окном. */
	dupNearAtr: 0.25,
	/** §16.11: дубль и по перекрытию — диапазоны одной стороны пересекаются на эту долю меньшей зоны. */
	dupOverlapShare: 0.6,
	/** §16.13: гард перекрытия — дубль только при СОПОСТАВИМОЙ высоте (младшая ≤ этого множителя высоты
	 * старшей). Правило перекрытия писалось под «два стопа в одной зоне»; без гарда старая узкая зона
	 * маскировала полку, выросшую вокруг неё после ре-аккумуляции (кейс 53.2–57.4k: 12B без зоны). */
	dupMaxHeightRatio: 2.0,
	/** Идентичность полки между барами при сканировании (анти-спам эмиссии): перекрытие ≥ этой доли. */
	shelfIdentityShare: 0.6,
	/** §16.14: родство стеков — две зоны считаются одним объектом ликвидности, если общий notional
	 * их стеков ≥ этой доли МЕНЬШЕГО стека. Ловит «близнецов» (окно полки сползло: 71% общих пулов
	 * при перекрытии цен 50%) и вложенные поколения роста. Победитель: старшая, если её окно уже
	 * В РАБОТЕ (тронута до рождения младшей), иначе — младшая (свежая геометрия), старшая получает
	 * supersededAt. Значение согласовано с shelfNoveltyShare: «наполовину тот же стек». */
	stackKinshipShare: 0.5,
	/** Значимость-пол: полка рождает зону, только если её notional ≥ этой доли суммы свежих пулов стороны
	 * (отсекает одинокие тонкие пулы лестницы ликвидаций, пролезающие в топ-N в тонкие периоды).
	 * §16.13: 0.05 → 0.03 — после разреза цепей по провалам нотионалы полок упали, 0.05 убивал
	 * эталонную полку 63–64.2k (6.7B при поле 7.5B). */
	shelfMinShare: 0.03,
	/** Перерождение полки: если ≥ этой доли notional текущей полки — из пулов, которых не было в прошлых
	 * эмиссиях этого места, полка считается НОВЫМ поколением и рождает зону заново (re-accumulation). */
	shelfNoveltyShare: 0.5,
}

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
	/** §16.13: переопределение констант (диагностика вариантов, конфиги движков в UI визуализатора).
	 * Без него используется LIQUIDITY_POI_CONFIG; правила значений те же — менять по согласованию. */
	config?: Partial<LiquidityPoiConfig>
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
	/** §16.14: суммарный notional стека зоны (пулы полки на момент рождения). */
	stackNotional: number
	/** §16.14: доля стека от сильнейшего АКТИВНОГО стека той же стороны на конец истории (0..1+,
	 * у мёртвых зон может превышать 1) — дисплей-метрика «сила полки» для фильтра слабых зон в UI. */
	stackShare: number
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

/** Кластеризация живых свежих пулов стороны в СУПЕР-ЦЕПИ: перекрытие или разрыв ≤ stackGapAtr×ATR. */
function buildChains(pools: LiquidityPool[], a: number, cfg: LiquidityPoiConfig): Shelf[] {
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

/** Конверт полки по полосам её пулов. */
function envelope(pools: LiquidityPool[]): Shelf {
	let lo = Infinity, hi = -Infinity, notional = 0
	for (const p of pools) {
		lo = Math.min(lo, p.bandLow)
		hi = Math.max(hi, p.bandHigh)
		notional += p.notional
	}
	return { lo, hi, notional, pools }
}

/**
 * §16.13: разрез супер-цепи по ПРОВАЛАМ ПЛОТНОСТИ. Notional пулов раскладывается по лог-корзинам
 * shelfProfileBinPct; провал = подряд ≥ shelfValleyMinBins корзин с массой < shelfValleyShare × пик
 * профиля цепи. Разрез — по середине провала; пулы распределяются по ядрам (extremePrice). Лестница
 * ликвидаций почти непрерывна, поэтому дистанция между ядрами не разделяет полки — их разделяют
 * именно провалы массы, которые пользователь видит в профиле heatmap и по которым рисует границы.
 * Тонкие хвосты цепи (провал у края) отрезаются теми же правилами и умирают о shelfMinShare/topN.
 */
function splitChainAtValleys(chain: Shelf, cfg: LiquidityPoiConfig): Shelf[] {
	if (chain.pools.length < 2) return [chain]
	const step = Math.log(1 + cfg.shelfProfileBinPct)
	const k0 = Math.floor(Math.log(chain.lo) / step)
	const k1 = Math.floor(Math.log(chain.hi) / step)
	const n = k1 - k0 + 1
	if (n < cfg.shelfValleyMinBins + 2) return [chain]
	const density = new Array<number>(n).fill(0)
	for (const p of chain.pools) {
		const a = Math.max(k0, Math.floor(Math.log(p.bandLow) / step))
		const b = Math.min(k1, Math.floor(Math.log(p.bandHigh) / step))
		const cover = Math.max(1, b - a + 1)
		for (let k = a; k <= b; k++) density[k - k0]! += p.notional / cover
	}
	const cut = cfg.shelfValleyShare * Math.max(...density)
	const splits: number[] = []
	let runStart = -1
	for (let i = 0; i <= n; i++) {
		const below = i < n && density[i]! < cut
		if (below && runStart < 0) runStart = i
		if (!below && runStart >= 0) {
			if (i - runStart >= cfg.shelfValleyMinBins) splits.push(Math.exp((k0 + runStart + (i - runStart) / 2) * step))
			runStart = -1
		}
	}
	if (!splits.length) return [chain]
	const parts: LiquidityPool[][] = Array.from({ length: splits.length + 1 }, () => [])
	for (const p of chain.pools) parts[splits.filter(s => p.extremePrice >= s).length]!.push(p)
	return parts.filter(x => x.length).map(envelope)
}

/** §16.13: полки стороны = супер-цепи, разрезанные по провалам плотности. */
function buildShelves(pools: LiquidityPool[], a: number, cfg: LiquidityPoiConfig): Shelf[] {
	return buildChains(pools, a, cfg).flatMap(chain => splitChainAtValleys(chain, cfg))
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
function evaluateArea(area: AreaCandidate, c: Candle[], cfg: LiquidityPoiConfig): AreaCandidate {
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
	// §16.16 (v2.4): момент = ЗАКРЫТИЕ бара снятия (+tfMs), как у swept-through (§16.10) — sweptAt пула
	// указывает на НАЧАЛО 4h-бара, и окно резалось до пересвипа, случившегося внутри того же бара
	// (кейс 7-го QA: глубокий свип 1858 снял ≥50% полки — попытка умерла zone-ended, не увидев свип;
	// с закрытием бара пересвип засчитан, а попытка со свипом доигрывается за окном по §16.10).
	let stackConsumedAt: number | null = null
	const total = area.shelfPools.reduce((s, p) => s + p.notional, 0)
	if (total > 0) {
		const sweeps = area.shelfPools.filter(p => p.sweptAt != null).sort((a, b) => a.sweptAt! - b.sweptAt!)
		let cum = 0
		for (const p of sweeps) {
			cum += p.notional
			if (cum >= cfg.stackConsumedShare * total) { stackConsumedAt = p.sweptAt! + tfMs; break }
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

/**
 * §16.9/§16.11/§16.14: родство стеков и подавление дублей.
 * Родство (§16.14): общий notional стеков ≥ stackKinshipShare меньшего стека — один объект
 * ликвидности («близнецы» сползшего окна, вложенные поколения роста). Победитель: старшая, если
 * тронута ДО рождения младшей (окно в работе → младшая = дубль); иначе младшая (свежая геометрия),
 * старшая отставляется (supersededAt, retired). Затем классика: near ≤ dupNearAtr×ATR или
 * перекрытие ≥ dupOverlapShare меньшей при сопоставимой высоте (≤ dupMaxHeightRatio).
 */
function consolidate(raw: AreaCandidate[], c: Candle[], cfg: LiquidityPoiConfig): AreaCandidate[] {
	const areas = [...raw].sort((a, b) => a.knownAt - b.knownAt || a.originAt - b.originAt).map(x => evaluateArea(x, c, cfg))
	const bySeniority = [...areas].sort((a, b) => a.knownAt - b.knownAt || a.originAt - b.originAt)
	const stackTotal = (x: AreaCandidate) => x.shelfPools.reduce((s, p) => s + p.notional, 0)
	const sharedStack = (junior: AreaCandidate, senior: AreaCandidate) => {
		const seniorIds = new Set(senior.componentAnchorIds)
		let s = 0
		for (let i = 0; i < junior.componentAnchorIds.length; i++)
			if (seniorIds.has(junior.componentAnchorIds[i]!)) s += junior.shelfPools[i]?.notional ?? 0
		return s
	}
	for (const senior of bySeniority) {
		if (senior.duplicateOf != null) continue
		for (const junior of bySeniority) {
			if (junior === senior || junior.duplicateOf != null) continue
			if (junior.direction !== senior.direction) continue
			if (junior.knownAt < senior.knownAt) continue
			if (!(senior.knownAt < junior.endAt && junior.knownAt < senior.endAt)) continue
			// §16.14: родство стеков.
			const shared = sharedStack(junior, senior)
			if (shared > 0 && shared >= cfg.stackKinshipShare * Math.min(stackTotal(junior), stackTotal(senior))) {
				const touchedBeforeJunior = senior.firstTouchAt != null && senior.firstTouchAt < junior.knownAt
				// §16.15: свежая геометрия ЗАМЕЩАЕТ старшую, только если удерживает ≥ stackKinshipShare
				// СТАРШЕГО стека (рост/обновление места). Сползшее вбок окно, роняющее массу старшей
				// (кейс ETH: свежая 2096–2150 осиротила полку 2030 — старшая 1992–2115 была отставлена,
				// а новых зон над массой novelty уже не рождала), становится дублем — место держит старшая.
				const coversSenior = shared >= cfg.stackKinshipShare * stackTotal(senior)
				if (touchedBeforeJunior || !coversSenior) {
					junior.duplicateOf = senior.id
					senior.suppressedCount += 1
				} else {
					senior.supersededAt = junior.knownAt
					senior.endAt = junior.knownAt
					senior.lifecycleState = 'retired'
					senior.retiredAt = junior.knownAt
					senior.failedAt = null
					senior.spentAt = null
					senior.spentReason = null
					senior.invalidatedAt = null
					senior.valid = false
				}
				continue
			}
			const nearDup = Math.abs(junior.near - senior.near) <= cfg.dupNearAtr * senior.atr
			const sLo = Math.min(senior.near, senior.far), sHi = Math.max(senior.near, senior.far)
			const jLo = Math.min(junior.near, junior.far), jHi = Math.max(junior.near, junior.far)
			// §16.13: перекрытие считается дублем только при сопоставимой высоте — полка, выросшая
			// сильнее dupMaxHeightRatio вокруг старой узкой зоны, живёт рядом как отдельный объект
			// (геометрия и окна подтверждения обеих не трогаются).
			const comparable = (jHi - jLo) <= cfg.dupMaxHeightRatio * (sHi - sLo)
			const overlapDup = comparable && overlapShare(sLo, sHi, jLo, jHi) >= cfg.dupOverlapShare
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
	// §16.14: сила полки — доля стека от сильнейшего АКТИВНОГО стека стороны (дисплей-метрика).
	const maxStack: Record<'long' | 'short', number> = { long: 0, short: 0 }
	for (const x of fresh) maxStack[x.direction] = Math.max(maxStack[x.direction], stackTotal(x))
	return areas.map(x => {
		const priority: ZonePriority = x === nearestLong || x === nearestShort ? 'nearest' : 'secondary'
		const sn = stackTotal(x)
		// §16.12: «важные» = ближайшая пара + все свежие непод авленные зоны значимых полок.
		return { ...x, priority, active: x.valid && x.duplicateOf == null, stackNotional: sn, stackShare: maxStack[x.direction] > 0 ? sn / maxStack[x.direction] : 1 }
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
	const cfg: LiquidityPoiConfig = { ...LIQUIDITY_POI_CONFIG, ...context.config }
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
	// (Проверено и отвергнуто в §16.14: реестр пулов на ВСЮ сторону — эмиссии замораживались на
	// первом пересечении новизны, карта застывала на старых широких поколениях. Идентичность полки
	// остаётся геометрической; родство стеков решает дедуп/поглощение в consolidate.)
	const emissions: Record<'buy-side' | 'sell-side', Array<{ lo: number; hi: number; poolIds: Set<string> }>> = { 'buy-side': [], 'sell-side': [] }
	for (let i = 0; i < c.length; i++) {
		const bar = c[i]!
		const t = bar.timestamp + tfMs // состояние пулов известно на ЗАКРЫТИИ бара
		const a = atr(c, i, cfg.atrPeriod)
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
			const shelves = buildShelves(freshPools, a, cfg)
			// (§16.14: пик-фильтр рождения «≥ доли сильнейшей полки бара» проверен и отвергнут —
			// выбивал ранние мелкие эмиссии-«прививки», после чего выросшие полки рождались гигантами
			// одним куском, а мизеры тонких периодов всё равно выживали: при их рождении они сами были
			// пиком стороны. Слабость стека — дисплей-метаданные stackShare + фильтр UI, не правило.)
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
				// §16.13: потолок высоты зоны — % от цены края; стек режется от БЛИЖНЕГО края
				// (для лонга — сверху вниз). ATR-потолок отменён: раздувался в высоковолатильные
				// рождения (6×1500=9k) и резал бы эталонные полки в спокойные (3×400=1.2k).
				const edge = direction === 'long' ? shelf.hi : shelf.lo
				const capDist = cfg.stackMaxPct * edge
				const far = direction === 'long' ? Math.max(shelf.lo, edge - capDist) : Math.min(shelf.hi, edge + capDist)
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
					duplicateOf: null, stackNotional: 0, stackShare: 1,
					lineageSupersededAt: null, supersededAt: null, invalidatedAt: null,
					endAt: c.at(-1)!.timestamp, mergedCount: 0, suppressedCount: 0,
					shelfPools: shelf.pools.map(p => ({ notional: p.notional, sweptAt: p.sweptAt, lastContributionAt: p.lastContributionAt })),
				})
			}
		}
	}
	return consolidate(raw, c, cfg)
		.sort((a, b) => Number(b.active) - Number(a.active) || Number(b.valid) - Number(a.valid) || b.geometryKnownAt - a.geometryKnownAt)
		.map(({ shelfPools: _shelfPools, ...candidate }) => candidate)
}
