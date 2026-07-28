import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { Candle } from '../src/models/price/Candle.js'
import type { LiquidityPoiCandidate } from '../src/core/confirmation/LiquidityPoiCalibration.js'
import type { StructureEvent } from '../src/models/events/StructureEvent.js'
import {
	detectSimplifiedConfirmation, SIMPLIFIED_CONFIRMATION_VERSION, SIMPLIFIED_HIGH_WR_PRESET,
	buildRegimeTimeline, regimeAt, SIMPLIFIED_CONFIRMATION_CONFIG,
} from '../src/core/confirmation/SimplifiedConfirmationEngine.js'

function makePoi(overrides: Partial<LiquidityPoiCandidate> = {}): LiquidityPoiCandidate {
	return {
		id: 'poi-test', version: 'test', direction: 'long', zoneClass: 'liquidity-shelf',
		anchorId: 'a', componentAnchorIds: ['a'], componentClasses: ['liquidity-shelf'],
		originAt: 0, knownAt: 0, near: 100, far: 90, atr: 4, boundarySource: 'liquidity-cluster',
		liquidityBands: [], pivotCount: 1, pivotPrices: [100], pivotTimes: [0], eventType: null,
		pdZone: 'none', pdAligned: null, lifecycleState: 'fresh', valid: true, active: true,
		priority: 'nearest', interaction: 'untouched', touchCount: 0, armedAt: 0, firstTouchAt: null,
		consumedAt: null, failedAt: null, spentAt: null, spentReason: null, duplicateOf: null, retiredAt: null,
		stackNotional: 0, stackShare: 1, geometryKnownAt: 0, lineageSupersededAt: null,
		supersededAt: null, invalidatedAt: null, endAt: 1_000_000, mergedCount: 0, suppressedCount: 0,
		...overrides,
	}
}
const bar = (ts: number, o: number, h: number, l: number, c: number): Candle => ({ timestamp: ts, open: o, high: h, low: l, close: c, volume: 10 })
const away = (n: number, start: number) => Array.from({ length: n }, (_, k) => bar(start + k, 110, 111, 109, 110)) // выше зоны → взводит

it('simplified v0.1: касание → первая направленная свеча → вход; частичка → БУ → фулл', () => {
	assert.equal(SIMPLIFIED_CONFIRMATION_VERSION, 'simplified-confirmation-0.3-r-targets')
	const ltf: Candle[] = [
		...away(7, 0),
		bar(7, 105, 106, 95, 94),        // заход в зону, МЕДВЕЖЬЯ — не триггер
		bar(8, 94, 100.1, 93, 100),      // направленная бычья → ВХОД по close=100
		bar(9, 100, 108, 99, 107.6),     // +7.5% (107.5) → PARTIAL, стоп в БУ
		bar(10, 107.6, 118, 106, 117.6), // +17.5% (117.5) → FULL
		bar(11, 117.6, 118, 117, 117.7),
	]
	const [r] = detectSimplifiedConfirmation([makePoi()], ltf)
	assert.equal(r!.entries.length, 1)
	const e = r!.entries[0]!
	assert.equal(e.entryAt, 8)
	assert.equal(e.entry, 100)
	assert.equal(e.outcome, 'full')
	assert.deepEqual(e.events.map(x => x.state), ['PARTIAL', 'FULL'])
	// grossMovePct = 7.5%×0.5 + 17.5%×0.5 = 12.5% хода
	assert.ok(Math.abs(e.grossMovePct! - 0.125) < 1e-9)
	// стоп far-режима: far 90 − 0.25×poi.atr(4) = 89; grossR = 12.5/11 ≈ 1.136
	assert.ok(Math.abs(e.stop - 89) < 1e-9)
	assert.ok(Math.abs(e.grossR! - (0.125 * 100) / 11) < 1e-6)
})

it('simplified: стоп до частички = −1R всей позицией; rearm даёт новый вход, once — нет', () => {
	const seq: Candle[] = [
		...away(7, 0),
		bar(7, 105, 106, 95, 96),      // заход, медвежья — ждём
		bar(8, 96, 101, 95, 100.5),    // бычья → ВХОД 100.5
		bar(9, 100.5, 101, 88.9, 89),  // пробой до 88.9 < стопа 89 → STOP
		...away(7, 10),                 // полный отход → перевзвод
		bar(17, 96, 106, 95, 100),     // заход БЫЧЬЕЙ свечой → сразу ВХОД 100 (rearm)
		bar(18, 100, 118, 99, 117.6),  // частичка (107.5); фулл не в этом баре
		bar(19, 117.6, 118, 117, 117.8),
	]
	const [rearm] = detectSimplifiedConfirmation([makePoi()], seq)
	assert.equal(rearm!.entries.length, 2)
	assert.equal(rearm!.entries[0]!.outcome, 'stop')
	assert.ok(Math.abs(rearm!.entries[0]!.grossR! - -1) < 1e-9)
	const [once] = detectSimplifiedConfirmation([makePoi()], seq, { reentry: 'once' })
	assert.equal(once!.entries.length, 1)
})

