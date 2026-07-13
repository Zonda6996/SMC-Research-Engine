// runMultiTf.ts
//
// Мульти-ТФ прогон (SPEC 7.14): сетка и сценарий — со старшего ТФ, вход и
// стоп — со структуры младшего. Для каждого HTF-сетапа плейбука параллельно
// симулируются обычный вход (бенчмарк, те же правила, что в runBatch) и
// мульти-ТФ вход (MultiTfEntryEngine) — попарное сравнение на идентичных
// сетапах. Исследовательский инструмент, НЕ часть пайплайна.
//
// Запуск:
//   npm run multitf
//   npx tsx tools/batch/runMultiTf.ts --symbols BTC/USDT \
//     --pairs 4h:15m --until 2023-01-01
//
// Флаги:
//   --symbols   список пар через запятую (default: BTC/USDT,ETH/USDT,SOL/USDT)
//   --pairs     пары ТФ старший:младший (default: 1h:5m,4h:15m)
//   --market    spot | futures (default: futures)
//   --until     правая граница окна (walk-forward)
//   --fixture   локальная фикстура 15m как LTF, пара форсируется в 1h:15m
//   --no-cache  не использовать дисковый кэш свечей
//   --min-in    минимум бенчмарк-входов для попадания в markdown (default: 10)
//   --out       путь к CSV (default: tools/batch/results/multitf-<timestamp>.csv)
//
// Данные: качается ТОЛЬКО младший ТФ (до 60k свечей), старший агрегируется
// из него (aggregateCandles) — окна двух ТФ гарантированно совпадают, а
// загрузка одна. Следствие: HTF-окно короче сольных прогонов runBatch
// (60k×5m ≈ 208 дней ≈ 5000×1h) — сэмплы меньше, это осознанная цена.
//
// Метрики (соглашение по R — см. src/models/fib/MultiTf.ts):
//   - mtf_ev_be_net_ltf — EV на попытку в LTF-R (риск попытки = 1);
//   - mtf_ev_be_net_htf — EV на сетап в HTF-R при РАВНОМ НОМИНАЛЕ позиции:
//     Σ по попыткам net_ltf_R × risk_ratio. Отвечает на вопрос «тот же
//     объём, но короткий стоп: сэкономили ли на лоссах, не потеряв побед?»;
//   - paired_bench_ev_be_net — бенчмарк на ТЕХ ЖЕ сетапах (где мульти-ТФ
//     вошёл и разрешился) — честное попарное сравнение;
//   - miss_pct — доля сетапов, где бенчмарк вошёл, а CHoCH не случился
//     (упущенные сетапы — цена мульти-ТФ подхода).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runAnalysis } from '../../src/core/analysis/runAnalysis.js'
import {
	fetchCandlesPaginated,
	aggregateCandles,
	MAX_CANDLES_LTF,
	TF_MS,
	type MarketKind,
} from '../shared/candleFetcher.js'
import type { Candle } from '../../src/models/price/Candle.js'
import type { StructureEvent } from '../../src/models/events/StructureEvent.js'
import type { FibSetupOutcome } from '../../src/models/fib/FibLifecycle.js'
import type { MultiTfOutcome, MultiTfSetupSpec } from '../../src/models/fib/MultiTf.js'
import { MultiTfEntryEngine, computeLtfEvents } from '../../src/core/fib/MultiTfEntryEngine.js'
import { netBeR } from '../../src/core/fib/fibCosts.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = join(__dirname, 'cache')
const RESULTS_DIR = join(__dirname, 'results')
const FIXTURE_PATH = join(__dirname, '../../tests/fixtures/btcusdt-15m-500.json')

/** Сценарии плейбука, к которым применяется мульти-ТФ вход (SL за 0). */
const PLAYBOOK_SCENARIOS = ['ote', 'deep', 'breaker', 'breaker161'] as const
/** Уровень зоны интереса по сценарию (ratio старшей сетки). */
const ENTRY_RATIO: Record<string, number> = {
	ote: 78.6,
	deep: 38.2,
	breaker: 100,
	breaker161: 100,
}

