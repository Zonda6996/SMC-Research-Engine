import assert from 'node:assert/strict'
import { it } from 'node:test'
import { detectPoiConfirmation, POI_CONFIRMATION_VERSION } from '../src/core/confirmation/PoiConfirmationEngine.js'
import type { Candle } from '../src/models/price/Candle.js'
import type { LiquidityPoiCandidate } from '../src/core/confirmation/LiquidityPoiCalibration.js'

function makePoi(overrides: Partial<LiquidityPoiCandidate> = {}): LiquidityPoiCandidate {
	return {
		id: 'poi-test', version: 'test', direction: 'long', zoneClass: 'protected-structure',
		anchorId: 'a', componentAnchorIds: ['a'], componentClasses: ['protected-structure'],
		originAt: 0, knownAt: 0, near: 100, far: 90, atr: 1, boundarySource: 'liquidity-cluster',
		liquidityBands: [], pivotCount: 1, pivotPrices: [100], pivotTimes: [0], eventType: null,
		pdZone: 'none', pdAligned: null, lifecycleState: 'fresh', valid: true, active: true,
		priority: 'nearest', interaction: 'untouched', touchCount: 0, armedAt: 0, firstTouchAt: null,
		consumedAt: null, failedAt: null, spentAt: null, spentReason: null, duplicateOf: null, retiredAt: null,
		geometryKnownAt: 0, lineageSupersededAt: null,
		supersededAt: null, invalidatedAt: null, endAt: 100_000, mergedCount: 0, suppressedCount: 0,
		...overrides,
	}
}

const baseline = (n: number, start: number, price: number, range = 1): Candle[] =>
	Array.from({ length: n }, (_, k) => ({ timestamp: start + k, open: price, high: price + range, low: price - range, close: price - 0.5 * range, volume: 10 }))

// Канон v1.4 (проторговка N=4, отскок M=6): заход в [90,100] → лой 94 → 4 тихих бара → остановка →
// 6 баров отскока → пересвип 93.7 → защита → импульс → откатная (v5) → возобновление (v15>5) → вход → TP2.
const fullLongSequence = (offset = 0): Candle[] => [
	{ timestamp: offset + 7, open: 105, high: 106, low: 95, close: 96, volume: 10 },      // заход, лой 95
	{ timestamp: offset + 8, open: 96, high: 97, low: 94, close: 94.5, volume: 10 },      // углубление, лой 94
	{ timestamp: offset + 9, open: 94.5, high: 95.5, low: 94.2, close: 95, volume: 10 },  // зелёная, но тихо только 1 бар — НЕ остановка
	{ timestamp: offset + 10, open: 95, high: 95.8, low: 94.3, close: 94.8, volume: 10 },
	{ timestamp: offset + 11, open: 94.8, high: 95.5, low: 94.4, close: 95.2, volume: 10 },
	{ timestamp: offset + 12, open: 95.2, high: 96, low: 94.6, close: 95.8, volume: 10 }, // тихо 4 бара → ОСТАНОВКА (94)
	{ timestamp: offset + 13, open: 95.8, high: 96.5, low: 95, close: 95.5, volume: 10 },
	{ timestamp: offset + 14, open: 95.5, high: 96.2, low: 94.9, close: 95.2, volume: 10 },
	{ timestamp: offset + 15, open: 95.2, high: 96.8, low: 95, close: 96.3, volume: 10 },
	{ timestamp: offset + 16, open: 96.3, high: 97, low: 95.5, close: 96, volume: 10 },
	{ timestamp: offset + 17, open: 96, high: 97.2, low: 95.8, close: 96.5, volume: 10 },
	{ timestamp: offset + 18, open: 96.5, high: 97.5, low: 96, close: 97, volume: 10 },   // 6 баров от остановки → ОТСКОК
	{ timestamp: offset + 19, open: 97, high: 97.2, low: 93.7, close: 93.9, volume: 10 }, // ПЕРЕСВИП 93.7, close ниже лоя
	{ timestamp: offset + 20, open: 93.9, high: 95.5, low: 93.8, close: 95, volume: 10 }, // ЗАЩИТА (+импульс: зелёная)
	{ timestamp: offset + 21, open: 95, high: 96.5, low: 94.8, close: 96, volume: 20 },   // импульс
	{ timestamp: offset + 22, open: 96, high: 96.3, low: 95, close: 95.3, volume: 5 },    // откатная v5
	{ timestamp: offset + 23, open: 95.3, high: 96.5, low: 95.1, close: 95.9, volume: 15 }, // возобновление v15>5 → ВХОД
	{ timestamp: offset + 24, open: 95.9, high: 101, low: 95.5, close: 100.5, volume: 10 }, // TP2
	{ timestamp: offset + 25, open: 100.5, high: 101, low: 100, close: 100.6, volume: 10 },
	{ timestamp: offset + 26, open: 100.5, high: 101, low: 100, close: 100.6, volume: 10 },
	{ timestamp: offset + 27, open: 100.5, high: 101, low: 100, close: 100.6, volume: 10 },
]

