// StructurePoint.ts

import type { Swing } from './Swing.js'

export type StructureLabel = 'HH' | 'HL' | 'LH' | 'LL'

export interface StructurePoint extends Swing {
	label: 'HH' | 'HL' | 'LH' | 'LL' | 'UNKNOWN'
}
