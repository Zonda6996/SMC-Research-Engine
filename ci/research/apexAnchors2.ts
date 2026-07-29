// apexAnchors2.ts — калибровка Zonda Apex по структуре из окна настроек вендора.
//
// Из настроек точно известно: источник (МАКС+МИН+ЗАКР)/3 = hlc3, Lookback 200,
// Inner Multiplier 5.6, Outer Amplitude 9.6, и пять линий: Mean + по две границы
// у верхней и нижней зоны. Пять чисел в строке статуса — это они.
//
// Модель: верх = mean*exp(+k*s), низ = mean*exp(-k*s), s безразмерное.
// Четыре границы дают четыре независимые оценки s из одного замера, поэтому
// множитель больше не является догадкой. Раздел 1 печатает эти оценки и их
// разброс — если модель неверна, разброс будет большим.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const CACHE = process.env.CACHE_DIR ?? '.cache/binance'
const OUT = process.env.OUT_DIR ?? 'ci-results'
const K_IN = 5.6
const K_OUT = 9.6

/** Зафиксировано в коде ДО прогона. */
const RULE: string[] = [
	'1. Подбор идёт ТОЛЬКО на якорях 20.07 (fit). Замеры 28.07 (test) в подборе не участвуют.',
	'2. Критерий — минимум МАКСИМАЛЬНОЙ абсолютной ошибки по якорям fit, а не средней.',
	'3. Пороги приёмки: средняя линия max|err| <= 0.2%; отклонение max|err| <= 3% на fit И <= 3% на test.',
	'4. Параметры из окна настроек считаются истиной: hlc3, период 200, множители 5.6 и 9.6.',
	'   Полный перебор периодов делается как проверка, что 200 и есть оптимум, а не совпадение.',
	'5. При разнице в пределах 0.5% предпочитается период 200 и более простая мера.',
	'6. Граница train/test 01.01.2025 здесь не применяется: это обратная разработка формулы. Роль test играют замеры с другой даты.',
]

type Cndl = { t: number; o: number; h: number; l: number; c: number }
type Tf = '5m' | '15m' | '1h' | '4h'
type SrcKind = 'hlc3' | 'close' | 'hl2' | 'ohlc4'
type MeanKind = 'sma' | 'ema' | 'rma' | 'wma'
type SigKind =
	| 'stdevLogRet'
	| 'madLogRet'
	| 'rmsLogRet'
	| 'stdevLogSrc'
	| 'stdevRelSrc'
	| 'atrSmaRel'
	| 'hlSmaRel'
	| 'donchHalfRel'

const TFS: Tf[] = ['5m', '15m', '1h', '4h']

type Lines = { mean: number; inUp?: number; inDn?: number; outUp?: number; outDn?: number }
type Anchor = {
	id: string
	tf: Tf
	tMs: number
	split: 'fit' | 'test'
	lines: Lines
	ohlc: [number, number, number, number]
}

