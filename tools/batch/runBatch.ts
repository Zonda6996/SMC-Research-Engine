// runBatch.ts
//
// Batch-раннер Fib Playbook: прогоняет матрицу активы × ТФ × конфиги и
// выдаёт сводную таблицу EV (markdown в консоль + CSV в файл).
// Исследовательский инструмент, НЕ часть пайплайна.
//
// Запуск (все параметры опциональны):
//   npx tsx tools/batch/runBatch.ts
//   npx tsx tools/batch/runBatch.ts --symbols BTC/USDT,ETH/USDT,SOL/USDT \
//     --timeframes 15m,30m,1h --limit 20000 --atr 0,5 --market futures
//
// Флаги:
//   --symbols     список пар через запятую (default: BTC/USDT,ETH/USDT,SOL/USDT)
//   --timeframes  список ТФ через запятую (default: 15m,30m,1h)
//   --limit       свечей на прогон, максимум 20000 (default: 20000)
//   --market      spot | futures (default: futures)
//   --atr         пороги min leg size в ATR через запятую (default: 0,5)
//   --fixture     использовать локальную фикстуру вместо биржи (smoke-тест)
//   --no-cache    не использовать дисковый кэш свечей
//   --min-in      минимум входов, чтобы строка попала в сводку (default: 20)
//   --out         путь к CSV (default: tools/batch/results/batch-<timestamp>.csv)
//
// Кэш свечей: tools/batch/cache/*.json — повторный прогон той же матрицы
// не ходит на биржу (удалить каталог = скачать заново).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runAnalysis } from '../../src/core/analysis/runAnalysis.js'
import { fetchCandlesPaginated, MAX_CANDLES, type MarketKind } from '../shared/candleFetcher.js'
import type { Candle } from '../../src/models/price/Candle.js'
import type { FibSetupOutcome } from '../../src/models/fib/FibLifecycle.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = join(__dirname, 'cache')
const RESULTS_DIR = join(__dirname, 'results')
const FIXTURE_PATH = join(__dirname, '../../tests/fixtures/btcusdt-15m-500.json')

// ---------- CLI ----------

interface CliArgs {
	symbols: string[]
	timeframes: string[]
	limit: number
	market: MarketKind
	atrThresholds: number[]
	fixture: boolean
	cache: boolean
	minIn: number
	out: string | null
}

function parseArgs(argv: string[]): CliArgs {
	const get = (flag: string): string | null => {
		const i = argv.indexOf(flag)
		return i >= 0 && argv[i + 1] ? argv[i + 1]! : null
	}
	return {
		symbols: (get('--symbols') ?? 'BTC/USDT,ETH/USDT,SOL/USDT').split(',').map((s) => s.trim()),
		timeframes: (get('--timeframes') ?? '15m,30m,1h').split(',').map((s) => s.trim()),
		limit: Math.min(Number(get('--limit') ?? MAX_CANDLES), MAX_CANDLES),
		market: get('--market') === 'spot' ? 'spot' : 'futures',
		atrThresholds: (get('--atr') ?? '0,5').split(',').map(Number),
		fixture: argv.includes('--fixture'),
		cache: !argv.includes('--no-cache'),
		minIn: Number(get('--min-in') ?? 20),
		out: get('--out'),
	}
}

// ---------- Данные ----------

async function loadCandles(
	symbol: string,
	timeframe: string,
	limit: number,
	market: MarketKind,
	useCache: boolean,
): Promise<Candle[]> {
	const key = `${symbol.replace('/', '-')}_${timeframe}_${limit}_${market}.json`
	const cachePath = join(CACHE_DIR, key)

	if (useCache && existsSync(cachePath)) {
		return JSON.parse(readFileSync(cachePath, 'utf-8'))
	}

	const candles = await fetchCandlesPaginated(symbol, timeframe, limit, market)
	if (useCache && candles.length > 0) {
		mkdirSync(CACHE_DIR, { recursive: true })
		writeFileSync(cachePath, JSON.stringify(candles))
	}
	return candles
}

// ---------- Агрегация (та же логика, что в панели Playbook Stats) ----------

interface SliceStats {
	setups: number
	entered: number
	tp1Pct: number | null
	tp2Pct: number | null
	slPct: number | null
	evFull: number | null
	evBe: number | null
	resolved: number
}

/**
 * EV на сделку в R для двух вариантов менеджмента — идентично формуле UI:
 * full — весь объём на TP1; be — 50% на TP1, безубыток, раннер до TP2.
 * Разрешённые сделки: TP1 либо стоп; открытые без TP1 исключаются.
 */
