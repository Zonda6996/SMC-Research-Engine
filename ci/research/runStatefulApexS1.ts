import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { parseExactIndicatorCsv } from './lib/exactIndicatorExport.js'
import {
	detectStatefulApexEvents,
	statefulApexSplit,
	type ApexSplit,
	type StatefulApexRow,
} from './lib/statefulApexEvents.js'

const PROTOCOL_VERSION = 'apex-state-v1'
const ONE_WAY_COST_BPS = 5
const WARMUP = 210
const CSV_DIR = resolve('csv')
const JSON_OUT = resolve('ci-results/stateful-apex-s1-manifest.json')
const MD_OUT = resolve('ci-results/stateful-apex-s1-manifest.md')

interface SeriesMeta {
	file: string
	symbol: string
	timeframe: string
	market: 'spot' | 'futures'
}

function seriesMeta(file: string): SeriesMeta | null {
	const match = /^BINANCE_([A-Z0-9]+)(\.P)?, ([A-Z0-9]+)\.csv$/.exec(basename(file))
	if (match == null) return null
	return { file: `csv/${basename(file)}`, symbol: match[1]!, timeframe: match[3]!, market: match[2] == null ? 'spot' : 'futures' }
}

function sha256Text(text: string): string {
	return createHash('sha256').update(text).digest('hex')
}

function sha256File(file: string): string {
	return createHash('sha256').update(readFileSync(resolve(file))).digest('hex')
}

function git(command: string): string {
	return execFileSync('git', command.split(' '), { encoding: 'utf8' }).trim()
}

