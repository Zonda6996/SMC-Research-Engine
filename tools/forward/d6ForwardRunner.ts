/**
 * D6 paper-forward — живой журнал сигналов Doppler по ТРЁМ режимам (решение автора 2026-08-23).
 *
 * Режимы (пресеты триггера из census-карты мажоров, ci-results/d6-census-majors.*):
 *   SAFE     OI −20% / цена −5%   — редкие чистые выстрелы
 *   STANDARD OI −15% / цена −5%   — рабочий режим (утверждённое правило)
 *   RISK     OI −12% / цена −5%   — частота вместо качества
 * База сделки одинакова: бар i закрылся с ΔOI_8h≤порог И ΔP_8h≤порог → LONG на open бара i+1;
 * стоп flushLow−0.5×ATR200; цель reclaim = close[i−8]; таймаут 72ч. Окна в барах (8ч).
 * Живой OI: REST futures/data/openInterestHist (5m, окно ~8 суток) ⇒ запускать раз в 1–3 дня.
 * Сигналы старше часа при обнаружении помечаются missed=true (вход упущен, в статистике учитывается).
 * Меж-прогонный min-gap: последний журнальный сигнал режима занимает gap-слот (8 баров).
 * Журнал: tmp/forward/d6/{signals.jsonl,trades.jsonl,state.json,report.md};
 * журналы старого правила (−15/−3, без поля mode) при первом запуске переносятся в *.legacy-oi15px3.
 * Запуск: npx tsx tools/forward/d6ForwardRunner.ts
 */
import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'

const STATE_DIR = 'tmp/forward/d6'
const HOUR = 3_600_000
const WINDOW_BARS = 8
const GAP_BARS = 8
const HOLD_MAX = 72
const ROUND_TRIP_COST = 0.001
const KLINE_LOOKBACK = 420

const MODES = [
	{ id: 'SAFE', oiDrop: -0.20, priceDrop: -0.05 },
	{ id: 'STANDARD', oiDrop: -0.15, priceDrop: -0.05 },
	{ id: 'RISK', oiDrop: -0.12, priceDrop: -0.05 },
] as const

interface ManifestA { symbols: Array<{ symbol: string }> }

function loadUniverse(): string[] {
	const out = new Set<string>()
	for (const p of ['data/own2-thin-bigcorpus/manifest.json', 'data/d6-mgmt/manifest.json']) {
		if (!existsSync(resolve(p))) continue
		const m = JSON.parse(readFileSync(resolve(p), 'utf8')) as ManifestA
		for (const s of m.symbols) out.add(s.symbol)
	}
	// Расширение мониторинга: зрелые мид-капы census Б (решение автора 2026-08-24).
	const extra = 'data/d6-forward-universe.json'
	if (existsSync(resolve(extra))) {
		const m = JSON.parse(readFileSync(resolve(extra), 'utf8')) as ManifestA
		for (const s of m.symbols) out.add(s.symbol)
	}
	return [...out].sort()
}

async function getJson<T>(url: string): Promise<T> {
	for (let attempt = 0; ; attempt++) {
		let res: Response
		try { res = await fetch(url, { signal: AbortSignal.timeout(15_000) }) } catch (e) { if (attempt < 2) { await new Promise((r) => setTimeout(r, 1000)); continue } throw e }
		if (res.ok) return await res.json() as T
		if (attempt < 3 && (res.status === 429 || res.status >= 500)) { await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); continue }
		throw new Error(`HTTP ${res.status}`)
	}
}

interface Kline { openTime: number; open: number; high: number; low: number; close: number }

async function fetchKlines(symbol: string): Promise<Kline[]> {
	const rows = await getJson<unknown[]>(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1h&limit=${KLINE_LOOKBACK}`)
	return rows.filter(Array.isArray).map((r) => ({ openTime: Number(r[0]), open: Number(r[1]), high: Number(r[2]), low: Number(r[3]), close: Number(r[4]) })).filter((k) => [k.openTime, k.open, k.high, k.low, k.close].every(Number.isFinite))
}

/** Живой OI: окна фиксированного шага; окно 8 суток (хватает при ежедневных прогонах). */
async function fetchOi(symbol: string, fromMs: number): Promise<Map<number, number>> {
	const out = new Map<number, number>()
	const CHUNK = 500 * 5 * 60_000
	const FROM_CAP = 8 * 24 * HOUR
	const deadline = Date.now()
	let cursor = Math.max(fromMs, deadline - FROM_CAP)
	while (cursor < deadline) {
		const end = Math.min(cursor + CHUNK, deadline)
		const rows = await getJson<Array<{ sumOpenInterest: string; timestamp: number }>>(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=5m&startTime=${cursor}&endTime=${end}&limit=500`)
		for (const r of rows ?? []) {
			const ts = Number(r.timestamp)
			const oiV = Number(r.sumOpenInterest)
			if (Number.isSafeInteger(ts) && Number.isFinite(oiV)) out.set(ts, oiV)
		}
		cursor = end
	}
	return out
}

