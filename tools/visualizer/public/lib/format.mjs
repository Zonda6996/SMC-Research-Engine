// lib/format.mjs — форматтеры, словари русских подписей, мелкие DOM-хелперы.

export const $ = (id) => document.getElementById(id)
export const time = (ms) => ms / 1000
export const fmtR = (v) => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}R`
export const fmtP = (v) => {
	if (v == null) return '—'
	const a = Math.abs(v)
	return v.toFixed(a >= 1000 ? 2 : a >= 10 ? 4 : a >= 1 ? 5 : 7)
}
export const fmtN = (n) => n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(Math.round(n))
export const cls = (v) => v > 0 ? 'pos' : v < 0 ? 'neg' : ''
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
export const dt = (ms) => new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
export const dshort = (ms) => new Date(ms).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })

/** Палитра графика (согласована с токенами styles.css). */
export const C = {
	green: '#2fd08c', red: '#f4506a', amber: '#f0a941', blue: '#5b8cff',
	purple: '#9a7bff', cyan: '#38bdf8', dim: '#6b7280', text: '#e7e7ea', grid: '#17171b',
}

export const LIFE_RU = { forming: 'формируется', fresh: 'готова', 'in-play': 'в игре', spent: 'отработала', failed: 'не сработала', retired: 'устарела' }
export const SPENT_RU = { 'ran-away': 'цена ушла от зоны', 'tp-hit': 'взяли тейк', 'swept-through': 'прошли насквозь (стек снят)', 'stack-consumed': 'стек снят по объёму' }
export const REASON_RU = {
	'zone-ended': 'окно зоны закрылось (провал/отработка/отставка)', 'broke-below-zone': 'пробой зоны закрытиями', 'data-end': 'край данных',
	'timeout@stopping': 'бездействие: ждали остановку', 'timeout@rebound': 'бездействие: ждали отскок', 'timeout@sweep': 'бездействие: ждали пересвип',
	'timeout@protect': 'бездействие: ждали защиту', 'timeout@entry': 'бездействие: ждали вход',
}
export const PRIO_RU = { nearest: 'ближайшая', outer: 'outer', secondary: 'фон' }
export const INTER_RU = { untouched: 'не трогали', touched: 'тронута 1×', retested: 'тронута повторно' }
export const TRACE_RU = {
	POI_TOUCH: 'заход в зону', STOP_CONFIRMED: 'остановка (лой)', RESTART: 'перезапуск от нового экстремума',
	ANCHOR_DEEPENED: 'якорь глубже — ждём его пересвип', REBOUND: 'отскок', SECOND_SWEEP: 'пересвип', PROTECTED: 'защита',
	WEAKNESS_TEST: 'тест слабости', ENTRY_CANCELLED: 'вход отменён (далеко)', ENTRY: 'вход', STOP: 'стоп', TP2: 'тейк 2R',
}
