// app.js — клиент визуализатора BOS/CHoCH.
// Загружает данные через /api/analyze, рисует график на lightweight-charts v5.

let chart = null
let candleSeries = null
let markersPlugin = null
let currentData = null
let priceScaleMargin = 0.08
let priceScaleWheelBound = false

const COLORS = {
	A: { bos: '#1f6feb', choch: '#f85149', unlabeled: '#8b949e' },
	B: { bos: '#1f6feb', choch: '#f85149', unlabeled: '#8b949e' },
	structure: { HH: '#3fb950', HL: '#3fb950', LH: '#f85149', LL: '#f85149', UNKNOWN: '#8b949e' },
}

function tsToChartTime(ts) { return ts / 1000 }

// Колесо над ценовой шкалой: меняет вертикальные отступы autoscale (высоту графика).
// Не трогает поведение остальной области графика и ручное перетаскивание шкалы.
function bindPriceScaleWheel(container) {
	if (priceScaleWheelBound) return
	priceScaleWheelBound = true
	// capture: true + stopPropagation — иначе событие доходит до встроенного
	// zoom библиотеки и график масштабируется по горизонтали вместе со шкалой.
	container.addEventListener('wheel', (event) => {
		if (!chart) return
		const rect = container.getBoundingClientRect()
		const scaleWidth = chart.priceScale('right').width()
		if (event.clientX < rect.right - scaleWidth) return
		event.preventDefault()
		event.stopPropagation()
		priceScaleMargin = Math.min(0.42, Math.max(0.01, priceScaleMargin + (event.deltaY > 0 ? 0.035 : -0.035)))
		chart.priceScale('right').applyOptions({
			autoScale: true,
			scaleMargins: { top: priceScaleMargin, bottom: priceScaleMargin },
		})
	}, { passive: false, capture: true })
}

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
		rightPriceScale: {
			borderColor: '#30363d',
			scaleMargins: { top: priceScaleMargin, bottom: priceScaleMargin },
		},
	})
	candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
		upColor: '#3fb950', downColor: '#f85149',
		borderUpColor: '#3fb950', borderDownColor: '#f85149',
		wickUpColor: '#3fb950', wickDownColor: '#f85149',
	})
	markersPlugin = LightweightCharts.createSeriesMarkers(candleSeries, [])
	bindPriceScaleWheel(container)
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
			tooltip.innerHTML = `<strong>FIB · ${fib.trigger.toUpperCase()} · ${fib.direction}</strong><br>` +
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
		// Подпись на середине линии (маркер живёт на line-series, не на свеч��х).
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

// Цвет якорной ноги 0%→100% (единый структурный режим).
const FIB_LEG_COLOR = '#d29922'

function visibleFibCandidates() {
	if (!currentData?.fib || !document.getElementById('toggleFib').checked) return []
	const showBos = document.getElementById('fibBos').checked
	const showChoch = document.getElementById('fibChoch').checked
	const filtered = currentData.fib.candidates.filter(
		(candidate) => (candidate.trigger === 'bos' ? showBos : showChoch),
	)
	if (!document.getElementById('fibLatest').checked) return filtered
	// Последние N глобально по хронологии: N=1 — самая свежая, N=2 — она и
	// предыдущая, и так последовательно назад по истории.
	const lastN = Math.max(1, Number(document.getElementById('fibLastN').value) || 1)
	return [...filtered]
		.sort((a, b) => b.createdAtIndex - a.createdAtIndex)
		.slice(0, lastN)
}

function fibLevelStyle(ratio) {
	if ([23.6, 38.2, 61.8, 78.6].includes(ratio)) return { color: '#388bfd', width: 1 }
	if ([141, 161, 241, 261].includes(ratio)) return { color: '#bc4ed8', width: 1 }
	if (ratio === 0 || ratio === 100) return { color: '#c9d1d9', width: 2 }
	return { color: '#6e7681', width: 1 }
}

function fibRatioLabel(ratio) {
	return `${ratio.toFixed(ratio % 1 === 0 ? 0 : 1).replace('.', ',')}%`
}

