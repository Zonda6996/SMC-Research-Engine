import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { Batch2Row } from '../ci/research/runFngOosConfirmation.js'
import { buildHtfLookup, isAligned, spearman } from '../ci/research/runH2HtfConfluence.js'

const mkHtf = (i: number, close: number, opts: Partial<Batch2Row> = {}): Batch2Row => ({
	timestamp: i * 3_600_000, open: 100, high: 105, low: 95, close,
	mean: 100, upperOuter: 120, upperInner: 110, lowerInner: 90, lowerOuter: 80,
	buy: false, sell: false, volume: 10, ...opts,
})

it('h2: buildHtfLookup — строго без lookahead (бар доступен только после его close time)', () => {
	const htf = Array.from({ length: 60 }, (_, i) => mkHtf(i, 110))
	const lookup = buildHtfLookup(htf, '1h', 0)
	// t = открытие бара 55 -> последний закрытый бар = 54
	const t = 55 * 3_600_000
	const s = lookup(t)!
	assert.ok(s)
	assert.equal(s.side, 1)
	assert.ok(Math.abs(s.stretch - 0.5) < 1e-9) // (110-100)/(120-100)
	// внутри бара 55 (t + 1мс) всё ещё бар 54
	assert.ok(lookup(t + 1) != null)
	// до закрытия первого пригодного бара (vp50 требует 50 баров) -> null
	assert.equal(lookup(30 * 3_600_000), null)
})

it('h2: isAligned — BUY выровнен при HTF-растяжении ВНИЗ, SELL — вверх', () => {
	assert.equal(isAligned('long', -0.3), true)
	assert.equal(isAligned('long', -0.1), false)
	assert.equal(isAligned('long', 0.5), false)
	assert.equal(isAligned('short', 0.3), true)
	assert.equal(isAligned('short', -0.3), false)
})

it('h2: recentSameDirLabel видит недавнюю HTF-метку той же стороны; spearman корректен', () => {
	const htf = Array.from({ length: 60 }, (_, i) => mkHtf(i, 110, i === 52 ? { buy: true } : {}))
	const lookup = buildHtfLookup(htf, '1h', 0)
	const s = lookup(56 * 3_600_000)! // последний закрытый бар 55, окно 12 покрывает 52
	assert.equal(s.recentSameDirLabel('long'), true)
	assert.equal(s.recentSameDirLabel('short'), false)
	assert.ok(Math.abs(spearman([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]) - 1) < 1e-9)
	assert.ok(Math.abs(spearman([1, 2, 3, 4, 5], [10, 8, 6, 4, 2]) + 1) < 1e-9)
})
