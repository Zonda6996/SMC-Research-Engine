import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { ExactIndicatorRow } from '../ci/research/lib/exactIndicatorExport.js'
import { detectH1Sequences, stripH1Labels, type H1Config } from '../ci/research/lib/h1CausalSequence.js'

const CFG: H1Config = { left: 2, right: 2, protectionWindow: 8, requireRebound: false, relVolMin: 0 }
function rows(n: number): ExactIndicatorRow[] {
	return Array.from({ length: n }, (_, i) => {
		const close = 100 + Math.sin(i / 2) * 4 + Math.sin(i / 7)
		return {
			timestamp: i * 3_600_000, open: close - Math.sin(i) * 0.4, high: close + 1, low: close - 1, close, volume: 100 + i,
			mean: 100, upperOuter: 110, upperInner: 106, lowerInner: 94, lowerOuter: 90,
			buy: i % 17 === 0, sell: i % 19 === 0,
		}
	})
}

it('H1 features are label-free and pivots become known only after right bars close', () => {
	const features = stripH1Labels(rows(80))
	assert.equal('buy' in features[0]!, false)
	assert.equal('sell' in features[0]!, false)
	const result = detectH1Sequences(features, CFG)
	assert.ok(result.pivots.length > 0)
	for (const pivot of result.pivots) assert.equal(pivot.knownAt, pivot.pivotAt + CFG.right)
	for (const event of result.events) {
		assert.ok(event.anchorKnownAt < event.sweepAt)
		assert.ok(event.protectionKnownAt < event.sweepAt)
		assert.ok(event.sweepAt <= event.reclaimAt)
		assert.ok(event.reclaimAt < event.protectionAt)
	}
})

it('appending or mutating future bars cannot rewrite prior H1 events', () => {
	const all = rows(100)
	const cutoff = 65
	const prefix = detectH1Sequences(stripH1Labels(all.slice(0, cutoff)), CFG)
	const mutated = [...all]
	for (let i = cutoff; i < mutated.length; i++) mutated[i] = { ...mutated[i]!, high: 10_000 + i, low: -10_000 - i, close: i % 2 ? 9_000 : -9_000 }
	const full = detectH1Sequences(stripH1Labels(mutated), CFG)
	assert.deepEqual(full.events.filter((event) => event.at < cutoff), prefix.events)
	const immutablePivotFields = (pivots: typeof full.pivots) => pivots.filter((pivot) => pivot.knownAt < cutoff).map(({ side, price, pivotAt, knownAt }) => ({ side, price, pivotAt, knownAt }))
	assert.deepEqual(immutablePivotFields(full.pivots), immutablePivotFields(prefix.pivots))
})
