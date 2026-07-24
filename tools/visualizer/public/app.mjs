// app.mjs — вход визуализатора: загрузка данных, маршрутизация режимов, единый
// crosshair-обработчик (тултипы сделок/полос heatmap, hover-карточки зон, клик-фокус),
// горячие клавиши (Cmd/Ctrl+K, ←/→, ↑/↓, Esc), сворачивание секций.

import { S, setMode } from './lib/state.mjs'
import { $, esc, time } from './lib/format.mjs'
import { initChart, restoreMainCandles, setCandles, fitContent, priceAt, rectAt } from './lib/chart.mjs'
import { fetchAnalyze, fetchSymbols } from './lib/api.mjs'
import { renderTradesMode, wireStatsPanel, navigateTrades, tradeTooltip, renderFunnel } from './panels/stats.mjs'
import { hmBandTooltip, wireHeatmapPanel, hmApplyTfDefaults, drawHmProfile } from './panels/heatmap.mjs'
import { renderZones, wireZonesPanel, moveZoneFocus, zoneHoverHtml } from './panels/zones.mjs'
import { renderConfirmation, wireConfirmationPanel, moveConfirmation } from './panels/confirmation.mjs'
import { renderLab, wireLabPanel, moveLab, exitLabVisuals } from './panels/lab.mjs'
import { renderConfigPanel, setEngineDefaults, wireConfigPanel } from './panels/config.mjs'
import { wirePalette, openPalette, closePalette, paletteOpen, setPaletteSymbols } from './lib/palette.mjs'

// ---- Режимы ----

const MODE_PANELS = { zones: 'poiZone', conf: 'conf', lab: 'lab' }

function activateMode(mode) {
	// Свернуть контролы прежнего режима.
	for (const [m, prefix] of Object.entries(MODE_PANELS)) {
		const on = m === mode
		$(`${prefix}Controls`).classList.toggle('hidden', !on)
		$(`${prefix}Toggle`).textContent = on ? 'Закрыть' : 'Открыть'
		$(`${prefix}Toggle`).classList.toggle('on', on)
	}
	if (mode !== 'lab') exitLabVisuals()
	if (mode === 'zones') S.poiFocusId = null
	setMode(mode)
	redraw()
}
function deactivateMode() {
	for (const prefix of Object.values(MODE_PANELS)) {
		$(`${prefix}Controls`).classList.add('hidden')
		$(`${prefix}Toggle`).textContent = 'Открыть'
		$(`${prefix}Toggle`).classList.remove('on')
	}
	exitLabVisuals()
	setMode('trades')
	restoreMainCandles()
	redraw()
	fitContent()
}

export function redraw() {
	if (!S.data) return
	const safe = (f) => { try { f() } catch (e) { console.error('render step failed:', e) } }
	if (S.mode === 'zones') { safe(renderZones); return }
	if (S.mode === 'conf') { safe(renderConfirmation); return }
	if (S.mode === 'lab') { safe(renderLab); return }
	safe(renderTradesMode)
}

// ---- Тултипы и hover-карточки ----

function onCrosshair(p) {
	const tip = $('tooltip')
	const hover = $('zoneHover')
	if (!p.time || !p.point || S.mode === 'lab') { tip.classList.add('hidden'); hover.classList.add('hidden'); return }
	const price = priceAt(p.point.y)
	// Зоны: hover-карточка прямоугольника.
	if (S.mode === 'zones' || (S.mode === 'conf' && S.confZonesMode)) {
		tip.classList.add('hidden')
		const r = price != null ? rectAt(p.time, price) : null
		if (r) {
			hover.innerHTML = zoneHoverHtml(r)
			hover.style.left = `${Math.min(p.point.x + 16, $('chart').clientWidth - 300)}px`
			hover.style.top = `${Math.max(8, p.point.y - 40)}px`
			hover.classList.remove('hidden')
		} else hover.classList.add('hidden')
		return
	}
	hover.classList.add('hidden')
	// Боевой режим: тултип сделки, иначе — полосы heatmap.
	let html = null
	if (S.mode === 'trades') {
		const i = S.data?.candles.findIndex((c) => time(c.timestamp) === p.time)
		html = tradeTooltip(i)
	}
	if (!html && S.hmOn) html = hmBandTooltip(price)
	if (!html) { tip.classList.add('hidden'); return }
	tip.innerHTML = html
	tip.style.left = `${Math.min(p.point.x + 16, $('chart').clientWidth - 340)}px`
	tip.style.top = `${Math.max(8, p.point.y - 45)}px`
	tip.classList.remove('hidden')
}

function onChartClick(p) {
	if (S.mode !== 'zones' || !p.time || !p.point) return
	const price = priceAt(p.point.y)
	const r = price != null ? rectAt(p.time, price) : null
	if (r) { S.poiFocusId = S.poiFocusId === r.id ? null : r.id; renderZones() }
}

// ---- Загрузка ----

