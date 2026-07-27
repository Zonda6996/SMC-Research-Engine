import type { Candle } from '../../models/price/Candle.js'
import type { LiquidityPoiCandidate } from './LiquidityPoiCalibration.js'

// §16.24: УПРОЩЁННОЕ подтверждение (метод пользователя, ответы 27.07.2026). Лестница §14.1,
// первый ТФ пары: 1D-зона → 4h-свеча, 4h → 1h, 1h → 15m. Цикл: касание зоны (взведение как в
// уточнённом: полный отход rearmAtr → заход) → ПЕРВАЯ НАПРАВЛЕННАЯ свеча упрощённого ТФ после
// касания (не важно, внутри или выше зоны — решение пользователя) → вход по её закрытию →
// стоп «с хорошим запасом» (два режима на тест: за far зоны с буфером ИЛИ фикс-% от цены) →
// ведение: частичная фиксация partialFraction на +partialAtMovePct хода → стоп в БУ → фулл на
// +fullAtMovePct (цифры пользователя: 7–8% и 15–20% чистого движения; для локальных зон — свои,
// подбираются тестом). Повторные входы — тоже на тест: once (один вход на зону) или rearm
// (после стопа/БУ — новое взведение, пока зона жива; после фулла зона отработана).
// Позиция доигрывается за endAt зоны (как в уточнённом §16.10); новые входы после endAt не берутся.
// ВСЕ параметры — на сравнение train/test (§16.18-методика); дефолты ниже = стартовые, не канон.
export const SIMPLIFIED_CONFIRMATION_VERSION = 'simplified-confirmation-0.1'

export interface SimplifiedConfirmationConfig {
	/** Полный отход от зоны для (пере)взведения касания, в ATR упрощённого ТФ (как в уточнённом). */
	rearmAtr: number
	/** Режим стопа: 'far' — за дальней границей зоны с буфером; 'pct' — фикс-доля от цены входа. */
	stopMode: 'far' | 'pct'
	/** Буфер стопа за far, в ATR ТФ ЗОНЫ (poi.atr — стабильная единица масштаба зоны). */
	stopFarBufferAtr: number
	/** Фикс-стоп: доля цены входа (0.10 = 10% хода; «на 10 плече изолированно»; волатильные — 0.05). */
	stopPct: number
	/** Частичная фиксация: доля позиции (0.5 = половина). */
	partialFraction: number
	/** Уровень частичной фиксации: доля чистого движения от входа (0.075 = +7.5%). */
	partialAtMovePct: number
	/** Полный тейк: доля чистого движения от входа (0.175 = +17.5%). */
	fullAtMovePct: number
	/** Повторные входы: 'once' — один вход на зону; 'rearm' — после стопа/БУ новое взведение. */
	reentry: 'once' | 'rearm'
}

/** Стартовые значения (метод пользователя); сравнение вариантов — train/test-сеткой, не канон. */
export const SIMPLIFIED_CONFIRMATION_CONFIG: SimplifiedConfirmationConfig = {
	rearmAtr: 0.25,
	stopMode: 'far',
	stopFarBufferAtr: 0.25,
	stopPct: 0.10,
	partialFraction: 0.5,
	partialAtMovePct: 0.075,
	fullAtMovePct: 0.175,
	reentry: 'rearm',
}

export interface SimplifiedEntry {
	entryAt: number
	entry: number
	stop: number
	stopMode: 'far' | 'pct'
	partialPrice: number
	fullPrice: number
	/** Хронология: PARTIAL (частичка + стоп в БУ), BE (выбило в БУ), FULL, STOP. */
	events: Array<{ state: 'PARTIAL' | 'BE' | 'FULL' | 'STOP'; at: number; price: number }>
	/** stop — до частички; be — частичка взята, остаток в БУ; full — обе цели; open — край данных. */
	outcome: 'stop' | 'be' | 'full' | 'open'
	/** Взвешенный результат в долях ЧИСТОГО ХОДА цены (комиссии не вычтены). */
	grossMovePct: number | null
	/** То же в R от НАЧАЛЬНОГО риска (вход→стоп) — для сравнения со связкой уточнённого режима. */
	grossR: number | null
}

export interface SimplifiedConfirmationResult {
	poiId: string
	direction: 'long' | 'short'
	near: number
	far: number
	knownAt: number
	endAt: number
	entries: SimplifiedEntry[]
}

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
function atr(c: Candle[], i: number, n = 14): number {
	const x: number[] = []
	for (let k = Math.max(1, i - n + 1); k <= i; k++) {
		const v = c[k], p = c[k - 1]
		if (v && p) x.push(Math.max(v.high - v.low, Math.abs(v.high - p.close), Math.abs(v.low - p.close)))
	}
	return avg(x) || 0
}

/**
 * Прогон позиции с ведением: частичка на +partial → стоп в БУ → фулл на +full.
 * Внутрибарная неоднозначность решается КОНСЕРВАТИВНО: если бар накрыл и стоп, и цель —
 * засчитывается стоп (худший исход), как в replay-конвенциях проекта.
 */
