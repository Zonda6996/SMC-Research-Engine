// app.js — клиент визуализатора BOS/CHoCH.
// Загружает данные через /api/analyze, рисует график на lightweight-charts v5.

let chart = null
let candleSeries = null
let markersPlugin = null
let currentData = null

const COLORS = {
	A: { bos: '#1f6feb', choch: '#f85149', unlabeled: '#8b949e' },
	B: { bos: '#1f6feb', choch: '#f85149', unlabeled: '#8b949e' },
	structure: { HH: '#3fb950', HL: '#3fb950', LH: '#f85149', LL: '#f85149', UNKNOWN: '#8b949e' },
}

function tsToChartTime(ts) { return ts / 1000 }

function initChart() {
	if (chart) { chart.remove(); chart = null; markersPlugin = null }
	const container = document.getElementById('chart')
	chart = LightweightCharts.createChart(container, {
		width: container.clientWidth,
		height: container.clientHeight,
		layout: { background: { color: '#0d1117' }, textColor: '#c9d1d9' },
		grid: { vertLines: { color: '#21262d' }, horzLines: { color: '#21262d' } },
		crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
		timeScale: { borderColor: '#30363d', timeVisible: true, secondsVisible: false },
		rightPriceScale: { borderColor: '#30363d' },
	})
	candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
		upColor: '#3fb950', downColor: '#f85149',
		borderUpColor: '#3fb950', borderDownColor: '#f85149',
		wickUpColor: '#3fb950', wickDownColor: '#f85149',
	})
	markersPlugin = LightweightCharts.createSeriesMarkers(candleSeries, [])
	window.addEventListener('resize', () => {
		if (chart) { chart.applyOptions({ width: container.clientWidth, height: container.clientHeight }) }
	})

	// Tooltip при наведении на маркер.
	chart.subscribeCrosshairMove((param) => {
		const tooltip = document.getElementById('tooltip')
		if (!param.time || !param.seriesData.size) { tooltip.style.display = 'none'; return }
		// Ищем событие на этой свече.
		const idx = findCandleIndexByTime(param.time)
		if (idx === -1) { tooltip.style.display = 'none'; return }
		const events = findEventsAtCandle(idx)
		const fib = visibleFibCandidates().find((candidate) => candidate.createdAtIndex === idx)
		if (events.length === 0 && !fib) { tooltip.style.display = 'none'; return }
		if (fib) {
			tooltip.innerHTML = `<strong>FIB: ${fib.mode.toUpperCase()}</strong><br>` +
				`${fib.trigger.toUpperCase()} · ${fib.direction}<br>` +
				`Anchors: #${fib.start.index} ${fib.start.price.toFixed(2)} → #${fib.end.index} ${fib.end.price.toFixed(2)}<br>` +
				`Known: #${fib.createdAtIndex}<div class="reason">${fib.explanation}</div>`
		} else {
			const e = events[0]
			tooltip.innerHTML = `<strong>${e.source.toUpperCase()}: ${e.type.toUpperCase()}</strong><br>` +
				`Level: ${e.levelPrice.toFixed(2)} (${e.levelType})<br>` +
				`Breach: #${e.breachIndex} → Confirm: #${e.confirmIndex}<br>` +
				`Trend: ${e.trend}` +
				(e.reason ? `<div class="reason">${e.reason}</div>` : '')
		}
		tooltip.style.left = (param.point.x + 20) + 'px'
		tooltip.style.top = (param.point.y - 40) + 'px'
		tooltip.style.display = 'block'
	})
}

function findCandleIndexByTime(time) {
	if (!currentData) return -1
	for (let i = 0; i < currentData.candles.length; i++) {
		if (tsToChartTime(currentData.candles[i].timestamp) === time) return i
	}
	return -1
}

function findEventsAtCandle(idx) {
	if (!currentData) return []
	const events = []
	if (document.getElementById('toggleA').checked) {
		for (const e of currentData.layers.A) {
			if (e.confirmIndex === idx) events.push(e)
		}
	}
	if (document.getElementById('toggleB').checked) {
		for (const e of currentData.layers.B) {
			if (e.confirmIndex === idx) events.push(e)
		}
	}
	if (document.getElementById('toggleC').checked) {
		// layers.C уже отфильтрован движком на сервере.
		for (const e of currentData.layers.C ?? []) {
			if (e.confirmIndex === idx) events.push(e)
		}
	}
	// Фильтр unlabeled.
	const showUnlabeled = document.getElementById('toggleUnlabeled').checked
	return showUnlabeled ? events : events.filter((e) => e.type !== 'unlabeled')
}

