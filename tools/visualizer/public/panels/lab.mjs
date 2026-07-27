// panels/lab.mjs — ручной Decision Lab по касаниям 141/200/241: слепой пошаговый реплей,
// TAKE/SKIP до REVEAL, авто-исход по 5m. Логика и localStorage-формат сохранены (ключ прежний —
// накопленные решения пользователя не теряются), разметка — редизайн.

import { S } from '../lib/state.mjs'
import { $, esc, fmtP, fmtR, time, C } from '../lib/format.mjs'
import { chart, line, seriesMarkers, setMarkers, setCandles, clearOverlays, lineStyle, fitContent } from '../lib/chart.mjs'

const LAB_KEY = 'smc-141-decisions-v8'
export const LAB_TF_MS = { '5m': 300000, '15m': 900000, '30m': 1800000, '45m': 2700000, '1h': 3600000, '2h': 7200000, '3h': 10800000, '4h': 14400000 }

const L = () => S.lab

function labDecisions() { try { return JSON.parse(localStorage.getItem(LAB_KEY) || '{}') } catch { return {} } }
function saveLabDecisions(x) { localStorage.setItem(LAB_KEY, JSON.stringify(x)) }
function labTags() { return [...document.querySelectorAll('[data-lab-tag]:checked')].map((x) => x.dataset.labTag) }
function seedHash(text) { let h = 2166136261; for (const c of text) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }
function seededRandom(seed) {
	let x = seedHash(seed)
	return () => { x += 0x6D2B79F5; let t = x; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
function baseLabCandidates() {
	if (!S.data?.reactionCandidates) return []
	const level = $('labLevel')?.value || 'all', exact = $('labExact')?.checked, age = $('labAge')?.value || '200'
	const saved = labDecisions()
	return S.data.reactionCandidates.filter((x) => !saved[x.id]?.revealedAt
		&& (level === 'all' || String(x.ratio) === level)
		&& (!exact || x.resolution === '5m')
		&& (age === 'all' || x.ageBars <= Number(age)))
}
export function rebuildLabOrder() {
	const base = baseLabCandidates()
	const rand = seededRandom(`${$('labSeed').value}|${S.data?.dataset?.symbol}|${S.data?.dataset?.timeframe}|${$('labLevel').value}`)
	L().order = base.map((x) => x.id)
	if ($('labRandom').checked) for (let i = L().order.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[L().order[i], L().order[j]] = [L().order[j], L().order[i]]
	}
	L().index = 0
	setLabCursor(currentLab())
}
function labCandidates() {
	const map = new Map((S.data?.reactionCandidates || []).map((x) => [x.id, x]))
	return L().order.map((id) => map.get(id)).filter(Boolean)
}
function currentLab() {
	const xs = labCandidates()
	if (!xs.length) return null
	L().index = Math.max(0, Math.min(L().index, xs.length - 1))
	return xs[L().index]
}
export function setLabCursor(c) {
	if (!c) { L().cursorAt = 0; return }
	const d = labDecisions()[c.id]
	L().cursorAt = d?.replayCursorAt || c.touchAt + LAB_TF_MS['5m']
	L().revealed = !!d?.revealedAt
	L().startedAt = Date.now()
	L().lastContext = $('labContext').value
}
function aggregateKnown(base, tf, cursor) {
	const ms = LAB_TF_MS[tf]
	const known = base.filter((c) => c.timestamp < cursor)
	if (tf === '5m') return known
	const groups = new Map()
	for (const c of known) {
		const bucket = Math.floor(c.timestamp / ms) * ms;
		(groups.get(bucket) || groups.set(bucket, []).get(bucket)).push(c)
	}
	return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([timestamp, g]) => ({
		timestamp, open: g[0].open, high: Math.max(...g.map((x) => x.high)), low: Math.min(...g.map((x) => x.low)),
		close: g[g.length - 1].close, volume: g.reduce((s, x) => s + x.volume, 0),
		partial: g[g.length - 1].timestamp + LAB_TF_MS['5m'] < timestamp + ms,
	}))
}
function labView(c, reveal = false) {
	const tf = $('labContext').value
	if (c.resolution === '5m' && S.data.ltf5m?.length) {
		const saved = labDecisions()[c.id], exitAt = saved?.outcome?.exitAt
		const revealUntil = exitAt != null ? Math.max(c.touchAt + 101 * LAB_TF_MS['5m'], exitAt + 5 * LAB_TF_MS['5m']) : c.touchAt + 101 * LAB_TF_MS['5m']
		const cursor = reveal ? Math.min(S.data.ltf5m[S.data.ltf5m.length - 1].timestamp + LAB_TF_MS['5m'], revealUntil) : L().cursorAt
		const source = aggregateKnown(S.data.ltf5m, tf, cursor)
		const ms = LAB_TF_MS[tf]
		const touchIndex = source.findIndex((x) => c.touchAt >= x.timestamp && c.touchAt < x.timestamp + ms)
		return { source, touchIndex, context: tf, cursor }
	}
	const source = S.data.candles.slice(0, reveal ? Math.min(S.data.candles.length, c.touchHtfIndex + 101) : c.touchHtfIndex + 1)
	return { source, touchIndex: c.touchHtfIndex, context: S.data.dataset.timeframe, cursor: c.touchAt }
}
function levelPrice(c, ratio) {
	const z = c.gridLevels.find((x) => x.ratio === Number(ratio))
	if (z) return z.price
	const p0 = c.gridLevels.find((x) => x.ratio === 0)?.price, p100 = c.gridLevels.find((x) => x.ratio === 100)?.price
	return p0 == null || p100 == null ? null : p0 + (Number(ratio) / 100) * (p100 - p0)
}
function simulateLabOutcome(c, d) {
	if (!S.data.ltf5m?.length || d.entryStyle === 'manual' || d.targetRatio === 'manual' || d.stopRatio === 'manual') return null
	const direction = c.tradeDirection, long = direction === 'long'
	const entry = d.entryStyle === 'touch' ? c.levelPrice : d.decisionPrice
	const stop = levelPrice(c, d.stopRatio), target = levelPrice(c, d.targetRatio)
	if (entry == null || stop == null || target == null || (long ? (stop >= entry || target <= entry) : (stop <= entry || target >= entry))) return { status: 'invalid-geometry' }
	const risk = Math.abs(entry - stop)
	const startAt = d.entryStyle === 'touch' ? c.touchAt : d.decisionAt
	const start = S.data.ltf5m.findIndex((x) => x.timestamp >= startAt)
	if (start < 0) return { status: 'no-data' }
	for (let i = start; i < S.data.ltf5m.length; i++) {
		const x = S.data.ltf5m[i]
		const hitStop = long ? x.low <= stop : x.high >= stop
		const hitTp = long ? x.high >= target : x.low <= target
		if (hitStop) return { status: 'stop', grossR: -1, entry, stop, target, exitAt: x.timestamp, bars: i - start }
		if (hitTp) return { status: 'tp', grossR: Math.abs(target - entry) / risk, entry, stop, target, exitAt: x.timestamp, bars: i - start }
	}
	return { status: 'open', entry, stop, target }
}
function applyLabDecision(decision) {
	const c = currentLab()
	if (!c || L().revealed) return
	const view = labView(c, false), decisionBar = view.source[view.source.length - 1]
	const all = labDecisions(), previous = all[c.id] || {}, now = new Date().toISOString()
	if (previous.revealedAt) return
	all[c.id] = {
		...previous, id: c.id, decision, entryStyle: $('labEntryStyle').value, targetRatio: $('labTarget').value, stopRatio: $('labStop').value,
		tags: labTags(), note: $('labNote').value.trim(), symbol: S.data.dataset.symbol, timeframe: S.data.dataset.timeframe, datasetUntil: S.data.dataset.until,
		level: c.ratio, gridCreatedAt: c.createdAt, gridKnownAt: c.knownAt, gridAgeBars: c.ageBars, touchAt: c.touchAt, decisionAt: view.cursor,
		decisionPrice: decisionBar?.close ?? c.levelPrice, barsWaited5m: Math.max(0, Math.round((view.cursor - (c.touchAt + LAB_TF_MS['5m'])) / LAB_TF_MS['5m'])),
		decisionContext: view.context, contextMode: $('labContext').value, tradeDirection: c.tradeDirection, trigger: c.trigger,
		oppositeSweptBefore: c.oppositeSweptBefore, replayCursorAt: view.cursor, decisionDurationMs: Date.now() - L().startedAt,
		actions: [...(previous.actions || []), { action: decision, cursorAt: view.cursor, context: view.context, recordedAt: now }], recordedAt: now,
	}
	saveLabDecisions(all)
	renderLab()
}
function loadLabForm(c) {
	const d = labDecisions()[c.id]
	document.querySelectorAll('[data-lab-tag]').forEach((x) => { x.checked = !!d?.tags?.includes(x.dataset.labTag) })
	$('labNote').value = d?.note || ''
	$('labEntryStyle').value = d?.entryStyle || 'reaction-close'
	$('labTarget').value = d?.targetRatio || (c.ratio === 241 ? '141' : c.ratio === 200 ? '141' : '100')
	$('labStop').value = d?.stopRatio || (c.ratio === 241 ? '261' : c.ratio === 200 ? '241' : '176')
	$('labTake').classList.toggle('active', d?.decision === 'TAKE')
	$('labSkip').classList.toggle('active', d?.decision === 'SKIP')
}
function renderLabAnalytics() {
	const ds = Object.values(labDecisions())
	const final = ds.filter((x) => x.decision === 'TAKE' || x.decision === 'SKIP')
	const takes = final.filter((x) => x.decision === 'TAKE')
	const resolved = takes.filter((x) => x.outcome?.grossR != null)
	const avg = resolved.length ? resolved.reduce((s, x) => s + x.outcome.grossR, 0) / resolved.length : 0
	$('labAnalytics').textContent = `TAKE ${takes.length} · SKIP ${final.length - takes.length} · resolved ${resolved.length} · TAKE avg ${fmtR(avg)}`
}
function renderLabOutcome(d) {
	const el = $('labOutcome'), o = d?.outcome
	if (!L().revealed) { el.classList.add('hidden'); el.textContent = ''; return }
	if (!o) { el.className = 'lab-outcome neutral'; el.classList.remove('hidden'); el.textContent = 'REVEALED · автоматический исход недоступен для manual-геометрии'; return }
	const r = o.grossR, kind = r > 0 ? 'win' : r < 0 ? 'loss' : 'neutral'
	const label = o.status === 'tp' ? 'TAKE PROFIT' : o.status === 'stop' ? 'STOP LOSS' : o.status === 'open' ? 'OPEN' : o.status.toUpperCase()
	el.className = `lab-outcome ${kind}`
	el.classList.remove('hidden')
	el.innerHTML = `<b>${d.decision === 'SKIP' ? 'SKIP · counterfactual' : 'TAKE'}: ${label}${r != null ? ` · ${fmtR(r)}` : ''}</b>${o.entry != null ? `<br><span class="muted mono">entry ${fmtP(o.entry)} · stop ${fmtP(o.stop)} · target ${fmtP(o.target)}${o.bars != null ? ` · ${o.bars}×5m` : ''}</span>` : ''}`
}
function switchLabContext() {
	const to = $('labContext').value, c = currentLab(), from = L().lastContext
	L().lastContext = to
	if (!c || to === from || L().revealed) { renderLab(); return }
	const all = labDecisions(), previous = all[c.id] || {}, now = new Date().toISOString()
	all[c.id] = {
		...previous, id: c.id, decision: previous.decision ?? null, symbol: S.data.dataset.symbol, timeframe: S.data.dataset.timeframe,
		datasetUntil: S.data.dataset.until, level: c.ratio, gridCreatedAt: c.createdAt, gridKnownAt: c.knownAt, gridAgeBars: c.ageBars,
		touchAt: c.touchAt, tradeDirection: c.tradeDirection, trigger: c.trigger, oppositeSweptBefore: c.oppositeSweptBefore,
		actions: [...(previous.actions || []), { action: 'TF_SWITCH', from, to, cursorAt: L().cursorAt, recordedAt: now }],
		replayCursorAt: L().cursorAt, lastObservedAt: L().cursorAt,
	}
	saveLabDecisions(all)
	renderLab()
}

export function renderLab() {
	if (!S.data || S.mode !== 'lab') return
	clearOverlays()
	setMarkers([])
	const c = currentLab(), xs = labCandidates()
	if (!c) { $('labStatus').textContent = 'Нет новых structurally-active exact-LTF касаний по уровню/возрасту'; $('labOutcome').classList.add('hidden'); return }
	loadLabForm(c)
	const blindOn = $('labBlind').checked && !L().revealed
	document.body.classList.toggle('lab-blind', blindOn)
	chart.applyOptions({ timeScale: { visible: !blindOn }, rightPriceScale: { visible: !blindOn } })
	const view = labView(c, L().revealed), source = view.source, touchIndex = view.touchIndex
	const left = Number($('labHistory').value) || 250
	const shown = source.slice(Math.max(0, touchIndex - left), source.length)
	setCandles(shown)
	const first = shown[0], lastBar = shown[shown.length - 1]
	if (!first || !lastBar) return
	const from = time(first.timestamp), to = time(lastBar.timestamp)
	const startBefore = time(c.legStart.timestamp) < from, endBefore = time(c.legEnd.timestamp) < from
	const startTime = Math.max(from, time(c.legStart.timestamp)), endTime = Math.max(from, time(c.legEnd.timestamp))
	const leg = line([{ time: startTime, value: c.legStart.price }, { time: endTime, value: c.legEnd.price }].sort((a, b) => a.time - b.time), { color: C.amber, lineWidth: 3, lineStyle: lineStyle().Dashed })
	seriesMarkers(leg, [
		{ time: startTime, position: 'inBar', color: C.amber, shape: 'circle', size: 1, text: startBefore ? '← 0% ДО ОКНА' : '0% START' },
		{ time: endTime, position: 'inBar', color: C.blue, shape: 'circle', size: 1, text: endBefore ? '← 100% ДО ОКНА' : '100% EVENT' },
	].sort((a, b) => a.time - b.time))
	for (const x of c.gridLevels.filter((x) => [0, 61.8, 78.6, 100, 141, 161, 200, 241, 261].includes(x.ratio))) {
		const key = x.ratio === c.ratio
		const s = line([{ time: from, value: x.price }, { time: to, value: x.price }], { color: key ? C.purple : x.ratio > 100 ? '#7059a8' : '#49699d', lineWidth: key ? 3 : 1, lineStyle: key ? lineStyle().Solid : lineStyle().Dotted })
		seriesMarkers(s, [{ time: Math.max(from, time(c.touchAt)), position: 'inBar', color: key ? C.purple : C.dim, shape: 'circle', size: 0, text: blindOn ? `${x.ratio}%` : `${x.ratio}% ${fmtP(x.price)}` }])
	}
	const decisions = labDecisions(), d = decisions[c.id]
	const done = Object.values(decisions).filter((x) => x.decision === 'TAKE' || x.decision === 'SKIP').length
	const wait = Math.max(0, Math.round((view.cursor - (c.touchAt + LAB_TF_MS['5m'])) / LAB_TF_MS['5m']))
	const marks = [{ time: time(c.touchAt), position: c.tradeDirection === 'long' ? 'belowBar' : 'aboveBar', color: C.purple, shape: c.tradeDirection === 'long' ? 'arrowUp' : 'arrowDown', size: 1, text: `DECIDE ${c.ratio}` }]
	if (L().revealed && d?.outcome?.exitAt != null) {
		const ms = LAB_TF_MS[view.context] || LAB_TF_MS['5m']
		const exitBar = source.find((x) => d.outcome.exitAt >= x.timestamp && d.outcome.exitAt < x.timestamp + ms)
		if (exitBar) marks.push({ time: time(exitBar.timestamp), position: d.outcome.status === 'stop' ? 'belowBar' : 'aboveBar', color: d.outcome.status === 'stop' ? C.red : C.green, shape: 'circle', size: 1, text: d.outcome.status === 'stop' ? 'STOP' : `TP ${fmtR(d.outcome.grossR)}` })
	}
	setMarkers(marks.sort((a, b) => a.time - b.time))
	const origin = blindOn
		? `сетка создана ${c.ageBars} HTF-баров до касания`
		: `сетка известна ${new Date(c.knownAt).toLocaleString('ru-RU')} → касание ${new Date(c.touchAt).toLocaleString('ru-RU')} · возраст ${c.ageBars} ${S.data.dataset.timeframe}-бар.`
	$('labStatus').innerHTML = `${L().index + 1}/${xs.length} · <b>${c.ratio}%</b> · ${c.tradeDirection.toUpperCase()} · ${view.context} · +${wait}×5m · ${d?.decision || 'НЕ РЕШЕНО'} · решений ${done}${L().revealed ? ' · REVEALED' : ''}<br><span class="muted">${esc(origin)} · структура active-at-touch</span>`
	renderLabOutcome(d)
	renderLabAnalytics()
	fitContent()
}

export function moveLab(step) {
	const xs = labCandidates()
	if (!xs.length) return
	L().index = (L().index + step + xs.length) % xs.length
	setLabCursor(currentLab())
	renderLab()
}
function advanceLab(action) {
	const c = currentLab()
	if (!c || L().revealed || c.resolution !== '5m') return
	const max = S.data.ltf5m[S.data.ltf5m.length - 1].timestamp + LAB_TF_MS['5m']
	if (L().cursorAt + LAB_TF_MS['5m'] > max) return
	L().cursorAt += LAB_TF_MS['5m']
	const all = labDecisions(), previous = all[c.id] || {}, now = new Date().toISOString()
	all[c.id] = {
		...previous, id: c.id, decision: previous.decision ?? null, symbol: S.data.dataset.symbol, timeframe: S.data.dataset.timeframe,
		datasetUntil: S.data.dataset.until, level: c.ratio, gridCreatedAt: c.createdAt, gridKnownAt: c.knownAt, gridAgeBars: c.ageBars,
		touchAt: c.touchAt, tradeDirection: c.tradeDirection, trigger: c.trigger, oppositeSweptBefore: c.oppositeSweptBefore,
		actions: [...(previous.actions || []), { action, cursorAt: L().cursorAt, context: $('labContext').value, recordedAt: now }],
		replayCursorAt: L().cursorAt, lastObservedAt: L().cursorAt,
	}
	saveLabDecisions(all)
	renderLab()
}
function revealLab() {
	const c = currentLab()
	if (!c || L().revealed) return
	const all = labDecisions(), d = all[c.id]
	if (d?.decision !== 'TAKE' && d?.decision !== 'SKIP') { alert('Сначала выберите TAKE или SKIP'); return }
	const revealedAt = new Date().toISOString()
	L().revealed = true
	all[c.id] = { ...d, revealedAt, outcome: simulateLabOutcome(c, d), actions: [...(d.actions || []), { action: 'REVEAL', cursorAt: L().cursorAt, context: $('labContext').value, recordedAt: revealedAt }] }
	saveLabDecisions(all)
	renderLab()
}
function exportLab() {
	const blob = new Blob([JSON.stringify(Object.values(labDecisions()), null, 2)], { type: 'application/json' })
	const a = document.createElement('a')
	a.href = URL.createObjectURL(blob)
	a.download = `decision-lab-session-${Date.now()}.json`
	a.click()
	URL.revokeObjectURL(a.href)
}
function clearLab() {
	const c = currentLab()
	if (!c) return
	const all = labDecisions()
	delete all[c.id]
	saveLabDecisions(all)
	setLabCursor(c)
	renderLab()
}

export function exitLabVisuals() {
	document.body.classList.remove('lab-blind')
	chart.applyOptions({ timeScale: { visible: true }, rightPriceScale: { visible: true } })
}

export function wireLabPanel(activate, deactivate) {
	$('labToggle').onclick = () => {
		if (S.mode === 'lab') { deactivate(); return }
		rebuildLabOrder()
		setLabCursor(currentLab())
		activate('lab')
	}
	$('labShuffle').onclick = () => { rebuildLabOrder(); renderLab() }
	$('labPrev').onclick = () => moveLab(-1)
	$('labNext').onclick = () => moveLab(1)
	$('labStep').onclick = () => advanceLab('STEP')
	$('labWait').onclick = () => advanceLab('WAIT')
	$('labTake').onclick = () => applyLabDecision('TAKE')
	$('labSkip').onclick = () => applyLabDecision('SKIP')
	$('labReveal').onclick = revealLab
	$('labExport').onclick = exportLab
	$('labClear').onclick = clearLab
	for (const id of ['labLevel', 'labAge', 'labRandom', 'labExact']) $(id).onchange = () => { rebuildLabOrder(); renderLab() }
	$('labSeed').onchange = () => { rebuildLabOrder(); renderLab() }
	$('labContext').onchange = switchLabContext
	for (const id of ['labHistory', 'labBlind']) $(id).onchange = () => renderLab()
}
