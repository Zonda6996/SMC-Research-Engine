// apexAnchors4.ts — Zonda Apex, четвёртый заход: мера отклонения.
//
// Уже закрыто:
//  v2 — модель логарифмически симметричная: линия = mean*exp(+-k*s), k = 5.6 и 9.6.
//  v3 — средняя = alma(hlc3, 200): семь из восьми замеров в пределах 0.13%.
//  v3 — разброс остатков как мера s отвергнут (в 2-8 раз больше цели).
//
// Здесь: s = smooth(measure), где measure — безразмерная оценка волатильности
// одного бара, smooth — любой из восьми типов сглаживания. Главный кандидат —
// alma с тем же периодом 200, что и средняя.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const CACHE = process.env.CACHE_DIR ?? '.cache/binance'
const OUT = process.env.OUT_DIR ?? 'ci-results'
const K_IN = 5.6
const K_OUT = 9.6

const RULE: string[] = [
	'1. Отбор ведётся по МАКСИМУМУ абсолютной ошибки СРАЗУ ПО ВСЕМ шести замерам s.',
	'   Причина изменения правила против v2/v3: отбор только по 20.07 дважды дал',
	'   кандидата, провалившегося на 28.07. Здесь задача — не прогноз, а подбор',
	'   формулы под шесть точных значений, и перебор слишком тесный, чтобы',
	'   случайно угадать шесть чисел сразу в пределах процента.',
	'2. Колонки 20.07 и 28.07 всё равно разделены в отчёте: если лучший кандидат',
	'   систематически промахивается по одной дате — это видно сразу.',
	'3. Порог приёмки: максимум по всем шести замерам <= 3%.',
	'4. При разнице в пределах 0.5% предпочитается период 200 и тот же тип сглаживания, что у средней.',
	'5. Средняя линия здесь не подбирается, а зафиксирована как alma(hlc3, 200) из v3.',
]

type Cndl = { t: number; o: number; h: number; l: number; c: number }
type Tf = '5m' | '15m' | '1h' | '4h'
type MaKind = 'sma' | 'ema' | 'rma' | 'wma' | 'hma' | 'tma' | 'lsma' | 'alma'

const TFS: Tf[] = ['5m', '15m', '1h', '4h']
const SMOOTHS: MaKind[] = ['alma', 'sma', 'ema', 'rma', 'wma', 'hma', 'tma', 'lsma']

type Lines = { mean: number; inUp?: number; inDn?: number; outUp?: number; outDn?: number }
type Anchor = { id: string; tf: Tf; tMs: number; day: '20.07' | '28.07'; lines: Lines }