/** Зеркало последовательности вокруг 100: лонг-фикстура превращается в шорт (зона [100,110]). */
const mirror = (bars: Candle[]): Candle[] => bars.map(b => ({
	timestamp: b.timestamp, open: 200 - b.open, high: 200 - b.low, low: 200 - b.high, close: 200 - b.close, volume: b.volume,
}))

it('версия заморожена; пустой вход — пустой выход', () => {
	assert.equal(POI_CONFIRMATION_VERSION, 'poi-confirmation-1.6-quiet-reanchor')
	assert.deepEqual(detectPoiConfirmation([], []), [])
})

it('полная LONG-последовательность: проторговка у лоя → остановка → отскок → пересвип → защита → тест слабости → вход → TP2', () => {
	const ltf: Candle[] = [...baseline(7, 0, 110), ...fullLongSequence(0)]
	const poi = makePoi()
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.ltfCoverage, 'full')
	assert.equal(result!.attempts.length, 1)
	const attempt = result!.attempts[0]!
	assert.equal(attempt.status, 'entered')
	assert.equal(attempt.rejectionReason, null)
	assert.equal(attempt.outcome, 'tp')
	assert.equal(attempt.grossR, 2)
	assert.equal(attempt.sweptZoneExtreme, true) // 93.7 ниже абсолютного экстремума окна (94)
	assert.equal(attempt.arrivalVolumeRatio, null)
	assert.deepEqual(attempt.trace.map(t => t.state),
		['POI_TOUCH', 'STOP_CONFIRMED', 'REBOUND', 'SECOND_SWEEP', 'PROTECTED', 'WEAKNESS_TEST', 'ENTRY', 'TP2'])
	// Остановка подтверждена только после 4 тихих баров (не первой зелёной свечой у лоя).
	const stop = attempt.trace.find(t => t.state === 'STOP_CONFIRMED')!
	assert.equal(stop.at, 12)
	assert.equal(stop.price, 94)
	// Отскок — через 6 баров от остановки.
	assert.equal(attempt.trace.find(t => t.state === 'REBOUND')!.at, 18)
	assert.equal(result!.spentReason, 'tp-hit')
})

it('SHORT-зеркало полной последовательности отрабатывает симметрично', () => {
	const ltf = mirror([...baseline(7, 0, 110), ...fullLongSequence(0)])
	const poi = makePoi({ direction: 'short', near: 100, far: 110 })
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.attempts.length, 1)
	assert.equal(result!.attempts[0]!.status, 'entered')
	assert.equal(result!.attempts[0]!.outcome, 'tp')
})

it('глубокий заход без остановки не сжигает попытку — вход из одного касания (перезапуски §16.8)', () => {
	const ltf: Candle[] = [
		...baseline(7, 0, 110),
		{ timestamp: 7, open: 105, high: 106, low: 95, close: 96, volume: 10 },
		...baseline(30, 8, 103, 0.4), // ушли от зоны, ни одной зелёной — попытка ждёт
		...fullLongSequence(31),
	]
	const poi = makePoi()
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.attempts.length, 1)
	assert.equal(result!.attempts[0]!.status, 'entered')
	assert.equal(result!.attempts[0]!.outcome, 'tp')
	assert.equal(result!.spentReason, 'tp-hit')
})

