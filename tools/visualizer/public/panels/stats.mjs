// panels/stats.mjs — боевой слой (canon deep/OTE): карточки статистики, воронка ликвидности,
// список/деталь сделок, BOS/CHoCH, protected-уровни, сетка выбранной сделки. Логика канона
// сохранена 1-в-1, разметка и подача — редизайн.

import { S } from '../lib/state.mjs'
import { $, fmtP, fmtR, cls, time, C, dt } from '../lib/format.mjs'
import { line, seriesMarkers, setMarkers, clearOverlays, restoreMainCandles, lineStyle, setVisibleRange } from '../lib/chart.mjs'
import { renderHeatmap } from './heatmap.mjs'

const candleAt = (i) => S.data?.candles?.[i]

export function getFiltered() {
	if (!S.data) return []
	const stream = $('fStream').value, dir = $('fDirection').value, result = $('fResult').value, trigger = $('fTrigger').value
	const showSkipped = $('showSkipped').checked || result === 'first5-skip' || result === 'cost-skip'
	return S.data.trades.filter((t) => {
		if ((t.first5Skipped || t.executionCostSkipped) && !showSkipped) return false
		if (stream !== 'all' && t.stream !== stream) return false
		if (dir !== 'all' && t.direction !== dir) return false
		if (result !== 'all' && t.result !== result) return false
		if (trigger !== 'all' && t.trigger !== trigger) return false
		if ($('bigbarOnly').checked && !t.bigbarDiagnostic) return false
		return true
	}).sort((a, b) => b.entryIndex - a.entryIndex)
}

function stats(rows) {
	const done = rows.filter((x) => x.netR != null)
	const total = done.reduce((s, x) => s + x.netR, 0)
	const wins = done.filter((x) => x.netR > 0).length
	return { n: done.length, total, avg: done.length ? total / done.length : 0, wr: done.length ? 100 * wins / done.length : 0 }
}
const card = (name, s, extra = '', tone = '') =>
	`<div class="stat-card"><div class="stat-name">${name}</div><div class="stat-value ${tone || cls(s.avg)}">${fmtR(s.avg)}</div><div class="stat-sub">n ${s.n} · Σ ${fmtR(s.total)} · WR ${s.wr.toFixed(1)}%${extra}</div></div>`

export function renderCards() {
	const skipped = S.data.trades.filter((t) => t.first5Skipped)
	const costSkipped = S.data.trades.filter((t) => t.executionCostSkipped && !t.first5Skipped)
	const canon = S.data.trades.filter((t) => !t.first5Skipped && !t.executionCostSkipped)
	const deep = canon.filter((t) => t.stream === 'deep'), ote = canon.filter((t) => t.stream === 'ote')
	const bb = canon.filter((t) => t.bigbarDiagnostic)
	$('cards').innerHTML = card('Canon после гейтов', stats(canon))
		+ card('Deep', stats(deep), ` · bench ${S.data.strategy.benchmarks.deep}`)
		+ card('OTE', stats(ote), ` · bench ${S.data.strategy.benchmarks.ote}`)
		+ card('First-5 skip (cf)', stats(skipped), '', 'neg')
		+ card('Cost skip (cf)', stats(costSkipped), '', 'amber')
		+ card('Bigbar (диагн.)', stats(bb), '', 'amber')
}

/** Воронка ликвидности в шапке: зоны → активные → попытки → входы. */
export function renderFunnel() {
	const el = $('funnel')
	if (!S.data) { el.innerHTML = ''; return }
	const zones = S.data.liquidityPoi?.candidates || []
	const active = zones.filter((z) => z.active && !z.duplicateOf).length
	const attempts = (S.data.poiConfirmation?.results || []).reduce((s, r) => s + r.attempts.length, 0)
	// §16.18: дубли входов («один свип = одна сделка») не торгуются — в воронке не считаются.
	const allEntered = (S.data.poiConfirmation?.results || []).flatMap((r) => r.attempts.filter((a) => a.status === 'entered'))
	const dupEntries = allEntered.filter((a) => a.duplicateEntryOf).length
	const entries = allEntered.length - dupEntries
	el.innerHTML = zones.length
		? `<span class="chip" title="Всего зон в наборе">${zones.length} зон</span><span class="chip-sep">→</span>
		   <span class="chip chip-accent" title="Активные (готова + в игре)">${active} активных</span><span class="chip-sep">→</span>
		   <span class="chip" title="Попытки подтверждения на 15m">${attempts} попыток</span><span class="chip-sep">→</span>
		   <span class="chip ${entries ? 'chip-green' : ''}" title="Входы (без дублей «один свип = одна сделка»)">${entries} входов${dupEntries ? ` <span class="muted">+${dupEntries} дубл.</span>` : ''}</span>`
		: ''
}

