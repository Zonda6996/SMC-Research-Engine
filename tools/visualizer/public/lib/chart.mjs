// lib/chart.mjs — обёртка над lightweight-charts v5: свечи, оверлеи, маркеры и
// главное новшество редизайна — примитив ПРЯМОУГОЛЬНИКОВ зон (заливка + границы,
// градация по силе стека). Прямоугольники не участвуют в автошкале цены, кроме
// сфокусированной зоны (autoscaleInfo примитива) — график не «сплющивается».

import { S } from './state.mjs'
import { time, C } from './format.mjs'

const LWC = () => window.LightweightCharts

export let chart = null
export let candlesSeries = null
let markersPlugin = null
let overlays = []
export const zonesPrim = makeZonesPrimitive()

/** Прямоугольники зон: [{t1,t2,p1,p2,side,focused,dim,alpha,label,id,manual}] (t в секундах). */
function makeZonesPrimitive() {
	const prim = {
		_rects: [],
		_focus: null, // {min,max} цены сфокусированной зоны — тянет автошкалу
		_ctx: null,
		attached(p) { prim._ctx = p },
		detached() { prim._ctx = null },
		setRects(rects, focusRange = null) {
			prim._rects = rects
			prim._focus = focusRange
			prim._ctx?.requestUpdate?.()
		},
		autoscaleInfo() {
			if (!prim._focus) return null
			return { priceRange: { minValue: prim._focus.min, maxValue: prim._focus.max } }
		},
		paneViews() { return prim._views },
	}
	const renderer = {
		draw(target) {
			const p = prim._ctx
			if (!p || !prim._rects.length) return
			const ts = p.chart.timeScale()
			const vr = ts.getVisibleRange()
			if (!vr) return
			target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hpr, verticalPixelRatio: vpr, mediaSize }) => {
				ctx.save()
				ctx.font = `${Math.round(10 * vpr)}px "Geist Mono", ui-monospace, monospace`
				for (const r of prim._rects) {
					if (r.t2 < vr.from || r.t1 > vr.to) continue
					let x1 = r.t1 <= vr.from ? 0 : (ts.timeToCoordinate(r.t1) ?? 0)
					let x2 = r.t2 >= vr.to ? mediaSize.width : (ts.timeToCoordinate(r.t2) ?? mediaSize.width)
					const yA = p.series.priceToCoordinate(r.p1)
					const yB = p.series.priceToCoordinate(r.p2)
					if (yA == null || yB == null) continue
					const yTop = Math.min(yA, yB), yBot = Math.max(yA, yB)
					if (yBot < 0 || yTop > mediaSize.height) continue
					const X = Math.min(x1, x2) * hpr, W = Math.max(1, Math.abs(x2 - x1)) * hpr
					const Y = yTop * vpr, H = Math.max(1, yBot - yTop) * vpr
					const [cr, cg, cb] = r.side === 'long' ? [47, 208, 140] : [244, 80, 106]
					const base = r.manual ? 0.05 : (0.05 + 0.09 * Math.min(1, r.alpha ?? 1))
					const fill = r.focused ? Math.max(0.2, base + 0.08) : r.dim ? 0.035 : base
					ctx.fillStyle = `rgba(${cr},${cg},${cb},${fill})`
					ctx.fillRect(X, Y, W, H)
					// near — сплошная граница цветом стороны; far — пунктир.
					const yNear = (r.side === 'long' ? yTop : yBot) * vpr
					const yFar = (r.side === 'long' ? yBot : yTop) * vpr
					ctx.lineWidth = (r.focused ? 2 : 1) * vpr
					ctx.strokeStyle = r.manual ? 'rgba(56,189,248,0.9)' : `rgba(${cr},${cg},${cb},${r.dim ? 0.35 : 0.9})`
					ctx.setLineDash(r.manual ? [6 * hpr, 4 * hpr] : [])
					ctx.beginPath(); ctx.moveTo(X, yNear); ctx.lineTo(X + W, yNear); ctx.stroke()
					ctx.setLineDash([4 * hpr, 4 * hpr])
					ctx.strokeStyle = r.manual ? 'rgba(56,189,248,0.5)' : `rgba(154,123,255,${r.dim ? 0.3 : 0.7})`
					ctx.lineWidth = 1 * vpr
					ctx.beginPath(); ctx.moveTo(X, yFar); ctx.lineTo(X + W, yFar); ctx.stroke()
					ctx.setLineDash([])
					if (r.label && (r.focused || r.manual || W > 180 * hpr)) {
						ctx.fillStyle = r.manual ? 'rgba(56,189,248,0.95)' : `rgba(${cr},${cg},${cb},0.95)`
						const ly = r.side === 'long' ? Y + 12 * vpr : Y + H - 5 * vpr
						ctx.fillText(r.label, X + 6 * hpr, ly)
					}
				}
				ctx.restore()
			})
		},
	}
	prim._views = [{ renderer: () => renderer }]
	return prim
}

