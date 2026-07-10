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
		if (events.length === 0) { tooltip.style.display = 'none'; return }
		const e = events[0]
		tooltip.innerHTML = `<strong>${e.source.toUpperCase()}: ${e.type.toUpperCase()}</strong><br>` +
			`Level: ${e.levelPrice.toFixed(2)} (${e.levelType})<br>` +
			`Breach: #${e.breachIndex} → Confirm: #${e.confirmIndex}<br>` +
			`Trend: ${e.trend}` +
			(e.reason ? `<div class="reason">${e.reason}</div>` : '')
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
		document.getElementById('countCFiltered').textContent =
			`${(currentData.layers.C ?? []).length} / ${currentData.counts.C ?? 0}`
	}

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

// Конфиг BosChochEngine из тумблеров UI → query-параметры /api/analyze.
function engineParams() {
	return {
		cascade: document.getElementById('fltCascade').checked ? '1' : '0',
		hhll: document.getElementById('fltHHLL').checked ? '1' : '0',
		age: document.getElementById('fltAge').checked
			? String(Number(document.getElementById('fltAgeValue').value) || 0)
			: '0',
		dedup: document.getElementById('fltDedup').checked
			? String(Number(document.getElementById('fltDedupValue').value) || 0)
			: 'off',
		swept: document.getElementById('fltSwept').checked
			? String(Number(document.getElementById('fltSweptValue').value) || 0)
			: 'off',
	}
}

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
			...engineParams(),
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
	// Тумблеры отображения — локальная перерисовка.
	for (const id of ['toggleA', 'toggleB', 'toggleC', 'toggleStruct', 'toggleProtected', 'toggleUnlabeled']) {
		document.getElementById(id).addEventListener('change', () => renderAll())
	}
	// mode и фильтры движка — конфиг BosChochEngine, перезапрос к серверу.
	for (const id of ['mode', 'fltCascade', 'fltHHLL', 'fltAge', 'fltAgeValue', 'fltDedup', 'fltDedupValue', 'fltSwept', 'fltSweptValue']) {
		document.getElementById(id).addEventListener('change', () => loadData(lastIsFresh))
	}
	// Автозагрузка.
	loadData(false)
})