// ---------- CLI ----------

interface TfPair {
	htf: string
	ltf: string
}

interface MtfArgs {
	symbols: string[]
	pairs: TfPair[]
	market: MarketKind
	fixture: boolean
	cache: boolean
	minIn: number
	out: string | null
	untilMs: number | null
	untilLabel: string | null
}

function parseArgs(argv: string[]): MtfArgs {
	const get = (flag: string): string | null => {
		const i = argv.indexOf(flag)
		return i >= 0 && argv[i + 1] ? argv[i + 1]! : null
	}
	const untilRaw = get('--until')
	let untilMs: number | null = null
	if (untilRaw) {
		const parsed = Date.parse(untilRaw)
		if (Number.isNaN(parsed)) throw new Error(`Bad --until date: ${untilRaw} (expected e.g. 2023-01-01)`)
		untilMs = parsed
	}
	const fixture = argv.includes('--fixture')
	const pairs = (get('--pairs') ?? '1h:5m,4h:15m').split(',').map((raw): TfPair => {
		const [htf, ltf] = raw.trim().split(':')
		if (!htf || !ltf || !TF_MS[htf] || !TF_MS[ltf]) throw new Error(`Bad --pairs entry: ${raw} (expected e.g. 4h:15m)`)
		return { htf, ltf }
	})
	return {
		symbols: (get('--symbols') ?? 'BTC/USDT,ETH/USDT,SOL/USDT').split(',').map((s) => s.trim()),
		// Фикстура — 500 свечей 15m: единственная валидная пара 1h:15m.
		pairs: fixture ? [{ htf: '1h', ltf: '15m' }] : pairs,
		market: get('--market') === 'spot' ? 'spot' : 'futures',
		fixture,
		cache: !argv.includes('--no-cache'),
		minIn: Number(get('--min-in') ?? 10),
		out: get('--out'),
		untilMs,
		untilLabel: untilRaw ? untilRaw.replace(/[:]/g, '-') : null,
	}
}

// ---------- Данные ----------

async function loadLtfCandles(
	symbol: string,
	timeframe: string,
	market: MarketKind,
	useCache: boolean,
	untilMs: number | null,
	untilLabel: string | null,
): Promise<Candle[]> {
	const untilKey = untilLabel ? `_until-${untilLabel}` : ''
	const key = `${symbol.replace('/', '-')}_${timeframe}_${MAX_CANDLES_LTF}_${market}${untilKey}.json`
	const cachePath = join(CACHE_DIR, key)
	if (useCache && existsSync(cachePath)) {
		return JSON.parse(readFileSync(cachePath, 'utf-8'))
	}
	const candles = await fetchCandlesPaginated(symbol, timeframe, MAX_CANDLES_LTF, market, untilMs, MAX_CANDLES_LTF)
	if (useCache && candles.length > 0) {
		mkdirSync(CACHE_DIR, { recursive: true })
		writeFileSync(cachePath, JSON.stringify(candles))
	}
	return candles
}

// ---------- Сборка сетапов ----------

/** Пара «бенчмарк-сделка ↔ попытки мульти-ТФ» на одном HTF-сетапе. */
interface PairedSetup {
	symbol: string
	pair: string
	anchor: string
	htfTrigger: string
	scenario: string
	bench: FibSetupOutcome
	attempts: MultiTfOutcome[]
}

/** confirmTimestamp первого события против направления после afterIndex. */
function oppositeConfirmTs(
	direction: 'long' | 'short',
	afterIndex: number,
	events: StructureEvent[],
): number | null {
	const want = direction === 'long' ? 'down' : 'up'
	for (const event of events) {
		if (event.type === 'unlabeled') continue
		if (event.confirmIndex <= afterIndex) continue
		if (event.direction === want) return event.confirmTimestamp
	}
	return null
}

