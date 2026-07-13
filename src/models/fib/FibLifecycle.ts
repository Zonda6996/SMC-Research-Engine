// FibLifecycle.ts
//
// Модель жизненного цикла Fib-сетапа: симуляция плейбука по каждой сетке
// (вход в зоне ретрейса, стоп за 0%, цели на расширениях) и запись исхода.
// Это исследовательская статистика, не торговый движок: никакого управления
// позицией, только фиксация того, что сделала цена.

import type { FibAnchorMode, FibDirection } from './FibGrid.js'
import type { StructureEventType } from '@/models/events/StructureEvent.js'

/**
 * Сценарии входа из плейбука:
 * - 'ote'     — ретрейс в зону 61.8–78.6, вход по первому касанию (78.6);
 * - 'deep'    — глубокий откат в зону 23.6–38.2, вход по касанию 38.2;
 * - 'breaker' — цена после события дошла до 141 БЕЗ касания OTE-зоны,
 *               вход на ретесте 100% (точки слома). Запись создаётся только
 *               если предусловие (141 раньше OTE) выполнилось.
 * - 'fade141' — контртренд: вход ПРОТИВ сетки по первому касанию 141
 *               (ближняя граница зоны расширения 1.41–1.61), цели вниз по
 *               сетке: TP1 = 100%, TP2 = 78.6. Направление сделки в outcome
 *               ИНВЕРТИРОВАНО относительно направления сетки.
 * - 'fade241' — то же от зоны 2.41–2.61: вход по касанию 241, стоп за 261.
 */
export type FibScenario = 'ote' | 'deep' | 'breaker' | 'fade141' | 'fade241'

/**
 * Режим стопа:
 * - 'zero'    — стоп за 0% сетки (базовый плейбук);
 * - 'tight'   — стоп за 23.6 (только для OTE-входа от 78.6 — гипотеза
 *   пользователя, что укороченный стоп даёт лучшее матожидание);
 * - 'wide05'  — стоп за 0% с буфером 0.5 × ATR14 на момент пробоя
 *   (ote/deep; ATR восстанавливается как legSize / legAtrRatio);
 * - 'wide10'  — то же с буфером 1.0 × ATR14;
 * - 'zone'    — только fade: стоп за дальней границей зоны (161 / 261);
 * - 'zoneAtr' — только fade: стоп за дальней границей зоны + 0.5 × ATR14.
 * Breaker всегда симулируется только с 'zero'. ATR-зависимые режимы
 * (wide05/wide10/zoneAtr) не эмитятся, если legAtrRatio недоступен.
 */
export type FibStopMode = 'zero' | 'tight' | 'wide05' | 'wide10' | 'zone' | 'zoneAtr'

/**
 * Финальное состояние сетапа:
 * - 'no-entry'    — вход не случился до конца данных;
 * - 'expired'     — до входа подтвердилось событие противоположного
 *                   направления (структура развернулась, сетап отменён);
 * - 'invalidated' — цена ушла за 0% до входа (для breaker: до ретеста 100%);
 * - 'open'        — вход есть, но ни стоп, ни TP2 не сработали до конца данных;
 * - 'stopped'     — после входа коснулись стопа (за 0%) раньше TP2;
 * - 'tp2'         — после входа дошли до TP2 (241) раньше стопа.
 *
 * TP1 (141) записывается отдельным флагом: состояние 'stopped' с tp1Hit=true —
 * это «дошли до первой цели, потом вернулись в стоп».
 */
export type FibSetupState = 'no-entry' | 'expired' | 'invalidated' | 'open' | 'stopped' | 'tp2'

/** Исход одного сетапа (кандидат × вариант якоря × сценарий × режим стопа). */
export interface FibSetupOutcome {
	candidateId: string
	variantMode: FibAnchorMode
	scenario: FibScenario
	stopMode: FibStopMode
	trigger: Exclude<StructureEventType, 'unlabeled'>
	direction: FibDirection
	/** Нога 0%→100% в ATR на момент пробоя — для фильтра в UI. */
	legAtrRatio: number | null
	/** Свип противоположного экстремума перед сломом (стоп-хант) — A/B-разрез. */
	oppositeSweptBefore: boolean
	createdAtIndex: number

	entered: boolean
	entryIndex: number | null
	entryPrice: number | null
	stopPrice: number
	/** |entry − stop| — размер риска (1R) в цене. */
	riskSize: number | null

	state: FibSetupState
	tp1Hit: boolean
	tp1Index: number | null
	tp2Hit: boolean
	tp2Index: number | null
	stopIndex: number | null

	/**
	 * Расстояние до TP1/TP2 от входа в единицах риска (R-мультипликаторы целей).
	 * Заполняются при входе — нужны для расчёта EV в UI.
	 */
	rTp1: number | null
	rTp2: number | null
	/**
	 * Поведение после TP1 при менеджменте «безубыток»: вернулась ли цена
	 * к цене входа раньше, чем дошла до TP2. true — раннер закрыт в 0,
	 * false — дошли до TP2, null — TP1 не был достигнут или данные кончились.
	 * Бар касания TP1 проверяется консервативно: если его противоположная
	 * тень задела вход, считаем возврат (внутрибарная последовательность неизвестна).
	 */
	beAfterTp1: boolean | null

	/** Максимальный ход в плюс/минус после входа, в R. */
	mfeR: number | null
	maeR: number | null
	/**
	 * Максимальная достигнутая цена после входа как ratio сетки:
	 * (price − p0) / legSize × 100 (для short-сетки зеркально). Окно: от входа
	 * до первого касания ИСХОДНОГО стопа сценария либо конца данных — TP2 скан
	 * не обрывает. Диагностическое поле для анализа целей 141/200/241 и
	 * трейлинга, в EV не участвует. Только для ote/deep/breaker; fade — null.
	 */
	maxExtensionRatio: number | null
	/**
	 * «Стоп выбит, затем TP1 всё же достигнут»: для state === 'stopped'
	 * сканируем после стоп-бара, дошла ли цена до TP1 раньше подтверждения
	 * следующего события против направления СДЕЛКИ либо конца данных.
	 * Для остальных состояний — null. Диагностика качества стопа.
	 */
	tpAfterStop: boolean | null
	barsToEntry: number | null
	/** Баров от входа до финала (stop/tp2) либо до конца данных. */
	barsToResolve: number | null
}

export interface FibLifecycleResult {
	outcomes: FibSetupOutcome[]
}
