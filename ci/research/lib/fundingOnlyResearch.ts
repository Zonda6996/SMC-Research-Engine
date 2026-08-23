export type FundingArm = 'CONTRARIAN' | 'CONTINUATION'
export interface FundingSettlement { timestamp: number; rate: number; markPrice: number }
export interface MarkObservation { timestamp: number; markPrice: number }
export interface FundingTrade {
	symbol: string; arm: FundingArm; direction: -1 | 1; decisionAt: number; entryAt: number; exitSettlementAt: number; exitAt: number
	entryMark: number; exitMark: number; decisionRate: number; exitFundingRate: number; holdingMs: number
	priceReturn: number; fundingReturn: number; feeReturn: number; netReturn: number
}
export interface QaAudit { inputRows: number; uniqueRows: number; duplicateRows: number; conflictingDuplicates: number; invalidRows: number; intervalsMs: Record<string, number> }

export function auditSettlements(rows: readonly FundingSettlement[]): { rows: FundingSettlement[]; audit: QaAudit } {
	const byTime = new Map<number, FundingSettlement>(); let duplicateRows = 0; let conflictingDuplicates = 0; let invalidRows = 0
	for (const row of rows) {
		if (!Number.isSafeInteger(row.timestamp) || !Number.isFinite(row.rate) || !Number.isFinite(row.markPrice) || row.markPrice <= 0) { invalidRows++; continue }
		const previous = byTime.get(row.timestamp)
		if (previous) { duplicateRows++; if (previous.rate !== row.rate || previous.markPrice !== row.markPrice) conflictingDuplicates++ }
		else byTime.set(row.timestamp, { ...row })
	}
	const clean = [...byTime.values()].sort((a, b) => a.timestamp - b.timestamp)
	const intervalsMs: Record<string, number> = {}
	for (let i = 1; i < clean.length; i++) { const key = String(clean[i]!.timestamp - clean[i - 1]!.timestamp); intervalsMs[key] = (intervalsMs[key] ?? 0) + 1 }
	return { rows: clean, audit: { inputRows: rows.length, uniqueRows: clean.length, duplicateRows, conflictingDuplicates, invalidRows, intervalsMs } }
}

function firstStrictlyAfter(rows: readonly MarkObservation[], timestamp: number): MarkObservation | null {
	let lo = 0; let hi = rows.length
	while (lo < hi) { const mid = (lo + hi) >>> 1; if (rows[mid]!.timestamp <= timestamp) lo = mid + 1; else hi = mid }
	return rows[lo] ?? null
}

export function replayFundingOnly(symbol: string, settlementsInput: readonly FundingSettlement[], marksInput: readonly MarkObservation[], arm: FundingArm, oneWayCostBps: number): FundingTrade[] {
	const settlements = auditSettlements(settlementsInput).rows
	const marks = [...marksInput].filter((x) => Number.isSafeInteger(x.timestamp) && Number.isFinite(x.markPrice) && x.markPrice > 0).sort((a, b) => a.timestamp - b.timestamp)
	const trades: FundingTrade[] = []
	for (let i = 0; i + 1 < settlements.length; i++) {
		const decision = settlements[i]!; const exitSettlement = settlements[i + 1]!
		if (decision.rate === 0) continue
		const contrarian = decision.rate > 0 ? -1 : 1
		const direction = (arm === 'CONTRARIAN' ? contrarian : -contrarian) as -1 | 1
		const entry = firstStrictlyAfter(marks, decision.timestamp); const exit = firstStrictlyAfter(marks, exitSettlement.timestamp)
		if (!entry || !exit || entry.timestamp >= exitSettlement.timestamp || exit.timestamp <= exitSettlement.timestamp) continue
		const priceReturn = direction * (exit.markPrice / entry.markPrice - 1)
		const fundingReturn = -direction * exitSettlement.rate
		const feeReturn = 2 * oneWayCostBps / 10_000
		trades.push({ symbol, arm, direction, decisionAt: decision.timestamp, entryAt: entry.timestamp, exitSettlementAt: exitSettlement.timestamp, exitAt: exit.timestamp, entryMark: entry.markPrice, exitMark: exit.markPrice, decisionRate: decision.rate, exitFundingRate: exitSettlement.rate, holdingMs: exit.timestamp - entry.timestamp, priceReturn, fundingReturn, feeReturn, netReturn: priceReturn + fundingReturn - feeReturn })
	}
	return trades
}

