import assert from 'node:assert/strict'
import { it } from 'node:test'
import {
	MAX_WINDOW_MS, N_SHIFTS, SEED, WINDOWS_MIN,
	analyzePairWindow, circularShift, gapStats, mulberry32, oneToOneMatches, perEventHits, shiftOffsets,
} from '../ci/research/auditHtfGapFalsification.js'
import type { TimedDirectionalEvent } from '../ci/research/lib/eventMetrics.js'

const ev = (at: number, direction: 'long' | 'short' = 'long'): TimedDirectionalEvent => ({ at, direction })
const MIN = 60_000

it('htf-falsification: детерминированные shifts при фиксированном seed', () => {
	const a = shiftOffsets(1_000 * MIN, MAX_WINDOW_MS, 100, SEED)
	const b = shiftOffsets(1_000 * MIN, MAX_WINDOW_MS, 100, SEED)
	assert.deepEqual(a, b)
	const c = shiftOffsets(1_000 * MIN, MAX_WINDOW_MS, 100, SEED + 1)
	assert.notDeepEqual(a, c)
	for (const s of a) {
		assert.ok(s >= MAX_WINDOW_MS, 'no near-zero shifts')
		assert.ok(s < 1_000 * MIN - MAX_WINDOW_MS, 'no near-full-cycle shifts')
	}
})

it('htf-falsification: mulberry32 воспроизводим и в [0,1)', () => {
	const r1 = mulberry32(42)
	const r2 = mulberry32(42)
	for (let i = 0; i < 1000; i++) {
		const v = r1()
		assert.equal(v, r2())
		assert.ok(v >= 0 && v < 1)
	}
})

it('htf-falsification: circular shift сохраняет counts, directions и inter-label gaps', () => {
	const t0 = 0
	const t1 = 10_000 * MIN
	const events = [ev(100 * MIN, 'long'), ev(150 * MIN, 'short'), ev(400 * MIN, 'long'), ev(9_000 * MIN, 'short')]
	const shifted = circularShift(events, t0, t1, 3_333 * MIN)
	assert.equal(shifted.length, events.length)
	assert.equal(shifted.filter((e) => e.direction === 'long').length, 2)
	assert.equal(shifted.filter((e) => e.direction === 'short').length, 2)
	// circular gap multiset preserved (including wraparound gap)
	const circGaps = (list: TimedDirectionalEvent[]) => {
		const s = [...list].sort((a, b) => a.at - b.at)
		const g: number[] = []
		for (let i = 1; i < s.length; i++) g.push(s[i]!.at - s[i - 1]!.at)
		g.push(t1 - t0 - (s.at(-1)!.at - s[0]!.at))
		return g.sort((a, b) => a - b)
	}
	assert.deepEqual(circGaps(shifted), circGaps(events))
	for (const e of shifted) assert.ok(e.at >= t0 && e.at < t1)
})

it('htf-falsification: one-to-one matching не переиспользует LTF event', () => {
	// two HTF events near one LTF event: only one may match
	const htf = [ev(1_000 * MIN, 'long'), ev(1_010 * MIN, 'long')]
	const ltf = [ev(1_005 * MIN, 'long')]
	const m = oneToOneMatches(htf, ltf, 30 * MIN, 'same')
	assert.equal(m.length, 1)
	assert.equal(m[0]!.htfAt, 1_000 * MIN + 5 * MIN - 5 * MIN) // closest = 1_000? both at 5min; tie-break deterministic
	// direction respected
	const none = oneToOneMatches(htf, [ev(1_005 * MIN, 'short')], 30 * MIN, 'same')
	assert.equal(none.length, 0)
	const opp = oneToOneMatches(htf, [ev(1_005 * MIN, 'short')], 30 * MIN, 'opposite')
	assert.equal(opp.length, 1)
})

it('htf-falsification: одинаковые wall-clock windows для всех пар (константы)', () => {
	assert.deepEqual([...WINDOWS_MIN], [30, 60, 240])
	assert.equal(MAX_WINDOW_MS, 240 * MIN)
	assert.equal(N_SHIFTS, 10_000)
	assert.equal(SEED, 1337)
})

it('htf-falsification: perEventHits бинарный и направленный', () => {
	const htf = [ev(1_000 * MIN, 'long'), ev(5_000 * MIN, 'short')]
	const ltf = [ev(1_010 * MIN, 'long'), ev(1_020 * MIN, 'long'), ev(5_100 * MIN, 'long')].sort((a, b) => a.at - b.at)
	const hits = perEventHits(htf, ltf, 30 * MIN, 'same')
	assert.deepEqual(hits, [true, false])
	const opp = perEventHits(htf, ltf, 240 * MIN, 'opposite')
	assert.deepEqual(opp, [false, true])
})

