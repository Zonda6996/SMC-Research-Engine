import { S } from '../lib/state.mjs'
import { $, cls, dt, esc, fmtP, fmtR, time } from '../lib/format.mjs'
import { apexPrim, line, lineStyle, seriesMarkers } from '../lib/chart.mjs'

const APEX_KEY = 'smc-indicator-settings-v3'
const ARROW_KEY = 'smc-signal-arrow-settings-v1'
const OLD_KEYS = ['smc-indicator-settings-v2', 'smc-indicator-settings-v1']
const APEX_DEF = {
	source: 'hlc3', lookback: 200, kInner: 5.6, kOuter: 9.6, priceLabels: true,
	meanOn: true, meanColor: '#4f83ff', meanWidth: 2,
	redLoOn: true, redLoColor: '#f4506a', redLoWidth: 1, redHiOn: true, redHiColor: '#f4506a', redHiWidth: 1,
	greenHiOn: true, greenHiColor: '#2fd08c', greenHiWidth: 1, greenLoOn: true, greenLoColor: '#2fd08c', greenLoWidth: 1,
	upperFillOn: true, upperFillColor: '#f4506a', lowerFillOn: true, lowerFillColor: '#2fd08c'
}
const ARROW_DEF = {
	buyOn: true, buyColor: '#2fd08c', sellOn: true, sellColor: '#f4506a', exitMarkers: false,
	arrowMode: 'standard', filterMode: 'off', statsRange: 'loaded', includeCosts: true, arrowSize: 1
}
const APEX_IDS = Object.keys(APEX_DEF), ARROW_IDS = Object.keys(ARROW_DEF)
const DOM = { source: 'apexSource', lookback: 'apexLookback', kInner: 'apexKInner', kOuter: 'apexKOuter' }
const serverIds = new Set(['source', 'lookback', 'kInner', 'kOuter', 'arrowMode', 'filterMode'])
const elFor = (id) => $(DOM[id] || id)
let selectedArrowTradeId = null

function parseStored(key) { try { return JSON.parse(localStorage.getItem(key) || '{}') } catch { return {} } }
function readApex() {
	let legacy = {}
	for (const key of OLD_KEYS) { legacy = parseStored(key); if (Object.keys(legacy).length) break }
	return { ...APEX_DEF, ...legacy, ...parseStored(APEX_KEY) }
}
function readArrows() {
	let legacy = {}
	for (const key of OLD_KEYS) { legacy = parseStored(key); if (Object.keys(legacy).length) break }
	return { ...ARROW_DEF, arrowMode: legacy.riskMode || ARROW_DEF.arrowMode, ...legacy, ...parseStored(ARROW_KEY) }
}
function saveApex(x) { localStorage.setItem(APEX_KEY, JSON.stringify(x)) }
function saveArrows(x) { localStorage.setItem(ARROW_KEY, JSON.stringify(x)) }
const width = (x) => Math.max(1, Math.min(4, Number(x) || 1))
const arrowSize = (x) => Math.max(1, Math.min(3, Number(x) || 1))
function readDom(def, ids, stored) { const x = { ...stored }; for (const id of ids) { const el = elFor(id); if (!el) continue; if (el.type === 'checkbox') x[id] = el.checked; else if (el.type === 'number') x[id] = Number(el.value); else x[id] = el.value } return { ...def, ...x } }
export function indicatorStyle() { return { ...readDom(APEX_DEF, APEX_IDS, readApex()), ...readDom(ARROW_DEF, ARROW_IDS, readArrows()) } }
export function indicatorServerConfig() { const x = indicatorStyle(); return { apex: { source: x.source, lookback: x.lookback, kInner: x.kInner, kOuter: x.kOuter }, arrowMode: x.arrowMode, filterMode: x.filterMode } }
function put(x, ids) { for (const id of ids) { const el = elFor(id); if (!el) continue; if (el.type === 'checkbox') el.checked = Boolean(x[id]); else el.value = x[id] } }
function markChanged() { const x = indicatorStyle(); for (const id of serverIds) { const el = elFor(id); const def = id === 'arrowMode' ? ARROW_DEF[id] : APEX_DEF[id]; el?.closest('.indicator-field')?.classList.toggle('changed', String(x[id]) !== String(def)) } }
function saveCurrent() { const x = indicatorStyle(); saveApex(Object.fromEntries(APEX_IDS.map(id => [id, x[id]]))); saveArrows(Object.fromEntries(ARROW_IDS.map(id => [id, x[id]]))) }
export function wireIndicatorSettings(redraw) {
	put(readApex(), APEX_IDS); put(readArrows(), ARROW_IDS); markChanged()
	for (const id of [...APEX_IDS, ...ARROW_IDS]) {
		const el = elFor(id)
		if (!el) continue
		el.onchange = () => {
			saveCurrent()
			markChanged()
			if (id === 'filterMode' || id === 'arrowMode') {
				document.dispatchEvent(new CustomEvent('viz:reload'))
			} else if (!serverIds.has(id)) {
				redraw()
			}
		}
	}
	$('indicatorApply').onclick = () => { saveCurrent(); document.dispatchEvent(new CustomEvent('viz:reload')) }
	$('indicatorReset').onclick = () => { saveApex({ ...APEX_DEF }); saveArrows({ ...ARROW_DEF }); put(APEX_DEF, APEX_IDS); put(ARROW_DEF, ARROW_IDS); selectedArrowTradeId = null; markChanged(); document.dispatchEvent(new CustomEvent('viz:reload')) }
	for (const id of ['apexChk', 'signalArrowsChk']) $(id).onchange = redraw
}

