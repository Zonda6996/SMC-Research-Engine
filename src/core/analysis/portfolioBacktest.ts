import type { Candle } from '@/models/price/Candle.js'
import type { FibSetupOutcome } from '@/models/fib/FibLifecycle.js'
import { netBeR } from '@/core/fib/fibCosts.js'

export interface PortfolioTrade {
	id: string
	symbol: string
	timeframe: string
	scenario: string
	direction: 'long' | 'short'
	entryAt: number
	exitAt: number
	netR: number
}

export interface PortfolioConfig {
	initialEquity: number
	riskPct: number
	maxRiskPct: number
	mcRuns: number
	seed: number
}

export interface PortfolioLedgerRow extends PortfolioTrade {
	status: 'accepted' | 'capacity-rejected'
	equityBefore: number
	equityAfter: number
	pnl: number
	openRiskPct: number
}

export interface PortfolioSummary {
	initialEquity: number
	finalEquity: number
	netReturnPct: number
	totalR: number
	expectancyR: number | null
	winRate: number | null
	profitFactor: number | null
	maxDrawdownPct: number
	maxDrawdownAmount: number
	maxDrawdownR: number
	drawdownPeakAt: number | null
	drawdownTroughAt: number | null
	recoveryFactor: number | null
	maxLosingStreak: number
	maxConcurrent: number
	maxOpenRiskPct: number
	accepted: number
	capacityRejected: number
}

export interface EquityPoint { at: number; equity: number; drawdownPct: number }
export interface BreakdownRow { dimension: 'symbol' | 'scenario' | 'direction'; key: string; trades: number; totalR: number; expectancyR: number; winRate: number }
export interface MonthlyRow { month: string; trades: number; totalR: number; pnl: number; returnPct: number }
export interface MonteCarloSummary { runs: number; seed: number; finalReturnPct: { p05: number; median: number; p95: number }; maxDrawdownPct: { p05: number; median: number; p95: number } }
export interface PortfolioResult { summary: PortfolioSummary; ledger: PortfolioLedgerRow[]; equity: EquityPoint[]; monthly: MonthlyRow[]; breakdown: BreakdownRow[]; monteCarlo: MonteCarloSummary | null }

export const DEFAULT_PORTFOLIO_CONFIG: PortfolioConfig = { initialEquity: 10_000, riskPct: 1, maxRiskPct: 3, mcRuns: 2_000, seed: 42 }

export function outcomeToPortfolioTrade(symbol: string, timeframe: string, candles: Candle[], outcome: FibSetupOutcome): PortfolioTrade | null {
	const netR = netBeR(outcome)
	if (netR == null || outcome.entryIndex == null) return null
	const entry = candles[outcome.entryIndex]
	const exitIndex = outcome.beIndex
		?? (outcome.state === 'stopped'
			? outcome.stopIndex
			: outcome.state === 'tp2'
					? outcome.tp2Index
					: outcome.state === 'timed-out'
						? outcome.timeStopIndex
						: outcome.tp1Index)
	if (!entry || exitIndex == null || !candles[exitIndex]) return null
	return {
		id: `${symbol}|${timeframe}|${outcome.scenario}|${outcome.candidateId}|${outcome.entryIndex}`,
		symbol,
		timeframe,
		scenario: outcome.scenario,
		direction: outcome.direction,
		entryAt: entry.timestamp,
		exitAt: candles[exitIndex]!.timestamp,
		netR,
	}
}

function tradeOrder(a: PortfolioTrade, b: PortfolioTrade): number {
	return a.entryAt - b.entryAt || a.symbol.localeCompare(b.symbol) || a.timeframe.localeCompare(b.timeframe) || a.scenario.localeCompare(b.scenario) || a.id.localeCompare(b.id)
}

/**
 * Жёсткая дедупликация по id: одна экономическая сделка не может дважды
 * менять equity и дважды занимать risk-slot. Дубли возникают, когда local-
 * и global-варианты одной сетки дают одинаковый вход (одинаковый id).
 */
export function dedupePortfolioTrades(input: PortfolioTrade[]): PortfolioTrade[] {
	const seen = new Set<string>()
	const result: PortfolioTrade[] = []
	for (const trade of input) {
		if (seen.has(trade.id)) continue
		seen.add(trade.id)
		result.push(trade)
	}
	return result
}

