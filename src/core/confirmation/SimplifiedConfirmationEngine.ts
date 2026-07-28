import type { Candle } from '../../models/price/Candle.js'
import type { LiquidityPoiCandidate } from './LiquidityPoiCalibration.js'
import type { StructureEvent } from '../../models/events/StructureEvent.js'
import { detectGgiSignals, type GgiZoneParams } from '../signals/GgiZoneEngine.js'

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
// v0.3 (28.07.2026, §16.26): цели можно задавать В ДОЛЯХ НАЧАЛЬНОГО РИСКА (R), а не только в
// % цены. Причина структурная, не подгоночная: в v0.1 частичка 7.5% ЦЕНЫ при медианном стопе
// 2.15% цены стоит на 3.5R — до неё доходит четверть сделок, отсюда вин рейт 26%. Цели в R
// подстраиваются под фактический риск каждой сделки, поэтому ОДНА настройка работает на всех
// монетах и всех ступенях лестницы. Плюс два фильтра входа флагами (по умолчанию ВЫКЛ):
// «без погони» (вход не дальше maxChaseAtr от края зоны) и тренд-фильтр (bos-bos-choch).
// Дефолты = поведение v0.1 бит-в-бит; новое включается конфигом или пресетом.
export const SIMPLIFIED_CONFIRMATION_VERSION = 'simplified-confirmation-0.5-zone-visit-veto'

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
	/** v0.3: единица целей. 'pct' — доля цены (v0.1); 'r' — доля НАЧАЛЬНОГО РИСКА (вход→стоп). */
	targetMode: 'pct' | 'r'
	/** v0.3: частичка в R (используется при targetMode='r'). */
	partialAtR: number
	/** v0.3: полный тейк в R (используется при targetMode='r'). */
	fullAtR: number
	/**
	 * v0.3: фильтр «без погони» — максимальное расстояние входа от БЛИЖНЕЙ границы зоны,
	 * в ATR зоны. 0 = выключен. Смысл структурный: вход далеко от зоны при стопе за её
	 * дальним краем раздувает риск, не улучшая сигнал.
	 */
	maxChaseAtr: number
	/**
	 * v0.3: тренд-фильтр по правилу пользователя «bos-bos-choch» (§16.25). Требует событий
	 * структуры ТФ зоны в context.events. 'off' — выключен; 'notAgainst' — не входить против
	 * тренда; 'onlyWith' — входить только по тренду (боковик пропускается).
	 */
	trendFilter: 'off' | 'notAgainst' | 'onlyWith'
	/** v0.3: сколько BOS одного направления после последнего CHoCH считается трендом. */
	trendMinBos: number
	/**
	 * v0.5 (§16.29–16.30): ИНВЕРТИРОВАННОЕ ВЕТО по зонам перекупленности/перепроданности.
	 * Вход отбрасывается, если цена того же направления касалась зоны экстремума не старше
	 * N баров ТФ подтверждения. Смысл: заход в зону означает «цена растянута», а полка
	 * ликвидности в свежем сильном движении — топливо продолжения, а не разворот
	 * (группа C разбора стопов §16.18). 0 = вето выключено.
	 *
	 * ВАЖНО про край (ggiParams.signalMode), 8 монет, связка 1h→15m, окно выбрано по train:
	 *  • 'inner' (ЗАХОД в зону, окно 200) — сильнее: train +0.073 → +0.137R,
	 *    test +0.090 → +0.177R, 11/12 полугодий в плюсе. Это СОСТОЯНИЕ «цена в экстремуме»,
	 *    а НЕ сигнал вендора;
	 *  • 'outer' (настоящий сигнал вендора, окно 50) — слабее: train +0.097R,
	 *    test +0.115R, 9/12 полугодий. Полезен, но меньше.
	 * Пресет v4 закрепляет 'inner' — проверенный вариант; дефолт самого движка полос
	 * остаётся 'outer', потому что это канон вендора для ОТРИСОВКИ метки BUY/SELL.
	 */
	ggiExcludeBars: number
	/** v0.4: параметры полос (по умолчанию — фактические параметры вендора). */
	ggiParams?: Partial<GgiZoneParams>
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
	// v0.3: дефолты сохраняют поведение v0.1 бит-в-бит — новое включается явно.
	targetMode: 'pct',
	partialAtR: 0.40,
	fullAtR: 12,
	maxChaseAtr: 0,
	trendFilter: 'off',
	trendMinBos: 2,
	ggiExcludeBars: 0,
}

