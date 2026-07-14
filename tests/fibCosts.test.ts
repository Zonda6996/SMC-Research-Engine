// fibCosts.test.ts
//
// Ручной расчёт net R для win/loss/BE-кейсов: удобные числа
// (вход 100, риск 10, rTp1 = 2, rTp2 = 4), ставки из констант модуля:
// FEE_RATE = 0.0005 за сторону, SLIP_RATE = 0.0002 на рыночные филлы.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { netFullR, netBeR, FEE_RATE, SLIP_RATE } from '@/core/fib/fibCosts.js'
import type { FibSetupOutcome } from '@/models/fib/FibLifecycle.js'

/** Заполненный outcome с переопределяемыми полями. */
function makeOutcome(overrides: Partial<FibSetupOutcome>): FibSetupOutcome {
	return {
		candidateId: 'test',
		variantMode: 'local',
		scenario: 'ote',
		stopMode: 'zero',
		trigger: 'bos',
		direction: 'long',
		legAtrRatio: 5,
		oppositeSweptBefore: false,
		createdAtIndex: 0,
		entered: true,
		entryIndex: 1,
		entryPrice: 100,
		stopPrice: 90,
		riskSize: 10,
		state: 'tp2',
		tp1Hit: true,
		tp1Index: 2,
		tp2Hit: true,
		tp2Index: 3,
		stopIndex: null,
		rTp1: 2,
		rTp2: 4,
		rStop: -1,
		exposure: 1,
		beAfterTp1: false,
		beIndex: null,
		timeStopIndex: null,
		timeStopPrice: null,
		timeStopR: null,
		mfeR: 4,
		maeR: 0,
		maxExtensionRatio: null,
		tpAfterStop: null,
		barsToEntry: 1,
		barsToResolve: 2,
		...overrides,
	}
}

const close = (actual: number | null, expected: number) => {
	assert.ok(actual != null, 'ожидалось число, получен null')
	assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} !== ${expected}`)
}

describe('fibCosts', () => {
	// Вход 100 (fee+slip = 0.0007), риск 10.
	// TP1 = 100 + 2×10 = 120, TP2 = 140, стоп 90.

	it('netFullR: win = rTp1 минус вход (fee+slip) и лимитный TP1-выход (fee)', () => {
		// 2 − (100×0.0007 + 120×0.0005)/10 = 2 − 0.013 = 1.987
		close(netFullR(makeOutcome({})), 2 - (100 * (FEE_RATE + SLIP_RATE) + 120 * FEE_RATE) / 10)
		close(netFullR(makeOutcome({})), 1.987)
	})

	it('netFullR: loss = −1 минус вход и стоп (оба fee+slip)', () => {
		const loss = makeOutcome({ state: 'stopped', tp1Hit: false, tp2Hit: false, stopIndex: 2 })
		// −1 − (100×0.0007 + 90×0.0007)/10 = −1 − 0.0133 = −1.0133
		close(netFullR(loss), -1.0133)
	})

	it('netBeR: TP2 — половина на TP1, половина на TP2, лимитные выходы без слиппеджа', () => {
		// 0.5×2 + 0.5×4 − (100×0.0007 + 0.5×120×0.0005 + 0.5×140×0.0005)/10
		// = 3 − 0.0135 = 2.9865
		close(netBeR(makeOutcome({})), 2.9865)
	})

	it('netBeR: раннер закрыт BE-стопом (fee+slip по цене входа)', () => {
		const be = makeOutcome({ state: 'stopped', tp2Hit: false, beAfterTp1: true, stopIndex: 4 })
		// 0.5×2 − (100×0.0007 + 0.5×120×0.0005 + 0.5×100×0.0007)/10
		// = 1 − 0.0135 = 0.9865
		close(netBeR(be), 0.9865)
	})

	it('netBeR: BE имеет приоритет над ошибочно сохранённым поздним TP2', () => {
		const lateTp2 = makeOutcome({ beAfterTp1: true, beIndex: 3, tp2Hit: true, tp2Index: 4, state: 'tp2' })
		close(netBeR(lateTp2), 0.9865)
	})

	it('netBeR: loss без TP1 = −1 минус издержки входа и стопа', () => {
		const loss = makeOutcome({ state: 'stopped', tp1Hit: false, tp2Hit: false, stopIndex: 2 })
		close(netBeR(loss), -1.0133)
	})

	it('time-stop до TP1 закрывает всю позицию по close с рыночными издержками', () => {
		const timed = makeOutcome({
			state: 'timed-out', tp1Hit: false, tp2Hit: false,
			timeStopIndex: 3, timeStopPrice: 105, timeStopR: 0.5,
		})
		// 0.5 − (100×0.0007 + 105×0.0007)/10
		close(netFullR(timed), 0.48565)
		close(netBeR(timed), 0.48565)
	})

	it('null для неразрешённых сделок (нет входа, открыта без TP1)', () => {
		assert.equal(netFullR(makeOutcome({ entered: false, entryPrice: null, riskSize: null })), null)
		assert.equal(netFullR(makeOutcome({ state: 'open', tp1Hit: false, tp2Hit: false })), null)
		assert.equal(netBeR(makeOutcome({ state: 'open', tp1Hit: false, tp2Hit: false })), null)
	})

	it('short: цены целей восстанавливаются зеркально', () => {
		// Вход 100, стоп 110, риск 10, TP1 = 100 − 20 = 80.
		const short = makeOutcome({ direction: 'short', stopPrice: 110 })
		// 2 − (100×0.0007 + 80×0.0005)/10 = 2 − 0.011... TP2 = 60:
		// netBe = 3 − (0.07 + 0.5×80×0.0005 + 0.5×60×0.0005)/10 = 3 − 0.0105
		close(netFullR(short), 2 - (100 * 0.0007 + 80 * 0.0005) / 10)
		close(netBeR(short), 3 - (100 * 0.0007 + 0.5 * 80 * 0.0005 + 0.5 * 60 * 0.0005) / 10)
	})
})