export function renderEvents() {
	if (!$('showEvents').checked) return
	for (const e of S.data.events) {
		const a = candleAt(e.levelIndex), b = candleAt(e.confirmIndex)
		if (!a || !b || e.levelIndex >= e.confirmIndex) continue
		const color = e.type === 'bos' ? C.blue : e.type === 'choch' ? C.red : C.dim
		const s = line([
			{ time: time(a.timestamp), value: e.levelPrice },
			{ time: time(b.timestamp), value: e.levelPrice },
		], { color, lineWidth: 1, lineStyle: lineStyle().Dashed })
		if (e.type !== 'unlabeled') {
			const mid = candleAt(Math.floor((e.levelIndex + e.confirmIndex) / 2)) || b
			seriesMarkers(s, [{ time: time(mid.timestamp), position: e.levelType === 'high' ? 'aboveBar' : 'belowBar', color, shape: 'circle', size: 0, text: `${e.type.toUpperCase()} ${e.direction === 'up' ? '↑' : '↓'}` }])
		}
	}
}

export function renderProtected() {
	if (!$('showProtected').checked) return
	for (const x of S.data.protectedSegments) {
		const a = candleAt(x.startIndex), b = candleAt(x.endIndex)
		if (a && b) line([{ time: time(a.timestamp), value: x.price }, { time: time(b.timestamp), value: x.price }], { color: C.amber, lineWidth: 1, lineStyle: lineStyle().SparseDotted })
	}
}

export function renderTradeMarkers() {
	const m = []
	for (const t of S.filtered) {
		const en = candleAt(t.entryIndex), ex = t.exitIndex != null ? candleAt(t.exitIndex) : null
		if (en) {
			const skipped = t.first5Skipped || t.executionCostSkipped
			m.push({ time: time(en.timestamp), position: t.direction === 'long' ? 'belowBar' : 'aboveBar', color: skipped ? C.dim : t.direction === 'long' ? C.green : C.red, shape: t.direction === 'long' ? 'arrowUp' : 'arrowDown', size: skipped ? 0 : 1, text: t.first5Skipped ? 'FIRST5 SKIP' : t.executionCostSkipped ? 'COST SKIP' : t.stream + (t.bigbarDiagnostic ? ' BB' : '') })
		}
		if (ex && !t.first5Skipped && !t.executionCostSkipped) m.push({ time: time(ex.timestamp), position: t.direction === 'long' ? 'aboveBar' : 'belowBar', color: t.result === 'tp' ? C.green : t.result === 'timestop' ? C.amber : C.red, shape: 'circle', size: 1, text: fmtR(t.netR) })
	}
	m.sort((a, b) => a.time - b.time)
	setMarkers(m)
}

