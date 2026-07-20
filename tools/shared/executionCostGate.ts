import { BINGX_MAKER_RATE, BINGX_SLIP_RATE, BINGX_TAKER_RATE } from '../../src/core/analysis/entryModels.js'
import { fillCostR } from '../../src/core/analysis/takeLadders.js'

/** Полный плановый stop в R известен до выставления resting limit. */
export function plannedFullStop(entry: number, stop: number): { stopPct: number; costR: number; netR: number } {
	const risk = Math.abs(entry - stop)
	if (!(risk > 0) || !(entry > 0) || !(stop > 0)) {
		return { stopPct: 0, costR: Number.POSITIVE_INFINITY, netR: Number.NEGATIVE_INFINITY }
	}
	const costR = fillCostR(entry, BINGX_MAKER_RATE, 1, risk) +
		fillCostR(stop, BINGX_TAKER_RATE + BINGX_SLIP_RATE, 1, risk)
	return { stopPct: 100 * risk / entry, costR, netR: -1 - costR }
}
