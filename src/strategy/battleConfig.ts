// battleConfig.ts
//
// БОЕВОЙ КОНФИГ — единственный source of truth утверждённой стратегии.
// Итог исследовательской фазы SPEC 7.29–7.38 (все цифры подтверждены
// H1/H2-разбиением на канон-пуле 5931 сеток, 14 монет, 15m/30m/1h,
// косты BingX). Будущий сигнальный слой (SPEC 11) и форвард-тест обязаны
// читать параметры ОТСЮДА, а не дублировать константы.
//
// Строение системы — два потока на одной fib-сетке (уровни в ratio сетки,
// 0 = основание ноги, 100 = точка слома, >100 = расширения):
//
// Поток 1 «канон» (по тренду сетки):
//   deep: вход touch 38.2, стоп 15, тейк 61.8  (avgR +0.358, WR 45.7%)
//   ote:  вход touch 78.6, стоп 61.8, тейк 100 (avgR +0.244, WR 58.7%)
//   + bigbar-фильтр (SPEC 7.26), + тайм-стоп 20 баров только для ote
//   (SPEC 7.36: deep живёт ~4 бара, резать нечего).
//
// Поток 2 «реверс» (против сетки, только ote-сетки, SPEC 7.37/7.38/7.45):
//   mirror: лимитка на 100 после канон-входа, стоп 120, тейк 78.6
//   (avgR +0.172, H1 +0.169 / H2 +0.175 — очень стабилен).
//   fade141 УДАЛЁН (SPEC 7.45): без look-ahead он неисполним — заявка
//   ставится после канон-входа (от 78.6), цена не доходит до 141, не
//   пройдя 100, mirror филлится всегда первым. Старый avgR реверса
//   0.347 был завышен look-ahead'ом (fade с бара создания сетки).
//
// Сайзинг канона (SPEC 7.33/7.35, слои независимы — перемножаются):
//   risk = base × F(свежесть) × S(компактность) × T(сессия, опц.)
//   Стек поднимает R на юнит риска 0.280 → 0.362 (+29%). Сделки НЕ
//   режутся — только масштаб ставки.

/** Ratio-уровень fib-сетки в процентах (0 = основание, 100 = слом). */
export type GridRatio = number

export interface CanonSetup {
	scenario: 'deep' | 'ote'
	/** Вход по первому касанию уровня (touch-модель, без подтверждений). */
	entry: GridRatio
	stop: GridRatio
	take: GridRatio
	/** Тайм-стоп: закрытие по рынку через N баров без резолва. null — нет. */
	timeStopBars: number | null
}

export interface ReverseSetup {
	stream: 'mirror' | 'fade141'
	/** Лимитка на уровне (направление — ПРОТИВ сетки). */
	entry: GridRatio
	stop: GridRatio
	take: GridRatio
	/** Отмена заявки, если цена ушла за уровень до филла. */
	cancelBeyond: GridRatio
}

export const BATTLE_CONFIG = {
	/** SPEC 7.29/7.34: новый канон. Порядок: deep раньше ote по глубине. */
	canon: [
		{ scenario: 'deep', entry: 38.2, stop: 15, take: 61.8, timeStopBars: null },
		{ scenario: 'ote', entry: 78.6, stop: 61.8, take: 100, timeStopBars: 20 },
	] as readonly CanonSetup[],

	/**
	 * SPEC 7.37/7.38/7.45: реверс-поток на ote-сетках — только mirror.
	 * Лимитка ставится после канон-входа ote, отменяется при уходе цены
	 * за 0. fade141 удалён: реализуемый без look-ahead вариант (заявка
	 * после канон-входа) неисполним — mirror на 100 всегда филлится
	 * раньше 141 (fade-only на пофикшенном пуле: n 0).
	 */
	reverse: [
		{ stream: 'mirror', entry: 100, stop: 120, take: 78.6, cancelBeyond: 0 },
	] as readonly ReverseSetup[],

	/** SPEC 7.26: bigbar-фильтр канона (сетки от аномально больших баров — скип). */
	bigbarFilter: true,

	/** SPEC 7.35: сайзинг-стек канона. */
	sizing: {
		/** F: свежесть касания — баров от создания сетки до входа. */
		freshness: [
			{ maxBars: 3, mult: 2.0 },
			{ maxBars: 15, mult: 1.0 },
			{ maxBars: Number.POSITIVE_INFINITY, mult: 0.5 },
		],
		/** S: компактность — swing/ATR против скользящей медианы пула. */
		swingCompact: { compactMult: 1.4, wideMult: 0.7 },
		/** T: сессия UTC (опциональный слой — вклад +0.004 R/unit). */
		session: { hoursUtc: [15, 20] as readonly [number, number], mult: 1.2, enabled: false },
	},

	/**
	 * SPEC 7.44/7.45: сайзинг реверс-потока (mirror) — свежесть
	 * КАНОН-касания сетки. Лесенка на пофикшенном пуле (без look-ahead):
	 * avgR 0.268 / 0.178 / 0.138, монотонна и устойчива H1/H2, но
	 * перепад мягче канонного — множители консервативные.
	 */
	reverseSizing: {
		freshness: [
			{ maxBars: 3, mult: 1.5 },
			{ maxBars: 15, mult: 1.0 },
			{ maxBars: Number.POSITIVE_INFINITY, mult: 0.7 },
		],
	},
} as const

/**
 * Множитель риска реверс-сделки (SPEC 7.44): свежесть канон-касания.
 * @param freshBars баров от создания сетки до канон-касания; null —
 *                  канон ещё не вошёл к моменту филла реверса (флэт 1.0)
 */
export function reverseRiskMultiplier(freshBars: number | null): number {
	if (freshBars == null) return 1.0
	return BATTLE_CONFIG.reverseSizing.freshness.find((b) => freshBars <= b.maxBars)?.mult ?? 1
}

/**
 * Множитель риска канон-сделки по сайзинг-стеку (SPEC 7.35).
 * @param freshBars      баров от создания сетки до касания входа
 * @param swingAtr       swing/ATR сетки (null — слой пропускается, 1.0)
 * @param medianSwingAtr скользящая медиана swing/ATR (null — слой 1.0)
 * @param hourUtc        час входа UTC (null или слой выключен — 1.0)
 */
export function canonRiskMultiplier(
	freshBars: number,
	swingAtr: number | null,
	medianSwingAtr: number | null,
	hourUtc: number | null = null,
): number {
	const f = BATTLE_CONFIG.sizing.freshness.find((b) => freshBars <= b.maxBars)?.mult ?? 1
	const s = swingAtr != null && medianSwingAtr != null
		? (swingAtr <= medianSwingAtr ? BATTLE_CONFIG.sizing.swingCompact.compactMult : BATTLE_CONFIG.sizing.swingCompact.wideMult)
		: 1
	const t = BATTLE_CONFIG.sizing.session.enabled && hourUtc != null
		&& hourUtc >= BATTLE_CONFIG.sizing.session.hoursUtc[0] && hourUtc < BATTLE_CONFIG.sizing.session.hoursUtc[1]
		? BATTLE_CONFIG.sizing.session.mult
		: 1
	return f * s * t
}

/** Цена ratio-уровня сетки: p0 = основание (0%), p100 = слом (100%). */
export function gridLevelPrice(p0: number, p100: number, ratio: GridRatio): number {
	return p0 + (ratio / 100) * (p100 - p0)
}
