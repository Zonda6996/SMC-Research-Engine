import assert from 'node:assert/strict'
import { it } from 'node:test'
import { mulberry32, type EpisodeCC, FEATURE_NAMES } from '../ci/research/auditFngCaseControl.js'
import { parseBatch2Csv, singleFeaturePermutationP } from '../ci/research/runFngOosConfirmation.js'

const CSV = [
	'time,open,high,low,close,GGI Mean,GGI Upper Outer,GGI Upper Inner,GGI Lower Inner,GGI Lower Outer,Shapes,Shapes,Volume',
	'2026-01-01T00:00:00+05:00,100,101,99,100.5,100,130,115,85,70,0,0,12.5',
	'2026-01-01T00:15:00+05:00,100.5,102,100,101,100,130,115,85,70,1,0,20',
].join('\n')

it('fng-oos: parseBatch2Csv нормализует ISO с таймзоной в epoch и читает volume/labels', () => {
	const rows = parseBatch2Csv(CSV)
	assert.equal(rows.length, 2)
	assert.equal(rows[0]!.timestamp, Date.parse('2025-12-31T19:00:00Z'))
	assert.equal(rows[1]!.timestamp - rows[0]!.timestamp, 900_000)
	assert.equal(rows[0]!.volume, 12.5)
	assert.equal(rows[1]!.buy, true)
	assert.equal(rows[1]!.sell, false)
	assert.equal(rows[0]!.lowerInner, 85)
})

it('fng-oos: parseBatch2Csv отвергает немонотонные timestamps и битые строки', () => {
	const bad = CSV + '\n2026-01-01T00:15:00+05:00,1,2,0,1,100,130,115,85,70,0,0,1'
	assert.throws(() => parseBatch2Csv(bad), /strictly increasing/)
	assert.throws(() => parseBatch2Csv('time,open,high,low,close,GGI M\n'), /13 columns|unexpected/)
})

function mkEpisodes(planted: boolean, n: number, seedVal: number): EpisodeCC[] {
	const rng = mulberry32(seedVal)
	const episodes: EpisodeCC[] = []
	for (let e = 0; e < n; e++) {
		const features = new Map<number, Record<(typeof FEATURE_NAMES)[number], number>>()
		const mk = (isCase: boolean) =>
			Object.fromEntries(
				FEATURE_NAMES.map((f) => [f, f === 'volPressure' && planted && isCase ? 5 + rng() : rng()]),
			) as Record<(typeof FEATURE_NAMES)[number], number>
		features.set(0, mk(true))
		const controls: number[] = []
		for (let c = 1; c <= 7; c++) {
			features.set(c, mk(false))
			controls.push(c)
		}
		episodes.push({ direction: 'long', caseIndex: 0, controlIndices: controls, features })
	}
	return episodes
}

it('fng-oos: singleFeaturePermutationP значим на planted и не значим на шуме, детерминирован', () => {
	const planted = mkEpisodes(true, 40, 7)
	const pPlanted = singleFeaturePermutationP(planted, 'volPressure', 0.99, 500, 4242)
	assert.ok(pPlanted < 0.02, `planted p=${pPlanted}`)
	const noise = mkEpisodes(false, 40, 11)
	const pNoise = singleFeaturePermutationP(noise, 'volPressure', 0.55, 500, 4242)
	assert.ok(pNoise > 0.05, `noise p=${pNoise}`)
	assert.equal(pNoise, singleFeaturePermutationP(noise, 'volPressure', 0.55, 500, 4242))
})