// Значения сняты со строки статуса при наведении на бар, то есть это положение
// линий ИМЕННО на этом баре. Время — открытие бара в UTC; скрины подписаны в
// часовом поясе пользователя UTC+5, поэтому 21:00 местных = 16:00 UTC.
const ANCHORS: Anchor[] = [
	{
		id: '5m@20.07-12',
		tf: '5m',
		tMs: Date.UTC(2026, 6, 20, 12, 0),
		split: 'fit',
		lines: { mean: 64250.82, inUp: 64835.88, inDn: 63671.03 },
		ohlc: [65002.0, 65002.83, 64716.57, 64803.99],
	},
	{
		id: '15m@20.07-12',
		tf: '15m',
		tMs: Date.UTC(2026, 6, 20, 12, 0),
		split: 'fit',
		lines: { mean: 64526.7 },
		ohlc: [65002.0, 65002.83, 64716.57, 64750.0],
	},
	{
		id: '1h@20.07-12',
		tf: '1h',
		tMs: Date.UTC(2026, 6, 20, 12, 0),
		split: 'fit',
		lines: { mean: 64281.12 },
		ohlc: [65002.0, 65002.83, 64599.89, 64640.0],
	},
	{
		id: '4h@20.07-12',
		tf: '4h',
		tMs: Date.UTC(2026, 6, 20, 12, 0),
		split: 'fit',
		lines: { mean: 63533.87, inUp: 67351.71, inDn: 59932.45 },
		ohlc: [65002.0, 65666.8, 64077.76, 65598.75],
	},
	{
		id: '5m@28.07-08',
		tf: '5m',
		tMs: Date.UTC(2026, 6, 28, 8, 0),
		split: 'test',
		lines: { mean: 63385.64, inUp: 63764.37, inDn: 63009.16, outUp: 64036.28, outDn: 62741.61 },
		ohlc: [63506.0, 63530.87, 63468.35, 63525.62],
	},
	{
		id: '4h@28.07-08',
		tf: '4h',
		tMs: Date.UTC(2026, 6, 28, 8, 0),
		split: 'test',
		lines: { mean: 64805.28, inUp: 68107.36, inDn: 61663.29, outUp: 70568.52, outDn: 59512.72 },
		ohlc: [63506.0, 63593.0, 63294.0, 63450.0],
	},
	{
		id: '5m@28.07-16',
		tf: '5m',
		tMs: Date.UTC(2026, 6, 28, 16, 0),
		split: 'test',
		lines: { mean: 63400.23, inUp: 63959.28, inDn: 62846.06, outUp: 64361.62, outDn: 62453.19 },
		ohlc: [63928.46, 63936.0, 63886.0, 63886.01],
	},
	{
		id: '4h@28.07-16',
		tf: '4h',
		tMs: Date.UTC(2026, 6, 28, 16, 0),
		split: 'test',
		lines: { mean: 64818.43, inUp: 68110.28, inDn: 61685.69, outUp: 70563.46, outDn: 59541.15 },
		ohlc: [63928.46, 64100.0, 63504.0, 63904.0],
	},
]

