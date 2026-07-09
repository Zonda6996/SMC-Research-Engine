// breachClassifier.ts
//
// Общая логика look-ahead-free маркировки пробоев как BOS / CHoCH / unlabeled.
// Используется обоими слоями визуализатора (A: protected, B: swing).
// НЕ часть пайплайна — живёт в tools/visualizer/.

import type { TrendHistoryEntry } from '../../src/models/structure/TrendHistoryEntry.js'
import type { Candle } from '../../src/models/price/Candle.js'
import type { StructurePoint } from '../../src/models/structure/StructurePoint.js'
import type { BreachMode, SwingBreach } from './lastSwingBreachProbe.js'

export type EventType = 'bos' | 'choch' | 'unlabeled'

export interface ClassifiedEvent {
	confirmIndex: number
	confirmTimestamp: number
	breachIndex: number
	breachTimestamp: number
	levelPrice: number
	levelType: 'high' | 'low'
	/** Индекс свечи, на которой возник пробитый уровень (для отрисовки линии слома). */
	levelIndex: number
	/** BOS / CHoCH / unlabeled. */
	type: EventType
	/** Тренд на момент события (look-ahead-free). */
	trend: string
	/** Человекочитаемая причина, если unlabeled. */
	reason: string
	/** Источник: 'protected' (слой A) или 'swing' (слой B). */
	source: 'protected' | 'swing'
}

export interface TrendAtMoment {
	trend: string
	reason: string
}

/**
 * Находит trend, актуальный на момент свечи confirmIndex, с учётом
 * confirmedAtIndex (look-ahead-free).
 */
export function trendAtCandle(
	trendHistory: TrendHistoryEntry[],
	confirmIndex: number,
): TrendAtMoment {
	let result: TrendHistoryEntry | null = null
	for (const entry of trendHistory) {
		if (entry.confirmedAtIndex <= confirmIndex) {
			result = entry
		} else {
			break
		}
	}
	if (result === null) {
		return { trend: 'none', reason: 'нет подтверждённого тренда до этой свечи' }
	}
	if (result.trend === 'range') {
		return { trend: 'range', reason: `тренд=range на свече ${result.index} (label=${result.label})` }
	}
	return { trend: result.trend, reason: `тренд=${result.trend} на свече ${result.index} (label=${result.label})` }
}

/**
 * Классифицирует пробой в BOS/CHoCH/unlabeled.
 */
export function classifyBreach(
	levelType: 'high' | 'low',
	trendHistory: TrendHistoryEntry[],
	confirmIndex: number,
): { type: EventType; trend: string; reason: string } {
	const { trend, reason } = trendAtCandle(trendHistory, confirmIndex)

	if (trend === 'bullish') {
		return { type: levelType === 'high' ? 'bos' : 'choch', trend, reason }
	}
	if (trend === 'bearish') {
		return { type: levelType === 'low' ? 'bos' : 'choch', trend, reason }
	}
	return { type: 'unlabeled', trend, reason }
}

// ──────────────────────────────────────────────
// Слой A: probe protected breaches (с поддержкой mode)
// ──────────────────────────────────────────────

interface ProtectedBreachInternal {
	level: StructurePoint
	breachIndex: number
	breachTimestamp: number
	confirmIndex: number
	confirmTimestamp: number
}

/**
 * Эмулирует MarketStructureEngine для protected-уровней, но с параметром mode.
 * В 'two' режиме результат совпадает с snapshot.market.breached[].
 * В 'single' режиме — пробой по одному закрытию.
 *
 * Дублирование логики пайплайна — сознательное: визуализатор не должен
 * зависеть от внутреннего состояния движка, он работает с structure[] + candles[].
 */
