// entryModels.ts
//
// SPEC 7.24: модели входа + косты BingX + bigbar-фильтр — пул-оценка.
//
// Контекст (запрос пользователя, 15.07.2026):
//   1. Реальная торговля — BingX с реферальной ставкой: maker 0.02%
//      (лимитные ордера), taker 0.05% (рыночные). Прежняя модель костов
//      (fibCosts: 0.05% на всё) завышала издержки лимитных тейков.
//   2. Пользователь НЕ торгует лимитками на уровне: вход маркетом по
//      подтверждению. Каноническая touch-модель (лимитка на уровне) даёт
//      213 same-bar сделок с мгновенным −1R (−249.7R на пуле 6464) —
//      это реальность лимитного входа, но не реальность пользователя.
//   3. Bigbar-идея пользователя: если ОДНА свеча телом перекрыла всю
//      входную зону сетки (ote: 61.8–78.6, deep: 23.6–38.2) до решения о
//      входе — уровень «сожжён», сетап пропускается. Не look-ahead: тело
//      известно по закрытию свечи, решение принимается позже.
//
// Три модели входа (сравниваются на ОДНОМ пуле, без портфеля):
//   - touch:        канон — лимитка на уровне (maker), вход по касанию.
//                   Конфликт вход/стоп в одном баре = стоп (консервативно).
//   - closeConfirm: свеча коснулась зоны → вход МАРКЕТОМ по её закрытию
//                   (taker+slip). Если закрытие уже за стопом — сделки нет
//                   (то самое «убираем same-bar», честно, без look-ahead).
//   - candleConfirm: после касания ждём ПОДТВЕРЖДАЮЩУЮ свечу (закрытие в
//                   направлении сделки: лонг — бычья, шорт — медвежья;
//                   свеча касания может подтвердить сама себя) → вход
//                   маркетом по её закрытию. Ожидание ограничено
//                   CONFIRM_MAX_BARS; закрытие за стопом до подтверждения
//                   отменяет сетап.
//
// Выходы во всех моделях — t100-only (единственная лестница со стабильным
// плюсом по всем годам/ТФ/сценариям, SPEC 7.22): весь объём лимиткой на
// уровне 100 (maker), стоп — маркетом (taker+slip).
//
// Каждая упущенная сделка (missed*) получает counterfactual: netR touch-
// модели — «сколько стоило ожидание». Сводка отвечает на вопросы
// пользователя: сколько упустили, сколько спасли, что дал bigbar.

import type { Candle } from '@/models/price/Candle.js'
import type { FibSetupOutcome } from '@/models/fib/FibLifecycle.js'

/** Комиссия maker (лимитные ордера), BingX с реферальной ставкой. */
export const BINGX_MAKER_RATE = 0.0002
/** Комиссия taker (рыночные ордера), BingX с реферальной ставкой. */
export const BINGX_TAKER_RATE = 0.0005
/** Проскальзывание на рыночный филл (та же оценка, что в fibCosts). */
export const BINGX_SLIP_RATE = 0.0002

/**
 * Максимум баров ожидания подтверждающей свечи после касания зоны.
 * Выбор: сетап, не подтвердившийся за 12 баров (6ч на 30m, 12ч на 1h),
 * считается несостоявшимся — дальше вход был бы уже не «от уровня».
 * Значение видно в сводке (missed-expired), чувствительность проверяема.
 */
export const CONFIRM_MAX_BARS = 12

export type EntryModelId = 'touch' | 'closeConfirm' | 'candleConfirm'

export type EntryStatus =
	| 'entered'        // вход состоялся, сделка разрешилась
	| 'missed-stop'    // отменено: закрытие за стопом до входа (спасённый лосс)
	| 'missed-tp'      // упущено: цена дошла до тейка без нас (упущенный вин)
	| 'missed-expired' // упущено: подтверждение не пришло за CONFIRM_MAX_BARS
	| 'unresolved'     // данные кончились с открытой позицией/ожиданием

export interface EntryReplayResult {
	status: EntryStatus
	/** netR разрешившейся сделки; 0 для missed*, null для unresolved. */
	netR: number | null
	/** Фактическая цена входа (для entered). */
	entryPrice: number | null
	/** Индекс бара фактического входа (для entered) — для отрисовки. */
	entryIndex?: number | null
	/** Индекс и цена бара выхода (для entered) — для отрисовки. */
	exitIndex?: number | null
	exitPrice?: number | null
	/** Чем закрылась сделка: тейк или стоп (для entered). */
	exitReason?: 'tp' | 'stop' | null
}

/** Стоимость филла в R: цена × ставка × доля / риск. */
function fillCostR(price: number, rate: number, fraction: number, risk: number): number {
	return (price * rate * fraction) / risk
}

/**
 * Реплей выхода t100-only с бара startIndex (стоп и тейк проверяются
 * начиная с него). Конфликт стоп/тейк в одном баре — консервативно стоп.
 * Вход уже оплачен вызывающим кодом; здесь только выходные филлы.
 */
