/**
 * RE-recon — согласование ДВУХ вендорских корпусов: telegram-алерты vs CSV-shapes.
 *
 * Зачем: ревью (GPT 5.6 Sol) утверждает, что мы реверсим не один объект, а СМЕШИВАЕМ два:
 *   • CSV-shapes   — ВСЯ отрисовка стрелок индикатора на графике (колонки Shapes в csv/BINANCE_*.csv);
 *   • telegram     — ЖИВЫЕ алерты, но лишь ОТОБРАННОЕ подмножество (алерт-гейт вендора + курирование
 *                    «активы с хорошей статистикой», подтв. автором).
 * Sol намерил на пересечении ~40% покрытия даже на лучшем лаге. Здесь воспроизводим это НА НАШЕЙ стороне.
 *
 * Что делаем (чистое ИЗМЕРЕНИЕ, движок src/core НЕ трогаем, §2.2):
 *   1) Парсим telegram scalp (`data/vendor-exports/tg_topic_16293_scalp.json`): дата отправки (UTC),
 *      сторона (ЛОНГ→buy / ШОРТ→sell), символ, ТФ (мин) из текста «Сигнал в ЛОНГ VIRTUALUSDT.P 5».
 *   2) Грузим CSV-shapes для тех же (символ, ТФ), что есть в csv/ (иначе сравнивать нечего).
 *   3) Матч telegram↔CSV той же стороны: сканируем целочисленный лаг d∈[-L..L] баров, greedy one-to-one
 *      по |d|. Метрики: coverage(tol) = доля telegram-алертов, у которых есть CSV-shape в пределах ±tol;
 *      гистограмма лага совпавших пар (где пик — там реальный сдвиг бар-вычисления vs время доставки).
 *   4) Плотность: над ОБЩИМ окном времени (пересечение диапазонов) сколько CSV-shapes на 1 telegram-алерт.
 *   5) Экскурсии (close по одну сторону mean): медиана shapes/экскурсия vs telegram-алертов/экскурсия —
 *      прямой разрешитель «вендор рисует несколько стрелок за заход, а публикует меньше».
 *
 * Запуск: npx tsx ci/research/runReReconTelegramVsShapes.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

// (символ в тексте telegram, ТФ мин) -> файл CSV. Только пересечение корпусов.
const CSV_MAP: Array<{ symbol: string; tfMin: number; key: string; file: string }> = [
	{ symbol: 'BTCUSDT.P', tfMin: 5, key: 'BTC.P 5m', file: 'csv/BINANCE_BTCUSDT.P, 5.csv' },
	{ symbol: 'BTCUSDT.P', tfMin: 15, key: 'BTC.P 15m', file: 'csv/BINANCE_BTCUSDT.P, 15.csv' },
	{ symbol: 'BTCUSDT.P', tfMin: 60, key: 'BTC.P 1h', file: 'csv/BINANCE_BTCUSDT.P, 60.csv' },
	{ symbol: 'BNBUSDT.P', tfMin: 5, key: 'BNB.P 5m', file: 'csv/BINANCE_BNBUSDT.P, 5.csv' },
	{ symbol: 'VIRTUALUSDT.P', tfMin: 5, key: 'VIRTUAL.P 5m', file: 'csv/BINANCE_VIRTUALUSDT.P, 5.csv' },
]
const TG_FILE = 'data/vendor-exports/tg_topic_16293_scalp.json'
const LAG = 20 // максимальный сканируемый лаг в барах (обе стороны)
const TOLS = [0, 1, 2, 3, 5, 8] // допуски для кривой покрытия

type Side = 'buy' | 'sell'
interface Bar { t: number; close: number; mean: number; buy: boolean; sell: boolean }
interface Shape { t: number; side: Side }
interface Alert { t: number; side: Side }

const num = (x: string | undefined): number => { const n = Number((x ?? '').trim()); return Number.isFinite(n) ? n : NaN }

function loadCsv(file: string): Bar[] {
	const lines = readFileSync(resolve(file), 'utf8').split(/\r?\n/).filter((l) => l.length > 0)
	const bars: Bar[] = []
	for (let li = 1; li < lines.length; li++) {
		const p = lines[li]!.split(',')
		if (p.length < 13) continue
		const t = num(p[0]), c = num(p[4]), mean = num(p[5])
		if (!Number.isFinite(t) || !Number.isFinite(c)) continue
		bars.push({ t, close: c, mean, buy: (p[10] ?? '0').trim() === '1', sell: (p[11] ?? '0').trim() === '1' })
	}
	bars.sort((a, b) => a.t - b.t)
	return bars
}

/** Парс telegram: {ts сек, side, symbol, tfMin}. Сторона: ЛОНГ→buy, ШОРТ→sell. */
function loadTelegram(): Array<{ t: number; side: Side; symbol: string; tfMin: number }> {
	const raw = JSON.parse(readFileSync(resolve(TG_FILE), 'utf8')) as Array<{ date?: string; text?: string }>
	const out: Array<{ t: number; side: Side; symbol: string; tfMin: number }> = []
	const re = /(ЛОНГ|ШОРТ)\s+([A-Za-z0-9.]+)\s+(\d+)\s*$/
	for (const m of raw) {
		if (!m.date || !m.text) continue
		const mm = m.text.match(re)
		if (!mm) continue
		const side: Side = mm[1] === 'ЛОНГ' ? 'buy' : 'sell'
		const symbol = mm[2]!.toUpperCase()
		const tfMin = Number(mm[3])
		const t = Math.floor(Date.parse(m.date) / 1000)
		if (!Number.isFinite(t) || !Number.isFinite(tfMin)) continue
		out.push({ t, side, symbol, tfMin })
	}
	return out
}

