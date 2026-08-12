import assert from 'node:assert/strict'
import { it } from 'node:test'
import { DASHBOARD, distance, tally } from '../ci/research/runDm1DashboardMatch.js'

it('dm1: distance = 0 при точном совпадении с dashboard, растёт квадратично', () => {
	const exact = {
		long: { trades: 50, partial: 16, stop: 7, full: 27, end: 0 },
		short: { trades: 40, partial: 13, stop: 3, full: 24, end: 0 },
	}
	assert.equal(distance(exact), 0)
	const off = { ...exact, long: { ...exact.long, stop: 11, full: 23 } } // +4 stop, -4 full
	assert.ok(Math.abs(distance(off) - (16 / 7 + 16 / 27)) < 1e-9)
})

it('dm1: tally раскладывает исходы по сторонам и исключает End mark из closed', () => {
	const t = tally([
		{ side: 1, outcome: 'Stop' },
		{ side: 1, outcome: 'Partial' },
		{ side: 1, outcome: 'Full fix' },
		{ side: 1, outcome: 'End mark' },
		{ side: -1, outcome: 'Full fix' },
	])
	assert.deepEqual(t.long, { trades: 3, partial: 1, stop: 1, full: 1, end: 1 })
	assert.deepEqual(t.short, { trades: 1, partial: 0, stop: 0, full: 1, end: 0 })
	assert.equal(DASHBOARD.long.trades, 50)
	assert.equal(DASHBOARD.long.partial + DASHBOARD.long.stop + DASHBOARD.long.full, 50)
	assert.equal(DASHBOARD.short.partial + DASHBOARD.short.stop + DASHBOARD.short.full, 40)
})
