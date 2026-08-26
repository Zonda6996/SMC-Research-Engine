// Тесты ядра Doppler: синтетические сценарии + паритет со старой inline-логикой раннеров.
import test from 'node:test'
import assert from 'node:assert/strict'
import { detectDopplerCascades, simulateDopplerTrade, DOPPLER_MODE_PRESETS } from '../src/core/signals/DopplerEngine.js'
import { arrowAtr200 } from '../src/core/signals/ArrowSignalEngine.js'
import type { Candle } from '../src/models/price/Candle.js'

const CFG = { oiDrop: -0.15, priceDrop: -0.05, windowBars: 8, gapBars: 8, holdBars: 72, stopAtrMult: 0.5 }

function makeCandles(closes: number[]): Candle[] {
	return closes.map((c, i) => ({ timestamp: i * 3_600_000, open: i === 0 ? c : closes[i - 1]!, high: Math.max(c, closes[i - 1] ?? c) * 1.001, low: Math.min(c, closes[i - 1] ?? c) * 0.999, close: c, volume: 1000 }))
}

function rng(seed: number): () => number {
	let x = seed >>> 0
	return () => {
		x += 0x6d2b79f5
		let t = x
		t = Math.imul(t ^ t >>> 15, t | 1)
		t ^= t + Math.imul(t ^ t >>> 7, t | 61)
		return ((t ^ t >>> 14) >>> 0) / 4_294_967_296
	}
}

test('Doppler: каскад детектируется на ожидаемом баре, стоп = флаш − 0.5×ATR200', () => {
	const closes: number[] = []
	for (let i = 0; i < 300; i++) closes.push(100)
	// Каскад: бары 200..207 — цена и «OI» падают на −6% за бар (итого ≈ −39% за окно).
	for (let i = 200; i <= 210; i++) closes[i] = closes[i - 1]! * 0.94
	for (let i = 211; i < 300; i++) closes[i] = closes[i - 1]! * 1.001
	const candles = makeCandles(closes)
	const oi: Array<number | null> = candles.map((_, i) => (i < 200 ? 1000 : Math.max(1000 * 0.94 ** Math.max(0, i - 199), 500)))
	const atr200 = arrowAtr200(candles)
	const events = detectDopplerCascades(candles, oi, atr200, CFG)
	assert.ok(events.length >= 1, 'событие должно детектироваться')
	const first = events[0]!
	assert.equal(first.index >= 200, true)
	const windowLow = Math.min(...candles.slice(first.index - 7, first.index + 1).map((c) => c.low))
	assert.ok(Math.abs(first.stop - (windowLow - 0.5 * first.atr)) < 1e-9, 'стоп = флаш − 0.5×ATR')
	assert.equal(first.entryIndex, first.index + 1)
	assert.equal(first.entryOpen, candles[first.index + 1]!.open)
	// Min-gap: второе событие не ближе 8 баров к первому
	for (let k = 1; k < events.length; k++) assert.ok(events[k]!.index - events[k - 1]!.index >= CFG.gapBars)
})

test('Doppler: без просадки OI событий нет', () => {
	const closes: number[] = []
	for (let i = 0; i < 300; i++) closes.push(100 * 0.94 ** Math.max(0, i - 200))
	const candles = makeCandles(closes)
	const oi: Array<number | null> = candles.map(() => 1000)
	const events = detectDopplerCascades(candles, oi, arrowAtr200(candles), CFG)
	assert.equal(events.length, 0)
})

test('Doppler: сделка — стоп первым, таймаут по закрытию 72-го бара', () => {
	const closes: number[] = []
	for (let i = 0; i < 400; i++) closes.push(100)
	const candles = makeCandles(closes)
	const ev = { index: 100, entryIndex: 101, entryOpen: 100, stop: 95, riskDist: 5, atr: 2, windowLow: 96, oiChange: -0.2, priceChange: -0.1 }
	// Пробиваем стоп на баре 150.
	const withStop = candles.map((c, i) => i === 150 ? { ...c, low: 94 } : c)
	const stopped = simulateDopplerTrade(withStop, ev, CFG)
	assert.equal(stopped.outcome, 'stop')
	assert.equal(stopped.exitIndex, 150)
	assert.equal(stopped.exitPrice, 95)
	// Не трогаем стоп — таймаут на 101+72−1 = 172 по его закрытию.
	const timed = simulateDopplerTrade(candles, ev, CFG)
	assert.equal(timed.outcome, 'timeout')
	assert.equal(timed.exitIndex, 172)
	assert.equal(timed.exitPrice, candles[172]!.close)
})