const BASE = 'https://data.binance.vision/data/spot'
const MONTHS: string[] = []
for (const m of [9, 10, 11, 12]) MONTHS.push(`2025-${String(m).padStart(2, '0')}`)
for (const m of [1, 2, 3, 4, 5, 6]) MONTHS.push(`2026-${String(m).padStart(2, '0')}`)
const DAYS = Array.from({ length: 28 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`)

async function cached(url: string): Promise<string | null> {
	const file = `${CACHE}/${url.split('/').pop()!}`
	if (existsSync(file)) return file
	const r = await fetch(url)
	if (!r.ok) {
		console.log(`MISS ${r.status} ${url}`)
		return null
	}
	writeFileSync(file, Buffer.from(await r.arrayBuffer()))
	return file
}

function parseZip(file: string): Cndl[] {
	const csv = execFileSync('unzip', ['-p', file], { maxBuffer: 1 << 28 }).toString()
	const out: Cndl[] = []
	for (const line of csv.split('\n')) {
		if (!line) continue
		const p = line.split(',')
		if (p.length < 5) continue
		let t = Number(p[0])
		if (!Number.isFinite(t)) continue
		if (t > 1e14) t = Math.floor(t / 1000)
		const c: Cndl = { t, o: Number(p[1]), h: Number(p[2]), l: Number(p[3]), c: Number(p[4]) }
		if (Number.isFinite(c.o) && Number.isFinite(c.h) && Number.isFinite(c.l) && Number.isFinite(c.c)) out.push(c)
	}
	return out
}

async function load(tf: Tf): Promise<Cndl[]> {
	const urls = [
		...MONTHS.map((m) => `${BASE}/monthly/klines/BTCUSDT/${tf}/BTCUSDT-${tf}-${m}.zip`),
		...DAYS.map((d) => `${BASE}/daily/klines/BTCUSDT/${tf}/BTCUSDT-${tf}-${d}.zip`),
	]
	const all: Cndl[] = []
	for (const u of urls) {
		const f = await cached(u)
		if (f) all.push(...parseZip(f))
	}
	const seen = new Set<number>()
	const uniq: Cndl[] = []
	for (const c of all) {
		if (seen.has(c.t)) continue
		seen.add(c.t)
		uniq.push(c)
	}
	uniq.sort((a, b) => a.t - b.t)
	return uniq
}

const srcAt = (c: Cndl, k: SrcKind): number =>
	k === 'hlc3'
		? (c.h + c.l + c.c) / 3
		: k === 'close'
			? c.c
			: k === 'hl2'
				? (c.h + c.l) / 2
				: (c.o + c.h + c.l + c.c) / 4

function meanAt(x: number[], i: number, n: number, kind: MeanKind): number {
	if (i + 1 < n) return NaN
	if (kind === 'sma') {
		let s = 0
		for (let k = 0; k < n; k++) s += x[i - k]!
		return s / n
	}
	if (kind === 'wma') {
		let s = 0
		let w = 0
		for (let k = 0; k < n; k++) {
			const ww = n - k
			s += x[i - k]! * ww
			w += ww
		}
		return s / w
	}
	const a = kind === 'rma' ? 1 / n : 2 / (n + 1)
	let v = x[0]!
	for (let j = 1; j <= i; j++) v += a * (x[j]! - v)
	return v
}

function winMean(x: number[], i: number, n: number): number {
	let s = 0
	for (let k = 0; k < n; k++) s += x[i - k]!
	return s / n
}

function winStdev(x: number[], i: number, n: number): number {
	let s = 0
	let q = 0
	for (let k = 0; k < n; k++) {
		const v = x[i - k]!
		s += v
		q += v * v
	}
	const m = s / n
	return Math.sqrt(Math.max(0, q / n - m * m))
}

function winMad(x: number[], i: number, n: number): number {
	const m = winMean(x, i, n)
	let d = 0
	for (let k = 0; k < n; k++) d += Math.abs(x[i - k]! - m)
	return d / n
}

function winRms(x: number[], i: number, n: number): number {
	let q = 0
	for (let k = 0; k < n; k++) q += x[i - k]! * x[i - k]!
	return Math.sqrt(q / n)
}

type Series = {
	tf: Tf
	candles: Cndl[]
	src: Record<SrcKind, number[]>
	logRet: number[]
	logSrc: number[]
	tr: number[]
	hl: number[]
}

/** Безразмерная мера разброса на баре i, окно n. */
function sigAt(s: Series, i: number, n: number, kind: SigKind): number {
	if (i + 1 < n || i < 1) return NaN
	const px = s.src.hlc3[i]!
	switch (kind) {
		case 'stdevLogRet':
			return winStdev(s.logRet, i, n)
		case 'madLogRet':
			return winMad(s.logRet, i, n)
		case 'rmsLogRet':
			return winRms(s.logRet, i, n)
		case 'stdevLogSrc':
			return winStdev(s.logSrc, i, n)
		case 'stdevRelSrc':
			return winStdev(s.src.hlc3, i, n) / winMean(s.src.hlc3, i, n)
		case 'atrSmaRel':
			return winMean(s.tr, i, n) / px
		case 'hlSmaRel':
			return winMean(s.hl, i, n) / px
		case 'donchHalfRel': {
			let hi = -Infinity
			let lo = Infinity
			for (let k = 0; k < n; k++) {
				const c = s.candles[i - k]!
				if (c.h > hi) hi = c.h
				if (c.l < lo) lo = c.l
			}
			return (hi - lo) / 2 / px
		}
		default:
			return NaN
	}
}

const SRCS: SrcKind[] = ['hlc3', 'close', 'hl2', 'ohlc4']
const MEAN_KINDS: MeanKind[] = ['sma', 'ema', 'rma', 'wma']
const SIG_KINDS: SigKind[] = [
	'stdevLogRet',
	'madLogRet',
	'rmsLogRet',
	'stdevLogSrc',
	'stdevRelSrc',
	'atrSmaRel',
	'hlSmaRel',
	'donchHalfRel',
]
const PERIODS: number[] = []
for (let n = 10; n <= 400; n += 1) PERIODS.push(n)
for (let n = 420; n <= 1200; n += 20) PERIODS.push(n)

const pct = (got: number, want: number): number => ((got - want) / want) * 100
const f2 = (x: number): string => (Number.isFinite(x) ? x.toFixed(2) : 'н/д')
const f3 = (x: number): string => (Number.isFinite(x) ? x.toFixed(3) : 'н/д')
const f6 = (x: number): string => (Number.isFinite(x) ? x.toFixed(6) : 'н/д')

function sigmaFromLines(l: Lines): { tags: Map<string, number>; s: number; spreadPct: number } {
	const tags = new Map<string, number>()
	if (l.inUp !== undefined) tags.set('вн.верх', Math.log(l.inUp / l.mean) / K_IN)
	if (l.inDn !== undefined) tags.set('вн.низ', Math.log(l.mean / l.inDn) / K_IN)
	if (l.outUp !== undefined) tags.set('внеш.верх', Math.log(l.outUp / l.mean) / K_OUT)
	if (l.outDn !== undefined) tags.set('внеш.низ', Math.log(l.mean / l.outDn) / K_OUT)
	const vals = [...tags.values()]
	const s = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN
	const spreadPct = vals.length > 1 ? ((Math.max(...vals) - Math.min(...vals)) / s) * 100 : 0
	return { tags, s, spreadPct }
}

function devFromLines(l: Lines): { tags: Map<string, number>; spreadPct: number } {
	const tags = new Map<string, number>()
	if (l.inUp !== undefined) tags.set('вн.верх', (l.inUp - l.mean) / K_IN)
	if (l.inDn !== undefined) tags.set('вн.низ', (l.mean - l.inDn) / K_IN)
	if (l.outUp !== undefined) tags.set('внеш.верх', (l.outUp - l.mean) / K_OUT)
	if (l.outDn !== undefined) tags.set('внеш.низ', (l.mean - l.outDn) / K_OUT)
	const vals = [...tags.values()]
	const m = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN
	const spreadPct = vals.length > 1 ? ((Math.max(...vals) - Math.min(...vals)) / m) * 100 : 0
	return { tags, spreadPct }
}

async function main(): Promise<void> {
	mkdirSync(CACHE, { recursive: true })
	mkdirSync(OUT, { recursive: true })
	const rep: string[] = []
	const push = (s = ''): void => {
		rep.push(s)
	}

	push('# Zonda Apex — калибровка v2 (структура из настроек вендора)')
	push()
	push(`- прогон ${process.env.GITHUB_RUN_ID ?? 'local'}, коммит ${process.env.GITHUB_SHA ?? 'local'}, ${new Date().toISOString()}`)
	push('- из настроек: источник hlc3, Lookback 200, Inner 5.6, Outer 9.6')
	push('- модель: верх = mean*exp(+k*s), низ = mean*exp(-k*s)')
	push()
	push('## Правило отбора (зафиксировано в коде до прогона)')
	push()
	for (const r of RULE) push(r)
	push()

	const TAGS = ['вн.верх', 'вн.низ', 'внеш.верх', 'внеш.низ']
	push('## 1. Проверка модели: независимые оценки из линий одного замера')
	push()
	push('Логарифмическая модель, оценки s:')
	push()
	push(`| замер | split | ${TAGS.join(' | ')} | s итог | разброс % |`)
	push(`| ${Array.from({ length: 7 }, () => '---').join(' | ')} |`)
	const sigma = new Map<string, number>()
	for (const a of ANCHORS) {
		const { tags, s, spreadPct } = sigmaFromLines(a.lines)
		if (tags.size === 0) {
			push(`| ${a.id} | ${a.split} | — | — | — | — | только средняя | — |`)
			continue
		}
		sigma.set(a.id, s)
		const cells = TAGS.map((t) => (tags.has(t) ? f6(tags.get(t)!) : '—'))
		push(`| ${a.id} | ${a.split} | ${cells.join(' | ')} | ${f6(s)} | ${f3(spreadPct)} |`)
	}
	push()
	push('Разностная модель (mean ± k*d), d в цене — для сравнения:')
	push()
	push(`| замер | ${TAGS.join(' | ')} | разброс % |`)
	push(`| ${Array.from({ length: 6 }, () => '---').join(' | ')} |`)
	for (const a of ANCHORS) {
		const { tags, spreadPct } = devFromLines(a.lines)
		if (tags.size === 0) continue
		const cells = TAGS.map((t) => (tags.has(t) ? f2(tags.get(t)!) : '—'))
		push(`| ${a.id} | ${cells.join(' | ')} | ${f3(spreadPct)} |`)
	}
	push()
	push('Какая модель верна — видно по колонке разброса: у верной он близок к нулю.')
	push()

	const series = new Map<Tf, Series>()
	for (const tf of TFS) {
		const candles = await load(tf)
		const src = {
			hlc3: candles.map((x) => srcAt(x, 'hlc3')),
			close: candles.map((x) => srcAt(x, 'close')),
			hl2: candles.map((x) => srcAt(x, 'hl2')),
			ohlc4: candles.map((x) => srcAt(x, 'ohlc4')),
		} satisfies Record<SrcKind, number[]>
		series.set(tf, {
			tf,
			candles,
			src,
			logRet: candles.map((c, i) => (i === 0 ? 0 : Math.log(c.c / candles[i - 1]!.c))),
			logSrc: src.hlc3.map((v) => Math.log(v)),
			tr: candles.map((x, i) =>
				i === 0
					? x.h - x.l
					: Math.max(x.h - x.l, Math.abs(x.h - candles[i - 1]!.c), Math.abs(x.l - candles[i - 1]!.c)),
			),
			hl: candles.map((x) => x.h - x.l),
		})
		console.log(`${tf}: ${candles.length} баров`)
	}

	const idx = new Map<string, number>()
	push('## 2. Сверка баров с архивом (проверка источника данных)')
	push()
	push('| замер | индекс | O | H | L | C | совпало |')
	push('| --- | --- | --- | --- | --- | --- | --- |')
	for (const a of ANCHORS) {
		const s = series.get(a.tf)!
		const i = s.candles.findIndex((c) => c.t === a.tMs)
		if (i < 0) {
			push(`| ${a.id} | БАР НЕ НАЙДЕН | | | | | НЕТ |`)
			continue
		}
		idx.set(a.id, i)
		const c = s.candles[i]!
		const ok =
			Math.abs(c.o - a.ohlc[0]) < 0.011 &&
			Math.abs(c.h - a.ohlc[1]) < 0.011 &&
			Math.abs(c.l - a.ohlc[2]) < 0.011 &&
			Math.abs(c.c - a.ohlc[3]) < 0.011
		push(`| ${a.id} | ${i} | ${f2(c.o)} | ${f2(c.h)} | ${f2(c.l)} | ${f2(c.c)} | ${ok ? 'да' : 'НЕТ'} |`)
	}
	push()

	const ids = ANCHORS.filter((a) => idx.has(a.id)).map((a) => a.id)
	type MC = { src: SrcKind; kind: MeanKind; n: number; fitMax: number; testMax: number; errs: Map<string, number> }
	const mcs: MC[] = []
	for (const sk of SRCS)
		for (const mk of MEAN_KINDS)
			for (const n of PERIODS) {
				const errs = new Map<string, number>()
				let fitMax = 0
				let testMax = 0
				let ok = true
				for (const a of ANCHORS) {
					const i = idx.get(a.id)
					if (i === undefined) continue
					const v = meanAt(series.get(a.tf)!.src[sk], i, n, mk)
					if (!Number.isFinite(v)) {
						ok = false
						break
					}
					const e = pct(v, a.lines.mean)
					errs.set(a.id, e)
					if (a.split === 'fit') fitMax = Math.max(fitMax, Math.abs(e))
					else testMax = Math.max(testMax, Math.abs(e))
				}
				if (ok && errs.size > 0) mcs.push({ src: sk, kind: mk, n, fitMax, testMax, errs })
			}
	mcs.sort((x, y) => x.fitMax - y.fitMax)

	const mHead = `| # | источник | тип | период | fit max % | test max % | ${ids.join(' | ')} |`
	const mSep = `| ${Array.from({ length: 6 + ids.length }, () => '---').join(' | ')} |`
	const mRow = (c: MC, k: number): string =>
		`| ${k + 1} | ${c.src} | ${c.kind} | ${c.n} | ${f3(c.fitMax)} | ${f3(c.testMax)} | ` +
		`${ids.map((id) => f3(c.errs.get(id) ?? NaN)).join(' | ')} |`

	push('## 3. Средняя линия: подбор на fit, проверка на test')
	push()
	push(mHead)
	push(mSep)
	mcs.slice(0, 15).forEach((c, k) => push(mRow(c, k)))
	push()
	push('### 3.1. Ровно настройки вендора: hlc3, период 200')
	push()
	push(mHead)
	push(mSep)
	mcs.filter((c) => c.n === 200 && c.src === 'hlc3').forEach((c, k) => push(mRow(c, k)))
	push()
	push('### 3.2. Лучший период каждого типа на hlc3 — проверка, что 200 это оптимум')
	push()
	push('| тип | лучший период | fit max % | test max % |')
	push('| --- | --- | --- | --- |')
	for (const mk of MEAN_KINDS) {
		const b = mcs.find((c) => c.kind === mk && c.src === 'hlc3')
		if (b) push(`| ${mk} | ${b.n} | ${f3(b.fitMax)} | ${f3(b.testMax)} |`)
	}
	push()

	const sigAnchors = ANCHORS.filter((a) => sigma.has(a.id) && idx.has(a.id))
	const sIds = sigAnchors.map((a) => a.id)
	type SC = { kind: SigKind; n: number; fitMax: number; testMax: number; errs: Map<string, number> }
	const scs: SC[] = []
	for (const sg of SIG_KINDS)
		for (const n of PERIODS) {
			const errs = new Map<string, number>()
			let fitMax = 0
			let testMax = 0
			let ok = true
			for (const a of sigAnchors) {
				const v = sigAt(series.get(a.tf)!, idx.get(a.id)!, n, sg)
				if (!Number.isFinite(v)) {
					ok = false
					break
				}
				const e = pct(v, sigma.get(a.id)!)
				errs.set(a.id, e)
				if (a.split === 'fit') fitMax = Math.max(fitMax, Math.abs(e))
				else testMax = Math.max(testMax, Math.abs(e))
			}
			if (ok && errs.size > 0) scs.push({ kind: sg, n, fitMax, testMax, errs })
		}
	scs.sort((x, y) => x.fitMax - y.fitMax)

	const sHead = `| # | мера | период | fit max % | test max % | ${sIds.join(' | ')} |`
	const sSep = `| ${Array.from({ length: 5 + sIds.length }, () => '---').join(' | ')} |`
	const sRow = (c: SC, k: number): string =>
		`| ${k + 1} | ${c.kind} | ${c.n} | ${f3(c.fitMax)} | ${f3(c.testMax)} | ` +
		`${sIds.map((id) => f3(c.errs.get(id) ?? NaN)).join(' | ')} |`

	push('## 4. Отклонение s: подбор на fit, проверка на test')
	push()
	push('Целевые s — из раздела 1, то есть выведены из самих линий. Все меры безразмерные.')
	push()
	push('| замер | целевое s | s в процентах цены |')
	push('| --- | --- | --- |')
	for (const a of sigAnchors) push(`| ${a.id} | ${f6(sigma.get(a.id)!)} | ${f3(sigma.get(a.id)! * 100)} |`)
	push()
	push(sHead)
	push(sSep)
	scs.slice(0, 20).forEach((c, k) => push(sRow(c, k)))
	push()
	push('### 4.1. Ровно период 200 из настроек')
	push()
	push(sHead)
	push(sSep)
	scs.filter((c) => c.n === 200).forEach((c, k) => push(sRow(c, k)))
	push()
	push('### 4.2. Лучший период каждой меры — проверка, что 200 это оптимум')
	push()
	push('| мера | лучший период | fit max % | test max % |')
	push('| --- | --- | --- | --- |')
	for (const sg of SIG_KINDS) {
		const b = scs.find((c) => c.kind === sg)
		if (b) push(`| ${sg} | ${b.n} | ${f3(b.fitMax)} | ${f3(b.testMax)} |`)
	}
	push()
	push('## 5. Вердикт по правилу отбора')
	push()
	const bestMean = mcs.find((c) => c.src === 'hlc3' && c.n === 200)
	const bestMeanAny = mcs[0]
	const bestSig200 = scs.filter((c) => c.n === 200)[0]
	const bestSigAny = scs[0]
	const verdict = (label: string, fit: number, test: number, lim: number): string =>
		`- ${label}: fit ${f3(fit)}%, test ${f3(test)}%, порог ${lim}% — ${fit <= lim && test <= lim ? 'ПРИНЯТО' : 'НЕ ПРИНЯТО'}`
	if (bestMean) push(verdict(`средняя hlc3/${bestMean.kind}/200`, bestMean.fitMax, bestMean.testMax, 0.2))
	if (bestMeanAny)
		push(verdict(`средняя лучшая ${bestMeanAny.src}/${bestMeanAny.kind}/${bestMeanAny.n}`, bestMeanAny.fitMax, bestMeanAny.testMax, 0.2))
	if (bestSig200) push(verdict(`отклонение ${bestSig200.kind}/200`, bestSig200.fitMax, bestSig200.testMax, 3))
	if (bestSigAny)
		push(verdict(`отклонение лучшее ${bestSigAny.kind}/${bestSigAny.n}`, bestSigAny.fitMax, bestSigAny.testMax, 3))
	push()

	writeFileSync(`${OUT}/apex-anchors2.md`, rep.join('\n'))
	writeFileSync(
		`${OUT}/apex-anchors2.json`,
		JSON.stringify(
			{
				sigma: [...sigma.entries()],
				meanTop: mcs.slice(0, 30).map((c) => ({ ...c, errs: [...c.errs.entries()] })),
				sigTop: scs.slice(0, 30).map((c) => ({ ...c, errs: [...c.errs.entries()] })),
			},
			null,
			1,
		),
	)
	console.log(`готово: ${OUT}/apex-anchors2.md`)
}

await main()
