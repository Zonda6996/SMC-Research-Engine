/**
 * D6 extension — per-symbol разбивка руки H24 (дескриптив к терминальному reveal).
 * Логика сделки идентична runD6CascadeRevealExtension.ts; ничего нового не тестируется.
 * Запуск: npx tsx ci/research/runD6ExtensionPerSymbolReport.ts
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Candle } from '../../src/models/price/Candle.js'
import { alignArchiveMetrics, fetchArchiveMetrics } from '../../tools/shared/archiveMetrics.js'
import type { SettledFunding } from './lib/own2FundingSignResearch.js'

const MANIFEST_PATH = 'data/own2-thin-bigcorpus/manifest.json'
const DATA_DIR = 'data/own2-thin-bigcorpus'
const OUT_MD = 'ci-results/d6-cascade-extension-persymbol.md'
const OUT_JSON = 'ci-results/d6-cascade-extension-persymbol.json'
const HOUR = 3_600_000
const WINDOW_BARS = 8
const OI_DROP = -0.15
const PRICE_DROP = -0.03
const GAP_BARS = 8
const HOLD_BARS = 24
const ROUND_TRIP_COST = 0.001

const UNIVERSE_EXT = ['XLMUSDT', 'XMRUSDT', 'TRXUSDT', 'DOTUSDT', 'INJUSDT', 'FETUSDT', '1000BONKUSDT', 'CRVUSDT', 'PORTALUSDT', 'HBARUSDT', 'ETCUSDT']

const fileHash = (path: string): string => createHash('sha256').update(readFileSync(resolve(path))).digest('hex')
const fmt = (x: number, d = 2): string => Number.isFinite(x) ? x.toFixed(d) : 'n/a'

interface SymbolResult { symbol: string; n: number; wr: number | null; pf: number | null; meanPct: number | null; totalPct: number; medianPct: number | null; worstTradePct: number | null; bestTradePct: number | null }

async function main(): Promise<void> {
	const manifest = JSON.parse(readFileSync(resolve(MANIFEST_PATH), 'utf8')) as { symbols: Array<{ symbol: string; candleFile: string; candleSha256: string }> }
	const results: SymbolResult[] = []
	for (const symbol of UNIVERSE_EXT) {
		const entry = manifest.symbols.find((s) => s.symbol === symbol)!
		if (fileHash(resolve(DATA_DIR, entry.candleFile)) !== entry.candleSha256) throw new Error(`${symbol}: hash mismatch`)
		const candles = JSON.parse(readFileSync(resolve(DATA_DIR, entry.candleFile), 'utf8')) as Candle[]
		const points = await fetchArchiveMetrics(symbol, candles[0]!.timestamp, candles[candles.length - 1]!.timestamp + HOUR)
		const oi = alignArchiveMetrics(points, candles).oi
		const funding = JSON.parse(readFileSync(resolve(DATA_DIR, `${symbol}-funding.json`), 'utf8')) as SettledFunding[]
		const closes = candles.map((c) => c.close)

		const rets: number[] = []
		let lastAdmitted = -Infinity
		for (let i = WINDOW_BARS; i + HOLD_BARS < candles.length; i++) {
			const oiNow = oi[i]
			const oiPast = oi[i - WINDOW_BARS]!
			if (oiNow == null || oiPast == null || oiPast <= 0) continue
			if (!(oiNow / oiPast - 1 <= OI_DROP && closes[i]! / closes[i - WINDOW_BARS]! - 1 <= PRICE_DROP)) continue
			if (i - lastAdmitted < GAP_BARS) continue
			lastAdmitted = i
			const entryBar = candles[i + 1]!
			const exitBar = candles[i + HOLD_BARS]!
			let fundingQuote = 0
			for (const row of funding) {
				if (row.timestamp < entryBar.timestamp || row.timestamp >= exitBar.timestamp) continue
				fundingQuote += -row.rate * row.markPrice
			}
			rets.push((exitBar.close / entryBar.open - 1) + fundingQuote / entryBar.open - ROUND_TRIP_COST)
		}

		const sorted = [...rets].sort((a, b) => a - b)
		const wins = rets.filter((r) => r > 0)
		const losses = rets.filter((r) => r < 0)
		results.push({
			symbol,
			n: rets.length,
			wr: rets.length ? wins.length / rets.length : null,
			pf: losses.length ? wins.reduce((a, b) => a + b, 0) / -losses.reduce((a, b) => a + b, 0) : null,
			meanPct: rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length * 100 : null,
			totalPct: rets.reduce((a, b) => a + b, 0) * 100,
			medianPct: sorted.length ? sorted[Math.floor(sorted.length / 2)]! * 100 : null,
			worstTradePct: sorted.length ? sorted[0]! * 100 : null,
			bestTradePct: sorted.length ? sorted[sorted.length - 1]! * 100 : null,
		})
		console.log(`${results[results.length - 1]!.symbol}: N=${results[results.length - 1]!.n} mean=${fmt(results[results.length - 1]!.meanPct ?? NaN)}%`)
	}

	writeFileSync(resolve(OUT_JSON), JSON.stringify({ generatedAt: new Date().toISOString(), note: 'descriptive per-symbol split of d6-cascade-extension ARM H24', results }, null, 2))
	const totalN = results.reduce((a, r) => a + r.n, 0)
	const md = [
		'# D6 cascade — ARM H24 по символам (extension, дескриптив)',
		'',
		'| символ | N | WR | PF | средняя, % | сумма, % | медиана, % | худшая, % | лучшая, % |',
		'|---|---:|---:|---:|---:|---:|---:|---:|---:|',
		...results.map((r) => `| ${r.symbol.replace('USDT', '')} | ${r.n} | ${r.wr != null ? (r.wr * 100).toFixed(1) + '%' : '—'} | ${fmt(r.pf ?? Number.NaN)} | ${fmt(r.meanPct ?? Number.NaN)} | ${fmt(r.totalPct, 1)} | ${fmt(r.medianPct ?? Number.NaN)} | ${fmt(r.worstTradePct ?? Number.NaN)} | ${fmt(r.bestTradePct ?? Number.NaN)} |`),
		'',
		`Всего сделок: ${totalN}. Все сделки net: издержки 5 bps/side + фактический funding. ТФ: 1h.`,
	]
	writeFileSync(resolve(OUT_MD), md.join('\n'))
	console.log(`\nЗаписано: ${OUT_MD}`)
}

void main()
