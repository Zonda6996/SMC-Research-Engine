// panels/confirmation.mjs — уточнённое подтверждение по лестнице ТФ (1D→1h, 4h→15m, 1h→5m):
// трейс попытки на свечах ТФ подтверждения (зона —
// прямоугольником, вход/стоп/тейк — линиями, якорь — жёлтым пунктиром) и обзор «Зоны на 4h».

import { S } from '../lib/state.mjs'
import { indicatorStyle } from './indicators.mjs'
import { $, esc, fmtP, fmtR, time, dt, C, REASON_RU, SPENT_RU, TRACE_RU } from '../lib/format.mjs'
import { zonesPrim, apexPrim, line, seriesMarkers, setMarkers, clearOverlays, restoreMainCandles, setCandles, lineStyle, fitContent, setVisibleRange } from '../lib/chart.mjs'

/** Чем именно закончилось окно зоны (джойн с POI-кандидатом): «zone-ended» без контекста бесил на QA. */
function zoneEndInfo(poiId) {
	const z = (confLayerData().candidates || []).find((x) => x.id === poiId)
	if (!z) return ''
	if (z.supersededAt) return `зона заменена свежим поколением стека (${dt(z.supersededAt)})`
	if (z.spentReason) return `зона отработала: ${SPENT_RU[z.spentReason] || z.spentReason}${z.spentAt ? ` (${dt(z.spentAt)})` : ''}`
	if (z.failedAt) return `зона провалена: 4h-закрытие телом за far (${dt(z.failedAt)})`
	if (z.retiredAt) return `зона устарела: полка не кормилась (${dt(z.retiredAt)})`
	return 'окно закрылось на краю данных'
}

/** §16.20: активная связка панели — контекстная (ТФ графика) или слой (свинг 1D→1h / локальный 1h→5m). */
export function confLayerData() {
	const sel = $('confLayer')?.value ?? 'ctx'
	const L = (S.data?.mtfLayers || []).find((x) => x.contextTf === sel)
	if (sel !== 'ctx' && L) {
		return {
			results: L.results, candidates: L.candidates,
			src: L.ltfConf ?? (L.confTf === '5m' ? S.data?.ltf5m : null) ?? [],
			confTf: L.confTf, zoneTf: L.contextTf,
		}
	}
	return {
		results: S.data?.poiConfirmation?.results || [], candidates: S.data?.liquidityPoi?.candidates || [],
		src: S.data?.ltfConf || [], confTf: S.data?.dataset?.confTf, zoneTf: S.data?.dataset?.timeframe,
	}
}

export function confirmationAttempts() {
	const out = []
	for (const r of (confLayerData().results || []))
		for (const a of r.attempts)
			out.push({ ...a, poiId: r.poiId, direction: r.direction, zoneClass: r.zoneClass, near: r.near, far: r.far, knownAt: r.knownAt, endAt: r.endAt, spentReason: r.spentReason, ltfCoverage: r.ltfCoverage })
	return out
}
export function confirmationCandidates() {
	const st = $('confStatus').value, outcome = $('confOutcome').value, reason = $('confReason').value
	return confirmationAttempts().filter((x) => {
		if (st !== 'all' && x.status !== st) return false
		if (outcome !== 'all' && x.outcome !== outcome) return false
		if (reason !== 'all' && x.rejectionReason !== reason) return false
		return true
	})
}
function currentConfirmation() {
	const xs = confirmationCandidates()
	if (!xs.length) return null
	S.confIndex = Math.max(0, Math.min(S.confIndex, xs.length - 1))
	return xs[S.confIndex]
}

/**
 * §16.28–16.30: полосы Apex и сигналы вендора на ТФ подтверждения.
 * Пунктирные линии — ВНУТРЕННИЕ края зон (mean ∓ 5.6·dev), сплошная синяя — средняя.
 * Метки BUY/SELL ставятся по КАНОНУ ВЕНДОРА: касание ВНЕШНЕГО края (mean ∓ 9.6·dev) —
 * редкое событие у самого экстремума; у пользователя внешние линии в «Стиле» отключены,
 * поэтому на его графике внешний край виден только по заливке.
 * ВНИМАНИЕ: в НАШЕЙ системе близость к зоне экстремума — признак ХУДШЕГО входа (§16.29),
 * поэтому метка рядом со входом это предупреждение, а не подтверждение.
 */
