import type { Leg } from '@/models/legs/Leg.js'

export interface LegStrength {
	leg: Leg

	range: number

	averageAtr: number

	strength: number
}