/**
 * §16.26: пресет «высокий вин рейт», найденный train/test-поиском на 8 монетах и связке
 * 1h→15m (train 2021-01→2024-12: 8965 сделок, WR 74.8%, экспектация +0.094R;
 * test 2025-01→2026-07, в отборе НЕ участвовал: 3064 сделки, WR 73.4%, +0.124R, PF 1.46).
 * Это ПРЕСЕТ, а не новые дефолты: канон v0.1 остаётся точкой отсчёта для истории SPEC.
 */
export const SIMPLIFIED_HIGH_WR_PRESET: Partial<SimplifiedConfirmationConfig> = {
	targetMode: 'r',
	partialAtR: 0.40,
	partialFraction: 0.25,
	fullAtR: 12,
	maxChaseAtr: 1.0,
	stopMode: 'far',
	reentry: 'rearm',
}

/**
 * §16.29: пресет v0.4 — тот же профиль выхода плюс ИНВЕРТИРОВАННЫЙ GGI-фильтр.
 * Окно 200 баров ТФ подтверждения выбрано ТОЛЬКО по train (train E: +0.137R — максимум
 * при выборке ≥3000 сделок), затем один взгляд на test: WR 75.5%, экспектация +0.177R,
 * Σ +278R на 1575 сделках; вин рейт вырос на всех 8 монетах, полугодия 11/12 в плюсе
 * с вин рейтом 70.2–78.4% (весь коридор пользователя целиком).
 */
export const SIMPLIFIED_HIGH_WR_PRESET_V4: Partial<SimplifiedConfirmationConfig> = {
	...SIMPLIFIED_HIGH_WR_PRESET,
	ggiExcludeBars: 200,
	// 'inner' закреплён явно: дефолт движка полос — 'outer' (канон вендора для метки BUY/SELL),
	// а проверенное вето работает по ЗАХОДУ в зону, то есть по внутреннему краю.
	ggiParams: { signalMode: 'inner' },
}

/**
 * §16.30: вариант вето по НАСТОЯЩЕМУ сигналу вендора (внешний край, окно 50 баров).
 * Слабее пресета v4 (test +0.115R против +0.177R), но точнее воспроизводит индикатор —
 * оставлен для сравнения и для случая, когда важна верность оригиналу, а не максимум.
 */
