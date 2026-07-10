import type { StructureEventType } from '@/models/events/StructureEvent.js'
import type { StructureLabel } from '@/models/structure/StructurePoint.js'

export type FibAnchorMode =
	| 'event-impulse'
	| 'nearest-enclosing-leg'
	| 'outermost-enclosing-leg'

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

export interface FibGridCandidate {
	id: string
	eventId: string
	trigger: Exclude<StructureEventType, 'unlabeled'>
	direction: FibDirection
	mode: FibAnchorMode
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
	| 'missing-base-leg'
	| 'missing-enclosing-leg'
	| 'anchor-known-after-event'
	| 'invalid-direction'
	| 'zero-range'

export interface FibGridSkip {
	eventId: string
	eventIndex: number
	trigger: StructureEventType
	mode: FibAnchorMode
	reason: FibSkipReason
	details: string
}

export interface FibGridResult {
	candidates: FibGridCandidate[]
	skips: FibGridSkip[]
}