function renderCandles(candles) {
	const data = candles.map((c) => ({
		time: tsToChartTime(c.timestamp),
		open: c.open, high: c.high, low: c.low, close: c.close,
	}))
	candleSeries.setData(data)
}

// Базовые опции для всех вспомогательных линий: без ценника на оси и без
// «бесконечной» priceLine через весь график (из-за них сегменты выглядели
// как линии во всю ширину).
const SEGMENT_SERIES_OPTIONS = {
	lastValueVisible: false,
	priceLineVisible: false,
	crosshairMarkerVisible: false,
}

function renderProtectedSegments(segments, candles) {
	if (!document.getElementById('toggleProtected').checked) return
	for (const seg of segments) {
		const startCandle = candles[seg.startIndex]
		const endCandle = candles[seg.endIndex]
		if (!startCandle || !endCandle || seg.startIndex >= seg.endIndex) continue
		const line = chart.addSeries(LightweightCharts.LineSeries, {
			...SEGMENT_SERIES_OPTIONS,
			color: seg.type === 'high' ? '#d29922' : '#2ea043',
			lineWidth: 1,
			lineStyle: LightweightCharts.LineStyle.Dashed,
		})
		line.setData([
			{ time: tsToChartTime(startCandle.timestamp), value: seg.price },
			{ time: tsToChartTime(endCandle.timestamp), value: seg.price },
		])
	}
}

// Фильтры слоя C применяются на СЕРВЕРЕ: тумблеры UI крутят конфиг
// BosChochEngine (src/core/events/) — единственного источника истины.
// layers.C в ответе уже отфильтрован и классифицирован движком.

// Стили линий по слоям: A — сплошная, B — ��унктир, C — точки.
const LAYER_STYLE = {
	A: { lineStyle: () => LightweightCharts.LineStyle.Solid, shape: 'circle', prefix: '' },
	B: { lineStyle: () => LightweightCharts.LineStyle.Dashed, shape: 'square', prefix: 'B·' },
	C: { lineStyle: () => LightweightCharts.LineStyle.Dotted, shape: 'circle', prefix: 'C·' },
}

// Рисует события слома как в ручной SMC-разметке: горизонтальная линия от
// свечи возникновения уровня до свечи подтверждения слома, с подписью
// BOS/CHoCH на середине линии.
function renderEventLines(events, candles, layerName) {
	const style = LAYER_STYLE[layerName] ?? LAYER_STYLE.A
	for (const e of events) {
		const startCandle = candles[e.levelIndex]
		const endCandle = candles[e.confirmIndex]
		if (!startCandle || !endCandle || e.levelIndex >= e.confirmIndex) continue
		const color = COLORS.A[e.type]
		const line = chart.addSeries(LightweightCharts.LineSeries, {
			...SEGMENT_SERIES_OPTIONS,
			color,
			lineWidth: 2,
			lineStyle: style.lineStyle(),
		})
		line.setData([
			{ time: tsToChartTime(startCandle.timestamp), value: e.levelPrice },
			{ time: tsToChartTime(endCandle.timestamp), value: e.levelPrice },
		])
		// Подпись на середине линии (маркер живёт на line-series, не на свечах).
		const midCandle = candles[Math.floor((e.levelIndex + e.confirmIndex) / 2)]
		if (midCandle) {
			const label = e.type === 'unlabeled' ? '?' : e.type.toUpperCase()
			LightweightCharts.createSeriesMarkers(line, [{
				time: tsToChartTime(midCandle.timestamp),
				position: e.levelType === 'high' ? 'aboveBar' : 'belowBar',
				color,
				shape: style.shape,
				size: 0,
				text: style.prefix + label,
			}])
		}
	}
}

const FIB_MODE_STYLE = {
	'event-impulse': { color: '#58a6ff', toggle: 'fibEvent', label: 'EVENT' },
	'nearest-enclosing-leg': { color: '#d29922', toggle: 'fibNearest', label: 'NEAR' },
	'outermost-enclosing-leg': { color: '#2ea043', toggle: 'fibOutermost', label: 'OUTER' },
}

