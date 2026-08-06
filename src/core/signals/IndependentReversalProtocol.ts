export const INDEPENDENT_REVERSAL_GENERATION = 'independent-reversal-edge-g1'
export const INDEPENDENT_REVERSAL_PROTOCOL_VERSION = 'independent-reversal-protocol-1.0-preregistered'

export const INDEPENDENT_REVERSAL_FAMILIES = ['P', 'L', 'S', 'V', 'C'] as const
export type IndependentReversalFamily = typeof INDEPENDENT_REVERSAL_FAMILIES[number]

export interface IndependentReversalProtocol {
	generation: string
	version: string
	seed: number
	families: readonly IndependentReversalFamily[]
	signal: {
		penetrationInnerWidth: number
		recoveryInnerWidth: number
		favorableBodyAtr: number
		maxEpisodeBars: number
		liquidityDistanceAtr: number
		peakRelativeVolume: number
		confirmationVolumeMax: number
		confirmationVolumePeakRatio: number
	}
	execution: {
		entry: 'next-bar-open'
		takerFeeRate: number
		makerFeeRate: number
		marketSlippageRate: number
		stopBufferAtr: number
		minRiskAtr: number
		maxRiskAtr: number
		targetR: number
		timeStopBars: number
		ambiguousBar: 'stop-first'
	}
	development: {
		symbols: readonly string[]
		timeframe: '15m'
		fit: readonly [string, string]
		signalValidation: readonly [string, string]
		managementValidation: readonly [string, string]
	}
	portability: { timeframes: readonly ['5m', '1h']; rule: 'no-retuning' }
	sealed: {
		symbols: readonly string[]
		timeframes: readonly ['5m', '15m', '1h']
		from: string
		rule: 'single-open-after-config-freeze'
	}
	gates: {
		minValidationTrades: number
		minExpectancyR: number
		minProfitFactor: number
		maxPortfolioDrawdownPct: number
		minNonNegativeCellShare: number
		maxSingleSymbolContribution: number
	}
}

/** Frozen before the first G1 profitability computation. */
export const INDEPENDENT_REVERSAL_PROTOCOL: IndependentReversalProtocol = {
	generation: INDEPENDENT_REVERSAL_GENERATION,
	version: INDEPENDENT_REVERSAL_PROTOCOL_VERSION,
	seed: 20260802,
	families: INDEPENDENT_REVERSAL_FAMILIES,
	signal: {
		penetrationInnerWidth: 0.25,
		recoveryInnerWidth: 0.50,
		favorableBodyAtr: 0.20,
		maxEpisodeBars: 96,
		liquidityDistanceAtr: 0.75,
		peakRelativeVolume: 1.50,
		confirmationVolumeMax: 1.00,
		confirmationVolumePeakRatio: 0.70,
	},
	execution: {
		entry: 'next-bar-open',
		takerFeeRate: 0.0005,
		makerFeeRate: 0.0002,
		marketSlippageRate: 0.0002,
		stopBufferAtr: 0.15,
		minRiskAtr: 0.50,
		maxRiskAtr: 3.00,
		targetR: 2.0,
		timeStopBars: 48,
		ambiguousBar: 'stop-first',
	},
	development: {
		symbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT'],
		timeframe: '15m',
		fit: ['2021-01-01', '2023-01-01'],
		signalValidation: ['2023-01-01', '2024-01-01'],
		managementValidation: ['2024-01-01', '2025-01-01'],
	},
	portability: { timeframes: ['5m', '1h'], rule: 'no-retuning' },
	sealed: {
		symbols: ['BNB/USDT', 'DOGE/USDT', 'ADA/USDT', 'LINK/USDT', 'AVAX/USDT', 'SUI/USDT', 'NEAR/USDT', 'APT/USDT', 'LTC/USDT'],
		timeframes: ['5m', '15m', '1h'],
		from: '2025-01-01',
		rule: 'single-open-after-config-freeze',
	},
	gates: {
		minValidationTrades: 200,
		minExpectancyR: 0.08,
		minProfitFactor: 1.15,
		maxPortfolioDrawdownPct: 15,
		minNonNegativeCellShare: 0.70,
		maxSingleSymbolContribution: 0.35,
	},
}

/** Stable JSON for hashing/audit; object keys are recursively sorted. */
export function stableProtocolJson(value: unknown = INDEPENDENT_REVERSAL_PROTOCOL): string {
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
