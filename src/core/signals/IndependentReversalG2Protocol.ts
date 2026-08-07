export const INDEPENDENT_REVERSAL_G2_GENERATION = 'independent-reversal-edge-g2'
export const INDEPENDENT_REVERSAL_G2_VERSION = 'independent-reversal-g2-protocol-1.0-preregistered'

export const INDEPENDENT_REVERSAL_G2_VARIANTS = ['EXT', 'EXT_POOL', 'OWN1_POOL', 'EXT_POOL_SEQ', 'G1', 'MATCHED_NULL'] as const
export type IndependentReversalG2Variant = (typeof INDEPENDENT_REVERSAL_G2_VARIANTS)[number]

export const INDEPENDENT_REVERSAL_G2_PROTOCOL = {
	generation: INDEPENDENT_REVERSAL_G2_GENERATION,
	version: INDEPENDENT_REVERSAL_G2_VERSION,
	seed: 20260806,
	variants: INDEPENDENT_REVERSAL_G2_VARIANTS,
	candidate: {
		warmupBars: 220,
		extensionPenetrationMin: -0.35,
		extensionDistanceMeanPctMin: 3,
		extensionRelativeVolumeMin: 1.4,
		relativeVolumePeriod: 20,
		own1BodySmaPeriod: 20,
		own1BodyMultiple: 1.5,
		own1MeanDroughtBars: 10,
		own1SideCooldownBars: 40,
		opportunityCooldownBars: 3,
	},
	pool: {
		contextTimeframeMinutes: 240,
		minimumHistoryBars: 300,
		minimumAgeHours: 48,
		sweepRecencyHours: 24,
		maximumNotionalRank: 2 / 3,
		requireStrictBandEntry: true,
	},
	sequence: {
		lookbacks: [8, 16, 32] as const,
		minimumScore: 3,
		failedContinuationLookback: 8,
		meanSlopeLookback: 8,
		contractionLookback: 16,
	},
	execution: {
		entry: 'next-bar-open' as const,
		stopMultiplier: 12,
		partialFraction: 0.25,
		breakEven: 'next-bar-entry' as const,
		full: 'moving-opposite-inner-close' as const,
		ambiguousBar: 'stop-first' as const,
		maxHoldingBars: 2_000,
		baseOneWayCostBps: 6,
		stressOneWayCostBps: [9, 12] as const,
		addEnabledPrimary: false,
	},
	validation: {
		discoverySymbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT', 'ADAUSDT', 'LINKUSDT', 'LTCUSDT', 'AVAXUSDT', 'DOTUSDT', 'ATOMUSDT'] as const,
		transferSymbols: ['BCHUSDT', 'ETCUSDT', 'UNIUSDT', 'FILUSDT', 'NEARUSDT', 'APTUSDT'] as const,
		baseTimeframe: '1h' as const,
		contextTimeframe: '4h' as const,
		transferFrom: '2024-01-01',
		transferUntil: '2026-08-01',
		monthBlockFolds: 4,
		minimumFoldMonths: 4,
		sealedRule: 'single-open-after-config-hash' as const,
	},
	gates: {
		minimumOosTrades: 100,
		minimumMeanNetR: 0.05,
		minimumProfitFactor: 1.2,
		minimumStressMeanNetR: 0,
		minimumStressProfitFactor: 1.05,
		minimumNullAdvantageR: 0.04,
		minimumNonNegativeCellShare: 0.7,
		minimumPositiveTransferCells: 3,
		maximumSingleSymbolPositiveContribution: 0.35,
		maximumPortfolioDrawdownPct: 15,
		minimumBestOnePercentRemovedR: 0,
	},
	prohibitions: {
		symbolOrTimeframeFeatures: true,
		postHocVariantAddition: true,
		productionWiringBeforePromotion: true,
		sealedDataForWinnerSelection: true,
	},
} as const

export function stableIndependentReversalG2ProtocolJson(value: unknown = INDEPENDENT_REVERSAL_G2_PROTOCOL): string {
	const normalize = (input: unknown): unknown => {
		if (Array.isArray(input)) return input.map(normalize)
		if (input != null && typeof input === 'object') {
			return Object.fromEntries(Object.entries(input as Record<string, unknown>)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, nested]) => [key, normalize(nested)]))
		}
		return input
	}
	return JSON.stringify(normalize(value))
}