function playPosition(
	ltf: Candle[], from: number, long: boolean, entry: number, stop0: number,
	partialPrice: number, fullPrice: number, cfg: SimplifiedConfirmationConfig,
	out: SimplifiedEntry,
): number {
	let stop = stop0
	let partialTaken = false
	const risk = Math.abs(entry - stop0)
	const done = (outcome: SimplifiedEntry['outcome'], k: number): number => {
		out.outcome = outcome
		const partMove = cfg.partialAtMovePct * cfg.partialFraction
		const restShare = 1 - cfg.partialFraction
		out.grossMovePct = outcome === 'full' ? partMove + cfg.fullAtMovePct * restShare
			: outcome === 'be' ? partMove
			: -(Math.abs(entry - stop0) / entry) // полный стоп всей позицией
		out.grossR = risk > 0 ? (out.grossMovePct * entry) / risk : null
		return k
	}
	for (let k = from; k < ltf.length; k++) {
		const c = ltf[k]!
		const hitStop = long ? c.low <= stop : c.high >= stop
		const hitPartial = !partialTaken && (long ? c.high >= partialPrice : c.low <= partialPrice)
		const hitFull = partialTaken && (long ? c.high >= fullPrice : c.low <= fullPrice)
		if (hitStop) {
			// консервативно: стоп раньше целей внутри одного бара
			out.events.push({ state: partialTaken ? 'BE' : 'STOP', at: c.timestamp, price: stop })
			return done(partialTaken ? 'be' : 'stop', k)
		}
		if (hitPartial) {
			partialTaken = true
			stop = entry // БУ после частички (метод пользователя)
			out.events.push({ state: 'PARTIAL', at: c.timestamp, price: partialPrice })
			// фулл в том же баре после частички не засчитываем (порядок внутри бара неизвестен)
			continue
		}
		if (hitFull) {
			out.events.push({ state: 'FULL', at: c.timestamp, price: fullPrice })
			return done('full', k)
		}
	}
	out.outcome = 'open'
	return ltf.length
}

/**
 * §16.24: упрощённое подтверждение по зонам (те же зоны v2.x: fallback и дубли не торгуются).
 * ltf — свечи УПРОЩЁННОГО ТФ (4h для 1D-зон, 1h для 4h, 15m для 1h).
 */
export function detectSimplifiedConfirmation(
	pois: LiquidityPoiCandidate[], ltf: Candle[], config?: Partial<SimplifiedConfirmationConfig>,
): SimplifiedConfirmationResult[] {
	const cfg: SimplifiedConfirmationConfig = { ...SIMPLIFIED_CONFIRMATION_CONFIG, ...config }
	const out: SimplifiedConfirmationResult[] = []
	for (const poi of pois) {
		if (poi.boundarySource !== 'liquidity-cluster' || poi.duplicateOf != null) continue
		const long = poi.direction === 'long'
		const lo = Math.min(poi.near, poi.far), hi = Math.max(poi.near, poi.far)
		const effectiveKnownAt = Math.max(poi.knownAt, poi.geometryKnownAt ?? poi.knownAt)
		const result: SimplifiedConfirmationResult = {
			poiId: poi.id, direction: poi.direction, near: poi.near, far: poi.far,
			knownAt: effectiveKnownAt, endAt: poi.endAt, entries: [],
		}
		let cursor = ltf.findIndex(c => c.timestamp >= effectiveKnownAt)
		if (cursor < 0) { out.push(result); continue }
		const endIdxRaw = ltf.findIndex(c => c.timestamp >= poi.endAt)
		const endIndex = endIdxRaw < 0 ? ltf.length : endIdxRaw
		let armed = false
		while (cursor < endIndex) {
			// взведение и касание — как в уточнённом (§16.7 armed touch)
			let touch = -1
			for (let j = cursor; j < endIndex; j++) {
				const c = ltf[j]!
				const inside = c.low <= hi && c.high >= lo
				if (inside && armed) { touch = j; break }
				if (!inside && (long ? c.low > hi + cfg.rearmAtr * atr(ltf, j) : c.high < lo - cfg.rearmAtr * atr(ltf, j))) armed = true
			}
			if (touch < 0) break
			// первая НАПРАВЛЕННАЯ свеча после касания (включая свечу касания) — вход по закрытию
			let entryIdx = -1
			for (let j = touch; j < endIndex; j++) {
				const c = ltf[j]!
				if (long ? c.close > c.open : c.close < c.open) { entryIdx = j; break }
			}
			if (entryIdx < 0) break
			const ec = ltf[entryIdx]!
			const stop = cfg.stopMode === 'far'
				? (long ? lo - cfg.stopFarBufferAtr * poi.atr : hi + cfg.stopFarBufferAtr * poi.atr)
				: (long ? ec.close * (1 - cfg.stopPct) : ec.close * (1 + cfg.stopPct))
			const entry: SimplifiedEntry = {
				entryAt: ec.timestamp, entry: ec.close, stop, stopMode: cfg.stopMode,
				partialPrice: long ? ec.close * (1 + cfg.partialAtMovePct) : ec.close * (1 - cfg.partialAtMovePct),
				fullPrice: long ? ec.close * (1 + cfg.fullAtMovePct) : ec.close * (1 - cfg.fullAtMovePct),
				events: [], outcome: 'open', grossMovePct: null, grossR: null,
			}
			// риск-санити: вход ниже стопа (лонг) невозможен по построению обоих режимов
			const exitIdx = playPosition(ltf, entryIdx + 1, long, entry.entry, stop, entry.partialPrice, entry.fullPrice, cfg, entry)
			result.entries.push(entry)
			cursor = Math.max(exitIdx + 1, entryIdx + 1)
			armed = false
			// фулл = зона отработала (аналог tp-hit §16.8); once = один вход на зону
			if (entry.outcome === 'full' || cfg.reentry === 'once' || entry.outcome === 'open') break
		}
		out.push(result)
	}
	return out
}
