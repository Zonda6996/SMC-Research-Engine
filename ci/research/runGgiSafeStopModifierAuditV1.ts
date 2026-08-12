import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseExactIndicatorCsv, type ExactIndicatorRow } from './lib/exactIndicatorExport.js'
import { trueRangeSma } from './lib/ggiCorrectedReplay.js'

interface Observation {
	id: string
	asset: string
	timeframe: string
	timeframeMinutes: number
	file: string
	signalTime: string
	direction: 'BUY' | 'SELL'
	entry: number
	safeDistance: number
	atr55Reported: number
	anomalous?: boolean
	development: boolean
}

interface FeatureRow {
	observation: Observation
	signalIndex: number
	targetMultiplier: number
	features: Record<string, number>
}

const observations: Observation[] = [
	{ id: 'ondo-15m', asset: 'ONDO', timeframe: '15m', timeframeMinutes: 15, file: 'C:/Users/Никита/Downloads/BYBIT_ONDOUSDT.P, 15 (1).csv', signalTime: '2026-08-03T08:45:00+05:00', direction: 'BUY', entry: 0.3715, safeDistance: 0.0256, atr55Reported: 0.002089090909090912, development: true },
	{ id: 'avax-1h', asset: 'AVAX', timeframe: '1h', timeframeMinutes: 60, file: 'C:/Users/Никита/Downloads/BYBIT_AVAXUSDT.P, 60.csv', signalTime: '2026-08-02T02:00:00+05:00', direction: 'BUY', entry: 6.184, safeDistance: 0.621, atr55Reported: 0.04978181818181817, development: true },
	{ id: 'ltc-2h', asset: 'LTC', timeframe: '2h', timeframeMinutes: 120, file: 'C:/Users/Никита/Downloads/BYBIT_LTCUSDT.P, 120.csv', signalTime: '2026-08-02T05:00:00+05:00', direction: 'BUY', entry: 44.54, safeDistance: 5.09, atr55Reported: 0.4070909090909092, development: true },
	{ id: 'bnb-spot-15m', asset: 'BNB', timeframe: '15m', timeframeMinutes: 15, file: 'C:/Users/Никита/Downloads/BINANCE_BNBUSDT, 15.csv', signalTime: '2026-08-03T03:45:00+05:00', direction: 'SELL', entry: 588.33, safeDistance: 11.69, atr55Reported: 0.9794545454545435, development: true },
	{ id: 'aave-2h', asset: 'AAVE', timeframe: '2h', timeframeMinutes: 120, file: 'C:/Users/Никита/Downloads/BYBIT_AAVEUSDT.P, 120.csv', signalTime: '2026-08-02T05:00:00+05:00', direction: 'BUY', entry: 92.29, safeDistance: 17.27, atr55Reported: 1.6554545454545446, anomalous: true, development: false },
	{ id: 'link-2h', asset: 'LINK', timeframe: '2h', timeframeMinutes: 120, file: 'C:/Users/Никита/Downloads/BYBIT_LINKUSDT.P, 120.csv', signalTime: '2026-08-02T05:00:00+05:00', direction: 'BUY', entry: 8.153, safeDistance: 1.037, atr55Reported: 0.0884, development: false },
	{ id: 'dash-1h', asset: 'DASH', timeframe: '1h', timeframeMinutes: 60, file: 'C:/Users/Никита/Downloads/BYBIT_DASHUSDT.P, 60.csv', signalTime: '2026-08-01T14:00:00+05:00', direction: 'SELL', entry: 31.39, safeDistance: 3.67, atr55Reported: 0.2930909090909096, development: false },
	{ id: 'pepe-15m', asset: '1000PEPE', timeframe: '15m', timeframeMinutes: 15, file: 'C:/Users/Никита/Downloads/BYBIT_1000PEPEUSDT.P, 15.csv', signalTime: '2026-08-03T12:15:00+05:00', direction: 'BUY', entry: 0.002832, safeDistance: 0.000151, atr55Reported: 0.000011563636363636376, development: false },
	{ id: 'pepe-1h', asset: '1000PEPE', timeframe: '1h', timeframeMinutes: 60, file: 'C:/Users/Никита/Downloads/BYBIT_1000PEPEUSDT.P, 60.csv', signalTime: '2026-08-02T13:00:00+05:00', direction: 'SELL', entry: 0.002912, safeDistance: 0.00033, atr55Reported: 0.00003089090909090916, development: false },
	{ id: 'doge-30m', asset: 'DOGE', timeframe: '30m', timeframeMinutes: 30, file: 'C:/Users/Никита/Downloads/BYBIT_DOGEUSDT.P, 30.csv', signalTime: '2026-08-03T05:00:00+05:00', direction: 'SELL', entry: 0.07035, safeDistance: 0.00348, atr55Reported: 0.00025672727272727435, development: false },
	{ id: 'inj-1h', asset: 'INJ', timeframe: '1h', timeframeMinutes: 60, file: 'C:/Users/Никита/Downloads/BYBIT_INJUSDT.P, 60.csv', signalTime: '2026-08-03T01:00:00+05:00', direction: 'SELL', entry: 5.142, safeDistance: 0.445, atr55Reported: 0.048327272727272816, development: false },
	{ id: 'tao-15m', asset: 'TAO', timeframe: '15m', timeframeMinutes: 15, file: 'C:/Users/Никита/Downloads/BYBIT_TAOUSDT.P, 15.csv', signalTime: '2026-08-03T09:15:00+05:00', direction: 'BUY', entry: 190.49, safeDistance: 8.02, atr55Reported: 0.5969090909090912, development: false },
]

