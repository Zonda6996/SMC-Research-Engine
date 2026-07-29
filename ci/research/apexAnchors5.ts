// apexAnchors5.ts — Zonda Apex, пятый заход: окно меры отклонения по скорости реакции.
//
// Закрыто ранее:
//  v2 — линия = mean*exp(+-k*s), k = 5.6 и 9.6 (разброс оценок s 0.000-0.002%).
//  v3 — средняя = alma(hlc3, 200).
//  v4 — мера s — отношение истинного диапазона к цене, окно не сошлось.
//
// Здесь главное новое — шесть замеров на 5m почти подряд: они задают не только
// уровень s, но и его траекторию. Окно сглаживания однозначно выражается в том,
// насколько быстро величина меняется от бара к бару.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'

const CACHE = process.env.CACHE_DIR ?? '.cache/binance'
const OUT = process.env.OUT_DIR ?? 'ci-results'
const K_IN = 5.6
const K_OUT = 9.6

const RULE: string[] = [
	'1. Отбор — по максимуму абсолютной ошибки сразу по всем замерам s (три даты).',
	'2. Порог приёмки уровня: максимум <= 3%.',
	'3. Второй, независимый порог — траектория: изменение s между первым и последним',
	'   баром серии 29.07 должно совпасть с целевым в пределах 1 процентного пункта.',
	'   Этот порог отсеивает кандидатов, которые случайно угадали уровень.',
	'4. При разнице в пределах 0.5% предпочитается период 200 и тип alma, как у средней.',
	'5. Средняя не подбирается, а проверяется как alma(hlc3, 200) на новых замерах.',
]

type Cndl = { t: number; o: number; h: number; l: number; c: number; v: number }
type Tf = '5m' | '15m' | '1h' | '4h'
type MaKind = 'sma' | 'ema' | 'rma' | 'wma' | 'hma' | 'tma' | 'lsma' | 'alma'

const TFS: Tf[] = ['5m', '4h']
const SMOOTHS: MaKind[] = ['alma', 'sma', 'ema', 'rma', 'wma', 'hma', 'tma', 'lsma']

type Lines = { mean: number; inUp?: number; inDn?: number; outUp?: number; outDn?: number }
type Anchor = {
	id: string
	tf: Tf
	tMs: number
	day: '20.07' | '28.07' | '29.07'
	lines: Lines
	ohlc?: [number, number, number, number]
}

// Время в UTC. У пользователя график в UTC+5, то есть 11:40 на скрине = 06:40 UTC.
const ANCHORS: Anchor[] = [
	{ id: '5m@20.07-12', tf: '5m', tMs: Date.UTC(2026, 6, 20, 12), day: '20.07', lines: { mean: 64250.82, inUp: 64835.88, inDn: 63671.03 } },
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
	// Серия 29.07, 5m, почти подряд: траектория s.
	{
		id: '5m@29.07-06:40',
		tf: '5m',
		tMs: Date.UTC(2026, 6, 29, 6, 40),
		day: '29.07',
		lines: { mean: 63906.09, inUp: 64394.55, inDn: 63421.32 },
		ohlc: [64428.0, 64463.0, 64427.99, 64462.99],
	},
	{
		id: '5m@29.07-06:50',
		tf: '5m',
		tMs: Date.UTC(2026, 6, 29, 6, 50),
		day: '29.07',
		lines: { mean: 63912.68, inUp: 64398.78, inDn: 63430.26 },
		ohlc: [64409.99, 64453.47, 64409.99, 64421.1],
	},
	{
		id: '5m@29.07-06:55',
		tf: '5m',
		tMs: Date.UTC(2026, 6, 29, 6, 55),
		day: '29.07',
		lines: { mean: 63916.51, inUp: 64401.12, inDn: 63435.55 },
		ohlc: [64421.09, 64435.63, 64413.55, 64435.62],
	},
	{
		id: '5m@29.07-07:00',
		tf: '5m',
		tMs: Date.UTC(2026, 6, 29, 7, 0),
		day: '29.07',
		lines: { mean: 63920.66, inUp: 64403.55, inDn: 63441.39 },
		ohlc: [64435.63, 64444.0, 64402.67, 64425.85],
	},
	{
		id: '5m@29.07-07:05',
		tf: '5m',
		tMs: Date.UTC(2026, 6, 29, 7, 5),
		day: '29.07',
		lines: { mean: 63925.13, inUp: 64406.18, inDn: 63447.67 },
		ohlc: [64425.85, 64483.43, 64425.84, 64459.71],
	},
	{
		id: '5m@29.07-07:10',
		tf: '5m',
		tMs: Date.UTC(2026, 6, 29, 7, 10),
		day: '29.07',
		lines: { mean: 63929.92, inUp: 64409.01, inDn: 63454.39 },
		ohlc: [64459.71, 64494.92, 64456.0, 64466.0],
	},
]

