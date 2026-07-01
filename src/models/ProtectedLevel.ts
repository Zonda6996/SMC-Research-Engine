// ProtectedLevel.ts

import type { StructurePoint } from './StructurePoint.js'

export type ProtectedLevelType = 'high' | 'low'

export interface ProtectedLevel {
	type: ProtectedLevelType
	point: StructurePoint
}
