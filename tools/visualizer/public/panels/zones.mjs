// panels/zones.mjs — панель Liquidity POI: зоны ПРЯМОУГОЛЬНИКАМИ (заливка по силе стека,
// near — сплошная граница, far — пунктир), hover-карточка, клик по прямоугольнику = фокус,
// слой «Мои зоны» (ручная разметка пользователя, localStorage по символу, экспорт в JSON).

import { S } from '../lib/state.mjs'
import { $, esc, fmtP, fmtN, fmtTf, dt, time, LIFE_RU, SPENT_RU, PRIO_RU, INTER_RU } from '../lib/format.mjs'
import { zonesPrim, clearOverlays, restoreMainCandles, setMarkers, setVisibleRange } from '../lib/chart.mjs'
import { renderHeatmap } from './heatmap.mjs'

const MY_KEY = 'smc-my-zones-v1'
const TF4H = 14_400_000
const zoneTf = (c) => c.__layer ?? S.data?.dataset?.timeframe
const zoneConfTf = (c) => c.__confTf ?? S.data?.dataset?.confTf

/** Snap MTF visual bounds to timestamps that exist in the displayed candle series. */
export function snapZoneTime(ms, candles, edge = 'start') {
	if (!candles?.length) return time(ms)
	let lo = 0, hi = candles.length
	while (lo < hi) { const mid = (lo + hi) >> 1; if (candles[mid].timestamp < ms) lo = mid + 1; else hi = mid }
	const i = edge === 'end'
		? Math.max(0, Math.min(candles.length - 1, candles[lo]?.timestamp === ms ? lo : lo - 1))
		: Math.max(0, Math.min(candles.length - 1, lo))
	return time(candles[i].timestamp)
}

/** §16.23: чип слоя (1d/4h/1h) включён? Чип текущего ТФ управляет контекстными зонами. */
export function layerChipOn(tf) {
	const b = document.querySelector(`#layerChips [data-layer="${tf}"]`)
	return !b || b.classList.contains('active')
}

/** §16.20/§16.23: слои карты — остальные ступени лестницы поверх зон текущего ТФ. */
export function layerZones() {
	const out = []
	for (const L of (S.data?.mtfLayers || [])) {
		if (!layerChipOn(L.contextTf)) continue
		for (const z of L.candidates) out.push({ ...z, __layer: L.contextTf, __role: L.role, __confTf: L.confTf })
	}
	return out
}

export function zoneCandidates() {
	const d = $('poiDirection').value, life = $('poiLifecycle').value, pr = $('poiPriority').value
	const activeOnly = $('poiActiveOnly').checked, liqOnly = $('poiLiqOnly').checked
	const minStack = Number($('poiMinStack')?.value || 0)
	const ctxZones = layerChipOn(S.data?.dataset?.timeframe) ? (S.data?.liquidityPoi?.candidates || []) : []
	const px = S.data?.candles?.at(-1)?.close
	// §16.22/§16.23: 1h-СЛОЙ всегда показывает только БЛИЖАЙШИЕ к цене зоны (сверху/снизу + в игре);
	// полная 1h-карта — на самом 1h-виде (там зоны контекстные, фильтр их не трогает).
	const nearestLocal = (zs) => {
		if (px == null) return zs
		const locals = zs.filter((x) => x.__role === 'local')
		const inPlay = locals.filter((x) => Math.min(x.near, x.far) <= px && px <= Math.max(x.near, x.far))
		const above = locals.filter((x) => Math.min(x.near, x.far) > px).sort((a, b) => Math.min(a.near, a.far) - Math.min(b.near, b.far))[0]
		const below = locals.filter((x) => Math.max(x.near, x.far) < px).sort((a, b) => Math.max(b.near, b.far) - Math.max(a.near, a.far))[0]
		const keep = new Set([...inPlay, above, below].filter(Boolean))
		return zs.filter((x) => x.__role !== 'local' || keep.has(x))
	}
	return nearestLocal([...ctxZones, ...layerZones()].filter((x) => {
		if (x.duplicateOf) return false
		if (liqOnly && x.boundarySource !== 'liquidity-cluster') return false
		if (activeOnly && !(x.active && x.valid)) return false
		if (d !== 'all' && x.direction !== d) return false
		if (life === 'open' ? (x.lifecycleState !== 'fresh' && x.lifecycleState !== 'in-play') : (life !== 'all' && x.lifecycleState !== life)) return false
		if (pr !== 'all' && x.priority !== pr) return false
		if (minStack > 0 && x.stackShare != null && x.stackShare < minStack) return false
		return true
	})).sort((a, b) => b.knownAt - a.knownAt)
}