function renderFibCandidates(candidates, candles) {
	const lastIndex = candles.length - 1
	if (lastIndex < 0) return
	// Хронологический порядок: линии каждой сетки тянутся до следующей сетки
	// (с зазором), чтобы история читалась последовательно и без наслоений.
	const ordered = [...candidates].sort((a, b) => a.createdAtIndex - b.createdAtIndex)
	const GAP_BARS = 3

	ordered.forEach((candidate, position) => {
		const created = candles[candidate.createdAtIndex]
		if (!created) return
		const next = ordered[position + 1]
		let untilIndex = next ? next.createdAtIndex - GAP_BARS : lastIndex
		// Минимальная ширина сетки, если события идут вплотную.
		untilIndex = Math.max(untilIndex, Math.min(candidate.createdAtIndex + 5, lastIndex))
		untilIndex = Math.min(untilIndex, lastIndex)
		const until = candles[untilIndex]
		if (!until) return

		// Якорная нога 0% → 100%: показывает, от какого свинга и до какого уровня посчитана фиба.
		const startCandle = candles[candidate.start.index]
		const endCandle = candles[candidate.end.index]
		if (startCandle && endCandle) {
			const leg = chart.addSeries(LightweightCharts.LineSeries, {
				...SEGMENT_SERIES_OPTIONS,
				color: FIB_LEG_COLOR,
				lineWidth: 2,
				lineStyle: LightweightCharts.LineStyle.Dashed,
			})
			// 0% (откат) может быть ПОЗЖЕ 100% (пробитый уровень) — line series
			// требует возрастающего времени, поэтому сортируем точки и маркеры.
			const legPoints = [
				{
					time: tsToChartTime(startCandle.timestamp),
					value: candidate.start.price,
					position: candidate.direction === 'long' ? 'belowBar' : 'aboveBar',
					text: `${candidate.trigger.toUpperCase()} 0%`,
				},
				{
					time: tsToChartTime(endCandle.timestamp),
					value: candidate.end.price,
					position: candidate.direction === 'long' ? 'aboveBar' : 'belowBar',
					text: '100%',
				},
			].sort((a, b) => a.time - b.time)
			leg.setData(legPoints.map((p) => ({ time: p.time, value: p.value })))
			LightweightCharts.createSeriesMarkers(leg, legPoints.map((p) => ({
				time: p.time,
				position: p.position,
				color: FIB_LEG_COLOR,
				shape: 'circle',
				size: 0,
				text: p.text,
			})))
		}

		for (const level of candidate.levels) {
			const levelStyle = fibLevelStyle(level.ratio)
			const line = chart.addSeries(LightweightCharts.LineSeries, {
				...SEGMENT_SERIES_OPTIONS,
				color: levelStyle.color,
				lineWidth: levelStyle.width,
				lineStyle: LightweightCharts.LineStyle.Solid,
			})
			line.setData([
				{ time: tsToChartTime(created.timestamp), value: level.price },
				{ time: tsToChartTime(until.timestamp), value: level.price },
			])
			// Подпись уровня как на TV: аккуратно у начала линии, не на ценовой шкале.
			LightweightCharts.createSeriesMarkers(line, [{
				time: tsToChartTime(created.timestamp),
				position: 'inBar',
				color: levelStyle.color,
				shape: 'circle',
				size: 0,
				text: `${fibRatioLabel(level.ratio)} (${level.price.toFixed(2)})`,
			}])
		}
	})
}

function renderAll(preserveViewport = false) {
	if (!currentData) return
	const visibleLogicalRange = preserveViewport && chart
		? chart.timeScale().getVisibleLogicalRange()
		: null
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

	const visibleFib = visibleFibCandidates()
	document.getElementById('fibVisibleCount').textContent = visibleFib.length
	updateTrendLabel()
	renderFibCandidates(visibleFib, currentData.candles)
	renderProtectedSegments(currentData.protectedSegments ?? [], currentData.candles)
	if (visibleLogicalRange) chart.timeScale().setVisibleLogicalRange(visibleLogicalRange)
	else chart.timeScale().fitContent()
}

// Текущий тренд по последнему классифицированному событию канонического слоя C.
function updateTrendLabel() {
	const label = document.getElementById('trendLabel')
	if (!label || !currentData) return
	const events = (currentData.layers.C ?? currentData.layers.A ?? [])
		.filter((e) => e.type !== 'unlabeled')
	const last = events[events.length - 1]
	if (!last) {
		label.textContent = '—'
		label.style.color = '#8b949e'
		return
	}
	const bullish = last.direction === 'up'
	label.textContent = bullish ? 'Bullish' : 'Bearish'
	label.style.color = bullish ? '#3fb950' : '#f85149'
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
	// Тумблеры отображения — локальная перерисовка каноническог�� snapshot.
	for (const id of [
		'toggleA', 'toggleB', 'toggleC', 'toggleStruct', 'toggleProtected', 'toggleUnlabeled',
		'toggleFib', 'fibBos', 'fibChoch', 'fibLatest', 'fibLastN',
	]) {
		document.getElementById(id).addEventListener('change', () => renderAll(true))
	}
	// Режим пробоя меняет только диагностические A/B; pipeline C использует утверждённый дефолт.
	document.getElementById('mode').addEventListener('change', () => loadData(lastIsFresh))
	// Автозагрузка.
	loadData(false)
})