function main(): void {
	const files = readdirSync(CSV_DIR)
		.filter((name) => name.endsWith('.csv'))
		.map((name) => resolve(CSV_DIR, name))
		.sort()
	const series = [] as Array<{
		file: string; symbol: string; timeframe: string; market: string; split: ApexSplit
		rows: number; eligibleRows: number; firstUtc: string; lastUtc: string; sha256: string
		primaryEvents: number; censoredNoNextBar: number
	}>

	for (const absolute of files) {
		const meta = seriesMeta(absolute)
		if (meta == null) continue
		let parsed
		try {
			parsed = parseExactIndicatorCsv(readFileSync(absolute, 'utf8'), { allowIrregularBars: true, allowInvalidBandOrder: true })
		} catch (error) {
			console.warn(`skip ${meta.file}: ${(error as Error).message}`)
			continue
		}
		const rows: StatefulApexRow[] = parsed.map(({ buy: _buy, sell: _sell, ...row }) => row)
		const eligible = rows.slice(WARMUP)
		const detection = detectStatefulApexEvents(eligible)
		series.push({
			...meta,
			split: statefulApexSplit(meta.symbol),
			rows: rows.length,
			eligibleRows: eligible.length,
			firstUtc: new Date(rows[0]!.timestamp).toISOString(),
			lastUtc: new Date(rows.at(-1)!.timestamp).toISOString(),
			sha256: sha256File(meta.file),
			primaryEvents: detection.events.length,
			censoredNoNextBar: detection.events.filter((event) => event.entryIndex == null).length,
		})
	}
	if (series.length === 0) throw new Error('No strict vendor CSV exports were parseable.')

	const counts = (['train', 'validation', 'untouched-oos'] as const).map((split) => ({
		split,
		symbols: new Set(series.filter((item) => item.split === split).map((item) => item.symbol)).size,
		series: series.filter((item) => item.split === split).length,
		rows: series.filter((item) => item.split === split).reduce((sum, item) => sum + item.rows, 0),
		events: series.filter((item) => item.split === split).reduce((sum, item) => sum + item.primaryEvents, 0),
	}))
	const config = {
		protocolVersion: PROTOCOL_VERSION,
		oneWayCostBps: ONE_WAY_COST_BPS,
		warmupBars: WARMUP,
		split: 'sha256("apex-state-v1:" + symbol) mod 10: 0-5 train, 6-7 validation, 8-9 untouched-oos',
		stateMachine: ['NEUTRAL', 'ARMED', 'EXTENDED', 'TRACKING', 'REVERSAL_CONFIRMED', 'COOLDOWN'],
		entry: 'next bar open after REVERSAL_CONFIRMED',
		labelsGeneratedInThisRun: false,
		untouchedOosMetricsInspected: false,
		vendorShapesReadByParserButDiscardedBeforeDetection: true,
		vendorShapesInFeaturesOrTargets: false,
		unimplemented: ['causalRelativeVolume: preregistration does not freeze lookback/denominator'],
	}
	const configHash = sha256Text(JSON.stringify(config))
	let commit = 'unavailable'
	let dirty = true
	try { commit = git('rev-parse HEAD'); dirty = git('status --porcelain').length > 0 } catch { /* manifest remains explicit */ }
	const output = {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		protocolDocs: ['docs/ROADMAP.md#трек-s', 'docs/HANDOFF.md', 'docs/strategies/zonda-reversal.md'],
		git: { commit, dirty },
		config,
		configHash,
		codeHashes: {
			stateMachine: sha256File('ci/research/lib/statefulApexEvents.ts'),
			runner: sha256File('ci/research/runStatefulApexS1.ts'),
			tests: sha256File('tests/statefulApexEvents.test.ts'),
		},
		counts,
		series,
		oOSSeal: {
			status: 'untouched',
			outcomesComputed: false,
			metricsPublished: false,
			note: 'Only assignment and event-universe counts are frozen. No outcome label or economic OOS metric was calculated.',
		},
	}
	writeFileSync(JSON_OUT, JSON.stringify(output, null, 2) + '\n')

	const md = [
		'# Stateful Apex S1 — frozen dataset/split manifest',
		'',
		`- Protocol: \`${PROTOCOL_VERSION}\``,
		`- Config SHA-256: \`${configHash}\``,
		`- Git commit: \`${commit}\` (dirty working tree: ${dirty})`,
		`- Costs frozen for later labels: ${ONE_WAY_COST_BPS} bps/side`,
		`- Warm-up: ${WARMUP} bars`,
		'- Vendor Shapes: strict parser validates them, then the runner destructures and discards `buy`/`sell` before state detection; they are neither features nor targets.',
		'- Outcomes/metrics: **not computed in this freeze run**. Untouched OOS remains sealed.',
		'',
		'## Assignment counts (event-universe only; not performance)',
		'',
		'| split | symbols | series | rows | primary events |',
		'|---|---:|---:|---:|---:|',
		...counts.map((x) => `| ${x.split} | ${x.symbols} | ${x.series} | ${x.rows} | ${x.events} |`),
		'',
		'## Frozen series',
		'',
		'| symbol | market | TF | split | rows | eligible | events | no-next-bar | data SHA-256 | file |',
		'|---|---|---|---|---:|---:|---:|---:|---|---|',
		...series.map((x) => `| ${x.symbol} | ${x.market} | ${x.timeframe} | ${x.split} | ${x.rows} | ${x.eligibleRows} | ${x.primaryEvents} | ${x.censoredNoNextBar} | \`${x.sha256}\` | \`${x.file}\` |`),
		'',
		'## Explicit TODO',
		'',
		'- `causalRelativeVolume` remains `null`: Track S requires the feature but does not freeze its lookback/denominator. No rule was invented.',
		'- A0/A1 attribution arms are frozen as allowed concepts but are not implemented in this minimal primary runner; no winner selection occurred.',
		'',
		'## OOS seal',
		'',
		'Untouched-OOS assignments and hashes are visible for reproducibility, but outcome labels, net R, validation decisions, and OOS economic results were not calculated or viewed.',
	]
	writeFileSync(MD_OUT, md.join('\n') + '\n')
	console.log(`Wrote ${JSON_OUT}`)
	console.log(`Wrote ${MD_OUT}`)
}

main()
