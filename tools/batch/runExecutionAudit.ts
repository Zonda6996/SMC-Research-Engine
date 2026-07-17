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
import { bigbarCovered } from '../../src/core/analysis/entryModels.js'
import { BATTLE_CONFIG, gridLevelPrice } from '../../src/strategy/battleConfig.js'
import { replayTrade } from '../forward/forwardRunner.js'
import {
	aggregateCandles,
	fetchCandlesPaginated,
	MAX_CANDLES_LTF,
	TF_MS,
	type MarketKind,
} from '../shared/candleFetcher.js'
import type { Candle } from '../../src/models/price/Candle.js'
import type { FibSetupOutcome } from '../../src/models/fib/FibLifecycle.js'

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
	mirrorClass: '' | 'same-htf-valid' | 'next-htf' | 'missed' | 'open'
	mirrorAmbiguousSameLtf: boolean
	mirrorPreFill100: boolean
	mirrorFillAt: number | null
	mirrorNetR: number | null
	mirrorResult: string
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

function buildRows(symbol: string, htf: string, ltfTf: string, ltf: Candle[]): AuditRow[] {
	const candles = ltfTf === htf ? ltf : aggregateCandles(ltf, ltfTf, htf)
	const snapshot = runAnalysis(candles)
	const candidateById = new Map(snapshot.fib.candidates.map((c) => [c.id, c]))
	const htfMs = TF_MS[htf]!, groups = bucketLtf(ltf, htfMs)
	const rows: AuditRow[] = []

	for (const outcome of selectedOutcomes(snapshot.fibLifecycle.outcomes)) {
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
		const row: AuditRow = {
			symbol, htf, scenario, direction: outcome.direction,
			entryAt: htfEntryCandle.timestamp, entryIndex: outcome.entryIndex, entryPrice: entry,
			netR: trade.netR, result: trade.result, bigbar: bigbarCovered(candles, outcome.createdAtIndex, outcome.entryIndex + 1,
				at(scenario === 'ote' ? 61.8 : 23.6), at(scenario === 'ote' ? 78.6 : 38.2)),
			atr, touchLtfAt: touch.candle.timestamp, touchOffset: touch.offset, touchOffsetFrac: touch.offset / items.length,
			lastBodyAtr: last ? norm(adverseBody(last, long)) : null,
			last3NetAtr: first && last ? norm(adverseNet(first, last, long)) : null,
			last3RangeAtr: pre.length ? norm(pre.reduce((s, c) => s + c.high - c.low, 0)) : null,
			last3AdverseShare: pre.length ? pre.filter((c) => adverseBody(c, long) > 0).length / pre.length : null,
			distanceBeforeTouchAtr: last ? norm(Math.max(0, distanceToEntry(last.close, entry, long))) : null,
			mirrorClass: '', mirrorAmbiguousSameLtf: false, mirrorPreFill100: false,
			mirrorFillAt: null, mirrorNetR: null, mirrorResult: '',
		}

		if (scenario === 'ote') {
			const mirror = BATTLE_CONFIG.reverse[0]!
			const mEntry = at(mirror.entry), reverseLong = !long
			row.mirrorPreFill100 = items.slice(0, touch.offset).some((x) => reverseLong ? x.candle.low <= mEntry : x.candle.high >= mEntry)
			row.mirrorAmbiguousSameLtf = reverseLong ? touch.candle.low <= mEntry : touch.candle.high >= mEntry
			const mirrorTrade = replayTrade(ltf, touch.index + 1, reverseLong, mEntry, at(mirror.stop), at(mirror.take), at(mirror.cancelBeyond), null)
			if (mirrorTrade.status === 'done' || mirrorTrade.status === 'open') {
				const fill = ltf[mirrorTrade.fillIndex]!
				row.mirrorClass = fill.timestamp < htfEntryCandle.timestamp + htfMs ? 'same-htf-valid' : 'next-htf'
				row.mirrorFillAt = fill.timestamp
				if (mirrorTrade.status === 'done') { row.mirrorNetR = mirrorTrade.netR; row.mirrorResult = mirrorTrade.result }
				else row.mirrorClass = 'open'
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
		`LTF ${args.ltf}, limit ${args.limit}, symbols ${args.symbols.length}, HTF ${args.htfs.join('/')}`,
		`range ${rangeStart} → ${rangeEnd}`,
		'', '=== EXECUTABLE CANON ===',
	]
	for (const sc of ['deep', 'ote'] as const) lines.push(`${sc}: ${rowStats(rows.filter((r) => r.scenario === sc))}`)
	for (const tf of args.htfs) lines.push(`${tf}: ${rowStats(rows.filter((r) => r.htf === tf))}`)
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
	lines.push('', 'Правило чтения: feature buckets — диагностика, не готовый фильтр. Same-5m ambiguous не считается доказанным mirror fill.')
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
