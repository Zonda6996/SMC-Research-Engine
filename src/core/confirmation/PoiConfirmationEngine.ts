import type { Candle } from '../../models/price/Candle.js'
import type { LiquidityPoiCandidate } from './LiquidityPoiCalibration.js'

// SPEC §14: уточнённое подтверждение, ведомое от уже откалиброванных v1.0 POI-зон (near/far), а не от самостоятельно
// найденных OB/FVG как в RefinedPoiEngine в 0.2. Окно активности зоны — [knownAt, endAt) из самого POI-движка:
// far-close invalidation (§14.6) уже зашито в endAt/failedAt той зоны, повторно здесь её не пересчитываем.
export const POI_CONFIRMATION_VERSION = 'poi-confirmation-1.0-zone-driven'

export interface ConfirmationTrace {
	state: string
	at: number
	price?: number
	volume?: number
	volumeRatio?: number
}

export interface ConfirmationAttempt {
	attemptIndex: number
	status: 'entered' | 'rejected'
	rejectionReason: string | null
	touchAt: number
	stopLevel: number | null
	entryAt: number | null
	entry: number | null
	stop: number | null
	tp2: number | null
	outcome: 'tp' | 'stop' | 'open' | null
	grossR: number | null
	trace: ConfirmationTrace[]
}

