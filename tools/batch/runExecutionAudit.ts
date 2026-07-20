// runExecutionAudit.ts
//
// SPEC 7.49: LTF execution audit для двух вопросов, которые старший OHLC
// решить не может:
//   1) есть ли КАУЗАЛЬНЫЙ признак будущего bigbar до touch-entry;
//   2) происходил ли mirror@100 ПОСЛЕ OTE-fill@78.6 или high=100 был раньше.
//
// Загружается один ряд 5m (до 60k свечей), из него строятся 15m/30m/1h.
// Первый прогон — измерение, не новый фильтр. Любой same-5m порядок считается
// ambiguous и не используется как прибыльная mirror-сделка.
//
// Запуск:
//   npm run execution-audit
//   npm run execution-audit -- --symbols BTC/USDT,ETH/USDT --limit 20000
//   npm run execution-audit -- --fixture
//
// Результаты:
//   tools/batch/results/execution-audit-<stamp>.txt
//   tools/batch/results/execution-audit-<stamp>.csv

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAnalysis } from '../../src/core/analysis/runAnalysis.js'
import { BINGX_MAKER_RATE, BINGX_SLIP_RATE, BINGX_TAKER_RATE, bigbarCovered } from '../../src/core/analysis/entryModels.js'
import { computeRegimeMetrics } from '../../src/core/analysis/regimeMetrics.js'
import { fillCostR } from '../../src/core/analysis/takeLadders.js'
import { BATTLE_CONFIG, RESEARCH_CONFIG, canonRiskMultiplier, gridLevelPrice } from '../../src/strategy/battleConfig.js'
import { buildCausalMedianByCandidate, replayTrade } from '../forward/forwardRunner.js'
import {
	aggregateCandles,
	fetchCandlesPaginated,
	MAX_CANDLES_LTF,
	TF_MS,
	type MarketKind,
} from '../shared/candleFetcher.js'
import type { Candle } from '../../src/models/price/Candle.js'
import type { FibSetupOutcome } from '../../src/models/fib/FibLifecycle.js'
import { plannedFullStop } from '../shared/executionCostGate.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = join(__dirname, 'cache', 'execution-audit')
const RESULTS_DIR = join(__dirname, 'results')
const FIXTURE_PATH = join(__dirname, '../../tests/fixtures/btcusdt-15m-500.json')
const DEFAULT_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'XRP/USDT', 'BNB/USDT', 'DOGE/USDT', 'ADA/USDT',
	'AVAX/USDT', 'LINK/USDT', 'SUI/USDT', 'TON/USDT', 'NEAR/USDT', 'APT/USDT', 'LTC/USDT']

interface Args {
	symbols: string[]
	htfs: string[]
	ltf: string
	limit: number
	market: MarketKind
	cache: boolean
	fixture: boolean
	untilMs: number | null
	untilLabel: string | null
}

interface AuditRow {
	symbol: string
	htf: string
	scenario: 'deep' | 'ote'
	direction: 'long' | 'short'
	entryAt: number
	entryIndex: number
	entryPrice: number
	stopPrice: number
	takePrice: number
	stopPct: number
	/** Плановый полный убыток при stop с entry/exit costs; известен до fill. */
	fullStopNetR: number
	costRAtStop: number
	reactionClass: 'entered' | 'pierced-stop' | 'no-reclaim' | 'gap-invalid' | 'open'
	reactionEntryAt: number | null
	reactionEntryPrice: number | null
	reactionStopPct: number | null
	reactionFullStopNetR: number | null
	reactionNetR: number | null
	reactionResult: string
	netR: number
	result: string
	bigbar: boolean
	atr: number | null
	touchLtfAt: number
	touchOffset: number
	touchOffsetFrac: number
	lastBodyAtr: number | null
	last3NetAtr: number | null
	last3RangeAtr: number | null
	last3AdverseShare: number | null
	distanceBeforeTouchAtr: number | null
	first5Skipped: boolean
	freshBars: number
	swingAtr: number | null
	medianSwingAtr: number | null
	riskMult: number
	touchPhase: 'skip' | 'early' | 'middle' | 'late'
	touchPhaseMult: number
	atrRatio: number | null
	chochShare: number | null
	confluenceAtr: number | null
	mirrorClass: '' | 'same-htf-valid' | 'next-htf' | 'missed' | 'open'
	mirrorAmbiguousSameLtf: boolean
	mirrorPreFill100: boolean
	mirrorFillAt: number | null
	mirrorNetR: number | null
	mirrorResult: string
	fadeAfterStopClass: '' | 'entered' | 'missed' | 'open'
	fadeAfterStopAmbiguous: boolean
	fadeAfterStopNetR: number | null
	fadeAfterStopResult: string
	oteCycleClass: '' | 'entered' | 'missed' | 'open'
	oteCycleAmbiguous: boolean
	oteCycleNetR: number | null
	oteCycleResult: string
}

