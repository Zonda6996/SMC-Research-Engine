import type { Leg, LegDirection } from "@/models/legs/Leg.js" 
import type { StructurePoint } from "@/models/structure/StructurePoint.js"

/**
 * Строит Leg из пары StructurePoint.
 *
 * Это чистая функция без какой-либо аналитики рынка — она не решает,
 * является ли пара точек "правильной" ногой, а только считает
 * производные числовые поля (range/candles/duration) из уже готовых
 * start/end и переданного направления.
 *
 * Используется и StructuralLegEngine, и SwingLegEngine, чтобы формула
 * ноги не могла разойтись между разными источниками легов.
 */
export function buildLeg(
	start: StructurePoint,
	end: StructurePoint,
	direction: LegDirection,
): Leg {
	return {
		start,
		end,
		direction,
		range: Math.abs(end.price - start.price),
		candles: end.index - start.index,
		duration: end.timestamp - start.timestamp,
	}
}