/** Адаптер к fibCosts: MultiTfOutcome несёт совместимые поля (см. модель). */
function attemptNetBe(attempt: MultiTfOutcome): number | null {
	return netBeR(attempt as unknown as FibSetupOutcome)
}

function buildPairedSetups(
	symbol: string,
	pairLabel: string,
	htfCandles: Candle[],
	ltfCandles: Candle[],
): PairedSetup[] {
	const snapshot = runAnalysis(htfCandles)
	const ltfEvents = computeLtfEvents(ltfCandles)
	const engine = new MultiTfEntryEngine({ maxAttempts: 2 })

	const paired: PairedSetup[] = []
	for (const bench of snapshot.fibLifecycle.outcomes) {
		if (!PLAYBOOK_SCENARIOS.includes(bench.scenario as (typeof PLAYBOOK_SCENARIOS)[number])) continue
		if (bench.stopMode !== 'zero') continue
		if (!bench.entered || bench.entryIndex == null) continue

		const candidate = snapshot.fib.candidates.find((c) => c.id === bench.candidateId)
		const variant = candidate?.variants[bench.variantMode]
		if (!candidate || !variant) continue

		const price = (ratio: number): number | null =>
			variant.levels.find((l) => l.ratio === ratio)?.price ?? null
		const entryRatio = ENTRY_RATIO[bench.scenario]
		if (entryRatio == null) continue
		const entryLevel = price(entryRatio)
		const p0 = price(0)
		const tp1 = price(141)
		const tp2 = price(241)
		const activationBar = htfCandles[bench.entryIndex]
		if (entryLevel == null || p0 == null || tp1 == null || tp2 == null || !activationBar) continue

		const spec: MultiTfSetupSpec = {
			id: `${candidate.id}|${bench.variantMode}|${bench.scenario}`,
			scenario: bench.scenario,
			direction: bench.direction,
			entryLevel,
			cancelLevel: p0,
			tp1,
			tp2,
			htfRiskSize: Math.abs(entryLevel - p0),
			activationTimestamp: activationBar.timestamp,
			deadlineTimestamp: oppositeConfirmTs(bench.direction, candidate.createdAtIndex, snapshot.events),
		}
		paired.push({
			symbol,
			pair: pairLabel,
			anchor: bench.variantMode,
			htfTrigger: bench.trigger,
			scenario: bench.scenario,
			bench,
			attempts: engine.simulateSetup(spec, { ltfCandles, ltfEvents }),
		})
	}
	return paired
}

// ---------- Агрегация ----------

interface MtfRow {
	symbol: string
	pair: string
	anchor: string
	htfTrigger: string
	scenario: string
	/** Сетапов с бенчмарк-входом (база сравнения). */
	setups: number
	/** Сетапов, где мульти-ТФ вошёл хотя бы раз. */
	mtfIn: number
	missPct: number | null
	attempts: number
	a2Attempts: number
	riskRatioMed: number | null
	mtfTp1Pct: number | null
	/** EV на попытку в LTF-R (net, BE-менеджмент). */
	mtfEvBeNetLtf: number | null
	a1Ev: number | null
	a2Ev: number | null
	/** Попарно: сетапы, где мульти-ТФ вошёл и все попытки разрешены. */
	pairedN: number
	pairedBenchEv: number | null
	/** EV на сетап в HTF-R при равном номинале: Σ net_ltf × risk_ratio. */
	mtfEvBeNetHtf: number | null
}

function median(values: number[]): number | null {
	if (values.length === 0) return null
	const sorted = [...values].sort((a, b) => a - b)
	const mid = Math.floor(sorted.length / 2)
	const lo = sorted[mid - 1]
	const hi = sorted[mid]
	if (hi == null) return null
	return sorted.length % 2 === 0 && lo != null ? (lo + hi) / 2 : hi
}

function mean(values: number[]): number | null {
	return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null
}