// ---- Мои зоны (ручная разметка) ----

function myAll() { try { return JSON.parse(localStorage.getItem(MY_KEY) || '{}') } catch { return {} } }
function mySave(x) { localStorage.setItem(MY_KEY, JSON.stringify(x)) }
function myList() {
	const sym = S.data?.dataset?.symbol || ''
	return (myAll()[sym] || [])
}
export function addMyZone(side, from, to, note = '') {
	const sym = S.data?.dataset?.symbol
	if (!sym || !(from > 0) || !(to > 0)) return
	const all = myAll()
	all[sym] ??= []
	all[sym].push({ id: `my-${Date.now()}`, side, lo: Math.min(from, to), hi: Math.max(from, to), note, createdAt: Date.now() })
	mySave(all)
}
function removeMyZone(id) {
	const sym = S.data?.dataset?.symbol
	const all = myAll()
	all[sym] = (all[sym] || []).filter((z) => z.id !== id)
	mySave(all)
}

function renderMyZoneList() {
	const box = $('myZoneList')
	const xs = myList()
	box.innerHTML = xs.length
		? xs.map((z) => `<div class="list-item my-zone"><span class="pill ${z.side}">${z.side === 'long' ? 'LONG' : 'SHORT'}</span>
			<span class="mono">${fmtP(z.lo)} – ${fmtP(z.hi)}</span><span class="muted grow">${esc(z.note || '')}</span>
			<button class="icon-btn" data-del="${z.id}" title="Удалить">✕</button></div>`).join('')
		: '<div class="empty">Отметь свою зону: сторона + границы. Слой рисуется голубым пунктиром поверх движковых зон — удобно сверять карту движка со своей.</div>'
	box.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => { removeMyZone(b.dataset.del); renderZones() } })
}

// ---- Рендер ----

export function renderZones() {
	if (!S.data || S.mode !== 'zones') return
	clearOverlays()
	restoreMainCandles()
	setMarkers([])
	const all = zoneCandidates(), xs = all.slice(0, 80)
	renderZoneList(xs)
	renderMyZoneList()
	const last = S.data.candles[S.data.candles.length - 1].timestamp
	const focusId = S.poiFocusId
	const zid = (c) => (c.__layer ? `${c.__layer}:${c.id}` : c.id)
	// §16.31: слоёные зоны рисуются с ПОСЛЕДНЕГО ВКЛАДА В ПОЛКУ (lastContributionAt — максимум
	// по пулам стека, поле движка). Раньше здесь брался максимум pivotTimes: пивоты бывают
	// старыми, поэтому прямоугольник всё равно тянулся от левого края экрана — баг §16.22
	// не был вылечен. Фокус-зона по-прежнему рисуется полной длиной от рождения.
	const drawFrom = (c) => {
		const born = Math.max(c.knownAt, c.geometryKnownAt || 0)
		if (!c.__layer || zid(c) === focusId) return born
		const feed = c.lastContributionAt || 0
		// подстраховка для старых ответов сервера без поля: прежнее поведение по пивотам
		const fallback = c.pivotTimes?.length ? Math.max(...c.pivotTimes) : 0
		return Math.max(born, feed || fallback)
	}
	const rects = xs.map((c) => ({
		id: zid(c),
		// MTF values may fall between bars of the displayed series; snap only visual bounds.
		t1: c.__layer ? snapZoneTime(drawFrom(c), S.data.candles, 'start') : time(drawFrom(c)),
		t2: c.__layer ? snapZoneTime(c.endAt || last, S.data.candles, 'end') : time(c.endAt || last),
		p1: c.near, p2: c.far, side: c.direction,
		focused: zid(c) === focusId, dim: !!focusId && zid(c) !== focusId,
		alpha: Math.min(1, (c.stackShare ?? 1) * (c.__role === 'local' ? 0.7 : 1)),
		label: `${fmtTf(zoneTf(c))}${c.__role ? (c.__role === 'swing' ? '·СВИНГ' : c.__role === 'local' ? '·ЛОК' : '·СРЕД') : ''} ${c.direction === 'long' ? 'LONG' : 'SHORT'} ${fmtP(c.near)} · ${LIFE_RU[c.lifecycleState] || c.lifecycleState}`, 
	}))
	if ($('myZonesShow').checked) {
		for (const z of myList()) rects.push({
			id: z.id, manual: true, side: z.side,
			t1: time(S.data.candles[0].timestamp), t2: time(last),
			p1: z.side === 'long' ? z.hi : z.lo, p2: z.side === 'long' ? z.lo : z.hi,
			label: `МОЯ ${fmtTf(S.data?.dataset?.timeframe)} ${fmtP(z.lo)}–${fmtP(z.hi)}${z.note ? ' · ' + z.note : ''}`, 
		})
	}
	const focused = xs.find((x) => zid(x) === focusId)
	zonesPrim.setRects(rects, focused ? { min: Math.min(focused.near, focused.far), max: Math.max(focused.near, focused.far) } : null)
	renderHeatmap()
	const layersInfo = (S.data?.mtfLayers || []).length ? ` · слои: ${(S.data.mtfLayers || []).map((L) => `${xs.filter((x) => x.__layer === L.contextTf).length} ${L.contextTf}`).join(', ')}` : ''
	$('poiZoneStatus').textContent = `Показано зон: ${xs.length}${all.length > xs.length ? ` из ${all.length}` : ''}${layersInfo} · в наборе ${S.data?.liquidityPoi?.candidates?.length || 0} (${S.data?.dataset?.timeframe ?? ''})`
	renderZoneDetail(focused, last)
	// Зум не трогаем без фокуса: переключение фильтров/списков не должно дёргать график.
	if (focused) setVisibleRange(focused.originAt - 20 * TF4H, (focused.endAt || last) + 20 * TF4H)
}