export function renderSelected() {
	const t = S.data.trades.find((x) => x.id === S.selectedId)
	if (!t) return
	const created = candleAt(t.createdAtIndex)
	const end = candleAt(Math.min(S.data.candles.length - 1, (t.exitIndex ?? t.entryIndex) + 18))
	const legA = candleAt(t.legStart.index), legB = candleAt(t.legEnd.index), entryCandle = candleAt(t.entryIndex)
	if (!created || !end || !entryCandle) return
	const until = time(end.timestamp)
	const earliest = [created, legA, legB].filter(Boolean).sort((a, b) => a.timestamp - b.timestamp)[0]
	const gridFrom = time(earliest.timestamp)
	if (legA && legB) {
		const pts = [{ time: time(legA.timestamp), value: t.legStart.price }, { time: time(legB.timestamp), value: t.legEnd.price }].sort((a, b) => a.time - b.time)
		const leg = line(pts, { color: C.amber, lineWidth: 3, lineStyle: lineStyle().Dashed })
		seriesMarkers(leg, [
			{ time: time(legA.timestamp), position: 'inBar', color: C.amber, shape: 'circle', size: 1, text: `0% START ${fmtP(t.legStart.price)}` },
			{ time: time(legB.timestamp), position: 'inBar', color: C.blue, shape: 'circle', size: 1, text: `100% EVENT ${fmtP(t.legEnd.price)}` },
		].sort((a, b) => a.time - b.time))
	}
	const shown = new Set([0, 23.6, 38.2, 50, 61.8, 78.6, 100, 141, 161])
	for (const x of t.gridLevels.filter((x) => shown.has(x.ratio))) {
		const key = x.ratio === 0 || x.ratio === 100
		const s = line([{ time: gridFrom, value: x.price }, { time: until, value: x.price }], { color: key ? C.text : x.ratio > 100 ? C.purple : '#49699d', lineWidth: key ? 2 : 1, lineStyle: key ? lineStyle().Solid : lineStyle().Dotted })
		seriesMarkers(s, [{ time: time(created.timestamp), position: 'inBar', color: key ? C.text : C.dim, shape: 'circle', size: 0, text: `${x.ratio}%  ${fmtP(x.price)}` }])
	}
	const tradeLine = (price, color, text) => {
		const s = line([{ time: time(entryCandle.timestamp), value: price }, { time: until, value: price }], { color, lineWidth: 3 })
		seriesMarkers(s, [{ time: time(entryCandle.timestamp), position: 'inBar', color, shape: 'circle', size: 0, text }])
	}
	tradeLine(t.entry, C.blue, `ENTRY ${t.entryRatio}% · ${fmtP(t.entry)}`)
	tradeLine(t.stop, C.red, `SL ${t.stopRatio}% · ${fmtP(t.stop)}`)
	tradeLine(t.take, C.green, `TP ${t.takeRatio}% · ${fmtP(t.take)}`)
}

export function renderTradeList() {
	S.filtered = getFiltered()
	$('count').textContent = `${S.filtered.length}`
	const box = $('tradeList')
	box.innerHTML = ''
	if (!S.filtered.length) { box.innerHTML = '<div class="empty">Нет сделок по фильтрам</div>'; return }
	for (const t of S.filtered) {
		const el = document.createElement('div')
		el.className = 'list-item trade' + (t.id === S.selectedId ? ' selected' : '')
		el.innerHTML = `<span class="pill ${t.direction}">${t.direction.toUpperCase()}</span><span class="stream">${t.stream.toUpperCase()}</span>
			<span class="grow"><span class="muted">${dt(candleAt(t.entryIndex).timestamp)}</span>${t.bigbarDiagnostic ? '<span class="badge bb">BB</span>' : ''}${t.first5Skipped ? '<span class="badge skip">FIRST5</span>' : t.executionCostSkipped ? '<span class="badge skip">COST</span>' : ''}</span>
			<span class="result ${cls(t.netR)}">${t.first5Skipped || t.executionCostSkipped ? 'cf ' + fmtR(t.netR) : fmtR(t.netR)}</span>`
		el.onclick = () => selectTrade(t.id)
		box.appendChild(el)
	}
}

