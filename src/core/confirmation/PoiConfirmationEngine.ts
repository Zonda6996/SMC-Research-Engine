import type { Candle } from '../../models/price/Candle.js'
import type { LiquidityPoiCandidate } from './LiquidityPoiCalibration.js'

// SPEC §16.8/§16.9: ЕДИНАЯ последовательность подтверждения для всех зон, ведомая от POI-зон v1.2.
// Окно торговли зоны = [max(knownAt, geometryKnownAt), endAt) из POI-движка (провал/отставка/отработка).
// v1.4 (§16.9, по визуальному QA):
//  - якорь пересвипа = самый глубокий НЕВЫМЕТЕННЫЙ экстремум зоны (стопы ритейла всё ещё за ним);
//    после свипа он «потрачен», новый копится с этого момента;
//  - проторговка против спама: остановка и отскок требуют ВРЕМЕНИ без обновления экстремума
//    (раньше медиана обоих была 1 бар — машина работала на скорости свечного шума);
//  - таймаут по бездействию: попытка умирает после N баров БЕЗ событий, а не по будильнику от касания
//    (реальный пересвип приходил через 1 бар после смерти по старому таймауту).
// Fallback-зоны (far не от реальной ликвидности) и near-дубли (duplicateOf) не торгуются.
export const POI_CONFIRMATION_VERSION = 'poi-confirmation-1.4-unswept-anchor'

/**
 * Все константы движка подтверждения (§16.8/§16.9). Значения согласованы 23.07.2026;
 * менять только по итогам визуального QA с явного согласия пользователя.
 */
export const POI_CONFIRMATION_CONFIG = {
	/** Полный отход от зоны для (пере)взведения касания, в ATR confirmation TF (v1.6 armed touch, §16.7). */
	rearmAtr: 0.25,
	/** Остановка: направленное закрытие, при котором экстремум не обновлялся столько баров (проторговка у лоя). */
	stopQuietBars: 4,
	/** Отскок: ещё столько баров от остановки без нового экстремума (время важнее расстояния). */
	reboundMinBars: 6,
	/** Минимальный отход отскока от экстремума попытки, в ATR (нижний порог, не главный критерий). */
	reboundAtr: 0.5,
	/** Запас стопа за экстремумом пересвип-последовательности («с небольшим запасом», §14.2 шаг 13). */
	stopBufferAtr: 0.05,
	/** Диагностический полный тейк, в R (§14.2 шаг 14; частичные выходы — вне первого теста). */
	tpR: 2,
	/** Смерть попытки по БЕЗДЕЙСТВИЮ: столько баров подряд без единого события трейса (~сутки на 15m). */
	attemptIdleBars: 96,
	/** Отмена входа: риск (вход→стоп) больше этого числа ATR — вход пропускается, попытка продолжается. */
	entryMaxRiskAtr: 1.5,
	/** Столько подряд close за лоем попытки: внутри зоны → перезапуск от нового экстремума, за far → отбраковка. */
	failedProtectionCloses: 2,
	/** SMA объёма за N баров ТФ зоны для пометки «пришли на объёме» (диагностика, НЕ фильтр). */
	arrivalVolumeSma: 20,
} as const

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
	/** timeout@<этап> | broke-below-zone | zone-ended | null для входа. */
	rejectionReason: string | null
	touchAt: number
	/** Якорь попытки на момент последнего пересвипа (невыметенный экстремум, который снимали). */
	stopLevel: number | null
	entryAt: number | null
	entry: number | null
	stop: number | null
	tp2: number | null
	outcome: 'tp' | 'stop' | 'open' | null
	grossR: number | null
	/** Диагностика «пришли на объёме»: объём HTF-бара захода / SMA20 предыдущих; null без HTF-данных. */
	arrivalVolumeRatio: number | null
	/** Снял ли пересвип абсолютный экстремум зоны за всё окно (включая уже выметенные) — QA-пометка. */
	sweptZoneExtreme: boolean | null
	trace: ConfirmationTrace[]
}

