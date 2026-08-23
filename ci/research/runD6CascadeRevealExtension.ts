/**
 * D6 cascade reversion — EXTENSION REVEAL (preregistration №2, одноразовый).
 *
 * Та же замороженная конфигурация, что в runD6CascadeReveal.ts (пороги/гэп/руки/гейты/seed
 * неизменны — см. d6-cascade-preregistration-extension.md), но тестовый набор = ПОЛНАЯ история
 * 11 symbol-fresh перпов (не участвовали ни в census, ни в первом reveal).
 *
 * Preregistration №2 SHA-256: 8ebe66068de7b148166e066d1c316786b7dec64ccc53c51fb3803b7efcd3ef4c
 * Запуск: npx tsx ci/research/runD6CascadeRevealExtension.ts   (метрики кэшируются, докачивает)
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands } from '../../src/core/signals/ApexEngine.js'
import { arrowAtr200 } from '../../src/core/signals/ArrowSignalEngine.js'
import type { ArrowSignal } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayAdmittedArrowSignals } from '../../src/core/signals/ArrowTradeReplay.js'
import { alignArchiveMetrics, fetchArchiveMetrics } from '../../tools/shared/archiveMetrics.js'
import { fundingContributionR, pairedDeltaPerBaselineOpportunity, pairedUtcDayClusterBootstrap, type PairedOpportunity, type SettledFunding } from './lib/own2FundingSignResearch.js'

const PREREG_PATH = 'ci-results/d6-cascade-preregistration-extension.md'
const PREREG_SHA256 = '8ebe66068de7b148166e066d1c316786b7dec64ccc53c51fb3803b7efcd3ef4c'
const MANIFEST_PATH = 'data/own2-thin-bigcorpus/manifest.json'
const MANIFEST_SHA256 = '5fa7d805e4d7c237cc110cc9ad30bfbcdd488f59fac7e9df5bc4291ac2725c50'
const DATA_DIR = 'data/own2-thin-bigcorpus'
const OUT_JSON = 'ci-results/d6-cascade-extension-results.json'
const OUT_MD = 'ci-results/d6-cascade-extension-results.md'
const HOUR = 3_600_000
const WINDOW_BARS = 8
const OI_DROP = -0.15
const PRICE_DROP = -0.03
const GAP_BARS = 8
const HOLD_BARS = 24
const ROUND_TRIP_COST = 0.001
const SAMPLES = 10_000
const SEED = 23_082_026

const UNIVERSE_EXT = [
	'XLMUSDT', 'XMRUSDT', 'TRXUSDT', 'DOTUSDT', 'INJUSDT', 'FETUSDT',
	'1000BONKUSDT', 'CRVUSDT', 'PORTALUSDT', 'HBARUSDT', 'ETCUSDT',
]

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const fileHash = (path: string): string => sha256(readFileSync(resolve(path)))
const iso = (x: number): string => new Date(x).toISOString()
const dayKey = (x: number): string => iso(x).slice(0, 10)
const fmt = (x: number | null | undefined, d = 5): string => x == null || !Number.isFinite(x) ? 'n/a' : x.toFixed(d)
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)

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

function dayClusterMeanCi(rows: ReadonlyArray<{ day: string; v: number }>): { lower: number; median: number; upper: number } {
	const groups = new Map<string, number[]>()
	for (const row of rows) {
		const g = groups.get(row.day) ?? []
		g.push(row.v)
		groups.set(row.day, g)
	}
	const days = [...groups.keys()].sort()
	if (!days.length) return { lower: NaN, median: NaN, upper: NaN }
	const random = rng(SEED)
	const means: number[] = []
	for (let s = 0; s < SAMPLES; s++) {
		let total = 0
		let count = 0
		for (let i = 0; i < days.length; i++) {
			for (const v of groups.get(days[Math.floor(random() * days.length)]!)!) { total += v; count++ }
		}
		if (count) means.push(total / count)
	}
	means.sort((a, b) => a - b)
	const q = (p: number): number => means[Math.min(means.length - 1, Math.floor(p * means.length))]!
	return { lower: q(0.025), median: q(0.5), upper: q(0.975) }
}

interface TradeStat { v: number; symbol: string; day: string; outcome?: string; signalAt?: number }

interface ArmStat {
	n: number
	mean: number | null
	total: number
	pf: number | null
	wr: number | null
	maxDd: number
	outcomes?: Record<string, number>
	ci95: { lower: number; median: number; upper: number }
	gatePower: boolean
	verdict: 'GO' | 'KILL' | 'INCONCLUSIVE DATA'
}

function evaluate(rows: readonly TradeStat[]): ArmStat {
	const values = rows.map((r) => r.v).filter(Number.isFinite)
	const gains = sum(values.filter((x) => x > 0))
	const losses = -sum(values.filter((x) => x < 0))
	let equity = 0
	let peak = 0
	let dd = 0
	for (const v of values) { equity += v; peak = Math.max(peak, equity); dd = Math.max(dd, peak - equity) }
	const outcomes: Record<string, number> = {}
	for (const r of rows) if (r.outcome != null) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1
	const ci95 = dayClusterMeanCi(rows.map((r) => ({ day: r.day, v: r.v })))
	const gatePower = values.length >= 100
	return {
		n: values.length,
		mean: values.length ? sum(values) / values.length : null,
		total: sum(values),
		pf: losses > 0 ? gains / losses : gains > 0 ? Number.POSITIVE_INFINITY : null,
		wr: values.length ? values.filter((x) => x > 0).length / values.length : null,
		maxDd: dd,
		outcomes: Object.keys(outcomes).length ? outcomes : undefined,
		ci95,
		gatePower,
		verdict: !gatePower ? 'INCONCLUSIVE DATA' : ci95.lower > 0 ? 'GO' : 'KILL',
	}
}

// Ссылки на funding-ряды по символам для fundingLayer.
const loadedRef: { items: Array<{ symbol: string; funding: SettledFunding[] }> } = { items: [] }

function fundingLayer(rows: ReadonlyArray<{ symbol: string; signalAt: number; value: number }>): { pairedDelta: number; ci: { lower: number; median: number; upper: number }; retainedN: number; retainedExecutedMean: number | null } {
	const bySymbol = new Map<string, SettledFunding[]>(loadedRef.items.map((x) => [x.symbol, x.funding]))
	const paired: PairedOpportunity[] = rows.map((r) => {
		const funding = bySymbol.get(r.symbol) ?? []
		let last: SettledFunding | null = null
		for (const s of funding) { if (s.timestamp < r.signalAt) last = s; else break }
		const retained = last != null && last.rate < 0
		return { symbol: r.symbol, timeframe: '1h', decisionAt: r.signalAt, baselineNetR: r.value, filteredNetR: retained ? r.value : 0, retained }
	})
	const retainedValues = paired.filter((p) => p.retained).map((p) => p.baselineNetR)
	return {
		pairedDelta: pairedDeltaPerBaselineOpportunity(paired),
		ci: pairedUtcDayClusterBootstrap(paired, SAMPLES, SEED),
		retainedN: retainedValues.length,
		retainedExecutedMean: retainedValues.length ? sum(retainedValues) / retainedValues.length : null,
	}
}

interface Loaded { symbol: string; candles: Candle[]; oi: Array<number | null>; funding: SettledFunding[]; atr200: number[] }

async function main(): Promise<void> {
	if (fileHash(PREREG_PATH) !== PREREG_SHA256) throw new Error('Immutable D6 extension preregistration hash mismatch')
	if (fileHash(MANIFEST_PATH) !== MANIFEST_SHA256) throw new Error('Immutable acquisition manifest hash mismatch')
	const manifest = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8')) as { symbols: Array<{ symbol: string; candleFile: string; candleSha256: string; dropped: boolean }> }
	const survivorsAll = manifest.symbols.filter((s) => !s.dropped)

	const loaded: Loaded[] = []
	for (const symbol of UNIVERSE_EXT) {
		const entry = survivorsAll.find((s) => s.symbol === symbol)
		if (entry == null) throw new Error(`${symbol} отсутствует в манифесте корпуса`)
		if (fileHash(resolve(DATA_DIR, entry.candleFile)) !== entry.candleSha256) throw new Error(`${symbol}: candle hash mismatch`)
		const candles = JSON.parse(readFileSync(resolve(DATA_DIR, entry.candleFile), 'utf8')) as Candle[]
		console.log(`${symbol}: качаю метрики ${iso(candles[0]!.timestamp)} .. ${iso(candles[candles.length - 1]!.timestamp)} …`)
		const points = await fetchArchiveMetrics(symbol, candles[0]!.timestamp, candles[candles.length - 1]!.timestamp + HOUR)
		const aligned = alignArchiveMetrics(points, candles)
		const funding = JSON.parse(readFileSync(resolve(DATA_DIR, `${symbol}-funding.json`), 'utf8')) as SettledFunding[]
		loaded.push({ symbol, candles, oi: aligned.oi, funding, atr200: arrowAtr200(candles) })
		loadedRef.items.push({ symbol, funding })
		console.log(`+ ${symbol}: баров ${candles.length}, метрик ${points.length}, покрытие OI ${(aligned.covered / candles.length * 100).toFixed(1)}%`)
	}

	// --- Детекция событий по ПОЛНОЙ истории каждого символа ---
	interface Event { symbol: string; index: number; signalAt: number; entryIndex: number }
	const events: Event[] = []
	const perSymbolEvents: Record<string, number> = {}
	for (const item of loaded) {
		const closes = item.candles.map((c) => c.close)
		let count = 0
		let lastAdmitted = -Infinity
		for (let i = WINDOW_BARS; i + 1 < item.candles.length; i++) {
			const oiNow = item.oi[i]
			const oiPast = item.oi[i - WINDOW_BARS]!
			if (oiNow == null || oiPast == null || oiPast <= 0) continue
			const dOi = oiNow / oiPast - 1
			const dP = closes[i]! / closes[i - WINDOW_BARS]! - 1
			if (!(dOi <= OI_DROP && dP <= PRICE_DROP)) continue
			if (i - lastAdmitted < GAP_BARS) continue
			lastAdmitted = i
			events.push({ symbol: item.symbol, index: i, signalAt: item.candles[i]!.timestamp, entryIndex: i + 1 })
			count++
		}
		perSymbolEvents[item.symbol] = count
	}
	console.log(`\nСобытий всего: ${events.length}; по символам: ${JSON.stringify(perSymbolEvents)}`)

	// --- ARM H24 ---
	let h24ExcludedNoHorizon = 0
	const h24Stats: TradeStat[] = []
	const h24Gross: number[] = []
	for (const ev of events) {
		const item = loaded.find((l) => l.symbol === ev.symbol)!
		const exitIdx = ev.entryIndex + HOLD_BARS - 1
		if (exitIdx > item.candles.length - 1) { h24ExcludedNoHorizon++; continue }
		const entryBar = item.candles[ev.entryIndex]!
		const exitBar = item.candles[exitIdx]!
		let fundingQuote = 0
		for (const row of item.funding) {
			if (row.timestamp < entryBar.timestamp || row.timestamp >= exitBar.timestamp) continue
			fundingQuote += -row.rate * row.markPrice // long, units=1
		}
		const fundingPct = fundingQuote / entryBar.open
		const priceRet = exitBar.close / entryBar.open - 1
		h24Gross.push(priceRet + fundingPct)
		h24Stats.push({ v: priceRet + fundingPct - ROUND_TRIP_COST, symbol: ev.symbol, day: dayKey(entryBar.timestamp), outcome: 'h24', signalAt: ev.signalAt })
	}

	// --- ARM CANON ---
	const canonRows: Array<TradeStat & { grossR0: number }> = []
	for (const item of loaded) {
		const bands = computeApexBands(item.candles)
		const sigs: ArrowSignal[] = []
		for (const ev of events.filter((e) => e.symbol === item.symbol)) {
			const band = bands[ev.index]
			const atr = item.atr200[ev.index]
			if (band == null || !Number.isFinite(atr) || atr <= 0) continue
			sigs.push({
				version: 'd6-cascade-synthetic-long',
				signalIndex: ev.index,
				signalAt: ev.signalAt,
				side: 'long',
				close: item.candles[ev.index]!.close,
				mean: band.mean,
				inner: band.greenLo,
				outer: band.greenLo * 0.98,
				atr200: atr,
				trigger: { family: 'own2-extension', penetrationInner: 0, distanceMeanPct: 0, relativeVolume: 0 },
			})
		}
		if (!sigs.length) continue
		const replay5 = replayAdmittedArrowSignals(item.candles, bands, sigs, 'safe', { fullFixAtMean: false, addEnabled: true, oneWayCostBps: 5 })
		const replay0 = replayAdmittedArrowSignals(item.candles, bands, sigs, 'safe', { fullFixAtMean: false, addEnabled: true, oneWayCostBps: 0 })
		for (let k = 0; k < replay5.trades.length; k++) {
			const t5 = replay5.trades[k]!
			if (t5.outcome === 'open') continue
			const t0 = replay0.trades[k]!
			const fR = fundingContributionR(t5, item.funding)
			canonRows.push({ v: t5.netR + fR, symbol: item.symbol, day: dayKey(t5.entryAt), outcome: t5.outcome, signalAt: t5.signalAt, grossR0: t0.grossR })
		}
	}
	console.log(`ARM H24: сделок ${h24Stats.length} (исключено без горизонта: ${h24ExcludedNoHorizon}); ARM CANON: сделок ${canonRows.length}`)

	const armH24 = evaluate(h24Stats)
	const armCanon = evaluate(canonRows)
	const lineVerdict: 'GO' | 'KILL' | 'INCONCLUSIVE DATA' = [armH24.verdict, armCanon.verdict].includes('GO')
		? 'GO'
		: [armH24.verdict, armCanon.verdict].every((v) => v === 'INCONCLUSIVE DATA') ? 'INCONCLUSIVE DATA' : 'KILL'

	const h24Fund = fundingLayer(h24Stats.map((r) => ({ symbol: r.symbol, signalAt: r.signalAt ?? 0, value: r.v })))
	const canonFund = fundingLayer(canonRows.map((r) => ({ symbol: r.symbol, signalAt: r.signalAt ?? 0, value: r.v })))

	writeFileSync(resolve(OUT_JSON), JSON.stringify({
		studyId: 'd6-cascade-extension',
		generatedAt: new Date().toISOString(),
		lineVerdict,
		preregistrationExtensionSha256: PREREG_SHA256,
		basePreregistrationNote: 'config identical to d6-cascade-preregistration.md a7fa407a…',
		acquisitionManifestSha256: MANIFEST_SHA256,
		universe: UNIVERSE_EXT,
		eventsTotal: events.length,
		perSymbolEvents,
		h24ExcludedNoHorizon,
		armH24: { ...armH24, grossMeanDescriptive: h24Gross.length ? sum(h24Gross) / h24Gross.length : null },
		armCanon: { ...armCanon, grossMeanRDescriptive: canonRows.length ? sum(canonRows.map((r) => r.grossR0)) / canonRows.length : null },
		fundingSignDiagnostics: { h24: h24Fund, canon: canonFund },
		limitations: [
			'Symbol-fresh дизайн: календарь пересекается с dev первого исследования, символы ранее не открывались.',
			'OI-proxy каскадов, не прямые ликвидации; покрытие метрик у части символов <100%.',
			'После reveal эти символы сожжены для гипотезы; ретюны запрещены.',
		],
	}, null, 2))

	const md = [
		'# D6 cascade reversion — EXTENSION REVEAL (11 symbol-fresh перпов)',
		'',
		`# Вердикт расширения: \`${lineVerdict}\``,
		'',
		`> Конфигурация идентична первому протоколу (ΔOI_8h≤−15% И ΔP_8h≤−3%, LONG next-open, gap 8). Тест = вся история символов, ранее не открывавшихся. Prereg №2 \`${PREREG_SHA256.slice(0, 8)}…\`.`,
		'',
		`События: ${events.length} (по символам: ${Object.entries(perSymbolEvents).map(([s, c]) => `${s.replace('USDT', '')}:${c}`).join(', ')}); без горизонта H24 исключено ${h24ExcludedNoHorizon}.`,
		'',
		`## ARM H24 (net % @5bps + funding) — \`${armH24.verdict}\``,
		`- N=${armH24.n}; mean ${fmt(armH24.mean! * 100, 4)}%; total ${fmt(armH24.total * 100, 2)}%; PF ${fmt(armH24.pf, 3)}; WR ${fmt(armH24.wr! * 100, 1)}%; maxDD ${fmt(armH24.maxDd * 100, 1)}%.`,
		`- **UTC-day cluster CI95: [${fmt(armH24.ci95.lower * 100, 4)}%; ${fmt(armH24.ci95.upper * 100, 4)}%]**, median ${fmt(armH24.ci95.median * 100, 4)}%.`,
		`- Gross@0 mean дескриптивно: ${fmt((h24Gross.length ? sum(h24Gross) / h24Gross.length : null)! * 100, 4)}%.`,
		'',
		`## ARM CANON (движок safe, netR @5bps + funding) — \`${armCanon.verdict}\``,
		`- N=${armCanon.n}; mean ${fmt(armCanon.mean, 4)}R; total ${fmt(armCanon.total, 2)}R; PF ${fmt(armCanon.pf, 3)}; WR ${fmt(armCanon.wr! * 100, 1)}%; maxDD ${fmt(armCanon.maxDd, 1)}R.`,
		`- Исходы: ${JSON.stringify(armCanon.outcomes ?? {})}.`,
		`- **UTC-day cluster CI95: [${fmt(armCanon.ci95.lower, 4)}; ${fmt(armCanon.ci95.upper, 4)}]R**, median ${fmt(armCanon.ci95.median, 4)}R.`,
		'',
		'## Funding-sign диагностика (в гейты не входит)',
		`- H24: paired delta ${fmt(h24Fund.pairedDelta * 100, 4)}%/opportunity, CI95 [${fmt(h24Fund.ci.lower * 100, 4)}; ${fmt(h24Fund.ci.upper * 100, 4)}], retained N=${h24Fund.retainedN}, executed mean ${fmt(h24Fund.retainedExecutedMean! * 100, 4)}%.`,
		`- CANON: paired delta ${fmt(canonFund.pairedDelta, 4)}R/opportunity, CI95 [${fmt(canonFund.ci.lower, 4)}; ${fmt(canonFund.ci.upper, 4)}], retained N=${canonFund.retainedN}, executed mean ${fmt(canonFund.retainedExecutedMean, 4)}R.`,
		'',
		'## Гейты и терминальность',
		'- GO ⇔ хотя бы одна co-primary рука: N≥100 И lower95>0. После reveal символы сожжены.',
		'',
		'## Provenance',
		`- prereg №2 \`${PREREG_SHA256}\`; манифест корпуса \`${MANIFEST_SHA256}\`; seed ${SEED}.`,
	]
	writeFileSync(resolve(OUT_MD), md.join('\n'))

	console.log(`\nEXTENSION LINE VERDICT: ${lineVerdict}`)
	console.log(`ARM H24:   N=${armH24.n} mean=${fmt(armH24.mean! * 100, 4)}% CI95=[${fmt(armH24.ci95.lower * 100, 4)}; ${fmt(armH24.ci95.upper * 100, 4)}]% → ${armH24.verdict}`)
	console.log(`ARM CANON: N=${armCanon.n} mean=${fmt(armCanon.mean, 4)}R CI95=[${fmt(armCanon.ci95.lower, 4)}; ${fmt(armCanon.ci95.upper, 4)}]R → ${armCanon.verdict}`)
	console.log('Записано: ci-results/d6-cascade-extension-results.{json,md}')
}

void main()