function visibleFibCandidates() {
	if (!currentData?.fib || !document.getElementById('toggleFib').checked) return []
	const showBos = document.getElementById('fibBos').checked
	const showChoch = document.getElementById('fibChoch').checked
	const filtered = currentData.fib.candidates.filter((candidate) => {
		const mode = FIB_MODE_STYLE[candidate.mode]
		return mode && document.getElementById(mode.toggle).checked &&
			(candidate.trigger === 'bos' ? showBos : showChoch)
	})
	if (!document.getElementById('fibLatest').checked) return filtered
	const latest = new Map()
	for (const candidate of filtered) {
		const key = `${candidate.mode}:${candidate.trigger}`
		const previous = latest.get(key)
		if (!previous || candidate.createdAtIndex > previous.createdAtIndex) latest.set(key, candidate)
	}
	return [...latest.values()]
}

function renderFibCandidates(candidates, candles) {
	const lastCandle = candles[candles.length - 1]
	if (!lastCandle) return
	for (const candidate of candidates) {
		const style = FIB_MODE_STYLE[candidate.mode]
		const created = candles[candidate.createdAtIndex]
		if (!style || !created) continue

		for (const level of candidate.levels) {
			const isKey = level.ratio === 0 || level.ratio === 100 || level.ratio === 61.8 || level.ratio === 78.6
			const line = chart.addSeries(LightweightCharts.LineSeries, {
				...SEGMENT_SERIES_OPTIONS,
				color: style.color,
				lineWidth: isKey ? 2 : 1,
				lineStyle: level.ratio > 100
					? LightweightCharts.LineStyle.Dotted
					: LightweightCharts.LineStyle.Dashed,
			})
			line.setData([
				{ time: tsToChartTime(created.timestamp), value: level.price },
				{ time: tsToChartTime(lastCandle.timestamp), value: level.price },
			])
			if (level.ratio === 61.8) {
				LightweightCharts.createSeriesMarkers(line, [{
					time: tsToChartTime(created.timestamp),
					position: candidate.direction === 'long' ? 'belowBar' : 'aboveBar',
					color: style.color,
					shape: 'circle',
					size: 0,
					text: `${style.label} ${candidate.trigger.toUpperCase()} · 61.8`,
				}])
			}
		}
	}
}

function renderAll() {
	if (!currentData) return
	initChart()
	renderCandles(currentData.candles)

	const showUnlabeled = document.getElementById('toggleUnlabeled').checked
	const allMarkers = []

	if (document.getElementById('toggleStruct').checked) {
		for (const s of currentData.structure) {
			const c = currentData.candles[s.index]
			if (!c) continue
			allMarkers.push({
				time: tsToChartTime(c.timestamp),
				position: s.type === 'high' ? 'aboveBar' : 'belowBar',
				color: COLORS.structure[s.label] ?? '#8b949e',
				shape: s.type === 'high' ? 'arrowDown' : 'arrowUp',
				text: s.label,
			})
		}
	}

	allMarkers.sort((a, b) => a.time - b.time)
	markersPlugin.setMarkers(allMarkers)

	// События слома — линии от уровня до свечи подтверждения (не плавающие точки).
	const filterEvents = (events) =>
		showUnlabeled ? events : events.filter((e) => e.type !== 'unlabeled')
	if (document.getElementById('toggleA').checked) {
		renderEventLines(filterEvents(currentData.layers.A), currentData.candles, 'A')
	}
	if (document.getElementById('toggleB').checked) {
		renderEventLines(filterEvents(currentData.layers.B), currentData.candles, 'B')
	}
	if (document.getElementById('toggleC').checked) {
		const eventsC = filterEvents(currentData.layers.C ?? [])
		renderEventLines(eventsC, currentData.candles, 'C')
	}

	renderFibCandidates(visibleFibCandidates(), currentData.candles)
	renderProtectedSegments(currentData.protectedSegments ?? [], currentData.candles)
	chart.timeScale().fitContent()
}

