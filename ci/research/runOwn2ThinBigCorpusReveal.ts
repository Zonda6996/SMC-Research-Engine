/**
 * OWN2-thinned big-corpus — REVEAL (ОДНОРАЗОВЫЙ, терминальный).
 *
 * Единственная замороженная рука (prereg §4 в редакции amendments 1–3):
 *   канонический OWN2 (relVol 1.4) → admitArrowSignals(spacing=180) →
 *   replayAdmittedArrowSignals('safe', { fullFixAtMean:false, addEnabled:true, stopSteps:2 }):
 *   стоп = 2×step, step = 5.5×atr200 (ширина определяется ТФ и волатильностью),
 *   добор entry∓step = ровно середина между entry и стопом.
 * Primary endpoint: pooled mean (netR@5bps + фактический direction-aware funding) по resolved-
 * сделкам; UTC-day cluster bootstrap CI95, 10k, seed 22082026.
 * Гейты: opportunities≥250 И resolved≥100; GO ⇔ lower95>0; иначе KILL / INCONCLUSIVE DATA.
 * Reference (описательно): та же рука без прореживания (spacing=0).
 * Secondary (диагностика, без влияния на вердикт): funding-sign paired delta (lib own2FundingSign).
 *
 * Хеши пинуются жёстко; любой mismatch блокирует запуск. Повторный запуск перезапишет отчёт,
 * но корпус после первого reveal считается сожжённым (терминальность §6).
 *
 * Preregistration SHA-256: fb07e29fb4b727303d1d0c316249501b745420562f54d8804c7ad6a202d86886
 * Amendment №1 SHA-256:    6866f1c57aa2f04fa52c73c1242580d3497e5b13ae7180881e9ec665c7a26c40
 * Amendment №2 SHA-256:    1be3164acf82854e61fadc25cb4375d43a02628334d9822abde9e6da894dd17e
 * Amendment №3 SHA-256:    3f958552f29550ed70087d15167e812a5e690a584151d29ed0f625dc5676f869
 * Запуск: npx tsx ci/research/runOwn2ThinBigCorpusReveal.ts
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { computeApexBands } from '../../src/core/signals/ApexEngine.js'
import { admitArrowSignals, ARROW_SIGNAL_SPACING_BARS, detectArrowSignalsFromBands, type ArrowSignal } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayAdmittedArrowSignals, type ArrowTrade } from '../../src/core/signals/ArrowTradeReplay.js'
import { decideFundingSign, fundingContributionR, pairedDeltaPerBaselineOpportunity, pairedUtcDayClusterBootstrap, type PairedOpportunity, type SettledFunding } from './lib/own2FundingSignResearch.js'
import { OWN2_CONFIG } from './runOwn2ThinBigCorpusCalibrate.js'

const PREREG_PATH = 'ci-results/own2-thin-bigcorpus-preregistration.md'
const PREREG_SHA256 = 'fb07e29fb4b727303d1d0c316249501b745420562f54d8804c7ad6a202d86886'
const AMENDMENT1_PATH = 'ci-results/own2-thin-bigcorpus-amendment-1.md'
const AMENDMENT1_SHA256 = '6866f1c57aa2f04fa52c73c1242580d3497e5b13ae7180881e9ec665c7a26c40'
const AMENDMENT2_PATH = 'ci-results/own2-thin-bigcorpus-amendment-2.md'
const AMENDMENT2_SHA256 = '1be3164acf82854e61fadc25cb4375d43a02628334d9822abde9e6da894dd17e'
const MANIFEST_PATH = 'data/own2-thin-bigcorpus/manifest.json'
const MANIFEST_SHA256 = '5fa7d805e4d7c237cc110cc9ad30bfbcdd488f59fac7e9df5bc4291ac2725c50'
const AMENDMENT3_PATH = 'ci-results/own2-thin-bigcorpus-amendment-3.md'
const AMENDMENT3_SHA256 = '3f958552f29550ed70087d15167e812a5e690a584151d29ed0f625dc5676f869'
const DATA_DIR = 'data/own2-thin-bigcorpus'
const OUT_JSON = 'ci-results/own2-thin-bigcorpus-results.json'
const OUT_MD = 'ci-results/own2-thin-bigcorpus-results.md'
const SAMPLES = 10_000
const SEED = 22_082_026

interface ManifestSymbol { symbol: string; candleFile: string; candleSha256: string; dropped: boolean }

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

/** Joint UTC-day cluster bootstrap для pooled mean. */
function dayClusterMeanCi(rows: ReadonlyArray<{ day: string; v: number }>, samples: number, seed: number): { lower: number; median: number; upper: number } {
	const groups = new Map<string, number[]>()
	for (const row of rows) {
		const group = groups.get(row.day) ?? []
		group.push(row.v)
		groups.set(row.day, group)
	}
	const days = [...groups.keys()].sort()
	if (!days.length || !rows.length) return { lower: NaN, median: NaN, upper: NaN }
	const random = rng(seed)
	const means: number[] = []
	for (let sample = 0; sample < samples; sample++) {
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

interface StatInput { v: number; side: 'long' | 'short'; outcome: string; holdingBars: number }

interface Metrics {
	n: number
	totalR: number
	meanR: number | null
	pf: number | null
	wr: number | null
	maxDdR: number
	long: number
	short: number
	medianHoldingBars: number | null
	outcomes: Record<string, number>
}

const toStat = (t: ArrowTrade, v: number): StatInput => ({ v, side: t.side, outcome: t.outcome, holdingBars: t.holdingBars })

function stats(items: readonly StatInput[]): Metrics {
	const ordered = [...items].filter((x) => Number.isFinite(x.v))
	const gains = sum(ordered.filter((x) => x.v > 0).map((x) => x.v))
	const losses = -sum(ordered.filter((x) => x.v < 0).map((x) => x.v))
	let equity = 0
	let peak = 0
	let maxDdR = 0
	for (const x of ordered) { equity += x.v; peak = Math.max(peak, equity); maxDdR = Math.max(maxDdR, peak - equity) }
	const holding = ordered.map((x) => x.holdingBars).sort((a, b) => a - b)
	const outcomes: Record<string, number> = {}
	for (const x of ordered) outcomes[x.outcome] = (outcomes[x.outcome] ?? 0) + 1
	return {
		n: ordered.length,
		totalR: sum(ordered.map((x) => x.v)),
		meanR: ordered.length ? sum(ordered.map((x) => x.v)) / ordered.length : null,
		pf: losses > 0 ? gains / losses : gains > 0 ? Number.POSITIVE_INFINITY : null,
		wr: ordered.length ? ordered.filter((x) => x.v > 0).length / ordered.length : null,
		maxDdR,
		long: ordered.filter((x) => x.side === 'long').length,
		short: ordered.filter((x) => x.side === 'short').length,
		medianHoldingBars: holding.length ? holding[Math.floor(holding.length / 2)]! : null,
		outcomes,
	}
}

async function main(): Promise<void> {
	if (fileHash(PREREG_PATH) !== PREREG_SHA256) throw new Error('Immutable preregistration hash mismatch')
	if (fileHash(AMENDMENT1_PATH) !== AMENDMENT1_SHA256) throw new Error('Immutable amendment 1 hash mismatch')
	if (fileHash(AMENDMENT2_PATH) !== AMENDMENT2_SHA256) throw new Error('Immutable amendment 2 hash mismatch')
	if (fileHash(AMENDMENT3_PATH) !== AMENDMENT3_SHA256) throw new Error('Immutable amendment 3 hash mismatch')
	if (fileHash(MANIFEST_PATH) !== MANIFEST_SHA256) throw new Error('Immutable acquisition manifest hash mismatch')

	const manifest = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8')) as { symbols: ManifestSymbol[] }
	const survivors = manifest.symbols.filter((s) => !s.dropped)

	interface Loaded { symbol: string; candles: Candle[]; bands: ReturnType<typeof computeApexBands>; candidates: ArrowSignal[]; admitted: ArrowSignal[]; funding: SettledFunding[]; candidatesCount: number; admittedCount: number }
	const loaded: Loaded[] = []
	for (const entry of survivors) {
		if (fileHash(resolve(DATA_DIR, entry.candleFile)) !== entry.candleSha256) throw new Error(`${entry.symbol}: candle hash mismatch`)
		const candles = JSON.parse(readFileSync(resolve(DATA_DIR, entry.candleFile), 'utf8')) as Candle[]
		const bands = computeApexBands(candles)
		const detection = detectArrowSignalsFromBands(candles, bands, OWN2_CONFIG)
		const candidates = detection.candidates as ArrowSignal[]
		const admitted = admitArrowSignals(candidates, ARROW_SIGNAL_SPACING_BARS)
		loaded.push({ symbol: entry.symbol, candles, bands, candidates, admitted, funding: [], candidatesCount: candidates.length, admittedCount: admitted.length })
		console.log(`${entry.symbol}: candidates ${candidates.length}, admitted ${admitted.length}`)
	}

	// --- Исходы вычисляются только ниже этой строки ---
	interface EconRow { symbol: string; side: 'long' | 'short'; decisionAt: number; trade: ArrowTrade; priceNet5: number; priceGross0: number; fundingR: number; netF5: number; retained: boolean; decision: string }
	const rows: EconRow[] = []
	const refRows: Array<{ symbol: string; trade: ArrowTrade }> = []
	for (const item of loaded) {
		const funding = JSON.parse(readFileSync(resolve(DATA_DIR, `${item.symbol}-funding.json`), 'utf8')) as SettledFunding[]
		item.funding = funding
		// Amendment №3: канонический safe — стоп 2×step (ТФ/волатильность через atr200),
		// добор entry∓step ровно посередине entry↔stop.
		const cfg = { fullFixAtMean: false as const, addEnabled: true, stopSteps: 2 }
		const thin0 = replayAdmittedArrowSignals(item.candles, item.bands, item.admitted, 'safe', { ...cfg, oneWayCostBps: 0 })
		const thin5 = replayAdmittedArrowSignals(item.candles, item.bands, item.admitted, 'safe', { ...cfg, oneWayCostBps: 5 })
		if (thin0.trades.length !== thin5.trades.length) throw new Error(`${item.symbol}: costs changed opportunity set`)
		for (let i = 0; i < thin5.trades.length; i++) {
			const trade5 = thin5.trades[i]!
			if (trade5.outcome === 'open') continue
			const zero = thin0.trades[i]!
			const decision = decideFundingSign(trade5.side, trade5.signalAt, item.funding)
			const fundingR = fundingContributionR(trade5, item.funding)
			rows.push({
				symbol: item.symbol,
				side: trade5.side,
				decisionAt: trade5.signalAt,
				trade: trade5,
				priceNet5: trade5.netR,
				priceGross0: zero.grossR,
				fundingR,
				netF5: trade5.netR + fundingR,
				retained: decision.decision === 'retain',
				decision: decision.decision,
			})
		}
		const ref = replayAdmittedArrowSignals(item.candles, item.bands, item.candidates, 'safe', { ...cfg, oneWayCostBps: 5 })
		for (const trade of ref.trades) if (trade.outcome !== 'open') refRows.push({ symbol: item.symbol, trade })
		console.log(`${item.symbol}: resolved ${rows.length} (pooled so far), ref ${refRows.length}`)
	}

	const opportunities = loaded.reduce((s, x) => s + x.admitted.length, 0)
	const resolved = rows.length
	const primaryValues = rows.map((r) => ({ day: dayKey(r.trade.entryAt), v: r.netF5 }))
	const ciPrimary = dayClusterMeanCi(primaryValues, SAMPLES, SEED)

	const paired: PairedOpportunity[] = rows.map((r) => ({ symbol: r.symbol, timeframe: '1h', decisionAt: r.decisionAt, baselineNetR: r.netF5, filteredNetR: r.retained ? r.netF5 : 0, retained: r.retained }))
	const ciPaired = pairedUtcDayClusterBootstrap(paired, SAMPLES, SEED)
	const pairedDelta = pairedDeltaPerBaselineOpportunity(paired)

	const statPrimary = stats(rows.map((r) => toStat(r.trade, r.netF5)))
	const statPriceNet5 = stats(rows.map((r) => toStat(r.trade, r.priceNet5)))
	const statPriceGross0 = stats(rows.map((r) => toStat(r.trade, r.priceGross0)))
	const statRetainedExecuted = stats(rows.filter((r) => r.retained).map((r) => toStat(r.trade, r.netF5)))
	const decisionsBreakdown = Object.fromEntries(['retain', 'veto-zero', 'veto-missing', 'veto-sign'].map((d) => [d, rows.filter((r) => r.decision === d).length]))
	const refStat = stats(refRows.map((x) => toStat(x.trade, x.trade.netR)))

	const gates = {
		opportunitiesAtLeast250: opportunities >= 250,
		resolvedAtLeast100: resolved >= 100,
		ciLowerPositive: ciPrimary.lower > 0,
	}
	const nFail = !gates.opportunitiesAtLeast250 || !gates.resolvedAtLeast100
	const verdict = nFail ? 'INCONCLUSIVE DATA' : gates.ciLowerPositive ? 'GO' : 'KILL'

	const result = {
		studyId: 'own2-thin-bigcorpus',
		generatedAt: new Date().toISOString(),
		verdict,
		frozenRuleChangedAfterReveal: false,
		terminal: true,
		universe: { survivors: survivors.map((s) => s.symbol), cutoffUtc: iso(Date.parse('2026-08-22T00:00:00.000Z')), globallyUntouchedSymbols: true },
		provenance: {
			preregistrationSha256: PREREG_SHA256,
			amendment1Sha256: AMENDMENT1_SHA256,
			amendment2Sha256: AMENDMENT2_SHA256,
			amendment3Sha256: AMENDMENT3_SHA256,
			acquisitionManifestSha256: MANIFEST_SHA256,
		},
		config: {
			stopSteps: 2,
			stepDefinition: '5.5 * atr200 / stepDivisor(safe=1) — ширина стопа определяется ТФ и волатильностью (Amendment №3)',
			addLevel: 'entry ∓ step = ровно середина между entry и стопом',
			spacingBars: ARROW_SIGNAL_SPACING_BARS,
			management: 'safe dynamic-partial, partialFraction 0.25 at mean, full target opposite inner band, addEnabled=true, fullFixAtMean=false',
			costsBpsPerSide: { grossCeiling: 0, primaryTaker: 5 },
			bootstrap: { cluster: 'joint UTC day', samples: SAMPLES, seed: SEED },
		},
		counts: { opportunities, resolved, decisionsBreakdown },
		primary: { metric: 'pooled mean (netR@5bps + actual funding)', ...statPrimary, ci95: ciPrimary },
		diagnostics: {
			priceOnlyNet5: statPriceNet5,
			priceOnlyGross0: statPriceGross0,
			retainedExecutedSecondary: statRetainedExecuted,
			pairedDeltaMeanROpportunity: pairedDelta,
			pairedCi95: ciPaired,
			referenceUnthinnedNet5: refStat,
		},
		gates,
		limitations: [
			'Символы вселенной ранее не исследовались проектом, но сам рынок общий с прошлыми корпусами.',
			'Стоп = 2×step (ATR200-масштаб по ТФ); добор entry∓step; каноническая механика без свободных параметров (Amendment №3).',
			'После этого reveal корпус сожжён для данной гипотезы: retune/rescue/subgroup запрещены (§6).',
		],
	}
	writeFileSync(resolve(OUT_JSON), JSON.stringify(result, null, 2))

	const perSymbolLines = survivors.map((s) => {
		const rs = rows.filter((r) => r.symbol === s.symbol)
		const st = stats(rs.map((r) => toStat(r.trade, r.netF5)))
		return `| ${s.symbol} | ${st.n} | ${fmt(st.totalR, 2)} | ${fmt(st.meanR, 4)} | ${st.pf != null ? fmt(st.pf, 3) : 'n/a'} | ${st.wr != null ? (st.wr * 100).toFixed(1) + '%' : 'n/a'} |`
	})

	const md = [
		'# OWN2-thinned big-corpus — FROZEN REVEAL (терминальный)',
		'',
		`# Вердикт: \`${verdict}\``,
		'',
		'## Замороженная рука',
		`- Канонический OWN2 (relVol 1.4) → spacing **${ARROW_SIGNAL_SPACING_BARS} баров** → каждая стрелка = своя сделка.`,
		'- Стоп: **2×step**, step = 5.5·atr200 — ширина определяется ТФ и волатильностью (Amendment №3).',
		'- Добор: **entry ∓ step** — ровно середина между entry и стопом.',
		'- Менеджмент safe/dynamic-partial: частичка 25% у mean, полный тейк у противоположной внутренней полосы, fullFixAtMean=false.',
		'- Primary: pooled mean (netR@5bps/side + фактический funding). Reference без прореживания — дескриптивно.',
		'',
		'## Поток наблюдений',
		`- Символов: ${survivors.length}; допущенных возможностей: ${opportunities}; resolved: ${resolved}.`,
		`- Funding decisions: ${JSON.stringify(decisionsBreakdown)}; retained ${decisionsBreakdown['retain'] ?? 0}.`,
		'',
		'## Агрегат (primary, net@5bps + funding)',
		`- N=${statPrimary.n}, total ${fmt(statPrimary.totalR, 3)}R, mean ${fmt(statPrimary.meanR)}R/trade, PF ${fmt(statPrimary.pf, 4)}, WR ${statPrimary.wr != null ? (statPrimary.wr * 100).toFixed(2) + '%' : 'n/a'}, maxDD ${fmt(statPrimary.maxDdR, 2)}R.`,
		`- Long/short: ${statPrimary.long}/${statPrimary.short}; исходы: ${JSON.stringify(statPrimary.outcomes)}.`,
		`- **UTC-day cluster bootstrap CI95: [${fmt(ciPrimary.lower)}, ${fmt(ciPrimary.upper)}]**, median ${fmt(ciPrimary.median)} (${SAMPLES}, seed ${SEED}).`,
		`- Дескриптивно: price-only net@5 mean ${fmt(statPriceNet5.meanR)}, gross@0 mean ${fmt(statPriceGross0.meanR)}.`,
		'',
		'## Secondary: funding-sign paired delta (диагностика)',
		`- Paired delta ${fmt(pairedDelta)}R/opportunity; paired UTC-day bootstrap CI95 [${fmt(ciPaired.lower)}, ${fmt(ciPaired.upper)}].`,
		`- Retained-executed: N=${statRetainedExecuted.n}, mean ${fmt(statRetainedExecuted.meanR)}.`,
		'',
		'## Reference: без прореживания (spacing=0, net@5, дескриптив)',
		`- N=${refStat.n}, total ${fmt(refStat.totalR, 2)}R, mean ${fmt(refStat.meanR)}, PF ${fmt(refStat.pf, 4)}, maxDD ${fmt(refStat.maxDdR, 2)}R.`,
		'',
		'## Per symbol (primary netF5)',
		'| symbol | resolved | totalR | meanR | PF | WR |',
		'|---|---:|---:|---:|---:|---:|',
		...perSymbolLines,
		'',
		'## Гейты и терминальность',
		`- Gates: ${JSON.stringify(gates)}.`,
		'- Классификация по prereg §5: event-gate fail → INCONCLUSIVE DATA; иначе GO ⇔ lower95>0, иначе KILL.',
		'- Корпус сожжён для этой гипотезы: retune/spacing/стопа/подвыборок/исключений — запрещено (§6).',
		'',
		'## Provenance',
		`- prereg \`${PREREG_SHA256}\`; amendment1 \`${AMENDMENT1_SHA256}\`; amendment2 \`${AMENDMENT2_SHA256}\`;`,
		`- amendment3 \`${AMENDMENT3_SHA256}\`; acquisition manifest \`${MANIFEST_SHA256}\`.`,
	]
	writeFileSync(resolve(OUT_MD), md.join('\n'))
	console.log(`\nVERDICT: ${verdict}`)
	console.log(`Primary mean ${fmt(statPrimary.meanR)}R; CI95 [${fmt(ciPrimary.lower)}, ${fmt(ciPrimary.upper)}]; N=${statPrimary.n}`)
	console.log('Записано: ci-results/own2-thin-bigcorpus-results.{json,md}')
}

void main()
