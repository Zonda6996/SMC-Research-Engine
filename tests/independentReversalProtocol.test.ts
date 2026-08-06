import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import {
	INDEPENDENT_REVERSAL_PROTOCOL,
	stableProtocolJson,
} from '../src/core/signals/IndependentReversalProtocol.js'
import { independentReversalProtocolHash } from '../ci/research/runIndependentReversalResearch.js'

test('independent Reversal preregistration mirrors the canonical frozen protocol', () => {
	const json = JSON.parse(readFileSync(resolve('ci-results/independent-reversal-preregistration.json'), 'utf8')) as {
		generation: string
		families: string[]
		signal: Record<string, unknown>
		execution: Record<string, unknown>
	}
	assert.equal(json.generation, INDEPENDENT_REVERSAL_PROTOCOL.generation)
	assert.deepEqual(json.families, INDEPENDENT_REVERSAL_PROTOCOL.families)
	for (const [key, value] of Object.entries(INDEPENDENT_REVERSAL_PROTOCOL.signal)) assert.equal(json.signal[key], value)
	assert.equal(json.execution.entry, INDEPENDENT_REVERSAL_PROTOCOL.execution.entry)
	assert.equal(json.execution.takerFeeRate, INDEPENDENT_REVERSAL_PROTOCOL.execution.takerFeeRate)
	assert.equal(json.execution.makerFeeRate, INDEPENDENT_REVERSAL_PROTOCOL.execution.makerFeeRate)
	assert.equal(json.execution.marketSlippageRate, INDEPENDENT_REVERSAL_PROTOCOL.execution.marketSlippageRate)
	assert.equal(json.execution.stopBufferAtr, INDEPENDENT_REVERSAL_PROTOCOL.execution.stopBufferAtr)
	assert.equal((json.execution.riskAtrRange as number[])[0], INDEPENDENT_REVERSAL_PROTOCOL.execution.minRiskAtr)
	assert.equal((json.execution.riskAtrRange as number[])[1], INDEPENDENT_REVERSAL_PROTOCOL.execution.maxRiskAtr)
	assert.equal(json.execution.targetR, INDEPENDENT_REVERSAL_PROTOCOL.execution.targetR)
	assert.equal(json.execution.timeStopBars, INDEPENDENT_REVERSAL_PROTOCOL.execution.timeStopBars)
	assert.equal(json.execution.ambiguousBar, INDEPENDENT_REVERSAL_PROTOCOL.execution.ambiguousBar)
})

test('preregistration files predate the executable profitability runner', () => {
	const runnerMtime = statSync(resolve('ci/research/runIndependentReversalResearch.ts')).mtimeMs
	assert.ok(statSync(resolve('ci-results/independent-reversal-preregistration.json')).mtimeMs <= runnerMtime)
	assert.ok(statSync(resolve('ci-results/independent-reversal-preregistration.md')).mtimeMs <= runnerMtime)
})

test('canonical protocol has stable recursive JSON and SHA-256 hash', () => {
	assert.equal(stableProtocolJson(), stableProtocolJson(INDEPENDENT_REVERSAL_PROTOCOL))
	assert.match(independentReversalProtocolHash(), /^[a-f0-9]{64}$/)
})
