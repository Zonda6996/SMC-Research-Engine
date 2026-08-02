import assert from 'node:assert/strict'
import { it } from 'node:test'
import { mulberry32 } from '../ci/research/auditFngCaseControl.js'
import type { ExactIndicatorRow } from '../ci/research/lib/exactIndicatorExport.js'
import {
	TRANSFORM_NAMES, attachTransforms, computeVolumeTransforms, familyMaxTP, transformAucs,
	type TransformEpisode,
} from '../ci/research/runN1VolumeTransforms.js'

const mkRow = (i: number, close = 100): ExactIndicatorRow => ({
	timestamp: i * 60_000, open: close, high: close + 1, low: close - 1, close, volume: 1,
	mean: 100, upperOuter: 130, upperInner: 115, lowerInner: 85, lowerOuter: 70,
	buy: false, sell: false,
})

it('n1: computeVolumeTransforms каузальна и корректна на константном объёме', () => {
	const rows = Array.from({ length: 300 }, (_, i) => mkRow(i))
	const volumes = rows.map(() => 10)
	const t = computeVolumeTransforms(rows, volumes)
	assert.equal(t[50], null) // sd=0 -> vz50 NaN on constant volume
	// spike at bar 250 on otherwise-constant volume
	const v2 = [...volumes]
	v2[250] = 100
	const t2 = computeVolumeTransforms(rows, v2)
	assert.ok(t2[250] != null)
	assert.ok(t2[250]!.vp50 > 5, `vp50 spike expected, got ${t2[250]!.vp50}`)
	assert.ok(t2[250]!.vmax10 === 10, `vmax10 = 100/10, got ${t2[250]!.vmax10}`)
	assert.ok(t2[250]!.vrank200 === 1, 'spike is max of trailing 200')
	// causality: prefix result identical
	const rng = mulberry32(2)
	const vr = rows.map(() => 1 + rng())
	const full = computeVolumeTransforms(rows, vr)
	const pre = computeVolumeTransforms(rows.slice(0, 260), vr.slice(0, 260))
	for (let i = 0; i < 260; i++) {
		if (full[i] == null || pre[i] == null) { assert.equal(full[i], pre[i]); continue }
		for (const k of TRANSFORM_NAMES) assert.ok(Math.abs(full[i]![k] - pre[i]![k]) < 1e-12, `${k} leaks at ${i}`)
	}
})

it('n1: attachTransforms зеркалит svz50 для short и отбрасывает бары без значений', () => {
	const rows = Array.from({ length: 300 }, (_, i) => mkRow(i, i === 250 ? 99 : 100))
	rows[250] = { ...rows[250]!, open: 100, close: 99 } // down bar
	const rng = mulberry32(4)
	const volumes = rows.map(() => 1 + rng())
	const transforms = computeVolumeTransforms(rows, volumes)
	const ep = { direction: 'short' as const, caseIndex: 250, controlIndices: [255, 260, 100], features: new Map() }
	const [attached] = attachTransforms([ep as never], transforms)
	assert.ok(attached)
	assert.equal(attached.values.get(250)!.svz50, -transforms[250]!.svz50)
	assert.equal(attached.values.get(255)!.vp50, transforms[255]!.vp50)
	// bar 100 lacks vrank200 (needs 200 history) -> dropped from controls
	assert.ok(!attached.controlIndices.includes(100))
})

function mkFixture(planted: boolean, seedVal: number): TransformEpisode[] {
	const rng = mulberry32(seedVal)
	const eps: TransformEpisode[] = []
	for (let e = 0; e < 40; e++) {
		const values = new Map<number, Record<(typeof TRANSFORM_NAMES)[number], number>>()
		const mk = (isCase: boolean) =>
			Object.fromEntries(TRANSFORM_NAMES.map((t) => [t, t === 'vz50' && planted && isCase ? 6 + rng() : rng()])) as Record<(typeof TRANSFORM_NAMES)[number], number>
		values.set(0, mk(true))
		const controls = [1, 2, 3, 4, 5, 6, 7]
		for (const c of controls) values.set(c, mk(false))
		eps.push({ direction: 'long', caseIndex: 0, controlIndices: controls, values })
	}
	return eps
}

it('n1: transformAucs + familyMaxTP находят planted и не дают ложной значимости', () => {
	const planted = mkFixture(true, 21)
	const aucs = transformAucs(planted)
	assert.ok(aucs.vz50 > 0.95, `planted vz50 AUC ~1, got ${aucs.vz50}`)
	const p = familyMaxTP(planted, Math.abs(aucs.vz50 - 0.5), 300, 4242)
	assert.ok(p < 0.02, `planted p=${p}`)
	const noise = mkFixture(false, 22)
	const na = transformAucs(noise)
	const maxDev = Math.max(...TRANSFORM_NAMES.map((t) => Math.abs(na[t] - 0.5)))
	const pn = familyMaxTP(noise, maxDev, 300, 4242)
	assert.ok(pn > 0.05, `noise p=${pn}`)
	assert.equal(pn, familyMaxTP(noise, maxDev, 300, 4242), 'deterministic')
})