it('simplified: pct-стоп от цены входа; БУ после частички возвращает 3.75% хода', () => {
	const ltf: Candle[] = [
		...away(7, 0),
		bar(7, 96, 106, 95, 100),       // заход БЫЧЬЕЙ → ВХОД 100
		bar(8, 100, 108, 99, 107.6),    // PARTIAL (107.5), стоп → БУ (100)
		bar(9, 107.6, 110, 99.9, 100.2),// возврат к 100 → BE
		bar(10, 100.2, 101, 100, 100.5),
	]
	const [r] = detectSimplifiedConfirmation([makePoi()], ltf, { stopMode: 'pct', stopPct: 0.1 })
	const e = r!.entries[0]!
	assert.equal(e.stopMode, 'pct')
	assert.ok(Math.abs(e.stop - 90) < 1e-9) // 100 × (1−0.10)
	assert.equal(e.outcome, 'be')
	assert.ok(Math.abs(e.grossMovePct! - 0.0375) < 1e-9) // 7.5% × 0.5
	assert.deepEqual(e.events.map(x => x.state), ['PARTIAL', 'BE'])
})

it('simplified: консервативная внутрибарная неоднозначность — стоп раньше цели; фулл = зона отработана', () => {
	const ltf: Candle[] = [
		...away(7, 0),
		bar(7, 96, 106, 95, 100),       // вход 100 (стоп far 89)
		bar(8, 100, 108, 88, 107),      // бар накрыл и частичку (107.5 ≤ high 108), и стоп 89 → СТОП
		...away(7, 9),
		bar(16, 96, 106, 95, 100),      // новый вход (rearm)
		bar(17, 100, 120, 99, 118),     // частичка
		bar(18, 118, 120, 117, 119),    // фулл
		...away(7, 19),
		bar(26, 96, 106, 95, 100),      // зона отработана фуллом — входа быть не должно
	]
	const [r] = detectSimplifiedConfirmation([makePoi()], ltf)
	assert.equal(r!.entries[0]!.outcome, 'stop')
	assert.equal(r!.entries.length, 2) // после фулла зона не торгуется
	assert.equal(r!.entries[1]!.outcome, 'full')
})

it('simplified: SHORT зеркален; вход после endAt зоны не берётся', () => {
	const mirror = (b: Candle): Candle => ({ timestamp: b.timestamp, open: 200 - b.open, high: 200 - b.low, low: 200 - b.high, close: 200 - b.close, volume: b.volume })
	const ltfLong: Candle[] = [
		...away(7, 0),
		bar(7, 96, 106, 95, 100),
		bar(8, 100, 108, 99, 107.6),
		bar(9, 107.6, 118, 106, 117.6),
	]
	const ltfShort = ltfLong.map(mirror)
	const [s] = detectSimplifiedConfirmation([makePoi({ direction: 'short', near: 100, far: 110 })], ltfShort)
	assert.equal(s!.entries.length, 1)
	assert.equal(s!.entries[0]!.outcome, 'full')
	// endAt = 5: касание на ts7 уже вне окна — входов нет
	const [ended] = detectSimplifiedConfirmation([makePoi({ endAt: 5 })], ltfLong)
	assert.equal(ended!.entries.length, 0)
})

// ─────────────────────────── v0.3 (§16.26) ───────────────────────────

const ev = (type: 'bos' | 'choch', direction: 'up' | 'down', at: number): StructureEvent => ({
	type, direction, levelPrice: 100, levelType: direction === 'up' ? 'high' : 'low', levelIndex: 0,
	levelLabel: 'HH', breachIndex: 0, breachTimestamp: at, confirmIndex: 0, confirmTimestamp: at,
	sweptBefore: false, sweptDepth: 0, oppositeSweptBefore: false,
})

it('v0.3: дефолты сохраняют поведение v0.1 (цели в % цены), targetMode=r считает цели от риска', () => {
	// тот же сценарий, что в первом тесте: вход 100, стоп far 89 → риск 11 = 11% цены
	const ltf: Candle[] = [
		...away(7, 0),
		bar(7, 96, 106, 95, 100),        // ВХОД 100, стоп 89
		bar(8, 100, 104.5, 99, 104.4),   // +0.4R = 100 + 0.4×11 = 104.4 → PARTIAL, стоп в БУ
		bar(9, 104.4, 106, 99.9, 100.1), // возврат в БУ → BE
	]
	const [r] = detectSimplifiedConfirmation([makePoi()], ltf, { targetMode: 'r', partialAtR: 0.4, fullAtR: 12, partialFraction: 0.25 })
	const e = r!.entries[0]!
	assert.equal(e.outcome, 'be')
	assert.ok(Math.abs(e.partialPrice - 104.4) < 1e-9)
	// БУ-исход = частичка × доля = 0.4R × 0.25 = 0.1R; в долях хода 0.1 × 11% = 1.1%
	assert.ok(Math.abs(e.grossMovePct! - 0.011) < 1e-9)
	assert.ok(Math.abs(e.grossR! - 0.1) < 1e-9)
})