function summarize(trades, includeCosts) {
	const values = trades.map(t => includeCosts ? t.netR : t.grossR)
	const gains = values.filter(x => x > 0).reduce((s, x) => s + x, 0), losses = -values.filter(x => x < 0).reduce((s, x) => s + x, 0)
	const holding = trades.map(t => t.holdingBars).sort((a, b) => a - b), middle = Math.floor(holding.length / 2)
	const fullTp = trades.filter(t => t.outcome === 'full-tp').length, partial = trades.filter(t => t.outcome === 'partial-be' || t.outcome === 'partial-stop').length, stop = trades.filter(t => t.outcome === 'stop').length, finalized = fullTp + partial + stop
	return {
		signals: trades.length, fullTp, partial,
		partialBe: trades.filter(t => t.outcome === 'partial-be').length, partialStop: trades.filter(t => t.outcome === 'partial-stop').length,
		stop, timeout: trades.filter(t => t.outcome === 'timeout').length, open: trades.filter(t => t.outcome === 'open').length,
		totalNetR: values.reduce((s, x) => s + x, 0), meanNetR: values.length ? values.reduce((s, x) => s + x, 0) / values.length : null,
		profitFactor: losses > 0 ? gains / losses : gains > 0 ? Number.POSITIVE_INFINITY : null, positiveRate: values.length ? values.filter(x => x > 0).length / values.length : null,
		vendorStyleWinrate: finalized ? (partial + fullTp) / finalized : 0,
		medianHoldingBars: holding.length ? (holding.length % 2 ? holding[middle] : (holding[middle - 1] + holding[middle]) / 2) : null,
		long: trades.filter(t => t.side === 'long').length, short: trades.filter(t => t.side === 'short').length
	}
}
function groupMarkersByTimestamp(rawMarks) {
	const byTime = new Map()
	for (const m of rawMarks) { const key = `${m.time}`; if (!byTime.has(key)) byTime.set(key, []); byTime.get(key).push(m) }
	const merged = []
	for (const group of byTime.values()) {
		if (group.length === 1) { merged.push(group[0]) }
		else {
			const arrow = group.find(x => x.shape === 'arrowUp' || x.shape === 'arrowDown')
			const exits = group.filter(x => x !== arrow)
			const exitTexts = exits.map(e => e.text).join(' + ')
			const combinedText = arrow ? `${arrow.text} | ${exitTexts}` : exitTexts
			const leadColor = arrow ? arrow.color : exits[0].color
			const leadShape = arrow ? arrow.shape : 'circle'
			const leadPos = arrow ? arrow.position : exits[0].position
			merged.push({ time: group[0].time, position: leadPos, color: leadColor, shape: leadShape, size: arrow ? arrow.size : 1, text: combinedText })
		}
	}
	return merged.sort((a, b) => a.time - b.time)
}