export const SIMPLIFIED_VENDOR_SIGNAL_PRESET: Partial<SimplifiedConfirmationConfig> = {
	...SIMPLIFIED_HIGH_WR_PRESET,
	ggiExcludeBars: 50,
	ggiParams: { signalMode: 'outer' },
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

/** Контекст движка: структурные события ТФ ЗОНЫ — нужны только тренд-фильтру. */
export interface SimplifiedContext {
	events?: StructureEvent[]
}

export type SimplifiedRegime = 'up' | 'down' | 'range'

/**
 * Режим рынка по правилу пользователя «bos-bos-choch» (§16.25): ≥ minBos подряд идущих BOS
 * одного направления после последнего CHoCH = тренд этого направления, иначе боковик.
 * Регион меняется на баре ПОДТВЕРЖДЕНИЯ события — каузально, без заглядывания вперёд.
 */
export function buildRegimeTimeline(events: StructureEvent[], minBos = 2): Array<{ at: number; regime: SimplifiedRegime }> {
	const sorted = [...events].sort((a, b) => a.confirmTimestamp - b.confirmTimestamp)
	const out: Array<{ at: number; regime: SimplifiedRegime }> = []
	let up = 0, down = 0
	for (const e of sorted) {
		if (e.type === 'choch') { up = 0; down = 0 }
		else if (e.type === 'bos') { if (e.direction === 'up') up++; else down++ }
		const regime: SimplifiedRegime = up >= minBos && up >= down ? 'up' : down >= minBos ? 'down' : 'range'
		const last = out[out.length - 1]
		if (last && last.at === e.confirmTimestamp) last.regime = regime
		else out.push({ at: e.confirmTimestamp, regime })
	}
	return out
}

/** Режим на момент ts: последнее подтверждённое событие не позже ts. */
export function regimeAt(timeline: Array<{ at: number; regime: SimplifiedRegime }>, ts: number): SimplifiedRegime {
	let lo = 0, hi = timeline.length - 1
	let res: SimplifiedRegime = 'range'
	while (lo <= hi) {
		const mid = (lo + hi) >> 1
		if (timeline[mid]!.at <= ts) { res = timeline[mid]!.regime; lo = mid + 1 } else hi = mid - 1
	}
	return res
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
	out: SimplifiedEntry, partialMovePct: number, fullMovePct: number,
): number {
	let stop = stop0
	let partialTaken = false
	const risk = Math.abs(entry - stop0)
	const done = (outcome: SimplifiedEntry['outcome'], k: number): number => {
		out.outcome = outcome
		const partMove = partialMovePct * cfg.partialFraction
		const restShare = 1 - cfg.partialFraction
		out.grossMovePct = outcome === 'full' ? partMove + fullMovePct * restShare
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
	context: SimplifiedContext = {},
): SimplifiedConfirmationResult[] {
	const cfg: SimplifiedConfirmationConfig = { ...SIMPLIFIED_CONFIRMATION_CONFIG, ...config }
	const regimeTl = cfg.trendFilter === 'off' ? [] : buildRegimeTimeline(context.events ?? [], cfg.trendMinBos)
	// v0.4: моменты сигналов полос на ТФ подтверждения (для инвертированного фильтра)
	const ggiAt: { long: number[]; short: number[] } = { long: [], short: [] }
	let ltfStepMs = 0
	if (cfg.ggiExcludeBars > 0 && ltf.length > 1) {
		ltfStepMs = ltf[1]!.timestamp - ltf[0]!.timestamp
		for (const s of detectGgiSignals(ltf, cfg.ggiParams)) ggiAt[s.direction].push(s.at)
	}
	/** Был ли сигнал того же направления не старше ggiExcludeBars баров до ts. */
	const ggiRecent = (long: boolean, ts: number): boolean => {
		if (cfg.ggiExcludeBars <= 0 || ltfStepMs <= 0) return false
		const list = long ? ggiAt.long : ggiAt.short
		let lo = 0, hi = list.length - 1, best = -1
		while (lo <= hi) {
			const mid = (lo + hi) >> 1
			if (list[mid]! <= ts) { best = list[mid]!; lo = mid + 1 } else hi = mid - 1
		}
		return best >= 0 && (ts - best) / ltfStepMs <= cfg.ggiExcludeBars
	}
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
			// v0.3 «без погони»: вход слишком далеко от ближней границы — сделка пропускается,
			// но цикл зоны продолжается (следующее взведение).
			if (cfg.maxChaseAtr > 0 && poi.atr > 0 && Math.abs(ec.close - poi.near) / poi.atr > cfg.maxChaseAtr) {
				cursor = entryIdx + 1
				armed = false
				continue
			}
			// v0.3 тренд-фильтр (правило пользователя bos-bos-choch, регион на баре подтверждения)
			if (cfg.trendFilter !== 'off') {
				const reg = regimeAt(regimeTl, ec.timestamp)
				const against = long ? reg === 'down' : reg === 'up'
				const withTrend = long ? reg === 'up' : reg === 'down'
				if (cfg.trendFilter === 'notAgainst' ? against : !withTrend) {
					cursor = entryIdx + 1
					armed = false
					continue
				}
			}
			// v0.4: инвертированный GGI-фильтр — вход у растянутой цены пропускается
			if (ggiRecent(long, ec.timestamp)) {
				cursor = entryIdx + 1
				armed = false
				continue
			}
			const stop = cfg.stopMode === 'far'
				? (long ? lo - cfg.stopFarBufferAtr * poi.atr : hi + cfg.stopFarBufferAtr * poi.atr)
				: (long ? ec.close * (1 - cfg.stopPct) : ec.close * (1 + cfg.stopPct))
			// v0.3: цели в долях риска приводятся к долям хода по фактическому риску сделки
			const riskPct = Math.abs(ec.close - stop) / ec.close
			const partialMovePct = cfg.targetMode === 'r' ? cfg.partialAtR * riskPct : cfg.partialAtMovePct
			const fullMovePct = cfg.targetMode === 'r' ? cfg.fullAtR * riskPct : cfg.fullAtMovePct
			const entry: SimplifiedEntry = {
				entryAt: ec.timestamp, entry: ec.close, stop, stopMode: cfg.stopMode,
				partialPrice: long ? ec.close * (1 + partialMovePct) : ec.close * (1 - partialMovePct),
				fullPrice: long ? ec.close * (1 + fullMovePct) : ec.close * (1 - fullMovePct),
				events: [], outcome: 'open', grossMovePct: null, grossR: null,
			}
			// риск-санити: вход ниже стопа (лонг) невозможен по построению обоих режимов
			const exitIdx = playPosition(ltf, entryIdx + 1, long, entry.entry, stop, entry.partialPrice, entry.fullPrice, cfg, entry, partialMovePct, fullMovePct)
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
