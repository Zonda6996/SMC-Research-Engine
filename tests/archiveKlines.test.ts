import assert from 'node:assert/strict'
import { it } from 'node:test'
import { deflateRawSync } from 'node:zlib'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	archiveSymbol, fetchArchiveKlines, internalGapDays, mergeCandleSeries, parseKlinesCsv, planPeriods, unzipCsv,
} from '../tools/shared/archiveKlines.js'

/** Минимальный валидный ZIP c одной записью (stored или deflate) — как пишут архиваторы. */
function makeZip(name: string, data: Buffer, method: 0 | 8): Buffer {
	const payload = method === 8 ? deflateRawSync(data) : data
	const nameBuf = Buffer.from(name, 'utf8')
	const local = Buffer.alloc(30)
	local.writeUInt32LE(0x04034b50, 0)
	local.writeUInt16LE(20, 4) // version
	local.writeUInt16LE(0, 6) // flags
	local.writeUInt16LE(method, 8)
	local.writeUInt32LE(0, 10) // time/date
	local.writeUInt32LE(0, 14) // crc (парсер не проверяет)
	local.writeUInt32LE(payload.length, 18)
	local.writeUInt32LE(data.length, 22)
	local.writeUInt16LE(nameBuf.length, 26)
	local.writeUInt16LE(0, 28)
	const localFull = Buffer.concat([local, nameBuf, payload])
	const central = Buffer.alloc(46)
	central.writeUInt32LE(0x02014b50, 0)
	central.writeUInt16LE(20, 4)
	central.writeUInt16LE(20, 6)
	central.writeUInt16LE(0, 8)
	central.writeUInt16LE(method, 10)
	central.writeUInt32LE(0, 12)
	central.writeUInt32LE(0, 16)
	central.writeUInt32LE(payload.length, 20)
	central.writeUInt32LE(data.length, 24)
	central.writeUInt16LE(nameBuf.length, 28)
	central.writeUInt16LE(0, 30) // extra
	central.writeUInt16LE(0, 32) // comment
	central.writeUInt16LE(0, 34) // disk
	central.writeUInt16LE(0, 36) // int attrs
	central.writeUInt32LE(0, 38) // ext attrs
	central.writeUInt32LE(0, 42) // local offset
	const centralFull = Buffer.concat([central, nameBuf])
	const eocd = Buffer.alloc(22)
	eocd.writeUInt32LE(0x06054b50, 0)
	eocd.writeUInt16LE(1, 8) // entries on disk
	eocd.writeUInt16LE(1, 10) // entries total
	eocd.writeUInt32LE(centralFull.length, 12)
	eocd.writeUInt32LE(localFull.length, 16) // central dir offset
	return Buffer.concat([localFull, centralFull, eocd])
}

const CSV_MS = 'open_time,open,high,low,close,volume,close_time,q,n,tb,tq,i\n' +
	'1717200000000,100,101,99,100.5,12,1717200899999,0,0,0,0,0\n' +
	'1717200900000,100.5,102,100,101,15,1717201799999,0,0,0,0,0\n'
const CSV_MICRO = '1735689600000000,50,51,49,50.5,7,0,0,0,0,0,0\n' // микросекунды (2025+)

it('archive: unzipCsv распаковывает stored и deflate записи', () => {
	const data = Buffer.from(CSV_MS, 'utf8')
	assert.equal(unzipCsv(makeZip('a.csv', data, 0)), CSV_MS)
	assert.equal(unzipCsv(makeZip('a.csv', data, 8)), CSV_MS)
	assert.throws(() => unzipCsv(Buffer.from('не zip вообще')), /EOCD/)
})

it('archive: parseKlinesCsv — заголовок пропускается, микросекунды нормализуются в мс', () => {
	const ms = parseKlinesCsv(CSV_MS)
	assert.equal(ms.length, 2)
	assert.deepEqual(ms[0], { timestamp: 1717200000000, open: 100, high: 101, low: 99, close: 100.5, volume: 12 })
	const micro = parseKlinesCsv(CSV_MICRO)
	assert.equal(micro[0]!.timestamp, 1735689600000) // 2025-01-01 в мс
})

it('archive: mergeCandleSeries — приоритет свежего хвоста на перекрытии, сортировка', () => {
	const archive = [{ timestamp: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }, { timestamp: 2, open: 2, high: 2, low: 2, close: 2, volume: 2 }]
	const tail = [{ timestamp: 2, open: 9, high: 9, low: 9, close: 9, volume: 9 }, { timestamp: 3, open: 3, high: 3, low: 3, close: 3, volume: 3 }]
	const merged = mergeCandleSeries(archive, tail)
	assert.deepEqual(merged.map((c) => c.timestamp), [1, 2, 3])
	assert.equal(merged[1]!.close, 9) // API-хвост победил архив
})