export interface PoiConfirmationResult {
	poiId: string
	direction: 'long' | 'short'
	zoneClass: string
	near: number
	far: number
	knownAt: number
	/** Эффективный конец окна торговли: конец зоны либо отработка по tp-hit. */
	endAt: number
	/** Зона отработала внутри окна подтверждения: попытка дошла до тейка. */
	spentReason: 'tp-hit' | null
	/** Покрытие 15m-историей: none → попыток нет из-за ДАННЫХ, не из-за логики. */
	ltfCoverage: 'full' | 'partial' | 'none'
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
/** Откатная свеча: закрытие ПРОТИВ направления сделки (доджи не считается). */
function counterBar(c: Candle, long: boolean): boolean {
	return long ? c.close < c.open : c.close > c.open
}

type Stage = 'stopping' | 'rebound' | 'sweep' | 'protect' | 'entry'

/**
 * Одна попытка = одно взведённое касание со всей цепочкой §16.8/§16.9:
 * заход → остановка (проторговка: экстремум тих stopQuietBars) → отскок (ещё reboundMinBars) →
 * пересвип НЕВЫМЕТЕННОГО экстремума зоны → защита → тест слабости (объём возобновления выше
 * объёма последней откатной) → вход. Перезапуски внутри попытки не сжигают её; смерть — только
 * по бездействию (attemptIdleBars без событий), пробою зоны вниз или концу окна зоны.
 */
function runAttempt(
	ltf: Candle[],
	endIndex: number,
	touch: number,
	long: boolean,
	attemptIndex: number,
	zoneLo: number,
	zoneHi: number,
	pending: { value: number },
	windowExtreme: { value: number },
	arrivalVolumeRatio: number | null,
): { attempt: ConfirmationAttempt; nextCursor: number } {
	const cfg = POI_CONFIRMATION_CONFIG
	const attempt: ConfirmationAttempt = {
		attemptIndex, status: 'rejected', rejectionReason: null,
		touchAt: ltf[touch]!.timestamp, stopLevel: null,
		entryAt: null, entry: null, stop: null, tp2: null, outcome: null, grossR: null,
		arrivalVolumeRatio, sweptZoneExtreme: null,
		trace: [{ state: 'POI_TOUCH', at: ltf[touch]!.timestamp }],
	}
	let stage: Stage = 'stopping'
	// Якорь попытки: невыметенный экстремум зоны (§16.9). Если он старше касания — проторговка у него
	// уже состоялась в прошлом, счётчик тишины считаем выполненным.
	const touchExtreme = long ? ltf[touch]!.low : ltf[touch]!.high
	let low = Number.isFinite(pending.value) ? (long ? Math.min(pending.value, touchExtreme) : Math.max(pending.value, touchExtreme)) : touchExtreme
	let lastExtremeBar = (long ? touchExtreme <= low : touchExtreme >= low) ? touch : Number.NEGATIVE_INFINITY
	let lastEventBar = touch
	let stoppingBar = -1
	let reboundExtreme = Number.NaN
	let sweepExtreme = Number.NaN
	let belowCloses = 0
	let impulseSeen = false
	const beyondLow = (v: number) => (long ? v < low : v > low)
	const closeBeyondFar = (c: Candle) => (long ? c.close < zoneLo : c.close > zoneHi)
	const mark = (j: number, state: string, extra: Omit<ConfirmationTrace, 'state' | 'at'> = {}) => {
		lastEventBar = j
		attempt.trace.push({ state, at: ltf[j]!.timestamp, ...extra })
	}
	const reject = (reason: string, nextCursor: number) => {
		attempt.rejectionReason = reason
		return { attempt, nextCursor }
	}
	const restart = (j: number, newLow: number) => {
		low = newLow
		stage = 'stopping'
		lastExtremeBar = j
		stoppingBar = -1
		reboundExtreme = Number.NaN
		belowCloses = 0
		impulseSeen = false
		mark(j, 'RESTART', { price: low })
	}
	// Защита проверяется на самом свип-баре или следующих закрытиях (§14.2 шаги 8-9 + решение №12).
	const protectOn = (j: number, c: Candle): boolean => {
		if (long ? c.close > low : c.close < low) {
			stage = 'entry'
			belowCloses = 0
			impulseSeen = dirBar(c, long)
			mark(j, 'PROTECTED', { price: low })
			return true
		}
		belowCloses++
		return false
	}

	for (let j = touch; j < endIndex; j++) {
		// §16.9: смерть по бездействию — столько баров подряд без единого события трейса.
		if (j - lastEventBar >= cfg.attemptIdleBars) return reject(`timeout@${stage}`, j)
		const c = ltf[j]!
		const windowExtremeBefore = windowExtreme.value
		const insideZone = c.low <= zoneHi && c.high >= zoneLo
		if (insideZone) windowExtreme.value = long ? Math.min(windowExtreme.value, c.low) : Math.max(windowExtreme.value, c.high)

		if (stage === 'stopping' || stage === 'rebound') {
			// Снятие якоря до отскока = более глубокий заход, а не отбраковка (попытка не сгорает).
			if (stage === 'rebound' && beyondLow(long ? c.low : c.high)) restart(j, long ? c.low : c.high)
			if (stage === 'stopping') {
				if (beyondLow(long ? c.low : c.high)) {
					low = long ? c.low : c.high
					lastExtremeBar = j
				}
				// §16.9: остановка = направленное закрытие ПОСЛЕ проторговки у экстремума
				// (экстремум не обновлялся stopQuietBars), а не первая же свеча по направлению.
				if (dirBar(c, long) && j - lastExtremeBar >= cfg.stopQuietBars) {
					stage = 'rebound'
					stoppingBar = j
					reboundExtreme = long ? c.high : c.low
					mark(j, 'STOP_CONFIRMED', { price: low })
				}
			} else {
				reboundExtreme = long ? Math.max(reboundExtreme, c.high) : Math.min(reboundExtreme, c.low)
				const a = atr(ltf, j)
				// §16.9: отскок = время без нового экстремума (reboundMinBars) + минимальный отход.
				if (j - stoppingBar >= cfg.reboundMinBars
					&& a && (long ? reboundExtreme - low : low - reboundExtreme) >= cfg.reboundAtr * a) {
					stage = 'sweep'
					mark(j, 'REBOUND', { price: reboundExtreme })
				}
			}
			continue
		}

		if (stage === 'sweep') {
			if (beyondLow(long ? c.low : c.high)) {
				sweepExtreme = long ? c.low : c.high
				attempt.stopLevel = low
				attempt.sweptZoneExtreme = long ? sweepExtreme <= windowExtremeBefore : sweepExtreme >= windowExtremeBefore
				mark(j, 'SECOND_SWEEP', { price: sweepExtreme })
				stage = 'protect'
				belowCloses = 0
				protectOn(j, c)
			}
			continue
		}

		if (stage === 'protect') {
			sweepExtreme = long ? Math.min(sweepExtreme, c.low) : Math.max(sweepExtreme, c.high)
			if (!protectOn(j, c) && belowCloses >= cfg.failedProtectionCloses) {
				// Решение №12: две close за лоем, но внутри зоны → строим дальше от нового экстремума;
				// close за дальней границей → пробой организован, попытка отбраковывается.
				if (closeBeyondFar(c)) return reject('broke-below-zone', j + 1)
				restart(j, sweepExtreme)
			}
			continue
		}

		// stage === 'entry': импульс → откат → возобновление (тест слабости, решение №13).
		if (beyondLow(long ? c.low : c.high) && (long ? c.low < sweepExtreme : c.high > sweepExtreme)) {
			// Более глубокий пересвип до входа — не смерть: защита проверяется заново (§16.8).
			sweepExtreme = long ? c.low : c.high
			attempt.sweptZoneExtreme = long ? sweepExtreme <= windowExtremeBefore : sweepExtreme >= windowExtremeBefore
			mark(j, 'SECOND_SWEEP', { price: sweepExtreme })
			stage = 'protect'
			belowCloses = 0
			protectOn(j, c)
			continue
		}
		if (long ? c.close < low : c.close > low) {
			// Закрытие обратно за лоем — защита расстроилась, проверяем её заново.
			stage = 'protect'
			belowCloses = 1
			continue
		}
		if (dirBar(c, long)) {
			const prev = ltf[j - 1]
			if (impulseSeen && prev && counterBar(prev, long) && c.volume > prev.volume) {
				// Тест слабости пройден: объём свечи возобновления ВЫШЕ объёма последней откатной (50 > 40).
				mark(j, 'WEAKNESS_TEST', { volume: prev.volume, volumeRatio: prev.volume > 0 ? c.volume / prev.volume : 0 })
				attempt.trace.at(-1)!.at = prev.timestamp
				const a = atr(ltf, j)
				const stop = long ? sweepExtreme - cfg.stopBufferAtr * a : sweepExtreme + cfg.stopBufferAtr * a
				const risk = Math.abs(c.close - stop)
				if (a && risk > cfg.entryMaxRiskAtr * a) {
					// Решение №3: цена уже убежала — вход отменяется, попытка ждёт следующий тест ближе.
					mark(j, 'ENTRY_CANCELLED', { price: c.close })
					continue
				}
				attempt.status = 'entered'
				attempt.rejectionReason = null
				attempt.entryAt = c.timestamp
				attempt.entry = c.close
				attempt.stop = stop
				attempt.tp2 = long ? c.close + cfg.tpR * risk : c.close - cfg.tpR * risk
				mark(j, 'ENTRY', { price: c.close })
				// Позиция доигрывается до stop/TP по всей истории (v1.6) — окно зоны её не закрывает.
				let exitIndex = j
				for (let k = j + 1; k < ltf.length; k++) {
					const x = ltf[k]!
					const sl = long ? x.low <= attempt.stop! : x.high >= attempt.stop!
					const tp = long ? x.high >= attempt.tp2! : x.low <= attempt.tp2!
					if (sl) {
						attempt.outcome = 'stop'; attempt.grossR = -1
						attempt.trace.push({ state: 'STOP', at: x.timestamp, price: attempt.stop! })
						exitIndex = k; break
					}
					if (tp) {
						attempt.outcome = 'tp'; attempt.grossR = cfg.tpR
						attempt.trace.push({ state: 'TP2', at: x.timestamp, price: attempt.tp2! })
						exitIndex = k; break
					}
					exitIndex = k
				}
				if (!attempt.outcome) attempt.outcome = 'open'
				return { attempt, nextCursor: exitIndex + 1 }
			}
			// Направленная свеча без валидного теста — часть импульса (или слабое возобновление): ждём.
			impulseSeen = true
		}
	}
	return reject('zone-ended', endIndex)
}

/**
 * SPEC §16.8/§16.9: подтверждение на confirmation TF (15m для 4h POI, §14.1) для каждой торгуемой зоны.
 * Лимита попыток нет — окно ограничено жизнью зоны, отработкой (tp-hit) и бездействием попыток.
 * htf — свечи ТФ зоны (4h) для диагностики «пришли на объёме»; без них пометка null.
 */
export function detectPoiConfirmation(pois: LiquidityPoiCandidate[], ltf: Candle[], htf?: Candle[]): PoiConfirmationResult[] {
	const cfg = POI_CONFIRMATION_CONFIG
	const out: PoiConfirmationResult[] = []
	const htfMs = htf && htf.length > 1 ? htf[1]!.timestamp - htf[0]!.timestamp : 0
	const arrivalRatio = (touchAt: number): number | null => {
		if (!htf?.length || !htfMs) return null
		const i = htf.findIndex(x => touchAt >= x.timestamp && touchAt < x.timestamp + htfMs)
		if (i < 0) return null
		const prev = htf.slice(Math.max(0, i - cfg.arrivalVolumeSma), i)
		const sma = avg(prev.map(x => x.volume))
		return sma > 0 ? htf[i]!.volume / sma : null
	}
	for (const poi of pois) {
		// Решение №6: ATR-fallback зоны не торгуются; §16.9: near-дубли (duplicateOf) не торгуются.
		if (poi.boundarySource !== 'liquidity-cluster' || poi.duplicateOf != null) continue
		const long = poi.direction === 'long'
		const lo = Math.min(poi.near, poi.far), hi = Math.max(poi.near, poi.far)
		const effectiveKnownAt = Math.max(poi.knownAt, poi.geometryKnownAt ?? poi.knownAt)
		const ltfStart = ltf[0]?.timestamp ?? Number.POSITIVE_INFINITY
		const ltfCoverage: PoiConfirmationResult['ltfCoverage'] =
			!ltf.length || poi.endAt <= ltfStart ? 'none' : ltfStart <= effectiveKnownAt ? 'full' : 'partial'
		const result: PoiConfirmationResult = {
			poiId: poi.id, direction: poi.direction, zoneClass: poi.zoneClass,
			near: poi.near, far: poi.far, knownAt: effectiveKnownAt, endAt: poi.endAt,
			spentReason: null, ltfCoverage, attempts: [],
		}
		if (ltfCoverage === 'none') { out.push(result); continue }
		let cursor = ltf.findIndex(c => c.timestamp >= effectiveKnownAt)
		if (cursor < 0) { out.push(result); continue }
		const endIdxRaw = ltf.findIndex(c => c.timestamp >= poi.endAt)
		const endIndex = endIdxRaw < 0 ? ltf.length : endIdxRaw
		// v1.6 armed touch: касание = вход в зону со стороны сделки после полного отхода; re-arm после каждой попытки.
		let armed = false
		// §16.9: pending = невыметенный экстремум зоны (якорь пересвипа); сбрасывается после свипа.
		// windowExtreme = абсолютный экстремум окна (не сбрасывается) — для QA-пометки sweptZoneExtreme.
		const pending = { value: long ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY }
		const windowExtreme = { value: long ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY }
		const feed = (c: Candle) => {
			if (c.low <= hi && c.high >= lo) {
				pending.value = long ? Math.min(pending.value, c.low) : Math.max(pending.value, c.high)
				windowExtreme.value = long ? Math.min(windowExtreme.value, c.low) : Math.max(windowExtreme.value, c.high)
			}
		}
		while (cursor < endIndex) {
			let touch = -1
			for (let j = cursor; j < endIndex; j++) {
				const c = ltf[j]!
				feed(c)
				if (c.low <= hi && c.high >= lo && armed) { touch = j; break }
				if (!(c.low <= hi && c.high >= lo) && (long ? c.low > hi + cfg.rearmAtr * atr(ltf, j) : c.high < lo - cfg.rearmAtr * atr(ltf, j))) armed = true
			}
			if (touch < 0) break
			const { attempt, nextCursor } = runAttempt(
				ltf, endIndex, touch, long, result.attempts.length + 1, lo, hi, pending, windowExtreme, arrivalRatio(ltf[touch]!.timestamp))
			result.attempts.push(attempt)
			cursor = Math.max(nextCursor, touch + 1)
			// §16.9: свип «тратит» невыметенный экстремум — новый копится с бара после последнего свипа.
			const lastSweepAt = [...attempt.trace].reverse().find(t => t.state === 'SECOND_SWEEP')?.at
			const resumeFrom = lastSweepAt != null
				? Math.max(touch, ltf.findIndex(c => c.timestamp === lastSweepAt) + 1)
				: touch
			if (lastSweepAt != null) pending.value = long ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
			// Пробегаем пропущенные попыткой бары, чтобы экстремумы остались полными.
			for (let j = lastSweepAt != null ? resumeFrom : touch; j < Math.min(cursor, endIndex); j++) feed(ltf[j]!)
			armed = false
			// Решение №10: tp-hit = зона отработала, дальше её не торгуем.
			if (attempt.status === 'entered' && attempt.outcome === 'tp') {
				result.spentReason = 'tp-hit'
				const exitAt = attempt.trace.find(t => t.state === 'TP2')?.at
				if (exitAt != null && exitAt < result.endAt) result.endAt = exitAt
				break
			}
		}
		out.push(result)
	}
	return out
}