const metric = (name, value, tone = '') => `<div class="arrow-hud-row"><span>${name}</span><b class="${tone}">${value}</b></div>`
export function updateSignalArrowHud(visibleRange = null) {
	const box = $('signalArrowHud'), payload = S.data?.indicators?.main?.signalArrows, style = indicatorStyle()
	if (!box || !payload || !$('signalArrowsChk')?.checked || S.mode !== 'trades') { box?.classList.add('hidden'); return }
	const currentMode = style.arrowMode || payload.mode || 'standard'
	const modeData = payload.modes?.[currentMode] || (payload.mode === currentMode ? payload : null)
	const all = modeData?.trades || payload.trades || []
	const trades = style.statsRange === 'visible' && visibleRange ? all.filter(t => time(t.signalAt)>=visibleRange.from && time(t.signalAt)<=visibleRange.to) : all
	const s = style.statsRange === 'loaded' && style.includeCosts && modeData?.summary ? modeData.summary : summarize(trades, style.includeCosts)
	const pf = s.profitFactor == null ? '—' : Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'
	box.innerHTML = `
  <div class="arrow-hud-head">
    <div><strong>SIGNAL ARROWS · ${esc(S.data.dataset.symbol)} ${esc(String(S.data.dataset.timeframe).toUpperCase())}</strong><span>${style.statsRange === 'visible' ? 'видимый диапазон' : `${payload.evaluatedBars} evaluated · ${payload.loadedBars} loaded`}</span></div>
  </div>
  <div class="arrow-hud-tabs">
    <button class="arrow-hud-tab ${currentMode === 'safe' ? 'active' : ''}" data-mode="safe">SAFE</button>
    <button class="arrow-hud-tab ${currentMode === 'risk' ? 'active' : ''}" data-mode="risk">RISK</button>
    <button class="arrow-hud-tab ${currentMode === 'standard' ? 'active' : ''}" data-mode="standard">STANDARD</button>
  </div>
  <div class="arrow-hud-grid">
    ${metric('Signals', s.signals)}
    ${metric('Long / Short', `${s.long}L / ${s.short}S`)}
    ${metric('Full TP', s.fullTp, 'pos')}
    ${metric('Partial', s.partial)}
    ${metric('Partial → BE', s.partialBe)}
    ${metric('Partial → Stop', s.partialStop, 'neg')}
    ${metric('Stop', s.stop, 'neg')}
    ${metric('Open / TO', `${s.open} / ${s.timeout}`)}
  </div>
  <div class="arrow-hud-foot">
    ${metric(style.includeCosts ? 'Net R' : 'Gross R', fmtR(s.totalNetR), cls(s.totalNetR))}
    ${metric('Mean R', fmtR(s.meanNetR), cls(s.meanNetR))}
    ${metric('PF', pf)}
    ${metric('Positive', s.positiveRate == null ? '—' : `${(s.positiveRate * 100).toFixed(1)}%`)}
    ${metric('Vendor WR', s.vendorStyleWinrate == null ? '—' : `${(s.vendorStyleWinrate * 100).toFixed(1)}%`)}
    ${metric('Median Hold', s.medianHoldingBars == null ? '—' : `${s.medianHoldingBars} bars`)}
  </div>`
	box.querySelectorAll('.arrow-hud-tab').forEach(btn => {
		btn.onclick = (e) => {
			e.stopPropagation()
			const m = btn.dataset.mode
			const arrows = readArrows()
			arrows.arrowMode = m
			saveArrows(arrows)
			put(arrows, ['arrowMode'])
			markChanged()
			document.dispatchEvent(new CustomEvent('viz:redraw'))
		}
	})
	box.classList.remove('hidden')
}

