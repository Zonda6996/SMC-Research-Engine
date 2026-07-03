import type { Leg } from './Leg.js'

export interface LegContext {
	leg: Leg

	index: number

	previous?: Leg
	next?: Leg

	isLast: boolean

	largerLeg?: Leg

	insideLegs: Leg[]
}