function aggregateGroup(setups: PairedSetup[]): Omit<MtfRow, 'symbol' | 'pair' | 'anchor' | 'htfTrigger' | 'scenario'> {
	const enteredSetups = setups.filter((s) => s.attempts.some((a) => a.entered))
	const allAttempts = setups.flatMap((s) => s.attempts.filter((a) => a.entered))
	const resolvedAttempts = allAttempts.filter((a) => a.tp1Hit || a.state === 'stopped')

	const attemptEv = (list: MultiTfOutcome[]): number | null =>
		mean(list.map(attemptNetBe).filter((v): v is number => v != null))

	// Попарное сравнение: сетапы, где мульти-ТФ вошёл и НИ одна попытка не
	// осталась open (иначе Σ по попыткам не определена), а бенчмарк разрешён.
	const pairedSetups = enteredSetups.filter(
		(s) =>
			s.attempts.every((a) => !a.entered || a.tp1Hit || a.state === 'stopped') &&
			(s.bench.tp1Hit || s.bench.state === 'stopped'),
	)
	const setupHtfEv = (s: PairedSetup): number | null => {
		let sum = 0
		for (const a of s.attempts) {
			if (!a.entered) continue
			const net = attemptNetBe(a)
			if (net == null || a.riskRatio == null) return null
			sum += net * a.riskRatio
		}
		return sum
	}
	const htfEvs = pairedSetups.map(setupHtfEv).filter((v): v is number => v != null)
	const benchEvs = pairedSetups
		.map((s) => netBeR(s.bench))
		.filter((v): v is number => v != null)

	return {
		setups: setups.length,
		mtfIn: enteredSetups.length,
		missPct: setups.length ? 1 - enteredSetups.length / setups.length : null,
		attempts: allAttempts.length,
		a2Attempts: allAttempts.filter((a) => a.attempt === 2).length,
		riskRatioMed: median(allAttempts.map((a) => a.riskRatio).filter((v): v is number => v != null)),
		mtfTp1Pct: allAttempts.length
			? allAttempts.filter((a) => a.tp1Hit).length / allAttempts.length
			: null,
		mtfEvBeNetLtf: attemptEv(resolvedAttempts),
		a1Ev: attemptEv(resolvedAttempts.filter((a) => a.attempt === 1)),
		a2Ev: attemptEv(resolvedAttempts.filter((a) => a.attempt === 2)),
		pairedN: htfEvs.length,
		pairedBenchEv: mean(benchEvs),
		mtfEvBeNetHtf: mean(htfEvs),
	}
}

function sliceRows(paired: PairedSetup[]): MtfRow[] {
	const rows: MtfRow[] = []
	const keys = new Set(paired.map((p) => `${p.symbol}\u0000${p.pair}\u0000${p.anchor}\u0000${p.htfTrigger}\u0000${p.scenario}`))
	for (const key of [...keys].sort()) {
		const [symbol, pair, anchor, htfTrigger, scenario] = key.split('\u0000') as [string, string, string, string, string]
		const group = paired.filter(
			(p) =>
				p.symbol === symbol && p.pair === pair && p.anchor === anchor &&
				p.htfTrigger === htfTrigger && p.scenario === scenario,
		)
		rows.push({ symbol, pair, anchor, htfTrigger, scenario, ...aggregateGroup(group) })
	}
	return rows
}

// ---------- Вывод ----------

const fmtPct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`)
const fmtEv = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`)

function toMarkdown(rows: MtfRow[], minIn: number): string {
	const lines: string[] = []
	lines.push('| Symbol | Pair | Anchor | Trig | Scenario | Setups | MTF in | Miss | RR med | TP1 | EV_ltf | A1/A2 EV | Paired N | Bench EV | MTF EV_htf |')
	lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
	for (const r of rows) {
		if (r.setups < minIn) continue
		lines.push(
			`| ${r.symbol} | ${r.pair} | ${r.anchor} | ${r.htfTrigger.toUpperCase()} | ${r.scenario} ` +
			`| ${r.setups} | ${r.mtfIn} | ${fmtPct(r.missPct)} | ${r.riskRatioMed?.toFixed(2) ?? '—'} ` +
			`| ${fmtPct(r.mtfTp1Pct)} | ${fmtEv(r.mtfEvBeNetLtf)} | ${fmtEv(r.a1Ev)}/${fmtEv(r.a2Ev)} ` +
			`| ${r.pairedN} | ${fmtEv(r.pairedBenchEv)} | ${fmtEv(r.mtfEvBeNetHtf)} |`,
		)
	}
	return lines.join('\n')
}

