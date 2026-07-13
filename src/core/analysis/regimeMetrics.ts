// regimeMetrics.ts
//
// Волна 1 фильтра режима рынка (SPEC 7.15): ИЗМЕРЕНИЕ, не фильтр.
//
// Четыре метрики «трендовости» рынка, вычисляемые на каждый индекс свечи
// по скользящему окну строго НАЗАД — look-ahead-free по построению:
// значение на индексе i зависит только от данных с индексами <= i
// (для событий/трендов — только от записей с confirmIndex/confirmedAtIndex <= i).
//
// Мотивация (SPEC 7.11): OTE/Deep в боковике-2023 складываются вдвое,
// breaker161 держится. Если режим ловится на момент создания сетапа —
// отключение OTE/Deep в боковике поднимает EV портфеля без изменения входа.
//
// Урок предыдущих волн: сначала данные, потом фильтр. Этот модуль только
// измеряет; никакого влияния на отбор сетапов у него нет.

import type { Candle } from '@/models/price/Candle.js'
import type { ATRPoint } from '@/models/indicators/ATRPoint.js'
import type { StructureEvent } from '@/models/events/StructureEvent.js'
import type { TrendHistoryEntry } from '@/models/structure/TrendHistoryEntry.js'

/** Метрики режима на конкретный индекс свечи. null = окно ещё не набралось. */
export interface RegimeMetrics {
	/**
	 * Kaufman efficiency ratio, окно effWindow: |close[i] − close[i−w]| / Σ|Δclose|.
	 * 1 = идеальный тренд (каждый бар в одну сторону), → 0 = чистая пила.
	 */
	effRatio: number | null
	/**
	 * ATR14[i] / SMA(ATR14, atrSmaWindow)[i]: сжатие волатильности (<1) —
	 * признак консолидации, расширение (>1) — импульс.
	 */
	atrRatio: number | null
	/**
	 * Доля CHoCH среди последних eventWindow структурных событий
	 * (confirmIndex <= i, unlabeled не считаются). Пила направлений
	 * (высокая доля) = боковик, серия BOS = тренд.
	 */
	chochShare: number | null
	/**
	 * Доля доминирующего значения trend среди последних trendWindow записей
	 * trendHistory (confirmedAtIndex <= i). 1 = устойчивый тренд,
	 * ~0.5 = чехарда bullish/bearish.
	 */
	trendStability: number | null
}

export interface RegimeMetricsOptions {
	/** Окно efficiency ratio (свечей). */
	effWindow?: number
	/** Окно SMA для нормировки ATR (свечей). */
	atrSmaWindow?: number
	/** Окно chochShare (событий). */
	eventWindow?: number
	/** Окно trendStability (trend-записей). */
	trendWindow?: number
}

const DEFAULTS: Required<RegimeMetricsOptions> = {
	effWindow: 50,
	atrSmaWindow: 100,
	eventWindow: 8,
	trendWindow: 8,
}

/**
 * Вычисляет метрики режима на каждый индекс свечи. O(n) по каждой метрике:
 * префиксные суммы для effRatio/atrRatio, два указателя для событий/трендов.
 *
 * Контракт look-ahead: результат для индекса i не изменится, если свечи,
 * события или trend-записи с индексами (confirm-индексами) > i изменятся
 * или исчезнут. Проверяется тестом.
 */