it('v0.3: фильтр «без погони» пропускает вход, убежавший от края зоны', () => {
	const ltf: Candle[] = [
		...away(7, 0),
		bar(7, 96, 106, 95, 105),   // заход и закрытие в 105: |105 − near 100| / atr 4 = 1.25 ATR
		bar(8, 105, 106, 104, 105.5),
	]
	// без фильтра вход есть
	assert.equal(detectSimplifiedConfirmation([makePoi()], ltf)[0]!.entries.length, 1)
	// с порогом 1.0 ATR — вход отброшен
	assert.equal(detectSimplifiedConfirmation([makePoi()], ltf, { maxChaseAtr: 1.0 })[0]!.entries.length, 0)
	// с порогом 2.0 ATR — снова проходит
	assert.equal(detectSimplifiedConfirmation([makePoi()], ltf, { maxChaseAtr: 2.0 })[0]!.entries.length, 1)
})

it('v0.3: тренд по правилу bos-bos-choch, регион на баре подтверждения', () => {
	const tl = buildRegimeTimeline([ev('bos', 'up', 10), ev('bos', 'up', 20), ev('choch', 'down', 30), ev('bos', 'down', 40)])
	assert.equal(regimeAt(tl, 5), 'range')   // до событий
	assert.equal(regimeAt(tl, 10), 'range')  // один BOS — ещё не тренд
	assert.equal(regimeAt(tl, 20), 'up')     // два BOS вверх — тренд вверх
	assert.equal(regimeAt(tl, 30), 'range')  // CHoCH сбрасывает
	assert.equal(regimeAt(tl, 45), 'range')  // один BOS вниз — ещё не тренд
})

it('v0.3: тренд-фильтр блокирует лонг в тренде вниз и требует тренда в режиме onlyWith', () => {
	const ltf: Candle[] = [
		...away(7, 0),
		bar(7, 96, 106, 95, 100),
		bar(8, 100, 108, 99, 107.6),
		bar(9, 107.6, 118, 106, 117.6),
	]
	const down = [ev('bos', 'down', 1), ev('bos', 'down', 2)]
	const up = [ev('bos', 'up', 1), ev('bos', 'up', 2)]
	// лонг против тренда вниз — заблокирован
	assert.equal(detectSimplifiedConfirmation([makePoi()], ltf, { trendFilter: 'notAgainst' }, { events: down })[0]!.entries.length, 0)
	// в тренде вверх — проходит
	assert.equal(detectSimplifiedConfirmation([makePoi()], ltf, { trendFilter: 'notAgainst' }, { events: up })[0]!.entries.length, 1)
	// боковик: notAgainst разрешает, onlyWith запрещает
	assert.equal(detectSimplifiedConfirmation([makePoi()], ltf, { trendFilter: 'notAgainst' }, { events: [] })[0]!.entries.length, 1)
	assert.equal(detectSimplifiedConfirmation([makePoi()], ltf, { trendFilter: 'onlyWith' }, { events: [] })[0]!.entries.length, 0)
})

it('v0.3: пресет высокого вин рейта не трогает канонические дефолты', () => {
	assert.equal(SIMPLIFIED_HIGH_WR_PRESET.targetMode, 'r')
	assert.equal(SIMPLIFIED_HIGH_WR_PRESET.partialAtR, 0.40)
	assert.equal(SIMPLIFIED_HIGH_WR_PRESET.partialFraction, 0.25)
	assert.equal(SIMPLIFIED_HIGH_WR_PRESET.fullAtR, 12)
	assert.equal(SIMPLIFIED_HIGH_WR_PRESET.maxChaseAtr, 1.0)
	// дефолты движка остались v0.1-совместимыми
	assert.equal(SIMPLIFIED_CONFIRMATION_CONFIG.targetMode, 'pct')
	assert.equal(SIMPLIFIED_CONFIRMATION_CONFIG.maxChaseAtr, 0)
	assert.equal(SIMPLIFIED_CONFIRMATION_CONFIG.trendFilter, 'off')
	assert.equal(SIMPLIFIED_CONFIRMATION_CONFIG.partialAtMovePct, 0.075)
	assert.equal(SIMPLIFIED_CONFIRMATION_CONFIG.fullAtMovePct, 0.175)
})
