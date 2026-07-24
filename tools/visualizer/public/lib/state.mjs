// lib/state.mjs — общее состояние визуализатора (единственный мутируемый стор).
// Режимы поверх одного графика: trades (боевой слой) / zones (Liquidity POI) /
// conf (подтверждение на 15m) / lab (Decision Lab). Панели меняют режим через setMode.

export const S = {
	/** Ответ /api/analyze целиком (см. server.ts). */
	data: null,
	/** Активный режим графика: 'trades' | 'zones' | 'conf' | 'lab'. */
	mode: 'trades',

	// Боевой слой.
	selectedId: null,
	filtered: [],

	// Зоны ликвидности.
	poiFocusId: null,

	// Подтверждение.
	confIndex: 0,
	confZonesMode: false,

	// Heatmap.
	hmOn: false,
	hmShownBands: [],

	// Decision Lab.
	lab: { on: false, index: 0, cursorAt: 0, revealed: false, order: [], startedAt: 0, lastContext: '5m' },

	/** Свечи основного ТФ уже на графике (кэш перезаливки). */
	mainShown: false,
}

const listeners = new Set()
export function onModeChange(fn) { listeners.add(fn) }
export function setMode(mode) {
	if (S.mode === mode) return
	S.mode = mode
	for (const fn of listeners) fn(mode)
}
