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
		consumedAt: null, failedAt: null, spentAt: null, spentReason: null, retiredAt: null,
		geometryKnownAt: 0, lineageSupersededAt: null,
		supersededAt: null, invalidatedAt: null, endAt: 1000, mergedCount: 0, suppressedCount: 0,
		...overrides,
	}
}

// Заход в зону [90,100] сверху → остановка (зелёная) → отскок → пересвип лоя → защита →
// импульс → откатная свеча (v5) → возобновление (v15 > 5, тест слабости) → вход → TP2.
const fullLongSequence = (offset = 0): Candle[] => [
	{ timestamp: offset + 7, open: 105, high: 106, low: 95, close: 96, volume: 10 },
	{ timestamp: offset + 8, open: 96, high: 97, low: 90, close: 91, volume: 10 },
	{ timestamp: offset + 9, open: 91, high: 95, low: 90.5, close: 94, volume: 10 },
	{ timestamp: offset + 10, open: 94, high: 98, low: 93.5, close: 97, volume: 10 },
	{ timestamp: offset + 11, open: 97, high: 99, low: 96, close: 98, volume: 10 },
	{ timestamp: offset + 12, open: 98, high: 99, low: 97, close: 97.5, volume: 10 },
	{ timestamp: offset + 13, open: 97.5, high: 98, low: 88, close: 89, volume: 10 },
	{ timestamp: offset + 14, open: 89, high: 93, low: 88.5, close: 92, volume: 10 },
	{ timestamp: offset + 15, open: 92, high: 97, low: 91, close: 96, volume: 20 },
	{ timestamp: offset + 16, open: 96, high: 96.5, low: 94, close: 95, volume: 5 },
	{ timestamp: offset + 17, open: 95, high: 99, low: 94.5, close: 98, volume: 15 },
	{ timestamp: offset + 18, open: 98, high: 105, low: 96, close: 104, volume: 10 },
	{ timestamp: offset + 19, open: 104, high: 112, low: 102, close: 110, volume: 10 },
	{ timestamp: offset + 20, open: 110, high: 122, low: 108, close: 119, volume: 10 },
	{ timestamp: offset + 21, open: 119.5, high: 120, low: 118, close: 119.5, volume: 10 },
	{ timestamp: offset + 22, open: 119.5, high: 120, low: 118, close: 119.5, volume: 10 },
	{ timestamp: offset + 23, open: 119.5, high: 120, low: 118, close: 119.5, volume: 10 },
	{ timestamp: offset + 24, open: 119.5, high: 120, low: 118, close: 119.5, volume: 10 },
]

const baseline = (n: number, start: number, price: number, range = 1): Candle[] =>
	Array.from({ length: n }, (_, k) => ({ timestamp: start + k, open: price, high: price + range, low: price - range, close: price - 0.5 * range, volume: 10 }))

/** Зеркало последовательности вокруг 100: лонг-фикстура превращается в шорт (зона [100,110]). */
const mirror = (bars: Candle[]): Candle[] => bars.map(b => ({
	timestamp: b.timestamp, open: 200 - b.open, high: 200 - b.low, low: 200 - b.high, close: 200 - b.close, volume: b.volume,
}))

it('версия заморожена; пустой вход — пустой выход', () => {
	assert.equal(POI_CONFIRMATION_VERSION, 'poi-confirmation-1.3-unified-window')
	assert.deepEqual(detectPoiConfirmation([], []), [])
})

it('полная LONG-последовательность: заход → остановка → отскок → пересвип → защита → тест слабости → вход → TP2', () => {
	const ltf: Candle[] = [...baseline(7, 0, 150), ...fullLongSequence(0)]
	const poi = makePoi({ near: 100, far: 90, knownAt: 0, endAt: 1000 })
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.ltfCoverage, 'full')
	assert.equal(result!.attempts.length, 1)
	const attempt = result!.attempts[0]!
	assert.equal(attempt.status, 'entered')
	assert.equal(attempt.rejectionReason, null)
	assert.equal(attempt.outcome, 'tp')
	assert.equal(attempt.grossR, 2)
	// Пересвип снял самый глубокий экстремум зоны за окно (88 < 90) — QA-пометка.
	assert.equal(attempt.sweptZoneExtreme, true)
	// Без HTF-свечей объём прихода не считается.
	assert.equal(attempt.arrivalVolumeRatio, null)
	assert.deepEqual(attempt.trace.map(t => t.state),
		['POI_TOUCH', 'STOP_CONFIRMED', 'REBOUND', 'SECOND_SWEEP', 'PROTECTED', 'WEAKNESS_TEST', 'ENTRY', 'TP2'])
	// Решение №10: tp-hit — зона отработала, окно подтверждения закрыто на тейке.
	assert.equal(result!.spentReason, 'tp-hit')
})

