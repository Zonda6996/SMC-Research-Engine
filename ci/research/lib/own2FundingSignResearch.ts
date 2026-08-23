import type { ArrowSide, ArrowSignal } from '../../../src/core/signals/ArrowSignalEngine.js'
import type { ArrowTrade } from '../../../src/core/signals/ArrowTradeReplay.js'

export interface SettledFunding { timestamp: number; rate: number; markPrice: number }
export type FundingDecision = 'retain' | 'veto-zero' | 'veto-missing' | 'veto-sign'
export interface FundingSignDecision {
	decision: FundingDecision
	settlement: SettledFunding | null
	ageMs: number | null
}

/** Latest real settlement strictly before decision time. Exact-boundary data is unavailable. */
export function latestSettledFundingStrictlyBefore(rows: readonly SettledFunding[], decisionAt: number): SettledFunding | null {
	let lo = 0
	let hi = rows.length
	while (lo < hi) {
		const mid = (lo + hi) >>> 1
		if (rows[mid]!.timestamp < decisionAt) lo = mid + 1
		else hi = mid
	}
	return lo > 0 ? rows[lo - 1]! : null
}

export function decideFundingSign(side: ArrowSide, decisionAt: number, rows: readonly SettledFunding[]): FundingSignDecision {
	const settlement = latestSettledFundingStrictlyBefore(rows, decisionAt)
	if (settlement == null) return { decision: 'veto-missing', settlement: null, ageMs: null }
	if (settlement.rate === 0) return { decision: 'veto-zero', settlement, ageMs: decisionAt - settlement.timestamp }
	const retain = side === 'long' ? settlement.rate < 0 : settlement.rate > 0
	return { decision: retain ? 'retain' : 'veto-sign', settlement, ageMs: decisionAt - settlement.timestamp }
}

export function filterFundingSignSignals(signals: readonly ArrowSignal[], rows: readonly SettledFunding[]): {
	retained: ArrowSignal[]
	decisions: Array<{ signal: ArrowSignal; funding: FundingSignDecision }>
} {
	const decisions = signals.map((signal) => ({ signal, funding: decideFundingSign(signal.side, signal.signalAt, rows) }))
	return { retained: decisions.filter((x) => x.funding.decision === 'retain').map((x) => x.signal), decisions }
}

/** Quote-currency cashflow for one settlement. Positive means received by the position. */
export function directionAwareFundingCashflow(side: ArrowSide, rate: number, markPrice: number, positionUnits: number): number {
	const direction = side === 'long' ? 1 : -1
	return -direction * rate * markPrice * positionUnits
}

/**
 * Funding contribution in the same R unit as the canonical ArrowTrade.
 * Position state follows actual entry/add/partial events. A settlement counts when
 * entryAt <= timestamp < exitAt; no synthetic settlements are created.
 */
export function fundingContributionR(trade: ArrowTrade, rows: readonly SettledFunding[]): number {
	if (trade.exitAt == null) return 0
	const oneR = Math.abs((trade.entry + trade.add) / 2 - trade.stop) * 2
	if (!(oneR > 0)) return 0
	let total = 0
	for (const row of rows) {
		if (row.timestamp < trade.entryAt || row.timestamp >= trade.exitAt) continue
		let units = 1
		for (const event of trade.events) {
			if (event.at > row.timestamp) break
			if (event.type === 'add') units += 1
			else if (event.type === 'partial') units *= 0.75
		}
		total += directionAwareFundingCashflow(trade.side, row.rate, row.markPrice, units)
	}
	return total / oneR
}

export interface PairedOpportunity {
	symbol: string
	timeframe: string
	decisionAt: number
	baselineNetR: number
	filteredNetR: number
	retained: boolean
}

export function meanPerBaselineOpportunity(rows: readonly PairedOpportunity[], arm: 'baseline' | 'filtered'): number {
	if (!rows.length) return 0
	return rows.reduce((sum, row) => sum + (arm === 'baseline' ? row.baselineNetR : row.filteredNetR), 0) / rows.length
}

export function pairedDeltaPerBaselineOpportunity(rows: readonly PairedOpportunity[]): number {
	if (!rows.length) return 0
	return rows.reduce((sum, row) => sum + row.filteredNetR - row.baselineNetR, 0) / rows.length
}

function rng(seed: number): () => number {
	let x = seed >>> 0
	return () => {
		x += 0x6d2b79f5
		let t = x
		t = Math.imul(t ^ t >>> 15, t | 1)
		t ^= t + Math.imul(t ^ t >>> 7, t | 61)
		return ((t ^ t >>> 14) >>> 0) / 4_294_967_296
	}
}

export function pairedUtcDayClusterBootstrap(rows: readonly PairedOpportunity[], samples: number, seed: number): { lower: number; median: number; upper: number } {
	const groups = new Map<string, PairedOpportunity[]>()
	for (const row of rows) {
		const day = new Date(row.decisionAt).toISOString().slice(0, 10)
		const group = groups.get(day) ?? []
		group.push(row)
		groups.set(day, group)
	}
	const days = [...groups.keys()].sort()
	if (!days.length) return { lower: 0, median: 0, upper: 0 }
	const random = rng(seed)
	const values: number[] = []
	for (let sample = 0; sample < samples; sample++) {
		const draw: PairedOpportunity[] = []
		for (let i = 0; i < days.length; i++) draw.push(...groups.get(days[Math.floor(random() * days.length)]!)!)
		values.push(pairedDeltaPerBaselineOpportunity(draw))
	}
	values.sort((a, b) => a - b)
	const q = (p: number): number => values[Math.min(values.length - 1, Math.floor(p * values.length))]!
	return { lower: q(0.025), median: q(0.5), upper: q(0.975) }
}
