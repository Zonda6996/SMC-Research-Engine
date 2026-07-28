import assert from 'node:assert/strict'
import { it } from 'node:test'
import {
	computeMetrics, groupMetrics, netOf, halfKey, monthKey, assertCausal,
	TRADE_METRICS_VERSION, DEFAULT_COMMISSION_PCT, type ClosedTrade,
} from '../tools/shared/tradeMetrics.js'

const t = (o: Partial<ClosedTrade> = {}): ClosedTrade => ({
	symbol: 'BTC', pairing: '1h→15m', direction: 'long',
	entryAt: Date.UTC(2025, 0, 1), entry: 100, stop: 90, outcome: 'be', grossMovePct: 0.02,
	...o,
})

it('tradeMetrics: победа считается по ЧИСТОМУ результату после комиссий', () => {
	assert.equal(TRADE_METRICS_VERSION, 'trade-metrics-1.0')
	// ход +0.2% при комиссии 0.10% → чистые +0.1% → победа
	const win = computeMetrics([t({ grossMovePct: 0.002 })])
	assert.equal(win.wins, 1)
	assert.equal(win.winRate, 1)
	// ход +0.05% при той же комиссии → чистые −0.05% → НЕ победа (защита от накрутки WR)
	const fake = computeMetrics([t({ grossMovePct: 0.0005 })])
	assert.equal(fake.wins, 0)
	assert.equal(fake.winRate, 0)
})

it('tradeMetrics: перевод хода в R идёт от начального риска; комиссия вычитается один раз', () => {
	// риск = |100 − 90| = 10 = 10% цены; ход 2% − комиссия 0.1% = 1.9% → 0.19R
	const { movePct, r } = netOf(t({ grossMovePct: 0.02 }))
	assert.ok(Math.abs(movePct - 0.019) < 1e-12)
	assert.ok(Math.abs(r - 0.19) < 1e-12)
	// нулевой риск не роняет расчёт
	assert.equal(netOf(t({ stop: 100 })).r, 0)
})

it('tradeMetrics: безубыточный вин рейт — детектор красивой, но убыточной настройки', () => {
	// 3 победы по +0.1R и 1 проигрыш −1R: WR 75%, но порог безубыточности 1/(1+0.1) ≈ 90.9%
	const trades = [
		t({ grossMovePct: 0.002 }), t({ grossMovePct: 0.002 }), t({ grossMovePct: 0.002 }),
		t({ grossMovePct: -0.1, outcome: 'stop' }),
	]
	const m = computeMetrics(trades)
	assert.equal(m.trades, 4)
	assert.ok(Math.abs(m.winRate - 0.75) < 1e-12)
	assert.ok(m.breakevenWinRate > m.winRate, 'порог безубыточности должен быть выше фактического WR')
	assert.ok(m.netRAvg < 0, 'при WR 75% результат отрицательный — это и есть ловушка')
})

it('tradeMetrics: незакрытые сделки не считаются, просадка и профит-фактор считаются', () => {
	const m = computeMetrics([
		t({ outcome: 'full', grossMovePct: 0.05, entryAt: 1 }),
		t({ outcome: 'stop', grossMovePct: -0.1, entryAt: 2 }),
		t({ outcome: 'open', grossMovePct: 0.5, entryAt: 3 }),
	])
	assert.equal(m.trades, 2)
	assert.equal(m.outcomes.open, 0)
	assert.equal(m.outcomes.full, 1)
	assert.equal(m.outcomes.stop, 1)
	assert.ok(m.maxDrawdownR > 0)
	assert.ok(m.profitFactor > 0 && m.profitFactor < 1)
	assert.deepEqual(computeMetrics([]).trades, 0)
})

it('tradeMetrics: разрезы по ключу и календарные ключи', () => {
	const g = groupMetrics([t({ symbol: 'BTC' }), t({ symbol: 'ETH' }), t({ symbol: 'ETH' })], (x) => x.symbol)
	assert.deepEqual([...g.keys()], ['BTC', 'ETH'])
	assert.equal(g.get('ETH')!.trades, 2)
	assert.equal(halfKey(Date.UTC(2025, 0, 5)), '2025H1')
	assert.equal(halfKey(Date.UTC(2025, 8, 5)), '2025H2')
	assert.equal(monthKey(Date.UTC(2025, 8, 5)), '2025-09')
	assert.equal(DEFAULT_COMMISSION_PCT, 0.001)
})

it('tradeMetrics: контроль каузальности ряда свечей', () => {
	const c = (ts: number) => ({ timestamp: ts, open: 1, high: 1, low: 1, close: 1, volume: 1 })
	assert.doesNotThrow(() => assertCausal([c(1), c(2), c(3)]))
	assert.throws(() => assertCausal([c(1), c(1)]), /нарушен порядок/)
})