it('после tp-hit зона отработала: повторные касания попыток не создают (решение №10)', () => {
	const ltf: Candle[] = [
		...baseline(7, 0, 110),
		...fullLongSequence(0),
		...baseline(10, 28, 110),
		{ timestamp: 38, open: 105, high: 106, low: 95, close: 96, volume: 10 },
		...baseline(10, 39, 110),
	]
	const poi = makePoi()
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.attempts.length, 1)
	assert.equal(result!.spentReason, 'tp-hit')
	assert.equal(result!.endAt, result!.attempts[0]!.trace.find(t => t.state === 'TP2')!.at)
})

it('ATR-fallback зоны и near-дубли подтверждением не торгуются (решения №6, №20)', () => {
	const ltf: Candle[] = [...baseline(7, 0, 110), ...fullLongSequence(0)]
	assert.deepEqual(detectPoiConfirmation([makePoi({ boundarySource: 'atr-calibration' })], ltf), [])
	assert.deepEqual(detectPoiConfirmation([makePoi({ duplicateOf: 'senior-zone' })], ltf), [])
})

it('окно [knownAt, endAt): после конца окна зоны попыток нет', () => {
	const ltf: Candle[] = [...baseline(7, 0, 110), ...fullLongSequence(0)]
	const poi = makePoi({ endAt: 3 })
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.attempts.length, 0)
	assert.equal(result!.endAt, 3)
})

it('15m-история не покрывает окно зоны → ltfCoverage none, ноль попыток (данные, не логика)', () => {
	const ltf: Candle[] = baseline(20, 5000, 95)
	const poi = makePoi({ endAt: 500 })
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.ltfCoverage, 'none')
	assert.equal(result!.attempts.length, 0)
})

it('§16.9: смерть попытки по БЕЗДЕЙСТВИЮ — 96 баров без событий → timeout@stopping', () => {
	const ltf: Candle[] = [
		...baseline(7, 0, 110),
		{ timestamp: 7, open: 105, high: 106, low: 95, close: 96, volume: 10 },
		...baseline(120, 8, 99, 0.4), // все красные: остановки нет, событий нет
	]
	const poi = makePoi()
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.attempts[0]!.status, 'rejected')
	assert.equal(result!.attempts[0]!.rejectionReason, 'timeout@stopping')
})

it('§16.9: якорь = НЕвыметенный экстремум зоны — переживает отбраковку и повторный заход', () => {
	// Заход №1 делает лой 94 и умирает по бездействию (свипа не было — стопы под 94 всё ещё там).
	// Заход №2 мельче (лой 97), но остановка строится вокруг СТАРОГО невыметенного лоя 94.
	const ltf: Candle[] = [
		...baseline(7, 0, 110),
		{ timestamp: 7, open: 105, high: 106, low: 94, close: 96, volume: 10 },
		...baseline(97, 8, 103, 0.4), // бездействие 96+ баров → попытка 1 умирает
		{ timestamp: 105, open: 103, high: 103.2, low: 97, close: 97.5, volume: 10 },  // заход №2, лой 97
		{ timestamp: 106, open: 97.5, high: 98.5, low: 97.2, close: 98.2, volume: 10 }, // зелёная: тишина у 94 давняя → ОСТАНОВКА сразу
		...baseline(10, 107, 98, 0.4),
	]
	const poi = makePoi()
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.attempts.length, 2)
	assert.equal(result!.attempts[0]!.rejectionReason, 'timeout@stopping')
	const stop2 = result!.attempts[1]!.trace.find(t => t.state === 'STOP_CONFIRMED')
	assert.ok(stop2)
	assert.equal(stop2!.price, 94) // якорь — старый невыметенный лой, не 97
})

