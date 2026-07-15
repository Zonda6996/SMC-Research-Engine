// setupFilters.ts
//
// Слой дискреционных фильтров (SPEC 7.20): формализация визуального ревью.
//
// Происхождение: ревью блока A (ADA 30m, 20 сетапов глазами) показало, что
// разметка технически корректна (структура ОК 19/20, импульс ОК 19/20), но
// трейдер отбраковывает 13/20 сетапов по КОНТЕКСТУ. Причины отказа
// кластеризуются в четыре правила — каждое здесь как независимый фильтр:
//
// - late    — «BOS на самом хае, поезд уехал» (A-8, A-9, A-15): свеча
//             подтверждения закрылась слишком далеко за пробитым уровнем,
//             вход у экстремума импульса;
// - align   — «шорт на дне против тренда» (A-22, LTC): направление сетапа
//             против доминирующего тренда trendHistory;
// - extreme — «сетка не от высокого хая» (A-11, A-21, BTC): пробитый
//             event-level — не экстремум своего сегмента, движок сломал
//             мелкий внутренний пивот под настоящим хаем;
// - chop    — «боковик/АМД» (A-2, A-4, A-13, A-18, A-24): строгий пресет
//             существующего regime-фильтра (задействует effRatio и
//             trendStability, которые базовый фильтр не использует).
//
// Каждый фильтр — чистая функция от исхода + контекста, look-ahead-free:
// использует только данные с индексами <= createdAtIndex (метрики режима
// look-ahead-free по построению, trendHistory — через confirmedAtIndex).
//
// Консервативное правило (как в regimeFilter): недоступные данные не
// блокируют. Фильтр отрезает только доказанно плохой сетап.
//
// Все фильтры opt-in: пустой список активных = поведение без слоя.

import type { Candle } from '@/models/price/Candle.js'
import type { StructureEvent } from '@/models/events/StructureEvent.js'
import type { TrendHistoryEntry } from '@/models/structure/TrendHistoryEntry.js'
import type { FibGridCandidate } from '@/models/fib/FibGrid.js'
import type { FibSetupOutcome } from '@/models/fib/FibLifecycle.js'
import type { RegimeMetrics } from './regimeMetrics.js'
import { passesRegimeFilter, STRICT_REGIME_FILTER, type RegimeFilterConfig } from './regimeFilter.js'
import { FibGridEngine } from '@/core/fib/FibGridEngine.js'

export type SetupFilterName = 'late' | 'align' | 'extreme' | 'chop' | 'chop-ote'

export const SETUP_FILTER_NAMES: readonly SetupFilterName[] = ['late', 'align', 'extreme', 'chop', 'chop-ote']

export interface SetupFilterConfig {
	/**
	 * late: максимально допустимый «перелёт» закрытия свечи подтверждения
	 * за пробитый уровень, в долях ноги сетки. 0.35 = подтверждение дальше
	 * ~трети ноги за уровнем — вход у экстремума импульса, отбрасываем.
	 */
	lateMaxOvershoot: number
	/** align: окно доминирующего тренда (записей trendHistory). */
	alignWindow: number
	/** extreme: допуск на равные вершины, в единицах ATR на момент пробоя. */
	extremeAtrTolerance: number
	/** chop: строгий пресет regime-фильтра. */
	chop: RegimeFilterConfig
}

export const DEFAULT_SETUP_FILTER_CONFIG: SetupFilterConfig = {
	lateMaxOvershoot: 0.35,
	alignWindow: 8,
	extremeAtrTolerance: 0.25,
	chop: STRICT_REGIME_FILTER,
}

/** Контекст датасета, общий для всех сетапов одного прогона symbol × tf. */
export interface SetupFilterContext {
	candles: Candle[]
	events: StructureEvent[]
	candidatesById: Map<string, FibGridCandidate>
	eventsById: Map<string, StructureEvent>
	trendHistory: TrendHistoryEntry[]
	metrics: RegimeMetrics[]
}

export function buildSetupFilterContext(
	candles: Candle[],
	events: StructureEvent[],
	candidates: FibGridCandidate[],
	trendHistory: TrendHistoryEntry[],
	metrics: RegimeMetrics[],
): SetupFilterContext {
	const candidatesById = new Map<string, FibGridCandidate>()
	for (const c of candidates) candidatesById.set(c.id, c)
	const eventsById = new Map<string, StructureEvent>()
	for (const e of events) {
		if (e.type === 'unlabeled') continue
		eventsById.set(FibGridEngine.eventId(e), e)
	}
	// trendHistory сортируем один раз: passesAlign делает бинарную отсечку.
	const sortedTrends = [...trendHistory].sort((a, b) => a.confirmedAtIndex - b.confirmedAtIndex)
	return { candles, events, candidatesById, eventsById, trendHistory: sortedTrends, metrics }
}

/**
 * late: перелёт закрытия свечи подтверждения за пробитый уровень.
 * overshoot = (confirmClose − levelPrice) / legSize для long (зеркально short).
 * Отрицательный перелёт (цена вернулась за уровень) — проходит.
 */
export function passesLateFilter(
	outcome: FibSetupOutcome,
	ctx: SetupFilterContext,
	config: SetupFilterConfig = DEFAULT_SETUP_FILTER_CONFIG,
): boolean {
	const candidate = ctx.candidatesById.get(outcome.candidateId)
	const variant = candidate?.variants[outcome.variantMode]
	const confirmClose = ctx.candles[outcome.createdAtIndex]?.close
	if (!candidate || !variant || variant.legSize <= 0 || confirmClose == null) return true
	const levelPrice = candidate.end.price
	const overshoot = outcome.direction === 'long'
		? (confirmClose - levelPrice) / variant.legSize
		: (levelPrice - confirmClose) / variant.legSize
	return overshoot <= config.lateMaxOvershoot
}

