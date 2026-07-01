// ProtectedState.ts

import type { StructurePoint } from '@/models/structure/StructurePoint.js'

export interface ProtectedState {
	protectedHigh?: StructurePoint
	protectedLow?: StructurePoint
}
