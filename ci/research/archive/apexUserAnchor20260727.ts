import { mkdirSync, writeFileSync } from 'node:fs'
import { computeApexBands } from '../../../src/core/signals/ApexEngine.js'
import { fetchArchiveKlines } from '../../../tools/shared/archiveKlines.js'

const OUT = process.env.OUT_DIR ?? 'ci-results'
const CACHE = process.env.CACHE_DIR ?? '.cache/binance'
const AT = Date.UTC(2026, 6, 26, 20, 0) // 27.07 01:00 Казахстан (UTC+5)
const FROM = Date.UTC(2026, 1, 1)
const UNTIL = Date.UTC(2026, 6, 27)

type Tf = '4h' | '1h' | '15m' | '5m'
type Tv = { mean: number; redHi: number; redLo: number; greenHi: number; greenLo: number }
const TV: Record<Tf, Tv> = {
	'4h': { mean: 64825.74, redHi: 70660.48, redLo: 68104.20, greenHi: 61428.02, greenLo: 59205.75 },
	'1h': { mean: 64507.54, redHi: 66714.16, redLo: 65877.95, greenHi: 63591.90, greenLo: 62794.82 },
	'15m': { mean: 64516.53, redHi: 65109.00, redLo: 64861.48, greenHi: 64173.41, greenLo: 63929.45 },
	'5m': { mean: 64687.52, redHi: 65069.46, redLo: 64910.04, greenHi: 64465.75, greenLo: 64307.81 },
}
const pct = (actual: number, target: number) => (actual / target - 1) * 100
const f = (x: number) => x.toFixed(3)
const targetS = (x: Tv) => (
	Math.log(x.redHi / x.mean) / 9.6
	+ Math.log(x.redLo / x.mean) / 5.6
	+ Math.log(x.mean / x.greenHi) / 5.6
	+ Math.log(x.mean / x.greenLo) / 9.6
) / 4

const rows = []
for (const tf of Object.keys(TV) as Tf[]) {
	const candles = await fetchArchiveKlines('BTC/USDT', tf, 'spot', FROM, UNTIL, { cacheDir: CACHE, parallel: 12 })
	const i = candles.findIndex((c) => c.timestamp === AT)
	if (i < 0) throw new Error(`bar not found ${tf} ${new Date(AT).toISOString()}`)
	const band = computeApexBands(candles)[i]!
	const tv = TV[tf]
	rows.push({
		tf,
		bar: candles[i],
		tv,
		model: band,
		meanErrorPct: pct(band.mean, tv.mean),
		widthErrorPct: pct(band.s, targetS(tv)),
		edgeErrorsPct: {
			redHi: pct(band.redHi, tv.redHi), redLo: pct(band.redLo, tv.redLo),
			greenHi: pct(band.greenHi, tv.greenHi), greenLo: pct(band.greenLo, tv.greenLo),
		},
	})
}
mkdirSync(OUT, { recursive: true })
writeFileSync(`${OUT}/apex-user-anchor-2026-07-27.json`, JSON.stringify({ at: new Date(AT).toISOString(), source: 'TradingView BINANCE BTCUSDT spot, user status-line screenshots', rows }, null, 2))
let md = '# Apex: пользовательские TV-якоря 27.07.2026 01:00 Казахстан\n\n'
md += `- Timestamp: ${new Date(AT).toISOString()} (UTC), один и тот же bar-open для 5m/15m/1h/4h.\n`
md += '- Feed: TradingView BINANCE BTCUSDT Spot. Архив сравнения: Binance Spot data.binance.vision.\n'
md += '- TV-порядок значений интерпретирован как mean, upper outer, upper inner, lower inner, lower outer.\n'
md += '- Текущие defaults не менялись.\n\n'
md += '| TF | TV mean | model mean | mean err | TV s | model s | width err | max edge err |\n|---|---:|---:|---:|---:|---:|---:|---:|\n'
for (const r of rows) {
	const maxEdge = Math.max(...Object.values(r.edgeErrorsPct).map(Math.abs))
	md += `| ${r.tf} | ${r.tv.mean.toFixed(2)} | ${r.model.mean.toFixed(2)} | ${f(r.meanErrorPct)}% | ${targetS(r.tv).toFixed(6)} | ${r.model.s.toFixed(6)} | ${f(r.widthErrorPct)}% | ${f(maxEdge)}% |\n`
}
md += '\n## Интерпретация\n\n'
md += '- Mean и width оцениваются отдельно; абсолютная долларовая разница линий не смешивается с feed basis.\n'
md += '- Здесь feed совпадает (spot против spot), поэтому остаток — ошибка модели/точности чтения status line, а не futures basis.\n'
md += '- Один timestamp на четырёх TF — calibration point, не доказательство vendor formula. Следующий gate — другие даты и OOS symbol.\n'
writeFileSync(`${OUT}/apex-user-anchor-2026-07-27.md`, md)
console.log(md)