interface KeyResult {
	key: string; tfMin: number
	tgN: number; shapeN: number; shapeNWin: number; densityShapePerAlert: number
	overlapFrom: string; overlapTo: string
	coverage: Record<number, number> // tol -> доля покрытых алертов
	lagHist: Array<{ d: number; n: number }> // распределение лага совпавших пар (±LAG)
	bestOffset: number; bestOffsetCoverage: number
	medShapesPerExc: number; medAlertsPerExc: number; excWithShape: number
}

function median(xs: number[]): number {
	if (!xs.length) return NaN
	const s = [...xs].sort((a, b) => a - b)
	const mid = Math.floor(s.length / 2)
	return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2
}

function analyzeKey(cfg: { key: string; tfMin: number }, bars: Bar[], alerts: Alert[]): KeyResult {
	const tfSec = cfg.tfMin * 60
	const shapes: Shape[] = []
	for (const b of bars) { if (b.buy) shapes.push({ t: b.t, side: 'buy' }); if (b.sell) shapes.push({ t: b.t, side: 'sell' }) }
	// МАТЧ ПО АБСОЛЮТНОМУ ВРЕМЕНИ (устойчиво к пропускам баров): ключ = open-time бара на сетке tfSec.
	const shapeByTime = new Map<number, Set<Side>>() // barTime -> стороны shapes на этом баре
	for (const b of bars) { const s = new Set<Side>(); if (b.buy) s.add('buy'); if (b.sell) s.add('sell'); if (s.size) shapeByTime.set(b.t, s) }
	const gridOf = (t: number) => Math.floor(t / tfSec) * tfSec // бар, ОТКРЫТЫЙ в момент t

	// окно пересечения по времени (общий диапазон CSV ∩ telegram)
	const csvFrom = bars[0]!.t, csvTo = bars[bars.length - 1]!.t
	const tgTs = alerts.map((a) => a.t)
	const winFrom = Math.max(csvFrom, Math.min(...tgTs)), winTo = Math.min(csvTo, Math.max(...tgTs))
	const shapeNWin = shapes.filter((s) => s.t >= winFrom && s.t <= winTo).length
	const tgInWin = alerts.filter((a) => a.t >= winFrom && a.t <= winTo)

	// grid-время каждого алерта в окне
	const alertGrid = tgInWin.map((a) => ({ gt: gridOf(a.t), side: a.side }))

	// coverage(tol): есть ли CSV-shape той же стороны в пределах ±tol баров (по времени сетки)
	const coverage: Record<number, number> = {}
	for (const tol of TOLS) {
		let cov = 0
		for (const a of alertGrid) {
			let hit = false
			for (let d = -tol; d <= tol && !hit; d++) { const set = shapeByTime.get(a.gt + d * tfSec); if (set && set.has(a.side)) hit = true }
			if (hit) cov++
		}
		coverage[tol] = tgInWin.length ? cov / tgInWin.length : 0
	}

	// лаг-гистограмма: greedy one-to-one матч по |d| в пределах ±LAG (совпавшие пары)
	const lagCount = new Map<number, number>()
	const usedShape = new Set<string>() // `${shapeTime}:${side}`
	const cand: Array<{ ai: number; d: number; side: Side; shapeTime: number }> = []
	alertGrid.forEach((a, ai) => {
		for (let d = -LAG; d <= LAG; d++) { const st = a.gt + d * tfSec; const set = shapeByTime.get(st); if (set && set.has(a.side)) cand.push({ ai, d, side: a.side, shapeTime: st }) }
	})
	cand.sort((x, y) => Math.abs(x.d) - Math.abs(y.d))
	const usedAlert = new Set<number>()
	for (const c of cand) {
		const skey = `${c.shapeTime}:${c.side}`
		if (usedAlert.has(c.ai) || usedShape.has(skey)) continue
		usedAlert.add(c.ai); usedShape.add(skey)
		lagCount.set(c.d, (lagCount.get(c.d) ?? 0) + 1)
	}
	const lagHist = [...lagCount.entries()].map(([d, n]) => ({ d, n })).sort((a, b) => a.d - b.d)
	// лучший ЕДИНЫЙ офсет (максимум совпадений на одном d)
	let bestOffset = 0, bestN = -1
	for (const { d, n } of lagHist) if (n > bestN) { bestN = n; bestOffset = d }
	const bestOffsetCoverage = tgInWin.length ? bestN / tgInWin.length : 0

	// экскурсии: сегменты, пока close по одну сторону mean; считаем shapes и telegram-алерты в каждой (в окне)
	const shapesPerExc: number[] = [], alertsPerExc: number[] = []
	const alertsByBarTime = new Map<number, number>() // barTime -> кол-во алертов, попавших на этот бар
	for (const a of alertGrid) alertsByBarTime.set(a.gt, (alertsByBarTime.get(a.gt) ?? 0) + 1)
	let side: 'up' | 'down' | 'none' = 'none', sCount = 0, aCount = 0
	const flush = () => { if (side !== 'none' && (sCount > 0 || aCount > 0)) { shapesPerExc.push(sCount); alertsPerExc.push(aCount) } sCount = 0; aCount = 0 }
	for (const b of bars) {
		if (b.t < winFrom || b.t > winTo || !Number.isFinite(b.mean)) continue
		const pos: 'up' | 'down' | 'none' = b.close > b.mean ? 'up' : b.close < b.mean ? 'down' : 'none'
		if (pos === 'none') continue
		if (side === 'none') side = pos
		else if (pos !== side) { flush(); side = pos }
		if (b.buy) sCount++; if (b.sell) sCount++
		aCount += alertsByBarTime.get(b.t) ?? 0
	}
	flush()
	const excWithShape = shapesPerExc.filter((x) => x > 0).length

	return {
		key: cfg.key, tfMin: cfg.tfMin,
		tgN: alerts.length, shapeN: shapes.length, shapeNWin,
		densityShapePerAlert: tgInWin.length ? shapeNWin / tgInWin.length : 0,
		overlapFrom: new Date(winFrom * 1000).toISOString(), overlapTo: new Date(winTo * 1000).toISOString(),
		coverage, lagHist, bestOffset, bestOffsetCoverage,
		medShapesPerExc: median(shapesPerExc), medAlertsPerExc: median(alertsPerExc), excWithShape,
	}
}

