import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { it } from 'node:test'
import { assertFixtureRequest, buildIndicatorPayload } from '../tools/visualizer/server.js'
import { detectArrowSignalCandidates } from '../src/core/signals/ArrowSignalEngine.js'
import { replayArrowSignals } from '../src/core/signals/ArrowTradeReplay.js'

const HOUR = 3_600_000
const candles = Array.from({ length: 260 }, (_, index) => ({ timestamp: index * HOUR, open: 100, high: 101, low: 99, close: 100, volume: 1_000 }))

it('visualizer payload exposes canonical signal arrows for the exact loaded series', () => {
	const payload = buildIndicatorPayload(candles, undefined, 'risk')
	assert.equal(payload.signalArrows.mode, 'risk')
	assert.equal(payload.signalArrows.loadedBars, candles.length)
	assert.equal(payload.signalArrows.evaluatedBars, candles.length - payload.signalArrows.warmupBars)
	const times = new Set(candles.map((x) => x.timestamp))
	for (const signal of payload.signalArrows.signals) assert.ok(times.has(signal.signalAt))
	for (const trade of payload.signalArrows.trades) assert.equal(trade.mode, 'risk')
	assert.equal(payload.signalArrows.diagnosticReport.evaluatedSides, payload.signalArrows.diagnostics.length)
	assert.equal(payload.signalArrows.diagnosticReport.accepted, payload.signalArrows.diagnostics.filter((x) => x.accepted).length)
})

it('matches direct detection and replay for the exact candle array end-to-end', () => {
	const payload = buildIndicatorPayload(candles, undefined, 'risk')
	const detection = detectArrowSignalCandidates(candles)
	const direct = replayArrowSignals(candles, detection.bands, detection.candidates, 'risk')
	assert.deepEqual(payload.signalArrows.signals, direct.signals)
	assert.deepEqual(payload.signalArrows.trades, direct.trades)
	assert.deepEqual(payload.signalArrows.summary, direct.summary)
})

it('rejects fixture requests outside BTC/USDT 15m', () => {
	assert.doesNotThrow(() => assertFixtureRequest('BTC/USDT', '15m'))
	assert.throws(() => assertFixtureRequest('SOL/USDT', '15m'), /fixture contains BTC\/USDT 15m, not requested SOL\/USDT 15m/)
	assert.throws(() => assertFixtureRequest('BTC/USDT', '1h'), /fixture contains BTC\/USDT 15m, not requested BTC\/USDT 1h/)
})

it('browser indicator layer uses server replay and filters visible stats by signalAt', () => {
	const panel = readFileSync('tools/visualizer/public/panels/indicators.mjs', 'utf8')
	const app = readFileSync('tools/visualizer/public/app.mjs', 'utf8')
	const html = readFileSync('tools/visualizer/public/index.html', 'utf8')
	assert.match(panel, /payload\?\.signalArrows\?\.trades/)
	assert.match(panel, /time\(t\.signalAt\)>=visibleRange\.from/)
	assert.match(panel, /trade\.events\?\.find\(event=>event\.type==='partial'\)/)
	assert.match(panel, /trade\.events\?\.find\(event=>event\.type==='full'\)/)
	assert.match(panel, /time\(partialEvent\.at\).*PARTIAL \$\{fmtP\(partialEvent\.price\)\}/)
	assert.match(panel, /time\(fullEvent\.at\).*FULL \$\{fmtP\(fullEvent\.price\)\}/)
	assert.match(panel, /else if\(trade\.management==='static'\)/)
	const movingBranch = panel.split("if(trade.management==='moving-apex'")[1]?.split("}else if(trade.management==='static')")[0] ?? ''
	assert.doesNotMatch(movingBranch, /draw\(trade\.(?:partial|full)/)
	assert.doesNotMatch(movingBranch, /eventPrices\.(?:partial|full)|currentLevels\.(?:mean|oppositeInner).*text:/)
	assert.doesNotMatch(panel, /replayArrowTrade|adverseWick|favorableWick/)
	assert.match(app, /updateSignalArrowHud\(getTimeRange\(\)\)/)
	assert.match(html, /id="signalArrowHud"/)
	assert.match(html, /id="signalArrowsChk"/)
	assert.doesNotMatch(html, /id="reversalChk"/)
})
