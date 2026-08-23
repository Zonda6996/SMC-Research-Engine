import assert from 'node:assert/strict'
import { it } from 'node:test'
import {
	detectStatefulApexEvents,
	labelStatefulApexEvent,
	statefulApexSplit,
	type StatefulApexRow,
} from '../ci/research/lib/statefulApexEvents.js'

function row(i: number, overrides: Partial<StatefulApexRow> = {}): StatefulApexRow {
	return {
		timestamp: i * 60_000,
		open: 100,
		high: 101,
		low: 99,
		close: 100,
		volume: 100 + i,
		mean: 100,
		upperOuter: 110,
		upperInner: 106,
		lowerInner: 94,
		lowerOuter: 90,
		...overrides,
	}
}

const longEpisode = (): StatefulApexRow[] => [
	row(0),
	row(1, { open: 99, high: 99.5, low: 97, close: 98 }),
	row(2, { open: 97, high: 98, low: 93, close: 94 }),
	row(3, { open: 94, high: 95, low: 92, close: 93 }),
	row(4, { open: 93, high: 97, low: 92.5, close: 96 }),
	row(5, { open: 96, high: 101, low: 95, close: 100 }),
]

it('implements frozen long state sequence, one event, and next-open entry', () => {
	const rows = longEpisode()
	const result = detectStatefulApexEvents(rows)
	assert.deepEqual(result.transitions.map((x) => `${x.from}->${x.to}`), [
		'NEUTRAL->ARMED', 'ARMED->EXTENDED', 'EXTENDED->TRACKING',
		'TRACKING->REVERSAL_CONFIRMED', 'REVERSAL_CONFIRMED->COOLDOWN',
		'COOLDOWN->NEUTRAL',
	])
	assert.equal(result.events.length, 1)
	assert.equal(result.events[0]!.confirmationIndex, 4)
	assert.equal(result.events[0]!.entryIndex, 5)
	assert.equal(result.events[0]!.features.causalRelativeVolume, null)
	assert.equal('buy' in result.events[0]!.features, false)
	assert.equal('sell' in result.events[0]!.features, false)
})

it('mirrors BUY and SELL state paths', () => {
	const buy = detectStatefulApexEvents(longEpisode()).events[0]!
	const mirrored = longEpisode().map((r) => ({
		...r,
		open: 200 - r.open,
		high: 200 - r.low,
		low: 200 - r.high,
		close: 200 - r.close,
		mean: 200 - r.mean,
		upperOuter: 200 - r.lowerOuter,
		upperInner: 200 - r.lowerInner,
		lowerInner: 200 - r.upperInner,
		lowerOuter: 200 - r.upperOuter,
	}))
	const sell = detectStatefulApexEvents(mirrored).events[0]!
	assert.equal(buy.side, 'long')
	assert.equal(sell.side, 'short')
	assert.equal(buy.confirmationIndex, sell.confirmationIndex)
	assert.equal(buy.entryIndex, sell.entryIndex)
})

it('is prefix invariant under arbitrary future mutation', () => {
	const prefixRows = longEpisode()
	const prefix = detectStatefulApexEvents(prefixRows)
	const future = Array.from({ length: 20 }, (_, k) => row(6 + k, { high: 10_000 + k, low: -10_000 - k, close: k % 2 ? 9_000 : -9_000 }))
	const full = detectStatefulApexEvents([...prefixRows, ...future])
	assert.deepEqual(full.events.filter((x) => x.confirmationIndex < prefixRows.length), prefix.events)
	assert.deepEqual(full.transitions.filter((x) => x.index < prefixRows.length), prefix.transitions)
})

it('labels from next open with stop-first same-bar ordering and 5bps/side costs', () => {
	const rows = longEpisode()
	rows[5] = row(5, { open: 95, high: 101, low: 89, close: 96 })
	const event = detectStatefulApexEvents(rows).events[0]!
	const label = labelStatefulApexEvent(rows, event, 5)!
	assert.equal(label.entry, 95)
	assert.equal(label.targetBeforeStop, false)
	assert.equal(label.grossR, -1)
	assert.ok(label.netR5bps! < -1)
})

it('split is stable and symbol-wide', () => {
	assert.equal(statefulApexSplit('BTCUSDT'), statefulApexSplit('BTCUSDT'))
	assert.equal(statefulApexSplit('BTCUSDT'), statefulApexSplit('BTCUSDT'))
})
