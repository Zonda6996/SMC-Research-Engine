import assert from 'node:assert/strict'
import { it } from 'node:test'
import {
	CONTROL_BUFFER, FEATURE_NAMES, auc, buildCaseControl, computeAucTable,
	computeBaseFeatures, maxTPermutationP, mirrorForSell, mulberry32,
} from '../ci/research/auditFngCaseControl.js'
import type { ExactIndicatorRow } from '../ci/research/lib/exactIndicatorExport.js'
import type { EpisodeCC } from '../ci/research/auditFngCaseControl.js'

const mkRow = (i: number, close: number, opts: Partial<ExactIndicatorRow> = {}): ExactIndicatorRow => ({
	timestamp: i * 60_000,
	open: close * 0.999,
	high: close * 1.002,
	low: close * 0.998,
	close,
	volume: 1,
	mean: 100,
	upperOuter: 130,
	upperInner: 115,
	lowerInner: 85,
	lowerOuter: 70,
	buy: false,
	sell: false,
	...opts,
})

it('fng-cc: AUC корректен на известных распределениях', () => {
	assert.equal(auc([2, 3], [0, 1]), 1)
	assert.equal(auc([0, 1], [2, 3]), 0)
	assert.equal(auc([1], [1]), 0.5)
	assert.ok(Math.abs(auc([1, 2, 3], [1, 2, 3]) - 0.5) < 1e-12)
})

it('fng-cc: mirrorForSell инвертирует направленные признаки и сохраняет остальные', () => {
	const v = Object.fromEntries(FEATURE_NAMES.map((f) => [f, 0.3])) as Record<(typeof FEATURE_NAMES)[number], number>
	const m = mirrorForSell(v)
	assert.equal(m.rsi14, 99.7)
	assert.equal(m.roc10, -0.3)
	assert.equal(m.bandPos, 0.7)
	assert.equal(m.fngComposite, 0.7)
	assert.equal(m.atrNorm14, 0.3)
	assert.equal(m.atrRegime, 0.3)
	assert.equal(m.volPressure, 0.3)
	assert.equal(m.recoveryHW, 0.3)
})

it('fng-cc: computeBaseFeatures каузальна (prefix stability)', () => {
	const rng = mulberry32(9)
	const rows: ExactIndicatorRow[] = []
	let c = 100
	for (let i = 0; i < 400; i++) {
		c *= 1 + (rng() - 0.5) * 0.01
		rows.push(mkRow(i, c))
	}
	const volumes = rows.map(() => 1 + rng())
	const full = computeBaseFeatures(rows, volumes)
	const prefix = computeBaseFeatures(rows.slice(0, 300), volumes.slice(0, 300))
	for (let i = 0; i < 300; i++) {
		if (full[i] == null || prefix[i] == null) {
			assert.equal(full[i], prefix[i], `null mismatch at ${i}`)
			continue
		}
		for (const f of FEATURE_NAMES) {
			if (f === 'recoveryHW') continue
			assert.ok(Math.abs(full[i]![f] - prefix[i]![f]) < 1e-12, `feature ${f} differs at bar ${i}: future data leaked`)
		}
	}
})

it('fng-cc: buildCaseControl исключает буфер ±2 и сам case-бар из контролей', () => {
	const rows: ExactIndicatorRow[] = []
	for (let i = 0; i < 300; i++) {
		// long episode: bars 220..260 below inner, label at 240, close through mean at 261
		const inEpisode = i >= 220 && i <= 260
		rows.push(mkRow(i, inEpisode ? 84 : 105, {
			low: inEpisode ? 80 : 104,
			buy: i === 240,
			close: i === 261 ? 105 : inEpisode ? 84 : 105,
		}))
	}
	const volumes = rows.map(() => 1)
	const base = computeBaseFeatures(rows, volumes)
	const { episodes } = buildCaseControl(rows, base)
	assert.equal(episodes.length, 1)
	const ep = episodes[0]!
	assert.equal(ep.caseIndex, 240)
	for (const c of ep.controlIndices) {
		assert.ok(Math.abs(c - 240) > CONTROL_BUFFER, `control ${c} inside buffer`)
		assert.ok(c >= 220 && c <= 261, `control ${c} outside episode`)
	}
	assert.ok(ep.controlIndices.length > 10)
})

it('fng-cc: планted-разделение обнаруживается (AUC~1, малый p)', () => {
	const rng = mulberry32(5)
	const episodes: EpisodeCC[] = []
	for (let e = 0; e < 40; e++) {
		const features = new Map<number, Record<(typeof FEATURE_NAMES)[number], number>>()
		const mk = (planted: boolean) => Object.fromEntries(FEATURE_NAMES.map((f) => [f, f === 'rsi14' ? (planted ? 90 + rng() : 30 + rng() * 10) : rng()])) as Record<(typeof FEATURE_NAMES)[number], number>
		features.set(0, mk(true))
		const controls: number[] = []
		for (let c = 1; c <= 8; c++) {
			features.set(c, mk(false))
			controls.push(c)
		}
		episodes.push({ direction: 'long', caseIndex: 0, controlIndices: controls, features })
	}
	const table = computeAucTable(episodes)
	const rsiRow = table.find((t) => t.feature === 'rsi14')!
	assert.ok(rsiRow.auc > 0.95, `planted AUC must be ~1, got ${rsiRow.auc}`)
	const { p } = maxTPermutationP(episodes, Math.abs(rsiRow.auc - 0.5), 300, 4242)
	assert.ok(p < 0.02, `planted separation must be significant, p=${p}`)
})

it('fng-cc: независимый fixture не даёт ложной значимости', () => {
	const rng = mulberry32(17)
	const episodes: EpisodeCC[] = []
	for (let e = 0; e < 40; e++) {
		const features = new Map<number, Record<(typeof FEATURE_NAMES)[number], number>>()
		const mk = () => Object.fromEntries(FEATURE_NAMES.map((f) => [f, rng()])) as Record<(typeof FEATURE_NAMES)[number], number>
		features.set(0, mk())
		const controls: number[] = []
		for (let c = 1; c <= 8; c++) {
			features.set(c, mk())
			controls.push(c)
		}
		episodes.push({ direction: 'long', caseIndex: 0, controlIndices: controls, features })
	}
	const table = computeAucTable(episodes)
	const maxDev = Math.max(...table.map((t) => Math.abs(t.auc - 0.5)))
	const { p } = maxTPermutationP(episodes, maxDev, 300, 4242)
	assert.ok(p > 0.05, `independent fixture must not be significant, p=${p}`)
})

it('fng-cc: пермутации детерминированы при фиксированном seed', () => {
	const rng = mulberry32(3)
	const episodes: EpisodeCC[] = []
	for (let e = 0; e < 10; e++) {
		const features = new Map<number, Record<(typeof FEATURE_NAMES)[number], number>>()
		const mk = () => Object.fromEntries(FEATURE_NAMES.map((f) => [f, rng()])) as Record<(typeof FEATURE_NAMES)[number], number>
		features.set(0, mk())
		const controls = [1, 2, 3]
		for (const c of controls) features.set(c, mk())
		episodes.push({ direction: 'long', caseIndex: 0, controlIndices: controls, features })
	}
	const a = maxTPermutationP(episodes, 0.2, 200, 4242)
	const b = maxTPermutationP(episodes, 0.2, 200, 4242)
	assert.deepEqual(a, b)
})