test('Doppler: reclaim-опция выходит по возврату к уровню начала окна', () => {
	const closes: number[] = []
	for (let i = 0; i < 400; i++) closes.push(100)
	// После входа цена зажата между стопом (95) и уровнем reclaim (100), затем выстрел вверх.
	const candles = makeCandles(closes).map((c, i) => {
		if (i >= 101 && i < 150) return { ...c, close: 97, low: 96.5, high: 97.5, open: 97 }
		if (i === 150) return { ...c, close: 130, high: 131, low: 129, open: 97 }
		return c
	})
	const ev = { index: 100, entryIndex: 101, entryOpen: 100, stop: 95, riskDist: 5, atr: 2, windowLow: 96, oiChange: -0.2, priceChange: -0.1 }
	const r = simulateDopplerTrade(candles, ev, CFG, { reclaim: true })
	assert.equal(r.outcome, 'reclaim')
	assert.equal(r.exitIndex, 150)
	assert.equal(r.exitPrice, 130)
})

test('Doppler: паритет со старой inline-логикой раннеров на случайных данных', () => {
	const referenceDetect = (candles: Candle[], oi: Array<number | null>, atr200: number[]) => {
		const events: Array<{ index: number; entryIndex: number; entryOpen: number; stop: number }> = []
		let lastAdmitted = -Infinity
		for (let i = 8; i + 1 < candles.length; i++) {
			const oiNow = oi[i], oiPast = oi[i - 8]!
			if (oiNow == null || oiPast == null || oiPast <= 0) continue
			if (!(oiNow / oiPast - 1 <= -0.15 && candles[i]!.close / candles[i - 8]!.close - 1 <= -0.05)) continue
			if (i - lastAdmitted < 8) continue
			lastAdmitted = i
			const atr = atr200[i]
			if (!Number.isFinite(atr) || atr! <= 0) continue
			const flushLow = Math.min(...candles.slice(i - 7, i + 1).map((c) => c.low))
			events.push({ index: i, entryIndex: i + 1, entryOpen: candles[i + 1]!.open, stop: flushLow - 0.5 * atr! })
		}
		return events
	}
	for (const seed of [1, 7, 42, 2024, 25082026]) {
		const random = rng(seed)
		const closes: number[] = [100]
		for (let i = 1; i < 1500; i++) closes.push(Math.max(1, closes[i - 1]! * (0.98 + 0.04 * random())))
		const candles = makeCandles(closes)
		const oi: Array<number | null> = candles.map((_, i) => (random() < 0.05 ? null : 1000 * (0.99 + 0.02 * random()) * (random() < 0.03 ? 0.7 : 1)))
		const atr200 = arrowAtr200(candles)
		const core = detectDopplerCascades(candles, oi, atr200, CFG).map((e) => ({ index: e.index, entryIndex: e.entryIndex, entryOpen: e.entryOpen, stop: e.stop }))
		const ref = referenceDetect(candles, oi, atr200)
		assert.deepEqual(core, ref, `паритет детекции нарушен на seed ${seed}`)
		for (const e of core) {
			const sim = simulateDopplerTrade(candles, { ...e, riskDist: e.entryOpen - e.stop, atr: 1, windowLow: 0, oiChange: 0, priceChange: 0 }, CFG)
			assert.ok(['stop', 'timeout'].includes(sim.outcome))
		}
	}
})

test('Doppler: пресеты режимов соответствуют замороженным порогам', () => {
	assert.equal(DOPPLER_MODE_PRESETS.SAFE.oiDrop, -0.2)
	assert.equal(DOPPLER_MODE_PRESETS.STANDARD.oiDrop, -0.15)
	assert.equal(DOPPLER_MODE_PRESETS.RISK.oiDrop, -0.12)
	assert.equal(DOPPLER_MODE_PRESETS.STANDARD.priceDrop, -0.05)
})