export interface PoiConfirmationResult {
	poiId: string
	direction: 'long' | 'short'
	zoneClass: string
	near: number
	far: number
	knownAt: number
	endAt: number
	attempts: ConfirmationAttempt[]
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
function dirBar(c: Candle, long: boolean): boolean {
	return long ? c.close > c.open : c.close < c.open
}

/**
 * SPEC §14.2-14.5: одна попытка подтверждения внутри окна [cursor, endIndex). Возвращает последний
 * просмотренный индекс в ltf, чтобы вызовующая сторона знала, откуда искать следующую попытку (§14.5).
 */
function runAttempt(
	ltf: Candle[],
	endIndex: number,
	touch: number,
	long: boolean,
	attemptIndex: number,
): { attempt: ConfirmationAttempt; nextCursor: number } {
	const attempt: ConfirmationAttempt = {
		attemptIndex,
		status: 'rejected',
		rejectionReason: null,
		touchAt: ltf[touch]!.timestamp,
		stopLevel: null,
		entryAt: null,
		entry: null,
		stop: null,
		tp2: null,
		outcome: null,
		grossR: null,
		trace: [{ state: 'POI_TOUCH', at: ltf[touch]!.timestamp }],
	}
	// §14.2 шаги 1-5, §14.3: экстремум остаётся динамическим (углубляется) до первой close по стороне сделки.
	let stopping = -1
	let dynamicExtreme = long ? ltf[touch]!.low : ltf[touch]!.high
	for (let j = touch; j < Math.min(endIndex, touch + 30); j++) {
		const c = ltf[j]!
		dynamicExtreme = long ? Math.min(dynamicExtreme, c.low) : Math.max(dynamicExtreme, c.high)
		if (dirBar(c, long)) { stopping = j; break }
	}
	if (stopping < 0) {
		attempt.rejectionReason = 'no-stopping'
		return { attempt, nextCursor: touch + 1 }
	}
	const stopLevel = dynamicExtreme
	attempt.stopLevel = stopLevel
	attempt.trace.push({ state: 'STOP_CONFIRMED', at: ltf[stopping]!.timestamp, price: stopLevel })

	// §14.2 шаг 6: отскок, входа на первом отскоке нет.
	const a = atr(ltf, stopping)
	let rebound = -1
	for (let j = stopping + 1; j < Math.min(endIndex, stopping + 20); j++) {
		const span = ltf.slice(stopping + 1, j + 1)
		const broken = span.some(c => (long ? c.low < stopLevel : c.high > stopLevel))
		const move = long
			? Math.max(...span.map(c => c.high)) - stopLevel
			: stopLevel - Math.min(...span.map(c => c.low))
		if (!broken && j - stopping >= 2 && move >= 0.5 * a) {
			rebound = j
			attempt.trace.push({ state: 'REBOUND', at: ltf[j]!.timestamp, price: stopLevel })
			break
		}
	}
	if (rebound < 0) {
		attempt.rejectionReason = 'no-rebound'
		return { attempt, nextCursor: stopping + 1 }
	}

	// §14.2 шаг 7: вторичный sweep stopLow/stopHigh.
	let sweep = -1
	for (let j = rebound + 1; j < Math.min(endIndex, rebound + 60); j++) {
		const c = ltf[j]!
		if (long ? c.low < stopLevel : c.high > stopLevel) {
			sweep = j
			attempt.trace.push({ state: 'SECOND_SWEEP', at: c.timestamp, price: long ? c.low : c.high })
			break
		}
	}
	if (sweep < 0) {
		attempt.rejectionReason = 'no-second-sweep'
		return { attempt, nextCursor: rebound + 1 }
	}

	// §14.2 шаги 8-9: защита на свип-свече или следующей.
	let protect = -1
	for (let j = sweep; j <= Math.min(sweep + 1, endIndex - 1); j++) {
		if (long ? ltf[j]!.close > stopLevel : ltf[j]!.close < stopLevel) { protect = j; break }
	}
	if (protect < 0) {
		attempt.rejectionReason = 'failed-protection'
		return { attempt, nextCursor: sweep + 1 }
	}
	attempt.trace.push({ state: 'PROTECTED', at: ltf[protect]!.timestamp, price: stopLevel })

	// §14.2 шаги 10-11, §14.4: импульс и low-volume test.
	let impulse = -1, testEnd = -1
	let secondExtremeBreak = false, highVolTest = false
	for (let j = protect + 1; j < Math.min(endIndex, protect + 30); j++) {
		const c = ltf[j]!
		if (long ? c.low < ltf[sweep]!.low : c.high > ltf[sweep]!.high) { secondExtremeBreak = true; break }
		if (dirBar(c, long)) { impulse = j; continue }
		if (impulse >= 0 && c.volume < ltf[impulse]!.volume) {
			testEnd = j
			if (j + 1 < endIndex && !dirBar(ltf[j + 1]!, long) && ltf[j + 1]!.volume < ltf[impulse]!.volume) testEnd = j + 1
			break
		}
		if (impulse >= 0) { highVolTest = true; break }
	}
	if (secondExtremeBreak) {
		attempt.rejectionReason = 'second-extreme-break'
		return { attempt, nextCursor: sweep + 1 }
	}
	if (highVolTest) {
		attempt.rejectionReason = 'high-volume-test'
		return { attempt, nextCursor: protect + 1 }
	}
	if (testEnd < 0) {
		attempt.rejectionReason = 'no-low-volume-test'
		return { attempt, nextCursor: protect + 1 }
	}
	attempt.trace.push({
		state: 'LOW_VOLUME_TEST',
		at: ltf[testEnd]!.timestamp,
		volume: ltf[testEnd]!.volume,
		volumeRatio: impulse >= 0 ? ltf[testEnd]!.volume / ltf[impulse]!.volume : undefined,
	})

	// §14.2 шаг 12: entry на первой закрытой свече по направлению сделки после успешного test.
	let en = -1
	for (let j = testEnd + 1; j < Math.min(endIndex, testEnd + 20); j++) {
		if (long ? ltf[j]!.low < ltf[sweep]!.low : ltf[j]!.high > ltf[sweep]!.high) break
		if (dirBar(ltf[j]!, long)) { en = j; break }
	}
	if (en < 0) {
		attempt.rejectionReason = 'no-resumption'
		return { attempt, nextCursor: testEnd + 1 }
	}

	// §14.2 шаги 13-14: stop за sweep-extreme с буфером, полный TP 2R (первый тест — без частичных выходов).
	attempt.status = 'entered'
	attempt.entryAt = ltf[en]!.timestamp
	attempt.entry = ltf[en]!.close
	attempt.stop = long ? ltf[sweep]!.low - 0.05 * a : ltf[sweep]!.high + 0.05 * a
	const risk = Math.abs(attempt.entry - attempt.stop)
	attempt.tp2 = long ? attempt.entry + 2 * risk : attempt.entry - 2 * risk
	attempt.trace.push({ state: 'ENTRY', at: attempt.entryAt, price: attempt.entry })

	let exitIndex = endIndex - 1
	for (let j = en + 1; j < endIndex; j++) {
		const c = ltf[j]!
		const sl = long ? c.low <= attempt.stop! : c.high >= attempt.stop!
		const tp = long ? c.high >= attempt.tp2! : c.low <= attempt.tp2!
		if (sl) {
			attempt.outcome = 'stop'; attempt.grossR = -1
			attempt.trace.push({ state: 'STOP', at: c.timestamp, price: attempt.stop! })
			exitIndex = j; break
		}
		if (tp) {
			attempt.outcome = 'tp'; attempt.grossR = 2
			attempt.trace.push({ state: 'TP2', at: c.timestamp, price: attempt.tp2! })
			exitIndex = j; break
		}
		exitIndex = j
	}
	if (!attempt.outcome) attempt.outcome = 'open'
	return { attempt, nextCursor: exitIndex + 1 }
}

const MAX_ATTEMPTS_PER_POI = 6

/**
 * SPEC §14: уточнённое подтверждение на confirmation TF (15m для 4h POI, §14.1) ведомое от уже откалиброванных v1.0
 * POI-зон (near/far). Несколько попыток внутри одной POI — §14.5. Окно активности — [poi.knownAt, poi.endAt),
 * т.е. far-close invalidation (§14.6) уже учтена движком POI и повторно здесь не проверяется.
 */
export function detectPoiConfirmation(pois: LiquidityPoiCandidate[], ltf: Candle[]): PoiConfirmationResult[] {
	const out: PoiConfirmationResult[] = []
	for (const poi of pois) {
		const long = poi.direction === 'long'
		const lo = Math.min(poi.near, poi.far), hi = Math.max(poi.near, poi.far)
		const result: PoiConfirmationResult = {
			poiId: poi.id, direction: poi.direction, zoneClass: poi.zoneClass,
			near: poi.near, far: poi.far, knownAt: poi.knownAt, endAt: poi.endAt, attempts: [],
		}
		if (!ltf.length || ltf[0]!.timestamp > poi.knownAt) { out.push(result); continue }
		let cursor = ltf.findIndex(c => c.timestamp >= poi.knownAt)
		if (cursor < 0) { out.push(result); continue }
		const endIdxRaw = ltf.findIndex(c => c.timestamp >= poi.endAt)
		const endIndex = endIdxRaw < 0 ? ltf.length : endIdxRaw
		let attemptCount = 0
		while (cursor < endIndex && attemptCount < MAX_ATTEMPTS_PER_POI) {
			let touch = -1
			for (let j = cursor; j < endIndex; j++) {
				const c = ltf[j]!
				if (c.low <= hi && c.high >= lo) { touch = j; break }
			}
			if (touch < 0) break
			attemptCount++
			const { attempt, nextCursor } = runAttempt(ltf, endIndex, touch, long, attemptCount)
			result.attempts.push(attempt)
			cursor = Math.max(nextCursor, touch + 1)
		}
		out.push(result)
	}
	return out
}