function drawApexReversal(src, from, to) {
	const style = indicatorStyle()
	const showApex = Boolean($('apexChk')?.checked)
	const showReversal = Boolean($('reversalChk')?.checked)
	if (!showApex && !showReversal) return
	const g = S.data?.apex
	if (!g?.bands?.length) return
	const inRange = (t) => t >= from && t <= to
	const pick = (key) => g.bands.filter((b) => b && inRange(time(b.t))).map((b) => ({ time: time(b.t), value: b[key] }))
	const mean = pick('mean')
	if (mean.length < 2) return
	const visibleBands = g.bands.filter((b) => b && inRange(time(b.t))).map((b) => ({ ...b, t: time(b.t) }))
	apexPrim.setBands(showApex ? visibleBands : [], { upperOn: style.upperFillOn, upperColor: style.upperFillColor, lowerOn: style.lowerFillOn, lowerColor: style.lowerFillColor })
	const labels = Boolean(style.priceLabels)
	if (showApex) {
		if (style.meanOn) line(mean, { color: style.meanColor, lineWidth: 2, lastValueVisible: labels })
		if (style.redLoOn) line(pick('redLo'), { color: style.redLoColor, lineWidth: 1, lineStyle: lineStyle().Dotted, lastValueVisible: labels })
		if (style.redHiOn) line(pick('redHi'), { color: style.redHiColor, lineWidth: 1, lastValueVisible: labels })
		if (style.greenHiOn) line(pick('greenHi'), { color: style.greenHiColor, lineWidth: 1, lineStyle: lineStyle().Dotted, lastValueVisible: labels })
		if (style.greenLoOn) line(pick('greenLo'), { color: style.greenLoColor, lineWidth: 1, lastValueVisible: labels })
	}
	const sig = showReversal ? (S.data?.reversal?.signals || []).filter((x) => inRange(time(x.at)) && (x.direction === 'long' ? style.buyOn : style.sellOn)) : []
	if (sig.length) {
		const s0 = line(sig.map((x) => ({ time: time(x.at), value: x.edge })), { color: 'rgba(0,0,0,0)', lineWidth: 1 })
		seriesMarkers(s0, sig.map((x) => ({
			time: time(x.at), position: x.direction === 'long' ? 'belowBar' : 'aboveBar',
			color: x.direction === 'long' ? style.buyColor : style.sellColor, shape: 'circle', size: 1,
			text: x.direction === 'long' ? 'BUY' : 'SELL',
		})).sort((a, b) => a.time - b.time))
	}
}

/** Плоский список сделок упрощённого режима (пресет v0.4). */
export function simplifiedEntries() {
	const out = []
	for (const r of S.data?.simplifiedConfirmation?.results || []) {
		for (let i = 0; i < (r.entries || []).length; i++) out.push({ ...r.entries[i], poiId: r.poiId, direction: r.direction, near: r.near, far: r.far, knownAt: r.knownAt, endAt: r.endAt, idx: i })
	}
	return out.sort((a, b) => a.entryAt - b.entryAt)
}

