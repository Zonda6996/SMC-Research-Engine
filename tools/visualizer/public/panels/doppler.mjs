// panels/doppler.mjs — панель Doppler (D6): книги × ТФ × режимы + живой журнал форварда.
// Данные: /api/doppler (журнал tmp/forward/d6 + терминальные артефакты ci-results).
import { $, esc, time } from '../lib/format.mjs'
import { setMarkers, clearOverlays } from '../lib/chart.mjs'

let cache = null

async function ensureData() {
	if (cache) return cache
	const r = await fetch('/api/doppler')
	cache = await r.json()
	return cache
}

function armOf(data, book, tf, mode) {
	const src = book === 'flash' ? data.stats?.flash?.arms : data.stats?.macro?.arms
	const key = `${tf}|${mode}`
	return src?.[key] ?? null
}

function fmtPct(x, d = 2) { return x == null || !Number.isFinite(x) ? '—' : (x * 100).toFixed(d) + '%' }

function renderStats() {
	const box = $('dopplerStats')
	if (!box || !cache) return
	const book = $('dopplerBook').value
	const tf = $('dopplerTf').value
	const mode = $('dopplerMode').value
	const rows = []
	// Все ТФ выбранной книги выбранным режимом — сразу видно «разнообразие».
	for (const t of ['5m', '15m', '30m', '1h', '2h', '4h']) {
		const a = armOf(cache, book, t, mode)
		if (!a) continue
		const hi = t === tf ? 'style="font-weight:700"' : ''
		rows.push(`<tr ${hi}><td>${t}</td><td>${a.n}</td><td>${a.wr != null ? (a.wr * 100).toFixed(1) + '%' : '—'}</td><td>${fmtPct(a.mean)}</td><td>[${fmtPct(a.ci95?.lower)}; ${fmtPct(a.ci95?.upper)}]</td><td>${a.breadthPositiveSymbols ?? '—'}</td><td>${esc(a.verdict ?? '')}</td></tr>`)
	}
	const verdict = book === 'macro' ? cache.stats?.macro?.lineVerdict : 'дескриптив (линии нет по prereg)'
	const best = book === 'macro' ? cache.stats?.macro?.bestArm : null
	box.innerHTML = `
		<div>Книга: <b>${book === 'flash' ? 'Flash (пропорц. окна)' : 'Macro (8ч фикс)'}</b> · вердикт: <b>${esc(String(verdict ?? '—'))}</b>${best?.id ? ` · лучшая рука: <b>${esc(best.id)}</b>` : ''}</div>
		<table style="margin-top:6px;border-collapse:collapse"><thead><tr><th>ТФ</th><th>N</th><th>WR</th><th>средняя net</th><th>CI95</th><th>breadth</th><th>вердикт</th></tr></thead>
		<tbody>${rows.join('')}</tbody></table>
		<div style="margin-top:4px;color:#888">net = 5bps/сторона + funding; стоп структурный; выход — стоп/таймаут 72ч.</div>`
}

function renderEvents() {
	const box = $('dopplerEvents')
	if (!box || !cache) return
	const symbol = String(window.S?.data?.dataset?.symbol ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase()
	const signals = symbol ? (cache.journal.signals || []).filter((s) => String(s.symbol) === symbol) : (cache.journal.signals || [])
	const trades = symbol ? (cache.journal.trades || []).filter((t) => String(t.symbol) === symbol) : (cache.journal.trades || [])
	const byKey = new Map((cache.journal.signals || []).map((s) => [`${s.symbol}|${s.signalBarOpenMs}`, s]))
	const head = symbol ? `Символ: <b>${esc(symbol)}</b>${signals.length ? '' : ' — сигналов нет, показаны последние по всем'}` : 'Все символы'
	const shown = signals.length ? signals : (cache.journal.signals || [])
	const rows = shown.slice(-40).reverse().map((s) => {
		const t = trades.find((x) => x.mode === s.mode && x.symbol === s.symbol && x.entryPlanUtc === s.entryPlanUtc)
		const outcome = t && t.outcome !== 'open' && t.outcome !== 'pending-entry' ? `${t.outcome} ${t.exitPrice != null ? '@ ' + t.exitPrice : ''}` : t ? (t.outcome === 'open' ? 'ОТКРЫТА' : 'ожидает входа') : s.missed ? 'упущен' : '—'
		return `<tr><td>${esc(String(s.signalBarCloseUtc).replace('T', ' ').slice(0, 16))}</td><td>${esc(s.mode)}</td><td>${esc(String(s.symbol).replace('USDT', ''))}</td><td>${s.entry ?? '—'}</td><td>${s.stop != null ? Number(s.stop).toPrecision(6) : '—'}</td><td>${esc(outcome)}</td></tr>`
	})
	box.innerHTML = `<div>${head}; журнал: ${cache.journal.totals.signals} сигналов / ${cache.journal.totals.trades} сделок (все режимы)</div>
		<table style="margin-top:6px;border-collapse:collapse"><thead><tr><th>закрытие бара (UTC)</th><th>режим</th><th>символ</th><th>вход</th><th>стоп</th><th>статус</th></tr></thead><tbody>${rows.join('') || '<tr><td colspan="6">пока пусто</td></tr>'}</tbody></table>`
}

function renderMarkers() {
	const symbol = String(window.S?.data?.dataset?.symbol ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase()
	if (!symbol || !cache) return
	const signals = (cache.journal.signals || []).filter((s) => String(s.symbol) === symbol)
	const marks = signals.map((s) => ({
		time: Math.floor(new Date(s.signalBarCloseUtc).getTime() / 1000),
		position: 'belowBar',
		color: s.missed ? '#888888' : '#26a69a',
		shape: 'arrowUp',
		text: `${s.mode}${s.missed ? ' (упущен)' : ''}`,
	}))
	try { setMarkers(marks) } catch (e) { console.error('doppler markers:', e) }
}

export function refreshDopplerData() { cache = null; return ensureData() }

export function renderDopplerPanel() {
	renderStats()
	renderEvents()
}

export function wireDopplerPanel() {
	$('dopplerRefresh').addEventListener('click', async () => {
		cache = null
		await ensureData()
		renderStats()
		renderEvents()
	})
	for (const id of ['dopplerBook', 'dopplerTf', 'dopplerMode']) $(id).addEventListener('change', renderStats)
	$('dopplerMarkers').addEventListener('click', async () => {
		await ensureData()
		try { clearOverlays() } catch {}
		renderMarkers()
		renderEvents()
	})
}