function status(text) {
	$('loading').classList.toggle('hidden', !text)
	$('loading').textContent = text || ''
}

async function load() {
	$('loadBtn').disabled = true
	document.body.classList.add('is-loading')
	status('Загрузка данных…')
	try {
		const json = await fetchAnalyze()
		S.data = json
		S.selectedId = null
		S.poiFocusId = null
		S.confIndex = 0
		S.confZonesMode = false
		S.lab = { ...S.lab, index: 0, cursorAt: 0, revealed: false, order: [] }
		deactivateModeSilent()
		initChart(onCrosshair, onChartClick, drawHmProfile)
		setCandles(S.data.candles, true)
		$('version').textContent = `${json.liquidityPoi?.version || ''} · ${json.strategy.version}`
		$('dataset').textContent = `${json.dataset.symbol} · ${json.dataset.timeframe} · ${json.dataset.candleCount} свечей${json.dataset.until ? ` · до ${json.dataset.until.slice(0, 10)}` : ''} · ${json.finalTrend}`
		setEngineDefaults(json.engineDefaults)
		renderFunnel()
		redraw()
		fitContent()
		status('')
	} catch (e) {
		status(`Ошибка: ${e.message}`)
	} finally {
		$('loadBtn').disabled = false
		document.body.classList.remove('is-loading')
	}
}
function deactivateModeSilent() {
	for (const prefix of Object.values(MODE_PANELS)) {
		$(`${prefix}Controls`).classList.add('hidden')
		$(`${prefix}Toggle`).textContent = 'Открыть'
		$(`${prefix}Toggle`).classList.remove('on')
	}
	exitLabVisuals()
	setMode('trades')
}

function randomHistoricalPeriod() {
	const from = Date.UTC(2024, 2, 1), to = Date.now()
	const at = from + Math.floor(Math.random() * (to - from))
	$('historyUntil').value = new Date(at).toISOString().slice(0, 10)
	load()
}

// ---- Сворачивание секций сайдбара ----

function wireSections() {
	document.querySelectorAll('.section > .section-head').forEach((head) => {
		head.addEventListener('click', (e) => {
			if (e.target.closest('button, select, input, label')) return
			head.parentElement.classList.toggle('collapsed')
			drawHmProfile()
		})
	})
}

// ---- Горячие клавиши ----

function wireHotkeys() {
	document.addEventListener('keydown', (e) => {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); paletteOpen() ? closePalette() : openPalette(); return }
		if (paletteOpen()) return
		if (e.target.closest('input, textarea, select')) return
		if (e.key === 'Escape') { closePalette(); return }
		if (S.mode === 'lab') {
			if (e.key === 'ArrowLeft') moveLab(-1)
			if (e.key === 'ArrowRight') moveLab(1)
			return
		}
		if (S.mode === 'zones') {
			if (e.key === 'ArrowLeft') moveZoneFocus(-1)
			if (e.key === 'ArrowRight') moveZoneFocus(1)
			return
		}
		if (S.mode === 'conf') {
			if (e.key === 'ArrowLeft') moveConfirmation(-1)
			if (e.key === 'ArrowRight') moveConfirmation(1)
			return
		}
		if (e.key === 'ArrowUp') { e.preventDefault(); navigateTrades(-1) }
		if (e.key === 'ArrowDown') { e.preventDefault(); navigateTrades(1) }
	})
}

// ---- Инициализация ----

async function loadSymbols() {
	const symbols = await fetchSymbols()
	if (symbols.length) {
		$('symbolsList').innerHTML = symbols.map((s) => `<option value="${esc(s)}">`).join('')
		setPaletteSymbols(symbols)
	}
}

function init() {
	initChart(onCrosshair, onChartClick, drawHmProfile)
	wireStatsPanel()
	wireHeatmapPanel(redraw)
	wireZonesPanel(activateMode, deactivateMode)
	wireConfirmationPanel(activateMode, deactivateMode)
	wireLabPanel(activateMode, deactivateMode)
	wireConfigPanel()
	wirePalette()
	wireSections()
	wireHotkeys()
	renderConfigPanel()

	$('loadBtn').onclick = load
	$('randomPeriod').onclick = randomHistoricalPeriod
	$('symbol').addEventListener('keydown', (e) => { if (e.key === 'Enter') load() })
	document.querySelectorAll('#tfGroup button').forEach((b) => {
		b.onclick = () => {
			document.querySelectorAll('#tfGroup button').forEach((x) => x.classList.remove('active'))
			b.classList.add('active')
			hmApplyTfDefaults(b.dataset.tf)
			load()
		}
	})
	hmApplyTfDefaults(document.querySelector('#tfGroup .active')?.dataset.tf)
	document.addEventListener('viz:redraw', redraw)
	document.addEventListener('viz:reload', load)
	loadSymbols()
	status('Выбери символ и ТФ, затем «Загрузить» — автозагрузки нет')
}

init()