/**
 * align: направление сетапа против доминирующего тренда — блок.
 * Доминанта — самое частое значение trend среди последних alignWindow
 * записей trendHistory с confirmedAtIndex <= createdAtIndex.
 * Недобор окна, ничья или доминанта 'range' — пропускаем (консервативно).
 */
export function passesAlignFilter(
	outcome: FibSetupOutcome,
	ctx: SetupFilterContext,
	config: SetupFilterConfig = DEFAULT_SETUP_FILTER_CONFIG,
): boolean {
	// trendHistory отсортирован в buildSetupFilterContext; берём последние
	// alignWindow подтверждённых записей на момент создания сетапа.
	const visible: TrendHistoryEntry[] = []
	for (const t of ctx.trendHistory) {
		if (t.confirmedAtIndex > outcome.createdAtIndex) break
		visible.push(t)
	}
	if (visible.length < config.alignWindow) return true
	const window = visible.slice(-config.alignWindow)
	const counts = new Map<string, number>()
	for (const t of window) counts.set(t.trend, (counts.get(t.trend) ?? 0) + 1)
	let dominant: string | null = null
	let best = 0
	let tie = false
	for (const [trend, count] of counts) {
		if (count > best) { dominant = trend; best = count; tie = false }
		else if (count === best) tie = true
	}
	if (dominant == null || tie || dominant === 'range') return true
	if (outcome.direction === 'long' && dominant === 'bearish') return false
	if (outcome.direction === 'short' && dominant === 'bullish') return false
	return true
}

/**
 * extreme: пробитый event-level должен быть экстремумом своего сегмента
 * (окно от последнего противоположного события до levelIndex — то же окно,
 * что global-якорь FibGridEngine). Если в сегменте есть более высокий хай
 * (для long; зеркально для short) — движок сломал мелкий внутренний пивот
 * под настоящим экстремумом, сетап отбрасывается.
 * Допуск extremeAtrTolerance × ATR на равные вершины.
 */
export function passesExtremeFilter(
	outcome: FibSetupOutcome,
	ctx: SetupFilterContext,
	config: SetupFilterConfig = DEFAULT_SETUP_FILTER_CONFIG,
): boolean {
	const candidate = ctx.candidatesById.get(outcome.candidateId)
	if (!candidate) return true
	const event = ctx.eventsById.get(candidate.eventId)
	if (!event) return true
	const variant = candidate.variants[outcome.variantMode]
	// ATR на момент пробоя восстанавливается из legSize / legAtrRatio —
	// без ATR допуск нулевой (строгое сравнение).
	const atr = variant && outcome.legAtrRatio && outcome.legAtrRatio > 0
		? variant.legSize / outcome.legAtrRatio
		: null
	const tolerance = atr != null ? config.extremeAtrTolerance * atr : 0
	const from = Math.max(0, FibGridEngine.globalWindowStart(event, ctx.events))
	const to = Math.min(event.levelIndex, ctx.candles.length - 1)
	for (let i = from; i <= to; i++) {
		const candle = ctx.candles[i]
		if (!candle) continue
		if (event.levelType === 'high') {
			if (candle.high > event.levelPrice + tolerance) return false
		} else if (candle.low < event.levelPrice - tolerance) {
			return false
		}
	}
	return true
}

/** chop: строгий пресет regime-фильтра (effRatio + trendStability). */
export function passesChopFilter(
	outcome: FibSetupOutcome,
	ctx: SetupFilterContext,
	config: SetupFilterConfig = DEFAULT_SETUP_FILTER_CONFIG,
): boolean {
	return passesRegimeFilter(outcome.scenario, ctx.metrics[outcome.createdAtIndex], config.chop)
}

/**
 * chop-ote: chop, применённый только к OTE-сетапам; deep и breaker проходят
 * без проверки. Урок полноканонного OFAT-прогона (15.07.2026): blanket-chop
 * на полном каноне порезал deep с 418 сделок до 75 и уничтожил его вклад
 * (+40.6R → −4R) — deep как глубокий ретрейсмент живёт именно в тех
 * «мусорных» режимах, которые chop вырезает. Рубка — яд для OTE, но среда
 * обитания для deep. Ревью блока A, породившее chop, тоже делалось только
 * по OTE-сетапам, так что узкий скоуп честнее исходных данных.
 */
export function passesChopOteFilter(
	outcome: FibSetupOutcome,
	ctx: SetupFilterContext,
	config: SetupFilterConfig = DEFAULT_SETUP_FILTER_CONFIG,
): boolean {
	if (outcome.scenario !== 'ote') return true
	return passesChopFilter(outcome, ctx, config)
}

const FILTER_FNS: Record<SetupFilterName, (o: FibSetupOutcome, ctx: SetupFilterContext, cfg: SetupFilterConfig) => boolean> = {
	late: passesLateFilter,
	align: passesAlignFilter,
	extreme: passesExtremeFilter,
	chop: passesChopFilter,
	'chop-ote': passesChopOteFilter,
}

/**
 * Первый фильтр из активного списка, отбраковывающий сетап; null = прошёл все.
 * Порядок проверки = порядок в active (для отчёта «кто отрезал»).
 */
export function firstFailingFilter(
	outcome: FibSetupOutcome,
	active: readonly SetupFilterName[],
	ctx: SetupFilterContext,
	config: SetupFilterConfig = DEFAULT_SETUP_FILTER_CONFIG,
): SetupFilterName | null {
	for (const name of active) {
		if (!FILTER_FNS[name](outcome, ctx, config)) return name
	}
	return null
}