function renderSimplified() {
	const xs = simplifiedEntries()
	const src = confLayerData().src || []
	if (!xs.length || !src.length) {
		$('confStatusText').textContent = xs.length ? 'нет ряда подтверждения' : 'упрощённый режим: сделок нет на текущем окне'
		$('confTrace').innerHTML = ''
		return
	}
	S.confIndex = Math.max(0, Math.min(S.confIndex, xs.length - 1))
	const e = xs[S.confIndex]
	setCandles(src)
	const srcTfMs = src.length > 1 ? src[1].timestamp - src[0].timestamp : 900000
	const lastAt = e.events?.length ? e.events[e.events.length - 1].at : e.entryAt
	const from = time(Math.max(src[0].timestamp, e.entryAt - 40 * srcTfMs))
	const to = time(Math.min(src[src.length - 1].timestamp, lastAt + 40 * srcTfMs))
	zonesPrim.setRects([{
		id: e.poiId, t1: from, t2: to, p1: e.near, p2: e.far, side: e.direction,
		alpha: 1, focused: true, label: `${e.direction === 'long' ? 'LONG' : 'SHORT'} ${fmtP(e.near)} → ${fmtP(e.far)}`,
	}], { min: Math.min(e.near, e.far), max: Math.max(e.near, e.far) })
	const mark = (price, color, text) => {
		const s0 = line([{ time: time(e.entryAt), value: price }, { time: to, value: price }], { color, lineWidth: 3 })
		seriesMarkers(s0, [{ time: time(e.entryAt), position: 'inBar', color, shape: 'circle', size: 0, text }])
	}
	mark(e.entry, C.blue, `ВХОД ${fmtP(e.entry)}`)
	mark(e.stop, C.red, `СТОП ${fmtP(e.stop)}`)
	mark(e.partialPrice, C.amber, `ЧАСТИЧКА 25% ${fmtP(e.partialPrice)}`)
	// Цель задана в стопах, поэтому при широком стопе уезжает на десятки процентов от цены.
	// Рисуем линию только если она рядом (≤12% хода), иначе — подпись у входа: линия через
	// весь экран за пределами видимых цен только мешает.
	const fullAwayPct = Math.abs(e.fullPrice - e.entry) / e.entry
	if (fullAwayPct <= 0.12) mark(e.fullPrice, C.green, `ФУЛЛ ${fmtP(e.fullPrice)}`)
	else {
		const s1 = line([{ time: time(e.entryAt), value: e.entry }], { color: 'rgba(0,0,0,0)' })
		seriesMarkers(s1, [{ time: time(e.entryAt), position: 'aboveBar', color: C.green, shape: 'circle', size: 0, text: `ФУЛЛ ${fmtP(e.fullPrice)} — за экраном, ${(fullAwayPct * 100).toFixed(0)}% хода` }])
	}
	drawApexReversal(src, from, to)
	const RU = { PARTIAL: 'частичка взята, стоп в безубыток', BE: 'выбило в безубыток', FULL: 'полный тейк', STOP: 'стоп' }
	setMarkers((e.events || []).map((x) => ({
		time: time(x.at), position: x.state === 'STOP' ? 'belowBar' : 'aboveBar',
		color: x.state === 'FULL' ? C.green : x.state === 'STOP' ? C.red : C.amber,
		shape: 'circle', size: 1, text: x.state,
	})).filter((x) => src.some((s0) => time(s0.timestamp) === x.time)).sort((a, b) => a.time - b.time))
	S.hmShownBands = []
	const OUT = { full: 'ФУЛЛ', be: 'БЕЗУБЫТОК после частички', stop: 'СТОП', open: 'ОТКРЫТА (край данных)' }
	$('confStatusText').textContent = `${S.confIndex + 1}/${xs.length} · ${e.direction.toUpperCase()} · ${OUT[e.outcome] || e.outcome} · ${fmtR(e.grossR)} · ход ${(e.grossMovePct != null ? (e.grossMovePct * 100).toFixed(2) + '%' : '—')}`
	const risk = Math.abs(e.entry - e.stop)
	$('confTrace').innerHTML = `<div class="kv"><span>Зона</span><b class="mono">${fmtP(Math.min(e.near, e.far))} – ${fmtP(Math.max(e.near, e.far))}</b></div>
		<div class="kv"><span>Вход</span><b class="mono">${fmtP(e.entry)} · ${dt(e.entryAt)}</b></div>
		<div class="kv"><span>Стоп</span><b class="mono">${fmtP(e.stop)} · ${(risk / e.entry * 100).toFixed(2)}% цены · режим ${esc(e.stopMode)}</b></div>
		<div class="kv"><span>Частичка 25%</span><b class="mono">${fmtP(e.partialPrice)} · 0.40R · +${(Math.abs(e.partialPrice - e.entry) / e.entry * 100).toFixed(2)}% цены</b></div>
		<div class="kv"><span>Фулл</span><b class="mono">${fmtP(e.fullPrice)} · 12R · +${(Math.abs(e.fullPrice - e.entry) / e.entry * 100).toFixed(2)}% цены</b></div>
		<div class="kv"><span>Попытка зоны</span><b>${e.idx + 1}</b></div>
		<div class="kv"><span>Zonda Apex</span><b>Zonda Reversal: BUY/SELL — касание ВНЕШНЕГО края (канон вендора). В пресете v0.4 вето работает по ЗАХОДУ в зону (внутренний край), окно 200 баров: такие входы отброшены как «цена растянута»</b></div>
		<div class="trace">${(e.events || []).map((x) => `<div class="trace-row"><b>${esc(x.state)}</b><span class="muted">${RU[x.state] || ''}</span><span class="mono">${dt(x.at)} · ${fmtP(x.price)}</span></div>`).join('') || '<div class="trace-row muted">событий нет — стоп без частички</div>'}</div>`
	setVisibleRange(e.entryAt - 24 * 3600000, lastAt + 24 * 3600000)
}

