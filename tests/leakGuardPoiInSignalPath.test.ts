import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Guard утечки #2 (docs/NEGATIVE-KNOWLEDGE.md): pool.notional считается за ВСЮ жизнь пула,
// поэтому POI-зоны (LiquidityPoiCalibration) и heatmap (LiquidityHeatmapEngine) несут
// look-ahead в отборе/тайминге рождения зон. Активная линия Zonda Reversal + Apex
// (src/core/signals/*) НЕ должна их импортировать — иначе будущий объём незаметно
// заразит бэктест/сигнал. Ядро POI при этом не трогаем (правка отложена, вариант A).
// Тест ПАДАЕТ, если кто-то заведёт POI/heatmap в сигнальный путь.
// Ловим только РАНТАЙМ-зависимость (value-импорт модуля или вызов детектора).
// `import type { LiquidityPoiCandidate }` разрешён: тип не тащит подсчёт notional,
// а research-линия может принимать готовые зоны как вход извне.
const FORBIDDEN_MODULES = ['LiquidityPoiCalibration', 'LiquidityHeatmapEngine']
const FORBIDDEN_CALLS = ['detectLiquidityPoi', 'detectLiquidityHeatmap']

const here = dirname(fileURLToPath(import.meta.url))
const signalsDir = join(here, '..', 'src', 'core', 'signals')

const runtimeLeaks = (src: string): string[] => {
	const hits = new Set<string>()
	for (const raw of src.split(/\r?\n/)) {
		const line = raw.trim()
		if (line.startsWith('//') || line.startsWith('*')) continue
		for (const mod of FORBIDDEN_MODULES) {
			// value-импорт (НЕ `import type`) или динамический import модуля-носителя утечки
			const valueImport = new RegExp(`^import\\s+(?!type\\b)[^\\n]*from\\s+['\"][^'\"]*${mod}`)
			const dynImport = new RegExp(`import\\(\\s*['\"][^'\"]*${mod}`)
			if (valueImport.test(line) || dynImport.test(line)) hits.add(`value import ${mod}`)
		}
	}
	for (const call of FORBIDDEN_CALLS) {
		if (new RegExp(`\\b${call}\\s*\\(`).test(src)) hits.add(`call ${call}()`)
	}
	return [...hits]
}

test('активный сигнальный путь (src/core/signals) не импортирует POI/heatmap (утечка #2)', () => {
	const files = readdirSync(signalsDir).filter((f) => f.endsWith('.ts'))
	assert.ok(files.length > 0, 'ожидались .ts-файлы в src/core/signals')
	const offenders: string[] = []
	for (const f of files) {
		const src = readFileSync(join(signalsDir, f), 'utf8')
		for (const hit of runtimeLeaks(src)) offenders.push(`${f} -> ${hit}`)
	}
	assert.deepEqual(
		offenders,
		[],
		`POI/heatmap (look-ahead #2) просочился в сигнальный путь:\n${offenders.join('\n')}\n` +
			`Если это осознанно — сначала закрой утечку #2 (notional-as-of-t) и обнови этот guard.`,
	)
})