it('§16.9: после свипа якорь потрачен — новый копится с этого момента', () => {
	// Попытка 1: лой 94 → пересвип 93.7 → защита, но входа нет (цена убегает) → смерть по бездействию.
	// Попытка 2: заход с лоем 96.5 → якорь НЕ 93.7 (он выметен), а свежий 94.4 (пост-свиповая проторговка).
	const ltf: Candle[] = [
		...baseline(7, 0, 110),
		...fullLongSequence(0).slice(0, 12),                                            // t7..t18: лой 94, остановка, отскок
		{ timestamp: 19, open: 97, high: 97.2, low: 93.7, close: 94.5, volume: 10 },     // пересвип 93.7 + защита той же свечой
		{ timestamp: 20, open: 94.5, high: 96, low: 94.4, close: 95.8, volume: 10 },     // пост-свиповый лой 94.4
		{ timestamp: 21, open: 95.8, high: 101, low: 95.7, close: 100.8, volume: 10 },   // импульс вон из зоны
		...baseline(97, 22, 103, 0.4),                                                   // бездействие → попытка 1 умирает
		{ timestamp: 119, open: 103, high: 103.2, low: 96.5, close: 97, volume: 10 },    // заход №2, лой 96.5
		{ timestamp: 120, open: 97, high: 98, low: 96.8, close: 97.8, volume: 10 },      // зелёная → остановка
		...baseline(10, 121, 98, 0.4),
	]
	const poi = makePoi()
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.attempts.length, 2)
	assert.ok(result!.attempts[0]!.trace.some(t => t.state === 'SECOND_SWEEP'))
	const stop2 = result!.attempts[1]!.trace.find(t => t.state === 'STOP_CONFIRMED')
	assert.ok(stop2)
	assert.equal(stop2!.price, 94.4) // не 93.7: выметенный экстремум не возвращается
})

it('§16.11: потеря защиты → якорь глубже (ANCHOR_DEEPENED) и подтверждение строится ЗАНОВО (проторговка + отскок)', () => {
	const ltf: Candle[] = [
		...baseline(7, 0, 110),
		{ timestamp: 7, open: 105, high: 106, low: 95, close: 96, volume: 10 },
		{ timestamp: 8, open: 96, high: 96.8, low: 94.8, close: 95.2, volume: 10 },      // лой 94.8
		{ timestamp: 9, open: 95.2, high: 95.8, low: 95, close: 95.5, volume: 10 },
		{ timestamp: 10, open: 95.5, high: 96, low: 95.1, close: 95.4, volume: 10 },
		{ timestamp: 11, open: 95.4, high: 96.2, low: 95, close: 95.9, volume: 10 },
		{ timestamp: 12, open: 95.9, high: 96.5, low: 95.2, close: 96.2, volume: 10 },   // остановка (94.8)
		{ timestamp: 13, open: 96.2, high: 96.8, low: 95.5, close: 96, volume: 10 },
		{ timestamp: 14, open: 96, high: 96.6, low: 95.4, close: 95.8, volume: 10 },
		{ timestamp: 15, open: 95.8, high: 97, low: 95.6, close: 96.7, volume: 10 },
		{ timestamp: 16, open: 96.7, high: 97.2, low: 95.9, close: 96.3, volume: 10 },
		{ timestamp: 17, open: 96.3, high: 97, low: 96, close: 96.6, volume: 10 },
		{ timestamp: 18, open: 96.6, high: 97.3, low: 96.1, close: 97, volume: 10 },     // отскок
		{ timestamp: 19, open: 97, high: 97.1, low: 93.8, close: 94.2, volume: 10 },     // пересвип, close ниже лоя (1)
		{ timestamp: 20, open: 94.2, high: 94.6, low: 93.9, close: 94.1, volume: 10 },   // close ниже лоя (2), НО в зоне → ПЕРЕЗАПУСК от 93.8
		{ timestamp: 21, open: 94.1, high: 94.8, low: 94, close: 94.5, volume: 10 },
		{ timestamp: 22, open: 94.5, high: 95, low: 94.1, close: 94.3, volume: 10 },
		{ timestamp: 23, open: 94.3, high: 95.2, low: 94.2, close: 94.9, volume: 10 },
		{ timestamp: 24, open: 94.9, high: 95.5, low: 94.3, close: 95.2, volume: 10 },   // остановка №2 (93.8)
		{ timestamp: 25, open: 95.2, high: 95.8, low: 94.6, close: 95.5, volume: 10 },
		{ timestamp: 26, open: 95.5, high: 96, low: 94.8, close: 95.3, volume: 10 },
		{ timestamp: 27, open: 95.3, high: 96.2, low: 95, close: 95.9, volume: 10 },
		{ timestamp: 28, open: 95.9, high: 96.5, low: 95.2, close: 96.1, volume: 10 },
		{ timestamp: 29, open: 96.1, high: 96.6, low: 95.4, close: 96, volume: 10 },
		{ timestamp: 30, open: 96, high: 96.8, low: 95.5, close: 96.4, volume: 10 },     // отскок №2
		{ timestamp: 31, open: 96.4, high: 96.5, low: 93.6, close: 94.5, volume: 10 },   // пересвип №2 (93.6) + защита
		{ timestamp: 32, open: 94.5, high: 96, low: 94.3, close: 95.8, volume: 12 },     // импульс
		{ timestamp: 33, open: 95.8, high: 96, low: 94.9, close: 95.1, volume: 5 },      // откатная
		{ timestamp: 34, open: 95.1, high: 95.9, low: 95, close: 95.3, volume: 15 },     // возобновление → вход
		{ timestamp: 35, open: 95.3, high: 101, low: 95, close: 100.5, volume: 10 },     // TP
		{ timestamp: 36, open: 100.5, high: 101, low: 100, close: 100.6, volume: 10 },
	]
	const poi = makePoi()
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.attempts.length, 1)
	const attempt = result!.attempts[0]!
	assert.ok(attempt.trace.some(t => t.state === 'ANCHOR_DEEPENED'))
	// §16.11 (QA скрин 2): после переноса якоря нужны проторговка у нового экстремума и отскок —
	// мгновенный пересвип «одним движением» больше не проходит.
	const deepenIdx = attempt.trace.findIndex(t => t.state === 'ANCHOR_DEEPENED')
	const after = attempt.trace.slice(deepenIdx + 1).map(t => t.state)
	assert.ok(after.includes('STOP_CONFIRMED') && after.includes('REBOUND'))
	assert.equal(attempt.status, 'entered')
})

