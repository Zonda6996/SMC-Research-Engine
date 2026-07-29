// Zonda Apex — полосы экстремумов; Zonda Reversal — отдельные BUY/SELL сигналы.
//
// Формула восстановлена по 14 историческим якорям Binance Spot BTC 5m/15m/4h
// и ETH 1h (20/27/28/29.07.2026):
//   mean = ALMA(hlc3, 200, offset=0.85, sigma=6)
//   upper/lower = mean * exp(+-k*s), k = 5.6 (внутри) / 9.6 (снаружи)
//   s ≈ ALMA(trueRange/close, 122, offset=0.625, sigma=3.5)
// Средняя переносится с ошибкой 0.02–0.27%; закрытая мера s восстановлена как
// устойчивая аппроксимация с максимальной наблюдавшейся ошибкой около 4%.
import type { Candle } from '../../models/price/Candle.js'

export const APEX_VERSION = 'apex-1.1-tv-settings'
export const REVERSAL_VERSION = 'reversal-1.0-directional-candle'

export interface ApexParams {
	/** Источник средней как в TradingView; канон калибровки — hlc3. */
	source: 'hlc3' | 'close' | 'hl2' | 'ohlc4'
	lookback: number
	kInner: number
	kOuter: number
	meanOffset: number
	meanSigma: number
	devLookback: number
	devOffset: number
	devSigma: number
	widthScale: number
	/** Какой край взводит Reversal. outer — наблюдаемый канон; inner — диагностический режим. */
	signalMode: 'outer' | 'inner'
}

/** Числа зафиксированы измерениями; не менять без новой cross-symbol проверки. */
export const APEX_PARAMS: ApexParams = {
	source: 'hlc3',
	lookback: 200,
	kInner: 5.6,
	kOuter: 9.6,
	meanOffset: 0.85,
	meanSigma: 6,
	devLookback: 122,
	devOffset: 0.625,
	devSigma: 3.5,
	widthScale: 1,
	signalMode: 'outer',
}

export interface ApexBand {
	mean: number
	/** Безразмерная относительная ширина; 0.001 = 0.1% цены. */
	s: number
	redLo: number
	redHi: number
	greenHi: number
	greenLo: number
}

export interface ReversalSignal {
	at: number
	direction: 'long' | 'short'
	close: number
	edge: number
}

const sourceValue = (c: Candle, source: ApexParams['source']): number => {
	if (source === 'close') return c.close
	if (source === 'hl2') return (c.high + c.low) / 2
	if (source === 'ohlc4') return (c.open + c.high + c.low + c.close) / 4
	return (c.high + c.low + c.close) / 3
}

function alma(values: number[], n: number, offset: number, sigma: number): number[] {
	const out = new Array<number>(values.length).fill(NaN)
	if (n <= 0 || sigma <= 0) return out
	const m = offset * (n - 1)
	const width = n / sigma
	const weights = new Array<number>(n)
	let weightSum = 0
	for (let j = 0; j < n; j++) {
		const w = Math.exp(-((j - m) ** 2) / (2 * width * width))
		weights[j] = w
		weightSum += w
	}
	for (let i = n - 1; i < values.length; i++) {
		let sum = 0
		for (let j = 0; j < n; j++) sum += weights[j]! * values[i - (n - 1) + j]!
		out[i] = sum / weightSum
	}
	return out
}

/** Каузальные полосы: бар i использует только свечи с индексами <= i. */
export function computeApexBands(candles: Candle[], paramsArg: Partial<ApexParams> = {}): ApexBand[] {
	const p: ApexParams = { ...APEX_PARAMS, ...paramsArg }
	const mean = alma(candles.map((c) => sourceValue(c, p.source)), p.lookback, p.meanOffset, p.meanSigma)
	const trRelative = candles.map((c, i) => {
		const tr = i === 0
			? c.high - c.low
			: Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1]!.close), Math.abs(c.low - candles[i - 1]!.close))
		return c.close > 0 ? tr / c.close : NaN
	})
	const spread = alma(trRelative, p.devLookback, p.devOffset, p.devSigma)
	return candles.map((_, i) => {
		const m = mean[i]!
		const s = spread[i]! * p.widthScale
		return {
			mean: m,
			s,
			redLo: m * Math.exp(p.kInner * s),
			redHi: m * Math.exp(p.kOuter * s),
			greenHi: m * Math.exp(-p.kInner * s),
			greenLo: m * Math.exp(-p.kOuter * s),
		}
	})
}

/**
 * Reversal v1 — минимальная логика, которую подтверждают скрины:
 * 1) внешний край Apex взводит сторону;
 * 2) BUY фиксируется только бычьей свечой, SELL — только медвежьей;
 * 3) после сигнала сторона перевзводится лишь возвратом к средней.
 *
 * Касание может произойти на предыдущей свече: это покрывает наблюдаемое поведение
 * живого индикатора, где метка появляется внутри бара и к закрытию подтверждается
 * только если свеча стала направленной. Дополнительные фильтры здесь не выдумываются.
 */
export function detectReversals(candles: Candle[], paramsArg: Partial<ApexParams> = {}): ReversalSignal[] {
	const p: ApexParams = { ...APEX_PARAMS, ...paramsArg }
	const bands = computeApexBands(candles, p)
	const out: ReversalSignal[] = []
	let armedLong = true, armedShort = true
	let pendingLong = false, pendingShort = false
	for (let i = 0; i < candles.length; i++) {
		const c = candles[i]!, b = bands[i]!
		if (!Number.isFinite(b.mean) || !Number.isFinite(b.s)) continue
		if (!armedLong && c.close >= b.mean) { armedLong = true; pendingLong = false }
		if (!armedShort && c.close <= b.mean) { armedShort = true; pendingShort = false }
		const longEdge = p.signalMode === 'outer' ? b.greenLo : b.greenHi
		const shortEdge = p.signalMode === 'outer' ? b.redHi : b.redLo
		if (armedLong && c.low <= longEdge) pendingLong = true
		if (armedShort && c.high >= shortEdge) pendingShort = true
		// При одновременном экстремуме приоритет отдаётся направлению закрытия свечи.
		if (pendingLong && armedLong && c.close > c.open) {
			out.push({ at: c.timestamp, direction: 'long', close: c.close, edge: longEdge })
			armedLong = false
			pendingLong = false
		} else if (pendingShort && armedShort && c.close < c.open) {
			out.push({ at: c.timestamp, direction: 'short', close: c.close, edge: shortEdge })
			armedShort = false
			pendingShort = false
		}
		// Если цена прошла среднюю без подтверждения, старое ожидание протухло.
		if (c.close >= b.mean) pendingLong = false
		if (c.close <= b.mean) pendingShort = false
	}
	return out
}

export function apexStateAt(c: Candle, b: ApexBand): 'oversold' | 'overbought' | 'neutral' {
	if (!Number.isFinite(b.mean) || !Number.isFinite(b.s)) return 'neutral'
	if (c.low <= b.greenHi) return 'oversold'
	if (c.high >= b.redLo) return 'overbought'
	return 'neutral'
}
