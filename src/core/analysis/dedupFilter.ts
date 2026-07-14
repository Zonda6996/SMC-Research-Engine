// dedupFilter.ts
//
// Волна 3 (SPEC 7.16): дедупликация пересекающихся сетапов.
//
// Наблюдение (галерея): серия BOS в одном тренде порождает серию сеток —
// несколько сетапов с почти одним стопом. В бэктесте они независимые
// сделки, вживую — кратный риск на одну идею: разворот выбивает все стопы
// одновременно. Дедупликация приводит статистику к торгуемому виду:
// сколько сделок реально возьмёт трейдер, следующий правилу «одна идея —
// одна позиция».
//
// Три правила (тестируются параллельно, сравнение в одном CSV):
// - 'cooldown'     — новый сетап не создаётся, пока предыдущий ВЗЯТЫЙ сетап
//                    того же направления не разрешился (вход+исход). Сетап,
//                    созданный во время открытой сделки, отбрасывается.
// - 'one-position' — сетапы создаются все, но ВХОД разрешён только при
//                    отсутствии открытой позиции того же направления:
//                    отбрасываются сделки, чей вход попадает в интервал
//                    [вход, исход] уже взятой сделки.
// - 'latest-only'  — новая сетка того же направления отменяет старую,
//                    если старая ещё не вошла: торгуется только самая
//                    свежая структура.
//
// Группировка: variantMode × scenario × stopMode × direction — дедуп внутри
// одной стратегии и направления (обе стороны long/short независимы).
// Триггер (bos/choch) в ключ НЕ входит: серия из BOS и CHoCH в одну сторону —
// та же самая идея.
//
// Как и фильтр режима — это пост-фильтр раннера, пайплайн не трогаем.

import type { FibSetupOutcome } from '@/models/fib/FibLifecycle.js'

export type DedupRule = 'cooldown' | 'one-position' | 'latest-only'

export const DEDUP_RULES: DedupRule[] = ['cooldown', 'one-position', 'latest-only']

/**
 * Индекс бара, на котором сделка перестаёт занимать риск.
 * null — сделки не было (сетап не блокирует других по капиталу);
 * Infinity — сделка открыта до конца данных.
 */
function resolveEnd(o: FibSetupOutcome): number | null {
	if (!o.entered) return null
	if (o.state === 'stopped') return o.stopIndex ?? Number.POSITIVE_INFINITY
	if (o.state === 'tp2') return o.tp2Index ?? Number.POSITIVE_INFINITY
	return Number.POSITIVE_INFINITY // 'open' — держим до конца данных
}

function groupKey(o: FibSetupOutcome): string {
	return `${o.variantMode}|${o.scenario}|${o.stopMode}|${o.direction}`
}

/**
 * Возвращает подмножество исходов, выживших после дедупликации по правилу.
 * Порядок исходов сохраняется. Исходы без входа (no-entry/expired/invalidated)
 * сохраняются всегда — они не занимают капитал и не участвуют в EV;
 * правила решают судьбу только вошедших сделок.
 */
export function applyDedup(outcomes: FibSetupOutcome[], rule: DedupRule): FibSetupOutcome[] {
	const groups = new Map<string, FibSetupOutcome[]>()
	for (const o of outcomes) {
		const key = groupKey(o)
		const g = groups.get(key)
		if (g) g.push(o)
		else groups.set(key, [o])
	}
	const kept = new Set<FibSetupOutcome>()
	for (const group of groups.values()) {
		const sorted = [...group].sort((a, b) => a.createdAtIndex - b.createdAtIndex)
		switch (rule) {
			case 'cooldown': {
				// Блок по СОЗДАНИЮ: сетап, созданный пока взятая сделка жива, отброшен.
				let blockUntil = -1
				for (const o of sorted) {
					if (!o.entered) { kept.add(o); continue }
					if (o.createdAtIndex <= blockUntil) continue
					kept.add(o)
					const end = resolveEnd(o)
					if (end != null) blockUntil = Math.max(blockUntil, end)
				}
				break
			}
			case 'one-position': {
				// Блок по ВХОДУ: сетапы создаются все, но вход в интервале
				// [entry, resolve] уже взятой сделки запрещён.
				let busyUntil = -1
				for (const o of sorted.slice().sort((a, b) => (a.entryIndex ?? Infinity) - (b.entryIndex ?? Infinity))) {
					if (!o.entered || o.entryIndex == null) { kept.add(o); continue }
					if (o.entryIndex <= busyUntil) continue
					kept.add(o)
					const end = resolveEnd(o)
					if (end != null) busyUntil = Math.max(busyUntil, end)
				}
				break
			}
			case 'latest-only': {
				// Новая сетка отменяет старую, если старая ещё НЕ вошла к моменту
				// появления новой. Вошедшие сделки доводятся до конца.
				for (let i = 0; i < sorted.length; i++) {
					const o = sorted[i]
					if (o === undefined) continue
					if (!o.entered || o.entryIndex == null) { kept.add(o); continue }
					const next = sorted[i + 1]
					if (next !== undefined && next.createdAtIndex < o.entryIndex) continue // superseded до входа
					kept.add(o)
				}
				break
			}
		}
	}
	return outcomes.filter((o) => kept.has(o))
}

/**
 * Максимальное число одновременно открытых сделок одного направления
 * внутри одной стратегии (по группам groupKey) — мера скрытого кратного
 * риска, которую дедупликация должна убирать. Считается по вошедшим
 * сделкам: интервалы [entryIndex, resolveEnd].
 */
export function maxConcurrentTrades(outcomes: FibSetupOutcome[]): number {
	const groups = new Map<string, { start: number; end: number }[]>()
	for (const o of outcomes) {
		if (!o.entered || o.entryIndex == null) continue
		const end = resolveEnd(o)
		if (end == null) continue
		const key = groupKey(o)
		const g = groups.get(key)
		const span = { start: o.entryIndex, end }
		if (g) g.push(span)
		else groups.set(key, [span])
	}
	let max = 0
	for (const spans of groups.values()) {
		// Заметающая прямая по границам интервалов.
		const events: { at: number; delta: number }[] = []
		for (const s of spans) {
			events.push({ at: s.start, delta: +1 })
			events.push({ at: s.end === Number.POSITIVE_INFINITY ? Number.MAX_SAFE_INTEGER : s.end + 1, delta: -1 })
		}
		events.sort((a, b) => a.at - b.at || a.delta - b.delta)
		let cur = 0
		for (const e of events) {
			cur += e.delta
			if (cur > max) max = cur
		}
	}
	return max
}
