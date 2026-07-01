// ProtectedState.ts

import type { StructurePoint } from './StructurePoint.js'

export interface ProtectedState {
	protectedHigh?: StructurePoint
	protectedLow?: StructurePoint
}