function renderZoneList(xs) {
	const box = $('poiZoneList')
	box.innerHTML = ''
	if (!xs.length) { box.innerHTML = '<div class="empty">Нет зон по текущим фильтрам</div>'; return }
	for (const c of xs) {
		const el = document.createElement('div')
		const cid = c.__layer ? `${c.__layer}:${c.id}` : c.id
		el.className = 'list-item zone' + (cid === S.poiFocusId ? ' selected' : '')
		el.innerHTML = `<span class="pill ${c.direction}">${c.direction === 'long' ? 'LONG' : 'SHORT'}</span><span class="pill" title="ТФ зоны ${fmtTf(zoneTf(c))} · подтверждение ${fmtTf(zoneConfTf(c))}">${fmtTf(zoneTf(c))}</span>
			<span class="mono">${fmtP(c.near)} → ${fmtP(c.far)}</span>
			<span class="meter" title="Сила стека: ${Math.round(100 * (c.stackShare || 0))}% от сильнейшей полки стороны"><i style="width:${Math.min(100, Math.round(100 * (c.stackShare || 0)))}%"></i></span>
			<span class="state">${(c.supersededAt ? 'заменена' : LIFE_RU[c.lifecycleState] || c.lifecycleState).toUpperCase()}</span>`
		el.onclick = () => { S.poiFocusId = S.poiFocusId === cid ? null : cid; renderZones() }
		box.appendChild(el)
	}
}