function parseArgs(argv: string[]): Args {
	const get = (flag: string): string | null => {
		const i = argv.indexOf(flag)
		return i >= 0 && argv[i + 1] ? argv[i + 1]! : null
	}
	const fixture = argv.includes('--fixture')
	const untilRaw = get('--until')
	const untilMs = untilRaw ? Date.parse(untilRaw) : null
	if (untilRaw && (untilMs == null || Number.isNaN(untilMs))) throw new Error(`Bad --until: ${untilRaw}`)
	return {
		symbols: fixture ? ['BTC/USDT'] : (get('--symbols') ?? DEFAULT_SYMBOLS.join(',')).split(',').map((x) => x.trim()),
		htfs: fixture ? ['1h'] : (get('--timeframes') ?? '15m,30m,1h').split(',').map((x) => x.trim()),
		ltf: fixture ? '15m' : (get('--ltf') ?? '5m'),
		limit: fixture ? 500 : Math.min(Number(get('--limit') ?? MAX_CANDLES_LTF), MAX_CANDLES_LTF),
		market: get('--market') === 'spot' ? 'spot' : 'futures',
		cache: !argv.includes('--no-cache'),
		fixture,
		untilMs,
		untilLabel: untilRaw?.replaceAll(':', '-') ?? null,
	}
}

