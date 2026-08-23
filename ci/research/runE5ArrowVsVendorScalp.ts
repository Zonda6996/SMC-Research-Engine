/**
 * E5-arrow-vs-vendor — сверка наших OWN2-стрелок с РЕАЛЬНЫМИ scalp-алертами вендора.
 *
 * Гипотеза автора: «стрелка косая» — вход не так качественно/часто, как у вендора.
 * Данные вендора: `data/vendor-exports/tg_topic_16293_scalp.json` — сырые алерты скальп-канала
 * (время + направление + символ.P + ТФ). ⚠ БЕЗ цены входа → меряем ТАЙМИНГ/НАПРАВЛЕНИЕ/ПЛОТНОСТЬ,
 * не суб-бар. Символы перп (.P) → фид futures (как тэг алерта).
 *
 * Метрики на (символ, ТФ):
 *  - vendorN / ourN — сколько алертов у него против наших OWN2 в том же окне (плотность);
 *  - recall_dir — доля его алертов, у которых есть наша стрелка в ±1 бар ТОЙ ЖЕ стороны;
 *  - recall_time — то же без учёта стороны (изолируем тайминг от направления);
 *  - precision — доля наших стрелок, попавших в его алерт (±1 бар, любая сторона) → «лишние» = 1−precision;
 *  - dirAgree — на совпавших по времени: доля совпадения стороны.
 *
 * Движок/детектор не тронуты (§2.1). Запуск: npx tsx ci/research/runE5ArrowVsVendorScalp.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { computeApexBands, APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'
import { detectArrowSignalCandidates } from '../../src/core/signals/ArrowSignalEngine.js'
import { fetchArchiveKlines } from '../../tools/shared/archiveKlines.js'
import { TF_MS } from '../../tools/shared/candleFetcher.js'

const REL_VOL = 1.4
const CACHE = resolve('tmp/viz-archive-cache')
const SYMBOLS = ['VIRTUAL', 'BNB', 'ETH', 'INJ', 'ARB', 'OP', 'CRV', 'ONDO']
const TFS: Array<[number, string]> = [[5, '5m'], [15, '15m']]
const MIN_ALERTS = 8

interface Alert { symbol: string; tfMin: number; side: 'long' | 'short'; timeMs: number }

function loadVendorAlerts(): Alert[] {
	const raw = JSON.parse(readFileSync(resolve('data/vendor-exports/tg_topic_16293_scalp.json'), 'utf8')) as Array<{ date: string; text: string }>
	const out: Alert[] = []
	for (const m of raw) {
		const mm = (m.text || '').match(/Сигнал в (ЛОНГ|ШОРТ)\s+([A-Z0-9]+)USDT\.P\s+(\d+)/)
		if (!mm) continue
		out.push({ symbol: mm[2]!, tfMin: Number(mm[3]), side: mm[1] === 'ЛОНГ' ? 'long' : 'short', timeMs: Date.parse(m.date) })
	}
	return out
}

const bar = (ms: number, tfMs: number) => Math.floor(ms / tfMs) * tfMs

interface Res { symbol: string; tf: string; days: number; vendorN: number; ourN: number; recallDir: number; recallTime: number; precision: number; dirAgree: number | null }

async function evalPair(symbol: string, tfMin: number, tfName: string, alerts: Alert[]): Promise<Res | null> {
	const tfMs = TF_MS[tfName]!
	const times = alerts.map((a) => a.timeMs).sort((x, y) => x - y)
	const from = times[0]! - 500 * tfMs // запас на ALMA200/atr200
	const to = times[times.length - 1]! + tfMs
	let candles
	try { candles = await fetchArchiveKlines(`${symbol}/USDT`, tfName, 'futures', from, to, { cacheDir: CACHE, parallel: 8 }) } catch { return null }
	if (!candles || candles.length < 400) return null
	const bands = computeApexBands(candles, APEX_PARAMS)
	const cand = detectArrowSignalCandidates(candles, APEX_PARAMS, { minimumRelativeVolume: REL_VOL }).candidates
	const winLo = times[0]!, winHi = times[times.length - 1]!
	// наши стрелки в окне алертов
	const ours = cand.filter((c) => c.signalAt >= winLo - tfMs && c.signalAt <= winHi + tfMs).map((c) => ({ b: bar(c.signalAt, tfMs), side: c.side as 'long' | 'short' }))
	const oursByBar = new Map<number, Set<'long' | 'short'>>()
	for (const o of ours) { const s = oursByBar.get(o.b) ?? new Set(); s.add(o.side); oursByBar.set(o.b, s) }
	const near = (b: number): Array<'long' | 'short'> => [...(oursByBar.get(b - tfMs) ?? []), ...(oursByBar.get(b) ?? []), ...(oursByBar.get(b + tfMs) ?? [])]

	let matchedDir = 0, matchedTime = 0, dirAgreeNum = 0, dirAgreeDen = 0
	for (const a of alerts) {
		const b = bar(a.timeMs, tfMs)
		const sides = near(b)
		if (sides.length) { matchedTime++; if (sides.includes(a.side)) matchedDir++; dirAgreeDen++; if (sides.includes(a.side)) dirAgreeNum++ }
	}
	// precision: наши стрелки, попавшие в алерт (±1 бар, любая сторона)
	const vendorBars = new Set(alerts.map((a) => bar(a.timeMs, tfMs)))
	let ourHit = 0
	for (const o of ours) if (vendorBars.has(o.b - tfMs) || vendorBars.has(o.b) || vendorBars.has(o.b + tfMs)) ourHit++
	const days = (winHi - winLo) / 86_400_000
	return {
		symbol, tf: tfName, days, vendorN: alerts.length, ourN: ours.length,
		recallDir: alerts.length ? matchedDir / alerts.length : 0,
		recallTime: alerts.length ? matchedTime / alerts.length : 0,
		precision: ours.length ? ourHit / ours.length : 0,
		dirAgree: dirAgreeDen ? dirAgreeNum / dirAgreeDen : null,
	}
}

const pc = (x: number) => (x * 100).toFixed(0) + '%'

async function main() {
	const all = loadVendorAlerts()
	const results: Res[] = []
	for (const [tfMin, tfName] of TFS) {
		for (const sym of SYMBOLS) {
			const alerts = all.filter((a) => a.symbol === sym && a.tfMin === tfMin)
			if (alerts.length < MIN_ALERTS) continue
			const r = await evalPair(sym, tfMin, tfName, alerts)
			if (r) { results.push(r); console.log(`[${r.tf}] ${sym.padEnd(8)} vendorN=${String(r.vendorN).padStart(3)} ourN=${String(r.ourN).padStart(4)} (×${(r.ourN / r.vendorN).toFixed(1)}) recall_dir=${pc(r.recallDir)} recall_time=${pc(r.recallTime)} precision=${pc(r.precision)} dirAgree=${r.dirAgree == null ? 'n/a' : pc(r.dirAgree)} ~${r.days.toFixed(0)}д`) }
		}
	}

	const md: string[] = []
	md.push('# E5 — сверка наших OWN2-стрелок с реальными scalp-алертами вендора')
	md.push('')
	md.push('Данные вендора: `tg_topic_16293_scalp.json` (сырые алерты, БЕЗ цены входа). Фид futures (.P). OWN2 relVol 1.4.')
	md.push('Матч = наша стрелка в ±1 бар от алерта. recall_dir — с учётом стороны; recall_time — без; precision — доля наших, попавших в алерт.')
	md.push('')
	md.push('| ТФ | символ | vendorN | ourN | ×плотность | recall (dir) | recall (time) | precision | dirAgree | окно |')
	md.push('|---|---|---|---|---|---|---|---|---|---|')
	for (const r of results) md.push(`| ${r.tf} | ${r.symbol} | ${r.vendorN} | ${r.ourN} | ×${(r.ourN / r.vendorN).toFixed(1)} | ${pc(r.recallDir)} | ${pc(r.recallTime)} | ${pc(r.precision)} | ${r.dirAgree == null ? 'n/a' : pc(r.dirAgree)} | ~${r.days.toFixed(0)}д |`)
	md.push('')
	// агрегаты по ТФ
	md.push('## Агрегат по ТФ (взвешенно по vendorN)')
	md.push('')
	md.push('| ТФ | пар | Σvendor | Σour | ×плотность | recall_dir | recall_time | precision |')
	md.push('|---|---|---|---|---|---|---|---|')
	for (const [, tfName] of TFS) {
		const rs = results.filter((r) => r.tf === tfName)
		if (!rs.length) continue
		const sv = rs.reduce((a, r) => a + r.vendorN, 0), so = rs.reduce((a, r) => a + r.ourN, 0)
		const rd = rs.reduce((a, r) => a + r.recallDir * r.vendorN, 0) / sv
		const rt = rs.reduce((a, r) => a + r.recallTime * r.vendorN, 0) / sv
		const pr = rs.reduce((a, r) => a + r.precision * r.ourN, 0) / Math.max(1, so)
		md.push(`| ${tfName} | ${rs.length} | ${sv} | ${so} | ×${(so / sv).toFixed(1)} | ${pc(rd)} | ${pc(rt)} | ${pc(pr)} |`)
	}
	md.push('')
	writeFileSync(resolve('ci-results/e5-arrow-vs-vendor-scalp.md'), md.join('\n'))
	writeFileSync(resolve('ci-results/e5-arrow-vs-vendor-scalp.json'), JSON.stringify({ generatedAt: new Date().toISOString(), relVol: REL_VOL, feed: 'futures', tolBars: 1, source: 'tg_topic_16293_scalp.json', results }, null, 2))
	console.log('\n[arrow-vs-vendor] written ci-results/e5-arrow-vs-vendor-scalp.{md,json}')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((e) => { console.error(e); process.exitCode = 1 })
}