function causalOi(klines: Kline[], oi: Map<number, number>): Array<number | null> {
	const points = [...oi.entries()].sort((a, b) => a[0] - b[0])
	const out: Array<number | null> = []
	let j = 0
	let last: [number, number] | null = null
	for (const k of klines) {
		while (j < points.length && points[j]![0] <= k.openTime) last = points[j++]!
		out.push(last != null && k.openTime - last[0] <= 10 * 60_000 ? last[1] : null)
	}
	return out
}

function arrowAtrLocal(candles: Kline[]): Array<number | null> {
	const tr = candles.map((c, i) => i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1]!.close), Math.abs(c.low - candles[i - 1]!.close)))
	const out: Array<number | null> = []
	let sum = 0
	for (let i = 0; i < candles.length; i++) {
		sum += tr[i]!
		if (i >= 200) sum -= tr[i - 200]!
		out.push(i >= 199 ? sum / 200 : null)
	}
	return out
}

interface SignalRecord {
	mode: string
	symbol: string
	signalBarCloseUtc: string
	signalBarOpenMs: number
	detectedAtUtc: string
	missed: boolean
	entryPlanUtc: string
	entry: number | null
	stop: number
	targetRefLevel: number
	riskDist: number
	atr: number
}

type Outcome = 'open' | 'stop' | 'reclaim' | 'timeout' | 'pending-entry'
interface TradeRecord extends SignalRecord {
	exitUtc: string | null
	exitPrice: number | null
	outcome: Outcome
	mfeR: number | null
	netPct: number | null
}

function loadJsonl<T>(path: string): T[] {
	if (!existsSync(path)) return []
	return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T)
}

interface Ctx {
	allSignals: SignalRecord[]
	allTrades: TradeRecord[]
	openBySymbol: Map<string, TradeRecord>
	lastSignalPerKey: Map<string, number>
	signalsPath: string
	tradesPath: string
}

const keyOf = (mode: string, symbol: string): string => `${mode}|${symbol}`

function finishTrade(trade: TradeRecord, bar: Kline, price: number, outcome: 'stop' | 'reclaim' | 'timeout'): void {
	trade.outcome = outcome
	trade.exitUtc = new Date(bar.openTime + HOUR).toISOString()
	trade.exitPrice = price
	trade.netPct = (price - trade.entry!) / trade.entry! - ROUND_TRIP_COST
}