it('SHORT-зеркало полной последовательности отрабатывает симметрично', () => {
	const ltf = mirror([...baseline(7, 0, 150), ...fullLongSequence(0)])
	const poi = makePoi({ direction: 'short', near: 100, far: 110, knownAt: 0, endAt: 1000 })
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.attempts.length, 1)
	const attempt = result!.attempts[0]!
	assert.equal(attempt.status, 'entered')
	assert.equal(attempt.outcome, 'tp')
	assert.deepEqual(attempt.trace.map(t => t.state),
		['POI_TOUCH', 'STOP_CONFIRMED', 'REBOUND', 'SECOND_SWEEP', 'PROTECTED', 'WEAKNESS_TEST', 'ENTRY', 'TP2'])
})

it('катящийся перезапуск (§16.8): глубокий заход без остановки не сжигает попытку — вход из одного касания', () => {
	// Старый движок отбраковывал первое касание по no-stopping (30-барный лимит) и требовал новое
	// касание. Новый ведёт ОДНУ попытку через весь заход до входа (лимиты этапов заменены таймаутом).
	const ltf: Candle[] = [
		...baseline(7, 0, 150),
		{ timestamp: 7, open: 105, high: 106, low: 95, close: 96, volume: 10 },
		...baseline(30, 8, 245),
		...fullLongSequence(31),
	]
	const poi = makePoi({ near: 100, far: 90, knownAt: 0, endAt: 1000 })
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.attempts.length, 1)
	const attempt = result!.attempts[0]!
	assert.equal(attempt.status, 'entered')
	assert.equal(attempt.outcome, 'tp')
	assert.equal(result!.spentReason, 'tp-hit')
})

it('после tp-hit зона отработала: повторные касания попыток не создают (решение №10)', () => {
	const ltf: Candle[] = [
		...baseline(7, 0, 150),
		...fullLongSequence(0),
		...baseline(10, 25, 150),               // полный отход (re-arm выполнен)
		{ timestamp: 35, open: 105, high: 106, low: 95, close: 96, volume: 10 }, // повторный заход в зону
		...baseline(10, 36, 150),
	]
	const poi = makePoi({ near: 100, far: 90, knownAt: 0, endAt: 1000 })
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.attempts.length, 1)
	assert.equal(result!.spentReason, 'tp-hit')
	const tpAt = result!.attempts[0]!.trace.find(t => t.state === 'TP2')!.at
	assert.equal(result!.endAt, tpAt)
})

it('ATR-fallback зоны подтверждением не торгуются (решение №6)', () => {
	const ltf: Candle[] = [...baseline(7, 0, 150), ...fullLongSequence(0)]
	const poi = makePoi({ boundarySource: 'atr-calibration' })
	assert.deepEqual(detectPoiConfirmation([poi], ltf), [])
})

it('окно [knownAt, endAt): после конца окна зоны попыток нет', () => {
	const ltf: Candle[] = [...baseline(7, 0, 150), ...fullLongSequence(0)]
	const poi = makePoi({ near: 100, far: 90, knownAt: 0, endAt: 3 })
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.attempts.length, 0)
	assert.equal(result!.knownAt, 0)
	assert.equal(result!.endAt, 3)
})

it('15m-история не покрывает окно зоны → ltfCoverage none, ноль попыток (данные, не логика)', () => {
	const ltf: Candle[] = baseline(20, 1000, 95) // история начинается ПОСЛЕ конца окна зоны
	const poi = makePoi({ near: 100, far: 90, knownAt: 0, endAt: 500 })
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.ltfCoverage, 'none')
	assert.equal(result!.attempts.length, 0)
})

it('таймаут попытки: нет остановки за attemptTimeoutBars → timeout@stopping', () => {
	// Касание, затем 120 красных баров у зоны без единого зелёного закрытия.
	const ltf: Candle[] = [
		...baseline(7, 0, 150),
		{ timestamp: 7, open: 105, high: 106, low: 95, close: 96, volume: 10 },
		...baseline(120, 8, 99, 0.4),
	]
	const poi = makePoi({ near: 100, far: 90, knownAt: 0, endAt: 10_000 })
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.attempts.length, 1)
	assert.equal(result!.attempts[0]!.status, 'rejected')
	assert.equal(result!.attempts[0]!.rejectionReason, 'timeout@stopping')
})

