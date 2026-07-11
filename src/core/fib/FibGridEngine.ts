import type { StructureEvent } from '@/models/events/StructureEvent.js'
import type {
	FibAnchor,
	FibDirection,
	FibGridCandidate,
	FibGridResult,
	FibGridSkip,
	FibLevel,
	FibSkipReason,
} from '@/models/fib/FibGrid.js'
import type { StructurePoint } from '@/models/structure/StructurePoint.js'

export const FIB_LEVEL_RATIOS = [0, 23.6, 38.2, 50, 61.8, 78.6, 100, 141, 161, 200, 241, 261, 300] as const

export interface FibGridInput {
	events: StructureEvent[]
	structure: StructurePoint[]
}

export interface FibGridConfig {
	pivotWindow: number
}

/**
 * Строит одну структурную Fib-сетку на каждое размеченное BOS/CHoCH-событие.
 *
 * Якоря привязаны к той же разметке, что и линии событий на графике:
 * - 100% = пробитый уровень (начало линии BOS/CHoCH);
 * - 0%   = последний подтверждённый противоположный структурный свинг
 *          ПЕРЕД пробоем — начало импульса, который сломал уровень.
 *
 * Движок не выбирает «правильную» сетку, не торгует и не
 * пересчитывает якоря после создания. Только генерация + диагностика.
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
				result.skips.push(this.skip(event, eventId, 'unlabeled-event', 'Первое событие не имеет BOS/CHoCH-классификации'))
				continue
			}
			const candidate = this.buildCandidate(event, eventId, input.structure)
			if ('reason' in candidate) result.skips.push(candidate)
			else result.candidates.push(candidate)
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

	private buildCandidate(
		event: StructureEvent,
		eventId: string,
		structure: StructurePoint[],
	): FibGridCandidate | FibGridSkip {
		const direction = this.direction(event)
		const oppositeType = direction === 'long' ? 'low' : 'high'

		// Начало импульса: идём от пробоя назад и берём первый противоположный
		// свинг, который уже подтверждён к моменту события и даёт валидный
		// диапазон. Свинги ПОСЛЕ возникновения уровня приоритетны (это и есть
		// откат, из которого вышел ломающий импульс); свинги до уровня —
		// запасной вариант для событий без промежуточного отката.
		const startPoint = [...structure]
			.reverse()
			.find((point) =>
				point.type === oppositeType &&
				point.index < event.breachIndex &&
				point.index !== event.levelIndex &&
				this.knownAt(point.index) <= event.confirmIndex &&
				(direction === 'long' ? point.price < event.levelPrice : point.price > event.levelPrice),
			)

		if (!startPoint) {
			return this.skip(event, eventId, 'missing-opposite-swing', 'Перед пробоем нет подтверждённого противоположного свинга с валидным диапазоном')
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

		const start = this.anchor(startPoint)
		if (start.knownAtIndex > event.confirmIndex || end.knownAtIndex > event.confirmIndex) {
			return this.skip(event, eventId, 'anchor-known-after-event', 'Один из якорей подтверждается после trigger-события')
		}
		if (start.price === end.price) {
			return this.skip(event, eventId, 'zero-range', 'Якоря имеют одинаковую цену')
		}
		if ((direction === 'long' && start.price >= end.price) || (direction === 'short' && start.price <= end.price)) {
			return this.skip(event, eventId, 'invalid-direction', `Цены якорей не соответствуют направлению ${direction}`)
		}

		const createdAtIndex = Math.max(event.confirmIndex, start.knownAtIndex, end.knownAtIndex)
		const trigger = event.type === 'bos' ? 'bos' : 'choch'
		return {
			id: `${eventId}:structural`,
			eventId,
			trigger,
			direction,
			start,
			end,
			createdAtIndex,
			levels: FibGridEngine.levels(start.price, end.price),
			explanation: `Импульс ${start.label} #${start.index} → пробитый ${event.levelLabel} event-level #${event.levelIndex}`,
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
		reason: FibSkipReason,
		details: string,
	): FibGridSkip {
		return { eventId, eventIndex: event.confirmIndex, trigger: event.type, reason, details }
	}
}
