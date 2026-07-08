import type { Leg } from '@/models/legs/Leg.js'
import type { LegContext } from '@/models/legs/LegContext.js'

export class LegContextEngine {
	build(legs: Leg[]): LegContext[] {
		const contexts: LegContext[] = legs.map((leg, index) => {
			const previous = index > 0 ? legs[index - 1] : undefined
			const next = index < legs.length - 1 ? legs[index + 1] : undefined

			const context: LegContext = {
				leg,
				index,
				isLast: index === legs.length - 1,
				enclosingLegs: [],
				insideLegs: [],
			}

			if (previous) {
				context.previous = previous
			}

			if (next) {
				context.next = next
			}

			return context
		})

		// enclosingLegs[i] — индексы объемлющих непробитых ног, упорядоченные
		// от ближней (j = i-1) к самой внешней (j = 0).
		const enclosingIndices: number[][] = contexts.map(() => [])

		for (let i = 0; i < legs.length; i++) {
			for (let j = i - 1; j >= 0; j--) {
				// Нога j — кандидат в объемлющие для i, если её защищаемый
				// экстремум (start.price) не пробит ни одной ногой в окне (j, i].
				// Сама нога i включается в окно проверки: если её end пробивает
				// protected_j — j вылетает (уровень потерял значимость к моменту i).
				if (!this.isProtectedBreached(legs, j, i)) {
					enclosingIndices[i]!.push(j)
				}
			}
		}

		// Заполняем enclosingLegs и обратную карту insideLegs.
		for (let i = 0; i < contexts.length; i++) {
			const ctx = contexts[i]!
			ctx.enclosingLegs = enclosingIndices[i]!.map(j => legs[j]!)

			for (const j of enclosingIndices[i]!) {
				contexts[j]!.insideLegs.push(legs[i]!)
			}
		}

		return contexts
	}

	/**
	 * Проверяет, пробит ли защищаемый экстремум ноги `j` (`start.price`)
	 * какой-либо точкой структурных ног в окне `(j, toIndex]`.
	 *
	 * - bearish `j` (start = HH): protected сверху, пробой = точка строго выше.
	 * - bullish `j` (start = LL): protected снизу, пробой = точка строго ниже.
	 *
	 * Проверяются `start` и `end` каждой ноги окна — они берутся из Pivot-точек
	 * (сравнение по `high`/`low`), отдельная свечная проверка не нужна.
	 * Сравнение строгое: касание уровня пробоем не считается.
	 */
	private isProtectedBreached(
		legs: Leg[],
		j: number,
		toIndex: number,
	): boolean {
		const protectedLeg = legs[j]
		if (!protectedLeg) return false

		const protectedPrice = protectedLeg.start.price
		const isUpper = protectedLeg.direction === 'bearish'

		for (let k = j + 1; k <= toIndex; k++) {
			const leg = legs[k]
			if (!leg) continue

			if (isUpper) {
				if (leg.start.price > protectedPrice) return true
				if (leg.end.price > protectedPrice) return true
			} else {
				if (leg.start.price < protectedPrice) return true
				if (leg.end.price < protectedPrice) return true
			}
		}

		return false
	}
}