it('защита (решение №12): две close ЗА дальней границей → broke-below-zone', () => {
	const ltf: Candle[] = [
		...baseline(7, 0, 110),
		{ timestamp: 7, open: 105, high: 106, low: 95, close: 96, volume: 10 },
		{ timestamp: 8, open: 96, high: 96.8, low: 94.8, close: 95.2, volume: 10 },
		{ timestamp: 9, open: 95.2, high: 95.8, low: 95, close: 95.5, volume: 10 },
		{ timestamp: 10, open: 95.5, high: 96, low: 95.1, close: 95.4, volume: 10 },
		{ timestamp: 11, open: 95.4, high: 96.2, low: 95, close: 95.9, volume: 10 },
		{ timestamp: 12, open: 95.9, high: 96.5, low: 95.2, close: 96.2, volume: 10 },   // остановка
		{ timestamp: 13, open: 96.2, high: 96.8, low: 95.5, close: 96, volume: 10 },
		{ timestamp: 14, open: 96, high: 96.6, low: 95.4, close: 95.8, volume: 10 },
		{ timestamp: 15, open: 95.8, high: 97, low: 95.6, close: 96.7, volume: 10 },
		{ timestamp: 16, open: 96.7, high: 97.2, low: 95.9, close: 96.3, volume: 10 },
		{ timestamp: 17, open: 96.3, high: 97, low: 96, close: 96.6, volume: 10 },
		{ timestamp: 18, open: 96.6, high: 97.3, low: 96.1, close: 97, volume: 10 },     // отскок
		{ timestamp: 19, open: 97, high: 97.1, low: 89, close: 89.5, volume: 10 },       // пересвип и close ниже far
		{ timestamp: 20, open: 89.5, high: 89.8, low: 88.5, close: 89, volume: 10 },     // вторая close ниже far → отмена
		...baseline(10, 21, 87, 0.4),
	]
	const poi = makePoi()
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.attempts[0]!.status, 'rejected')
	assert.equal(result!.attempts[0]!.rejectionReason, 'broke-below-zone')
})

