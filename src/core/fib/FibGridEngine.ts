import type { StructureEvent } from '@/models/events/StructureEvent.js'
import type {
	FibAnchor,
	FibAnchorMode,
	FibDirection,
	FibGridCandidate,
	FibGridResult,
	FibGridSkip,
	FibLevel,
	FibSkipReason,
} from '@/models/fib/FibGrid.js'
import type { Leg } from '@/models/legs/Leg.js'
import type { LegContext } from '@/models/legs/LegContext.js'
import type { StructurePoint } from '@/models/structure/StructurePoint.js'

export const FIB_LEVEL_RATIOS = [0, 23.6, 38.2, 61.8, 78.6, 100, 141, 161, 241, 261] as const

export interface FibGridInput {
	events: StructureEvent[]
	structure: StructurePoint[]
	structuralLegs: Leg[]
	legContexts: LegContext[]
}

export interface FibGridConfig {
	pivotWindow: number
}

const ENCLOSING_MODES = ['nearest-enclosing-leg', 'outermost-enclosing-leg'] as const
const MODES: FibAnchorMode[] = ['event-impulse', ...ENCLOSING_MODES]

/**
 * Исследовательский генератор Fib-кандидатов. Он не выбирает победителя,
 * не торгует и не обновляет anchors после создания сетки.
 */
export class FibGridEngine {
	private readonly config: FibGridConfig

	constructor(config: Partial<FibGridConfig> = {}) {
		this.config = { pivotWindow: config.pivotWindow ?? 2 }
	}

	build(input: FibGridInput): FibGridResult {
		const result: FibGridResult = { candidates: [], skips: [] }

		for (const event of input.events) {
			const eventId = this.eventId(event)
			if (event.type === 'unlabeled') {
				for (const mode of MODES) {
					result.skips.push(this.skip(event, eventId, mode, 'unlabeled-event', 'Первое событие не имеет BOS/CHoCH-классификации'))
				}
				continue
			}

			const eventCandidate = this.buildEventImpulse(event, eventId, input.structure)
			if ('reason' in eventCandidate) result.skips.push(eventCandidate)
			else result.candidates.push(eventCandidate)

			for (const mode of ENCLOSING_MODES) {
				const candidate = this.buildEnclosing(event, eventId, mode, input.structuralLegs, input.legContexts)
				if ('reason' in candidate) result.skips.push(candidate)
				else result.candidates.push(candidate)
			}
		}

		return result
	}

	/** Цена уровня по общей формуле для long/short. */
	static levels(startPrice: number, endPrice: number): FibLevel[] {
		const delta = endPrice - startPrice
		return FIB_LEVEL_RATIOS.map((ratio) => ({
			ratio,
			price: startPrice + delta * (ratio / 100),
			kind: ratio === 0 || ratio === 100 ? 'anchor' : ratio < 100 ? 'retracement' : 'extension',
		}))
	}

	private buildEventImpulse(
		event: StructureEvent,
		eventId: string,
		structure: StructurePoint[],
	): FibGridCandidate | FibGridSkip {
		const direction = this.direction(event)
		const oppositeType = direction === 'long' ? 'low' : 'high'
		const startPoint = [...structure]
			.reverse()
			.find((point) =>
				point.type === oppositeType &&
				point.index < event.levelIndex &&
				this.knownAt(point.index) <= event.confirmIndex,
			)

		if (!startPoint) {
			return this.skip(event, eventId, 'event-impulse', 'missing-opposite-swing', 'Перед event-level нет подтверждённого противоположного swing')
		}

		const levelPoint = structure.find((point) => point.index === event.levelIndex && point.type === event.levelType)
		const end: FibAnchor = levelPoint
			? this.anchor(levelPoint)
			: {
				index: event.levelIndex,
				timestamp: event.breachTimestamp,
				price: event.levelPrice,
				type: event.levelType,
				label: event.levelLabel as FibAnchor['label'],
				knownAtIndex: this.knownAt(event.levelIndex),
			}

		return this.makeCandidate(
			event,
			eventId,
			'event-impulse',
			this.anchor(startPoint),
			end,
			`Последний подтверждённый ${oppositeType} swing → пробитый ${event.levelLabel} event-level`,
		)
	}

