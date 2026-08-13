// Causal audit of the stackShare filter.
//
// LEAKY (current auditStackSize.ts): zone.stackShare is normalized in
// consolidate() by maxStack = strongest ACTIVE stack of the side AT END OF
// HISTORY. Using it as a signal-time gate leaks the future.
//
// CAUSAL (this file): recompute the denominator per signal as the strongest
// stack of the same side that is already KNOWN and NOT-YET-TERMINATED at
// signalAt (knownAt <= t < endAt). Everything else matches auditStackSize.ts,
// so the two columns are directly comparable. The 0% columns must be identical
// (share>=0 is always true) — that is the sanity check.
//
// NOTE: the numerator (stackNotional) still carries the milder look-ahead #2
// (pool.notional is full-lifetime). That is a separate engine fix (step 2);
// this script isolates and removes the dominant leak #1 (the denominator).
import { fetchCandlesPaginated } from '../../tools/shared/candleFetcher.js'
import { computeApexBands, APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { detectArrowSignalCandidates } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayArrowSignals, ARROW_MODE_CONFIGS } from '../../src/core/signals/ArrowTradeReplay.js'
import { detectLiquidityHeatmap, heatmapConfigForTf } from '../../src/core/liquidity/LiquidityHeatmapEngine.js'
import { detectLiquidityPoi, LIQUIDITY_POI_CONFIG } from '../../src/core/confirmation/LiquidityPoiCalibration.js'
import { liquidityPoiProfileForTf } from '../../tools/shared/poiProfiles.js'

type ShareMode = 'leaky' | 'causal'

async function run() {
	const symbols = ['BTC/USDT', 'ETH/USDT', 'ONDO/USDT']
	const tfs = ['2h', '1h', '30m', '15m']
	const thresholds = [0, 0.10, 0.20, 0.30]
	const tradeMode = 'safe'
	const config = ARROW_MODE_CONFIGS[tradeMode]

	for (const symbol of symbols) {
		for (const tf of tfs) {
			const allCandles = await fetchCandlesPaginated(symbol, tf, 20000)
			if (allCandles.length < 500) {
				console.log(`\n${symbol} ${tf}: not enough data (${allCandles.length}) — skip`)
				continue
			}
			const candles = allCandles.slice(-20000)
			const bands = computeApexBands(candles, APEX_PARAMS)
			const detection = detectArrowSignalCandidates(candles, APEX_PARAMS)
			const rawSignals = detection.candidates.map(c => ({ ...c, atr200: c.atr200 }))

			const tfMs = tf === '2h' ? 7200000 : tf === '1h' ? 3600000 : tf === '30m' ? 1800000 : 900000
			const heatmapPools = detectLiquidityHeatmap(candles, heatmapConfigForTf(tfMs))
			const poiProfile = liquidityPoiProfileForTf(tfMs)
			const poi = detectLiquidityPoi(candles, [], { heatmapPools, config: { ...poiProfile, ...LIQUIDITY_POI_CONFIG } })

			// CAUSAL denominator: strongest known, not-yet-terminated, non-duplicate stack at time t.
			// knownAt<=t and endAt>t are both answerable at t (endAt = the termination timestamp).
			const causalMaxStack = (dir: 'long' | 'short', t: number): number => {
				let m = 0
				for (const z of poi) {
					if (z.direction !== dir || z.duplicateOf != null) continue
					if (z.knownAt > t || z.endAt <= t) continue
					if (z.stackNotional > m) m = z.stackNotional
				}
				return m
			}
			const shareOf = (z: typeof poi[number], t: number, mode: ShareMode): number => {
				if (mode === 'leaky') return z.stackShare
				const denom = causalMaxStack(z.direction, t)
				return denom > 0 ? z.stackNotional / denom : 1
			}

			// no-filter reference
			const off = replayArrowSignals(candles, bands, rawSignals, tradeMode, { ...config, maxHoldingBars: 1000 }).summary
			console.log(`\n==== ${symbol} ${tf} ====  off: ${off.totalNetR.toFixed(2)}R n=${off.signals}`)

			for (const mode of ['leaky', 'causal'] as ShareMode[]) {
				const cols: string[] = []
				for (const minStack of thresholds) {
					const valid = rawSignals.filter(s => {
						const zone = poi.find(z => {
							if (z.knownAt > s.signalAt) return false
							if (z.lifecycleState === 'spent' && z.spentAt != null && z.spentAt < s.signalAt) return false
							if (shareOf(z, s.signalAt, mode) < minStack) return false
							if (s.side === 'long' && z.direction === 'long') return candles[s.signalIndex]!.low <= Math.max(z.near, z.far)
							if (s.side === 'short' && z.direction === 'short') return candles[s.signalIndex]!.high >= Math.min(z.near, z.far)
							return false
						})
						return !!zone
					})
					const summary = replayArrowSignals(candles, bands, valid, tradeMode, { ...config, maxHoldingBars: 1000 }).summary
					cols.push(`>=${(minStack * 100).toFixed(0).padStart(2)}%: ${summary.totalNetR.toFixed(2).padStart(6)}R/n${String(summary.signals).padStart(3)}`)
				}
				console.log(`  [${mode.padEnd(6)}] ${cols.join('  ')}`)
			}
		}
	}
}

run().catch(console.error)
