// htfContext.ts
//
// SPEC 7.21 — контекст старшего таймфрейма для LTF-сделок.
//
// Первое изменение СИГНАЛА (а не фильтрации): гипотезы визуального ревью
// «сделка против старшего тренда хуже» и «лонг в premium-половине хуже»
// формализуются как разметка каждой LTF-сделки состоянием HTF на момент входа.
//
// Ключевое требование — отсутствие look-ahead. HTF-состояние на момент
// LTF-входа = состояние по последней ЗАКРЫТОЙ HTF-свече:
// - тренд: trendHistory HTF-прогона; запись становится известной в момент
//   закрытия свечи confirmedAtIndex (само подтверждение требует закрытых
//   свечей окна пивота), т.е. knownAtTs = timestamp[confirmedAtIndex] + htfMs.
// - dealing range: последний подтверждённый swing high + swing low HTF
//   структуры; подтверждение точки = index + pivotWindow (см. PivotDetector),
//   известна тоже только с закрытия подтверждающей свечи.
//
// Оценка эффекта — ТОЛЬКО пул-разметка (--eval-htf), без портфельной
// симуляции: урок SPEC 7.20 — композиция портфеля перемешивает состав сделок,
// и эффект правила неотличим от перетасовки.

import type { AnalysisSnapshot } from '@/models/analysis/AnalysisSnapshot.js'
import type { Trend } from '@/models/structure/MarketStructure.js'

/** Точка таймлайна тренда: с какого момента (ts) это значение известно. */
export interface HtfTrendPoint {
	knownAtTs: number
	trend: Trend
}

/** Точка таймлайна dealing range: последние подтверждённые swing high/low. */
export interface HtfRangePoint {
	knownAtTs: number
	high: number
	low: number
}

export interface HtfContext {
	/** Отсортировано по knownAtTs (стабильно: при равенстве — позже построенная запись). */
	trendTimeline: HtfTrendPoint[]
	rangeTimeline: HtfRangePoint[]
}

/** Метки HTF-контекста для одной LTF-сделки на момент её входа. */
export interface HtfLabels {
	/** Тренд HTF, известный на момент входа. 'none' = записей ещё нет. */
	htfTrend: Trend | 'none'
	/** Совпадает ли направление сделки с HTF-трендом. null = тренда нет или range. */
	trendAligned: boolean | null
	/** Половина HTF-диапазона, в которой цена входа. 'none' = диапазона ещё нет. */
	pdZone: 'premium' | 'discount' | 'none'
	/** long+discount / short+premium = true. null = диапазона нет. */
	pdAligned: boolean | null
}

/**
 * Дефолтное окно пивота HTF-прогона. Должно совпадать с pivotWindow,
 * с которым построен htfSnapshot (runAnalysis по умолчанию использует 2).
 */
const DEFAULT_PIVOT_WINDOW = 2

/**
 * Строит look-ahead-free таймлайны HTF-состояния из готового HTF-снапшота.
 *
 * @param htfSnapshot  результат runAnalysis по HTF-свечам
 * @param htfTfMs      длительность HTF-свечи в мс (знание = закрытие свечи)
 * @param pivotWindow  окно пивота, которым построен снапшот
 */
export function buildHtfContext(
	htfSnapshot: AnalysisSnapshot,
	htfTfMs: number,
	pivotWindow: number = DEFAULT_PIVOT_WINDOW,
): HtfContext {
	const candles = htfSnapshot.candles

	// --- Таймлайн тренда: trendHistory уже несёт confirmedAtIndex. ---
	const trendTimeline: HtfTrendPoint[] = []
	for (const entry of htfSnapshot.market.trendHistory) {
		// Запись, подтверждающаяся за пределами данных, не известна никогда.
		if (entry.confirmedAtIndex >= candles.length) continue
		const knownAtTs = candles[entry.confirmedAtIndex]!.timestamp + htfTfMs
		trendTimeline.push({ knownAtTs, trend: entry.trend })
	}
	trendTimeline.sort((a, b) => a.knownAtTs - b.knownAtTs)

	// --- Таймлайн dealing range: последние подтверждённые swing high/low. ---
	// StructurePoint подтверждается спустя pivotWindow свечей после своего
	// индекса (та же механика, что confirmedAtIndex у trendHistory).
	const confirmed = htfSnapshot.structure
		.map((p) => ({ point: p, confirmIndex: p.index + pivotWindow }))
		.filter((e) => e.confirmIndex < candles.length)
		.sort((a, b) => a.confirmIndex - b.confirmIndex)

	const rangeTimeline: HtfRangePoint[] = []
	let lastHigh: number | null = null
	let lastLow: number | null = null
	for (const { point, confirmIndex } of confirmed) {
		if (point.type === 'high') lastHigh = point.price
		else lastLow = point.price
		if (lastHigh == null || lastLow == null) continue
		// Вырожденный диапазон (high <= low после резкого сдвига) не размечаем:
		// equilibrium в нём не имеет смысла, честнее подождать нового свинга.
		if (lastHigh <= lastLow) continue
		const knownAtTs = candles[confirmIndex]!.timestamp + htfTfMs
		rangeTimeline.push({ knownAtTs, high: lastHigh, low: lastLow })
	}
	rangeTimeline.sort((a, b) => a.knownAtTs - b.knownAtTs)

	return { trendTimeline, rangeTimeline }
}

/**
 * Последний элемент timeline с knownAtTs <= ts (бинарный поиск).
 * Возвращает null, если таких нет (HTF-состояние ещё не существовало).
 */
function lastKnownAt<T extends { knownAtTs: number }>(timeline: T[], ts: number): T | null {
	let lo = 0
	let hi = timeline.length - 1
	let result: T | null = null
	while (lo <= hi) {
		const mid = (lo + hi) >> 1
		if (timeline[mid]!.knownAtTs <= ts) {
			result = timeline[mid]!
			lo = mid + 1
		} else {
			hi = mid - 1
		}
	}
	return result
}

/**
 * Метки HTF-контекста для LTF-сделки: тренд/диапазон, известные на entryTs.
 */
export function htfContextAt(
	ctx: HtfContext,
	entryTs: number,
	entryPrice: number,
	direction: 'long' | 'short',
): HtfLabels {
	const trendPoint = lastKnownAt(ctx.trendTimeline, entryTs)
	const htfTrend: Trend | 'none' = trendPoint?.trend ?? 'none'
	// range и none — не «против тренда», а отсутствие направленного контекста.
	const trendAligned: boolean | null =
		htfTrend === 'bullish' ? direction === 'long'
		: htfTrend === 'bearish' ? direction === 'short'
		: null

	const rangePoint = lastKnownAt(ctx.rangeTimeline, entryTs)
	let pdZone: 'premium' | 'discount' | 'none' = 'none'
	if (rangePoint) {
		const equilibrium = (rangePoint.high + rangePoint.low) / 2
		pdZone = entryPrice <= equilibrium ? 'discount' : 'premium'
	}
	const pdAligned: boolean | null =
		pdZone === 'none' ? null : direction === 'long' ? pdZone === 'discount' : pdZone === 'premium'

	return { htfTrend, trendAligned, pdZone, pdAligned }
}
