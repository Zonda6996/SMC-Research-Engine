import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { Candle } from '../src/models/price/Candle.js'
import {
	computeGgiBands, detectGgiSignals, ggiStateAt,
	GGI_ZONE_PARAMS, GGI_ZONE_ENGINE_VERSION,
} from '../src/core/signals/GgiZoneEngine.js'

const bar = (ts: number, o: number, h: number, l: number, c: number): Candle =>
	({ timestamp: ts, open: o, high: h, low: l, close: c, volume: 10 })

it('GGI Zone: параметры вендора зафиксированы буквально', () => {
	assert.equal(GGI_ZONE_ENGINE_VERSION, 'ggi-zone-2.2-outer-edge-signal')
	assert.equal(GGI_ZONE_PARAMS.lookback, 200)
	assert.equal(GGI_ZONE_PARAMS.kInner, 5.6)
	assert.equal(GGI_ZONE_PARAMS.kOuter, 9.6)
	assert.equal(GGI_ZONE_PARAMS.meanType, 'ema')
	assert.equal(GGI_ZONE_PARAMS.devType, 'atr')
	assert.equal(GGI_ZONE_PARAMS.widthScale, 1)
	assert.equal(GGI_ZONE_PARAMS.signalMode, 'outer')
})

it('GGI Zone: полосы симметричны относительно средней и упорядочены', () => {
	// пила вокруг 100 — даёт ненулевое отклонение
	const c: Candle[] = []
	for (let i = 0; i < 300; i++) {
		const base = 100 + (i % 2 === 0 ? 1 : -1)
		c.push(bar(i, base, base + 1, base - 1, base))
	}
	const b = computeGgiBands(c, { lookback: 20 })
	const last = b[b.length - 1]!
	assert.ok(Number.isFinite(last.mean) && last.dev > 0)
	// inner = mean ± 5.6·dev, outer = mean ± 9.6·dev
	assert.ok(Math.abs(last.redLo - (last.mean + 5.6 * last.dev)) < 1e-9)
	assert.ok(Math.abs(last.greenHi - (last.mean - 5.6 * last.dev)) < 1e-9)
	assert.ok(Math.abs(last.redHi - (last.mean + 9.6 * last.dev)) < 1e-9)
	assert.ok(Math.abs(last.greenLo - (last.mean - 9.6 * last.dev)) < 1e-9)
	assert.ok(last.greenLo < last.greenHi && last.greenHi < last.mean)
	assert.ok(last.mean < last.redLo && last.redLo < last.redHi)
})

it('GGI Zone: источник цены — hlc3, а не close', () => {
	// одна серия со смещёнными фитилями: hlc3 отличается от close
	const c: Candle[] = []
	for (let i = 0; i < 60; i++) c.push(bar(i, 100, 110, 100, 100))
	const b = computeGgiBands(c, { lookback: 10, meanType: 'sma' })
	// hlc3 = (110 + 100 + 100)/3 = 103.33 — средняя должна стоять на нём, не на 100
	assert.ok(Math.abs(b[b.length - 1]!.mean - 103.3333) < 0.01)
})

it('GGI Zone: сигнал один на заход в зону, повтор только после возврата к средней', () => {
	// множители сужены намеренно: проверяется логика перевзведения, а не ширина полос вендора.
	// Прокол берём с большим запасом (50×dev), чтобы рост dev от самого прокола не «увёл» край.
	const P = { lookback: 10, kInner: 1, kOuter: 2, signalMode: 'inner' } as const
	const c: Candle[] = []
	for (let i = 0; i < 40; i++) c.push(bar(i, 100, 101, 99, 100))
	const dip = () => {
		const b = computeGgiBands(c, P)[c.length - 1]!
		const lo = b.mean - 50 * Math.max(b.dev, 0.1)
		c.push(bar(c.length, lo + 0.2, lo + 0.3, lo, lo + 0.1))
	}
	const longSigs = () => detectGgiSignals(c, P).filter((x) => x.at >= 40 && x.direction === 'long')
	dip(); dip(); dip()
	assert.equal(longSigs().length, 1, 'подряд идущие касания дают ОДИН сигнал')
	assert.equal(longSigs()[0]!.at, 40)
	// возврат ЗАКРЫТИЕМ выше средней перевзводит фильтр
	for (let k = 0; k < 40; k++) {
		const m = computeGgiBands(c, P)[c.length - 1]!.mean
		const p = m + 5
		c.push(bar(c.length, p, p + 1, p - 1, p))
	}
	dip()
	assert.equal(longSigs().length, 2, 'после возврата к средней сигнал взводится заново')
})

it('GGI Zone: шорт-сигнал зеркален лонгу', () => {
	const P = { lookback: 10, kInner: 1, kOuter: 2, signalMode: 'inner' } as const
	const c: Candle[] = []
	for (let i = 0; i < 40; i++) c.push(bar(i, 100, 101, 99, 100))
	const b = computeGgiBands(c, P)
	const edge = b[c.length - 1]!.redLo
	const hi = edge + Math.max(0.5, Math.abs(edge) * 0.001)
	c.push(bar(c.length, hi - 0.2, hi, hi - 0.2, hi - 0.1))
	const sigs = detectGgiSignals(c, P).filter((x) => x.at >= 40)
	assert.equal(sigs.length, 1)
	assert.equal(sigs[0]!.direction, 'short')
})

it('GGI Zone: состояние на баре по касанию внутренних краёв', () => {
	const b = { mean: 100, dev: 1, redLo: 105.6, redHi: 109.6, greenHi: 94.4, greenLo: 90.4 }
	assert.equal(ggiStateAt(bar(0, 100, 101, 94, 95), b), 'oversold')
	assert.equal(ggiStateAt(bar(0, 100, 106, 99, 105), b), 'overbought')
	assert.equal(ggiStateAt(bar(0, 100, 101, 99, 100), b), 'neutral')
	assert.equal(ggiStateAt(bar(0, 100, 101, 99, 100), { ...b, mean: NaN }), 'neutral')
})

it('GGI Zone: внешний край даёт сигнал реже внутреннего (канон вендора)', () => {
	// пила с усиливающимся размахом — цена достаёт то внутренний, то внешний край
	const c: Candle[] = []
	for (let i = 0; i < 400; i++) {
		const amp = 1 + (i % 50) * 0.4
		const p = 100 + (i % 2 ? amp : -amp)
		c.push(bar(i, p, p + amp, p - amp, p))
	}
	const inner = detectGgiSignals(c, { lookback: 20, signalMode: 'inner' })
	const outer = detectGgiSignals(c, { lookback: 20, signalMode: 'outer' })
	assert.ok(outer.length <= inner.length, 'внешний край не может срабатывать чаще внутреннего')
})
