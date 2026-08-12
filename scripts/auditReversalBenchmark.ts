import { fetchCandlesPaginated } from '../tools/shared/candleFetcher.js'
import { detectArrowSignalCandidates, type ArrowSignal } from '../src/core/signals/ArrowSignalEngine.js'
import { replayArrowSignals } from '../src/core/signals/arrowTradeReplay.js'
import { computeApexBands, APEX_PARAMS } from '../src/core/signals/ApexEngine.js'
import type { Candle } from '../src/models/price/Candle.js'

export interface BenchmarkResult {
	symbol: string
	timeframe: string
	mode: string
	variant: 'baseline' | 'H1_APEX_CONTRACTION'
	totalCandles: number
	signalsCount: number
	fullTpCount: number
	fullTpPct: string
	partialBeCount: number
	partialStopCount: number
	stopCount: number
	netR: string
	meanR: string
	profitFactor: string
	vendorWinrate: string
}

function averageRange(candles: readonly Candle[], from: number, until: number): number {
	let sum = 0
	for (let i = from; i < until; i++) sum += candles[i]!.high - candles[i]!.low
	return until > from ? sum / (until - from) : 0
}

function sequenceScore(candles: readonly Candle[], bands: any[], signal: ArrowSignal): number {
	const i = signal.signalIndex, side = signal.side === 'long' ? 1 : -1
	if (i < 200 || bands[i] == null || bands[i - 8] == null) return 0
	let adverse = side === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
	for (let j = i - 8; j < i; j++) adverse = side === 1 ? Math.min(adverse, candles[j]!.low) : Math.max(adverse, candles[j]!.high)
	const c = candles[i]!
	const failedContinuation = side === 1 ? c.low >= adverse && c.close > c.open : c.high <= adverse && c.close < c.open
	let trSum = 0
	for (let j = i - 7; j <= i; j++) {
		const x = candles[j]!, p = candles[j - 1]!
		trSum += Math.max(x.high - x.low, Math.abs(x.high - p.close), Math.abs(x.low - p.close))
	}
	const meanSlopeAtr = side * (bands[i]!.mean - bands[i - 8]!.mean) / Math.max(trSum / 8, Number.EPSILON)
	const contraction = averageRange(candles, i - 8, i) < averageRange(candles, i - 16, i - 8)
	const directional = side === 1 ? c.close > c.open : c.close < c.open
	return Number(failedContinuation) + Number(meanSlopeAtr > -0.25) + Number(contraction) + Number(directional)
}

export function runBenchmarkOnSeries(symbol: string, timeframe: string, candles: Candle[]): BenchmarkResult[] {
	const rawBands = computeApexBands(candles, APEX_PARAMS)
	const bands = rawBands.map((b, i) =>
		Number.isFinite(b.mean)
			? {
					t: candles[i]!.timestamp,
					mean: b.mean,
					redLo: b.redLo,
					redHi: b.redHi,
					greenHi: b.greenHi,
					greenLo: b.greenLo,
			  }
			: null,
	)
	const detection = detectArrowSignalCandidates(candles, APEX_PARAMS)
	const filteredCandidates = detection.candidates.filter((s) => sequenceScore(candles, bands, s) >= 3)

	const rows: BenchmarkResult[] = []

	for (const variant of ['baseline', 'H1_APEX_CONTRACTION'] as const) {
		const candidateList = variant === 'baseline' ? detection.candidates : filteredCandidates

		for (const mode of ['safe', 'risk', 'standard'] as const) {
			const replay = replayArrowSignals(candles, bands as any, candidateList, mode)
			const trades = replay.trades
			const values = trades.map((t) => t.netR)
			const gains = values.filter((x) => x > 0).reduce((s, x) => s + x, 0)
			const losses = -values.filter((x) => x < 0).reduce((s, x) => s + x, 0)
			const fullTp = trades.filter((t) => t.outcome === 'full-tp').length
			const partialBe = trades.filter((t) => t.outcome === 'partial-be').length
			const partialStop = trades.filter((t) => t.outcome === 'partial-stop').length
			const stop = trades.filter((t) => t.outcome === 'stop').length
			const finalized = fullTp + partialBe + partialStop + stop
			const totalNetR = values.reduce((s, x) => s + x, 0)
			const meanNetR = values.length ? totalNetR / values.length : 0
			const pf = losses > 0 ? gains / losses : gains > 0 ? Number.POSITIVE_INFINITY : 0
			const vendorWr = finalized ? (partialBe + partialStop + fullTp) / finalized : 0

			rows.push({
				symbol,
				timeframe,
				mode,
				variant,
				totalCandles: candles.length,
				signalsCount: trades.length,
				fullTpCount: fullTp,
				fullTpPct: trades.length ? `${((fullTp / trades.length) * 100).toFixed(1)}%` : '0%',
				partialBeCount: partialBe,
				partialStopCount: partialStop,
				stopCount: stop,
				netR: totalNetR.toFixed(2) + 'R',
				meanNetR: meanNetR.toFixed(2) + 'R',
				profitFactor: Number.isFinite(pf) ? pf.toFixed(2) : '∞',
				vendorWinrate: `${(vendorWr * 100).toFixed(1)}%`,
			})
		}
	}

	return rows
}

async function main() {
	console.log('====================================================================')
	console.log('  ZONDA REVERSAL — BASELINE vs H1_APEX_CONTRACTION AUDIT (20k BARS) ')
	console.log('====================================================================\n')

	const pairs = [
		{ symbol: 'BTC/USDT', timeframe: '15m' },
		{ symbol: 'BTC/USDT', timeframe: '1h' },
		{ symbol: 'ETH/USDT', timeframe: '15m' },
		{ symbol: 'SOL/USDT', timeframe: '1h' },
	]

	const rows: BenchmarkResult[] = []

	for (const p of pairs) {
		try {
			console.log(`Fetching ${p.symbol} ${p.timeframe} (20,000 candles)...`)
			const candles = await fetchCandlesPaginated(p.symbol, p.timeframe, 20000, 'futures')
			const res = runBenchmarkOnSeries(p.symbol, p.timeframe, candles)
			rows.push(...res)
		} catch (err) {
			console.error(`Failed to benchmark ${p.symbol} ${p.timeframe}:`, err)
		}
	}

	console.log('\n--- 20,000 CANDLES BASELINE vs CONTRACTION REGIME TABLE ---')
	console.table(rows)
}

main()
