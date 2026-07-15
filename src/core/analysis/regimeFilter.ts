// regimeFilter.ts
//
// Волна 2 фильтра режима рынка (SPEC 7.15): сам фильтр.
//
// Обоснование — волна 1 (три эпохи, монотонное разделение):
// - atrRatio: нижний терциль (~<0.94, сжатая волатильность) стабильно
//   убыточен для deep на ВСЕХ эпохах, для ote — около нуля или минус.
// - chochShare: верхний терциль (>=0.5, пила направлений) убивает deep
//   (−0.13/−0.14/−0.32) и ote.
// - breaker в «плохих» бакетах остаётся плюсовым — его не фильтруем.
//
// Пороги откалиброваны по терцилям СТАРЫХ эпох (до-2024, до-2023);
// текущая эпоха — валидационная, фильтр её не видел.
//
// Семантика: фильтр применяется на момент СОЗДАНИЯ сетапа
// (createdAtIndex) — look-ahead-free, т.к. метрики режима на индексе i
// зависят только от прошлого (см. regimeMetrics.ts).

import type { RegimeMetrics } from './regimeMetrics.js'

export interface RegimeFilterConfig {
	/** Блокировать сетап при atrRatio ниже порога (сжатие волатильности). */
	minAtrRatio: number
	/** Блокировать сетап при chochShare на уровне или выше порога (пила). */
	maxChochShare: number
	/** Сценарии, к которым фильтр применяется. Breaker не трогаем. */
	scenarios: ReadonlySet<string>
	/**
	 * Опционально: блокировать при effRatio ниже порога (пила по цене).
	 * Не задан = не проверяется (базовый фильтр не меняется).
	 */
	minEffRatio?: number
	/** Опционально: блокировать при trendStability ниже порога (чехарда трендов). */
	minTrendStability?: number
}

/**
 * Пороги по умолчанию: границы нижнего терциля atrRatio (~0.94) и
 * верхнего терциля chochShare (0.5) на эпохах до-2024/до-2023.
 */
export const DEFAULT_REGIME_FILTER: RegimeFilterConfig = {
	minAtrRatio: 0.94,
	maxChochShare: 0.5,
	scenarios: new Set(['ote', 'deep']),
}

/**
 * Строгий пресет (SPEC 7.20, фильтр chop): формализация «боковик/АМД» из
 * визуального ревью блока A. Ужесточает базовый фильтр и подключает метрики,
 * которые он не использует: effRatio (пила по цене) и trendStability
 * (чехарда трендов). Пороги — медианы соответствующих метрик на эпохах
 * до-2024 (см. волну 1 в SPEC 7.15): режим хуже медианы = боковик.
 * Применяется ко всем каноническим сценариям — ревью показало, что АМД
 * поражает сетапы независимо от сценария.
 */
export const STRICT_REGIME_FILTER: RegimeFilterConfig = {
	minAtrRatio: 0.94,
	maxChochShare: 0.5,
	scenarios: new Set(['ote', 'deep', 'breaker']),
	minEffRatio: 0.2,
	minTrendStability: 0.6,
}

/**
 * true = сетап проходит фильтр (режим пригоден для сценария).
 *
 * Консервативное правило для недоступных метрик (окно ещё не набралось,
 * null): metрика не блокирует. Фильтр отрезает только ДОКАЗАННО плохой
 * режим; отсутствие данных — не доказательство.
 */
export function passesRegimeFilter(
	scenario: string,
	metrics: RegimeMetrics | undefined,
	config: RegimeFilterConfig = DEFAULT_REGIME_FILTER,
): boolean {
	if (!config.scenarios.has(scenario)) return true
	if (!metrics) return true
	if (metrics.atrRatio != null && metrics.atrRatio < config.minAtrRatio) return false
	if (metrics.chochShare != null && metrics.chochShare >= config.maxChochShare) return false
	if (config.minEffRatio != null && metrics.effRatio != null && metrics.effRatio < config.minEffRatio) return false
	if (config.minTrendStability != null && metrics.trendStability != null && metrics.trendStability < config.minTrendStability) return false
	return true
}