export function computeRegimeMetrics(
	candles: Candle[],
	atr: ATRPoint[],
	events: StructureEvent[],
	trendHistory: TrendHistoryEntry[],
	options?: RegimeMetricsOptions,
): RegimeMetrics[] {
	const opts = { ...DEFAULTS, ...options }
	const n = candles.length
	const result: RegimeMetrics[] = new Array(n)

	// --- effRatio: префиксная сумма |Δclose| ---
	// cumAbs[i] = Σ |close[k] − close[k−1]| для k=1..i
	const cumAbs = new Array<number>(n).fill(0)
	for (let i = 1; i < n; i++) {
		cumAbs[i] = cumAbs[i - 1]! + Math.abs(candles[i]!.close - candles[i - 1]!.close)
	}

	// --- atrRatio: ATR по индексу свечи + префиксная сумма для SMA ---
	// ATRPoint.index — индекс свечи; ряд ATR начинается не с нуля (нужен разгон).
	const atrByIndex = new Array<number | null>(n).fill(null)
	for (const p of atr) {
		if (p.index >= 0 && p.index < n) atrByIndex[p.index] = p.value
	}
	// Префиксные суммы значений и счётчиков заполненных ATR — SMA считается
	// только когда окно полностью покрыто реальными значениями.
	const atrCum = new Array<number>(n + 1).fill(0)
	const atrCnt = new Array<number>(n + 1).fill(0)
	for (let i = 0; i < n; i++) {
		atrCum[i + 1] = atrCum[i]! + (atrByIndex[i] ?? 0)
		atrCnt[i + 1] = atrCnt[i]! + (atrByIndex[i] != null ? 1 : 0)
	}

	// --- события: отсортированы по confirmIndex, скользящий указатель ---
	const labeled = events
		.filter((e) => e.type === 'bos' || e.type === 'choch')
		.sort((a, b) => a.confirmIndex - b.confirmIndex)
	let eventPtr = 0
	// Кольцевой буфер последних eventWindow типов не нужен — храним весь
	// префикс и считаем по последним eventWindow: объём событий мал (сотни).
	const seenEvents: StructureEvent[] = []

	// --- trend-записи: тот же приём по confirmedAtIndex ---
	const trends = [...trendHistory].sort((a, b) => a.confirmedAtIndex - b.confirmedAtIndex)
	let trendPtr = 0
	const seenTrends: TrendHistoryEntry[] = []

	for (let i = 0; i < n; i++) {
		// effRatio
		let effRatio: number | null = null
		if (i >= opts.effWindow) {
			const noise = cumAbs[i]! - cumAbs[i - opts.effWindow]!
			const signal = Math.abs(candles[i]!.close - candles[i - opts.effWindow]!.close)
			effRatio = noise > 0 ? signal / noise : null
		}

		// atrRatio
		let atrRatio: number | null = null
		const w = opts.atrSmaWindow
		if (i + 1 >= w && atrByIndex[i] != null) {
			const cnt = atrCnt[i + 1]! - atrCnt[i + 1 - w]!
			if (cnt === w) {
				const sma = (atrCum[i + 1]! - atrCum[i + 1 - w]!) / w
				atrRatio = sma > 0 ? atrByIndex[i]! / sma : null
			}
		}

		// события до i включительно
		while (eventPtr < labeled.length && labeled[eventPtr]!.confirmIndex <= i) {
			seenEvents.push(labeled[eventPtr]!)
			eventPtr++
		}
		let chochShare: number | null = null
		if (seenEvents.length >= opts.eventWindow) {
			const windowEvents = seenEvents.slice(-opts.eventWindow)
			chochShare = windowEvents.filter((e) => e.type === 'choch').length / opts.eventWindow
		}

		// trend-записи до i включительно
		while (trendPtr < trends.length && trends[trendPtr]!.confirmedAtIndex <= i) {
			seenTrends.push(trends[trendPtr]!)
			trendPtr++
		}
		let trendStability: number | null = null
		if (seenTrends.length >= opts.trendWindow) {
			const windowTrends = seenTrends.slice(-opts.trendWindow)
			const counts = new Map<string, number>()
			for (const t of windowTrends) {
				counts.set(t.trend, (counts.get(t.trend) ?? 0) + 1)
			}
			trendStability = Math.max(...counts.values()) / opts.trendWindow
		}

		result[i] = { effRatio, atrRatio, chochShare, trendStability }
	}

	return result
}