it('защита (решение №12): две close ниже лоя, но внутри зоны → перезапуск от нового экстремума, не отбраковка', () => {
	const ltf: Candle[] = [
		...baseline(7, 0, 150),
		// Заход и остановка: лой попытки 95.
		{ timestamp: 7, open: 105, high: 106, low: 95, close: 96, volume: 10 },
		{ timestamp: 8, open: 96, high: 99, low: 95.5, close: 98, volume: 10 },  // остановка (зелёная), лой 95
		{ timestamp: 9, open: 98, high: 101, low: 97, close: 100, volume: 10 },  // отскок ≥ 0.5 ATR
		// Пересвип 95 и ДВЕ красные close ниже лоя, но внутри зоны (> far 90) → перезапуск.
		{ timestamp: 10, open: 100, high: 100, low: 93, close: 94, volume: 10 },
		{ timestamp: 11, open: 94, high: 95, low: 92.5, close: 93, volume: 10 },
		// Новая остановка от экстремума 92.5 → отскок → пересвип → защита → тест → вход.
		{ timestamp: 12, open: 93, high: 96, low: 92.8, close: 95.5, volume: 10 }, // остановка
		{ timestamp: 13, open: 95.5, high: 98.5, low: 95, close: 98, volume: 10 }, // отскок
		{ timestamp: 14, open: 98, high: 98, low: 92, close: 93, volume: 10 },     // пересвип 92.5
		{ timestamp: 15, open: 93, high: 96, low: 92.8, close: 95, volume: 12 },   // защита + импульс
		{ timestamp: 16, open: 95, high: 95.5, low: 94, close: 94.2, volume: 5 },  // откатная
		{ timestamp: 17, open: 94.2, high: 97, low: 94, close: 96.5, volume: 15 }, // возобновление (15 > 5)
		{ timestamp: 18, open: 96.5, high: 104, low: 96, close: 103, volume: 10 },
		{ timestamp: 19, open: 103, high: 110, low: 102, close: 109, volume: 10 },
	]
	const poi = makePoi({ near: 100, far: 90, knownAt: 0, endAt: 1000 })
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.attempts.length, 1)
	const attempt = result!.attempts[0]!
	assert.ok(attempt.trace.some(t => t.state === 'RESTART'))
	assert.equal(attempt.status, 'entered')
})

it('защита (решение №12): две close ЗА дальней границей → broke-below-zone', () => {
	const ltf: Candle[] = [
		...baseline(7, 0, 150),
		{ timestamp: 7, open: 105, high: 106, low: 95, close: 96, volume: 10 },
		{ timestamp: 8, open: 96, high: 99, low: 95.5, close: 98, volume: 10 },   // остановка, лой 95
		{ timestamp: 9, open: 98, high: 101, low: 97, close: 100, volume: 10 },   // отскок
		{ timestamp: 10, open: 100, high: 100, low: 88, close: 89, volume: 10 },  // пересвип и close ниже far 90
		{ timestamp: 11, open: 89, high: 89.5, low: 87, close: 88, volume: 10 },  // вторая close ниже far
		...baseline(10, 12, 87, 0.4),
	]
	const poi = makePoi({ near: 100, far: 90, knownAt: 0, endAt: 1000 })
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	assert.equal(result!.attempts.length, 1)
	assert.equal(result!.attempts[0]!.status, 'rejected')
	assert.equal(result!.attempts[0]!.rejectionReason, 'broke-below-zone')
})

