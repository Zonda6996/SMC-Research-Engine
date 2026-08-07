import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import {
	INDEPENDENT_REVERSAL_G2_PROTOCOL,
	stableIndependentReversalG2ProtocolJson,
} from '../src/core/signals/IndependentReversalG2Protocol.js'

test('G2 preregistration mirrors the canonical protocol', () => {
	const json = JSON.parse(readFileSync(resolve('ci-results/independent-reversal-g2-preregistration.json'), 'utf8')) as Record<string, unknown>
	for (const key of ['generation', 'version', 'variants', 'candidate', 'pool', 'sequence', 'execution', 'validation', 'gates', 'prohibitions']) {
		assert.deepEqual(json[key], INDEPENDENT_REVERSAL_G2_PROTOCOL[key as keyof typeof INDEPENDENT_REVERSAL_G2_PROTOCOL])
	}
})

test('G2 protocol serializes and hashes deterministically', () => {
	const stable = stableIndependentReversalG2ProtocolJson()
	assert.equal(stable, stableIndependentReversalG2ProtocolJson(INDEPENDENT_REVERSAL_G2_PROTOCOL))
	assert.match(createHash('sha256').update(stable).digest('hex'), /^[a-f0-9]{64}$/)
})

test('G2 promotion contract prioritizes net economics over frequency', () => {
	assert.ok(INDEPENDENT_REVERSAL_G2_PROTOCOL.gates.minimumMeanNetR > 0)
	assert.ok(INDEPENDENT_REVERSAL_G2_PROTOCOL.gates.minimumProfitFactor > 1)
	assert.ok(INDEPENDENT_REVERSAL_G2_PROTOCOL.gates.minimumNullAdvantageR > 0)
	assert.equal(INDEPENDENT_REVERSAL_G2_PROTOCOL.prohibitions.productionWiringBeforePromotion, true)
})