function updateCounts(data) {
	// Counts п��казываем всегда (даже если unlabeled скрыты).
	document.getElementById('countA').textContent = data.counts.A
	document.getElementById('countB').textContent = data.counts.B
	document.getElementById('countMatch').textContent = data.counts.matched
	document.getElementById('countUniqueB').textContent = data.counts.uniqueB
	document.getElementById('aBos').textContent = data.counts.byTypeA.bos
	document.getElementById('aChoch').textContent = data.counts.byTypeA.choch
	document.getElementById('aUnlabeled').textContent = data.counts.byTypeA.unlabeled
	document.getElementById('bBos').textContent = data.counts.byTypeB.bos
	document.getElementById('bChoch').textContent = data.counts.byTypeB.choch
	document.getElementById('bUnlabeled').textContent = data.counts.byTypeB.unlabeled
	document.getElementById('countC').textContent = data.counts.C ?? 0
	document.getElementById('cBos').textContent = data.counts.byTypeC?.bos ?? 0
	document.getElementById('cChoch').textContent = data.counts.byTypeC?.choch ?? 0
	document.getElementById('cUnlabeled').textContent = data.counts.byTypeC?.unlabeled ?? 0
	document.getElementById('fibCandidateCount').textContent = data.fib?.candidates.length ?? 0
	document.getElementById('fibSkipCount').textContent = data.fib?.skips.length ?? 0
	const reasons = {}
	for (const skip of data.fib?.skips ?? []) reasons[skip.reason] = (reasons[skip.reason] ?? 0) + 1
	document.getElementById('fibSkipReasons').textContent = Object.entries(reasons)
		.map(([reason, count]) => `${reason}: ${count}`)
		.join(' · ')
}

function updateDiffTable(uniqueB, candles) {
	const tbody = document.querySelector('#diffTable tbody')
	tbody.innerHTML = ''
	for (const e of uniqueB) {
		const tr = document.createElement('tr')
		tr.className = 'diff-row'
		tr.innerHTML = `<td>${e.confirmIndex}</td><td>${e.type}</td><td>${e.levelPrice.toFixed(2)}</td><td>${e.trend}</td>`
		tr.addEventListener('click', () => {
			const c = candles[e.confirmIndex]
			if (c) chart.timeScale().setVisibleRange({
				from: tsToChartTime(c.timestamp) - 3600 * 4,
				to: tsToChartTime(c.timestamp) + 3600 * 4,
			})
		})
		tbody.appendChild(tr)
	}
}

let lastIsFresh = false

async function loadData(isFresh) {
	lastIsFresh = isFresh
	const mode = document.getElementById('mode').value
	const symbol = isFresh ? document.getElementById('symbol').value : 'BTC/USDT'
	const timeframe = isFresh ? document.getElementById('timeframe').value : '15m'
	const limit = isFresh ? document.getElementById('limit').value : '500'
	const market = isFresh ? document.getElementById('market').value : 'spot'

	showLoading(true)
	try {
		const params = new URLSearchParams({
			symbol, timeframe, limit, mode, market,
			source: isFresh ? 'fresh' : 'fixture',
		})
		const res = await fetch(`/api/analyze?${params}`)
		const data = await res.json()
		if (data.error) throw new Error(data.error)
		currentData = data
		document.getElementById('datasetLabel').textContent =
			`${isFresh ? 'fresh' : 'fixture'}: ${data.dataset.symbol} ${data.dataset.timeframe} ` +
			`(${data.dataset.candleCount} candles, ${data.dataset.mode})`
		renderAll()
		updateCounts(data)
		updateDiffTable(data.layers.uniqueB, data.candles)
	} catch (err) {
		alert('Error: ' + err.message)
	} finally {
		showLoading(false)
	}
}

function showLoading(show) {
	document.getElementById('loading').style.display = show ? 'block' : 'none'
}

document.addEventListener('DOMContentLoaded', () => {
	initChart()
	document.getElementById('loadBtn').addEventListener('click', () => loadData(false))
	document.getElementById('freshBtn').addEventListener('click', () => loadData(true))
	// Тумблеры отображения — локальная перерисовка канонического snapshot.
	for (const id of [
		'toggleA', 'toggleB', 'toggleC', 'toggleStruct', 'toggleProtected', 'toggleUnlabeled',
		'toggleFib', 'fibEvent', 'fibNearest', 'fibOutermost', 'fibBos', 'fibChoch', 'fibLatest',
	]) {
		document.getElementById(id).addEventListener('change', () => renderAll())
	}
	// Режим пробоя меняет только диагностические A/B; pipeline C использует утверждённый дефолт.
	document.getElementById('mode').addEventListener('change', () => loadData(lastIsFresh))
	// Автозагрузка.
	loadData(false)
})