function main() {
	const pct = (x: number) => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : 'n/a')
	const tg = loadTelegram()
	console.log(`telegram: распарсено ${tg.length} алертов (всего в файле, все символы/ТФ)`)

	const results: KeyResult[] = []
	for (const cfg of CSV_MAP) {
		let bars: Bar[]
		try { bars = loadCsv(cfg.file) } catch { console.log(`skip ${cfg.key}: нет файла`); continue }
		if (bars.length < 100) { console.log(`skip ${cfg.key}: мало баров`); continue }
		const alerts: Alert[] = tg.filter((a) => a.symbol === cfg.symbol && a.tfMin === cfg.tfMin).map((a) => ({ t: a.t, side: a.side }))
		if (!alerts.length) { console.log(`skip ${cfg.key}: 0 telegram-алертов для этой пары`); continue }
		const r = analyzeKey(cfg, bars, alerts)
		results.push(r)
		console.log(`[${r.key}] tgN=${r.tgN} shapeN=${r.shapeN} | окно tg-алертов=${alerts.filter((a)=>a.t>=Date.parse(r.overlapFrom)/1000&&a.t<=Date.parse(r.overlapTo)/1000).length} | shapes/alert(win)=×${r.densityShapePerAlert.toFixed(1)} | cov@0/1/2/3=${pct(r.coverage[0]!)}/${pct(r.coverage[1]!)}/${pct(r.coverage[2]!)}/${pct(r.coverage[3]!)} | bestOffset=${r.bestOffset} (${pct(r.bestOffsetCoverage)}) | med shapes/exc=${r.medShapesPerExc} vs alerts/exc=${r.medAlertsPerExc}`)
	}
	if (!results.length) throw new Error('Нет пересечения telegram↔CSV. Проверь CSV_MAP и парсинг текста.')

	const md: string[] = []
	md.push('# RE-recon — согласование telegram-алертов и CSV-shapes (два вендорских корпуса)')
	md.push('')
	md.push('Проверка гипотезы ревью: telegram ⊂ CSV-shapes (telegram — отобранное подмножество живой отрисовки). Матч той же стороны, лаг в барах сканируется. Движок не тронут.')
	md.push('')
	md.push('## Сводка по парам (пересечение корпусов)')
	md.push('')
	md.push('| пара | tgN(все ТФ-пары) | shapeN(всего) | shapes/alert в окне | cov ±0 | ±1 | ±2 | ±3 | ±5 | ±8 | best-offset (cov) | med shapes/эксурс | med alerts/эксурс |')
	md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
	for (const r of results)
		md.push(`| ${r.key} | ${r.tgN} | ${r.shapeN} | ×${r.densityShapePerAlert.toFixed(1)} | ${pct(r.coverage[0]!)} | ${pct(r.coverage[1]!)} | ${pct(r.coverage[2]!)} | ${pct(r.coverage[3]!)} | ${pct(r.coverage[5]!)} | ${pct(r.coverage[8]!)} | ${r.bestOffset} (${pct(r.bestOffsetCoverage)}) | ${r.medShapesPerExc} | ${r.medAlertsPerExc} |`)
	md.push('')
	md.push('- **cov ±k** — доля telegram-алертов, у которых ЕСТЬ CSV-shape той же стороны в пределах ±k баров.')
	md.push('- **shapes/alert в окне** — во сколько раз CSV рисует больше стрелок, чем публикуется в telegram (за общий период).')
	md.push('- **best-offset** — целочисленный лаг баров с максимумом совпадений (где стоит пик = реальный сдвиг «бар вычисления vs время доставки»).')
	md.push('- **med shapes/эксурс vs alerts/эксурс** — сколько стрелок рисуется и сколько публикуется за один заход цены по одну сторону от mean.')
	md.push('')
	for (const r of results) {
		md.push(`### ${r.key} — гистограмма лага (совпавшие пары, бар telegram − бар shape)`)
		md.push('')
		md.push(`Окно пересечения: ${r.overlapFrom} … ${r.overlapTo}. Экскурсий со стрелкой: ${r.excWithShape}.`)
		md.push('')
		md.push('| лаг (баров) | совпадений |')
		md.push('|---|---|')
		for (const h of r.lagHist) md.push(`| ${h.d} | ${h.n} |`)
		md.push('')
	}

	writeFileSync(resolve('ci-results/re-recon-telegram-vs-shapes.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/re-recon-telegram-vs-shapes.json'), JSON.stringify({
		generatedAt: new Date().toISOString(),
		telegramTotalParsed: tg.length,
		lagScan: LAG, tolerances: TOLS,
		results,
	}, null, 2))
	console.log('\nЗаписано: ci-results/re-recon-telegram-vs-shapes.{md,json}')
}

main()