export function probeProtectedBreaches(
	structure: StructurePoint[],
	candles: Candle[],
	window: number,
	mode: BreachMode,
): ProtectedBreachInternal[] {
	const breaches: ProtectedBreachInternal[] = []
	const WINDOW = window

	let protectedLow: StructurePoint | null = null
	let protectedLowConfirmedAt = -1
	let protectedHigh: StructurePoint | null = null
	let protectedHighConfirmedAt = -1

	let pendingLow: { breachIndex: number; breachTimestamp: number } | null = null
	let pendingHigh: { breachIndex: number; breachTimestamp: number } | null = null

	let lastPoint: StructurePoint | null = null

	for (let i = 0; i < candles.length; i++) {
		const candle = candles[i]!
		const ts = candle.timestamp

		// Обрабатываем structure-точки с index <= i (выставление protected).
		// Нужно идти по structure, но не выходить за i.
		// Делаем это ДО проверки пробоя на свече i — точка «сформировалась».
		// НО: structure-точки формируются на своей свече, а confirmedAt = index+window.
		// Выставление protected происходит в update() после processCandles,
		// но для эмуляции нам важен порядок: на свече i сначала проверяем пробой
		// уже выставленных уровней, потом поглощаем structure-точки.
		// Упрощаем: поглощаем точки с index < i (строго меньше — они уже случились
		// к началу свечи i). Точка с index == i «сформировалась» на этой свече,
		// но protected выставится после — поэтому проверяем пробой до.

		// Проверка пробоя protected-уровней (если подтверждены).
		if (protectedLow && i > protectedLowConfirmedAt) {
			if (candle.close < protectedLow.price) {
				if (mode === 'single') {
					breaches.push({
						level: protectedLow, breachIndex: i, breachTimestamp: ts,
						confirmIndex: i, confirmTimestamp: ts,
					})
					protectedLow = null
					pendingLow = null
				} else {
					// two-candle
					if (pendingLow === null) {
						pendingLow = { breachIndex: i, breachTimestamp: ts }
					} else {
						breaches.push({
							level: protectedLow,
							breachIndex: pendingLow.breachIndex,
							breachTimestamp: pendingLow.breachTimestamp,
							confirmIndex: i, confirmTimestamp: ts,
						})
						protectedLow = null
						pendingLow = null
					}
				}
			} else {
				// Защита уровня.
				pendingLow = null
			}
		}

		if (protectedHigh && i > protectedHighConfirmedAt) {
			if (candle.close > protectedHigh.price) {
				if (mode === 'single') {
					breaches.push({
						level: protectedHigh, breachIndex: i, breachTimestamp: ts,
						confirmIndex: i, confirmTimestamp: ts,
					})
					protectedHigh = null
					pendingHigh = null
				} else {
					if (pendingHigh === null) {
						pendingHigh = { breachIndex: i, breachTimestamp: ts }
					} else {
						breaches.push({
							level: protectedHigh,
							breachIndex: pendingHigh.breachIndex,
							breachTimestamp: pendingHigh.breachTimestamp,
							confirmIndex: i, confirmTimestamp: ts,
						})
						protectedHigh = null
						pendingHigh = null
					}
				}
			} else {
				pendingHigh = null
			}
		}

		// Поглощаем structure-точки с index <= i.
		// (эмулируем update — выставление protected после проверки пробоя)
		for (const pt of structure) {
			if (pt.index !== i) continue

			// Выставление protected (эмуляция логики MarketStructureEngine).
			if (
				lastPoint &&
				pt.type === 'high' &&
				pt.label === 'HH' &&
				lastPoint.type === 'low'
			) {
				protectedLow = lastPoint
				protectedLowConfirmedAt = pt.index + WINDOW
				pendingLow = null
			}
			if (
				lastPoint &&
				pt.type === 'low' &&
				pt.label === 'LL' &&
				lastPoint.type === 'high'
			) {
				protectedHigh = lastPoint
				protectedHighConfirmedAt = pt.index + WINDOW
				pendingHigh = null
			}
			lastPoint = pt
		}
	}

	return breaches
}

/**
 * Классифицирует массив breach-записей (любой источник) в ClassifiedEvent[].
 */
export function classifyBreaches(
	breaches: { level: StructurePoint; breachIndex: number; breachTimestamp: number; confirmIndex: number; confirmTimestamp: number }[],
	trendHistory: TrendHistoryEntry[],
	source: 'protected' | 'swing',
): ClassifiedEvent[] {
	return breaches.map((b) => {
		const { type, trend, reason } = classifyBreach(
			b.level.type,
			trendHistory,
			b.confirmIndex,
		)
		return {
			confirmIndex: b.confirmIndex,
			confirmTimestamp: b.confirmTimestamp,
			breachIndex: b.breachIndex,
			breachTimestamp: b.breachTimestamp,
			levelPrice: b.level.price,
			levelType: b.level.type,
			levelIndex: b.level.index,
			type,
			trend,
			reason,
			source,
		}
	})
}

/**
 * Удобный wrapper для слоя B: classify swing breaches.
 */
export function classifySwingBreaches(
	swingBreaches: SwingBreach[],
	trendHistory: TrendHistoryEntry[],
): ClassifiedEvent[] {
	return classifyBreaches(swingBreaches, trendHistory, 'swing')
}