async function processSymbol(symbol: string, ctx: Ctx): Promise<{ newSignals: number; newMissed: number; note: string }> {
	const klines = await fetchKlines(symbol)
	if (klines.length < 220) return { newSignals: 0, newMissed: 0, note: 'мало баров' }
	const nowFloor = Math.floor(Date.now() / HOUR) * HOUR
	const closed = klines.filter((k) => k.openTime + HOUR <= nowFloor)
	const oi = causalOi(closed, await fetchOi(symbol, closed[0]!.openTime))
	const closes = closed.map((k) => k.close)
	const atrArr = arrowAtrLocal(closed)
	let newSignals = 0
	let newMissed = 0

	// Ведение открытых позиций (по каждому режиму).
	for (const mode of MODES) {
		const openTrade = ctx.openBySymbol.get(keyOf(mode.id, symbol))
		if (openTrade == null || openTrade.outcome !== 'open') continue
		const entryIdx = closed.findIndex((k) => k.openTime === Date.parse(openTrade.entryPlanUtc))
		if (entryIdx < 0) continue
		for (let k = entryIdx; k < closed.length && openTrade.outcome === 'open'; k++) {
			const bar = closed[k]!
			openTrade.mfeR = Math.max(openTrade.mfeR ?? 0, (bar.high - openTrade.entry!) / openTrade.riskDist)
			if (bar.low <= openTrade.stop) finishTrade(openTrade, bar, openTrade.stop, 'stop')
			else if (k > entryIdx && bar.close >= openTrade.targetRefLevel) finishTrade(openTrade, bar, bar.close, 'reclaim')
			else if (k - entryIdx >= HOLD_MAX - 1) finishTrade(openTrade, bar, bar.close, 'timeout')
		}
	}

	// Детекция новых событий по каждому режиму.
	for (const mode of MODES) {
		const lastSigMs = ctx.lastSignalPerKey.get(keyOf(mode.id, symbol)) ?? Number.NEGATIVE_INFINITY
		let lastAdmittedOffset = -Infinity
		for (let i = WINDOW_BARS; i < closed.length; i++) {
			const bar = closed[i]!
			if (bar.openTime <= lastSigMs) continue
			if (bar.openTime - lastSigMs < GAP_BARS * HOUR) continue
			const oiNow = oi[i]
			const oiPast = oi[i - WINDOW_BARS]!
			if (oiNow == null || oiPast == null || oiPast <= 0) continue
			if (!(oiNow / oiPast - 1 <= mode.oiDrop && closes[i]! / closes[i - WINDOW_BARS]! - 1 <= mode.priceDrop)) continue
			if (i - lastAdmittedOffset < GAP_BARS) continue
			lastAdmittedOffset = i
			const atr = atrArr[i]!
			if (!(Number.isFinite(atr) && atr > 0)) continue
			const lows = closed.slice(i - WINDOW_BARS + 1, i + 1).map((k) => k.low)
			const stop = Math.min(...lows) - 0.5 * atr
			const refLevel = closes[i - WINDOW_BARS]!
			const entryBar = closed[i + 1]
			const missed = Date.now() > bar.openTime + HOUR + 15 * 60_000
			const sig: SignalRecord = {
				mode: mode.id,
				symbol,
				signalBarCloseUtc: new Date(bar.openTime + HOUR).toISOString(),
				signalBarOpenMs: bar.openTime,
				detectedAtUtc: new Date().toISOString(),
				missed,
				entryPlanUtc: new Date(bar.openTime + HOUR).toISOString(),
				entry: entryBar?.open ?? null,
				stop,
				targetRefLevel: refLevel,
				riskDist: (entryBar?.open ?? NaN) - stop,
				atr,
			}
			ctx.allSignals.push(sig)
			newSignals++
			if (missed) newMissed++
			appendFileSync(ctx.signalsPath, JSON.stringify(sig) + '\n')
			const openKey = keyOf(mode.id, symbol)
			if (!missed && entryBar != null && !ctx.openBySymbol.has(openKey)) {
				const trade: TradeRecord = { ...sig, outcome: 'open', exitUtc: null, exitPrice: null, mfeR: (entryBar.high - entryBar.open) / sig.riskDist, netPct: null }
				if (entryBar.low <= stop) finishTrade(trade, entryBar, stop, 'stop')
				ctx.openBySymbol.set(openKey, trade)
				ctx.allTrades.push(trade)
				appendFileSync(ctx.tradesPath, JSON.stringify(trade) + '\n')
			} else if (!missed && entryBar == null) {
				const trade: TradeRecord = { ...sig, outcome: 'pending-entry', exitUtc: null, exitPrice: null, mfeR: 0, netPct: null }
				ctx.openBySymbol.set(openKey, trade)
				ctx.allTrades.push(trade)
				appendFileSync(ctx.tradesPath, JSON.stringify(trade) + '\n')
			}
		}
	}
	return { newSignals, newMissed, note: `${closed.length} баров` }
}

