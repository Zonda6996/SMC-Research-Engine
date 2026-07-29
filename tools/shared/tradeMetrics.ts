// tradeMetrics.ts — единый судья результатов (задание 28.07.2026: вин рейт + экспектация).
//
// Зачем отдельный модуль: winRate/avgR в проекте считались инлайново в каждом инструменте
// (runBatch, runReactionAudit, portfolioBacktest) под свой срез, с разными определениями
// «победы». Для сравнения вариантов нужен ОДИН судья с ОДНИМ определением.
//
// Определение победы: ЧИСТЫЙ результат сделки после комиссий больше нуля.
// Это важно: при маленькой частичке «безубыток» (БУ) может оказаться убыточным после трения —
// такая сделка НЕ считается победой, и накрутить вин рейт микроскопической целью нельзя.
//
// Комиссии: доля цены на сделку (вход+выход, taker×2 ≈ 0.10% — модель costs §1 CONTEXT).
// Вычитаются из хода в % цены; в R переводятся через отношение цены входа к начальному риску.
import type { Candle } from '../../src/models/price/Candle.js'

export const TRADE_METRICS_VERSION = 'trade-metrics-1.0'

/** Дефолтная комиссия: 0.10% цены на сделку (taker вход + taker выход, BingX-модель). */
export const DEFAULT_COMMISSION_PCT = 0.001

export interface ClosedTrade {
	symbol: string
	pairing: string
	direction: 'long' | 'short'
	entryAt: number
	entry: number
	/** Начальный стоп (для перевода % хода в R). */
	stop: number
	outcome: 'stop' | 'be' | 'full' | 'open'
	/** Взвешенный результат в долях чистого хода цены, БЕЗ комиссий. */
	grossMovePct: number
	/** Тег варианта/конфигурации — для группировки в сетках. */
	variant?: string
}

export interface Metrics {
	trades: number
	wins: number
	losses: number
	/** Доля сделок с ЧИСТЫМ результатом > 0. */
	winRate: number
	/** Сумма чистого хода в % цены (netΣ — сопоставимо с таблицами SPEC §16.24–16.25). */
	netMovePctSum: number
	/** Средний чистый ход на сделку, в % цены. */
	netMovePctAvg: number
	/** Сумма чистого результата в R от начального риска. */
	netRSum: number
	/** Экспектация: средний чистый R на сделку. ГЛАВНОЕ ЧИСЛО. */
	netRAvg: number
	/** Средняя победа и средний проигрыш в R (проигрыш положительным числом). */
	avgWinR: number
	avgLossR: number
	/** Отношение суммы побед к сумме проигрышей. */
	profitFactor: number
	/**
	 * Вин рейт, при котором конфигурация выходит в ноль. Главный детектор блефа:
	 * если фактический вин рейт НИЖЕ этого порога — красивая цифра убыточна.
	 */
	breakevenWinRate: number
	/** Максимальная просадка кривой капитала в R (сделки по времени входа). */
	maxDrawdownR: number
	outcomes: { full: number; be: number; stop: number; open: number }
}

const EMPTY: Metrics = {
	trades: 0, wins: 0, losses: 0, winRate: 0, netMovePctSum: 0, netMovePctAvg: 0,
	netRSum: 0, netRAvg: 0, avgWinR: 0, avgLossR: 0, profitFactor: 0,
	breakevenWinRate: 0, maxDrawdownR: 0, outcomes: { full: 0, be: 0, stop: 0, open: 0 },
}

/** Чистый результат одной сделки в % хода и в R (комиссии вычтены). */
export function netOf(t: ClosedTrade, commissionPct = DEFAULT_COMMISSION_PCT): { movePct: number; r: number } {
	const movePct = t.grossMovePct - commissionPct
	const risk = Math.abs(t.entry - t.stop)
	const r = risk > 0 ? (movePct * t.entry) / risk : 0
	return { movePct, r }
}