function aggregate(outcomes: FibSetupOutcome[]): SliceStats {
	const entered = outcomes.filter((o) => o.entered)
	const tp1 = entered.filter((o) => o.tp1Hit)
	const tp2 = entered.filter((o) => o.state === 'tp2')
	const stopped = entered.filter((o) => o.state === 'stopped' && !o.tp1Hit)
	const resolved = entered.filter((o) => o.tp1Hit || o.state === 'stopped')

	let fullSum = 0
	let beSum = 0
	for (const o of resolved) {
		fullSum += o.tp1Hit ? (o.rTp1 ?? 0) : -1
		beSum += o.tp1Hit ? 0.5 * (o.rTp1 ?? 0) + (o.state === 'tp2' ? 0.5 * (o.rTp2 ?? 0) : 0) : -1
	}

	const pct = (part: number) => (entered.length ? part / entered.length : null)
	return {
		setups: outcomes.length,
		entered: entered.length,
		tp1Pct: pct(tp1.length),
		tp2Pct: pct(tp2.length),
		slPct: pct(stopped.length),
		evFull: resolved.length ? fullSum / resolved.length : null,
		evBe: resolved.length ? beSum / resolved.length : null,
		resolved: resolved.length,
	}
}

interface ResultRow {
	symbol: string
	timeframe: string
	anchor: string
	trigger: string
	atr: number
	scenario: string
	stopMode: string
	stats: SliceStats
	/**
	 * Разбивка по направлению сделки. Ключевой тест на природу edge:
	 * если EV положительный только у лонгов — это ставка на бычий режим
	 * периода; если у обеих сторон — структурное преимущество сетапа.
	 */
	long: SliceStats
	short: SliceStats
}

/** Все разрезы по одному датасету: якорь × триггер × ATR × сценарий × стоп. */
function sliceDataset(symbol: string, timeframe: string, outcomes: FibSetupOutcome[], atrThresholds: number[]): ResultRow[] {
	const rows: ResultRow[] = []
	const anchors = ['local', 'global'] as const
	const triggers = ['bos', 'choch'] as const
	// OTE в двух режимах стопа, Deep/Breaker только zero.
	const scenarioSlices = [
		{ scenario: 'ote', stopMode: 'zero' },
		{ scenario: 'ote', stopMode: 'tight' },
		{ scenario: 'deep', stopMode: 'zero' },
		{ scenario: 'breaker', stopMode: 'zero' },
	] as const

	for (const anchor of anchors) {
		for (const trigger of triggers) {
			for (const atr of atrThresholds) {
				const base = outcomes.filter((o) =>
					o.variantMode === anchor &&
					o.trigger === trigger &&
					(o.legAtrRatio == null || o.legAtrRatio >= atr))
				for (const { scenario, stopMode } of scenarioSlices) {
					const group = base.filter((o) => o.scenario === scenario && o.stopMode === stopMode)
					rows.push({
						symbol, timeframe, anchor, trigger, atr, scenario, stopMode,
						stats: aggregate(group),
						long: aggregate(group.filter((o) => o.direction === 'long')),
						short: aggregate(group.filter((o) => o.direction === 'short')),
					})
				}
			}
		}
	}
	return rows
}

// ---------- Вывод ----------

const fmtPct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`)
const fmtEv = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}`)

function scenarioLabel(scenario: string, stopMode: string): string {
	if (scenario === 'ote') return stopMode === 'tight' ? 'OTE (SL 23.6)' : 'OTE (SL 0)'
	if (scenario === 'deep') return 'Deep (SL 0)'
	return 'Breaker (SL 0)'
}

function toMarkdown(rows: ResultRow[], minIn: number): string {
	const lines: string[] = []
	lines.push('| Symbol | TF | Anchor | Trig | ATR | Scenario | In | TP1 | TP2 | SL | EV_full | EV_be | L: In/EVf/EVbe | S: In/EVf/EVbe |')
	lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
	const dir = (s: SliceStats) => `${s.entered}/${fmtEv(s.evFull)}/${fmtEv(s.evBe)}`
	for (const r of rows) {
		if (r.stats.entered < minIn) continue
		lines.push(
			`| ${r.symbol} | ${r.timeframe} | ${r.anchor} | ${r.trigger.toUpperCase()} | ${r.atr} ` +
			`| ${scenarioLabel(r.scenario, r.stopMode)} | ${r.stats.entered} ` +
			`| ${fmtPct(r.stats.tp1Pct)} | ${fmtPct(r.stats.tp2Pct)} | ${fmtPct(r.stats.slPct)} ` +
			`| ${fmtEv(r.stats.evFull)} | ${fmtEv(r.stats.evBe)} ` +
			`| ${dir(r.long)} | ${dir(r.short)} |`,
		)
	}
	return lines.join('\n')
}

