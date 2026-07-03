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

/**
 * Прогоняет текущий пайплайн анализа над свечами и возвращает
 * единый AnalysisSnapshot со всеми промежуточными результатами.
 *
 * Это чистое вычисление: никакого console.log, никакого форматирования.
 * Как именно показывать снапшот (console.table, debug UI, JSON для чарта) —
 * решает вызывающий код, а не эта функция.
 */
export function runAnalysis(candles: Candle[]): AnalysisSnapshot {
	const pivots = new PivotDetector(2).detect(candles)
	const swings = new SwingEngine().build(pivots)
	const structure = new StructureEngine().build(swings)
	const marketEngine = new MarketStructureEngine()
	const structuralLegs = new StructuralLegEngine().build(structure)
	const legContexts = new LegContextEngine().build(structuralLegs)
	const swingLegs = new SwingLegEngine().build(structure)
	const atr = new ATREngine().build(candles)
	const legStrength = new LegStrengthEngine().build(swingLegs, atr)
	const market = marketEngine.getState()

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
	}
}
