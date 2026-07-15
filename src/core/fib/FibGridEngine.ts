import type { Candle } from '@/models/price/Candle.js'
import type { StructureEvent } from '@/models/events/StructureEvent.js'
import type { ATRPoint } from '@/models/indicators/ATRPoint.js'
import type {
	FibAnchor,
	FibAnchorMode,
	FibDirection,
	FibGridCandidate,
	FibGridResult,
	FibGridSkip,
	FibLevel,
	FibSkipReason,
	FibVariant,
} from '@/models/fib/FibGrid.js'

export const FIB_LEVEL_RATIOS = [0, 23.6, 38.2, 50, 61.8, 78.6, 100, 141, 161, 200, 241, 261, 300] as const

export interface FibGridInput {
	events: StructureEvent[]
	candles: Candle[]
	atr: ATRPoint[]
}

/**
 * Строит структурную Fib-сетку на каждое размеченное BOS/CHoCH-событие.
 *
 * 100% = пробитый event-level (та же цена, что и линия события на графике).
 * 0%   = ценовой экстремум по сырым свечам — не подтверждённый пивот,
 *        а фактический хай/лоу, откуда пошёл ломающий импульс. Два режима:
 *   - local:  экстремум в окне [levelIndex..breachIndex] — «от самого
 *             хая/лоу движения, сломавшего уровень»;
 *   - global: экстремум от последнего события противоположного направления
 *             до пробоя — вершина/дно всего тренда.
 *
 * Экстремум по сырым свечам известен сразу на пробое (окно заканчивается
 * breachIndex ≤ confirmIndex), поэтому look-ahead невозможен по построению.
 *
 * Для фильтрации шума каждый вариант несёт legAtrRatio — размер ноги
 * 0%→100% в единицах ATR(14) на момент пробоя. Порог применяет UI/стратегия,
 * движок ничего не отбрасывает.
 */
export class FibGridEngine {
	build(input: FibGridInput): FibGridResult {
		const result: FibGridResult = { candidates: [], skips: [] }

		for (const event of input.events) {
			const eventId = FibGridEngine.eventId(event)
			if (event.type === 'unlabeled') {
				result.skips.push(this.skip(event, eventId, 'unlabeled-event', 'Первое событие не имеет BOS/CHoCH-классификации'))
				continue
			}
			const candidate = this.buildCandidate(event, eventId, input)
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
		input: FibGridInput,
	): FibGridCandidate | FibGridSkip {
		const direction = this.direction(event)

		const end: FibAnchor = {
			index: event.levelIndex,
			timestamp: input.candles[event.levelIndex]?.timestamp ?? event.breachTimestamp,
			price: event.levelPrice,
			type: event.levelType,
			label: event.levelLabel as FibAnchor['label'],
			knownAtIndex: event.breachIndex,
		}

		const atrAtBreach = this.atrAt(input.atr, event.breachIndex)

		const variants: Record<FibAnchorMode, FibVariant | null> = {
			local: this.buildVariant(event, direction, end, event.levelIndex, input.candles, atrAtBreach),
			global: this.buildVariant(event, direction, end, FibGridEngine.globalWindowStart(event, input.events), input.candles, atrAtBreach),
		}

		if (!variants.local && !variants.global) {
			return this.skip(event, eventId, 'no-valid-variant', 'Ни в одном окне нет экстремума с валидным диапазоном')
		}

		const trigger = event.type === 'bos' ? 'bos' : 'choch'
		return {
			id: `${eventId}:structural`,
			eventId,
			trigger,
			direction,
			end,
			variants,
			createdAtIndex: event.confirmIndex,
			oppositeSweptBefore: event.oppositeSweptBefore,
			explanation: `Экстремум импульса → пробитый ${event.levelLabel} event-level #${event.levelIndex}`,
		}
	}

	/**
	 * Начало окна для global-режима: пробой последнего события
	 * противоположного направления (или начало данных, если его нет).
	 * Статический и публичный: setupFilters (фильтр extreme) проверяет
	 * экстремальность event-level в том же окне, что и global-якорь.
	 */
	static globalWindowStart(event: StructureEvent, events: StructureEvent[]): number {
		let start = 0
		for (const other of events) {
			if (other.breachIndex >= event.breachIndex) break
			if (other.direction !== event.direction) start = other.breachIndex
		}
		return start
	}

	/** Ищет экстремум в окне [windowStart..breachIndex] и собирает вариант. */
	private buildVariant(
		event: StructureEvent,
		direction: FibDirection,
		end: FibAnchor,
		windowStart: number,
		candles: Candle[],
		atrAtBreach: number | null,
	): FibVariant | null {
		const from = Math.max(0, windowStart)
		const to = Math.min(event.breachIndex, candles.length - 1)
		if (from > to) return null

		let extremeIndex = -1
		let extremePrice = direction === 'long' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
		for (let i = from; i <= to; i++) {
			const candle = candles[i]
			if (!candle) continue
			if (direction === 'long') {
				if (candle.low < extremePrice) {
					extremePrice = candle.low
					extremeIndex = i
				}
			} else if (candle.high > extremePrice) {
				extremePrice = candle.high
				extremeIndex = i
			}
		}
		if (extremeIndex < 0) return null

		// Диапазон должен соответствовать направлению: 0% строго по нужную сторону от 100%.
		if (direction === 'long' ? extremePrice >= end.price : extremePrice <= end.price) return null

		const candle = candles[extremeIndex]
		if (!candle) return null
		const start: FibAnchor = {
			index: extremeIndex,
			timestamp: candle.timestamp,
			price: extremePrice,
			type: direction === 'long' ? 'low' : 'high',
			label: 'UNKNOWN',
			knownAtIndex: extremeIndex,
		}

		const legSize = Math.abs(end.price - start.price)
		return {
			start,
			levels: FibGridEngine.levels(start.price, end.price),
			legSize,
			legAtrRatio: atrAtBreach && atrAtBreach > 0 ? legSize / atrAtBreach : null,
		}
	}

	/** Последнее значение ATR, известное к данному индексу (без look-ahead). */
	private atrAt(atr: ATRPoint[], index: number): number | null {
		let value: number | null = null
		for (const point of atr) {
			if (point.index > index) break
			value = point.value
		}
		return value
	}

	private direction(event: StructureEvent): FibDirection {
		return event.direction === 'up' ? 'long' : 'short'
	}

	/** Статический и публичный: setupFilters связывает outcome → candidate → event. */
	static eventId(event: StructureEvent): string {
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
