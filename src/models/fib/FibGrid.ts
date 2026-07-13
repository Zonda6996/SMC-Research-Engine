// FibGrid.ts
//
// Модель структурной Fib-сетки, привязанной к BOS/CHoCH-событию.
// На каждое событие строится до двух вариантов якоря 0% (local / global),
// 100% всегда = пробитый event-level.

import type { StructureEventType } from '@/models/events/StructureEvent.js'
import type { StructureLabel } from '@/models/structure/StructurePoint.js'

export type FibDirection = 'long' | 'short'

/**
 * Режим выбора 0%:
 * - 'local'  — экстремум между формированием пробитого уровня и пробоем
 *              (локальный хай/лоу движения, сломавшего уровень);
 * - 'global' — экстремум от последнего события противоположного направления
 *              до пробоя (вершина/дно всего тренда).
 */
export type FibAnchorMode = 'local' | 'global'

export interface FibAnchor {
	index: number
	timestamp: number
	price: number
	type: 'high' | 'low'
	label: StructureLabel | 'UNKNOWN'
	/** Индекс свечи, на которой якорь уже известен алгоритму (без look-ahead). */
	knownAtIndex: number
}

export interface FibLevel {
	/** Уровень в процентах: 61.8, 141, 261 и т.д. */
	ratio: number
	price: number
	kind: 'anchor' | 'retracement' | 'extension'
}

/** Один вариант сетки (для конкретного режима якоря 0%). */
export interface FibVariant {
	start: FibAnchor
	levels: FibLevel[]
	/** Размер ноги 0%→100% в цене. */
	legSize: number
	/** Нога в единицах ATR(14) на момент пробоя; null, если ATR ещё не рассчитан. */
	legAtrRatio: number | null
}

/**
 * Кандидат на событие. 100% (end) общий, 0% зависит от режима.
 * Вариант равен null, если для данного режима не нашлось валидного экстремума.
 */
export interface FibGridCandidate {
	id: string
	eventId: string
	trigger: Exclude<StructureEventType, 'unlabeled'>
	direction: FibDirection
	end: FibAnchor
	variants: Record<FibAnchorMode, FibVariant | null>
	/** Первый индекс, на котором событие и якоря известны без look-ahead. */
	createdAtIndex: number
	/** Пронесено из события: свип противоположного экстремума перед сломом. */
	oppositeSweptBefore: boolean
	explanation: string
}

export type FibSkipReason =
	| 'unlabeled-event'
	| 'no-valid-variant'

export interface FibGridSkip {
	eventId: string
	eventIndex: number
	trigger: StructureEventType
	reason: FibSkipReason
	details: string
}

export interface FibGridResult {
	candidates: FibGridCandidate[]
	skips: FibGridSkip[]
}