function replayT100Exit(
	candles: Candle[],
	startIndex: number,
	long: boolean,
	entry: number,
	stop: number,
	tp: number,
	risk: number,
): { netR: number; exitIndex: number; exitPrice: number; exitReason: 'tp' | 'stop' } | null {
	for (let i = startIndex; i < candles.length; i++) {
		const candle = candles[i]
		if (!candle) continue
		const hitStop = long ? candle.low <= stop : candle.high >= stop
		const hitTp = long ? candle.high >= tp : candle.low <= tp
		if (hitStop) {
			// Конфликт в одном баре = стоп: зеркало консервативной конвенции
			// FibLifecycleEngine/takeLadders.
			const gross = (long ? stop - entry : entry - stop) / risk
			return { netR: gross - fillCostR(stop, BINGX_TAKER_RATE + BINGX_SLIP_RATE, 1, risk), exitIndex: i, exitPrice: stop, exitReason: 'stop' }
		}
		if (hitTp) {
			const gross = (long ? tp - entry : entry - tp) / risk
			return { netR: gross - fillCostR(tp, BINGX_MAKER_RATE, 1, risk), exitIndex: i, exitPrice: tp, exitReason: 'tp' }
		}
	}
	return null
}

/**
 * Реплей одной модели входа на одной сделке пула. outcome — канонический
 * touch-исход движка (его entryIndex = бар касания уровня, entryPrice =
 * уровень, stopPrice/riskSize — плановые). Риск для маркет-входов
 * пересчитывается от фактической цены входа.
 */
export function replayEntryModel(
	candles: Candle[],
	outcome: FibSetupOutcome,
	tpPrice: number,
	model: EntryModelId,
): EntryReplayResult {
	if (!outcome.entered || outcome.entryIndex == null || outcome.entryPrice == null || outcome.riskSize == null || outcome.riskSize <= 0) {
		return { status: 'unresolved', netR: null, entryPrice: null }
	}
	const long = outcome.direction === 'long'
	const level = outcome.entryPrice
	const stop = outcome.stopPrice
	const touchIndex = outcome.entryIndex

	if (model === 'touch') {
		// Канон: лимитка на уровне. Вход maker без слиппеджа; стоп/тейк
		// проверяются с бара касания (same-bar конфликт = стоп).
		const risk = Math.abs(level - stop)
		if (risk <= 0) return { status: 'unresolved', netR: null, entryPrice: null }
		const exit = replayT100Exit(candles, touchIndex, long, level, stop, tpPrice, risk)
		if (exit == null) return { status: 'unresolved', netR: null, entryPrice: level }
		return {
			status: 'entered',
			netR: exit.netR - fillCostR(level, BINGX_MAKER_RATE, 1, risk),
			entryPrice: level,
		}
	}

	// Маркет-модели: решение по закрытиям свечей, начиная со свечи касания.
	const lastConfirmIndex = model === 'closeConfirm' ? touchIndex : Math.min(touchIndex + CONFIRM_MAX_BARS, candles.length - 1)
	for (let i = touchIndex; i <= lastConfirmIndex; i++) {
		const candle = candles[i]
		if (!candle) continue
		// Закрытие за стопом до входа: сетап отменён — спасённый лосс.
		const closedBeyondStop = long ? candle.close <= stop : candle.close >= stop
		if (closedBeyondStop) return { status: 'missed-stop', netR: 0, entryPrice: null }
		// Тейк достигнут до входа: движение ушло без нас — упущенный вин.
		const tpTouched = long ? candle.high >= tpPrice : candle.low <= tpPrice
		if (tpTouched) return { status: 'missed-tp', netR: 0, entryPrice: null }

		const confirms = model === 'closeConfirm'
			? true // вариант 1: вход по закрытию свечи касания, без условий
			: (long ? candle.close > candle.open : candle.close < candle.open)
		if (!confirms) continue

		const entry = candle.close
		const risk = Math.abs(entry - stop)
		if (risk <= 0) return { status: 'missed-stop', netR: 0, entryPrice: null }
		// Вход маркетом по закрытию — стоп/тейк со СЛЕДУЮЩЕГО бара:
		// same-bar конфликт исчезает по построению.
		const exit = replayT100Exit(candles, i + 1, long, entry, stop, tpPrice, risk)
		if (exit == null) return { status: 'unresolved', netR: null, entryPrice: entry }
		return {
			status: 'entered',
			netR: exit.netR - fillCostR(entry, BINGX_TAKER_RATE + BINGX_SLIP_RATE, 1, risk),
			entryPrice: entry,
		}
	}
	// candleConfirm: подтверждение не пришло за отведённые бары.
	return { status: 'missed-expired', netR: 0, entryPrice: null }
}

/**
 * Bigbar-фильтр (идея пользователя): true, если между созданием сетки и
 * баром касания (исключительно — тело свечи касания на момент решения о
 * лимитном входе ещё не известно) ОДНА свеча телом перекрыла всю входную
 * зону [zoneNear, zoneFar]. Уровень «сожжён» — сетап пропускается.
 * Знание строго из закрытых свечей прошлого — не look-ahead.
 */
export function bigbarCovered(
	candles: Candle[],
	fromIndex: number,
	toIndexExclusive: number,
	zoneA: number,
	zoneB: number,
): boolean {
	const lo = Math.min(zoneA, zoneB)
	const hi = Math.max(zoneA, zoneB)
	for (let i = Math.max(0, fromIndex); i < Math.min(toIndexExclusive, candles.length); i++) {
		const candle = candles[i]
		if (!candle) continue
		const bodyLo = Math.min(candle.open, candle.close)
		const bodyHi = Math.max(candle.open, candle.close)
		if (bodyLo <= lo && bodyHi >= hi) return true
	}
	return false
}