function mean(values: readonly number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length
}

function mae(actual: readonly number[], predicted: readonly number[]): number {
	return mean(actual.map((value, index) => Math.abs(value - predicted[index]!)))
}

function maxAbsError(actual: readonly number[], predicted: readonly number[]): number {
	return Math.max(...actual.map((value, index) => Math.abs(value - predicted[index]!)))
}

function linearFit(x: readonly number[], y: readonly number[]): { intercept: number; slope: number } {
	const mx = mean(x)
	const my = mean(y)
	const variance = x.reduce((sum, value) => sum + (value - mx) ** 2, 0)
	const covariance = x.reduce((sum, value, index) => sum + (value - mx) * (y[index]! - my), 0)
	return { intercept: my - (variance > 0 ? covariance / variance : 0) * mx, slope: variance > 0 ? covariance / variance : 0 }
}

function correlation(x: readonly number[], y: readonly number[]): number {
	const mx = mean(x)
	const my = mean(y)
	const numerator = x.reduce((sum, value, index) => sum + (value - mx) * (y[index]! - my), 0)
	const denominator = Math.sqrt(x.reduce((sum, value) => sum + (value - mx) ** 2, 0) * y.reduce((sum, value) => sum + (value - my) ** 2, 0))
	return denominator > 0 ? numerator / denominator : 0
}

function averageRange(rows: readonly ExactIndicatorRow[], endIndex: number, length: number): number {
	const start = Math.max(0, endIndex - length + 1)
	return mean(rows.slice(start, endIndex + 1).map((row) => row.high - row.low))
}

function extractFeatures(observation: Observation): FeatureRow {
	const text = readFileSync(observation.file, 'utf8')
	const rows = parseExactIndicatorCsv(text, {
		expectedTimeframeMs: observation.timeframeMinutes * 60_000,
		allowIrregularBars: true,
		allowInvalidBandOrder: true,
	})
	const timestamp = Date.parse(observation.signalTime)
	const signalIndex = rows.findIndex((row) => row.timestamp === timestamp)
	if (signalIndex < 100) throw new Error(`${observation.id}: signal timestamp not found or insufficient warmup`)
	const row = rows[signalIndex]!
	const atr14 = trueRangeSma(rows, 14)[signalIndex]!
	const atr55 = trueRangeSma(rows, 55)[signalIndex]!
	const atr100 = trueRangeSma(rows, 100)[signalIndex]!
	if (atr14 == null || atr55 == null || atr100 == null) throw new Error(`${observation.id}: volatility unavailable`)
	const outerWidth = row.upperOuter - row.lowerOuter
	const innerWidth = row.upperInner - row.lowerInner
	const previousWidths = rows.slice(signalIndex - 20, signalIndex).filter((candidate) => candidate.upperOuter > candidate.lowerOuter).map((candidate) => candidate.upperOuter - candidate.lowerOuter)
	const previousOuterWidth = mean(previousWidths)
	const side = observation.direction === 'BUY' ? 1 : -1
	const adverseWindow = rows.slice(signalIndex - 20, signalIndex + 1)
	const adverseSwing = side === 1
		? Math.min(...adverseWindow.map((candidate) => candidate.low))
		: Math.max(...adverseWindow.map((candidate) => candidate.high))
	const directionalMeanGap = side * (row.mean - observation.entry) / atr55
	const directionalInnerGap = side * ((side === 1 ? row.lowerInner : row.upperInner) - observation.entry) / atr55
	const currentTr = Math.max(row.high - row.low, Math.abs(row.high - rows[signalIndex - 1]!.close), Math.abs(row.low - rows[signalIndex - 1]!.close))
	return {
		observation,
		signalIndex,
		targetMultiplier: observation.safeDistance / atr55,
		features: {
			volatilityRatio14to55: atr14 / atr55,
			volatilityRatio55to100: atr55 / atr100,
			outerWidthOverAtr55: outerWidth / atr55,
			innerWidthOverAtr55: innerWidth / atr55,
			outerExpansion20: outerWidth / previousOuterWidth,
			directionalMeanGapAtr55: directionalMeanGap,
			directionalInnerGapAtr55: directionalInnerGap,
			adverseSwing20OverAtr55: Math.abs(observation.entry - adverseSwing) / atr55,
			currentTrOverAtr55: currentTr / atr55,
			range5OverRange20: averageRange(rows, signalIndex, 5) / averageRange(rows, signalIndex, 20),
		},
	}
}

