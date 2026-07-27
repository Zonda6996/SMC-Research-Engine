import assert from 'node:assert/strict'
import { it } from 'node:test'
import { computeGgiZone, ggiStateAt, GGI_ZONE_CONFIG, GGI_ZONE_VERSION } from '../tools/shared/ggiZone.js'
import type { Candle } from '../src/models/price/Candle.js'

const bar = (ts: number, c: number): Candle => ({ timestamp: ts, open: c, high: c + 1, low: c - 1, close: c, volume: 1 })

it('ggi: версия и структура; на плоском ряду mean = цене, зоны симметричны и сужаются', () => {
	assert.equal(GGI_ZONE_VERSION, 'ggi-zone-approx-0.1')
	const flat = Array.from({ length: 400 }, (_, k) => bar(k, 100))
	const g = computeGgiZone(flat)
	const last = g.at(-1)!
	assert.ok(Math.abs(last.meanV - 100) < 1e-6)
	// dev → 0 на плоском ряду; зоны прилипают к mean симметрично
	assert.ok(Math.abs((last.redLo - 100) + (last.greenHi - 100)) < 1e-6)
	assert.ok(last.redHi >= last.redLo && last.greenLo <= last.greenHi)
	// отношение внешнего края к внутреннему = kOuter/kInner (по построению; на ряду с движением dev>0)
	const trend = Array.from({ length: 400 }, (_, k) => bar(k, 100 + k * 0.3 + (k % 7)))
	const gt = computeGgiZone(trend)
	const mid = gt[300]!
	assert.ok(Math.abs((mid.redHi - mid.meanV) / (mid.redLo - mid.meanV) - GGI_ZONE_CONFIG.kOuter / GGI_ZONE_CONFIG.kInner) < 1e-6)
})

it('ggi: состояние бара — перепродан у зелёной зоны, перекуплен у красной, нейтрально в середине', () => {
	// рост, затем провал глубоко под mean → low уходит в зелёную зону
	const xs = [...Array.from({ length: 300 }, (_, k) => bar(k, 100 + k * 0.1)), ...Array.from({ length: 5 }, (_, k) => bar(300 + k, 100))]
	const g = computeGgiZone(xs)
	const i = xs.length - 1
	assert.equal(ggiStateAt(xs[i]!, g[i]!), 'oversold')
	assert.equal(ggiStateAt(bar(0, g[i]!.meanV), g[i]!), 'neutral')
	assert.equal(ggiStateAt({ ...bar(0, g[i]!.redLo + 1), high: g[i]!.redLo + 2 }, g[i]!), 'overbought')
})
