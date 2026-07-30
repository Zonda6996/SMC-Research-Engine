import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { it } from 'node:test'

it('visualizer server routes each confirmation engine to its own §14.1 series and payload', () => {
	const server = readFileSync('tools/visualizer/server.ts', 'utf8')
	assert.match(server, /const simplifiedTf = SIMPLIFIED_CONFIRMATION_TF\[timeframe\]/)
	assert.match(server, /const refinedTf = REFINED_CONFIRMATION_TF\[timeframe\]/)
	assert.match(server, /detectPoiConfirmation\(poiCandidates, ltfRefined/)
	assert.match(server, /detectSimplifiedConfirmation\(poiCandidates, ltfSimplified/)
	assert.match(server, /ltfConf: ltfRefined/)
	assert.match(server, /ltfSimplified,/)
	assert.match(server, /indicators: \{ main: mainIndicators, confirmation: refinedIndicators, simplified: simplifiedIndicators \}/)
})

it('confirmation panel selects mode-specific series, results, indicators and labels', () => {
	const panel = readFileSync('tools/visualizer/public/panels/confirmation.mjs', 'utf8')
	assert.match(panel, /engine === 'simplified'/)
	assert.match(panel, /simplified \? L\.simplifiedTf : L\.confTf/)
	assert.match(panel, /simplified \? L\.ltfSimplified : L\.ltfConf/)
	assert.match(panel, /simplified \? \(S\.data\?\.ltfSimplified \|\| \[\]\) : \(S\.data\?\.ltfConf \|\| \[\]\)/)
	assert.match(panel, /simplified \? S\.data\?\.indicators\?\.simplified : S\.data\?\.indicators\?\.confirmation/)
})
