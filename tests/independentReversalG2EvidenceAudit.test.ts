import assert from 'node:assert/strict'
import { it } from 'node:test'
import { auditIndependentReversalG2Evidence } from '../ci/research/auditIndependentReversalG2Evidence.js'

function variant(trades: number, meanNetR: number, profitFactor: number, low95 = 0.01) {
	return {
		summary: { trades, meanNetR, profitFactor, bestOnePercentRemovedR: meanNetR / 2 },
		bootstrap: { low95, high95: 0.2, probabilityPositive: 0.9 },
		portfolio: { totalReturnPct: trades * meanNetR, maximumDrawdownPct: 5 },
		stress: { '12': { trades, meanNetR: meanNetR - 0.01, profitFactor: profitFactor - 0.1, bestOnePercentRemovedR: meanNetR / 3 } },
	}
}

it('G2 evidence audit exposes frozen gate and null-specification failures', () => {
	const selected = variant(60, 0.06, 1.5, -0.02)
	const matchedNull = variant(80, -0.02, 0.8, -0.1)
	const result = auditIndependentReversalG2Evidence({
		protocolHash: 'x',
		selectedVariant: 'EXT_POOL_SEQ',
		verdict: 'PROMISING_NOT_PROVEN',
		transfer: {
			aggregate: { EXT_POOL_SEQ: selected, MATCHED_NULL: matchedNull },
			cells: [
				{ symbol: 'A', variant: 'EXT_POOL_SEQ', summary: { trades: 20, meanNetR: 0.1, profitFactor: 2, bestOnePercentRemovedR: 0.05 } },
				{ symbol: 'B', variant: 'EXT_POOL_SEQ', summary: { trades: 20, meanNetR: 0.08, profitFactor: 1.8, bestOnePercentRemovedR: 0.04 } },
				{ symbol: 'C', variant: 'EXT_POOL_SEQ', summary: { trades: 20, meanNetR: -0.01, profitFactor: 0.9, bestOnePercentRemovedR: -0.01 } },
			],
		},
	}, {
		verdict: 'WALK_FORWARD_STABLE',
		folds: [{ fold: 1, months: ['2025-01'], trades: 10, meanNetR: 0.01, positiveMonths: 1, eligibleMonths: 1 }],
	}, {
		verdict: 'ABLATION_SUPPORTS_INTERACTION',
		controls: [],
	})

	assert.equal(result.verdict, 'RESEARCH_CANDIDATE_NOT_LIVE_READY')
	assert.ok(result.failedPromotionGates.includes('minimumOosTrades'))
	assert.ok(result.failedPromotionGates.includes('nonNegativeCellShare'))
	assert.ok(result.failedEvidenceChecks.includes('matched-null-count-mismatch'))
	assert.ok(result.failedEvidenceChecks.includes('matched-null-specification-mismatch'))
	assert.ok(result.failedEvidenceChecks.includes('confidence-interval-excludes-zero'))
	assert.ok(result.failedEvidenceChecks.includes('walk-forward-is-refit'))
	assert.ok((result.stability.worstLeaveOneOutMeanR ?? 0) >= 0)
})