it('archive: planPeriods — целые месяцы + дни хвостового месяца до последнего ПОЛНОГО дня', () => {
	const { months, days } = planPeriods(Date.UTC(2026, 4, 10), Date.UTC(2026, 6, 25, 11)) // 10.05 → 25.07 11:00
	assert.deepEqual(months, ['2026-05', '2026-06'])
	assert.equal(days[0], '2026-07-01')
	assert.equal(days.at(-1), '2026-07-24') // 25-е ещё не закончилось
	// окно внутри одного месяца — только дни
	const w = planPeriods(Date.UTC(2026, 6, 3), Date.UTC(2026, 6, 5))
	assert.deepEqual(w.months, [])
	assert.deepEqual(w.days, ['2026-07-03', '2026-07-04'])
})

it('archive: internalGapDays находит только UTC-дни внутренних разрывов', () => {
	const tfMs = 900_000
	const candles = [
		{ timestamp: Date.UTC(2022, 1, 25, 23, 45), open: 1, high: 1, low: 1, close: 1, volume: 1 },
		{ timestamp: Date.UTC(2022, 2, 1), open: 1, high: 1, low: 1, close: 1, volume: 1 },
	]
	assert.deepEqual(internalGapDays(candles, tfMs), ['2022-02-26', '2022-02-27', '2022-02-28'])
})

it('archive: fetchArchiveKlines — символ нормализуется, 404 пропускается, дисковый кэш работает', async () => {
	assert.equal(archiveSymbol('BTC/USDT:USDT'), 'BTCUSDT')
	const cacheDir = mkdtempSync(join(tmpdir(), 'arch-'))
	const calls: string[] = []
	// два месяца: май отдаём зипом, июнь — 404 (короткая история символа)
	const may = 'open_time,o\n' + [0, 1, 2].map((k) => `${Date.UTC(2026, 4, 20) + k * 900000},1,2,0.5,1.5,3,0,0,0,0,0,0`).join('\n')
	const fetchImpl = (async (url: string | URL | Request) => {
		const u = String(url)
		calls.push(u)
		if (u.includes('ETHUSDT-15m-2026-05')) return new Response(new Uint8Array(makeZip('x.csv', Buffer.from(may), 8)))
		return new Response('нет файла', { status: 404 })
	}) as typeof fetch
	const out = await fetchArchiveKlines('ETH/USDT', '15m', 'futures', Date.UTC(2026, 4, 1), Date.UTC(2026, 6, 1), { fetchImpl, cacheDir })
	assert.equal(out.length, 3)
	assert.ok(calls.some((u) => u.includes('futures/um/monthly/klines/ETHUSDT/15m/ETHUSDT-15m-2026-05.zip')))
	// июнь: monthly 404 → добор дневными (тоже 404) — молча пусто, без ошибок
	assert.ok(calls.some((u) => u.includes('daily/klines/ETHUSDT/15m/ETHUSDT-15m-2026-06-01.zip')))
	// повторный вызов: май из дискового кэша (сеть не трогается), июньские 404 — из памяти процесса
	const callsBefore = calls.length
	const again = await fetchArchiveKlines('ETH/USDT', '15m', 'futures', Date.UTC(2026, 4, 1), Date.UTC(2026, 6, 1), { fetchImpl, cacheDir })
	assert.equal(again.length, 3)
	assert.equal(calls.length, callsBefore)
	assert.ok(readdirSync(cacheDir).some((f) => f.includes('2026-05')))
})

it('archive: транзиентный 5xx ретраится, стойкий — пропускается без падения (fail-soft периода)', async () => {
	const cacheDir = mkdtempSync(join(tmpdir(), 'arch-'))
	const csv = `${Date.UTC(2026, 4, 2)},1,2,0.5,1.5,3,0,0,0,0,0,0\n`
	let mayHits = 0
	const fetchImpl = (async (url: string | URL | Request) => {
		const u = String(url)
		if (u.includes('-2026-05.zip')) {
			mayHits++
			if (mayHits < 3) return new Response('bad gateway', { status: 502 }) // 2 фейла → 3-я попытка ок
			return new Response(new Uint8Array(makeZip('x.csv', Buffer.from(csv), 8)))
		}
		if (u.includes('-2026-06.zip')) return new Response('bad gateway', { status: 502 }) // стойкий 5xx
		return new Response('нет', { status: 404 })
	}) as typeof fetch
	const out = await fetchArchiveKlines('ETH/USDT', '1d', 'futures', Date.UTC(2026, 4, 1), Date.UTC(2026, 6, 1), { fetchImpl, cacheDir })
	assert.equal(out.length, 1) // май дотянулся через ретраи; июнь пропущен (5xx после ретраев + дневные 404)
	assert.equal(mayHits, 3)
})
