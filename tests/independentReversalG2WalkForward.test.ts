import assert from 'node:assert/strict'
import { it } from 'node:test'
import { buildIndependentReversalG2WalkForward } from '../ci/research/runIndependentReversalG2WalkForward.js'

it('G2 walk-forward never reselects the frozen development winner', () => {
	const cells = ['A', 'B', 'C'].flatMap((symbol) => (['EXT_POOL', 'OWN1_POOL'] as const).map((variant) => ({
		symbol,
		variant,
		months: Array.from({ length: 16 }, (_, index) => ({
			month: `2025-${String(index + 1).padStart(2, '0')}`,
			summary: { trades: 5, meanNetR: variant === 'EXT_POOL' ? 0.1 : -0.1, profitFactor: variant === 'EXT_POOL' ? 1.3 : 0.8 },
		})),
	})))
	const result = buildIndependentReversalG2WalkForward({ protocolHash: 'x', selectedVariant: 'EXT_POOL', verdict: 'PROMOTE_G2', transfer: { cells } })
	assert.equal(result.selectedVariant, 'EXT_POOL')
	assert.equal(result.folds.length, 4)
	assert.equal(result.positiveFolds, 4)
	assert.equal(result.verdict, 'WALK_FORWARD_STABLE')
})
