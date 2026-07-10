import type { Candle } from '@/models/price/Candle.js'
import type { Pivot } from '../structure/Pivot.js'
import type { Swing } from '../structure/Swing.js'
import type { StructurePoint } from '../structure/StructurePoint.js'
import type { MarketStructure } from '@/models/structure/MarketStructure.js'
import type { StructureEvent } from '@/models/events/StructureEvent.js'
import type { Leg } from '../legs/Leg.js'
import type { ATRPoint } from '@/models/indicators/ATRPoint.js'
import type { LegStrength } from '../legs/LegStrength.js'
import type { LegContext } from '../legs/LegContext.js'
import type { FibGridResult } from '../fib/FibGrid.js'

/**
 * Единый результат одного прогона пайплайна анализа.
 *
 * Собирает выход всех текущих движков в одну структуру, чтобы у
 * consumers (console.table в index.ts, будущий debug UI, экспорт
 * в JSON для чарта) была одна точка правды вместо повторного вызова
 * каждого движка по отдельности.
 *
 * Поля соответствуют текущему пайплайну из SPEC.md:
 * Candles -> PivotDetector -> SwingEngine -> StructureEngine ->
 * -> MarketStructureEngine / StructuralLegEngine / SwingLegEngine ->
 * ATREngine -> LegStrengthEngine -> BosChochEngine
 *
 * По мере добавления новых модулей сюда добавляются новые поля —
 * старые не переименовываются, чтобы не ломать существующих consumers.
 */
export interface AnalysisSnapshot {
	candles: Candle[]
	pivots: Pivot[]
	swings: Swing[]
	structure: StructurePoint[]
	market: MarketStructure
	structuralLegs: Leg[]
	swingLegs: Leg[]
	atr: ATRPoint[]
	legStrength: LegStrength[]
	legContexts: LegContext[]
	/** События BOS/CHoCH из BosChochEngine (дефолтный конфиг, SPEC 7.6). */
	events: StructureEvent[]
	/** Исследовательские Fib-кандидаты и объяснимые причины пропусков. */
	fib: FibGridResult
}