function renderZoneDetail(c, last) {
	const box = $('poiZoneDetail')
	if (!c) { box.innerHTML = ''; return }
	box.innerHTML = `
		<div class="detail-title"><span class="pill ${c.direction}">${c.direction === 'long' ? 'LONG' : 'SHORT'}</span> <span class="pill">${fmtTf(zoneTf(c))}</span> <b class="mono">${fmtP(c.near)} → ${fmtP(c.far)}</b></div>
		<div class="kv"><span>ТФ зоны / подтверждения</span><b>${fmtTf(zoneTf(c))} → ${fmtTf(zoneConfTf(c))}</b></div>
		<div class="kv"><span>Статус</span><b>${c.supersededAt ? 'заменена свежим поколением стека' : LIFE_RU[c.lifecycleState] || c.lifecycleState}${c.spentReason ? ` · ${SPENT_RU[c.spentReason] || c.spentReason}` : ''}</b></div>
		<div class="kv"><span>Приоритет / касания</span><b>${PRIO_RU[c.priority] || c.priority} · ${INTER_RU[c.interaction] || c.interaction} (${c.touchCount || 0})</b></div>
		${c.stackNotional != null ? `<div class="kv"><span>Сила стека</span><b>~${fmtN(c.stackNotional)} · ${Math.round(100 * (c.stackShare || 0))}% от сильнейшей${c.supersededAt ? ' · отставлена поколением ' + dt(c.supersededAt) : ''}</b></div>` : ''}
		<div class="kv"><span>Пулы полки</span><b>${c.pivotCount} шт · far ${c.boundarySource === 'liquidity-cluster' ? 'по реальной ликвидности' : 'по ATR — не торгуется'}</b></div>
		<div class="kv"><span>Premium/Discount</span><b>${c.pdZone === 'premium' ? 'premium (дорого)' : c.pdZone === 'discount' ? 'discount (дёшево)' : '—'} · по тренду: ${c.pdAligned == null ? '—' : c.pdAligned ? 'да' : 'нет'}</b></div>
		<div class="kv"><span>Известна с</span><b>${dt(Math.max(c.knownAt, c.geometryKnownAt || 0))}</b></div>
		<div class="kv"><span>Жизнь</span><b>${dt(c.originAt)} → ${c.endAt && c.endAt !== last ? dt(c.endAt) : 'сейчас'}</b></div>
		<div class="kv"><span>События</span><b>взведена ${c.armedAt ? dt(c.armedAt) : '—'} · использована ${c.consumedAt ? dt(c.consumedAt) : '—'} · провалена ${c.failedAt ? dt(c.failedAt) : '—'}</b></div>
		${c.suppressedCount ? `<div class="kv"><span>Схлопнуто дублей</span><b>${c.suppressedCount}</b></div>` : ''}`
}

export function zoneHoverHtml(c) {
	return `<div class="hover-title"><span class="pill ${c.side}">${c.side === 'long' ? 'LONG' : 'SHORT'}</span> <b class="mono">${fmtP(c.p1)} → ${fmtP(c.p2)}</b></div>
		<div class="hover-sub">${esc(c.label || '')}</div><div class="hover-hint">клик — фокус и детали</div>`
}

export function moveZoneFocus(step) {
	const xs = zoneCandidates().slice(0, 80)
	if (!xs.length) return
	let i = xs.findIndex((x) => (x.__layer ? `${x.__layer}:${x.id}` : x.id) === S.poiFocusId)
	i = (i < 0 ? 0 : i + step + xs.length) % xs.length
	S.poiFocusId = xs[i].__layer ? `${xs[i].__layer}:${xs[i].id}` : xs[i].id
	renderZones()
}

export function exportZones() {
	const payload = { ...S.data?.liquidityPoi, myZones: myList() }
	const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
	const a = document.createElement('a')
	a.href = URL.createObjectURL(blob)
	a.download = `liquidity-poi-${S.data?.dataset?.symbol?.replace('/', '-') || 'data'}-${Date.now()}.json`
	a.click()
	URL.revokeObjectURL(a.href)
}

export function wireZonesPanel(activate, deactivate) {
	$('poiZoneToggle').onclick = () => (S.mode === 'zones' ? deactivate() : activate('zones'))
	$('poiZonePrev').onclick = () => moveZoneFocus(-1)
	$('poiZoneNext').onclick = () => moveZoneFocus(1)
	$('poiZoneExport').onclick = exportZones
	$('poiZoneBack').onclick = () => deactivate()
	for (const id of ['poiDirection', 'poiLifecycle', 'poiPriority', 'poiActiveOnly', 'poiLiqOnly', 'poiMinStack', 'myZonesShow'])
		$(id).onchange = () => { if (id !== 'myZonesShow') S.poiFocusId = null; renderZones() }
	document.querySelectorAll('#layerChips [data-layer]').forEach((b) => {
		b.onclick = () => { b.classList.toggle('active'); S.poiFocusId = null; renderZones() }
	})
	$('myZoneAdd').onclick = () => {
		addMyZone($('myZoneSide').value, Number($('myZoneFrom').value), Number($('myZoneTo').value), $('myZoneNote').value.trim())
		$('myZoneFrom').value = ''; $('myZoneTo').value = ''; $('myZoneNote').value = ''
		renderZones()
	}
}
