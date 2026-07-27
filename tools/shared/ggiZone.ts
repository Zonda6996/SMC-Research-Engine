// ggiZone.ts
//
// §16.25: GGI Zone — АППРОКСИМАЦИЯ приватного индикатора перекупленности/перепроданности
// пользователя (воссоздание по скринам, как heatmap). Эталоны: BTC 1h/4h и DOGE 1h (27.07.2026).
// Модель: mean = EMA(EMA(close, meanLen), meanSmooth) — гладкая «средняя» с лагом ~суток на 1h;
// dev = EMA(|close − mean|, devLen) — дышащее отклонение; красная зона (перекуплен) =
// [mean + kInner×dev, mean + kOuter×dev], зелёная (перепродан) — зеркально вниз.
// Подгонка по якорям скрина BTC 1h: mean 64642 → 64633, redLo 65709 → 65700, redHi 67292 → 67281,
// greenHi 63593 → 63566 (ошибка 0.01–0.04%), лаг пика mean — 1 час. НЕ канон движков: слой
// инструментов/фильтров, значения могут уточняться по новым скринам пользователя.
import type { Candle } from '../../src/models/price/Candle.js'

export const GGI_ZONE_VERSION = 'ggi-zone-approx-0.1'

export interface GgiZoneConfig {
	meanLen: number
	meanSmooth: number
	devLen: number
	kInner: number
	kOuter: number
}

export const GGI_ZONE_CONFIG: GgiZoneConfig = {
	meanLen: 80,
	meanSmooth: 20,
	devLen: 40,
	kInner: 2.68,
	kOuter: 6.65,
}

export interface GgiPoint {
	meanV: number
	redLo: number
	redHi: number
	greenHi: number
	greenLo: number
}

function ema(xs: number[], n: number): number[] {
	const k = 2 / (n + 1)
	const out: number[] = []
	let e = xs[0] ?? 0
	for (const x of xs) { e = x * k + e * (1 - k); out.push(e) }
	return out
}

/** Ряд GGI по свечам (индекс в индекс; первые ~meanLen баров — прогрев, значения условны). */
export function computeGgiZone(candles: Candle[], config?: Partial<GgiZoneConfig>): GgiPoint[] {
	const cfg = { ...GGI_ZONE_CONFIG, ...config }
	if (!candles.length) return []
	const closes = candles.map(c => c.close)
	const mean = ema(ema(closes, cfg.meanLen), cfg.meanSmooth)
	const dev = ema(closes.map((x, i) => Math.abs(x - mean[i]!)), cfg.devLen)
	return mean.map((m, i) => ({
		meanV: m,
		redLo: m + cfg.kInner * dev[i]!,
		redHi: m + cfg.kOuter * dev[i]!,
		greenHi: m - cfg.kInner * dev[i]!,
		greenLo: m - cfg.kOuter * dev[i]!,
	}))
}

/** Состояние бара: перепродан (low в зелёной зоне и ниже), перекуплен (high в красной), нейтрально. */
export function ggiStateAt(c: Candle, g: GgiPoint): 'oversold' | 'overbought' | 'neutral' {
	if (c.low <= g.greenHi) return 'oversold'
	if (c.high >= g.redLo) return 'overbought'
	return 'neutral'
}