	private buildEnclosing(
		event: StructureEvent,
		eventId: string,
		mode: Exclude<FibAnchorMode, 'event-impulse'>,
		legs: Leg[],
		contexts: LegContext[],
	): FibGridCandidate | FibGridSkip {
		const direction = this.direction(event)
		const legDirection = direction === 'long' ? 'bullish' : 'bearish'
		const available = (leg: Leg) => this.knownAt(leg.end.index) <= event.confirmIndex
		const containsLevel = (leg: Leg) => {
			const min = Math.min(leg.start.price, leg.end.price)
			const max = Math.max(leg.start.price, leg.end.price)
			return leg.start.index < event.levelIndex && min <= event.levelPrice && event.levelPrice <= max
		}

		const baseLeg = [...legs]
			.reverse()
			.find((leg) => leg.direction === legDirection && available(leg) && containsLevel(leg))
		if (!baseLeg) {
			return this.skip(event, eventId, mode, 'missing-base-leg', 'Нет доступной структурной ноги направления события, содержащей event-level')
		}

		const context = contexts.find((item) => item.leg === baseLeg)
		const enclosing = (context?.enclosingLegs ?? []).filter(
			(leg) => leg.direction === legDirection && available(leg),
		)
		const selected = mode === 'nearest-enclosing-leg' ? enclosing[0] : enclosing.at(-1)
		if (!selected) {
			return this.skip(event, eventId, mode, 'missing-enclosing-leg', `Для base leg ${baseLeg.start.index}→${baseLeg.end.index} нет доступной объемлющей ноги того же направления`)
		}

		return this.makeCandidate(
			event,
			eventId,
			mode,
			this.anchor(selected.start),
			this.anchor(selected.end),
			`${mode === 'nearest-enclosing-leg' ? 'Ближайшая' : 'Самая внешняя'} непробитая объемлющая нога для ${baseLeg.start.index}→${baseLeg.end.index}`,
		)
	}

	private makeCandidate(
		event: StructureEvent,
		eventId: string,
		mode: FibAnchorMode,
		start: FibAnchor,
		end: FibAnchor,
		explanation: string,
	): FibGridCandidate | FibGridSkip {
		const direction = this.direction(event)
		if (start.knownAtIndex > event.confirmIndex || end.knownAtIndex > event.confirmIndex) {
			return this.skip(event, eventId, mode, 'anchor-known-after-event', 'Один из якорей подтверждается после trigger-события')
		}
		if (start.price === end.price) {
			return this.skip(event, eventId, mode, 'zero-range', 'Якоря имеют одинаковую цену')
		}
		if ((direction === 'long' && start.price >= end.price) || (direction === 'short' && start.price <= end.price)) {
			return this.skip(event, eventId, mode, 'invalid-direction', `Цены якорей не соответствуют направлению ${direction}`)
		}

		const createdAtIndex = Math.max(event.confirmIndex, start.knownAtIndex, end.knownAtIndex)
		// makeCandidate вызывается только после отсечения unlabeled в build().
		const trigger = event.type === 'bos' ? 'bos' : 'choch'
		return {
			id: `${eventId}:${mode}`,
			eventId,
			trigger,
			direction,
			mode,
			start,
			end,
			createdAtIndex,
			levels: FibGridEngine.levels(start.price, end.price),
			explanation,
		}
	}

	private direction(event: StructureEvent): FibDirection {
		return event.direction === 'up' ? 'long' : 'short'
	}

	private anchor(point: StructurePoint): FibAnchor {
		return {
			index: point.index,
			timestamp: point.timestamp,
			price: point.price,
			type: point.type,
			label: point.label,
			knownAtIndex: this.knownAt(point.index),
		}
	}

	private knownAt(index: number): number {
		return index + this.config.pivotWindow
	}

	private eventId(event: StructureEvent): string {
		return `${event.confirmIndex}:${event.levelType}:${event.levelIndex}:${event.levelPrice}`
	}

	private skip(
		event: StructureEvent,
		eventId: string,
		mode: FibAnchorMode,
		reason: FibSkipReason,
		details: string,
	): FibGridSkip {
		return { eventId, eventIndex: event.confirmIndex, trigger: event.type, mode, reason, details }
	}
}