export function calendarSplitCutoff(timesBySymbol: Readonly<Record<string, readonly number[]>>, trainFraction: number): number {
	if (!(trainFraction > 0 && trainFraction < 1)) throw new Error('trainFraction must be between zero and one')
	const pooled = Object.values(timesBySymbol).flat().sort((a, b) => a - b)
	if (!pooled.length) throw new Error('No event times')
	return pooled[Math.min(pooled.length - 1, Math.ceil(pooled.length * trainFraction) - 1)]!
}

export interface Metrics { trades: number; mean: number; bpsPerTrade: number; totalFixedNotional: number; continuousEquity: number; profitFactor: number | null; winRate: number; maxDrawdown: number; meanHoldingHours: number; priceMean: number; fundingMean: number; feeMean: number }
export function summarizeFundingTrades(trades: readonly FundingTrade[]): Metrics {
	const n = trades.length; if (!n) return { trades: 0, mean: 0, bpsPerTrade: 0, totalFixedNotional: 0, continuousEquity: 1, profitFactor: null, winRate: 0, maxDrawdown: 0, meanHoldingHours: 0, priceMean: 0, fundingMean: 0, feeMean: 0 }
	let sum = 0, price = 0, funding = 0, fees = 0, wins = 0, positive = 0, negative = 0, equity = 0, peak = 0, maxDrawdown = 0, logEquity = 0, holding = 0
	for (const t of trades) { sum += t.netReturn; price += t.priceReturn; funding += t.fundingReturn; fees += t.feeReturn; holding += t.holdingMs; if (t.netReturn > 0) { wins++; positive += t.netReturn } else negative -= t.netReturn; equity += t.netReturn; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak - equity); logEquity += t.netReturn > -1 ? Math.log1p(t.netReturn) : -Infinity }
	return { trades: n, mean: sum / n, bpsPerTrade: sum / n * 10_000, totalFixedNotional: sum, continuousEquity: Math.exp(logEquity), profitFactor: negative > 0 ? positive / negative : null, winRate: wins / n, maxDrawdown, meanHoldingHours: holding / n / 3_600_000, priceMean: price / n, fundingMean: funding / n, feeMean: fees / n }
}

export function equalSymbolMean(trades: readonly FundingTrade[], symbols: readonly string[]): number {
	return symbols.reduce((sum, symbol) => { const x = trades.filter((t) => t.symbol === symbol); return sum + (x.length ? x.reduce((a, t) => a + t.netReturn, 0) / x.length : 0) }, 0) / symbols.length
}

function rng(seed: number): () => number { let x = seed >>> 0; return () => { x += 0x6d2b79f5; let t = x; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4_294_967_296 } }
export function clusterBootstrap(trades: readonly FundingTrade[], symbols: readonly string[], samples: number, seed: number, metric: (rows: readonly FundingTrade[]) => number = (rows) => equalSymbolMean(rows, symbols)): { lower: number; median: number; upper: number } {
	const groups = new Map<string, FundingTrade[]>(); for (const t of trades) { const day = new Date(t.decisionAt).toISOString().slice(0, 10); const group = groups.get(day) ?? []; group.push(t); groups.set(day, group) }
	const days = [...groups.keys()].sort(); if (!days.length) return { lower: 0, median: 0, upper: 0 }
	const random = rng(seed); const values: number[] = []
	for (let s = 0; s < samples; s++) { const draw: FundingTrade[] = []; for (let i = 0; i < days.length; i++) draw.push(...groups.get(days[Math.floor(random() * days.length)]!)!); values.push(metric(draw)) }
	values.sort((a, b) => a - b); const q = (p: number) => values[Math.min(values.length - 1, Math.floor(p * values.length))]!
	return { lower: q(0.025), median: q(0.5), upper: q(0.975) }
}
