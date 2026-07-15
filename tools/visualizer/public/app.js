// app.js — клиент визуализатора Fib Playbook.
//
// Переработан под текущий канон (SPEC 7.22–7.24): сделки канонического
// пула с тремя моделями входа (touch / closeConfirm / candleConfirm),
// косты BingX, выходы t100-only, bigbar-метка. Сервер отдаёт готовые
// сделки — клиент только фильтрует и рисует.

let chart = null
let candleSeries = null
let currentData = null
let selectedModel = 'candleConfirm'
let selectedTradeId = null
// Серии, привязанные к выбранной сделке/оверлеям — удаляются при перерисовке.
let overlaySeries = []
let markersPlugin = null
let priceScaleMargin = 0.08
let priceScaleWheelBound = false

const C = {
	green: '#26a69a',
	red: '#ef5350',
	yellow: '#ffb74d',
	blue: '#2962ff',
	dim: '#787b86',
	grid: '#1e222d',
	text: '#d1d4dc',
}

const MODEL_LABELS = {
	touch: 'touch (лимитка)',
	closeConfirm: 'closeConfirm',
	candleConfirm: 'candleConfirm',
}

function tsToChartTime(ts) { return ts / 1000 }
function fmtR(v) { return (v >= 0 ? '+' : '') + v.toFixed(2) }

// ---------- график ----------