export function renderTradeDetail() {
	const t = S.data?.trades.find((x) => x.id === S.selectedId)
	if (!t) { $('detail').innerHTML = '<div class="empty">Выберите сделку из списка</div>'; return }
	$('detail').innerHTML = `<div class="detail-grid">
		<div class="kv"><span>Поток</span><b>${t.stream.toUpperCase()}${t.first5Skipped ? ' · FIRST5 SKIP' : t.executionCostSkipped ? ' · COST SKIP' : ''}</b></div>
		<div class="kv"><span>Исход</span><b class="${cls(t.netR)}">${t.result} ${fmtR(t.netR)}</b></div>
		<div class="kv"><span>Направление</span><b>${t.direction}</b></div><div class="kv"><span>Триггер</span><b>${t.trigger.toUpperCase()}</b></div>
		<div class="kv"><span>Entry</span><b class="mono">${fmtP(t.entry)}</b></div><div class="kv"><span>Stop</span><b class="mono">${fmtP(t.stop)}</b></div>
		<div class="kv"><span>Take</span><b class="mono">${fmtP(t.take)}</b></div><div class="kv"><span>Exit</span><b class="mono">${fmtP(t.exitPrice)}</b></div>
		<div class="kv"><span>Stop distance</span><b>${t.stopPct?.toFixed(4)}%</b></div>
		<div class="kv"><span>Полный stop</span><b class="${cls(t.fullStopNetR)}">${fmtR(t.fullStopNetR)}</b></div>
		<div class="kv"><span>Fresh / Hold</span><b>${t.freshBars} / ${t.holdBars ?? 'open'} бар.</b></div>
		<div class="kv"><span>Risk</span><b>${t.first5Skipped || t.executionCostSkipped ? '0 (skip)' : `x${t.riskMult}`}</b></div>
		<div class="kv"><span>Fib 0%</span><b class="mono">${fmtP(t.legStart.price)}</b></div>
		<div class="kv"><span>Fib 100%</span><b class="mono">${fmtP(t.legEnd.price)}</b></div></div>
		${t.first5Skipped ? '<div class="notice">Touch в первой 5m-свече HTF-бара — сделка пропущена, R counterfactual.</div>' : t.executionCostSkipped ? `<div class="notice">Лимитка не выставлялась: полный stop ${fmtR(t.fullStopNetR)} хуже cap −${S.data.strategy.executionCostGate.maxFullStopLossR.toFixed(2)}R.</div>` : ''}`
}

export function selectTrade(id) {
	S.selectedId = S.selectedId === id ? null : id
	document.dispatchEvent(new CustomEvent('viz:redraw'))
	const t = S.data.trades.find((x) => x.id === S.selectedId)
	if (t) {
		const a = Math.max(0, t.createdAtIndex - 15)
		const b = Math.min(S.data.candles.length - 1, (t.exitIndex ?? t.entryIndex) + 20)
		setVisibleRange(candleAt(a).timestamp, candleAt(b).timestamp)
	}
}
export function navigateTrades(step) {
	if (!S.filtered.length) return
	let i = S.filtered.findIndex((x) => x.id === S.selectedId)
	i = i < 0 ? 0 : (i + step + S.filtered.length) % S.filtered.length
	selectTrade(S.filtered[i].id)
}

/** Тултип сделки под курсором (для единого crosshair-обработчика). */
export function tradeTooltip(barIndex) {
	const t = S.filtered.find((x) => x.entryIndex === barIndex || x.exitIndex === barIndex)
	if (!t) return null
	return `<div class="hover-title">${t.stream.toUpperCase()} ${t.direction.toUpperCase()}${t.first5Skipped ? ' <span class="muted">FIRST5 SKIP</span>' : ''}</div>
		<div class="hover-sub">${t.result} · <span class="${cls(t.netR)}">${fmtR(t.netR)}</span></div>
		<div class="hover-sub mono">entry ${fmtP(t.entry)} · stop ${fmtP(t.stop)} · take ${fmtP(t.take)} · risk ${t.first5Skipped || t.executionCostSkipped ? '0' : `x${t.riskMult}`}</div>
		${t.bigbarDiagnostic ? '<div class="hover-sub amber">BIGBAR diagnostic</div>' : ''}`
}

export function renderTradesMode() {
	clearOverlays()
	restoreMainCandles()
	renderTradeList()
	renderEvents()
	renderProtected()
	renderTradeMarkers()
	renderSelected()
	renderHeatmap()
	renderTradeDetail()
	renderCards()
}

export function wireStatsPanel() {
	for (const id of ['fStream', 'fDirection', 'fResult', 'fTrigger', 'bigbarOnly', 'showSkipped', 'showEvents', 'showProtected'])
		$(id).onchange = () => { S.selectedId = null; document.dispatchEvent(new CustomEvent('viz:redraw')) }
	$('prevBtn').onclick = () => navigateTrades(-1)
	$('nextBtn').onclick = () => navigateTrades(1)
}