function selectedTrade(payload) {
	const currentMode = indicatorStyle().arrowMode || 'standard'
	const modeData = payload?.signalArrows?.modes?.[currentMode] || payload?.signalArrows
	const trades = modeData?.trades || []
	return trades.find(t => t.id === selectedArrowTradeId) || null
}
function drawSelectedTrade(payload, from, to) {
	const trade = selectedTrade(payload); if (!trade) return
	const end = time(trade.exitAt ?? to * 1000), start = time(trade.entryAt), points = (price) => [{ time: start, value: price }, { time: Math.max(start, end), value: price }]
	const draw = (price, color, text, style = lineStyle().Solid) => { if (price == null || !Number.isFinite(price)) return; const s = line(points(price), { color, lineWidth: 2, lineStyle: style, autoscale: false }); seriesMarkers(s, [{ time: start, position: 'inBar', color, shape: 'circle', size: 0, text }]) }
	draw(trade.entry, '#5b8cff', `ENTRY ${fmtP(trade.entry)}`)
	draw(trade.add, '#9a7bff', `ADD ${fmtP(trade.add)}${trade.addFilled ? ' · filled' : ''}`, lineStyle().Dotted)
	draw(trade.stop, '#f4506a', `STOP ${fmtP(trade.stop)}`)
	if (trade.management === 'moving-apex' && trade.trajectory?.length) {
		const mean = trade.trajectory.map(p => ({ time: time(p.at), value: p.mean })), full = trade.trajectory.map(p => ({ time: time(p.at), value: p.oppositeInner }))
		const partialEvent = trade.events?.find(event=>event.type==='partial'), fullEvent = trade.events?.find(event=>event.type==='full')
		if (mean.length) { const s = line(mean, { color: '#f0a941', lineWidth: 2, lineStyle: lineStyle().Dotted, autoscale: false }); if (partialEvent) seriesMarkers(s, [{ time: time(partialEvent.at), position: 'inBar', color: '#f0a941', shape: 'circle', size: 1, text: `PARTIAL ${fmtP(partialEvent.price)}` }]) }
		if (full.length) { const s = line(full, { color: '#2fd08c', lineWidth: 2, lineStyle: lineStyle().Dotted, autoscale: false }); if (fullEvent) seriesMarkers(s, [{ time: time(fullEvent.at), position: 'inBar', color: '#2fd08c', shape: 'circle', size: 1, text: `FULL ${fmtP(fullEvent.price)}` }]) }
	} else if(trade.management==='static') {
		draw(trade.partial, '#f0a941', `PARTIAL STATIC ${fmtP(trade.partial)}`, lineStyle().Dotted)
		draw(trade.full, '#2fd08c', `FULL STATIC ${fmtP(trade.full)}`, lineStyle().Dotted)
	}
}

export function signalArrowTooltip(at) {
	const currentMode = indicatorStyle().arrowMode || 'standard'
	const p = S.data?.indicators?.main?.signalArrows
	const modeData = p?.modes?.[currentMode] || p
	const t = (modeData?.trades || []).find(x => time(x.signalAt) === at || time(x.entryAt) === at || time(x.exitAt) === at)
	if (!t) return null
	return `<div class="hover-title"><span class="pill ${t.side}">${t.side === 'long' ? 'BUY' : 'SELL'}</span>${esc(t.mode.toUpperCase())}</div><div class="hover-sub">${dt(t.signalAt)} · ${esc(t.outcome)} · <span class="${cls(t.netR)}">${fmtR(t.netR)}</span></div><div class="hover-sub mono">entry ${fmtP(t.entry)} · add ${fmtP(t.add)}${t.addFilled ? ' ✓' : ''} · stop ${fmtP(t.stop)} · partial ${fmtP(t.partial)} · full ${fmtP(t.full)}</div>`
}
export function selectSignalArrowAt(at) {
	const currentMode = indicatorStyle().arrowMode || 'standard'
	const modeData = S.data?.indicators?.main?.signalArrows?.modes?.[currentMode] || S.data?.indicators?.main?.signalArrows
	const trades = modeData?.trades || [], hits = trades.filter(t => time(t.signalAt) === at || time(t.entryAt) === at)
	if (!hits.length) return false
	selectedArrowTradeId = selectedArrowTradeId === hits[0].id ? null : hits[0].id
	document.dispatchEvent(new CustomEvent('viz:redraw'))
	return true
}