const BASE = 'https://data.binance.vision/data/spot'
const MONTHS: string[] = []
for (const m of [9, 10, 11, 12]) MONTHS.push(`2025-${String(m).padStart(2, '0')}`)
for (const m of [1, 2, 3, 4, 5, 6]) MONTHS.push(`2026-${String(m).padStart(2, '0')}`)
const DAYS = Array.from({ length: 28 }, (_, i) => `2026-07-${String(i + 1).padStart(2, '0')}`)

// Архива за текущие сутки не существует, поэтому пробуем публичные REST-зеркала.
const REST_HOSTS = [
	'https://data-api.binance.vision',
	'https://api.binance.com',
	'https://api1.binance.com',
	'https://api2.binance.com',
	'https://api-gcp.binance.com',
]
const restLog: string[] = []

async function restKlines(tf: Tf, startMs: number): Promise<Cndl[]> {
	for (const host of REST_HOSTS) {
		const url = `${host}/api/v3/klines?symbol=BTCUSDT&interval=${tf}&startTime=${startMs}&limit=1000`
		try {
			const r = await fetch(url)
			if (!r.ok) {
				restLog.push(`| ${host} | ${tf} | ${r.status} | — |`)
				continue
			}
			const raw = (await r.json()) as unknown[]
			const out: Cndl[] = []
			for (const row of raw) {
				const a = row as unknown[]
				out.push({
					t: Number(a[0]),
					o: Number(a[1]),
					h: Number(a[2]),
					l: Number(a[3]),
					c: Number(a[4]),
					v: Number(a[5]),
				})
			}
			restLog.push(`| ${host} | ${tf} | 200 | ${out.length} баров |`)
			return out
		} catch (e) {
			restLog.push(`| ${host} | ${tf} | ошибка сети | ${String(e).slice(0, 60)} |`)
		}
	}
	return []
}

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
		if (p.length < 6) continue
		let t = Number(p[0])
		if (!Number.isFinite(t)) continue
		if (t > 1e14) t = Math.floor(t / 1000)
		const c: Cndl = {
			t,
			o: Number(p[1]),
			h: Number(p[2]),
			l: Number(p[3]),
			c: Number(p[4]),
			v: Number(p[5]),
		}
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
	// Свежие бары через REST: начинаем с 26.07, чтобы перекрыть архив и 29.07.
	all.push(...(await restKlines(tf, Date.UTC(2026, 6, 26))))
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

type Measure = { label: string; sqrt: boolean; build: (c: Cndl[]) => number[] }
const LN2 = Math.log(2)

const MEASURES: Measure[] = [
	{
		label: 'trRel',
		sqrt: false,
		build: (c) =>
			c.map((x, i) =>
				i === 0
					? (x.h - x.l) / x.c
					: Math.max(x.h - x.l, Math.abs(x.h - c[i - 1]!.c), Math.abs(x.l - c[i - 1]!.c)) / x.c,
			),
	},
	{ label: 'hlRel', sqrt: false, build: (c) => c.map((x) => (x.h - x.l) / x.c) },
	{ label: 'lnHL', sqrt: false, build: (c) => c.map((x) => Math.log(x.h / x.l)) },
	{ label: 'absLogRet', sqrt: false, build: (c) => c.map((x, i) => (i === 0 ? 0 : Math.abs(Math.log(x.c / c[i - 1]!.c)))) },
	{ label: 'sqLogRet', sqrt: true, build: (c) => c.map((x, i) => (i === 0 ? 0 : Math.log(x.c / c[i - 1]!.c) ** 2)) },
	{ label: 'parkinson', sqrt: true, build: (c) => c.map((x) => Math.log(x.h / x.l) ** 2 / (4 * LN2)) },
	{
		label: 'garmanKlass',
		sqrt: true,
		build: (c) => c.map((x) => Math.max(0, 0.5 * Math.log(x.h / x.l) ** 2 - (2 * LN2 - 1) * Math.log(x.c / x.o) ** 2)),
	},
	{
		label: 'trLogRel',
		sqrt: false,
		build: (c) =>
			c.map((x, i) =>
				i === 0 ? Math.log(x.h / x.l) : Math.log(Math.max(x.h, c[i - 1]!.c) / Math.min(x.l, c[i - 1]!.c)),
			),
	},
]

