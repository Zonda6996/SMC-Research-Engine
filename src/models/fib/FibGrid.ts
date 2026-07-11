import type { StructureEventType } from '@/models/events/StructureEvent.js'
import type { StructureLabel } from '@/models/structure/StructurePoint.js'

export type FibDirection = 'long' | 'short'

export interface FibAnchor {
	index: number
	timestamp: number
	price: number
	type: 'high' | 'low'
	label: StructureLabel | 'UNKNOWN'
	/** Индекс свечи, на которой pivot уже подтверждён и доступен алгоритму. */
	knownAtIndex: number
}

export interface FibLevel {
	/** Уровень в процентах: 61.8, 141, 261 и т.д. */
	ratio: number
	price: number
	kind: 'anchor' | 'retracement' | 'extension'
}

/**
 * Единственный структурный кандидат на событие:
 * 0% = последний размеченный противоположный свинг перед пробоем (начало импульса),
 * 100% = пробитый BOS/CHoCH-уровень.
 */
export interface FibGridCandidate {
	id: string
	eventId: string
	trigger: Exclude<StructureEventType, 'unlabeled'>
	direction: FibDirection
	start: FibAnchor
	end: FibAnchor
	/** Первый индекс, на котором событие и оба якоря известны без look-ahead. */
	createdAtIndex: number
	levels: FibLevel[]
	explanation: string
}

export type FibSkipReason =
	| 'unlabeled-event'
	| 'missing-opposite-swing'
	| 'anchor-known-after-event'
	| 'invalid-direction'
	| 'zero-range'

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