function toCsv(rows: MtfRow[]): string {
	const header =
		'symbol,pair,anchor,htf_trigger,scenario,setups,mtf_in,miss_pct,attempts,a2_attempts,' +
		'risk_ratio_med,mtf_tp1_pct,mtf_ev_be_net_ltf,a1_ev,a2_ev,paired_n,paired_bench_ev_be_net,mtf_ev_be_net_htf'
	const num = (v: number | null) => (v == null ? '' : v.toFixed(4))
	const body = rows.map((r) =>
		[
			r.symbol, r.pair, r.anchor, r.htfTrigger, r.scenario,
			r.setups, r.mtfIn, num(r.missPct), r.attempts, r.a2Attempts,
			num(r.riskRatioMed), num(r.mtfTp1Pct), num(r.mtfEvBeNetLtf), num(r.a1Ev), num(r.a2Ev),
			r.pairedN, num(r.pairedBenchEv), num(r.mtfEvBeNetHtf),
		].join(','),
	)
	return [header, ...body].join('\n')
}

// ---------- Main ----------

export async function runMultiTf(argv: string[]): Promise<void> {
	const args = parseArgs(argv)
	const allRows: MtfRow[] = []
	const failures: string[] = []

	console.log(`\nMulti-TF: ${args.symbols.join(', ')} × ${args.pairs.map((p) => `${p.htf}:${p.ltf}`).join(', ')} (${args.market})${args.untilLabel ? ` until ${args.untilLabel}` : ''}`)
	console.log(`LTF budget: ${MAX_CANDLES_LTF}; min In: ${args.minIn}${args.fixture ? '; FIXTURE MODE' : ''}\n`)

	for (const symbol of args.symbols) {
		for (const { htf, ltf } of args.pairs) {
			const pairLabel = `${htf}:${ltf}`
			const label = `${symbol} ${pairLabel}`
			try {
				const ltfCandles = args.fixture
					? (JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as Candle[])
					: await loadLtfCandles(symbol, ltf, args.market, args.cache, args.untilMs, args.untilLabel)
				if (ltfCandles.length === 0) {
					failures.push(`${label}: no candles`)
					continue
				}
				const htfCandles = aggregateCandles(ltfCandles, ltf, htf)
				console.log(`${label}: LTF ${ltfCandles.length} → HTF ${htfCandles.length} candles`)
				const paired = buildPairedSetups(symbol, pairLabel, htfCandles, ltfCandles)
				console.log(`${label}: ${paired.length} paired setups`)
				allRows.push(...sliceRows(paired))
			} catch (error) {
				failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
			}
		}
		// Фикстура одна — второй символ дал бы дубликат строк.
		if (args.fixture) break
	}

	console.log(`\n${toMarkdown(allRows, args.minIn)}\n`)
	if (failures.length > 0) {
		console.log(`Failures:\n${failures.map((f) => `  - ${f}`).join('\n')}\n`)
	}

	mkdirSync(RESULTS_DIR, { recursive: true })
	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
	const outPath = args.out ?? join(RESULTS_DIR, `multitf-${stamp}.csv`)
	writeFileSync(outPath, toCsv(allRows))
	console.log(`CSV: ${outPath}`)
}

// Прямой запуск: npx tsx tools/batch/runMultiTf.ts [flags] / npm run multitf.
runMultiTf(process.argv.slice(2)).catch((err) => {
	console.error('Fatal:', err instanceof Error ? err.message : err)
	process.exit(1)
})
