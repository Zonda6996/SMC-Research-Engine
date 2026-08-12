import assert from 'node:assert/strict'
import { it } from 'node:test'
import { buildIndependentReversalG2Ablation } from '../ci/research/runIndependentReversalG2Ablation.js'

it('G2 ablation requires sequence uplift, null advantage and robust tails', () => {
	const variant = (meanNetR: number, profitFactor: number, bestOnePercentRemovedR = meanNetR) => ({ summary: { trades: 100, meanNetR, profitFactor, bestOnePercentRemovedR }, bootstrap: { low95: 0, high95: 1 } })
	const result = buildIndependentReversalG2Ablation({
		protocolHash: 'x',
		selectedVariant: 'EXT_POOL_SEQ',
		transfer: {
			aggregate: {
				EXT_POOL_SEQ: variant(0.1, 1.5, 0.08),
				EXT_POOL: variant(0.04, 1.15),
				OWN1_POOL: variant(0.03, 1.1),
				EXT: variant(0.01, 1.02),
				MATCHED_NULL: variant(-0.01, 0.9),
				G1: variant(0, 1),
			},
			cells: [{ symbol: 'A', variant: 'EXT_POOL_SEQ', summary: { trades: 20, meanNetR: 0.1, profitFactor: 1.4, bestOnePercentRemovedR: 0.05 } }],
		},
	})
	assert.equal(result.verdict, 'ABLATION_SUPPORTS_INTERACTION')
	assert.equal(result.findings.beatsMatchedNull, true)
})
