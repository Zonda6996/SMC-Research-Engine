// panels/confirmation.mjs — подтверждение 4h→15m: трейс попытки на 15m-свечах (зона —
// прямоугольником, вход/стоп/тейк — линиями, якорь — жёлтым пунктиром) и обзор «Зоны на 4h».

import { S } from '../lib/state.mjs'
import { $, esc, fmtP, fmtR, time, dt, C, REASON_RU, SPENT_RU, TRACE_RU } from '../lib/format.mjs'
import { zonesPrim, line, seriesMarkers, setMarkers, clearOverlays, restoreMainCandles, setCandles, lineStyle, fitContent, setVisibleRange } from '../lib/chart.mjs'
import { renderHeatmap } from './heatmap.mjs'

export function confirmationAttempts() {
	const out = []
	for (const r of (S.data?.poiConfirmation?.results || []))
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

export function renderConfirmation() {
	if (!S.data || S.mode !== 'conf') return
	if (S.confZonesMode) { S.confZonesMode = false; $('confZonesBtn').textContent = 'Зоны на 4h' }
	clearOverlays()
	setMarkers([])
	const c = currentConfirmation(), xs = confirmationCandidates()
	if (!c) {
		const total = confirmationAttempts().length
		$('confStatusText').textContent = total ? `Всего попыток ${total}, по текущему фильтру 0 — выберите «Все попытки»` : 'Попыток нет: нет POI-зон на 4h или пуст ltf15m'
		renderHeatmap()
		return
	}
	const src = S.data.ltf15m || []
	if (!src.length) return
	setCandles(src)
	const times = c.trace.map((x) => x.at)
	const lo = Math.min(c.knownAt, ...times), hi = Math.max(c.endAt || lo, ...times)
	const from = time(Math.max(src[0].timestamp, lo - 8 * 900000))
	const to = time(Math.min(src[src.length - 1].timestamp, hi + 8 * 900000))
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
	const colors = { POI_TOUCH: C.blue, STOP_CONFIRMED: C.amber, RESTART: C.amber, ANCHOR_DEEPENED: C.amber, REBOUND: C.blue, SECOND_SWEEP: C.red, PROTECTED: C.green, WEAKNESS_TEST: C.dim, ENTRY_CANCELLED: C.amber, ENTRY: C.green, STOP: C.red, TP2: C.green }
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
	renderHeatmap()
	$('confStatusText').textContent = `${S.confIndex + 1}/${xs.length} · ${c.direction.toUpperCase()} · попытка ${c.attemptIndex} · ${c.status.toUpperCase()}${c.outcome ? ' · ' + c.outcome.toUpperCase() : ''} · ${c.rejectionReason || fmtR(c.grossR)}`
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
			if (x.state === 'WEAKNESS_TEST' || x.state === 'ENTRY_CANCELLED') run.push(x)
			else { flush(); traceRows.push(x) }
		}
		flush()
	}
	$('confTrace').innerHTML = `<div class="kv"><span>Зона</span><b class="mono">${fmtP(Math.min(c.near, c.far))} – ${fmtP(Math.max(c.near, c.far))}</b></div>
		<div class="kv"><span>Известна</span><b>${dt(c.knownAt)}</b></div>
		${c.rejectionReason ? `<div class="kv"><span>Отказ</span><b>${esc(c.rejectionReason)} — ${REASON_RU[c.rejectionReason] || ''}</b></div>` : ''}
		<div class="kv"><span>Объём прихода</span><b>${c.arrivalVolumeRatio != null ? '×' + c.arrivalVolumeRatio.toFixed(2) + (c.arrivalVolumeRatio >= 1.5 ? ' — пришли на объёме' : '') : '—'}</b></div>
		<div class="kv"><span>Свип экстремума зоны</span><b>${c.sweptZoneExtreme == null ? '—' : c.sweptZoneExtreme ? 'да' : 'нет (лой захода)'}</b></div>
		${c.spentReason ? `<div class="kv"><span>Зона отработала</span><b>${SPENT_RU[c.spentReason] || c.spentReason}</b></div>` : ''}
		${c.entry != null ? `<div class="kv"><span>Вход / Стоп / Тейк</span><b class="mono">${fmtP(c.entry)} / ${fmtP(c.stop)} / ${fmtP(c.tp2)} · ${fmtR(c.grossR)}</b></div>` : ''}
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
	const rs = S.data?.poiConfirmation?.results || []
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
			label: dead ? 'нет 15m данных' : `${r.attempts.length} поп.${entered ? ' · ВХОД' : ''}${r.spentReason === 'tp-hit' ? ' · тейк' : ''}${r.ltfCoverage === 'partial' ? ' · 15m частично' : ''}`,
		})
	}
	zonesPrim.setRects(rects)
	$('confStatusText').textContent = `Зоны подтверждения на 4h: ${n} шт (${noData} тусклых — окно раньше 15m-истории: нет данных, не логики) · рамка near сплошная, far пунктир`
	fitContent()
}

export function moveConfirmation(n) {
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
		if (S.confZonesMode) { $('confZonesBtn').textContent = 'Назад к 15m'; renderConfZones() }
		else renderConfirmation()
	}
	for (const id of ['confStatus', 'confOutcome', 'confReason']) $(id).onchange = () => { S.confIndex = 0; renderConfirmation() }
}
