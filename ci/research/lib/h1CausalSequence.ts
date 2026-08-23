import type { ExactIndicatorRow } from './exactIndicatorExport.js'

export type H1Side = 'buy' | 'sell'
export interface H1FeatureRow extends Omit<ExactIndicatorRow, 'buy' | 'sell'> {}
export interface H1Pivot { side: 'low' | 'high'; price: number; pivotAt: number; knownAt: number; sweptAt: number | null }
export interface H1Config {
	left: number
	right: number
	protectionWindow: number
	requireRebound: boolean
	relVolMin: number
}
export interface H1SequenceEvent {
	side: H1Side
	at: number
	anchorPrice: number
	anchorPivotAt: number
	anchorKnownAt: number
	sweepAt: number
	reclaimAt: number
	protectionPrice: number
	protectionPivotAt: number
	protectionKnownAt: number
	protectionAt: number
	reboundAt: number | null
	relVol: number
}
export interface H1Detection {
	pivots: H1Pivot[]
	sweeps: number
	reclaims: number
	protections: number
	events: H1SequenceEvent[]
}

interface Pending {
	side: H1Side
	anchor: H1Pivot
	protection: H1Pivot
	sweepAt: number
	reclaimAt: number | null
	reboundAt: number | null
}

const REL_VOL_PERIOD = 20
function relativeVolume(rows: readonly H1FeatureRow[], index: number): number {
	if (index < REL_VOL_PERIOD) return 0
	let sum = 0
	for (let i = index - REL_VOL_PERIOD; i < index; i++) sum += rows[i]!.volume
	return sum > 0 ? rows[index]!.volume / (sum / REL_VOL_PERIOD) : 0
}
function isPivot(rows: readonly H1FeatureRow[], at: number, left: number, right: number, side: 'low' | 'high'): boolean {
	if (at - left < 0 || at + right >= rows.length) return false
	const price = side === 'low' ? rows[at]!.low : rows[at]!.high
	for (let i = at - left; i <= at + right; i++) {
		if (i === at) continue
		const other = side === 'low' ? rows[i]!.low : rows[i]!.high
		if (side === 'low' ? other <= price : other >= price) return false
	}
	return true
}
function latestUnswept(pivots: readonly H1Pivot[], side: 'low' | 'high', knownAt: number): H1Pivot | null {
	for (let i = pivots.length - 1; i >= 0; i--) {
		const pivot = pivots[i]!
		if (pivot.side === side && pivot.knownAt <= knownAt && pivot.sweptAt == null) return pivot
	}
	return null
}

/** Pure feature detector. Rows deliberately have no vendor label fields. */
export function detectH1Sequences(rows: readonly H1FeatureRow[], config: H1Config): H1Detection {
	const pivots: H1Pivot[] = []
	const pending: Record<H1Side, Pending | null> = { buy: null, sell: null }
	const events: H1SequenceEvent[] = []
	let sweeps = 0
	let reclaims = 0
	let protections = 0
	for (let i = 0; i < rows.length; i++) {
		const pivotAt = i - config.right
		for (const side of ['low', 'high'] as const) {
			if (isPivot(rows, pivotAt, config.left, config.right, side)) {
				pivots.push({ side, price: side === 'low' ? rows[pivotAt]!.low : rows[pivotAt]!.high, pivotAt, knownAt: i, sweptAt: null })
			}
		}
		const row = rows[i]!
		for (const side of ['buy', 'sell'] as const) {
			const p = pending[side]
			if (!p) continue
			if (i - p.sweepAt > config.protectionWindow) { pending[side] = null; continue }
			if (p.reclaimAt == null) {
				const reclaimed = side === 'buy' ? row.close > p.anchor.price : row.close < p.anchor.price
				if (reclaimed) { p.reclaimAt = i; reclaims++ }
				else continue
			}
			if (config.requireRebound && p.reboundAt == null && i > p.reclaimAt) {
				const prior = rows[i - 1]!
				if (side === 'buy' ? row.close > prior.close : row.close < prior.close) p.reboundAt = i
				else continue
			}
			if (config.requireRebound && p.reboundAt == null) continue
			const crossed = side === 'buy' ? row.close > p.protection.price : row.close < p.protection.price
			const rv = relativeVolume(rows, i)
			if (crossed && i > p.reclaimAt && rv >= config.relVolMin) {
				protections++
				events.push({ side, at: i, anchorPrice: p.anchor.price, anchorPivotAt: p.anchor.pivotAt, anchorKnownAt: p.anchor.knownAt, sweepAt: p.sweepAt, reclaimAt: p.reclaimAt, protectionPrice: p.protection.price, protectionPivotAt: p.protection.pivotAt, protectionKnownAt: p.protection.knownAt, protectionAt: i, reboundAt: p.reboundAt, relVol: rv })
				pending[side] = null
			}
		}
		// An anchor confirmed by this same closing bar is not eligible until the next bar.
		const lowAnchor = latestUnswept(pivots, 'low', i - 1)
		const highAnchor = latestUnswept(pivots, 'high', i - 1)
		if (lowAnchor && highAnchor && row.low < lowAnchor.price) {
			lowAnchor.sweptAt = i; sweeps++
			pending.buy = { side: 'buy', anchor: lowAnchor, protection: highAnchor, sweepAt: i, reclaimAt: row.close > lowAnchor.price ? i : null, reboundAt: null }
			if (pending.buy.reclaimAt != null) reclaims++
		}
		if (highAnchor && lowAnchor && row.high > highAnchor.price) {
			highAnchor.sweptAt = i; sweeps++
			pending.sell = { side: 'sell', anchor: highAnchor, protection: lowAnchor, sweepAt: i, reclaimAt: row.close < highAnchor.price ? i : null, reboundAt: null }
			if (pending.sell.reclaimAt != null) reclaims++
		}
	}
	return { pivots, sweeps, reclaims, protections, events }
}

export function stripH1Labels(rows: readonly ExactIndicatorRow[]): H1FeatureRow[] {
	return rows.map(({ buy: _buy, sell: _sell, ...feature }) => feature)
}
