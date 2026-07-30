import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { it } from 'node:test'

it('mode restore saves timestamp range instead of logical bar indices across different TF series', () => {
	const app = readFileSync('tools/visualizer/public/app.mjs', 'utf8')
	assert.match(app, /savedMainRange = getTimeRange\(\)/)
	assert.match(app, /setTimeRange\(savedMainRange\)/)
	assert.doesNotMatch(app, /savedMainRange = getLogicalRange\(\)/)
})

it('heatmap renders through one primitive instead of creating hundreds of LineSeries', () => {
	const heatmap = readFileSync('tools/visualizer/public/panels/heatmap.mjs', 'utf8')
	const chart = readFileSync('tools/visualizer/public/lib/chart.mjs', 'utf8')
	assert.match(heatmap, /heatmapPrim\.setBands\(S\.hmShownBands\)/)
	assert.doesNotMatch(heatmap, /\bline\(\[/)
	assert.match(chart, /export const heatmapPrim = makeHeatmapPrimitive\(\)/)
	assert.match(chart, /candlesSeries\.attachPrimitive\(heatmapPrim\)/)
})
