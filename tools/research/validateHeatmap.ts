// validateHeatmap.ts — бэктест-валидация магнит-гипотезы heatmap (улучшение #8).
//
// Walk-forward без leakage: на каждом якоре detect() видит только префикс истории.
// Три числа на сторону:
//   strong — как часто цена доходит до СИЛЬНЕЙШЕЙ активной полки (<=10% от цены) за horizon баров;
//   weak — до случайной слабой полки той же стороны (контроль силы);
//   perm — до уровня на ПЕРЕМЕШАННОМ между якорями расстоянии (контроль «дело в расстоянии»).
// strong > perm — уровни несут сигнал сверх расстояния; strong > weak — вес полки информативен.
//
// Запуск:
//   npx tsx tools/research/validateHeatmap.ts --file tests/fixtures/btcusdt-15m-500.json --horizon 60
//   npx tsx tools/research/validateHeatmap.ts --symbol BTC/USDT --tf 1h --limit 5000 --horizon 100 --stride 25
import { readFileSync } from 'node:fs'
import { detectLiquidityHeatmap, heatmapConfigForTf, inferTfMs } from '../../src/core/liquidity/LiquidityHeatmapEngine.js'
import type { Candle } from '../../src/models/price/Candle.js'

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`)
	return i >= 0 && process.argv[i + 1] != null ? process.argv[i + 1] : undefined
}

function mulberry32(seed: number): () => number {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

async function loadCandles(): Promise<Candle[]> {
	const file = arg('file')
	if (file) return JSON.parse(readFileSync(file, 'utf8')) as Candle[]
	const { fetchCandlesPaginated } = await import('../shared/candleFetcher.js')
	return fetchCandlesPaginated(arg('symbol') ?? 'BTC/USDT', arg('tf') ?? '1h', Number(arg('limit') ?? 5000), 'futures')
}

interface Obs {
	anchor: number
	side: 'sell-side' | 'buy-side'
	close: number
	distPct: number
	strongHit: boolean
	weakHit: boolean
}

function reach(candles: Candle[], anchor: number, horizon: number, side: 'sell-side' | 'buy-side', level: number): boolean {
	const end = Math.min(candles.length - 1, anchor + horizon)
	for (let j = anchor + 1; j <= end; j++) {
		const b = candles[j]!
		if (side === 'sell-side' ? b.high >= level : b.low <= level) return true
	}
	return false
}

async function main(): Promise<void> {
	const candles = await loadCandles()
	const horizon = Number(arg('horizon') ?? 100)
	const stride = Number(arg('stride') ?? Math.max(10, Math.floor(candles.length / 80)))
	const warmup = Math.max(150, Math.floor(candles.length * 0.2))
	const cfg = heatmapConfigForTf(inferTfMs(candles))
	const rnd = mulberry32(42)
	const obs: Obs[] = []
	for (let i = warmup; i + horizon < candles.length; i += stride) {
		const pools = detectLiquidityHeatmap(candles.slice(0, i + 1), cfg).filter(p => p.status === 'active')
		const close = candles[i]!.close
		for (const side of ['sell-side', 'buy-side'] as const) {
			const sided = pools
				.filter(p => p.side === side)
				.filter(p => (side === 'sell-side' ? p.extremePrice > close : p.extremePrice < close))
				.filter(p => Math.abs(p.extremePrice / close - 1) <= 0.10)
				.sort((a, b) => b.notional - a.notional)
			if (sided.length < 4) continue
			const strong = sided[0]!
			const half = Math.floor(sided.length / 2)
			const weak = sided[half + Math.floor(rnd() * (sided.length - half))]!
			obs.push({
				anchor: i, side, close,
				distPct: Math.abs(strong.extremePrice / close - 1),
				strongHit: reach(candles, i, horizon, side, strong.extremePrice),
				weakHit: reach(candles, i, horizon, side, weak.extremePrice),
			})
		}
	}
	const pct = (xs: boolean[]): string => xs.length ? `${(100 * xs.filter(Boolean).length / xs.length).toFixed(1)}%` : '—'
	console.log(`candles=${candles.length} obs=${obs.length} horizon=${horizon} stride=${stride} warmup=${warmup}`)
	for (const side of ['sell-side', 'buy-side'] as const) {
		const xs = obs.filter(o => o.side === side)
		if (!xs.length) { console.log(`${side}: наблюдений нет`); continue }
		const dists = xs.map(o => o.distPct)
		for (let k = dists.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); const tmp = dists[k]!; dists[k] = dists[j]!; dists[j] = tmp }
		const ctrl = xs.map((o, idx) => reach(candles, o.anchor, horizon, side,
			side === 'sell-side' ? o.close * (1 + dists[idx]!) : o.close * (1 - dists[idx]!)))
		const med = xs.map(o => o.distPct).sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
		console.log(`${side}: n=${xs.length} | strong ${pct(xs.map(o => o.strongHit))} | weak-band ${pct(xs.map(o => o.weakHit))} | perm-control ${pct(ctrl)} | median dist ${(100 * med).toFixed(2)}%`)
	}
	console.log('strong > perm-control => уровни несут сигнал сверх расстояния; strong > weak-band => вес полки информативен.')
}

main().catch((e) => { console.error(e); process.exit(1) })