it('тест слабости (решение №13): возобновление слабее последней откатной — входа нет, ждём следующее', () => {
	const ltf: Candle[] = [
		...baseline(7, 0, 110),
		...fullLongSequence(0).slice(0, 14),                                             // t7..t20: до защиты включительно
		{ timestamp: 21, open: 95, high: 96.5, low: 94.8, close: 96, volume: 20 },       // импульс
		{ timestamp: 22, open: 96, high: 96.3, low: 95, close: 95.3, volume: 8 },        // откатная v8
		{ timestamp: 23, open: 95.3, high: 96, low: 95.1, close: 95.7, volume: 5 },      // возобновление v5 < 8 → НЕ вход
		{ timestamp: 24, open: 95.7, high: 95.9, low: 94.9, close: 95.2, volume: 4 },    // откатная v4
		{ timestamp: 25, open: 95.2, high: 96.2, low: 95, close: 95.7, volume: 15 },     // возобновление v15 > 4 → ВХОД
		{ timestamp: 26, open: 95.7, high: 101, low: 95.4, close: 100.6, volume: 10 },
		{ timestamp: 27, open: 100.6, high: 101, low: 100, close: 100.7, volume: 10 },
	]
	const poi = makePoi()
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	const attempt = result!.attempts[0]!
	assert.equal(attempt.status, 'entered')
	assert.equal(attempt.entryAt, 25)
	assert.equal(attempt.trace.find(t => t.state === 'WEAKNESS_TEST')!.at, 24)
})

it('отмена входа (решение №3): риск больше entryMaxRiskAtr×ATR — ENTRY_CANCELLED, попытка живёт', () => {
	const ltf: Candle[] = [
		...baseline(7, 0, 110),
		...fullLongSequence(0).slice(0, 15),                                             // t7..t21: до импульса
		{ timestamp: 22, open: 96, high: 96.3, low: 95, close: 95.3, volume: 5 },        // откатная
		{ timestamp: 23, open: 95.3, high: 115, low: 95.2, close: 114, volume: 15 },     // возобновление-монстр → отмена
		...baseline(10, 24, 114, 0.2),
	]
	const poi = makePoi()
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	const attempt = result!.attempts[0]!
	assert.ok(attempt.trace.some(t => t.state === 'ENTRY_CANCELLED'))
	assert.ok(attempt.trace.every(t => t.state !== 'ENTRY'))
	assert.equal(attempt.status, 'rejected')
})

it('§16.10: попытка с состоявшимся пересвипом доигрывается за концом окна зоны', () => {
	// Окно зоны кончается на t21 (после пересвипа t19 и защиты t20, ДО входа t23) —
	// попытка доигрывается до входа и тейка, новые касания после окна не стартуют.
	const ltf: Candle[] = [...baseline(7, 0, 110), ...fullLongSequence(0)]
	const poi = makePoi({ endAt: 21 })
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.attempts.length, 1)
	assert.equal(result!.attempts[0]!.status, 'entered')
	assert.equal(result!.attempts[0]!.outcome, 'tp')
})

it('§16.10: попытка БЕЗ пересвипа обрезается концом окна зоны (zone-ended)', () => {
	// Окно кончается на t15 — пересвип (t19) ещё не случился → попытка обрезана.
	const ltf: Candle[] = [...baseline(7, 0, 110), ...fullLongSequence(0)]
	const poi = makePoi({ endAt: 15 })
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.attempts.length, 1)
	assert.equal(result!.attempts[0]!.status, 'rejected')
	assert.equal(result!.attempts[0]!.rejectionReason, 'zone-ended')
})

it('§16.10: тест слабости и отмена входа не продлевают попытку — смерть по бездействию после защиты', () => {
	const ltf: Candle[] = [
		...baseline(7, 0, 110),
		...fullLongSequence(0).slice(0, 15),                                          // t7..t21: до импульса
		{ timestamp: 22, open: 96, high: 96.3, low: 95, close: 95.3, volume: 5 },     // откатная
		{ timestamp: 23, open: 95.3, high: 115, low: 95.2, close: 114, volume: 15 },  // возобновление-монстр → отмена (не событие для idle)
		...baseline(130, 24, 114, 0.2),                                               // тишина: смерть через 96 баров после ЗАЩИТЫ (t20)
	]
	const poi = makePoi()
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	const attempt = result!.attempts[0]!
	assert.ok(attempt.trace.some(t => t.state === 'ENTRY_CANCELLED'))
	assert.equal(attempt.status, 'rejected')
	assert.equal(attempt.rejectionReason, 'timeout@entry')
})

