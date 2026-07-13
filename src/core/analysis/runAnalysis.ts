import type { Candle } from '@/models/price/Candle.js'
import type { AnalysisSnapshot } from '@/models/analysis/AnalysisSnapshot.js'
import { PivotDetector } from '@/core/builders/PivotDetector.js'
import { SwingEngine } from '@/core/builders/SwingEngine.js'
import { StructureEngine } from '@/core/builders/StructureEngine.js'
import { MarketStructureEngine } from '@/core/builders/MarketStructureEngine.js'
import { StructuralLegEngine } from '@/core/builders/StructuralLegEngine.js'
import { SwingLegEngine } from '@/core/builders/SwingLegEngine.js'
import { ATREngine } from '@/core/analysis/ATREngine.js'
import { LegStrengthEngine } from '@/core/analysis/LegStrengthEngine.js'
import { LegContextEngine } from '../legs/LegContextEngine.js'
import { BosChochEngine, type BosChochConfig } from '@/core/events/BosChochEngine.js'
import { FibGridEngine } from '@/core/fib/FibGridEngine.js'
import { FibLifecycleEngine } from '@/core/fib/FibLifecycleEngine.js'

/** Переопределения конфигурации пайплайна (для research-инструментов). */
export interface RunAnalysisOptions {
	/**
	 * Частичный конфиг BosChochEngine. `pivotWindow` применяется согласованно
	 * к PivotDetector И к движку событий — датировка confirmedAt обязана
	 * совпадать с фактическим окном пивотов, иначе появится look-ahead.
	 */
	bosChoch?: Partial<BosChochConfig>
}

/**
 * Прогоняет текущий пайплайн анализа над свечами и возвращает
 * единый AnalysisSnapshot со всеми промежуточными результатами.
 *
 * Это чистое вычисление: никакого console.log, никакого форматирования.
 * Как именно показывать снапшот (console.table, debug UI, JSON для чарта) —
 * решает вызывающий код, а не эта функция.
 */
export function runAnalysis(candles: Candle[], options: RunAnalysisOptions = {}): AnalysisSnapshot {
	const pivotWindow = options.bosChoch?.pivotWindow ?? 2
	const pivots = new PivotDetector(pivotWindow).detect(candles)
	const swings = new SwingEngine().build(pivots)
	const structure = new StructureEngine().build(swings)
	const marketEngine = new MarketStructureEngine(2)
	for (const point of structure) {
		marketEngine.update(point, candles)
	}
	const market = marketEngine.getState()
	const structuralLegs = new StructuralLegEngine().build(structure)
	const legContexts = new LegContextEngine().build(structuralLegs)
	const swingLegs = new SwingLegEngine().build(structure)
	const atr = new ATREngine().build(candles)
	const legStrength = new LegStrengthEngine().build(swingLegs, atr)
	const events = new BosChochEngine({ ...options.bosChoch, pivotWindow }).build(structure, candles)
	const fib = new FibGridEngine().build({ events, candles, atr })
	const fibLifecycle = new FibLifecycleEngine().build({ candidates: fib.candidates, events, candles })

	return {
		candles,
		pivots,
		swings,
		structure,
		market,
		structuralLegs,
		swingLegs,
		atr,
		legStrength,
		legContexts,
		events,
		fib,
		fibLifecycle,
	}
}