function toCsv(rows: ResultRow[]): string {
	const header =
		'symbol,timeframe,anchor,trigger,atr,scenario,stop_mode,setups,entered,resolved,tp1_pct,tp2_pct,sl_pct,ev_full,ev_be,' +
		'long_in,long_ev_full,long_ev_be,short_in,short_ev_full,short_ev_be'
	const num = (v: number | null) => (v == null ? '' : v.toFixed(4))
	const body = rows.map((r) =>
		[
			r.symbol, r.timeframe, r.anchor, r.trigger, r.atr, r.scenario, r.stopMode,
			r.stats.setups, r.stats.entered, r.stats.resolved,
			num(r.stats.tp1Pct), num(r.stats.tp2Pct), num(r.stats.slPct),
			num(r.stats.evFull), num(r.stats.evBe),
			r.long.entered, num(r.long.evFull), num(r.long.evBe),
			r.short.entered, num(r.short.evFull), num(r.short.evBe),
		].join(','),
	)
	return [header, ...body].join('\n')
}

/** Топ строк по EV_be среди статистически значимых — быстрый взгляд на лидеров. */
function topLines(rows: ResultRow[], minIn: number, n = 10): string {
	const ranked = rows
		.filter((r) => r.stats.entered >= minIn && r.stats.evBe != null)
		.sort((a, b) => (b.stats.evBe ?? 0) - (a.stats.evBe ?? 0))
		.slice(0, n)
	return ranked
		.map((r, i) =>
			`${String(i + 1).padStart(2)}. ${r.symbol} ${r.timeframe} ${r.anchor}/${r.trigger.toUpperCase()}` +
			` ATR${r.atr} ${scenarioLabel(r.scenario, r.stopMode)} → EV_be ${fmtEv(r.stats.evBe)}` +
			` (EV_full ${fmtEv(r.stats.evFull)}, In ${r.stats.entered};` +
			` L ${r.long.entered}/${fmtEv(r.long.evBe)}, S ${r.short.entered}/${fmtEv(r.short.evBe)})`,
		)
		.join('\n')
}

// ---------- Main ----------

async function main() {
	const args = parseArgs(process.argv.slice(2))
	const allRows: ResultRow[] = []
	const failures: string[] = []

	console.log(`\nBatch: ${args.symbols.join(', ')} × ${args.timeframes.join(', ')} × ${args.limit} candles (${args.market})`)
	console.log(`ATR thresholds: ${args.atrThresholds.join(', ')}; min In: ${args.minIn}${args.fixture ? '; FIXTURE MODE' : ''}\n`)

	for (const symbol of args.symbols) {
		for (const timeframe of args.timeframes) {
			const label = `${symbol} ${timeframe}`
			try {
				const started = Date.now()
				const candles = args.fixture
					? (JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as Candle[])
					: await loadCandles(symbol, timeframe, args.limit, args.market, args.cache)
				if (candles.length === 0) {
					failures.push(`${label}: 0 candles`)
					continue
				}
				const snapshot = runAnalysis(candles)
				allRows.push(...sliceDataset(symbol, timeframe, snapshot.fibLifecycle.outcomes, args.atrThresholds))
				console.log(`  ✓ ${label}: ${candles.length} candles, ${snapshot.fib.candidates.length} candidates (${((Date.now() - started) / 1000).toFixed(1)}s)`)
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err)
				failures.push(`${label}: ${message}`)
				console.log(`  ✗ ${label}: ${message}`)
			}
		}
	}

	if (allRows.length === 0) {
		console.error('\nNo results. All datasets failed:\n' + failures.map((f) => `  - ${f}`).join('\n'))
		process.exit(1)
	}

	// CSV — всегда полный (без фильтра min-in), фильтрация — забота анализа.
	mkdirSync(RESULTS_DIR, { recursive: true })
	const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
	const csvPath = args.out ?? join(RESULTS_DIR, `batch-${stamp}.csv`)
	writeFileSync(csvPath, toCsv(allRows))

	console.log(`\n=== Top by EV_be (In >= ${args.minIn}) ===\n`)
	console.log(topLines(allRows, args.minIn))
	console.log(`\n=== Full table (In >= ${args.minIn}) ===\n`)
	console.log(toMarkdown(allRows, args.minIn))
	console.log(`\nCSV (all ${allRows.length} rows): ${csvPath}`)
	if (failures.length > 0) {
		console.log(`\nFailures:\n` + failures.map((f) => `  - ${f}`).join('\n'))
	}
}

main().catch((err) => {
	console.error('Fatal:', err instanceof Error ? err.message : err)
	process.exit(1)
})
