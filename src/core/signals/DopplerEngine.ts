// DopplerEngine.ts
//
// Ядро Doppler (в протоколах — D6 Cascade Reversion): детекция каскадного делевериджинга
// по OI + цена и симуляция сделки. ЕДИНСТВЕННЫЙ источник логики (до 24.08.2026 логика была
// размножена в раннерах d6-mgmt/d6-tp/d6-partial/forward — сведена сюда, решение автора).
// Каузально: OI — последнее известное значение на открытие бара; стоп считается по окну,
// завершившемуся на сигнальном баре; вход — открытие следующего бара.
//
// Правило (docs/INDICATOR.md §10): бар i закрылся с ΔOI(window) ≤ порог И ΔP(window) ≤ порог
// → LONG на open бара i+1; стоп = min(low окна) − mult×ATR200; выход — стоп или таймаут
// (reclaim опционален, по умолчанию ВЫКЛ — срезает хвост, d6-multitf 2026-08-24).

import type { Candle } from '../../models/price/Candle.js'
import { arrowAtr200 } from './ArrowSignalEngine.js'

export const DOPPLER_VERSION = 'doppler-1.0-cascade-core'

export interface DopplerConfig {
	/** Порог просадки OI за окно, отрицательный (например −0.15). */
	oiDrop: number
	/** Порог просадки цены за окно, отрицательный (например −0.05). */
	priceDrop: number
	/** Окно каскада в барах данного ТФ (8ч → 8 на 1h, 96 на 5m). */
	windowBars: number
	/** Min-gap между событиями в барах данного ТФ (8ч → 8 на 1h). */
	gapBars: number
	/** Таймаут удержания в барах данного ТФ (72ч → 72 на 1h). */
	holdBars: number
	/** Множитель ATR200 для структурного стопа (канон 0.5). */
	stopAtrMult: number
}

/** Утверждённые режимы-пресеты порога (цена −5% у всех; окна считает вызывающий под свой ТФ). */
export const DOPPLER_MODE_PRESETS = {
	SAFE: { oiDrop: -0.2, priceDrop: -0.05 },
	STANDARD: { oiDrop: -0.15, priceDrop: -0.05 },
	RISK: { oiDrop: -0.12, priceDrop: -0.05 },
} as const

export type DopplerModeId = keyof typeof DOPPLER_MODE_PRESETS

export interface DopplerEvent {
	/** Сигнальный бар (закрытие которого подтвердило каскад). */
	index: number
	/** Бар входа (index + 1). */
	entryIndex: number
	entryOpen: number
	stop: number
	riskDist: number
	atr: number
	/** Минимум low в окне каскада (уровень флаша). */
	windowLow: number
	/** Фактическая просадка OI за окно (отрицательная). */
	oiChange: number
	/** Фактическая просадка цены за окно (отрицательная). */
	priceChange: number
}

export interface DopplerTradeOutcome {
	exitIndex: number
	exitPrice: number
	outcome: 'stop' | 'timeout' | 'reclaim'
}

/**
 * Детекция каскадных событий. `oi` — выровненный причинный ряд (значение на открытие бара,
 * null если свежее данных нет); `atr200` — arrowAtr200(candles) (можно посчитать один раз
 * на все режимы). События без валидного ATR пропускаются; на последний бар (без бара входа)
 * событие не детектируется.
 */
export function detectDopplerCascades(
	candles: readonly Candle[],
	oi: ReadonlyArray<number | null>,
	atr200: readonly (number | null)[],
	config: DopplerConfig,
): DopplerEvent[] {
	const events: DopplerEvent[] = []
	if (candles.length < config.windowBars + 2) return events
	let lastAdmitted = -Infinity
	for (let i = config.windowBars; i + 1 < candles.length; i++) {
		const oiNow = oi[i]
		const oiPast = oi[i - config.windowBars]!
		if (oiNow == null || oiPast == null || oiPast <= 0) continue
		const oiChange = oiNow / oiPast - 1
		const priceChange = candles[i]!.close / candles[i - config.windowBars]!.close - 1
		if (!(oiChange <= config.oiDrop && priceChange <= config.priceDrop)) continue
		if (i - lastAdmitted < config.gapBars) continue
		lastAdmitted = i
		const atr = atr200[i]
		if (atr == null || !Number.isFinite(atr) || atr <= 0) continue
		let windowLow = Number.POSITIVE_INFINITY
		for (let j = i - config.windowBars + 1; j <= i; j++) windowLow = Math.min(windowLow, candles[j]!.low)
		const entryIndex = i + 1
		const entryOpen = candles[entryIndex]!.open
		const stop = windowLow - config.stopAtrMult * atr
		events.push({ index: i, entryIndex, entryOpen, stop, riskDist: entryOpen - stop, atr, windowLow, oiChange, priceChange })
	}
	return events
}

/**
 * Симуляция сделки от события: стоп-первым внутри бара, затем (опционально) reclaim —
 * закрытие бара ≥ close начала окна; иначе таймаут. Требует candles.length ≥
 * entryIndex + holdBars (звонящий заранее отфильтровал неполные горизонты).
 */
export function simulateDopplerTrade(
	candles: readonly Candle[],
	ev: DopplerEvent,
	config: DopplerConfig,
	opts: { reclaim?: boolean } = {},
): DopplerTradeOutcome {
	const exitCap = ev.entryIndex + config.holdBars - 1
	if (exitCap > candles.length - 1) throw new Error(`Doppler: нет полного горизонта (нужно ${exitCap}, есть ${candles.length - 1})`)
	const refLevel = candles[ev.index - config.windowBars]!.close
	for (let k = ev.entryIndex; k <= exitCap; k++) {
		const bar = candles[k]!
		if (bar.low <= ev.stop) return { exitIndex: k, exitPrice: ev.stop, outcome: 'stop' }
		if (opts.reclaim && k > ev.entryIndex && bar.close >= refLevel) return { exitIndex: k, exitPrice: bar.close, outcome: 'reclaim' }
	}
	return { exitIndex: exitCap, exitPrice: candles[exitCap]!.close, outcome: 'timeout' }
}

/** ATR200 канона движка — реэкспорт для удобства вызова (один импорт вместо двух). */
export { arrowAtr200 as dopplerAtr200 }
