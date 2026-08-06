import assert from 'node:assert/strict'
import { it } from 'node:test'
import type { ExactIndicatorRow } from '../ci/research/lib/exactIndicatorExport.js'
import { trueRangeSma } from '../ci/research/lib/ggiCorrectedReplay.js'
import {
	atrQuintiles,
	buildInputManifest,
	fixedPath,
	matchNullSignals,
	type DatasetSpec,
} from '../ci/research/runGgiOwn1PathRegimeAuditV1.js'

const mk = (i: number, close = 100): ExactIndicatorRow => ({
	timestamp: Date.UTC(2025, i < 130 ? 0 : 1, (i % 28) + 1, i % 24),
	open: close - 0.2,
	high: close + 1,
	low: close - 1,
	close,
	volume: 1,
	mean: 100,
	upperOuter: 130,
	upperInner: 115,
	lowerInner: 85,
	lowerOuter: 70,
	buy: false,
	sell: false,
})

it('ggi path audit: fixedPath считает uncensored MFE/MAE от next-open в risk units', () => {
	const rows = Array.from({ length: 140 }, (_, i) => mk(i))
	rows[101] = { ...rows[101]!, open: 100, high: 102, low: 99, close: 101 }
	rows[102] = { ...rows[102]!, open: 101, high: 104, low: 98, close: 103 }
	rows[103] = { ...rows[103]!, open: 103, high: 106, low: 97, close: 105 }
	const tr55 = rows.map(() => 0.5)
	const path = fixedPath(rows, tr55, { idx: 100, side: 1 })
	assert.equal(path.find((p) => p.horizonBars === 1)!.mfeR, 2 / 6)
	assert.equal(path.find((p) => p.horizonBars === 3)!.mfeR, 1)
	assert.equal(path.find((p) => p.horizonBars === 3)!.maeR, -0.5)
})

it('ggi path audit: regime null детерминирован, сохраняет side/count и исключает template bars', () => {
	const rows = Array.from({ length: 320 }, (_, i) => mk(i, 100 + Math.sin(i / 8)))
	const tr55 = trueRangeSma(rows, 55)
	const template = [{ idx: 120, side: 1 as const }, { idx: 180, side: -1 as const }, { idx: 240, side: 1 as const }]
	const a = matchNullSignals(rows, tr55, template, 0, rows.length, 77, 'primary-regime-matched')
	const b = matchNullSignals(rows, tr55, template, 0, rows.length, 77, 'primary-regime-matched')
	assert.deepEqual(a, b)
	assert.equal(a.length, template.length)
	assert.deepEqual(a.map((s) => s.side), template.map((s) => s.side))
	assert.ok(a.every((s) => s.idx < 0 || !template.some((t) => t.idx === s.idx)))
})

it('ggi path audit: ATR quintile classification доступна после warmup', () => {
	const rows = Array.from({ length: 220 }, (_, i) => mk(i))
	const tr55 = rows.map((_, i) => i < 100 ? null : i - 99)
	const q = atrQuintiles(rows, tr55, 0, rows.length)
	assert.equal(q[50], null)
	assert.equal(q[100], 0)
	assert.equal(q[219], 4)
})

it('ggi path audit: manifest явно фиксирует отсутствующий required holdout', () => {
	const specs: DatasetSpec[] = [{
		id: 'missing-holdout',
		asset: 'X',
		file: 'tmp/definitely-not-present.csv',
		timeframeMinutes: 120,
		group: 'holdout',
		requiredForFullHoldout: true,
	}]
	const manifest = buildInputManifest(specs)
	assert.equal(manifest[0]!.available, false)
	assert.equal(manifest[0]!.sha256, null)
	assert.equal(manifest[0]!.requiredForFullHoldout, true)
})
