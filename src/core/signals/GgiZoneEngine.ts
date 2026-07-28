// GgiZoneEngine.ts — полосы перекупленности/перепроданности и сигналы разворота
// по ФАКТИЧЕСКИМ параметрам приватного индикатора GGI Zone / GGI Buy/Sell (§16.28–16.29).
//
// Параметры взяты из скрина настроек индикатора, НЕ подобраны:
//   источник (МАКС+МИН+ЗАКР)/3 = hlc3 · Lookback Period 200 · Inner Multiplier 5.6 · Outer Amplitude 9.6
//   inner = mean ± 5.6 × dev,  outer = mean ± 9.6 × dev
// Структура подтверждена четырьмя ОДНОВРЕМЕННЫМИ якорями BTC (5m/15m/1h/4h), симметрия 0.5–4.8%.
// Мера отклонения — семейство ATR (STDEV исключён: ошибка 2.4–6.5×); средняя — EMA(200)
// (ближе всех к якорям: 1h +0.30%, 4h −0.78%; SMA/RMA/WMA хуже).
//
// ВАЖНО о применении (§16.29): сигнал этих полос на наших зонных входах работает
// ИНВЕРТИРОВАННО — он помечает ХУДШИЕ входы. Экономический смысл: сигнал означает
// «цена растянута к экстремуму», а полка ликвидности в свежем сильном движении —
// топливо продолжения, а не разворот (группа C разбора стопов §16.18).
import type { Candle } from '../../models/price/Candle.js'

export const GGI_ZONE_ENGINE_VERSION = 'ggi-zone-2.0-vendor-params'

export interface GgiZoneParams {
	/** Lookback Period из настроек индикатора. */
	lookback: number
	/** Inner Multiplier: внутренний край полосы. */
	kInner: number
	/** Outer Amplitude: внешний край полосы. */
	kOuter: number
	/** Тип средней. ema — лучшая подгонка к якорям. */
	meanType: 'ema' | 'sma' | 'rma' | 'wma'
	/** Мера отклонения: atr — RMA от true range (канон Wilder). */
	devType: 'atr' | 'atrSma' | 'hl'
	/** Калибровочный множитель ширины (1 = ровно как в настройках вендора). */
	widthScale: number
}

/** Ровно значения из скрина настроек индикатора. Не менять без новых якорей. */
export const GGI_ZONE_PARAMS: GgiZoneParams = {
	lookback: 200, kInner: 5.6, kOuter: 9.6,
	meanType: 'ema', devType: 'atr', widthScale: 1,
}

export interface GgiBand {
	mean: number
	dev: number
	/** Внутренний и внешний край верхней (красной) зоны — перекупленность. */
	redLo: number
	redHi: number
	/** Внутренний и внешний край нижней (зелёной) зоны — перепроданность. */
	greenHi: number
	greenLo: number
}

const hlc3 = (c: Candle): number => (c.high + c.low + c.close) / 3

function movAvg(x: number[], n: number, type: GgiZoneParams['meanType']): number[] {
	const o = new Array<number>(x.length).fill(NaN)
	if (!x.length) return o
	if (type === 'sma') {
		let s = 0
		for (let i = 0; i < x.length; i++) { s += x[i]!; if (i >= n) s -= x[i - n]!; if (i >= n - 1) o[i] = s / n }
		return o
	}
	if (type === 'wma') {
		for (let i = n - 1; i < x.length; i++) {
			let s = 0, w = 0
			for (let k = 0; k < n; k++) { const ww = n - k; s += x[i - k]! * ww; w += ww }
			o[i] = s / w
		}
		return o
	}
	const a = type === 'rma' ? 1 / n : 2 / (n + 1)
	let v = x[0]!
	for (let i = 0; i < x.length; i++) { v = i === 0 ? x[0]! : v + a * (x[i]! - v); o[i] = v }
	return o
}

/** Полосы на каждом баре. Каузально: значение на баре i зависит только от свечей ≤ i. */
export function computeGgiBands(candles: Candle[], paramsArg: Partial<GgiZoneParams> = {}): GgiBand[] {
	const p: GgiZoneParams = { ...GGI_ZONE_PARAMS, ...paramsArg }
	const n = p.lookback
	const src = candles.map(hlc3)
	const tr = candles.map((c, i) => i === 0
		? c.high - c.low
		: Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1]!.close), Math.abs(c.low - candles[i - 1]!.close)))
	const mean = movAvg(src, n, p.meanType)
	const dev = p.devType === 'atr' ? movAvg(tr, n, 'rma')
		: p.devType === 'atrSma' ? movAvg(tr, n, 'sma')
		: movAvg(candles.map((c) => c.high - c.low), n, 'sma')
	const out: GgiBand[] = []
	for (let i = 0; i < candles.length; i++) {
		const m = mean[i]!
		const d = (dev[i] ?? NaN) * p.widthScale
		out.push({
			mean: m, dev: d,
			redLo: m + p.kInner * d, redHi: m + p.kOuter * d,
			greenHi: m - p.kInner * d, greenLo: m - p.kOuter * d,
		})
	}
	return out
}

export interface GgiSignal {
	at: number
	direction: 'long' | 'short'
	/** Цена закрытия бара сигнала. */
	close: number
	/** Внутренний край полосы, который был задет. */
	edge: number
}

/**
 * Сигналы индикатора: касание ВНУТРЕННЕГО края полосы; повторный сигнал той же стороны
 * возможен только после возврата цены к средней линии (перевзведение). Правило снято
 * с поведения оригинала: метки появляются не на каждом касании, а один раз на заход в зону.
 */
export function detectGgiSignals(candles: Candle[], paramsArg: Partial<GgiZoneParams> = {}): GgiSignal[] {
	const bands = computeGgiBands(candles, paramsArg)
	const out: GgiSignal[] = []
	let armedLong = true, armedShort = true
	for (let i = 0; i < candles.length; i++) {
		const c = candles[i]!, b = bands[i]!
		if (!Number.isFinite(b.mean) || !Number.isFinite(b.dev)) continue
		if (!armedLong && c.close >= b.mean) armedLong = true
		if (!armedShort && c.close <= b.mean) armedShort = true
		if (armedLong && c.low <= b.greenHi) {
			out.push({ at: c.timestamp, direction: 'long', close: c.close, edge: b.greenHi })
			armedLong = false
		} else if (armedShort && c.high >= b.redLo) {
			out.push({ at: c.timestamp, direction: 'short', close: c.close, edge: b.redLo })
			armedShort = false
		}
	}
	return out
}

/** Состояние на баре: перепродан / перекуплен / нейтрально (по касанию внутренних краёв). */
export function ggiStateAt(c: Candle, b: GgiBand): 'oversold' | 'overbought' | 'neutral' {
	if (!Number.isFinite(b.mean)) return 'neutral'
	if (c.low <= b.greenHi) return 'oversold'
	if (c.high >= b.redLo) return 'overbought'
	return 'neutral'
}