export function runPortfolioBacktest(input: PortfolioTrade[], partial: Partial<PortfolioConfig> = {}): PortfolioResult {
	const config = { ...DEFAULT_PORTFOLIO_CONFIG, ...partial }
	if (config.initialEquity <= 0 || config.riskPct <= 0 || config.maxRiskPct < config.riskPct) throw new Error('Invalid portfolio risk configuration')
	const trades = dedupePortfolioTrades([...input].sort(tradeOrder))
	const active: { trade: PortfolioTrade; riskPct: number; riskAmount: number; row: PortfolioLedgerRow }[] = []
	const ledger: PortfolioLedgerRow[] = []
	const equity: EquityPoint[] = [{ at: trades[0]?.entryAt ?? 0, equity: config.initialEquity, drawdownPct: 0 }]
	let balance = config.initialEquity
	let peak = balance
	let peakAt: number | null = null
	let maxDdPct = 0, maxDdAmount = 0, ddPeakAt: number | null = null, ddTroughAt: number | null = null
	let maxConcurrent = 0, maxOpenRiskPct = 0
	const closeThrough = (at: number) => {
		const closing = active.filter((p) => p.trade.exitAt <= at).sort((a, b) => a.trade.exitAt - b.trade.exitAt || tradeOrder(a.trade, b.trade))
		for (const position of closing) {
			const pnl = position.riskAmount * position.trade.netR
			balance += pnl
			position.row.pnl = pnl
			position.row.equityAfter = balance
			if (balance >= peak) { peak = balance; peakAt = position.trade.exitAt }
			const ddAmount = peak - balance
			const ddPct = peak > 0 ? ddAmount / peak * 100 : 0
			if (ddPct > maxDdPct) { maxDdPct = ddPct; maxDdAmount = ddAmount; ddPeakAt = peakAt; ddTroughAt = position.trade.exitAt }
			equity.push({ at: position.trade.exitAt, equity: balance, drawdownPct: ddPct })
			active.splice(active.indexOf(position), 1)
		}
	}

	for (const trade of trades) {
		closeThrough(trade.entryAt)
		const openRiskPct = active.reduce((sum, p) => sum + p.riskPct, 0)
		const before = balance
		if (openRiskPct + config.riskPct > config.maxRiskPct + 1e-9) {
			ledger.push({ ...trade, status: 'capacity-rejected', equityBefore: before, equityAfter: before, pnl: 0, openRiskPct })
			continue
		}
		const row: PortfolioLedgerRow = { ...trade, status: 'accepted', equityBefore: before, equityAfter: before, pnl: 0, openRiskPct: openRiskPct + config.riskPct }
		ledger.push(row)
		active.push({ trade, riskPct: config.riskPct, riskAmount: balance * config.riskPct / 100, row })
		maxConcurrent = Math.max(maxConcurrent, active.length)
		maxOpenRiskPct = Math.max(maxOpenRiskPct, openRiskPct + config.riskPct)
	}
	closeThrough(Number.POSITIVE_INFINITY)
	const accepted = ledger.filter((r) => r.status === 'accepted')
	const rs = accepted.map((r) => r.netR)
	const wins = rs.filter((r) => r > 0)
	const losses = rs.filter((r) => r < 0)
	const totalR = rs.reduce((a, b) => a + b, 0)
	const grossWin = wins.reduce((a, b) => a + b, 0)
	const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0))
	let streak = 0, maxLosingStreak = 0
	for (const r of rs) { streak = r < 0 ? streak + 1 : 0; maxLosingStreak = Math.max(maxLosingStreak, streak) }
	const netProfit = balance - config.initialEquity
	const summary: PortfolioSummary = {
		initialEquity: config.initialEquity, finalEquity: balance, netReturnPct: netProfit / config.initialEquity * 100,
		totalR, expectancyR: rs.length ? totalR / rs.length : null, winRate: rs.length ? wins.length / rs.length : null,
		profitFactor: grossLoss ? grossWin / grossLoss : grossWin > 0 ? Number.POSITIVE_INFINITY : null,
		maxDrawdownPct: maxDdPct, maxDrawdownAmount: maxDdAmount, maxDrawdownR: maxDdAmount / (config.initialEquity * config.riskPct / 100),
		drawdownPeakAt: ddPeakAt, drawdownTroughAt: ddTroughAt,
		recoveryFactor: maxDdAmount ? netProfit / maxDdAmount : null, maxLosingStreak, maxConcurrent, maxOpenRiskPct,
		accepted: accepted.length, capacityRejected: ledger.length - accepted.length,
	}
	return { summary, ledger, equity, monthly: monthlyRows(accepted), breakdown: breakdownRows(accepted), monteCarlo: config.mcRuns > 0 && rs.length ? monteCarlo(rs, config) : null }
}

function monthlyRows(rows: PortfolioLedgerRow[]): MonthlyRow[] {
	const groups = new Map<string, PortfolioLedgerRow[]>()
	for (const r of rows) { const key = new Date(r.exitAt).toISOString().slice(0, 7); groups.set(key, [...(groups.get(key) ?? []), r]) }
	return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, xs]) => ({ month, trades: xs.length, totalR: xs.reduce((s, x) => s + x.netR, 0), pnl: xs.reduce((s, x) => s + x.pnl, 0), returnPct: xs[0]!.equityBefore ? xs.reduce((s, x) => s + x.pnl, 0) / xs[0]!.equityBefore * 100 : 0 }))
}

function breakdownRows(rows: PortfolioLedgerRow[]): BreakdownRow[] {
	const result: BreakdownRow[] = []
	for (const dimension of ['symbol', 'scenario', 'direction'] as const) {
		const groups = new Map<string, PortfolioLedgerRow[]>()
		for (const r of rows) { const key = r[dimension]; groups.set(key, [...(groups.get(key) ?? []), r]) }
		for (const [key, xs] of groups) { const totalR = xs.reduce((s, x) => s + x.netR, 0); result.push({ dimension, key, trades: xs.length, totalR, expectancyR: totalR / xs.length, winRate: xs.filter((x) => x.netR > 0).length / xs.length }) }
	}
	return result
}

function mulberry32(seed: number): () => number { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }
function percentile(values: number[], p: number): number { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]! }
function monteCarlo(rs: number[], c: PortfolioConfig): MonteCarloSummary {
	const random = mulberry32(c.seed), returns: number[] = [], dds: number[] = []
	for (let run = 0; run < c.mcRuns; run++) { let eq = c.initialEquity, peak = eq, maxDd = 0; for (let i = 0; i < rs.length; i++) { const r = rs[Math.floor(random() * rs.length)]!; eq += eq * c.riskPct / 100 * r; peak = Math.max(peak, eq); maxDd = Math.max(maxDd, (peak - eq) / peak * 100) } returns.push((eq / c.initialEquity - 1) * 100); dds.push(maxDd) }
	return { runs: c.mcRuns, seed: c.seed, finalReturnPct: { p05: percentile(returns, .05), median: percentile(returns, .5), p95: percentile(returns, .95) }, maxDrawdownPct: { p05: percentile(dds, .05), median: percentile(dds, .5), p95: percentile(dds, .95) } }
}
