// panels/heatmap.mjs — heatmap ликвидаций: полосы на графике, профиль суммарной плотности
// справа, «магниты», тултип по наведению. Логика v2.0 сохранена, вид — в токенах редизайна.

import { S } from '../lib/state.mjs'
import { $, fmtP, fmtN, time } from '../lib/format.mjs'
import { chart, candlesSeries, line } from '../lib/chart.mjs'

export const HM_TF_DEFAULTS = {
	'15m': { w: '0', g: '0.0025' }, '30m': { w: '0', g: '0.0025' }, '1h': { w: '0', g: '0.0025' },
	'4h': { w: '0.55', g: '0.001' }, '1d': { w: '0.35', g: '0.001' }, '1w': { w: '0', g: '0.0025' },
}
export function hmApplyTfDefaults(tf) {
	const d = HM_TF_DEFAULTS[tf]
	if (!d) return
	$('hmMinWeight').value = d.w
	$('hmGroup').value = d.g
}

function hmPools() {
	const side = $('hmSide').value, showSwept = $('hmShowSwept').checked, age = Number($('hmAge').value)
	let cutoff = -Infinity
	if (age > 0 && S.data.candles.length > age) cutoff = S.data.candles[S.data.candles.length - age].timestamp
	return (S.data?.liquidityHeatmap?.pools || []).filter((p) =>
		(side === 'all' || p.side === side) && (showSwept || p.status === 'active') && p.startAt >= cutoff)
}

function hmMergePools(pools, gap) {
	if (!gap) return pools
	const out = []
	for (const s of ['sell-side', 'buy-side']) {
		const list = pools.filter((p) => p.side === s).sort((a, b) => a.bandLow - b.bandLow)
		const used = new Array(list.length).fill(false)
		for (let i = 0; i < list.length; i++) {
			if (used[i]) continue
			const m = { ...list[i], _mid: list[i].extremePrice * list[i].notional, merged: 1 }
			for (let j = i + 1; j < list.length; j++) {
				if (used[j]) continue
				const p = list[j]
				if (p.bandLow > m.bandHigh * (1 + gap)) break
				if (Math.max(m.bandHigh, p.bandHigh) / m.bandLow - 1 > gap * 5) break
				if (p.status !== m.status) continue
				const mEnd = m.status === 'active' ? Infinity : (m.sweptAt ?? 0)
				const pEnd = p.status === 'active' ? Infinity : (p.sweptAt ?? 0)
				if (p.startAt > mEnd || m.startAt > pEnd) continue
				m.bandHigh = Math.max(m.bandHigh, p.bandHigh)
				m.remainingNotional = (m.remainingNotional ?? m.notional) + (p.remainingNotional ?? p.notional)
				m.notional += p.notional
				m._mid += p.extremePrice * p.notional
				m.startAt = Math.min(m.startAt, p.startAt)
				if (m.status === 'swept') m.sweptAt = Math.max(m.sweptAt ?? 0, p.sweptAt ?? 0)
				m.merged++
				used[j] = true
			}
			if (m.merged > 1) m.extremePrice = m._mid / m.notional
			out.push(m)
		}
	}
	return out
}

export function hmNotional(p) { return p.status === 'active' ? (p.remainingNotional ?? p.notional) : p.notional }

export function drawHmProfile() {
	const cv = $('hmProfile')
	if (!cv) return
	const wrap = cv.parentElement
	const dpr = Math.min(window.devicePixelRatio || 1, 3)
	const W = 110, H = (wrap && wrap.clientHeight) || 300
	if (cv.width !== W * dpr) { cv.width = W * dpr; cv.style.width = W + 'px' }
	if (cv.height !== H * dpr) { cv.height = H * dpr; cv.style.height = H + 'px' }
	const ctx = cv.getContext('2d')
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
	ctx.clearRect(0, 0, W, H)
	if (!S.hmOn || !S.hmShownBands.length || !candlesSeries || !chart) return
	try { cv.style.right = `${chart.priceScale('right').width() || 56}px` } catch { /* шкала ещё не готова */ }
	let maxN = 0
	for (const x of S.hmShownBands) maxN = Math.max(maxN, hmNotional(x.p))
	for (const x of S.hmShownBands) {
		const p = x.p
		const y1 = candlesSeries.priceToCoordinate(p.bandHigh), y2 = candlesSeries.priceToCoordinate(p.bandLow)
		if (y1 == null || y2 == null) continue
		const h = Math.max(2, Math.abs(y2 - y1))
		const len = Math.max(3, W * 0.95 * Math.sqrt(hmNotional(p) / (maxN || 1)))
		ctx.fillStyle = `rgba(${p.side === 'sell-side' ? '244,80,106' : '47,208,140'},${(0.25 + 0.6 * x.w * x.w).toFixed(2)})`
		ctx.fillRect(W - len, Math.min(y1, y2), len, h)
	}
}