export function computeMetrics(trades: ClosedTrade[], commissionPct = DEFAULT_COMMISSION_PCT): Metrics {
	const closed = trades.filter((t) => t.outcome !== 'open')
	if (!closed.length) return { ...EMPTY, outcomes: { ...EMPTY.outcomes } }
	const outcomes = { full: 0, be: 0, stop: 0, open: 0 }
	let netMovePctSum = 0, netRSum = 0, winSum = 0, lossSum = 0, wins = 0, losses = 0
	for (const t of closed) {
		outcomes[t.outcome]++
		const { movePct, r } = netOf(t, commissionPct)
		netMovePctSum += movePct
		netRSum += r
		if (r > 0) { wins++; winSum += r } else { losses++; lossSum += -r }
	}
	const n = closed.length
	const avgWinR = wins ? winSum / wins : 0
	const avgLossR = losses ? lossSum / losses : 0
	// Просадка по кривой капитала в R, сделки в хронологии входа.
	let peak = 0, equity = 0, maxDD = 0
	for (const t of [...closed].sort((a, b) => a.entryAt - b.entryAt)) {
		equity += netOf(t, commissionPct).r
		if (equity > peak) peak = equity
		const dd = peak - equity
		if (dd > maxDD) maxDD = dd
	}
	return {
		trades: n, wins, losses,
		winRate: wins / n,
		netMovePctSum, netMovePctAvg: netMovePctSum / n,
		netRSum, netRAvg: netRSum / n,
		avgWinR, avgLossR,
		profitFactor: lossSum > 0 ? winSum / lossSum : (winSum > 0 ? Infinity : 0),
		breakevenWinRate: avgWinR + avgLossR > 0 ? avgLossR / (avgWinR + avgLossR) : 0,
		maxDrawdownR: maxDD,
		outcomes,
	}
}

/** Разрез по произвольному ключу (монета, полугодие, месяц, связка, направление). */
export function groupMetrics<T extends ClosedTrade>(
	trades: T[], keyFn: (t: T) => string, commissionPct = DEFAULT_COMMISSION_PCT,
): Map<string, Metrics> {
	const buckets = new Map<string, T[]>()
	for (const t of trades) {
		const k = keyFn(t)
		const arr = buckets.get(k)
		if (arr) arr.push(t); else buckets.set(k, [t])
	}
	const out = new Map<string, Metrics>()
	for (const [k, v] of [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
		out.set(k, computeMetrics(v, commissionPct))
	}
	return out
}

export const halfKey = (ts: number): string => {
	const d = new Date(ts)
	return `${d.getUTCFullYear()}H${d.getUTCMonth() < 6 ? 1 : 2}`
}
export const monthKey = (ts: number): string => new Date(ts).toISOString().slice(0, 7)

/** Строка сводки для консоли. */
export function formatMetrics(m: Metrics): string {
	if (!m.trades) return 'нет сделок'
	return [
		`n=${String(m.trades).padStart(5)}`,
		`WR=${(m.winRate * 100).toFixed(1).padStart(5)}%`,
		`(БУ-порог ${(m.breakevenWinRate * 100).toFixed(1)}%)`,
		`E=${m.netRAvg >= 0 ? '+' : ''}${m.netRAvg.toFixed(3)}R`,
		`netΣ=${m.netRSum >= 0 ? '+' : ''}${m.netRSum.toFixed(1)}R`,
		`ход=${(m.netMovePctSum * 100).toFixed(0)}%`,
		`PF=${m.profitFactor === Infinity ? '∞' : m.profitFactor.toFixed(2)}`,
		`DD=${m.maxDrawdownR.toFixed(1)}R`,
		`[${m.outcomes.full}f/${m.outcomes.be}b/${m.outcomes.stop}s]`,
	].join(' ')
}

/** Проверка каузальности датасета: свечи строго по возрастанию времени, без дублей. */
export function assertCausal(candles: Candle[], label = 'series'): void {
	for (let i = 1; i < candles.length; i++) {
		if (candles[i]!.timestamp <= candles[i - 1]!.timestamp) {
			throw new Error(`${label}: нарушен порядок времени на баре ${i}`)
		}
	}
}
