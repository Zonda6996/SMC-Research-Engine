/**
 * E5-geom-measure — измерение МАСШТАБА геометрии на LDO 15m Binance SPOT (ничего не выдумываем).
 *
 * Вход: канонический BASE (safe). Логика тейка ПОДТВЕРЖДЕНА автором как верная:
 *   partial — ровно у band.mean; full — у GGI Inner (buy → redLo/Upper Inner, sell → greenHi/Lower Inner).
 * Стоп же в движке считается ОТДЕЛЬНОЙ формулой: stop = entry ± stopSteps·step, step = 5.5·atr200
 * (не связан с шириной зоны GGI = m·s). Вендорский средний стоп −1.86%.
 *
 * Замеряем по каждой сделке дистанции от входа в % до: mean (частичка), Inner (фулл-тейк), stop.
 * Вопрос: насколько наш стоп (2·5.5·atr200) далёк ОТНОСИТЕЛЬНО самой Inner-линии тейка?
 * Если stop ≫ inner — риск/прибыль структурно вывернут, и косой именно стоп, а не тейк.
 *
 * Запуск: npx tsx ci/research/measureLdoGeometryScale.ts
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { computeApexBands, APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { detectArrowSignalCandidates } from '../../src/core/signals/ArrowSignalEngine.js'
import { replayArrowSignals } from '../../src/core/signals/ArrowTradeReplay.js'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'

const SYMBOL = 'LDO/USDT', TF = '15m', REL_VOL = 1.4
const FROM = Date.UTC(2024, 6, 1)
const CACHE = resolve('tmp/viz-archive-cache')
const WINDOW = 20_000

const median = (xs: number[]): number => {
	if (!xs.length) return NaN
	const s = [...xs].sort((a, b) => a - b)
	const m = Math.floor(s.length / 2)
	return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}
const pct = (a: number, b: number) => Math.abs(a - b) / b * 100
const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a')

interface Rec { side: 'long' | 'short'; meanD: number; innerD: number; stopD: number; ratio: number; outcome: string; netR: number }

async function main() {
	const full = await fetchArchiveKlines(SYMBOL, TF, 'spot', FROM, Date.now(), { cacheDir: CACHE, parallel: 8 })
	const candles = full.slice(-WINDOW)
	const bands = computeApexBands(candles, APEX_PARAMS)
	const sigs = detectArrowSignalCandidates(candles, APEX_PARAMS, { minimumRelativeVolume: REL_VOL }).candidates
	const res = replayArrowSignals(candles, bands, sigs, 'safe', {}) // канон BASE

	const recs: Rec[] = []
	for (const t of res.trades) {
		const b = bands[t.entryIndex]
		if (!b || !Number.isFinite(b.mean)) continue
		const inner = t.side === 'long' ? b.redLo : b.greenHi // Upper Inner (buy) / Lower Inner (sell)
		const entry = t.entry
		const meanD = pct(b.mean, entry)
		const innerD = pct(inner, entry)
		const stopD = pct(t.stop, entry)
		recs.push({ side: t.side, meanD, innerD, stopD, ratio: innerD > 0 ? stopD / innerD : NaN, outcome: t.outcome, netR: t.netR })
	}

	const all = recs
	const by = (side: 'long' | 'short' | null) => side ? recs.filter((r) => r.side === side) : recs
	const block = (label: string, rs: Rec[]) => {
		const md: string[] = []
		md.push(`### ${label} (n=${rs.length})`)
		md.push('')
		md.push('| метрика | медиана % от входа |')
		md.push('|---|---|')
		md.push(`| вход → mean (частичка) | ${f(median(rs.map((r) => r.meanD)))}% |`)
		md.push(`| вход → Inner (фулл-тейк) | ${f(median(rs.map((r) => r.innerD)))}% |`)
		md.push(`| вход → stop (наш 2·5.5·atr200) | ${f(median(rs.map((r) => r.stopD)))}% |`)
		md.push(`| **отношение stop/Inner** | **${f(median(rs.map((r) => r.ratio)))}×** |`)
		md.push(`| стоп вендора (эталон) | ~1.86% |`)
		md.push('')
		return md
	}

	const md: string[] = []
	md.push('# E5 geom-measure — масштаб геометрии LDO 15m SPOT (канон BASE)')
	md.push('')
	md.push(`Окно ${candles.length} свечей (${new Date(candles[0]!.timestamp).toISOString().slice(0, 10)}→${new Date(candles.at(-1)!.timestamp).toISOString().slice(0, 10)}), сделок=${recs.length}.`)
	md.push('Тейк-логика подтверждена (partial@mean, full@GGI Inner). Замер: как далеко стоят уровни от входа.')
	md.push('')
	md.push(...block('ВСЕ', by(null)))
	md.push(...block('LONG (buy → Upper Inner)', by('long')))
	md.push(...block('SHORT (sell → Lower Inner)', by('short')))

	// Если стоп сузить до дистанции самой Inner-линии — что покажет средний стоп?
	md.push('## Ключевой замер')
	md.push('')
	const medStop = median(all.map((r) => r.stopD))
	const medInner = median(all.map((r) => r.innerD))
	const medMean = median(all.map((r) => r.meanD))
	md.push(`- Наш стоп (вход→stop) медиана: **${f(medStop)}%**. Средний стоп вендора: **~1.86%**. Отношение: **${f(medStop / 1.86)}×** шире.`)
	md.push(`- Фулл-тейк (Inner) медиана: **${f(medInner)}%** от входа; частичка (mean): **${f(medMean)}%**.`)
	md.push(`- Отношение stop/Inner: **${f(median(all.map((r) => r.ratio)))}×** — во столько раз наш стоп дальше самой цели фулл-тейка.`)
	md.push('')

	writeFileSync(resolve('ci-results/e5-geom-measure-ldo-spot.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/e5-geom-measure-ldo-spot.json'), JSON.stringify({ generatedAt: new Date().toISOString(), symbol: SYMBOL, tf: TF, window: candles.length, n: recs.length, medians: { meanD: medMean, innerD: medInner, stopD: medStop, ratioStopInner: median(all.map((r) => r.ratio)) }, vendorAvgStopPct: -1.86, recs }, null, 2))

	console.log(`[geom-measure] сделок=${recs.length}`)
	console.log(`  вход→mean медиана   = ${f(medMean)}%`)
	console.log(`  вход→Inner медиана  = ${f(medInner)}% (фулл-тейк)`)
	console.log(`  вход→stop медиана   = ${f(medStop)}% (наш) vs ~1.86% вендор → ${f(medStop / 1.86)}× шире`)
	console.log(`  stop/Inner медиана  = ${f(median(all.map((r) => r.ratio)))}×`)
	for (const side of ['long', 'short'] as const) {
		const rs = by(side)
		console.log(`  [${side}] mean=${f(median(rs.map((r) => r.meanD)))}% inner=${f(median(rs.map((r) => r.innerD)))}% stop=${f(median(rs.map((r) => r.stopD)))}% ratio=${f(median(rs.map((r) => r.ratio)))}×`)
	}
	console.log('\n[geom-measure] written ci-results/e5-geom-measure-ldo-spot.{md,json}')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((e) => { console.error(e); process.exitCode = 1 })
}
