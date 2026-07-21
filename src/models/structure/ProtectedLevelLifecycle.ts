import type { StructurePoint } from './StructurePoint.js'

/** Causal history of a level while it was actually protected. */
export interface ProtectedLevelLifecycle {
  id: string
  direction: 'long' | 'short'
  point: StructurePoint
  originAt: number
  knownAt: number
  supersededAt: number | null
  breachedAt: number | null
  endAt: number | null
  active: boolean
}
