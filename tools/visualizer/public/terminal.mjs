// terminal.mjs — клей скина «TradingView-терминал» (terminal.html). НЕ дублирует логику
// панелей: все id и секции те же, что в classic UI, app.mjs работает без изменений.
// Здесь: тема графика (глобаль ДО app.mjs), вкладки дока/низа, рэйл быстрых слоёв,
// ресайз панелей, статусбар, OHLC-легенда. Загружается РАНЬШЕ app.mjs (порядок в HTML).

// Тема графика читается в lib/chart.mjs initChart() — ставим первой строкой.
window.__VIZ_CHART_THEME__ = {
	bg: '#131722', text: '#b2b5be', grid: '#1e222d', border: '#2a2e39',
	up: '#26a69a', down: '#ef5350',
}

import { S, onModeChange } from './lib/state.mjs'
import { $, time } from './lib/format.mjs'
import { chart } from './lib/chart.mjs'

// ---------- Вкладки дока и нижней панели ----------

const dock = $('tvDock')
const bottom = $('tvBottom')

function showDockTab(name) {
	document.querySelectorAll('#tvDockTabs [data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === name))
	document.querySelectorAll('.tv-dock-body .section').forEach((s) => s.classList.toggle('tv-active', s.dataset.tab === name))
	dock.classList.remove('collapsed')
	syncRail()
}
function showBottomTab(name) {
	document.querySelectorAll('#tvBottomTabs [data-btab]').forEach((b) => b.classList.toggle('active', b.dataset.btab === name))
	document.querySelectorAll('.tv-bottom-body .section').forEach((s) => s.classList.toggle('tv-active', s.dataset.btab === name))
	bottom.classList.remove('collapsed')
	$('tvBottomCollapse').textContent = '▾'
}

document.querySelectorAll('#tvDockTabs [data-tab]').forEach((b) => { b.onclick = () => showDockTab(b.dataset.tab) })
document.querySelectorAll('#tvBottomTabs [data-btab]').forEach((b) => { b.onclick = () => showBottomTab(b.dataset.btab) })

$('tvBottomCollapse').onclick = () => {
	const c = bottom.classList.toggle('collapsed')
	$('tvBottomCollapse').textContent = c ? '▴' : '▾'
}

// ---------- Рэйл быстрых слоёв ----------

const railActions = {
	zones: () => $('poiZoneToggle').click(),
	conf: () => $('confToggle').click(),
	hm: () => $('hmToggle').click(),
	apex: () => $('apexChk').click(),
	reversal: () => $('reversalChk').click(),
	lab: () => $('labToggle').click(),
	panel: () => { dock.classList.toggle('collapsed'); syncRail() },
}
document.querySelectorAll('#tvRail [data-rail]').forEach((b) => { b.onclick = () => railActions[b.dataset.rail]?.() })

function syncRail() {
	const st = {
		zones: S.mode === 'zones', conf: S.mode === 'conf', lab: S.mode === 'lab',
		hm: !!S.hmOn,
		apex: !!$('apexChk')?.checked, reversal: !!$('reversalChk')?.checked,
		panel: !dock.classList.contains('collapsed'),
	}
	document.querySelectorAll('#tvRail [data-rail]').forEach((b) => b.classList.toggle('active', !!st[b.dataset.rail]))
}

// Открытие режима (кнопкой, палитрой, хоткеем) подсвечивает его вкладку в доке.
onModeChange((mode) => {
	const tab = { zones: 'zones', conf: 'conf', lab: 'lab' }[mode]
	if (tab) showDockTab(tab)
	syncRail()
})

// ---------- Поповер «Данные» ----------

const dataPop = $('tvDataPop')
$('tvDataBtn').onclick = () => dataPop.classList.toggle('hidden')
document.addEventListener('mousedown', (e) => {
	if (dataPop.classList.contains('hidden')) return
	if (!dataPop.contains(e.target) && e.target !== $('tvDataBtn')) dataPop.classList.add('hidden')
})

// ---------- Ресайз панелей ----------

function drag(el, onMove, onEnd) {
	el.addEventListener('pointerdown', (e) => {
		e.preventDefault()
		el.classList.add('drag')
		el.setPointerCapture(e.pointerId)
		const move = (ev) => onMove(ev)
		const up = () => {
			el.classList.remove('drag')
			el.removeEventListener('pointermove', move)
			el.removeEventListener('pointerup', up)
			onEnd?.()
		}
		el.addEventListener('pointermove', move)
		el.addEventListener('pointerup', up)
	})
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

drag($('tvSplitH'), (e) => {
	bottom.classList.remove('collapsed')
	$('tvBottomCollapse').textContent = '▾'
	bottom.style.height = `${clamp(window.innerHeight - e.clientY - 26, 120, window.innerHeight * 0.7)}px`
})
drag($('tvSplitV'), (e) => {
	dock.classList.remove('collapsed')
	dock.style.width = `${clamp(window.innerWidth - e.clientX, 300, Math.min(640, window.innerWidth * 0.6))}px`
	syncRail()
})
$('tvSplitH').ondblclick = () => $('tvBottomCollapse').click()
$('tvSplitV').ondblclick = () => { dock.classList.toggle('collapsed'); syncRail() }

// ---------- Статусбар ----------

function syncStatus() {
	const ds = $('dataset')?.textContent?.trim()
	$('tvStatusDataset').textContent = ds && ds !== '—' ? ds : 'нет данных'
	$('tvStatusVersion').textContent = $('version')?.textContent?.trim() || '—'
	$('tvStatusDot').classList.toggle('live', !!S.data)
}
setInterval(() => {
	$('tvClock').textContent = new Date().toLocaleTimeString('ru-RU')
}, 1000)

// ---------- OHLC-легенда графика ----------

const fmt = (v) => (v == null ? '—'
	: v >= 1000 ? v.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
	: v >= 100 ? v.toFixed(2)
	: v >= 1 ? v.toFixed(3)
	: v.toFixed(5))

let legendChart = null
let hoveredAt = 0 // пока курсор на графике, цикл не перетирает OHLC-строку базовой подписью
function legendBase() {
	const d = S.data?.dataset
	$('tvLegend').innerHTML = d
		? `<b>${d.symbol}</b><span>${d.timeframe}</span><span>${d.candleCount} свечей</span>`
		: '<b>SMC Terminal</b><span>нет данных</span>'
}
function onLegendHover(p) {
	if (!S.data || (S.mode !== 'trades' && S.mode !== 'zones')) return
	if (!p.time) { hoveredAt = 0; legendBase(); return }
	hoveredAt = Date.now()
	const i = S.data.candles.findIndex((c) => time(c.timestamp) === p.time)
	const c = S.data.candles[i]
	if (!c) { legendBase(); return }
	const chg = c.open ? ((c.close - c.open) / c.open) * 100 : 0
	const cls = c.close >= c.open ? 'up' : 'down'
	const d = S.data.dataset
	$('tvLegend').innerHTML = `<b>${d.symbol}</b><span>${d.timeframe}</span>`
		+ `<span>O <b class="${cls}">${fmt(c.open)}</b></span><span>H <b class="${cls}">${fmt(c.high)}</b></span>`
		+ `<span>L <b class="${cls}">${fmt(c.low)}</b></span><span>C <b class="${cls}">${fmt(c.close)}</b></span>`
		+ `<span class="${cls}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span>`
}
function ensureLegend() {
	if (!chart || chart === legendChart) return
	legendChart = chart
	chart.subscribeCrosshairMove(onLegendHover)
}

// Лёгкий цикл синхронизации: легенда/статус/рэйл читают общий стор S —
// дешевле, чем расставлять события по всем панелям (их код не трогаем).
// legendBase в цикле: load() зовёт redraw() напрямую, без события viz:redraw;
// но не чаще чем через 1.5с после ухода курсора — иначе затирает OHLC-строку.
setInterval(() => { ensureLegend(); if (Date.now() - hoveredAt > 1500) legendBase(); syncStatus(); syncRail() }, 700)
document.addEventListener('viz:redraw', () => { legendBase(); syncStatus() })

legendBase()
showDockTab('zones')
showBottomTab('trades')
syncRail()
syncStatus()