const rows = observations.map(extractFeatures)
const cleanRows = rows.filter((row) => !row.observation.anomalous)
const development = cleanRows.filter((row) => row.observation.development)
const validation = cleanRows.filter((row) => !row.observation.development)
const featureNames = Object.keys(cleanRows[0]!.features)
const developmentTarget = development.map((row) => row.targetMultiplier)
const validationTarget = validation.map((row) => row.targetMultiplier)
const baselineMultiplier = mean(developmentTarget)
const baselineValidation = validationTarget.map(() => baselineMultiplier)

const featureAudit = featureNames.map((feature) => {
	const developmentX = development.map((row) => row.features[feature]!)
	const validationX = validation.map((row) => row.features[feature]!)
	const fit = linearFit(developmentX, developmentTarget)
	const developmentPredicted = developmentX.map((value) => fit.intercept + fit.slope * value)
	const validationPredicted = validationX.map((value) => fit.intercept + fit.slope * value)
	return {
		feature,
		fit,
		developmentCorrelation: correlation(developmentX, developmentTarget),
		validationCorrelation: correlation(validationX, validationTarget),
		developmentMaeMultiplier: mae(developmentTarget, developmentPredicted),
		validationMaeMultiplier: mae(validationTarget, validationPredicted),
		validationMaxAbsErrorMultiplier: maxAbsError(validationTarget, validationPredicted),
		baselineValidationMaeMultiplier: mae(validationTarget, baselineValidation),
		baselineValidationMaxAbsErrorMultiplier: maxAbsError(validationTarget, baselineValidation),
		validationImprovementPct: (1 - mae(validationTarget, validationPredicted) / mae(validationTarget, baselineValidation)) * 100,
		predictions: validation.map((row, index) => ({ id: row.observation.id, actual: validationTarget[index], predicted: validationPredicted[index], error: validationPredicted[index]! - validationTarget[index]! })),
	}
}).sort((a, b) => b.validationImprovementPct - a.validationImprovementPct)

// This family was preregistered before the next independent package, but is
// not called validated on the data used to select it. The winner is restricted
// to one causal scalar feature and a linear modifier learned only from the four
// original development observations.
const frozenCandidate = featureAudit[0]!

const result = {
	schemaVersion: 1,
	generatedAt: new Date().toISOString(),
	scope: 'exploratory causal Safe-stop modifier audit; one-feature linear families fitted on original four observations; current validation batch used only to rank/falsify; selected family frozen for a future independent package',
	baseline: {
		multiplierFromOriginalDevelopment: baselineMultiplier,
		formula: `SafeDistance = ${baselineMultiplier.toFixed(6)} × SMA(TR,55)`,
		validationMaeMultiplier: mae(validationTarget, baselineValidation),
		validationMaxAbsErrorMultiplier: maxAbsError(validationTarget, baselineValidation),
	},
	rows: rows.map((row) => ({
		...row.observation,
		signalIndex: row.signalIndex,
		targetMultiplier: row.targetMultiplier,
		features: row.features,
	})),
	featureAudit,
	frozenForNextIndependentPackage: {
		status: 'candidate_not_validated',
		feature: frozenCandidate.feature,
		intercept: frozenCandidate.fit.intercept,
		slope: frozenCandidate.fit.slope,
		formula: `SafeDistance = ATR55 × (${frozenCandidate.fit.intercept.toFixed(6)} + ${frozenCandidate.fit.slope.toFixed(6)} × ${frozenCandidate.feature})`,
		selectionWarning: 'Chosen after inspecting the current validation batch; must not be claimed as validated until tested unchanged on 8–12 new matched setups.',
		acceptanceGate: 'On the next package, reduce MAE versus the fixed ATR55 baseline by at least 25%, avoid direction/timeframe bias, and keep max absolute distance error below 12% on clean observations.',
	},
}

const outDir = resolve('ci-results')
mkdirSync(outDir, { recursive: true })
writeFileSync(resolve(outDir, 'ggi-safe-stop-modifier-audit-v1.json'), `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify({ baseline: result.baseline, best: result.featureAudit.slice(0, 5), frozen: result.frozenForNextIndependentPackage }, null, 2))
