import assert from 'node:assert/strict'
import { it } from 'node:test'
import { REFINED_CONFIRMATION_TF, SIMPLIFIED_CONFIRMATION_TF, TF_MS } from '../tools/shared/candleFetcher.js'

const LADDER = [
	['1w', '1d', '4h'],
	['1d', '4h', '1h'],
	['4h', '1h', '15m'],
	['1h', '15m', '5m'],
] as const

it('§14.1: simplified получает первый TF после `/`, refined — второй, для всех четырёх строк', () => {
	for (const [poiTf, simplifiedTf, refinedTf] of LADDER) {
		assert.equal(SIMPLIFIED_CONFIRMATION_TF[poiTf], simplifiedTf, `${poiTf} simplified`)
		assert.equal(REFINED_CONFIRMATION_TF[poiTf], refinedTf, `${poiTf} refined`)
		assert.ok(TF_MS[poiTf]! > TF_MS[simplifiedTf]!, `${poiTf}→${simplifiedTf}`)
		assert.ok(TF_MS[simplifiedTf]! > TF_MS[refinedTf]!, `${simplifiedTf}→${refinedTf}`)
	}
	assert.equal(SIMPLIFIED_CONFIRMATION_TF['15m'], undefined)
	assert.equal(REFINED_CONFIRMATION_TF['15m'], undefined)
})
