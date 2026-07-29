// specSlice.ts — вырезает секции SPEC.md в куски, читаемые агентом.
//
// SPEC.md весит около 218 КБ и целиком в контекст не помещается. Раннер режет
// нужный диапазон секций на части по ~24 000 символов и выкладывает в
// ci-results/, откуда агент читает их по одной. Плюс всегда пишет полное
// оглавление файла — по нему видно, какие секции вообще есть.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const OUT = process.env.OUT_DIR ?? 'ci-results'
const CHUNK = 24_000

export function sliceSpec(fromMark = '16.24', toMark = '16.33'): void {
	mkdirSync(OUT, { recursive: true })
	const text = readFileSync('SPEC.md', 'utf8')
	const lines = text.split('\n')

	const headings: Array<{ i: number; l: string }> = []
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i]!
		if (/^#{1,6}\s/.test(l)) headings.push({ i, l })
	}
	writeFileSync(
		`${OUT}/spec-headings.md`,
		[
			'# SPEC.md — оглавление',
			'',
			`строк: ${lines.length}, символов: ${text.length}, заголовков: ${headings.length}`,
			'',
			...headings.map((h) => `${h.i + 1}\t${h.l}`),
		].join('\n'),
	)

	const headingWith = (mark: string): number => headings.find((h) => h.l.includes(mark))?.i ?? -1
	let from = headingWith(fromMark)
	if (from < 0) from = lines.findIndex((l) => l.includes(fromMark))
	let to = headingWith(toMark)
	if (to < 0) to = lines.length
	if (to <= from) to = lines.length

	if (from < 0) {
		writeFileSync(
			`${OUT}/spec-slice-manifest.md`,
			`# SPEC slice\n\nМетка "${fromMark}" не найдена в SPEC.md. Смотри spec-headings.md.\n`,
		)
		return
	}

	const body = lines.slice(from, to)
	const parts: string[] = []
	let buf: string[] = []
	let size = 0
	for (const l of body) {
		if (size + l.length > CHUNK && buf.length) {
			parts.push(buf.join('\n'))
			buf = []
			size = 0
		}
		buf.push(l)
		size += l.length + 1
	}
	if (buf.length) parts.push(buf.join('\n'))

	const names = parts.map((_, k) => `spec-slice-${String(k + 1).padStart(2, '0')}.md`)
	for (let k = 0; k < parts.length; k++) {
		writeFileSync(
			`${OUT}/${names[k]!}`,
			`<!-- SPEC.md строки ${from + 1}..${to}, часть ${k + 1} из ${parts.length} -->\n${parts[k]!}\n`,
		)
	}

	writeFileSync(
		`${OUT}/spec-slice-manifest.md`,
		[
			'# SPEC slice',
			'',
			`- от метки "${fromMark}" (строка ${from + 1}) до метки "${toMark}" (строка ${to})`,
			`- строк в срезе: ${body.length}`,
			`- частей: ${parts.length}`,
			'',
			...parts.map((p, k) => `- ${names[k]!} — ${p.length} символов`),
		].join('\n'),
	)
}

if (process.argv[1]?.includes('specSlice')) sliceSpec()