export function renderConfirmation() {
	if (!S.data || S.mode !== 'conf') return
	if ($('confEngine')?.value === 'simplified') {
		if (S.confZonesMode) { S.confZonesMode = false; $('confZonesBtn').textContent = `Зоны на ${confLayerData().zoneTf ?? '4h'}` }
		clearOverlays(); setMarkers([])
		renderSimplified()
		return
	}
	if (S.confZonesMode) { S.confZonesMode = false; $('confZonesBtn').textContent = `Зоны на ${confLayerData().zoneTf ?? '4h'}` }
	clearOverlays()
	setMarkers([])
	const c = currentConfirmation(), xs = confirmationCandidates()
	if (!c) {
		const total = confirmationAttempts().length
		$('confStatusText').textContent = total ? `Всего попыток ${total}, по текущему фильтру 0 — выберите «Все попытки»` : `Попыток нет: нет POI-зон связки ${confLayerData().zoneTf ?? ''}→${confLayerData().confTf ?? ''} или пуст ряд подтверждения`
		return
	}
	const src = confLayerData().src || []
	if (!src.length) return
	setCandles(src)
	const times = c.trace.map((x) => x.at)
	const lo = Math.min(c.knownAt, ...times), hi = Math.max(c.endAt || lo, ...times)
	const srcTfMs = src.length > 1 ? src[1].timestamp - src[0].timestamp : 900000
	const from = time(Math.max(src[0].timestamp, lo - 8 * srcTfMs))
	const to = time(Math.min(src[src.length - 1].timestamp, hi + 8 * srcTfMs))
	// Зона — прямоугольником на всю ширину окна попытки.
	zonesPrim.setRects([{
		id: c.poiId, t1: from, t2: to, p1: c.near, p2: c.far, side: c.direction,
		alpha: 1, focused: true, label: `${c.direction === 'long' ? 'LONG' : 'SHORT'} ${fmtP(c.near)} → ${fmtP(c.far)}`,
	}], { min: Math.min(c.near, c.far), max: Math.max(c.near, c.far) })
	if (c.entry != null && c.stop != null && c.tp2 != null) {
		const mark = (price, color, text) => {
			const s = line([{ time: time(c.entryAt), value: price }, { time: to, value: price }], { color, lineWidth: 3 })
			seriesMarkers(s, [{ time: time(c.entryAt), position: 'inBar', color, shape: 'circle', size: 0, text }])
		}
		mark(c.entry, C.blue, `ENTRY ${fmtP(c.entry)}`)
		mark(c.stop, C.red, `STOP ${fmtP(c.stop)}`)
		mark(c.tp2, C.green, `TP2 ${fmtP(c.tp2)}`)
	}
	const colors = { POI_TOUCH: C.blue, STOP_CONFIRMED: C.amber, RESTART: C.amber, ANCHOR_DEEPENED: C.amber, REBOUND: C.blue, SECOND_SWEEP: C.red, PROTECTED: C.green, WEAKNESS_TEST: C.dim, WEAKNESS_TEST_FAILED: C.dim, ENTRY_CANCELLED: C.amber, ENTRY: C.green, STOP: C.red, TP2: C.green }
	const anchorEvents = c.trace.filter((x) => ['STOP_CONFIRMED', 'RESTART', 'ANCHOR_DEEPENED'].includes(x.state) && x.price != null)
	for (let i = 0; i < anchorEvents.length; i++) {
		const ev = anchorEvents[i], nextAt = anchorEvents[i + 1]?.at ?? c.trace[c.trace.length - 1].at
		if (nextAt > ev.at) line([{ time: time(ev.at), value: ev.price }, { time: time(nextAt), value: ev.price }], { color: C.amber, lineWidth: 1, lineStyle: lineStyle().Dashed })
	}
	const marks = c.trace.map((x) => ({
		time: time(x.at), position: ['SECOND_SWEEP', 'STOP'].includes(x.state) ? 'belowBar' : 'aboveBar',
		color: colors[x.state] || C.dim, shape: x.state === 'ENTRY' ? 'arrowUp' : 'circle', size: 1, text: x.state,
	})).filter((x) => src.some((s0) => time(s0.timestamp) === x.time))
	setMarkers(marks.sort((a, b) => a.time - b.time))
	drawApexReversal(src, from, to)
	// Полосы heatmap на 15m-свечи не рисуем (см. renderHeatmap): шкалы времени 4h и 15m несовместимы.
	S.hmShownBands = []
	$('confStatusText').textContent = `${S.confIndex + 1}/${xs.length} · ${c.direction.toUpperCase()} · попытка ${c.attemptIndex} · ${c.rejectionReason === 'data-end' ? 'ЖИВАЯ У КРАЯ ДАННЫХ' : c.status.toUpperCase()}${c.outcome ? ' · ' + c.outcome.toUpperCase() : ''} · ${c.rejectionReason === 'data-end' ? 'ждёт продолжения' : (c.rejectionReason || fmtR(c.grossR))}${c.duplicateEntryOf ? ' · ДУБЛЬ ВХОДА' : ''}${c.againstImpulse ? ' · ПРОТИВ ИМПУЛЬСА' : ''}`
	const traceRows = []
	{
		let run = []
		const flush = () => {
			if (run.length > 6) {
				traceRows.push(run[0], run[1])
				traceRows.push({ state: '…', at: run[2].at, collapsed: run.length - 4 })
				traceRows.push(run[run.length - 2], run[run.length - 1])
			} else traceRows.push(...run)
			run = []
		}
		for (const x of c.trace) {
			if (x.state === 'WEAKNESS_TEST' || x.state === 'ENTRY_CANCELLED' || x.state === 'WEAKNESS_TEST_FAILED') run.push(x)
			else { flush(); traceRows.push(x) }
		}
		flush()
	}
	$('confTrace').innerHTML = `<div class="kv"><span>Зона</span><b class="mono">${fmtP(Math.min(c.near, c.far))} – ${fmtP(Math.max(c.near, c.far))}</b></div>
		<div class="kv"><span>Известна</span><b>${dt(c.knownAt)}</b></div>
		${c.rejectionReason === 'data-end' ? `<div class="kv"><span>Статус</span><b>попытка ЖИВАЯ — данные закончились на середине цикла (это не отказ; после пересвипа §16.10 доигрывается, обнови данные позже)</b></div>` : c.rejectionReason ? `<div class="kv"><span>Отказ</span><b>${esc(c.rejectionReason)} — ${REASON_RU[c.rejectionReason] || ''}</b></div>` : ''}
		${c.rejectionReason === 'zone-ended' ? `<div class="kv"><span>Чем кончилась зона</span><b>${zoneEndInfo(c.poiId)}</b></div>` : ''}
		<div class="kv"><span>Объём прихода</span><b>${c.arrivalVolumeRatio != null ? '×' + c.arrivalVolumeRatio.toFixed(2) + (c.arrivalVolumeRatio >= 1.5 ? ' — пришли на объёме' : '') : '—'}</b></div>
		<div class="kv"><span>Свип экстремума зоны</span><b>${c.sweptZoneExtreme == null ? '—' : c.sweptZoneExtreme ? 'да' : 'нет (лой захода)'}</b></div>
		${c.spentReason ? `<div class="kv"><span>Зона отработала</span><b>${SPENT_RU[c.spentReason] || c.spentReason}</b></div>` : ''}
		${c.entry != null ? `<div class="kv"><span>Вход / Стоп / Тейк</span><b class="mono">${fmtP(c.entry)} / ${fmtP(c.stop)} / ${fmtP(c.tp2)} · ${fmtR(c.grossR)}</b></div>` : ''}
		${c.impulseRet != null ? `<div class="kv"><span>Импульс на входе</span><b>${(c.impulseRet >= 0 ? '+' : '') + (c.impulseRet * 100).toFixed(1)}% за окно 4h${c.againstImpulse ? ' — ВХОД ПРОТИВ ИМПУЛЬСА (стопы таких входов чаще, пометка не фильтр)' : ''}</b></div>` : ''}
		${c.duplicateEntryOf ? `<div class="kv"><span>Дубль входа</span><b title="${esc(c.duplicateEntryOf)}">один свип с зоной ${esc(String(c.duplicateEntryOf).split('|').pop())} — не торгуется («один свип = одна сделка», §16.18)</b></div>` : ''}
		<div class="trace">${traceRows.map((x) => x.state === '…'
			? `<div class="trace-row muted">… ещё ${x.collapsed} тестов/отмен свёрнуто …</div>`
			: `<div class="trace-row"><b>${esc(x.state)}</b><span class="muted">${TRACE_RU[x.state] || ''}</span><span class="mono">${dt(x.at)}${x.price != null ? ' · ' + fmtP(x.price) : ''}${x.volumeRatio != null ? ' · vol×' + x.volumeRatio.toFixed(2) : ''}</span></div>`).join('')}</div>`
	setVisibleRange(lo - 6 * 3600000, hi + 6 * 3600000)
}