function bindPriceScaleWheel(container) {
	if (priceScaleWheelBound) return
	priceScaleWheelBound = true
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
	if (chart) { chart.remove(); chart = null; markersPlugin = null; overlaySeries = [] }
	const container = document.getElementById('chart')
	chart = LightweightCharts.createChart(container, {
		width: container.clientWidth,
		height: container.clientHeight,
		layout: { background: { color: '#131722' }, textColor: C.text },
		grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
		crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
		timeScale: { borderColor: '#363a45', timeVisible: true, secondsVisible: false },
		rightPriceScale: {
			borderColor: '#363a45',
			scaleMargins: { top: priceScaleMargin, bottom: priceScaleMargin },
		},
	})
	candleSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
		upColor: C.green, downColor: C.red,
		borderUpColor: C.green, borderDownColor: C.red,
		wickUpColor: C.green, wickDownColor: C.red,
	})
	markersPlugin = LightweightCharts.createSeriesMarkers(candleSeries, [])
	bindPriceScaleWheel(container)
	window.addEventListener('resize', () => {
		if (chart) chart.applyOptions({ width: container.clientWidth, height: container.clientHeight })
	})

	chart.subscribeCrosshairMove((param) => {
		const tooltip = document.getElementById('tooltip')
		if (!param.time || !param.seriesData.size) { tooltip.style.display = 'none'; return }
		const idx = findCandleIndexByTime(param.time)
		if (idx === -1) { tooltip.style.display = 'none'; return }
		const trade = visibleTrades().find((t) => {
			const m = t.models[selectedModel]
			return (m.status === 'entered' && (m.entryIndex === idx || m.exitIndex === idx)) || t.touchIndex === idx
		})
		if (!trade) { tooltip.style.display = 'none'; return }
		const m = trade.models[selectedModel]
		const statusText = m.status === 'entered'
			? `${m.exitReason === 'tp' ? 'TP ✓' : 'SL ✗'} · netR ${fmtR(m.netR)}`
			: m.status
		tooltip.innerHTML = `<strong>${trade.scenario.toUpperCase()} · ${trade.direction} · ${trade.trigger.toUpperCase()}</strong><br>` +
			`Модель: ${MODEL_LABELS[selectedModel]} — ${statusText}<br>` +
			`Уровень: ${trade.level.toFixed(4)} · SL: ${trade.stop.toFixed(4)} · TP(100): ${trade.tp.toFixed(4)}` +
			(trade.bigbar ? '<br><span style="color:#ffb74d">bigbar: зона перекрыта одной свечой</span>' : '') +
			`<div class="reason">клик по сделке в списке справа — подсветка сетки</div>`
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

const SEGMENT_SERIES_OPTIONS = {
	lastValueVisible: false,
	priceLineVisible: false,
	crosshairMarkerVisible: false,
}

function addOverlayLine(points, options) {
	const line = chart.addSeries(LightweightCharts.LineSeries, { ...SEGMENT_SERIES_OPTIONS, ...options })
	line.setData(points)
	overlaySeries.push(line)
	return line
}

function clearOverlays() {
	for (const s of overlaySeries) { try { chart.removeSeries(s) } catch { /* уже удалена */ } }
	overlaySeries = []
}

// ---------- фильтры и выборка ----------

function tradeResult(trade) {
	const m = trade.models[selectedModel]
	if (m.status === 'entered') return m.netR > 0 ? 'win' : 'loss'
	if (m.status === 'unresolved') return 'open'
	return 'missed'
}

function visibleTrades() {
	if (!currentData?.trades) return []
	const scenario = document.getElementById('fScenario').value
	const direction = document.getElementById('fDirection').value
	const result = document.getElementById('fResult').value
	const bigbarOnly = document.getElementById('fBigbarOnly').checked
	const applyBigbar = document.getElementById('fApplyBigbar').checked
	return currentData.trades.filter((t) => {
		if (scenario !== 'all' && t.scenario !== scenario) return false
		if (direction !== 'all' && t.direction !== direction) return false
		if (bigbarOnly && !t.bigbar) return false
		if (applyBigbar && t.bigbar) return false
		if (result !== 'all' && tradeResult(t) !== result) return false
		return true
	})
}

// ---------- отрисовка ----------

function renderCandles(candles) {
	candleSeries.setData(candles.map((c) => ({
		time: tsToChartTime(c.timestamp),
		open: c.open, high: c.high, low: c.low, close: c.close,
	})))
}

function renderEvents() {
	if (!document.getElementById('toggleEvents').checked) return
	const candles = currentData.candles
	for (const e of currentData.events) {
		const startCandle = candles[e.levelIndex]
		const endCandle = candles[e.confirmIndex]
		if (!startCandle || !endCandle || e.levelIndex >= e.confirmIndex) continue
		const color = e.type === 'bos' ? C.blue : e.type === 'choch' ? C.red : C.dim
		const line = addOverlayLine([
			{ time: tsToChartTime(startCandle.timestamp), value: e.levelPrice },
			{ time: tsToChartTime(endCandle.timestamp), value: e.levelPrice },
		], { color, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed })
		const midCandle = candles[Math.floor((e.levelIndex + e.confirmIndex) / 2)]
		if (midCandle && e.type !== 'unlabeled') {
			LightweightCharts.createSeriesMarkers(line, [{
				time: tsToChartTime(midCandle.timestamp),
				position: e.levelType === 'high' ? 'aboveBar' : 'belowBar',
				color, shape: 'circle', size: 0,
				text: e.type.toUpperCase(),
			}])
		}
	}
}

function renderProtected() {
	if (!document.getElementById('toggleProtected').checked) return
	const candles = currentData.candles
	for (const seg of currentData.protectedSegments) {
		const startCandle = candles[seg.startIndex]
		const endCandle = candles[seg.endIndex]
		if (!startCandle || !endCandle) continue
		addOverlayLine([
			{ time: tsToChartTime(startCandle.timestamp), value: seg.price },
			{ time: tsToChartTime(endCandle.timestamp), value: seg.price },
		], { color: C.yellow, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.SparseDotted })
	}
}

// Маркеры входов/выходов выбранной модели по всем видимым сделкам.
function renderTradeMarkers() {
	const candles = currentData.candles
	const markers = []
	for (const trade of visibleTrades()) {
		const m = trade.models[selectedModel]
		if (m.status !== 'entered') {
			// missed/saved: маленький маркер на баре касания.
			const touch = candles[trade.touchIndex]
			if (touch) {
				markers.push({
					time: tsToChartTime(touch.timestamp),
					position: trade.direction === 'long' ? 'belowBar' : 'aboveBar',
					color: m.status === 'missed-stop' ? C.yellow : C.dim,
					shape: trade.direction === 'long' ? 'arrowUp' : 'arrowDown',
					size: 0,
					text: m.status === 'missed-stop' ? 'saved' : m.status === 'missed-tp' ? 'missed' : '',
				})
			}
			continue
		}
		const entryCandle = candles[m.entryIndex]
		const exitCandle = m.exitIndex != null ? candles[m.exitIndex] : null
		if (entryCandle) {
			markers.push({
				time: tsToChartTime(entryCandle.timestamp),
				position: trade.direction === 'long' ? 'belowBar' : 'aboveBar',
				color: trade.direction === 'long' ? C.green : C.red,
				shape: trade.direction === 'long' ? 'arrowUp' : 'arrowDown',
				size: 1,
				text: trade.scenario,
			})
		}
		if (exitCandle) {
			markers.push({
				time: tsToChartTime(exitCandle.timestamp),
				position: trade.direction === 'long' ? 'aboveBar' : 'belowBar',
				color: m.exitReason === 'tp' ? C.green : C.red,
				shape: 'circle',
				size: 1,
				text: fmtR(m.netR),
			})
		}
	}
	markers.sort((a, b) => a.time - b.time)
	markersPlugin.setMarkers(markers)
}

// Сетка и уровни выбранной сделки: нога 0→100, уровни фибо, вход/SL/TP.
function renderSelectedTrade() {
	if (!selectedTradeId) return
	const trade = currentData.trades.find((t) => t.id === selectedTradeId)
	if (!trade) return
	const candles = currentData.candles
	const created = candles[trade.createdAtIndex]
	const last = candles[candles.length - 1]
	const m = trade.models[selectedModel]
	const untilIndex = m.status === 'entered' && m.exitIndex != null
		? Math.min(m.exitIndex + 10, candles.length - 1)
		: Math.min(trade.touchIndex + 40, candles.length - 1)
	const until = candles[untilIndex] ?? last
	if (!created || !until) return

	// Нога 0% → 100%.
	const legStart = candles[trade.legStart.index]
	const legEnd = candles[trade.legEnd.index]
	if (legStart && legEnd) {
		const pts = [
			{ time: tsToChartTime(legStart.timestamp), value: trade.legStart.price },
			{ time: tsToChartTime(legEnd.timestamp), value: trade.legEnd.price },
		].sort((a, b) => a.time - b.time)
		addOverlayLine(pts, { color: C.yellow, lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dashed })
	}

	// Уровни сетки.
	for (const level of trade.gridLevels) {
		const isKey = [0, 100].includes(level.ratio)
		const line = addOverlayLine([
			{ time: tsToChartTime(created.timestamp), value: level.price },
			{ time: tsToChartTime(until.timestamp), value: level.price },
		], {
			color: isKey ? C.text : level.ratio > 100 ? '#b39ddb' : '#5c85d6',
			lineWidth: isKey ? 2 : 1,
		})
		LightweightCharts.createSeriesMarkers(line, [{
			time: tsToChartTime(created.timestamp),
			position: 'inBar',
			color: C.dim, shape: 'circle', size: 0,
			text: `${level.ratio}% (${level.price.toFixed(4)})`,
		}])
	}

	// Вход / SL / TP толстыми сегментами от касания.
	const touch = candles[trade.touchIndex]
	if (touch) {
		const mk = (price, color) => addOverlayLine([
			{ time: tsToChartTime(touch.timestamp), value: price },
			{ time: tsToChartTime(until.timestamp), value: price },
		], { color, lineWidth: 2 })
		if (m.status === 'entered' && m.entryPrice != null) mk(m.entryPrice, C.blue)
		mk(trade.stop, C.red)
		mk(trade.tp, C.green)
	}
}

function focusTrade(trade) {
	const candles = currentData.candles
	const m = trade.models[selectedModel]
	const from = Math.max(0, trade.createdAtIndex - 20)
	const toIdx = m.status === 'entered' && m.exitIndex != null ? m.exitIndex : trade.touchIndex
	const to = Math.min(candles.length - 1, toIdx + 25)
	chart.timeScale().setVisibleRange({
		from: tsToChartTime(candles[from].timestamp),
		to: tsToChartTime(candles[to].timestamp),
	})
}

// ---------- панели ----------

function renderModelsTable() {
	const table = document.getElementById('modelsTable')
	const trades = visibleTrades()
	const header = `<tr><th>модель</th><th>in</th><th>WR</th><th>ΣR</th><th>avgR</th><th>saved</th><th>missed</th></tr>`
	const rows = ['touch', 'closeConfirm', 'candleConfirm'].map((model) => {
		const entered = trades.filter((t) => t.models[model].status === 'entered')
		const total = entered.reduce((s, t) => s + t.models[model].netR, 0)
		const wins = entered.filter((t) => t.models[model].netR > 0)
		const saved = trades.filter((t) => t.models[model].status === 'missed-stop')
		const missed = trades.filter((t) => t.models[model].status === 'missed-tp')
		// Counterfactual: netR touch-модели по спасённым/упущенным.
		const cfSaved = saved.reduce((s, t) => s + (t.models.touch.netR ?? 0), 0)
		const cfMissed = missed.reduce((s, t) => s + (t.models.touch.netR ?? 0), 0)
		const avg = entered.length ? total / entered.length : 0
		const cls = (v) => v > 0 ? 'pos' : v < 0 ? 'neg' : 'dim'
		return `<tr data-model="${model}" class="${model === selectedModel ? 'active' : ''}">
			<td>${MODEL_LABELS[model]}</td>
			<td>${entered.length}</td>
			<td>${entered.length ? Math.round((100 * wins.length) / entered.length) : 0}%</td>
			<td class="${cls(total)}">${fmtR(total)}</td>
			<td class="${cls(avg)}">${fmtR(avg)}</td>
			<td title="cf ${fmtR(cfSaved)}">${saved.length}</td>
			<td title="cf ${fmtR(cfMissed)}">${missed.length}</td>
		</tr>`
	}).join('')
	table.innerHTML = header + rows
	table.querySelectorAll('tr[data-model]').forEach((tr) => {
		tr.addEventListener('click', () => {
			selectedModel = tr.dataset.model
			redraw()
		})
	})
}

function renderTradesList() {
	const list = document.getElementById('tradesList')
	const trades = visibleTrades()
	document.getElementById('tradesCount').textContent =
		`${trades.length} сделок · модель: ${MODEL_LABELS[selectedModel]}`
	list.innerHTML = ''
	// Свежие сверху.
	const ordered = [...trades].sort((a, b) => b.touchIndex - a.touchIndex)
	for (const trade of ordered) {
		const m = trade.models[selectedModel]
		const row = document.createElement('div')
		row.className = 'trade-row' + (trade.id === selectedTradeId ? ' selected' : '')
		const netRText = m.status === 'entered'
			? `<span class="netr ${m.netR > 0 ? 'pos' : 'neg'}">${fmtR(m.netR)}</span>`
			: `<span class="status">${m.status.replace('missed-', '')}</span>`
		row.innerHTML = `
			<span class="dir ${trade.direction}">${trade.direction === 'long' ? 'LONG' : 'SHORT'}</span>
			<span class="scen">${trade.scenario}</span>
			${trade.bigbar ? '<span class="badge">BB</span>' : ''}
			${netRText}`
		row.addEventListener('click', () => {
			selectedTradeId = trade.id === selectedTradeId ? null : trade.id
			redraw()
			if (selectedTradeId) focusTrade(trade)
		})
		list.appendChild(row)
	}
}

// ---------- главный цикл ----------

function redraw() {
	if (!currentData) return
	clearOverlays()
	renderEvents()
	renderProtected()
	renderTradeMarkers()
	renderSelectedTrade()
	renderModelsTable()
	renderTradesList()
}

function setStatus(text) {
	const el = document.getElementById('status')
	if (!text) { el.style.display = 'none'; return }
	el.textContent = text
	el.style.display = 'block'
}

async function load() {
	const btn = document.getElementById('loadBtn')
	btn.disabled = true
	setStatus('Загрузка…')
	try {
		const symbol = document.getElementById('symbol').value.trim() || 'BTC/USDT'
		const tf = document.querySelector('#tfGroup button.active')?.dataset.tf ?? '30m'
		const limit = Number(document.getElementById('limit').value) || 2000
		const source = document.getElementById('source').value
		const params = new URLSearchParams({ symbol, timeframe: tf, limit: String(limit), source })
		const res = await fetch(`/api/analyze?${params}`)
		const data = await res.json()
		if (data.error) throw new Error(data.error)
		currentData = data
		selectedTradeId = null
		initChart()
		renderCandles(data.candles)
		redraw()
		chart.timeScale().fitContent()
		document.getElementById('datasetLabel').textContent =
			`${data.dataset.symbol} · ${data.dataset.timeframe} · ${data.dataset.candleCount} свечей · ${data.dataset.source} · тренд: ${data.finalTrend}`
		setStatus(null)
	} catch (err) {
		setStatus(`Ошибка: ${err.message}`)
	} finally {
		btn.disabled = false
	}
}

async function loadSymbols() {
	try {
		const res = await fetch('/api/symbols')
		const data = await res.json()
		if (!data.symbols) return
		const datalist = document.getElementById('symbolsList')
		datalist.innerHTML = data.symbols.map((s) => `<option value="${s}"></option>`).join('')
	} catch { /* автодополнение опционально */ }
}

// ---------- события UI ----------

document.getElementById('loadBtn').addEventListener('click', load)
document.getElementById('symbol').addEventListener('keydown', (e) => {
	if (e.keyCode === 229 || e.isComposing) return
	if (e.key === 'Enter') load()
})
document.querySelectorAll('#tfGroup button').forEach((btn) => {
	btn.addEventListener('click', () => {
		document.querySelectorAll('#tfGroup button').forEach((b) => b.classList.remove('active'))
		btn.classList.add('active')
		load()
	})
})
for (const id of ['fScenario', 'fDirection', 'fResult', 'fBigbarOnly', 'fApplyBigbar', 'toggleEvents', 'toggleProtected']) {
	document.getElementById(id).addEventListener('change', redraw)
}

initChart()
loadSymbols()
load()