it('§16.10: стоп за историческим экстремумом окна, если тот глубже свип-экстремума в пределах 0.5 ATR', () => {
	// Попытка 1 свипает 93.7 (исторический экстремум окна) и умирает без входа; попытка 2 свипает
	// только 94.25 — стоп ставится за 93.7 (структура), а не за фитилём 94.25.
	const ltf: Candle[] = [
		...baseline(7, 0, 110),
		...fullLongSequence(0).slice(0, 12),                                              // t7..t18: лой 94, остановка, отскок
		{ timestamp: 19, open: 97, high: 97.2, low: 93.7, close: 94.5, volume: 10 },      // пересвип 93.7 + защита той же свечой
		{ timestamp: 20, open: 94.5, high: 96, low: 94.4, close: 95.8, volume: 10 },
		{ timestamp: 21, open: 95.8, high: 101, low: 95.7, close: 100.8, volume: 10 },    // импульс вон из зоны
		...baseline(97, 22, 103, 0.4),                                                    // бездействие → попытка 1 умирает
		// Заход №2: лой 94.3, остановка, отскок, пересвип 94.25 (94.4-пост-свиповый pending) — исторический 93.7 в 0.55 от свипа при ATR~1.2
		{ timestamp: 119, open: 103, high: 103.2, low: 94.3, close: 95, volume: 10 },     // заход №2 (лой 94.3 < pending 94.4)
		{ timestamp: 120, open: 95, high: 95.6, low: 94.5, close: 95.2, volume: 10 },
		{ timestamp: 121, open: 95.2, high: 95.8, low: 94.6, close: 95, volume: 10 },
		{ timestamp: 122, open: 95, high: 95.7, low: 94.5, close: 95.4, volume: 10 },
		{ timestamp: 123, open: 95.4, high: 96, low: 94.8, close: 95.7, volume: 10 },     // остановка (тихо 4 бара)
		{ timestamp: 124, open: 95.7, high: 96.2, low: 95, close: 95.9, volume: 10 },
		{ timestamp: 125, open: 95.9, high: 96.4, low: 95.1, close: 96.1, volume: 10 },
		{ timestamp: 126, open: 96.1, high: 96.5, low: 95.3, close: 96.3, volume: 10 },
		{ timestamp: 127, open: 96.3, high: 96.6, low: 95.4, close: 96.2, volume: 10 },
		{ timestamp: 128, open: 96.2, high: 96.7, low: 95.5, close: 96.4, volume: 10 },
		{ timestamp: 129, open: 96.4, high: 96.8, low: 95.6, close: 96.5, volume: 10 },   // отскок (6 баров)
		{ timestamp: 130, open: 96.5, high: 96.6, low: 94.25, close: 94.8, volume: 10 },  // пересвип 94.25 (близко к 93.7)
		{ timestamp: 131, open: 94.8, high: 95.8, low: 94.6, close: 95.5, volume: 12 },   // защита + импульс
		{ timestamp: 132, open: 95.5, high: 95.7, low: 94.9, close: 95.1, volume: 5 },    // откатная
		{ timestamp: 133, open: 95.1, high: 95.5, low: 95, close: 95.4, volume: 15 },     // возобновление → вход
		{ timestamp: 134, open: 95.6, high: 101, low: 95.3, close: 100.5, volume: 10 },
	]
	const poi = makePoi()
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	const second = result!.attempts[1]
	assert.ok(second)
	assert.equal(second!.status, 'entered')
	// Стоп ниже исторического 93.7 (за структурой), а не сразу под свипом 94.25.
	assert.ok(second!.stop! < 93.7)
})

it('пометка «пришли на объёме»: объём HTF-бара захода против SMA20 предыдущих (диагностика, не фильтр)', () => {
	const ltf: Candle[] = [...baseline(7, 0, 110), ...fullLongSequence(0)]
	const htf: Candle[] = [
		...Array.from({ length: 20 }, (_, k) => ({ timestamp: -160 + k * 8, open: 110, high: 111, low: 109, close: 110, volume: 10 })),
		{ timestamp: 0, open: 110, high: 111, low: 93, close: 96, volume: 30 },
		{ timestamp: 8, open: 96, high: 101, low: 93, close: 100, volume: 10 },
		{ timestamp: 16, open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
	]
	const poi = makePoi()
	const [result] = detectPoiConfirmation([poi], ltf, htf)
	assert.ok(result)
	const attempt = result!.attempts[0]!
	assert.ok(attempt.arrivalVolumeRatio != null && Math.abs(attempt.arrivalVolumeRatio - 3) < 1e-9)
})