export function renderConfZones() {
	if (!S.data) return
	clearOverlays()
	setMarkers([])
	restoreMainCandles()
	const rs = confLayerData().results || []
	const src = S.data.candles || []
	if (!src.length) return
	const first = src[0].timestamp, last = src[src.length - 1].timestamp
	let n = 0, noData = 0
	const rects = []
	for (const r of rs) {
		const fromTs = Math.min(Math.max(r.knownAt, first), last)
		const toTs = Math.min(Math.max(r.endAt || last, fromTs), last)
		if (toTs <= fromTs) continue
		n++
		const dead = r.ltfCoverage === 'none'
		if (dead) noData++
		const entered = r.attempts.some((a) => a.status === 'entered')
		rects.push({
			id: r.poiId, t1: time(fromTs), t2: time(toTs), p1: r.near, p2: r.far, side: r.direction,
			alpha: dead ? 0.15 : 1, dim: dead, focused: entered,
			label: dead ? `нет ${confLayerData().confTf ?? ''} данных` : `${r.attempts.length} поп.${entered ? ' · ВХОД' : ''}${r.spentReason === 'tp-hit' ? ' · тейк' : ''}${r.ltfCoverage === 'partial' ? ` · ${confLayerData().confTf ?? 'LTF'} частично` : ''}`,
		})
	}
	zonesPrim.setRects(rects)
	$('confStatusText').textContent = `Зоны подтверждения (${confLayerData().zoneTf ?? ''}→${confLayerData().confTf ?? ''}): ${n} шт (${noData} тусклых — окно раньше истории ТФ подтверждения: нет данных, не логики) · рамка near сплошная, far пунктир`
	fitContent()
}