const PERIODS: number[] = []
for (let n = 5; n <= 400; n += 1) PERIODS.push(n)
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

	push('# Zonda Apex — калибровка v5: окно меры по скорости реакции')
	push()
	push(`- прогон ${process.env.GITHUB_RUN_ID ?? 'local'}, ${new Date().toISOString()}`)
	push('- модель: линия = mean*exp(+-k*s), k = 5.6 и 9.6; средняя = alma(hlc3, 200)')
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
		console.log(`${tf}: ${candles.length} баров, последний ${new Date(candles[candles.length - 1]!.t).toISOString()}`)
	}

	push('## 0. Доступ к свежим барам через REST')
	push()
	push('| зеркало | таймфрейм | код | результат |')
	push('| --- | --- | --- | --- |')
	for (const l of restLog) push(l)
	push()

	const idx = new Map<string, number>()
	const sigma = new Map<string, number>()
	for (const a of ANCHORS) {
		const i = series.get(a.tf)!.candles.findIndex((c) => c.t === a.tMs)
		if (i >= 0) idx.set(a.id, i)
		const s = sigmaFromLines(a.lines)
		if (Number.isFinite(s)) sigma.set(a.id, s)
	}
	const sigLive = ANCHORS.filter((a) => idx.has(a.id) && sigma.has(a.id))
	const sIds = sigLive.map((a) => a.id)

	push('## 1. Целевые s, сверка свечей и проверка средней alma 200')
	push()
	push('| замер | дата | индекс | s | s в % цены | ошибка средней % | свеча сошлась |')
	push('| --- | --- | --- | --- | --- | --- | --- |')
	for (const a of ANCHORS) {
		const i = idx.get(a.id)
		if (i === undefined) {
			push(`| ${a.id} | ${a.day} | нет бара | — | — | — | — |`)
			continue
		}
		const s = sigma.get(a.id)
		const st = series.get(a.tf)!
		const m = maAt(st.hlc3, i, 200, 'alma')
		let ok = '—'
		if (a.ohlc) {
			const c = st.candles[i]!
			const d = Math.max(
				Math.abs(c.o - a.ohlc[0]),
				Math.abs(c.h - a.ohlc[1]),
				Math.abs(c.l - a.ohlc[2]),
				Math.abs(c.c - a.ohlc[3]),
			)
			ok = d < 0.011 ? 'да' : `нет (${d.toFixed(2)})`
		}
		push(
			`| ${a.id} | ${a.day} | ${i} | ${s === undefined ? '—' : f6(s)} | ${s === undefined ? '—' : f3(s * 100)} | ` +
				`${f3(pct(m, a.lines.mean))} | ${ok} |`,
		)
	}
	push()

	// Целевая траектория: как s меняется вдоль серии 29.07.
	const seq = sigLive.filter((a) => a.day === '29.07')
	const seqTargetTrend =
		seq.length >= 2 ? pct(sigma.get(seq[seq.length - 1]!.id)!, sigma.get(seq[0]!.id)!) : NaN
	push('## 2. Целевая траектория s на серии 29.07')
	push()
	push('| бар | s | изменение от первого % |')
	push('| --- | --- | --- |')
	for (const a of seq) push(`| ${a.id} | ${f6(sigma.get(a.id)!)} | ${f3(pct(sigma.get(a.id)!, sigma.get(seq[0]!.id)!))} |`)
	push()
	push(`Итоговый целевой наклон серии: ${f3(seqTargetTrend)}%`)
	push()

	type C = {
		measure: string
		smooth: MaKind
		n: number
		allMax: number
		maxByDay: Map<string, number>
		trend: number
		errs: Map<string, number>
	}
	const cands: C[] = []
	for (const m of MEASURES)
		for (const sk of SMOOTHS)
			for (const n of PERIODS) {
				const errs = new Map<string, number>()
				const vals = new Map<string, number>()
				const maxByDay = new Map<string, number>()
				let allMax = 0
				let ok = true
				for (const a of sigLive) {
					const arr = series.get(a.tf)!.meas.get(m.label)!
					const raw = maAt(arr, idx.get(a.id)!, n, sk)
					const v = m.sqrt ? Math.sqrt(Math.max(0, raw)) : raw
					if (!Number.isFinite(v) || v <= 0) {
						ok = false
						break
					}
					vals.set(a.id, v)
					const e = pct(v, sigma.get(a.id)!)
					errs.set(a.id, e)
					allMax = Math.max(allMax, Math.abs(e))
					maxByDay.set(a.day, Math.max(maxByDay.get(a.day) ?? 0, Math.abs(e)))
				}
				if (!ok) continue
				const trend =
					seq.length >= 2 ? pct(vals.get(seq[seq.length - 1]!.id)!, vals.get(seq[0]!.id)!) : NaN
				cands.push({ measure: m.label, smooth: sk, n, allMax, maxByDay, trend, errs })
			}
	cands.sort((x, y) => x.allMax - y.allMax)
	console.log(`кандидатов: ${cands.length}`)

	const days = ['20.07', '28.07', '29.07']
	const head =
		`| # | мера | сглаживание | период | max все % | ` +
		`${days.map((d) => `max ${d} %`).join(' | ')} | наклон % | ошибка наклона п.п. | ${sIds.join(' | ')} |`
	const sep = `| ${Array.from({ length: 7 + days.length + sIds.length }, () => '---').join(' | ')} |`
	const row = (c: C, k: number): string =>
		`| ${k + 1} | ${c.measure} | ${c.smooth} | ${c.n} | ${f3(c.allMax)} | ` +
		`${days.map((d) => f3(c.maxByDay.get(d) ?? NaN)).join(' | ')} | ${f3(c.trend)} | ` +
		`${f3(c.trend - seqTargetTrend)} | ${sIds.map((id) => f3(c.errs.get(id) ?? NaN)).join(' | ')} |`

	push('## 3. Лучшие кандидаты по уровню (все замеры)')
	push()
	push(head)
	push(sep)
	cands.slice(0, 25).forEach((c, k) => push(row(c, k)))
	push()
	push('## 4. Лучшие кандидаты по траектории (только те, где уровень <= 10%)')
	push()
	push(head)
	push(sep)
	;[...cands]
		.filter((c) => c.allMax <= 10 && Number.isFinite(c.trend))
		.sort((x, y) => Math.abs(x.trend - seqTargetTrend) - Math.abs(y.trend - seqTargetTrend))
		.slice(0, 25)
		.forEach((c, k) => push(row(c, k)))
	push()
	push('## 5. Ровно период 200')
	push()
	push(head)
	push(sep)
	cands
		.filter((c) => c.n === 200)
		.slice(0, 20)
		.forEach((c, k) => push(row(c, k)))
	push()
	push('## 6. Лучшее для каждой меры')
	push()
	push(head)
	push(sep)
	MEASURES.forEach((m, k) => {
		const b = cands.find((c) => c.measure === m.label)
		if (b) push(row(b, k))
	})
	push()
	push('## 7. Вердикт')
	push()
	const b = cands[0]
	if (b) {
		push(
			`- по уровню лучший ${b.measure} / ${b.smooth} / ${b.n}: max ${f3(b.allMax)}%, порог 3% — ` +
				`${b.allMax <= 3 ? 'ПРИНЯТО' : 'НЕ ПРИНЯТО'}; ошибка наклона ${f3(b.trend - seqTargetTrend)} п.п.`,
		)
		const both = cands.find((c) => c.allMax <= 3 && Math.abs(c.trend - seqTargetTrend) <= 1)
		push(
			both
				? `- ОБА ПОРОГА ВЫПОЛНЕНЫ: ${both.measure} / ${both.smooth} / ${both.n}, уровень ${f3(both.allMax)}%, наклон ${f3(both.trend - seqTargetTrend)} п.п.`
				: '- ни один кандидат не выполнил оба порога одновременно',
		)
	}
	push()

	writeFileSync(`${OUT}/apex-anchors5.md`, rep.join('\n'))
	console.log(`готово: ${OUT}/apex-anchors5.md`)
}

await main()