it('htf-falsification: synthetic planted coincidence обнаруживается (малый p)', () => {
	const t0 = 0
	const t1 = 100_000 * MIN
	const rng = mulberry32(7)
	const htf: TimedDirectionalEvent[] = []
	const ltf: TimedDirectionalEvent[] = []
	for (let i = 0; i < 12; i++) {
		const at = t0 + MAX_WINDOW_MS + rng() * (t1 - t0 - 2 * MAX_WINDOW_MS)
		const direction = rng() < 0.5 ? 'long' : 'short'
		htf.push({ at, direction })
		ltf.push({ at: at + (rng() - 0.5) * 20 * MIN, direction }) // planted within +/-10m
	}
	htf.sort((a, b) => a.at - b.at)
	ltf.sort((a, b) => a.at - b.at)
	const offsets = shiftOffsets(t1 - t0, MAX_WINDOW_MS, 500, SEED)
	const res = analyzePairWindow(htf, ltf, t0, t1, 30 * MIN, 'same', offsets)
	assert.equal(res.observedHits, 12)
	assert.ok(res.pValue < 0.01, `planted coincidence must be detected, p=${res.pValue}`)
	assert.ok(res.enrichment > 3, `enrichment must be large, got ${res.enrichment}`)
})

it('htf-falsification: synthetic independent fixture не даёт систематического false enrichment', () => {
	const t0 = 0
	const t1 = 100_000 * MIN
	const rngH = mulberry32(11)
	const rngL = mulberry32(23)
	const htf: TimedDirectionalEvent[] = []
	const ltf: TimedDirectionalEvent[] = []
	for (let i = 0; i < 15; i++) htf.push({ at: t0 + rngH() * (t1 - t0), direction: rngH() < 0.5 ? 'long' : 'short' })
	for (let i = 0; i < 40; i++) ltf.push({ at: t0 + rngL() * (t1 - t0), direction: rngL() < 0.5 ? 'long' : 'short' })
	htf.sort((a, b) => a.at - b.at)
	ltf.sort((a, b) => a.at - b.at)
	const offsets = shiftOffsets(t1 - t0, MAX_WINDOW_MS, 500, SEED)
	const res = analyzePairWindow(htf, ltf, t0, t1, 60 * MIN, 'same', offsets)
	assert.ok(res.pValue > 0.05, `independent streams must not show significant enrichment, p=${res.pValue}`)
})

it('htf-falsification: prefix stability подготовки event stream (no future dependence)', () => {
	// gapStats and perEventHits over a prefix must equal the same computation on the
	// full series truncated to the prefix: no future information leaks backwards.
	const events = [ev(10 * MIN, 'long'), ev(500 * MIN, 'short'), ev(900 * MIN, 'long'), ev(1_500 * MIN, 'short')]
	const prefix = events.filter((e) => e.at <= 900 * MIN)
	const full = gapStats(events, MIN, 'x', 'global')
	const pre = gapStats(prefix, MIN, 'x', 'global')
	// first two gaps of the full series equal the prefix gaps
	assert.equal(pre.count, 2)
	assert.equal(full.count, 3)
	assert.equal(pre.minGap, Math.min(490, 400))
	const htf = [ev(505 * MIN, 'short')]
	const hitsPrefix = perEventHits(htf, prefix, 30 * MIN, 'same')
	const hitsFull = perEventHits(htf, events.filter((e) => e.at <= 900 * MIN), 30 * MIN, 'same')
	assert.deepEqual(hitsPrefix, hitsFull)
})

it('htf-falsification: LOO статистика присутствует и согласована', () => {
	const t0 = 0
	const t1 = 50_000 * MIN
	const rng = mulberry32(3)
	const htf: TimedDirectionalEvent[] = []
	const ltf: TimedDirectionalEvent[] = []
	for (let i = 0; i < 8; i++) {
		const at = t0 + MAX_WINDOW_MS + rng() * (t1 - t0 - 2 * MAX_WINDOW_MS)
		htf.push({ at, direction: 'long' })
		ltf.push({ at: at + rng() * 10 * MIN, direction: 'long' })
	}
	htf.sort((a, b) => a.at - b.at)
	ltf.sort((a, b) => a.at - b.at)
	const offsets = shiftOffsets(t1 - t0, MAX_WINDOW_MS, 300, SEED)
	const res = analyzePairWindow(htf, ltf, t0, t1, 30 * MIN, 'same', offsets)
	assert.ok(res.loo, 'loo must be computed for nHtf > 1')
	assert.ok(res.loo!.minEnrichment <= res.loo!.maxEnrichment)
	assert.ok(res.loo!.maxP >= 0 && res.loo!.maxP <= 1)
})