async function loadLtf(args: Args, symbol: string): Promise<Candle[]> {
	if (args.fixture) return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Candle[]
	const until = args.untilLabel ? `_until-${args.untilLabel}` : ''
	const key = `${symbol.replace('/', '-')}_${args.ltf}_${args.limit}_${args.market}${until}.json`
	const path = join(CACHE_DIR, key)
	if (args.cache && existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as Candle[]
	const candles = await fetchCandlesPaginated(symbol, args.ltf, args.limit, args.market, args.untilMs, MAX_CANDLES_LTF)
	if (args.cache && candles.length) { mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(path, JSON.stringify(candles)) }
	return candles
}

function selectedOutcomes(outcomes: readonly FibSetupOutcome[]): FibSetupOutcome[] {
	const seen = new Set<string>(), result: FibSetupOutcome[] = []
	for (const o of outcomes) {
		if (o.stopMode !== 'zero' || (o.scenario !== 'deep' && o.scenario !== 'ote')) continue
		const key = `${o.scenario}|${o.candidateId}`
		if (seen.has(key)) continue
		seen.add(key); result.push(o)
	}
	return result
}

function bucketLtf(ltf: Candle[], htfMs: number): Map<number, { candle: Candle; index: number }[]> {
	const map = new Map<number, { candle: Candle; index: number }[]>()
	for (let i = 0; i < ltf.length; i++) {
		const candle = ltf[i]!, bucket = Math.floor(candle.timestamp / htfMs) * htfMs
		const list = map.get(bucket)
		if (list) list.push({ candle, index: i }); else map.set(bucket, [{ candle, index: i }])
	}
	return map
}

function firstTouch(items: { candle: Candle; index: number }[], long: boolean, price: number): { candle: Candle; index: number; offset: number } | null {
	for (let i = 0; i < items.length; i++) {
		const item = items[i]!
		if (long ? item.candle.low <= price : item.candle.high >= price) return { ...item, offset: i }
	}
	return null
}

function adverseBody(c: Candle, long: boolean): number { return long ? c.open - c.close : c.close - c.open }
function adverseNet(from: Candle, to: Candle, long: boolean): number { return long ? from.close - to.close : to.close - from.close }
function distanceToEntry(close: number, entry: number, long: boolean): number { return long ? close - entry : entry - close }
function phaseOf(offset: number, barsInHtf: number): { phase: AuditRow['touchPhase']; mult: number } {
	if (offset === 0) return { phase: 'skip', mult: 0 }
	const fraction = offset / barsInHtf
	if (fraction <= 1 / 3) return { phase: 'early', mult: 0.5 }
	if (fraction <= 2 / 3) return { phase: 'middle', mult: 1.0 }
	return { phase: 'late', mult: 1.5 }
}

function replayReactionClose(
	ltf: Candle[], touchIndex: number, long: boolean, level: number, stop: number, take: number, timeStopBars: number | null,
): Pick<AuditRow, 'reactionClass' | 'reactionEntryAt' | 'reactionEntryPrice' | 'reactionStopPct' | 'reactionFullStopNetR' | 'reactionNetR' | 'reactionResult'> {
	const empty = (reactionClass: AuditRow['reactionClass']) => ({ reactionClass, reactionEntryAt: null, reactionEntryPrice: null, reactionStopPct: null, reactionFullStopNetR: null, reactionNetR: null, reactionResult: '' })
	const touch = ltf[touchIndex]
	if (!touch) return empty('open')
	// Решение только после close touch-5m. Любой intrabar прокол планового stop
	// означает «зону прошили» и запрещает последующий market entry.
	if (long ? touch.low <= stop : touch.high >= stop) return empty('pierced-stop')
	if (!(long ? touch.close >= level : touch.close <= level)) return empty('no-reclaim')
	const entryIndex = touchIndex + 1, next = ltf[entryIndex]
	if (!next) return empty('open')
	const entry = next.open
	if (long ? (entry <= stop || entry >= take) : (entry >= stop || entry <= take)) return empty('gap-invalid')
	const planned = plannedFullStop(entry, stop, BINGX_TAKER_RATE + BINGX_SLIP_RATE)
	const risk = Math.abs(entry - stop)
	const entryCost = fillCostR(entry, BINGX_TAKER_RATE + BINGX_SLIP_RATE, 1, risk)
	for (let i = entryIndex; i < ltf.length; i++) {
		const c = ltf[i]!, hitStop = long ? c.low <= stop : c.high >= stop, hitTp = long ? c.high >= take : c.low <= take
		if (hitStop) return { reactionClass: 'entered', reactionEntryAt: next.timestamp, reactionEntryPrice: entry, reactionStopPct: planned.stopPct, reactionFullStopNetR: planned.netR, reactionNetR: -1 - entryCost - fillCostR(stop, BINGX_TAKER_RATE + BINGX_SLIP_RATE, 1, risk), reactionResult: 'stop' }
		if (hitTp) return { reactionClass: 'entered', reactionEntryAt: next.timestamp, reactionEntryPrice: entry, reactionStopPct: planned.stopPct, reactionFullStopNetR: planned.netR, reactionNetR: Math.abs(take - entry) / risk - entryCost - fillCostR(take, BINGX_MAKER_RATE, 1, risk), reactionResult: 'tp' }
		if (timeStopBars != null && i - entryIndex >= timeStopBars) {
			const gross = (long ? c.close - entry : entry - c.close) / risk
			return { reactionClass: 'entered', reactionEntryAt: next.timestamp, reactionEntryPrice: entry, reactionStopPct: planned.stopPct, reactionFullStopNetR: planned.netR, reactionNetR: gross - entryCost - fillCostR(c.close, BINGX_TAKER_RATE + BINGX_SLIP_RATE, 1, risk), reactionResult: 'timestop' }
		}
	}
	return { reactionClass: 'open', reactionEntryAt: next.timestamp, reactionEntryPrice: entry, reactionStopPct: planned.stopPct, reactionFullStopNetR: planned.netR, reactionNetR: null, reactionResult: 'open' }
}

function buildRows(symbol: string, htf: string, ltfTf: string, ltf: Candle[]): AuditRow[] {
	const candles = ltfTf === htf ? ltf : aggregateCandles(ltf, ltfTf, htf)
	const snapshot = runAnalysis(candles)
	const regime = computeRegimeMetrics(snapshot.candles, snapshot.atr, snapshot.events, snapshot.market.trendHistory)
	const candidateById = new Map(snapshot.fib.candidates.map((c) => [c.id, c]))
	const selected = selectedOutcomes(snapshot.fibLifecycle.outcomes)
	const medians = buildCausalMedianByCandidate(selected)
	const htfMs = TF_MS[htf]!, groups = bucketLtf(ltf, htfMs)
	const rows: AuditRow[] = []

	for (const outcome of selected) {
		if (!outcome.entered || outcome.entryIndex == null) continue
		const scenario = outcome.scenario as 'deep' | 'ote'
		const config = BATTLE_CONFIG.canon.find((x) => x.scenario === scenario)
		const candidate = candidateById.get(outcome.candidateId)
		const variant = candidate?.variants[outcome.variantMode]
		if (!config || !candidate || !variant) continue
		const p0 = variant.levels.find((x) => x.ratio === 0)?.price
		const p100 = variant.levels.find((x) => x.ratio === 100)?.price
		const htfEntryCandle = candles[outcome.entryIndex]
		if (p0 == null || p100 == null || !htfEntryCandle) continue
		const at = (ratio: number) => gridLevelPrice(p0, p100, ratio)
		const entry = at(config.entry), stop = at(config.stop), take = at(config.take)
		const long = outcome.direction === 'long'
		const trade = replayTrade(candles, outcome.entryIndex, long, entry, stop, take, null, config.timeStopBars)
		if (trade.status !== 'done') continue
		const items = groups.get(htfEntryCandle.timestamp)
		if (!items?.length) continue
		const touch = firstTouch(items, long, entry)
		if (!touch) continue
		const atr = variant.legAtrRatio != null && variant.legAtrRatio > 0 ? variant.legSize / variant.legAtrRatio : null
		const pre = ltf.slice(Math.max(0, touch.index - 3), touch.index)
		const last = pre.at(-1) ?? null, first = pre[0] ?? null
		const norm = (x: number): number | null => atr != null && atr > 0 ? x / atr : null
		const freshBars = outcome.entryIndex - outcome.createdAtIndex
		const medianSwingAtr = medians.get(outcome.candidateId) ?? null
		const riskMult = canonRiskMultiplier(freshBars, outcome.legAtrRatio, medianSwingAtr)
		const phase = phaseOf(touch.offset, items.length)
		const local = candidate.variants.local, global = candidate.variants.global
		const localEntry = local ? gridLevelPrice(local.levels.find((x) => x.ratio === 0)!.price, p100, config.entry) : null
		const globalEntry = global ? gridLevelPrice(global.levels.find((x) => x.ratio === 0)!.price, p100, config.entry) : null
		const confluenceAtr = atr != null && atr > 0 && localEntry != null && globalEntry != null ? Math.abs(localEntry - globalEntry) / atr : null
		const regimeAtSetup = regime[outcome.createdAtIndex]
		const plannedStop = plannedFullStop(entry, stop)
		const ltfTimeStop = config.timeStopBars == null ? null : config.timeStopBars * Math.round(htfMs / TF_MS[ltfTf]!)
		const reaction = replayReactionClose(ltf, touch.index, long, entry, stop, take, ltfTimeStop)
		const row: AuditRow = {
			symbol, htf, scenario, direction: outcome.direction,
			entryAt: htfEntryCandle.timestamp, entryIndex: outcome.entryIndex, entryPrice: entry,
			stopPrice: stop, takePrice: take, stopPct: plannedStop.stopPct,
			fullStopNetR: plannedStop.netR, costRAtStop: plannedStop.costR,
			...reaction,
			netR: trade.netR, result: trade.result, bigbar: bigbarCovered(candles, outcome.createdAtIndex, outcome.entryIndex + 1,
				at(scenario === 'ote' ? 61.8 : 23.6), at(scenario === 'ote' ? 78.6 : 38.2)),
			atr, touchLtfAt: touch.candle.timestamp, touchOffset: touch.offset, touchOffsetFrac: touch.offset / items.length,
			lastBodyAtr: last ? norm(adverseBody(last, long)) : null,
			last3NetAtr: first && last ? norm(adverseNet(first, last, long)) : null,
			last3RangeAtr: pre.length ? norm(pre.reduce((s, c) => s + c.high - c.low, 0)) : null,
			last3AdverseShare: pre.length ? pre.filter((c) => adverseBody(c, long) > 0).length / pre.length : null,
			distanceBeforeTouchAtr: last ? norm(Math.max(0, distanceToEntry(last.close, entry, long))) : null,
			first5Skipped: touch.offset < BATTLE_CONFIG.entryGate.skipFirstBars,
			freshBars, swingAtr: outcome.legAtrRatio, medianSwingAtr, riskMult,
			touchPhase: phase.phase, touchPhaseMult: phase.mult,
			atrRatio: regimeAtSetup?.atrRatio ?? null, chochShare: regimeAtSetup?.chochShare ?? null, confluenceAtr,
			mirrorClass: '', mirrorAmbiguousSameLtf: false, mirrorPreFill100: false,
			mirrorFillAt: null, mirrorNetR: null, mirrorResult: '',
			fadeAfterStopClass: '', fadeAfterStopAmbiguous: false, fadeAfterStopNetR: null, fadeAfterStopResult: '',
			oteCycleClass: '', oteCycleAmbiguous: false, oteCycleNetR: null, oteCycleResult: '',
		}

		if (scenario === 'ote') {
			const mirror = RESEARCH_CONFIG.mirrorProbe
			const mEntry = at(mirror.entry), reverseLong = !long
			row.mirrorPreFill100 = items.slice(0, touch.offset).some((x) => reverseLong ? x.candle.low <= mEntry : x.candle.high >= mEntry)
			row.mirrorAmbiguousSameLtf = reverseLong ? touch.candle.low <= mEntry : touch.candle.high >= mEntry
			const mirrorTrade = replayTrade(ltf, touch.index + 1, reverseLong, mEntry, at(mirror.stop), at(mirror.take), at(mirror.cancelBeyond), null)
			if (mirrorTrade.status === 'done' || mirrorTrade.status === 'open') {
				const fill = ltf[mirrorTrade.fillIndex]!
				row.mirrorClass = fill.timestamp < htfEntryCandle.timestamp + htfMs ? 'same-htf-valid' : 'next-htf'
				row.mirrorFillAt = fill.timestamp
				if (mirrorTrade.status === 'done') {
					row.mirrorNetR = mirrorTrade.netR
					row.mirrorResult = mirrorTrade.result

					// Fade141 — только ПОСЛЕ наблюдаемого stop mirror@120.
					if (!row.first5Skipped && mirrorTrade.result === RESEARCH_CONFIG.fadeAfterMirrorStop.armAfterMirrorResult) {
						const fade = RESEARCH_CONFIG.fadeAfterMirrorStop
						const stopBar = ltf[mirrorTrade.exitIndex]!
						const fadeEntry = at(fade.entry)
						row.fadeAfterStopAmbiguous = reverseLong ? stopBar.low <= fadeEntry : stopBar.high >= fadeEntry
						const fadeTrade = replayTrade(ltf, mirrorTrade.exitIndex + 1, reverseLong,
							fadeEntry, at(fade.stop), at(fade.take), at(fade.cancelBeyond), null)
						if (fadeTrade.status === 'done') {
							row.fadeAfterStopClass = 'entered'; row.fadeAfterStopNetR = fadeTrade.netR; row.fadeAfterStopResult = fadeTrade.result
						} else if (fadeTrade.status === 'open') row.fadeAfterStopClass = 'open'
						else row.fadeAfterStopClass = 'missed'
					}

					// Один повторный OTE-cycle — только после TP canon И TP mirror.
					if (!row.first5Skipped && trade.result === RESEARCH_CONFIG.oteCycleAfterDoubleTp.armAfterCanonResult &&
						mirrorTrade.result === RESEARCH_CONFIG.oteCycleAfterDoubleTp.armAfterMirrorResult) {
						const cycle = RESEARCH_CONFIG.oteCycleAfterDoubleTp
						const exitBar = ltf[mirrorTrade.exitIndex]!
						const cycleEntry = at(cycle.entry)
						row.oteCycleAmbiguous = long ? exitBar.low <= cycleEntry : exitBar.high >= cycleEntry
						const ltfTimeStop = config.timeStopBars == null ? null : config.timeStopBars * Math.round(htfMs / TF_MS[ltfTf]!)
						const cycleTrade = replayTrade(ltf, mirrorTrade.exitIndex + 1, long,
							cycleEntry, at(cycle.stop), at(cycle.take), at(cycle.cancelBeyond), ltfTimeStop)
						if (cycleTrade.status === 'done') {
							row.oteCycleClass = 'entered'; row.oteCycleNetR = cycleTrade.netR; row.oteCycleResult = cycleTrade.result
						} else if (cycleTrade.status === 'open') row.oteCycleClass = 'open'
						else row.oteCycleClass = 'missed'
					}
				} else row.mirrorClass = 'open'
			} else row.mirrorClass = 'missed'
		}
		rows.push(row)
	}
	return rows
}

function csvValue(x: unknown): string {
	if (x == null) return ''
	const s = String(x)
	return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}
function toCsv(rows: AuditRow[]): string {
	if (!rows.length) return ''
	const keys = Object.keys(rows[0]!) as (keyof AuditRow)[]
	return [keys.join(','), ...rows.map((r) => keys.map((k) => csvValue(r[k])).join(','))].join('\n')
}
function avg(values: number[]): number { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0 }
function fmt(x: number): string { return `${x >= 0 ? '+' : ''}${x.toFixed(3)}` }
function rowStats(rows: AuditRow[], value: (r: AuditRow) => number | null = (r) => r.netR): string {
	const usable = rows.map((r) => ({ r, v: value(r) })).filter((x): x is { r: AuditRow; v: number } => x.v != null)
	if (!usable.length) return 'n 0'
	const mid = [...usable].sort((a, b) => a.r.entryAt - b.r.entryAt)[Math.floor(usable.length / 2)]!.r.entryAt
	const total = usable.reduce((s, x) => s + x.v, 0)
	return `n ${usable.length}, totalR ${fmt(total)}, avgR ${fmt(total / usable.length)}, WR ${(100 * usable.filter((x) => x.v > 0).length / usable.length).toFixed(1)}% | H1 ${fmt(avg(usable.filter((x) => x.r.entryAt < mid).map((x) => x.v)))} / H2 ${fmt(avg(usable.filter((x) => x.r.entryAt >= mid).map((x) => x.v)))}`
}

function quantiles(values: number[]): [number, number, number] {
	const s = [...values].sort((a, b) => a - b)
	return [s[Math.floor(s.length * .25)]!, s[Math.floor(s.length * .5)]!, s[Math.floor(s.length * .75)]!]
}

function featureReport(lines: string[], rows: AuditRow[], key: keyof AuditRow, title: string): void {
	const valid = rows.filter((r) => typeof r[key] === 'number')
	if (valid.length < 20) return
	const [q1, q2, q3] = quantiles(valid.map((r) => r[key] as number))
	lines.push(`-- ${title} [q25 ${q1.toFixed(3)} | q50 ${q2.toFixed(3)} | q75 ${q3.toFixed(3)}] --`)
	const tests = [
		(r: AuditRow) => (r[key] as number) <= q1,
		(r: AuditRow) => (r[key] as number) > q1 && (r[key] as number) <= q2,
		(r: AuditRow) => (r[key] as number) > q2 && (r[key] as number) <= q3,
		(r: AuditRow) => (r[key] as number) > q3,
	]
	for (let i = 0; i < 4; i++) {
		const g = valid.filter(tests[i]!), bb = g.filter((r) => r.bigbar)
		lines.push(`  Q${i + 1}: ${rowStats(g)} | bigbar ${bb.length}/${g.length} (${g.length ? (100 * bb.length / g.length).toFixed(1) : '0'}%)`)
	}
}

function report(rows: AuditRow[], args: Args): string {
	const rangeStart = rows.length ? new Date(Math.min(...rows.map((r) => r.entryAt))).toISOString() : '-'
	const rangeEnd = rows.length ? new Date(Math.max(...rows.map((r) => r.entryAt))).toISOString() : '-'
	const lines = [
		'=== LTF EXECUTION AUDIT (SPEC 7.49) ===',
		'build: entry-models-A-B-C-D-v1',
		`LTF ${args.ltf}, limit ${args.limit}, symbols ${args.symbols.length}, HTF ${args.htfs.join('/')}`,
		`range ${rangeStart} → ${rangeEnd}`,
		'', '=== FIRST-5 ENTRY GATE (боевой кандидат SPEC 7.50) ===',
	]
	const kept = rows.filter((r) => !r.first5Skipped), skipped = rows.filter((r) => r.first5Skipped)
	lines.push(`baseline : ${rowStats(rows)}`)
	lines.push(`skipped  : ${rowStats(skipped)}`)
	lines.push(`after gate: ${rowStats(kept)}`)
	for (const sc of ['deep', 'ote'] as const) {
		lines.push(`${sc} skipped: ${rowStats(skipped.filter((r) => r.scenario === sc))}`)
		lines.push(`${sc} kept   : ${rowStats(kept.filter((r) => r.scenario === sc))}`)
	}
	for (const tf of args.htfs) lines.push(`${tf} skipped: ${rowStats(skipped.filter((r) => r.htf === tf))} | kept: ${rowStats(kept.filter((r) => r.htf === tf))}`)

	lines.push('', '=== FOUR EXECUTABLE ENTRY MODELS ===')
	lines.push(`A resting limit: ${rowStats(kept)}`)
	lines.push(`C 5m close reclaim → next 5m open: ${rowStats(kept, (r) => r.reactionNetR)}`)
	for (const cls of ['entered', 'pierced-stop', 'no-reclaim', 'gap-invalid', 'open'] as const) lines.push(`  reaction ${cls.padEnd(13)}: ${kept.filter((r) => r.reactionClass === cls).length}`)
	lines.push('fullStopNetR = -1R price loss - entry cost - stop taker fee/slippage')
	for (const cap of [1.25, 1.5, 1.75, 2, 2.5, 3]) {
		const restingAllowed = kept.filter((r) => r.fullStopNetR >= -cap)
		const restingRejected = kept.filter((r) => r.fullStopNetR < -cap)
		const reactionAllowed = kept.filter((r) => r.reactionNetR != null && r.reactionFullStopNetR != null && r.reactionFullStopNetR >= -cap)
		lines.push(`B resting + cap -${cap.toFixed(2)}R | KEEP ${rowStats(restingAllowed)} | SKIP cf ${rowStats(restingRejected)}`)
		lines.push(`D 5m close + cap -${cap.toFixed(2)}R | ${rowStats(reactionAllowed, (r) => r.reactionNetR)}`)
		for (const sc of ['deep', 'ote'] as const) lines.push(`  B ${sc}: ${rowStats(restingAllowed.filter((r) => r.scenario === sc))} | D ${sc}: ${rowStats(reactionAllowed.filter((r) => r.scenario === sc), (r) => r.reactionNetR)}`)
		for (const tf of args.htfs) lines.push(`  B ${tf}: ${rowStats(restingAllowed.filter((r) => r.htf === tf))} | D ${tf}: ${rowStats(reactionAllowed.filter((r) => r.htf === tf), (r) => r.reactionNetR)}`)
	}
	featureReport(lines, kept, 'fullStopNetR', 'planned full stop netR (closer to -1 = cheaper execution)')
	featureReport(lines, kept, 'stopPct', 'entry-stop distance %')

	lines.push('', '=== SIZING STACK ON FIRST-5-KEPT POOL ===')
	const sizingLine = (name: string, pool: AuditRow[]): string => {
		const total = pool.reduce((s, r) => s + r.netR * r.riskMult, 0)
		const units = pool.reduce((s, r) => s + r.riskMult, 0)
		const sorted = [...pool].sort((a, b) => a.entryAt - b.entryAt), mid = sorted[Math.floor(sorted.length / 2)]?.entryAt ?? 0
		const ru = (g: AuditRow[]) => { const t = g.reduce((s, r) => s + r.netR * r.riskMult, 0), u = g.reduce((s, r) => s + r.riskMult, 0); return u ? t / u : 0 }
		return `${name}: weighted ${fmt(total)}, units ${units.toFixed(1)}, R/unit ${fmt(units ? total / units : 0)} | H1 ${fmt(ru(pool.filter((r) => r.entryAt < mid)))} / H2 ${fmt(ru(pool.filter((r) => r.entryAt >= mid)))}`
	}
	lines.push(sizingLine('all kept', kept))
	for (const sc of ['deep', 'ote'] as const) lines.push(sizingLine(sc, kept.filter((r) => r.scenario === sc)))

	lines.push('', '=== TOUCH-PHASE SIZING CANDIDATE (0 / 0.5 / 1.0 / 1.5) ===')
	for (const phase of ['skip', 'early', 'middle', 'late'] as const) lines.push(`${phase.padEnd(7)}: ${rowStats(rows.filter((r) => r.touchPhase === phase))}`)
	const phaseSizing = (pool: AuditRow[]): string => {
		const total = pool.reduce((s, r) => s + r.netR * r.riskMult * r.touchPhaseMult, 0)
		const units = pool.reduce((s, r) => s + r.riskMult * r.touchPhaseMult, 0)
		return `weighted ${fmt(total)}, units ${units.toFixed(1)}, R/unit ${fmt(units ? total / units : 0)}`
	}
	lines.push(`base sizing + phase: ${phaseSizing(rows)}`)
	for (const sc of ['deep', 'ote'] as const) lines.push(`${sc}: ${phaseSizing(rows.filter((r) => r.scenario === sc))}`)

	lines.push('', '=== REGIME ON FIRST-5-KEPT POOL (diagnostic sizing only) ===')
	for (const sc of ['deep', 'ote'] as const) {
		const pool = kept.filter((r) => r.scenario === sc)
		featureReport(lines, pool, 'atrRatio', `${sc} atrRatio at setup`)
		featureReport(lines, pool, 'chochShare', `${sc} chochShare at setup`)
	}
	lines.push('', '=== LOCAL/GLOBAL CONFLUENCE ON KEPT POOL ===')
	for (const sc of ['deep', 'ote'] as const) featureReport(lines, kept.filter((r) => r.scenario === sc), 'confluenceAtr', `${sc} |entryLocal-entryGlobal| / ATR (lower=closer)`)
	const withConf = kept.filter((r) => r.confluenceAtr != null && r.swingAtr != null && r.medianSwingAtr != null)
	if (withConf.length) {
		const medConf = quantiles(withConf.map((r) => r.confluenceAtr!))[1]
		lines.push(`-- confluence x compactness (confluence median ${medConf.toFixed(3)}) --`)
		for (const close of [true, false]) for (const compact of [true, false]) {
			const g = withConf.filter((r) => (r.confluenceAtr! <= medConf) === close && (r.swingAtr! <= r.medianSwingAtr!) === compact)
			lines.push(`  ${close ? 'close' : 'wide '} x ${compact ? 'compact' : 'stretched'}: ${rowStats(g)}`)
		}
	}
	lines.push('', '=== BIGBAR DIAGNOSTIC ===')
	for (const sc of ['deep', 'ote'] as const) {
		const all = rows.filter((r) => r.scenario === sc), bb = all.filter((r) => r.bigbar), normal = all.filter((r) => !r.bigbar)
		lines.push(`${sc} normal : ${rowStats(normal)}`)
		lines.push(`${sc} bigbar : ${rowStats(bb)}`)
		featureReport(lines, all, 'touchOffsetFrac', `${sc} touch timing inside HTF bar (0=first LTF, 1=last)`)
		featureReport(lines, all, 'lastBodyAtr', `${sc} last completed LTF body / ATR`)
		featureReport(lines, all, 'last3NetAtr', `${sc} last-3 net adverse move / ATR`)
		featureReport(lines, all, 'last3RangeAtr', `${sc} last-3 total range / ATR`)
		featureReport(lines, all, 'last3AdverseShare', `${sc} adverse candle share before touch`)
		featureReport(lines, all, 'distanceBeforeTouchAtr', `${sc} distance to entry at last LTF close / ATR`)
	}
	const ote = rows.filter((r) => r.scenario === 'ote')
	lines.push('', '=== MIRROR ORDERING AFTER OTE FILL ===')
	for (const cls of ['same-htf-valid', 'next-htf', 'missed', 'open'] as const) lines.push(`${cls.padEnd(16)}: ${ote.filter((r) => r.mirrorClass === cls).length}`)
	lines.push(`same-LTF ambiguous: ${ote.filter((r) => r.mirrorAmbiguousSameLtf).length}`)
	lines.push(`100 touched before OTE fill in entry HTF bar: ${ote.filter((r) => r.mirrorPreFill100).length}`)
	lines.push(`resolved mirror after OTE fill: ${rowStats(ote, (r) => r.mirrorNetR)}`)
	for (const tf of args.htfs) lines.push(`${tf}: ${rowStats(ote.filter((r) => r.htf === tf), (r) => r.mirrorNetR)}`)
	lines.push('', '=== MIRROR BY SYMBOL ===')
	for (const symbol of args.symbols) lines.push(`${symbol.padEnd(12)} ${rowStats(ote.filter((r) => r.symbol === symbol), (r) => r.mirrorNetR)}`)

	lines.push('', '=== FADE141 AFTER OBSERVED MIRROR STOP (research, first-5 kept only) ===')
	const fadeEligible = ote.filter((r) => !r.first5Skipped && r.mirrorResult === 'stop')
	lines.push(`mirror stops eligible: ${fadeEligible.length}`)
	for (const cls of ['entered', 'missed', 'open'] as const) lines.push(`${cls.padEnd(8)}: ${fadeEligible.filter((r) => r.fadeAfterStopClass === cls).length}`)
	lines.push(`same-stop-LTF ambiguous (not used): ${fadeEligible.filter((r) => r.fadeAfterStopAmbiguous).length}`)
	lines.push(`resolved fade: ${rowStats(fadeEligible, (r) => r.fadeAfterStopNetR)}`)
	for (const tf of args.htfs) lines.push(`${tf}: ${rowStats(fadeEligible.filter((r) => r.htf === tf), (r) => r.fadeAfterStopNetR)}`)
	lines.push('-- fade by symbol --')
	for (const symbol of args.symbols) lines.push(`${symbol.padEnd(12)} ${rowStats(fadeEligible.filter((r) => r.symbol === symbol), (r) => r.fadeAfterStopNetR)}`)

	lines.push('', '=== ONE OTE CYCLE AFTER CANON TP + MIRROR TP (research, first-5 kept only) ===')
	const cycleEligible = ote.filter((r) => !r.first5Skipped && r.result === 'tp' && r.mirrorResult === 'tp')
	lines.push(`double-TP parents eligible: ${cycleEligible.length}`)
	for (const cls of ['entered', 'missed', 'open'] as const) lines.push(`${cls.padEnd(8)}: ${cycleEligible.filter((r) => r.oteCycleClass === cls).length}`)
	lines.push(`same-mirror-exit-LTF ambiguous (not used): ${cycleEligible.filter((r) => r.oteCycleAmbiguous).length}`)
	lines.push(`resolved cycle: ${rowStats(cycleEligible, (r) => r.oteCycleNetR)}`)
	for (const tf of args.htfs) lines.push(`${tf}: ${rowStats(cycleEligible.filter((r) => r.htf === tf), (r) => r.oteCycleNetR)}`)
	lines.push('-- cycle by symbol --')
	for (const symbol of args.symbols) lines.push(`${symbol.padEnd(12)} ${rowStats(cycleEligible.filter((r) => r.symbol === symbol), (r) => r.oteCycleNetR)}`)

	lines.push('', 'Правило чтения: feature buckets — диагностика, не готовый фильтр. Same-LTF ambiguous не считается доказанным fill.')
	return lines.join('\n')
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2)), rows: AuditRow[] = []
	for (const symbol of args.symbols) {
		const ltf = await loadLtf(args, symbol)
		console.log(`${symbol}: ${ltf.length} ${args.ltf} candles`)
		for (const htf of args.htfs) {
			const part = buildRows(symbol, htf, args.ltf, ltf)
			rows.push(...part)
			console.log(`  ${htf}: ${part.length} resolved canon rows`)
		}
	}
	mkdirSync(RESULTS_DIR, { recursive: true })
	const stamp = new Date().toISOString().replaceAll(':', '-')
	const base = join(RESULTS_DIR, `execution-audit-${stamp}`)
	writeFileSync(`${base}.csv`, toCsv(rows))
	const text = report(rows, args)
	writeFileSync(`${base}.txt`, text + '\n')
	console.log(`\n${text}\n\nCSV: ${base}.csv\nTXT: ${base}.txt`)
}

main().catch((error) => { console.error('Fatal:', error instanceof Error ? error.message : error); process.exit(1) })