it('тест слабости (решение №13): возобновление слабее последней откатной — входа нет, ждём следующий', () => {
	const ltf: Candle[] = [
		...baseline(7, 0, 150),
		{ timestamp: 7, open: 105, high: 106, low: 95, close: 96, volume: 10 },
		{ timestamp: 8, open: 96, high: 97, low: 90, close: 91, volume: 10 },
		{ timestamp: 9, open: 91, high: 95, low: 90.5, close: 94, volume: 10 },   // остановка, лой 90
		{ timestamp: 10, open: 94, high: 98, low: 93.5, close: 97, volume: 10 },  // отскок
		{ timestamp: 11, open: 97, high: 98, low: 88, close: 89, volume: 10 },    // пересвип
		{ timestamp: 12, open: 89, high: 93, low: 88.5, close: 92, volume: 10 },  // защита
		{ timestamp: 13, open: 92, high: 97, low: 91, close: 96, volume: 20 },    // импульс
		{ timestamp: 14, open: 96, high: 96.5, low: 94, close: 95, volume: 8 },   // откатная (v8)
		{ timestamp: 15, open: 95, high: 97, low: 94.5, close: 96.5, volume: 5 }, // возобновление v5 < 8 → НЕ вход
		{ timestamp: 16, open: 96.5, high: 97, low: 95, close: 95.5, volume: 4 }, // откатная (v4)
		{ timestamp: 17, open: 95.5, high: 99, low: 95, close: 98, volume: 15 },  // возобновление v15 > 4 → вход
		{ timestamp: 18, open: 98, high: 105, low: 96, close: 104, volume: 10 },
		{ timestamp: 19, open: 104, high: 120, low: 102, close: 118, volume: 10 },
	]
	const poi = makePoi({ near: 100, far: 90, knownAt: 0, endAt: 1000 })
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	const attempt = result!.attempts[0]!
	assert.equal(attempt.status, 'entered')
	assert.equal(attempt.entryAt, 17)
	const test = attempt.trace.find(t => t.state === 'WEAKNESS_TEST')!
	assert.equal(test.at, 16) // тест — последняя откатная перед фактическим входом
})

it('отмена входа (решение №3): риск больше entryMaxRiskAtr×ATR — ENTRY_CANCELLED, попытка живёт', () => {
	const tight = (n: number, start: number, price: number): Candle[] => baseline(n, start, price, 0.2)
	const ltf: Candle[] = [
		...tight(14, 0, 103),
		{ timestamp: 14, open: 103, high: 103, low: 99.5, close: 99.8, volume: 10 }, // заход
		{ timestamp: 15, open: 99.8, high: 100.4, low: 99.6, close: 100.3, volume: 10 }, // остановка, лой 99.5
		{ timestamp: 16, open: 100.3, high: 100.8, low: 100.1, close: 100.6, volume: 10 }, // отскок (диапазоны ~0.2 ATR)
		{ timestamp: 17, open: 100.6, high: 100.7, low: 99.3, close: 99.6, volume: 10 },  // пересвип 99.5
		{ timestamp: 18, open: 99.6, high: 100.2, low: 99.4, close: 100.1, volume: 12 },  // защита + импульс
		{ timestamp: 19, open: 100.1, high: 100.3, low: 99.8, close: 99.9, volume: 5 },   // откатная
		// Возобновление-монстр: close улетел на 15 пунктов — риск >> 1.5×ATR → отмена входа.
		{ timestamp: 20, open: 99.9, high: 115, low: 99.8, close: 114.5, volume: 15 },
		...tight(10, 21, 114),
	]
	const poi = makePoi({ near: 100, far: 90, knownAt: 0, endAt: 1000 })
	const [result] = detectPoiConfirmation([poi], ltf)
	assert.ok(result)
	const attempt = result!.attempts[0]!
	assert.ok(attempt.trace.some(t => t.state === 'ENTRY_CANCELLED'))
	assert.equal(attempt.status, 'rejected')
	assert.ok(attempt.trace.every(t => t.state !== 'ENTRY'))
})

it('пометка «пришли на объёме»: объём HTF-бара захода против SMA20 предыдущих (диагностика, не фильтр)', () => {
	const ltf: Candle[] = [...baseline(7, 0, 150), ...fullLongSequence(0)]
	// HTF-бары по 8 тиков: заход (ts=7) попадает в бар [0..8) — его объём 30 против SMA 10.
	const htf: Candle[] = [
		...Array.from({ length: 20 }, (_, k) => ({ timestamp: -160 + k * 8, open: 150, high: 151, low: 149, close: 150, volume: 10 })),
		{ timestamp: 0, open: 150, high: 151, low: 88, close: 96, volume: 30 },
		{ timestamp: 8, open: 96, high: 122, low: 88, close: 119, volume: 10 },
	]
	const poi = makePoi({ near: 100, far: 90, knownAt: 0, endAt: 1000 })
	const [result] = detectPoiConfirmation([poi], ltf, htf)
	assert.ok(result)
	const attempt = result!.attempts[0]!
	assert.ok(attempt.arrivalVolumeRatio != null && Math.abs(attempt.arrivalVolumeRatio - 3) < 1e-9)
})