/** Зона под курсором (для hover-карточки и клика-фокуса). */
export function rectAt(t, price) {
	const hits = zonesPrim._rects.filter((r) => !r.manual && t >= r.t1 && t <= r.t2
		&& price >= Math.min(r.p1, r.p2) && price <= Math.max(r.p1, r.p2))
	return hits.sort((a, b) => Math.abs(a.p1 - a.p2) - Math.abs(b.p1 - b.p2))[0] ?? null
}

export function initChart(onCrosshair, onClick, onPan) {
	if (chart) chart.remove()
	const el = document.getElementById('chart')
	chart = LWC().createChart(el, {
		width: el.clientWidth, height: el.clientHeight,
		layout: {
			background: { color: '#0a0a0b' }, textColor: C.text,
			fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif', fontSize: 11,
			attributionLogo: false,
		},
		grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
		crosshair: { mode: LWC().CrosshairMode.Normal },
		timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#232329' },
		rightPriceScale: { borderColor: '#232329', scaleMargins: { top: 0.08, bottom: 0.08 } },
	})
	candlesSeries = chart.addSeries(LWC().CandlestickSeries, {
		upColor: C.green, downColor: C.red, borderUpColor: C.green, borderDownColor: C.red,
		wickUpColor: C.green, wickDownColor: C.red,
	})
	candlesSeries.attachPrimitive(zonesPrim)
	markersPlugin = LWC().createSeriesMarkers(candlesSeries, [])
	S.mainShown = false
	if (onCrosshair) chart.subscribeCrosshairMove(onCrosshair)
	if (onClick) chart.subscribeClick(onClick)
	if (onPan) chart.timeScale().subscribeVisibleLogicalRangeChange(onPan)
	new ResizeObserver(() => chart?.applyOptions({ width: el.clientWidth, height: el.clientHeight })).observe(el)
	return chart
}

export function line(points, opts = {}) {
	const s = chart.addSeries(LWC().LineSeries, { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false, ...opts })
	s.setData(points)
	overlays.push(s)
	return s
}

export function seriesMarkers(series, marks) { LWC().createSeriesMarkers(series, marks) }
export function setMarkers(marks) { markersPlugin.setMarkers(marks) }
export function clearOverlays() {
	for (const s of overlays) { try { chart.removeSeries(s) } catch { /* series уже снят */ } }
	overlays = []
	zonesPrim.setRects([])
}

export function setCandles(list, isMain = false) {
	candlesSeries.setData(list.map((c) => ({ time: time(c.timestamp), open: c.open, high: c.high, low: c.low, close: c.close })))
	S.mainShown = isMain
}
export function restoreMainCandles() {
	if (!S.data || S.mainShown) return
	setCandles(S.data.candles, true)
}
export const lineStyle = () => LWC().LineStyle
export const fitContent = () => chart.timeScale().fitContent()
export const setVisibleRange = (fromMs, toMs) => chart.timeScale().setVisibleRange({ from: time(fromMs), to: time(toMs) })
export const priceAt = (y) => candlesSeries.coordinateToPrice(y)
/** Сохранение/восстановление зума-позиции (логический диапазон — по индексам баров). */
export const getLogicalRange = () => chart?.timeScale().getVisibleLogicalRange() ?? null
export const setLogicalRange = (r) => { if (r) chart.timeScale().setVisibleLogicalRange(r) }
