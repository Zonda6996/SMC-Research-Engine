import assert from 'node:assert/strict'
import test from 'node:test'
import {
	assertIndependentReversalStage,
	independentReversalModelHash,
	independentReversalProtocolHash,
	runIndependentReversalCell,
} from '../ci/research/runIndependentReversalResearch.js'
import type { Candle } from '../src/models/price/Candle.js'
import { stableProtocolJson } from '../src/core/signals/IndependentReversalProtocol.js'

const utc = (value: string): number => Date.parse(`${value}T00:00:00Z`)

test('runner protocol hash is stable and tied to canonical protocol JSON', () => {
	assert.equal(independentReversalProtocolHash().length, 64)
	assert.equal(stableProtocolJson(), stableProtocolJson())
	assert.equal(independentReversalModelHash(['P', 'V']), independentReversalModelHash(['V', 'P', 'P']))
})

test('stage guard accepts exact fit cell and rejects altered fit boundaries', () => {
	const valid = { stage: 'fit' as const, symbol: 'BTC/USDT', timeframe: '15m', fromMs: utc('2021-01-01'), untilMs: utc('2023-01-01') }
	assert.doesNotThrow(() => assertIndependentReversalStage(valid))
	assert.throws(() => assertIndependentReversalStage({ ...valid, untilMs: utc('2022-12-31') }), /Fit stage/)
	assert.throws(() => assertIndependentReversalStage({ ...valid, symbol: 'BNB/USDT' }), /Fit stage/)
})

test('management validation requires selected families and exact frozen model hash', () => {
	const selectedFamilies = ['P', 'V'] as const
	const valid = {
		stage: 'management-validation' as const,
		symbol: 'ETH/USDT',
		timeframe: '15m',
		fromMs: utc('2024-01-01'),
		untilMs: utc('2025-01-01'),
		selectedFamilies,
		expectedModelHash: independentReversalModelHash(selectedFamilies),
	}
	assert.doesNotThrow(() => assertIndependentReversalStage(valid))
	assert.throws(() => assertIndependentReversalStage({ ...valid, expectedModelHash: 'bad' }), /hash mismatch/)
})

test('sealed stage requires exact one-time style confirmation string', () => {
	const selectedFamilies = ['C'] as const
	const expectedModelHash = independentReversalModelHash(selectedFamilies)
	const untilMs = utc('2026-08-01')
	const base = {
		stage: 'sealed' as const,
		symbol: 'BNB/USDT',
		timeframe: '15m',
		fromMs: utc('2025-01-01'),
		untilMs,
		selectedFamilies,
		expectedModelHash,
	}
	assert.throws(() => assertIndependentReversalStage(base), /locked/)
	assert.doesNotThrow(() => assertIndependentReversalStage({
		...base,
		sealedConfirmation: `OPEN-SEALED:${expectedModelHash}:${new Date(untilMs).toISOString()}`,
	}))
})

test('runner refuses a cell with missing bars before signal computation', () => {
	const candles: Candle[] = [
		{ timestamp: utc('2021-01-01'), open: 100, high: 101, low: 99, close: 100, volume: 1 },
		{ timestamp: utc('2021-01-01') + 30 * 60_000, open: 100, high: 101, low: 99, close: 100, volume: 1 },
	]
	assert.throws(() => runIndependentReversalCell({
		stage: 'fit', symbol: 'BTC/USDT', timeframe: '15m',
		fromMs: utc('2021-01-01'), untilMs: utc('2023-01-01'), candles, funding: [], bootstrapRuns: 0,
	}), /data integrity failed|does not cover/)
})