const ANCHORS: Anchor[] = [
	{ id: '5m@20.07-12', tf: '5m', tMs: Date.UTC(2026, 6, 20, 12), day: '20.07', lines: { mean: 64250.82, inUp: 64835.88, inDn: 63671.03 } },
	{ id: '15m@20.07-12', tf: '15m', tMs: Date.UTC(2026, 6, 20, 12), day: '20.07', lines: { mean: 64526.7 } },
	{ id: '1h@20.07-12', tf: '1h', tMs: Date.UTC(2026, 6, 20, 12), day: '20.07', lines: { mean: 64281.12 } },
	{ id: '4h@20.07-12', tf: '4h', tMs: Date.UTC(2026, 6, 20, 12), day: '20.07', lines: { mean: 63533.87, inUp: 67351.71, inDn: 59932.45 } },
	{
		id: '5m@28.07-08',
		tf: '5m',
		tMs: Date.UTC(2026, 6, 28, 8),
		day: '28.07',
		lines: { mean: 63385.64, inUp: 63764.37, inDn: 63009.16, outUp: 64036.28, outDn: 62741.61 },
	},
	{
		id: '4h@28.07-08',
		tf: '4h',
		tMs: Date.UTC(2026, 6, 28, 8),
		day: '28.07',
		lines: { mean: 64805.28, inUp: 68107.36, inDn: 61663.29, outUp: 70568.52, outDn: 59512.72 },
	},
	{
		id: '5m@28.07-16',
		tf: '5m',
		tMs: Date.UTC(2026, 6, 28, 16),
		day: '28.07',
		lines: { mean: 63400.23, inUp: 63959.28, inDn: 62846.06, outUp: 64361.62, outDn: 62453.19 },
	},
	{
		id: '4h@28.07-16',
		tf: '4h',
		tMs: Date.UTC(2026, 6, 28, 16),
		day: '28.07',
		lines: { mean: 64818.43, inUp: 68110.28, inDn: 61685.69, outUp: 70563.46, outDn: 59541.15 },
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

function sma(x: number[], i: number, n: number): number {
	let s = 0
	for (let k = 0; k < n; k++) s += x[i - k]!
	return s / n
}

function wma(x: number[], i: number, n: number): number {
	let s = 0
	let w = 0
	for (let k = 0; k < n; k++) {
		const ww = n - k
		s += x[i - k]! * ww
		w += ww
	}
	return s / w
}

function lsma(x: number[], i: number, n: number): number {
	let sy = 0
	let sty = 0
	let stt = 0
	const tbar = (n - 1) / 2
	for (let k = 0; k < n; k++) {
		const t = n - 1 - k
		const v = x[i - k]!
		sy += v
		sty += (t - tbar) * v
		stt += (t - tbar) * (t - tbar)
	}
	const b = stt === 0 ? 0 : sty / stt
	return sy / n + b * tbar
}

function alma(x: number[], i: number, n: number): number {
	const m = 0.85 * (n - 1)
	const s = n / 6
	let num = 0
	let den = 0
	for (let j = 0; j < n; j++) {
		const w = Math.exp(-((j - m) * (j - m)) / (2 * s * s))
		num += w * x[i - (n - 1) + j]!
		den += w
	}
	return num / den
}

function tma(x: number[], i: number, n: number): number {
	const p = Math.ceil(n / 2)
	const q = n - p + 1
	if (i + 1 < p + q - 1) return NaN
	let s = 0
	for (let k = 0; k < q; k++) s += sma(x, i - k, p)
	return s / q
}

function hma(x: number[], i: number, n: number): number {
	const half = Math.max(1, Math.floor(n / 2))
	const m = Math.max(1, Math.floor(Math.sqrt(n)))
	if (i + 1 < n + m) return NaN
	const raw: number[] = []
	for (let k = m - 1; k >= 0; k--) raw.push(2 * wma(x, i - k, half) - wma(x, i - k, n))
	let s = 0
	let w = 0
	for (let k = 0; k < m; k++) {
		const ww = m - k
		s += raw[m - 1 - k]! * ww
		w += ww
	}
	return s / w
}

function recAt(x: number[], i: number, n: number, kind: 'ema' | 'rma'): number {
	const a = kind === 'rma' ? 1 / n : 2 / (n + 1)
	let v = x[0]!
	for (let j = 1; j <= i; j++) v += a * (x[j]! - v)
	return v
}

function maAt(x: number[], i: number, n: number, kind: MaKind): number {
	if (i + 1 < n) return NaN
	switch (kind) {
		case 'sma':
			return sma(x, i, n)
		case 'wma':
			return wma(x, i, n)
		case 'ema':
			return recAt(x, i, n, 'ema')
		case 'rma':
			return recAt(x, i, n, 'rma')
		case 'lsma':
			return lsma(x, i, n)
		case 'alma':
			return alma(x, i, n)
		case 'tma':
			return tma(x, i, n)
		case 'hma':
			return hma(x, i, n)
		default:
			return NaN
	}
}

/**
 * Безразмерные оценки волатильности одного бара. sqrt = true означает,
 * что сначала сглаживается квадрат, потом берётся корень.
 */
type Measure = { label: string; sqrt: boolean; build: (c: Cndl[]) => number[] }

const LN2 = Math.log(2)

const MEASURES: Measure[] = [
	{ label: 'trRel', sqrt: false, build: (c) => c.map((x, i) => (i === 0 ? (x.h - x.l) / x.c : Math.max(x.h - x.l, Math.abs(x.h - c[i - 1]!.c), Math.abs(x.l - c[i - 1]!.c)) / x.c)) },
	{ label: 'hlRel', sqrt: false, build: (c) => c.map((x) => (x.h - x.l) / x.c) },
	{ label: 'lnHL', sqrt: false, build: (c) => c.map((x) => Math.log(x.h / x.l)) },
	{ label: 'absLogRet', sqrt: false, build: (c) => c.map((x, i) => (i === 0 ? 0 : Math.abs(Math.log(x.c / c[i - 1]!.c)))) },
	{ label: 'sqLogRet', sqrt: true, build: (c) => c.map((x, i) => (i === 0 ? 0 : Math.log(x.c / c[i - 1]!.c) ** 2)) },
	{ label: 'parkinson', sqrt: true, build: (c) => c.map((x) => Math.log(x.h / x.l) ** 2 / (4 * LN2)) },
	{ label: 'sqLnHL', sqrt: true, build: (c) => c.map((x) => Math.log(x.h / x.l) ** 2) },
	{
		label: 'garmanKlass',
		sqrt: true,
		build: (c) => c.map((x) => Math.max(0, 0.5 * Math.log(x.h / x.l) ** 2 - (2 * LN2 - 1) * Math.log(x.c / x.o) ** 2)),
	},
	{
		label: 'rogersSatchell',
		sqrt: true,
		build: (c) =>
			c.map((x) =>
				Math.max(0, Math.log(x.h / x.c) * Math.log(x.h / x.o) + Math.log(x.l / x.c) * Math.log(x.l / x.o)),
			),
	},
	{ label: 'absLogOC', sqrt: false, build: (c) => c.map((x) => Math.abs(Math.log(x.c / x.o))) },
	{ label: 'trLogRel', sqrt: false, build: (c) => c.map((x, i) => (i === 0 ? Math.log(x.h / x.l) : Math.log(Math.max(x.h, c[i - 1]!.c) / Math.min(x.l, c[i - 1]!.c)))) },
]

const PERIODS: number[] = []
for (let n = 10; n <= 400; n += 1) PERIODS.push(n)
for (let n = 405; n <= 1200; n += 5) PERIODS.push(n)

const pct = (got: number, want: number): number => ((got - want) / want) * 100
const f3 = (x: number): string => (Number.isFinite(x) ? x.toFixed(3) : 'н/д')
const f6 = (x: number): string => (Number.isFinite(x) ? x.toFixed(6) : 'н/д')

function sigmaFromLines(l: Lines): number {
	const v: number[] = []
	if (l.inUp !== undefined) v.push(Math.log(l.inUp / l.mean) / K_IN)
	if (l.inDn !== undefined) v.push(Math.log(l.mean / l.inDn) / K_IN)
	if (l.outUp !== undefined) v.push(Math.log(l.outUp / l.mean) / K_OUT)
	if (l.outDn !== undefined) v.push(Math.log(l.mean / l.outDn) / K_OUT)
	return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN
}

async function main(): Promise<void> {
	mkdirSync(CACHE, { recursive: true })
	mkdirSync(OUT, { recursive: true })
	const rep: string[] = []
	const push = (s = ''): void => {
		rep.push(s)
	}

	push('# Zonda Apex — калибровка v4: мера отклонения')
	push()
	push(`- прогон ${process.env.GITHUB_RUN_ID ?? 'local'}, ${new Date().toISOString()}`)
	push('- модель: линия = mean*exp(+-k*s), k = 5.6 (внутренние) и 9.6 (внешние)')
	push('- средняя зафиксирована: alma(hlc3, 200)')
	push()
	push('## Правило отбора (зафиксировано в коде до прогона)')
	push()
	for (const r of RULE) push(r)
	push()

	type S = { tf: Tf; candles: Cndl[]; hlc3: number[]; meas: Map<string, number[]> }
	const series = new Map<Tf, S>()
	for (const tf of TFS) {
		const candles = await load(tf)
		const meas = new Map<string, number[]>()
		for (const m of MEASURES) meas.set(m.label, m.build(candles))
		series.set(tf, { tf, candles, hlc3: candles.map((x) => (x.h + x.l + x.c) / 3), meas })
		console.log(`${tf}: ${candles.length} баров`)
	}

	const idx = new Map<string, number>()
	const sigma = new Map<string, number>()
	for (const a of ANCHORS) {
		const i = series.get(a.tf)!.candles.findIndex((c) => c.t === a.tMs)
		if (i >= 0) idx.set(a.id, i)
		const s = sigmaFromLines(a.lines)
		if (Number.isFinite(s)) sigma.set(a.id, s)
	}
	const live = ANCHORS.filter((a) => idx.has(a.id))
	const sigLive = live.filter((a) => sigma.has(a.id))
	const sIds = sigLive.map((a) => a.id)

	push('## 1. Целевые значения s и проверка средней alma 200')
	push()
	push('| замер | дата | индекс | s | s в % цены | ошибка средней % |')
	push('| --- | --- | --- | --- | --- | --- |')
	for (const a of live) {
		const s = sigma.get(a.id)
		const m = maAt(series.get(a.tf)!.hlc3, idx.get(a.id)!, 200, 'alma')
		push(
			`| ${a.id} | ${a.day} | ${idx.get(a.id)} | ${s === undefined ? '—' : f6(s)} | ` +
				`${s === undefined ? '—' : f3(s * 100)} | ${f3(pct(m, a.lines.mean))} |`,
		)
	}
	push()

	type C = {
		measure: string
		smooth: MaKind
		n: number
		allMax: number
		max20: number
		max28: number
		errs: Map<string, number>
	}
	const cands: C[] = []
	for (const m of MEASURES)
		for (const sk of SMOOTHS)
			for (const n of PERIODS) {
				const errs = new Map<string, number>()
				let allMax = 0
				let max20 = 0
				let max28 = 0
				let ok = true
				for (const a of sigLive) {
					const arr = series.get(a.tf)!.meas.get(m.label)!
					const raw = maAt(arr, idx.get(a.id)!, n, sk)
					const v = m.sqrt ? Math.sqrt(Math.max(0, raw)) : raw
					if (!Number.isFinite(v) || v <= 0) {
						ok = false
						break
					}
					const e = pct(v, sigma.get(a.id)!)
					errs.set(a.id, e)
					allMax = Math.max(allMax, Math.abs(e))
					if (a.day === '20.07') max20 = Math.max(max20, Math.abs(e))
					else max28 = Math.max(max28, Math.abs(e))
				}
				if (ok) cands.push({ measure: m.label, smooth: sk, n, allMax, max20, max28, errs })
			}
	cands.sort((x, y) => x.allMax - y.allMax)
	console.log(`кандидатов по s: ${cands.length}`)

	const head = `| # | мера | сглаживание | период | max все % | max 20.07 % | max 28.07 % | ${sIds.join(' | ')} |`
	const sep = `| ${Array.from({ length: 7 + sIds.length }, () => '---').join(' | ')} |`
	const row = (c: C, k: number): string =>
		`| ${k + 1} | ${c.measure} | ${c.smooth} | ${c.n} | ${f3(c.allMax)} | ${f3(c.max20)} | ${f3(c.max28)} | ` +
		`${sIds.map((id) => f3(c.errs.get(id) ?? NaN)).join(' | ')} |`

	push('## 2. Лучшие кандидаты по всем шести замерам')
	push()
	push(head)
	push(sep)
	cands.slice(0, 30).forEach((c, k) => push(row(c, k)))
	push()
	push('## 3. Ровно период 200')
	push()
	push(head)
	push(sep)
	cands
		.filter((c) => c.n === 200)
		.sort((x, y) => x.allMax - y.allMax)
		.slice(0, 25)
		.forEach((c, k) => push(row(c, k)))
	push()
	push('## 4. Лучшее для каждой меры (любое сглаживание и период)')
	push()
	push(head)
	push(sep)
	MEASURES.forEach((m, k) => {
		const b = cands.find((c) => c.measure === m.label)
		if (b) push(row(b, k))
	})
	push()
	push('## 5. Лучшее для каждого типа сглаживания')
	push()
	push(head)
	push(sep)
	SMOOTHS.forEach((sk, k) => {
		const b = cands.find((c) => c.smooth === sk)
		if (b) push(row(b, k))
	})
	push()
	push('## 6. Вердикт')
	push()
	const b = cands[0]
	if (b) {
		push(
			`- лучший ${b.measure} / ${b.smooth} / ${b.n}: max по всем ${f3(b.allMax)}%, порог 3% — ` +
				`${b.allMax <= 3 ? 'ПРИНЯТО' : 'НЕ ПРИНЯТО'}`,
		)
		const at200 = cands.filter((c) => c.n === 200).sort((x, y) => x.allMax - y.allMax)[0]
		if (at200)
			push(
				`- лучший на периоде 200: ${at200.measure} / ${at200.smooth}, max ${f3(at200.allMax)}% — ` +
					`${at200.allMax <= 3 ? 'ПРИНЯТО' : 'НЕ ПРИНЯТО'}`,
			)
	}
	push()

	writeFileSync(`${OUT}/apex-anchors4.md`, rep.join('\n'))
	console.log(`готово: ${OUT}/apex-anchors4.md`)
}

await main()