export function moveConfirmation(n) {
	if ($('confEngine')?.value === 'simplified') {
		const xs = simplifiedEntries()
		if (!xs.length) return
		S.confIndex = (S.confIndex + n + xs.length) % xs.length
		renderConfirmation()
		return
	}
	const xs = confirmationCandidates()
	if (!xs.length) return
	S.confIndex = (S.confIndex + n + xs.length) % xs.length
	renderConfirmation()
}
export function exportConfirmation() {
	const blob = new Blob([JSON.stringify(S.data?.poiConfirmation || {}, null, 2)], { type: 'application/json' })
	const a = document.createElement('a')
	a.href = URL.createObjectURL(blob)
	a.download = `poi-confirmation-${S.data?.dataset?.symbol?.replace('/', '-') || 'data'}-${Date.now()}.json`
	a.click()
	URL.revokeObjectURL(a.href)
}

export function wireConfirmationPanel(activate, deactivate) {
	$('confToggle').onclick = () => {
		if (S.mode === 'conf') { deactivate(); return }
		S.confIndex = 0
		const reasons = [...new Set(confirmationAttempts().map((x) => x.rejectionReason).filter(Boolean))]
		$('confReason').innerHTML = '<option value="all">Все причины</option>' + reasons.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('')
		activate('conf')
	}
	$('confPrev').onclick = () => moveConfirmation(-1)
	$('confNext').onclick = () => moveConfirmation(1)
	$('confBack').onclick = () => deactivate()
	$('confExport').onclick = exportConfirmation
	$('confZonesBtn').onclick = () => {
		if (S.mode !== 'conf') return
		S.confZonesMode = !S.confZonesMode
		if (S.confZonesMode) { $('confZonesBtn').textContent = `Назад к ${confLayerData().confTf ?? 'LTF'}`; renderConfZones() }
		else renderConfirmation()
	}
	for (const id of ['confStatus', 'confOutcome', 'confReason', 'confLayer', 'confEngine']) {
		$(id).onchange = () => { S.confIndex = 0; renderConfirmation() }
	}
	// полосы Apex — только перерисовка, индекс сделки сохраняется
	$('apexChk').onchange = () => renderConfirmation()
	$('reversalChk').onchange = () => renderConfirmation()
}