async function main(): Promise<void> {
	mkdirSync(resolve(STATE_DIR), { recursive: true })
	const signalsPath = resolve(STATE_DIR, 'signals.jsonl')
	const tradesPath = resolve(STATE_DIR, 'trades.jsonl')

	// Ротация legacy-журнала старого правила (−15/−3, записи без поля mode).
	if (existsSync(signalsPath)) {
		const first = readFileSync(signalsPath, 'utf8').split('\n').find(Boolean) ?? ''
		if (first && !JSON.parse(first).mode) {
			renameSync(signalsPath, resolve(STATE_DIR, 'signals.legacy-oi15px3.jsonl'))
			if (existsSync(tradesPath)) renameSync(tradesPath, resolve(STATE_DIR, 'trades.legacy-oi15px3.jsonl'))
			console.log('Legacy-журнал (−15/−3) перенесён в *.legacy-oi15px3.jsonl; журналы режимов начаты с нуля.')
		}
	}

	const universe = loadUniverse()
	console.log(`Мониторинг ${universe.length} символов; режимов ${MODES.length}; прогон ${new Date().toISOString()}`)

	const allSignals = loadJsonl<SignalRecord>(signalsPath)
	const allTrades = loadJsonl<TradeRecord>(tradesPath)
	const openBySymbol = new Map<string, TradeRecord>()
	for (const t of allTrades) if (t.outcome === 'open' || t.outcome === 'pending-entry') openBySymbol.set(keyOf(t.mode, t.symbol), t)
	const lastSignalPerKey = new Map<string, number>()
	for (const s of allSignals) {
		const k = keyOf(s.mode, s.symbol)
		lastSignalPerKey.set(k, Math.max(lastSignalPerKey.get(k) ?? 0, s.signalBarOpenMs))
	}

	const ctx: Ctx = { allSignals, allTrades, openBySymbol, lastSignalPerKey, signalsPath, tradesPath }
	let newSignals = 0
	let newMissed = 0
	const chunks = Math.ceil(universe.length / 4)
	for (let c = 0; c < chunks; c++) {
		await Promise.all(universe.slice(c * 4, c * 4 + 4).map(async (symbol) => {
			try {
				const r = await processSymbol(symbol, ctx)
				newSignals += r.newSignals
				newMissed += r.newMissed
				console.log(`[${c + 1}/${chunks}] ${symbol}: ${r.note}, новых сигналов ${r.newSignals}${r.newMissed ? ` (пропущено ${r.newMissed})` : ''}`)
			} catch (e) {
				console.log(`[${c + 1}/${chunks}] ${symbol}: ошибка ${(e as Error).message}`)
			}
		}))
	}

	writeFileSync(tradesPath, allTrades.map((t) => JSON.stringify(t)).join('\n') + (allTrades.length ? '\n' : ''))
	writeFileSync(resolve(STATE_DIR, 'state.json'), JSON.stringify({ lastRunUtc: new Date().toISOString(), universeCount: universe.length, modes: MODES.map((m) => m.id) }, null, 2))

	const resolved = allTrades.filter((t) => t.outcome === 'stop' || t.outcome === 'reclaim' || t.outcome === 'timeout')
	const winsN = resolved.filter((t) => (t.netPct ?? 0) > 0).length
	const meanNet = resolved.length ? resolved.reduce((s, t) => s + (t.netPct ?? 0), 0) / resolved.length : null
	const reachedR = (thr: number): string => {
		const eligible = allTrades.filter((t) => t.mfeR != null)
		return `${eligible.filter((t) => t.mfeR! >= thr).length}/${eligible.length}`
	}
	const perMode = MODES.map((m) => {
		const sigs = allSignals.filter((s) => s.mode === m.id)
		const tr = allTrades.filter((t) => t.mode === m.id)
		const res = tr.filter((t) => t.outcome === 'stop' || t.outcome === 'reclaim' || t.outcome === 'timeout')
		const wr = res.length ? res.filter((t) => (t.netPct ?? 0) > 0).length / res.length : null
		const mean = res.length ? res.reduce((s, t) => s + (t.netPct ?? 0), 0) / res.length : null
		return `| ${m.id} (OI ${(m.oiDrop * 100).toFixed(0)}% / цена ${(m.priceDrop * 100).toFixed(0)}%) | ${sigs.length} | ${tr.length} | ${res.length} | ${wr != null ? (wr * 100).toFixed(1) + '%' : '—'} | ${mean != null ? (mean * 100).toFixed(3) + '%' : '—'} |`
	})
	const md = [
		'# Doppler paper-forward — статус (режимы SAFE/STANDARD/RISK)',
		'',
		`Прогон: ${new Date().toISOString()}; символов: ${universe.length}; новых сигналов: ${newSignals} (пропущено по времени: ${newMissed}).`,
		`Всего сигналов: ${allSignals.length}; открытых позиций: ${[...openBySymbol.values()].filter((t) => t.outcome === 'open').length}.`,
		`Завершённых сделок: ${resolved.length}; WR ${resolved.length ? (winsN / resolved.length * 100).toFixed(1) : '—'}%; средняя net ${meanNet != null ? (meanNet * 100).toFixed(3) + '%' : '—'}%.`,
		`MFE: ≥1R дошли ${reachedR(1)}; ≥1.5R: ${reachedR(1.5)}; ≥2R: ${reachedR(2)}; ≥3R: ${reachedR(3)}.`,
		'',
		'## По режимам',
		'| режим | сигналов | сделок | завершено | WR | средняя net |',
		'|---|---:|---:|---:|---:|---:|',
		...perMode,
		'',
		'## Последние сигналы',
		'| режим | закрытие бара (UTC) | символ | вход | стоп | цель | упущен |',
		'|---|---|---|---:|---:|---:|---|',
		...allSignals.slice(-12).reverse().map((s) => `| ${s.mode} | ${s.signalBarCloseUtc} | ${s.symbol.replace('USDT', '')} | ${s.entry ?? '—'} | ${s.stop.toPrecision(6)} | ${s.targetRefLevel.toPrecision(6)} | ${s.missed ? 'да' : 'нет'} |`),
		'',
		'_Сигнал: TradingView → актив → 1h → бар времени закрытия; вход = open следующего бара. Режим = порог триггера; стоп/таймаут у всех одинаковые._',
	]
	writeFileSync(resolve(STATE_DIR, 'report.md'), md.join('\n'))
	console.log('\n' + md.slice(2, 6).join('\n'))
}

void main()
