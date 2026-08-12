import { fetchCandlesPaginated } from '../tools/shared/candleFetcher.js'
import { computeApexBands, APEX_PARAMS } from '../src/core/signals/ApexEngine.js'
import { detectArrowSignalCandidates } from '../src/core/signals/ArrowSignalEngine.js'
import { replayArrowSignals, ARROW_MODE_CONFIGS } from '../src/core/signals/ArrowTradeReplay.js'
import { detectLiquidityHeatmap, heatmapConfigForTf } from '../src/core/liquidity/LiquidityHeatmapEngine.js'
import { detectLiquidityPoi, LIQUIDITY_POI_CONFIG } from '../src/core/confirmation/LiquidityPoiCalibration.js'
import { liquidityPoiProfileForTf } from '../tools/shared/poiProfiles.js'

async function run() {
	const symbols = ['BTC/USDT', 'ETH/USDT', 'ONDO/USDT']
	const tfs = ['2h', '1h', '30m', '15m']
	const modes = [
		{ name: 'off', minStack: 0 },
		{ name: 'stack >= 0%', minStack: 0 },
		{ name: 'stack >= 10%', minStack: 0.10 },
		{ name: 'stack >= 20%', minStack: 0.20 },
		{ name: 'stack >= 30%', minStack: 0.30 },
	]

	for (const symbol of symbols) {
		for (const tf of tfs) {
			console.log(`\n======================================================`)
			console.log(`  ${symbol} ${tf} — POI STACK SIZE AUDIT`)
			console.log(`======================================================\n`)
			
			const allCandles = await fetchCandlesPaginated(symbol, tf, 20000)
			if (allCandles.length < 500) {
				console.log(`Not enough data (${allCandles.length} candles). Skipping...`)
				continue
			}
			const candles = allCandles.slice(-20000)
			
			const bands = computeApexBands(candles, APEX_PARAMS)
			const detection = detectArrowSignalCandidates(candles, APEX_PARAMS)
			
			const rawSignals = detection.candidates.map(c => ({ ...c, atr200: c.atr200 }))
			const tradeMode = 'safe'
			const config = ARROW_MODE_CONFIGS[tradeMode]
			
			const tfMs = tf === '2h' ? 7200000 : tf === '1h' ? 3600000 : tf === '30m' ? 1800000 : 900000
			const hmBase = heatmapConfigForTf(tfMs)
			const heatmapPools = detectLiquidityHeatmap(candles, hmBase)
			const poiProfile = liquidityPoiProfileForTf(tfMs)
			const poiCandidates = detectLiquidityPoi(candles, [], { heatmapPools, config: { ...poiProfile, ...LIQUIDITY_POI_CONFIG } })

			for (const filter of modes) {
				const validSignals = rawSignals.filter(s => {
					if (filter.name === 'off') return true

					const activeZone = poiCandidates.find(zone => {
						if (zone.knownAt > s.signalAt) return false
						if (zone.lifecycleState === 'spent' && zone.spentAt < s.signalAt) return false
						// CAUSAL FIX: zone.stackShare is normalized end-of-history (look-ahead).
						// Recompute the denominator as the strongest stack KNOWN & alive at signalAt.
						let maxStackAtSignal = 0
						for (const z of poiCandidates) {
							if (z.direction !== zone.direction || z.duplicateOf != null) continue
							if (z.knownAt > s.signalAt || z.endAt <= s.signalAt) continue
							if (z.stackNotional > maxStackAtSignal) maxStackAtSignal = z.stackNotional
						}
						const causalShare = maxStackAtSignal > 0 ? zone.stackNotional / maxStackAtSignal : 1
						if (causalShare < filter.minStack) return false
						
						if (s.side === 'long' && zone.direction === 'long') return candles[s.signalIndex]!.low <= Math.max(zone.near, zone.far)
						if (s.side === 'short' && zone.direction === 'short') return candles[s.signalIndex]!.high >= Math.min(zone.near, zone.far)
						return false
					})
					return !!activeZone
				})

				const { summary } = replayArrowSignals(candles, bands, validSignals, tradeMode, { ...config, maxHoldingBars: 1000 })
				const netRStr = summary.totalNetR.toFixed(2).padStart(6)
				const winRateStr = (summary.vendorStyleWinrate * 100).toFixed(1).padStart(5)
				const pfStr = summary.profitFactor ? summary.profitFactor.toFixed(2) : 'N/A'
				console.log(`[Filter: ${filter.name.padEnd(12)}] Signals: ${String(summary.signals).padStart(4)} | Net R: ${netRStr}R | PF: ${pfStr} | Vendor WR: ${winRateStr}%`)
			}
		}
	}
}

run().catch(console.error)
