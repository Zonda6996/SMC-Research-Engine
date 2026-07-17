// analyzeTelegramSignals.ts
// Независимая проверка Telegram export: парсит сигналы и, опционально,
// разрешает TP/SL по Binance USDT-M 5m. Не доверяет опубликованным итогам.
//
// npm run review-telegram -- /path/to/messages.html
// npm run review-telegram -- /path/to/messages.html --parse-only

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchCandlesPaginated, TF_MS } from '../shared/candleFetcher.js'
import type { Candle } from '../../src/models/price/Candle.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = join(__dirname, '../batch/cache/telegram-review')
const RESULTS_DIR = join(__dirname, '../batch/results')

interface Signal {
	id: string; at: number; side: 'long' | 'short'; symbol: string
	entry: number; stop: number; take: number; confidence: number | null
	htfZone: string; ltfTrigger: string; confirmation: string; liquidity: string
	stopPct: number; plannedRR: number
	outcome: 'tp' | 'stop' | 'unresolved' | 'data-error'
	grossR: number | null; exitAt: number | null; holdBars5m: number | null
}

function decode(s: string): string {
	return s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')
		.replaceAll('&gt;', '>').replaceAll('&lt;', '<').replaceAll('&amp;', '&')
		.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&nbsp;', ' ')
		.replace(/\s+/g, ' ').trim()
}
function parseDate(raw: string): number | null {
	const m = raw.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+UTC([+-]\d{2}):?(\d{2})/)
	if (!m) return null
	const [, dd, mm, yyyy, hh, mi, ss, oh, om] = m
	const offsetMinutes = Number(oh) * 60 + Math.sign(Number(oh)) * Number(om)
	return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi) - offsetMinutes, Number(ss))
}
function field(text: string, label: string, next: string[]): string {
	const escaped = next.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
	const re = new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + `:\\s*(.*?)(?=\\s*(?:${escaped})\\s*:|$)`, 'i')
	return text.match(re)?.[1]?.trim() ?? ''
}
function num(text: string): number | null { const m = text.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/i); return m ? Number(m[0]) : null }

export function parseTelegramExport(html: string): Signal[] {
	const chunks = html.split(/(?=<div class="message (?:default|service))/)
	const rows: Signal[] = []
	const labels = ['Актив', 'HTF контекст', 'HTF зона', 'LTF триггер', 'Подтверждение', 'Снятие ликвидности', 'Вход', 'Стоп-лосс', 'Тейк-профит', 'AI Уверенность']
	for (const chunk of chunks) {
		if (!chunk.includes('СИГНАЛ') || !chunk.includes('message default')) continue
		const textHtml = chunk.match(/<div class="text">([\s\S]*?)<\/div>/)?.[1]
		const dateRaw = chunk.match(/class="pull_right date details" title="([^"]+)"/)?.[1]
		const id = chunk.match(/id="(message[^"]+)"/)?.[1] ?? `row-${rows.length}`
		if (!textHtml || !dateRaw) continue
		const text = decode(textHtml), at = parseDate(dateRaw)
		if (at == null) continue
		const values = Object.fromEntries(labels.map((label, i) => [label, field(text, label, labels.slice(i + 1).length ? labels.slice(i + 1) : ['___END___'])])) as Record<string, string>
		const entry = num(values['Вход'] ?? ''), stop = num(values['Стоп-лосс'] ?? ''), take = num(values['Тейк-профит'] ?? '')
		const symbol = (values['Актив'] ?? '').match(/[A-Z0-9]+USDT/)?.[0]
		if (!symbol || entry == null || stop == null || take == null || entry <= 0 || entry === stop) continue
		const side = text.includes('BUY СИГНАЛ') ? 'long' : 'short'
		rows.push({
			id, at, side, symbol: symbol.replace('USDT', '/USDT'), entry, stop, take,
			confidence: num(values['AI Уверенность'] ?? ''), htfZone: values['HTF зона'] ?? '',
			ltfTrigger: values['LTF триггер'] ?? '', confirmation: values['Подтверждение'] ?? '', liquidity: values['Снятие ликвидности'] ?? '',
			stopPct: 100 * Math.abs(entry - stop) / entry,
			plannedRR: Math.abs(take - entry) / Math.abs(entry - stop),
			outcome: 'unresolved', grossR: null, exitAt: null, holdBars5m: null,
		})
	}
	return rows
}