export function drawIndicatorLayers(series, from = null, to = null, payload = null) {
	const showApex = Boolean($('apexChk')?.checked), showArrows = Boolean($('signalArrowsChk')?.checked)
	if (!showApex && !showArrows) return
	const g = payload?.apex, style = indicatorStyle(), inside = (t) => { const x = time(t); return (from == null || x >= from) && (to == null || x <= to) }
	if (showApex && series?.length && g?.bands?.length) {
		const bands = g.bands.filter(b => b && inside(b.t)), pick = (key) => bands.map(b => ({ time: time(b.t), value: b[key] })), labels = Boolean(style.priceLabels)
		apexPrim.setBands(bands.map(b => ({ ...b, t: time(b.t) })), { upperOn: style.upperFillOn, upperColor: style.upperFillColor, lowerOn: style.lowerFillOn, lowerColor: style.lowerFillColor })
		if (bands.length >= 2) { if (style.meanOn) line(pick('mean'), { color: style.meanColor, lineWidth: width(style.meanWidth), lastValueVisible: labels }); if (style.redLoOn) line(pick('redLo'), { color: style.redLoColor, lineWidth: width(style.redLoWidth), lineStyle: lineStyle().Dotted, lastValueVisible: labels }); if (style.redHiOn) line(pick('redHi'), { color: style.redHiColor, lineWidth: width(style.redHiWidth), lineStyle: lineStyle().Dotted, lastValueVisible: labels }); if (style.greenHiOn) line(pick('greenHi'), { color: style.greenHiColor, lineWidth: width(style.greenHiWidth), lineStyle: lineStyle().Dotted, lastValueVisible: labels }); if (style.greenLoOn) line(pick('greenLo'), { color: style.greenLoColor, lineWidth: width(style.greenLoWidth), lineStyle: lineStyle().Dotted, lastValueVisible: labels }) }
	} else apexPrim.setBands([])
	const currentMode = style.arrowMode || payload?.signalArrows?.mode || 'standard'
	const modeData = payload?.signalArrows?.modes?.[currentMode] || (payload?.signalArrows?.mode === currentMode ? payload.signalArrows : null)
	const trades = showArrows ? ((modeData?.trades || payload?.signalArrows?.trades || []).filter(t => inside(t.signalAt) && (t.side === 'long' ? style.buyOn : style.sellOn))) : []
	if (trades.length) {
		const candleByAt = new Map(series.map(c => [c.timestamp, c])), points = trades.map(t => ({ time: time(t.signalAt), value: candleByAt.get(t.signalAt)?.close ?? t.entry })), anchor = line(points, { color: 'rgba(0,0,0,0)', lineWidth: 1 })
		const rawMarks = []
		for (const t of trades) {
			rawMarks.push({ time: time(t.signalAt), position: t.side === 'long' ? 'belowBar' : 'aboveBar', color: t.side === 'long' ? style.buyColor : style.sellColor, shape: t.side === 'long' ? 'arrowUp' : 'arrowDown', size: arrowSize(style.arrowSize), text: t.side === 'long' ? 'BUY' : 'SELL' });
			if (style.exitMarkers && t.exitAt != null) {
				const colors = { 'full-tp': '#2fd08c', 'stop': '#f4506a', 'partial-be': '#f0a941', 'partial-stop': '#f0a941', 'timeout': '#9a7bff', 'open': '#6b7280' };
				rawMarks.push({ time: time(t.exitAt), position: t.side === 'long' ? 'aboveBar' : 'belowBar', color: colors[t.outcome] || '#6b7280', shape: 'circle', size: 1, text: `${t.outcome} ${fmtR(t.netR)}` })
			}
		}
		const mergedMarks = groupMarkersByTimestamp(rawMarks)
		seriesMarkers(anchor, mergedMarks)
	}
	if (showArrows) drawSelectedTrade(payload, from, to)
}