export function renderHeatmap() {
	if (!S.data) return
	if (!S.hmOn) { $('hmStatus').textContent = '—'; S.hmShownBands = []; drawHmProfile(); return }
	const raw = hmPools()
	const gap = Number($('hmGroup').value)
	const pools = hmMergePools(raw, gap)
	const minW = Number($('hmMinWeight').value)
	const last = S.data.candles[S.data.candles.length - 1].timestamp
	const dw = new Map()
	for (const s of ['sell-side', 'buy-side']) {
		const list = pools.filter((p) => p.side === s).sort((a, b) => hmNotional(a) - hmNotional(b))
		const maxN = list.length ? hmNotional(list[list.length - 1]) : 1
		list.forEach((p, i) => dw.set(p, ((i + 1) / list.length) * (0.5 + 0.5 * Math.sqrt(hmNotional(p) / (maxN || 1)))))
	}
	const shown = pools.filter((p) => dw.get(p) >= minW).sort((a, b) => dw.get(a) - dw.get(b)).slice(-400)
	for (const p of shown) {
		const w = dw.get(p)
		const alpha = (0.08 + 0.8 * w * w).toFixed(3)
		const width = Math.max(2, Math.min(10, 2 + Math.round(8 * Math.pow(w, 1.5))))
		line([
			{ time: time(p.startAt), value: p.extremePrice },
			{ time: time(p.status === 'swept' && p.sweptAt ? p.sweptAt : last), value: p.extremePrice },
		], { color: `rgba(${p.side === 'sell-side' ? '244,80,106' : '47,208,140'},${alpha})`, lineWidth: width, autoscaleInfoProvider: () => null })
	}
	S.hmShownBands = shown.map((p) => ({ p, w: dw.get(p) }))
	const close = S.data.candles[S.data.candles.length - 1].close
	const up = S.hmShownBands.filter((x) => x.p.status === 'active' && x.p.side === 'sell-side' && x.p.extremePrice > close && x.w >= 0.75).sort((a, b) => a.p.extremePrice - b.p.extremePrice)[0]
	const dn = S.hmShownBands.filter((x) => x.p.status === 'active' && x.p.side === 'buy-side' && x.p.extremePrice < close && x.w >= 0.75).sort((a, b) => b.p.extremePrice - a.p.extremePrice)[0]
	const mag = ` · магнит ↑ ${up ? `${fmtP(up.p.extremePrice)} (+${((up.p.extremePrice / close - 1) * 100).toFixed(1)}%)` : '—'} ↓ ${dn ? `${fmtP(dn.p.extremePrice)} (−${((1 - dn.p.extremePrice / close) * 100).toFixed(1)}%)` : '—'}`
	const oiB = S.data.liquidityHeatmap?.oiBars || 0, tkB = S.data.liquidityHeatmap?.takerBars || 0
	const act = pools.filter((p) => p.status === 'active').length
	$('hmStatus').textContent = `Полки: ${act} активных · ${pools.length - act} снятых · нарисовано ${shown.length}/${pools.length}${mag} · OI ${oiB ? oiB + ' св.' : 'нет'} · taker ${tkB ? 'есть' : 'нет'}`
	drawHmProfile()
}

/** Тултип полосы под курсором (для единого crosshair-обработчика). */
export function hmBandTooltip(price) {
	if (!S.hmOn || !S.hmShownBands.length || price == null) return null
	const cand = S.hmShownBands
		.filter((x) => (price >= x.p.bandLow * 0.998 && price <= x.p.bandHigh * 1.002) || Math.abs(x.p.extremePrice / price - 1) < 0.002)
		.sort((a, b) => Math.abs(a.p.extremePrice - price) - Math.abs(b.p.extremePrice - price))[0]
	if (!cand) return null
	const b = cand.p
	const rem = b.status === 'active' ? Math.round(100 * (b.remainingNotional ?? b.notional) / (b.notional || 1)) : 0
	return `<div class="hover-title">${b.side === 'sell-side' ? 'SELL-SIDE (шорты)' : 'BUY-SIDE (лонги)'} · ${b.status === 'active' ? 'активна' : 'снята'}</div>
		<div class="hover-sub mono">уровень ${fmtP(b.extremePrice)} · вес ${cand.w.toFixed(2)}</div>
		<div class="hover-sub">размер ~${fmtN(b.notional)} · остаток ${rem}% · вкладов ${b.contributions || '—'}${b.merged > 1 ? ` · склеено ${b.merged}` : ''}</div>
		<div class="hover-sub">с ${new Date(b.startAt).toLocaleDateString('ru-RU')}${b.sweptAt ? ` · снята ${new Date(b.sweptAt).toLocaleDateString('ru-RU')}` : ''}</div>`
}

export function wireHeatmapPanel(redraw) {
	$('hmToggle').onclick = () => {
		S.hmOn = !S.hmOn
		$('hmControls').classList.toggle('hidden', !S.hmOn)
		$('hmToggle').textContent = S.hmOn ? 'Скрыть' : 'Показать'
		redraw()
	}
	for (const id of ['hmSide', 'hmMinWeight', 'hmGroup', 'hmShowSwept', 'hmAge']) $(id).onchange = () => redraw()
}