async function candlesFor(symbol: string, rows: Signal[]): Promise<Candle[]> {
	mkdirSync(CACHE_DIR, { recursive: true })
	const key = `${symbol.replace('/', '-')}_5m.json`, path = join(CACHE_DIR, key)
	if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as Candle[]
	const start = Math.min(...rows.map((x) => x.at)), end = Date.now()
	const limit = Math.min(20_000, Math.ceil((end - start) / TF_MS['5m']!) + 50)
	const candles = await fetchCandlesPaginated(symbol, '5m', limit, 'futures', end)
	writeFileSync(path, JSON.stringify(candles)); return candles
}
function resolveSignal(row: Signal, candles: Candle[]): void {
	const start = candles.findIndex((c) => c.timestamp >= row.at)
	if (start < 0) return
	for (let i = start; i < candles.length; i++) {
		const c = candles[i]!, hitStop = row.side === 'long' ? c.low <= row.stop : c.high >= row.stop
		const hitTp = row.side === 'long' ? c.high >= row.take : c.low <= row.take
		if (hitStop) { row.outcome = 'stop'; row.grossR = -1; row.exitAt = c.timestamp; row.holdBars5m = i - start; return }
		if (hitTp) { row.outcome = 'tp'; row.grossR = row.plannedRR; row.exitAt = c.timestamp; row.holdBars5m = i - start; return }
	}
}
function csv(rows: Signal[]): string { const keys = Object.keys(rows[0] ?? {}); return [keys.join(','), ...rows.map((r) => keys.map((k) => JSON.stringify((r as unknown as Record<string, unknown>)[k] ?? '')).join(','))].join('\n') }
function summary(rows: Signal[], parseOnly: boolean): string {
	const resolved = rows.filter((x) => x.grossR != null), total = resolved.reduce((s, x) => s + x.grossR!, 0)
	const counts = (key: keyof Signal) => [...new Map(rows.map((x) => [String(x[key]), 0])).keys()].map((v) => [v, rows.filter((x) => String(x[key]) === v).length] as const).sort((a, b) => b[1] - a[1])
	const conf = rows.map((x) => x.confidence).filter((x): x is number => x != null).sort((a, b) => a - b)
	const stops = rows.map((x) => x.stopPct).sort((a, b) => a - b)
	return [
		'=== TELEGRAM SIGNAL AUDIT ===',
		`signals: ${rows.length}; range: ${rows.length ? new Date(rows[0]!.at).toISOString() : '-'} → ${rows.length ? new Date(rows.at(-1)!.at).toISOString() : '-'}`,
		`side: long ${rows.filter((x) => x.side === 'long').length}, short ${rows.filter((x) => x.side === 'short').length}`,
		`confidence median ${conf[Math.floor(conf.length / 2)] ?? '-'}; >=85: ${conf.filter((x) => x >= 85).length}`,
		`stopPct median ${(stops[Math.floor(stops.length / 2)] ?? 0).toFixed(2)}%; >3.5%: ${stops.filter((x) => x > 3.5).length}; >5%: ${stops.filter((x) => x > 5).length}`,
		`planned RR avg ${(rows.reduce((s, x) => s + x.plannedRR, 0) / Math.max(1, rows.length)).toFixed(3)}`,
		parseOnly ? 'market resolution: parse-only' : `resolved: ${resolved.length}; TP ${resolved.filter((x) => x.outcome === 'tp').length}; SL ${resolved.filter((x) => x.outcome === 'stop').length}; unresolved ${rows.length - resolved.length}; gross totalR ${total.toFixed(1)}; avgR ${(total / Math.max(1, resolved.length)).toFixed(3)}`,
		'', 'Top assets:', ...counts('symbol').slice(0, 15).map(([x, n]) => `${x}: ${n}`),
		'', 'LTF triggers:', ...counts('ltfTrigger').map(([x, n]) => `${x || 'none'}: ${n}`),
	].join('\n')
}

async function main(): Promise<void> {
	const args = process.argv.slice(2), input = args.find((x) => !x.startsWith('--'))
	if (!input) throw new Error('Usage: npm run review-telegram -- /path/to/messages.html [--parse-only]')
	const rows = parseTelegramExport(readFileSync(input, 'utf8')), parseOnly = args.includes('--parse-only')
	if (!parseOnly) {
		const groups = new Map<string, Signal[]>()
		for (const row of rows) groups.set(row.symbol, [...(groups.get(row.symbol) ?? []), row])
		for (const [symbol, group] of groups) {
			try { const candles = await candlesFor(symbol, group); for (const row of group) resolveSignal(row, candles); console.log(`${symbol}: ${group.length} signals, ${candles.length} candles`) }
			catch (error) { console.error(`${symbol}:`, (error as Error).message); for (const row of group) row.outcome = 'data-error' }
		}
	}
	mkdirSync(RESULTS_DIR, { recursive: true }); const stamp = new Date().toISOString().replaceAll(':', '-'), base = join(RESULTS_DIR, `telegram-audit-${stamp}`)
	writeFileSync(`${base}.csv`, csv(rows)); const text = summary(rows, parseOnly); writeFileSync(`${base}.txt`, text + '\n'); console.log(`\n${text}\n\nCSV: ${base}.csv\nTXT: ${base}.txt`)
}
main().catch((e) => { console.error('Fatal:', e instanceof Error ? e.message : e); process.exit(1) })
