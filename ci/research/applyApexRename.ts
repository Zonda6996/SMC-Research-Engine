// Одноразовая проверяемая миграция потребителей Ggi* -> Zonda Apex / Zonda Reversal.
// Выполняется CI на рабочей ветке; при несовпадении ожидаемого кода или падении гейта
// ничего не коммитит и не пушит.
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8')
const write = (p: string, s: string): void => writeFileSync(join(ROOT, p), s)
const run = (cmd: string, args: string[], capture = false): string => {
	console.log(`$ ${cmd} ${args.join(' ')}`)
	return execFileSync(cmd, args, { cwd: ROOT, stdio: capture ? 'pipe' : 'inherit', encoding: 'utf8' }) ?? ''
}
function mustReplace(s: string, from: string | RegExp, to: string, label: string): string {
	if (typeof from === 'string') {
		if (!s.includes(from)) throw new Error(`не найдено для замены: ${label}`)
		return s.split(from).join(to)
	}
	if (!from.test(s)) throw new Error(`не найден regex для замены: ${label}`)
	return s.replace(from, to)
}
function replaceTokens(s: string): string {
	const pairs: Array<[string, string]> = [
		['GgiZoneEngine.js', 'ApexEngine.js'],
		['computeGgiBands', 'computeApexBands'],
		['detectGgiSignals', 'detectReversals'],
		['GGI_ZONE_ENGINE_VERSION', 'APEX_VERSION'],
		['GGI_ZONE_PARAMS', 'APEX_PARAMS'],
		['GgiZoneParams', 'ApexParams'],
		['GgiBand', 'ApexBand'],
		['GgiSignal', 'ReversalSignal'],
		['ggiStateAt', 'apexStateAt'],
		['ggiExcludeBars', 'apexVetoBars'],
		['ggiParams', 'apexParams'],
		['ggiRecent', 'apexRecent'],
		['ggiAt', 'reversalAt'],
		['ggiBands', 'apexBands'],
		['ggiSignals', 'reversalSignals'],
		['SIMPLIFIED_HIGH_WR_PRESET_V4', 'SIMPLIFIED_APEX_VETO_PRESET'],
		['SIMPLIFIED_VENDOR_SIGNAL_PRESET', 'SIMPLIFIED_REVERSAL_VETO_PRESET'],
		['simplified-confirmation-0.5-zone-visit-veto', 'simplified-confirmation-0.6-apex-veto'],
	]
	for (const [a, b] of pairs) s = s.split(a).join(b)
	return s
}

// ---------- 1. ENGINE + TESTS ----------
const simplifiedPath = 'src/core/confirmation/SimplifiedConfirmationEngine.ts'
let simplified = replaceTokens(read(simplifiedPath))
simplified = simplified
	.replace(/GGI-фильтр/g, 'Apex-вето')
	.replace(/GGI/g, 'Apex')
	.replace(/ggi/g, 'apex')
write(simplifiedPath, simplified)

for (const p of ['tests/simplifiedConfirmation.test.ts']) {
	let s = replaceTokens(read(p)).replace(/GGI/g, 'Apex').replace(/ggi/g, 'apex')
	write(p, s)
}

// Старый тест движка уже переписан под Apex — меняется только имя файла.
if (existsSync(join(ROOT, 'tests/ggiZoneEngine.test.ts'))) renameSync(join(ROOT, 'tests/ggiZoneEngine.test.ts'), join(ROOT, 'tests/apexEngine.test.ts'))
// Временный мост больше не нужен после перевода всех потребителей.
rmSync(join(ROOT, 'src/core/signals/GgiZoneEngine.ts'), { force: true })
rmSync(join(ROOT, 'tests/apexCompatibility.test.ts'), { force: true })
// Структурно опровергнутая ранняя аппроксимация и её отдельный тест удаляются.
rmSync(join(ROOT, 'tools/shared/ggiZone.ts'), { force: true })
rmSync(join(ROOT, 'tests/ggiZone.test.ts'), { force: true })

// Сохраняем 325 тестов: удалённые легаси-проверки заменяются полезными тестами новых правил.
const extraTest = `import assert from 'node:assert/strict'\nimport { it } from 'node:test'\nimport type { Candle } from '../src/models/price/Candle.js'\nimport { computeApexBands, detectReversals } from '../src/core/signals/ApexEngine.js'\nconst bar=(t:number,o:number,h:number,l:number,c:number):Candle=>({timestamp:t,open:o,high:h,low:l,close:c,volume:1})\nit('Apex: внешний край дальше внутреннего на любой положительной ширине',()=>{const c=Array.from({length:50},(_,i)=>bar(i,100,102,98,100));const b=computeApexBands(c,{lookback:10,devLookback:10}).at(-1)!;assert.ok(b.redHi>b.redLo&&b.greenLo<b.greenHi)})\nit('Reversal: без касания края направленная свеча не создаёт сигнал',()=>{const c=Array.from({length:50},(_,i)=>bar(i,99,101,98,100));assert.equal(detectReversals(c,{lookback:10,devLookback:10}).length,0)})\n`
write('tests/apexRules.test.ts', extraTest)

// ---------- 2. SERVER PAYLOAD ----------
const serverPath = 'tools/visualizer/server.ts'
let server = replaceTokens(read(serverPath))
server = mustReplace(
	server,
	"import { computeApexBands, detectReversals, APEX_VERSION, APEX_PARAMS } from '../../src/core/signals/ApexEngine.js'",
	"import { computeApexBands, detectReversals, APEX_VERSION, APEX_PARAMS, REVERSAL_VERSION } from '../../src/core/signals/ApexEngine.js'",
	'REVERSAL_VERSION import',
)
const oldPayload = /\t\t\t\tggi: \{[\s\S]*?\n\t\t\t\t\},\n\t\t\t\tsimplifiedConfirmation:/
server = mustReplace(server, oldPayload, `\t\t\t\tapex: {
\t\t\t\t\tversion: APEX_VERSION,
\t\t\t\t\tparams: APEX_PARAMS,
\t\t\t\t\tbands: apexBands.map((b, i) => (Number.isFinite(b.mean)
\t\t\t\t\t\t? { t: ltfConf[i]!.timestamp, mean: b.mean, redLo: b.redLo, redHi: b.redHi, greenHi: b.greenHi, greenLo: b.greenLo }
\t\t\t\t\t\t: null)),
\t\t\t\t},
\t\t\t\treversal: { version: REVERSAL_VERSION, signals: reversalSignals },
\t\t\t\tsimplifiedConfirmation:`, 'split apex/reversal payload')
server = server.replace(/GGI/g, 'Apex').replace(/ggi/g, 'apex')
write(serverPath, server)

// ---------- 3. PANEL: TWO INDEPENDENT LAYERS ----------
const panelPath = 'tools/visualizer/public/panels/confirmation.mjs'
let panel = read(panelPath)
panel = panel.replace(/drawGgi/g, 'drawApexReversal').replace(/ggiChk/g, 'apexChk').replace(/GGI/g, 'Apex').replace(/ggi/g, 'apex')
panel = mustReplace(panel, "\tif (!$('apexChk')?.checked) return\n\tconst g = S.data?.apex\n\tif (!g?.bands?.length) return", "\tconst showApex = Boolean($('apexChk')?.checked)\n\tconst showReversal = Boolean($('reversalChk')?.checked)\n\tif (!showApex && !showReversal) return\n\tconst g = S.data?.apex\n\tif (!g?.bands?.length) return", 'independent layer flags')
panel = mustReplace(panel, "\tline(mean, { color: '#6f8cff', lineWidth: 2 })\n\tline(pick('redLo'), { color: '#e2607a', lineWidth: 1, lineStyle: lineStyle().Dotted })\n\tline(pick('greenHi'), { color: '#3fb98a', lineWidth: 1, lineStyle: lineStyle().Dotted })\n\tconst sig = (g.signals || []).filter((x) => inRange(time(x.at)))", "\tif (showApex) {\n\t\tline(mean, { color: '#6f8cff', lineWidth: 2 })\n\t\tline(pick('redLo'), { color: '#e2607a', lineWidth: 1, lineStyle: lineStyle().Dotted })\n\t\tline(pick('redHi'), { color: '#e2607a', lineWidth: 1 })\n\t\tline(pick('greenHi'), { color: '#3fb98a', lineWidth: 1, lineStyle: lineStyle().Dotted })\n\t\tline(pick('greenLo'), { color: '#3fb98a', lineWidth: 1 })\n\t}\n\tconst sig = showReversal ? (S.data?.reversal?.signals || []).filter((x) => inRange(time(x.at))) : []", 'split lines and signals')
panel = panel.replace(/text: x\.direction === 'long' \? 'Apex BUY' : 'Apex SELL'/g, "text: x.direction === 'long' ? 'BUY' : 'SELL'")
panel = mustReplace(panel, "\t$('apexChk').onchange = () => renderConfirmation()", "\t$('apexChk').onchange = () => renderConfirmation()\n\t$('reversalChk').onchange = () => renderConfirmation()", 'wire reversal checkbox')
panel = panel.replace(/Полосы Apex/g, 'Zonda Apex').replace(/метки BUY\/SELL/g, 'Zonda Reversal: BUY/SELL')
write(panelPath, panel)

// ---------- 4. HTML: REPLACE ONE LEGACY CHECKBOX WITH TWO ----------
const htmlPath = 'tools/visualizer/public/index.html'
let html = read(htmlPath)
const labelRe = /<label class="check" id="ggiChkWrap"[\s\S]*?<\/label>/
html = mustReplace(html, labelRe,
	`<label class="check" id="apexChkWrap" title="Полосы перекупленности/перепроданности: ALMA(hlc3, 200), внутренние и внешние края"><input type="checkbox" id="apexChk" checked /> Zonda Apex</label>
\t\t\t\t\t\t\t<label class="check" id="reversalChkWrap" title="Отдельный слой сигналов: BUY только на бычьей свече, SELL только на медвежьей"><input type="checkbox" id="reversalChk" checked /> Zonda Reversal</label>`,
	'two layer checkboxes')
html = html.replace(/GGI/g, 'Apex').replace(/ggi/g, 'apex')
write(htmlPath, html)

// ---------- 5. SOURCE HYGIENE ----------
const scan = run('git', ['grep', '-in', 'ggi', '--', 'src', 'tools', 'tests'], true).trim()
if (scan) throw new Error(`старое имя осталось в исполняемом коде:\n${scan}`)

// ---------- 6. SPEC / CONTEXT ----------
const specPath = join(ROOT, 'SPEC.md')
const marker = '## 16.33 Zonda Apex и Zonda Reversal'
if (!readFileSync(specPath, 'utf8').includes(marker)) appendFileSync(specPath, `

## 16.33 Zonda Apex и Zonda Reversal — разделение движков и калиброванные полосы (29.07.2026)

Приватное имя удалено из исполняемого кода и интерфейса. Полосы называются **Zonda Apex**, сигналы — **Zonda Reversal**; это два независимо включаемых слоя и два отдельных блока payload.

### Apex \\`apex-1.0-calibrated-log-alma\\`

По 14 точным историческим якорям Binance Spot BTC 5m/15m/4h и ETH 1h установлено: \\`mean = ALMA(hlc3, 200, 0.85, 6)\\`; границы логарифмические: \\`mean × exp(±k×s)\\`, где \\`k=5.6/9.6\\`. Средняя переносится на внешние BTC 15m / ETH 1h с ошибкой 0.024% / 0.269%. Закрытая мера ширины восстановлена устойчивой аппроксимацией \\`s = ALMA(TR/close, 122, 0.625, 3.5)\\`; максимальная наблюдаемая cross-symbol ошибка ширины около 4%, поэтому это не объявляется точной формулой вендора.

### Reversal \\`reversal-1.0-directional-candle\\`

Reversal больше не равен касанию полосы. Край Apex взводит ожидание, после чего BUY разрешён только на бычьей свече (close>open), SELL — только на медвежьей (close<open). После сигнала сторона перевзводится возвратом к средней. Это минимальная модель по наблюдениям пользователя; дополнительные фильтры не вводились без данных. Результаты §16.29–16.30 подлежат повторной проверке, потому что прежняя реализация ставила метку непосредственно по касанию края.

### Совместимость

Временный \\`GgiZoneEngine.ts\\` удалён после перевода потребителей. \\`SimplifiedConfirmationEngine\\` получил поля \\`apexVetoBars/apexParams\\`, версию \\`simplified-confirmation-0.6-apex-veto\\` и пресеты \\`SIMPLIFIED_APEX_VETO_PRESET\\` / \\`SIMPLIFIED_REVERSAL_VETO_PRESET\\`. Дефолт вето остаётся выключенным; дефолты POI, heatmap и подтверждений не менялись.
`)

// ---------- 7. FULL GATE BEFORE ANY SOURCE COMMIT ----------
run('npx', ['tsx', '--test', 'tests/*.test.ts'])
run('npx', ['tsc', '--noEmit'])
run('bash', ['-lc', "node --check tools/visualizer/public/*.mjs tools/visualizer/public/{lib,panels}/*.mjs"])

// ---------- 8. THREE SEPARATE COMMITS ----------
run('git', ['config', 'user.name', 'github-actions[bot]'])
run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
run('git', ['add', 'src/core/signals/ApexEngine.ts', 'src/core/signals/GgiZoneEngine.ts', simplifiedPath, 'tests', 'tools/shared/ggiZone.ts'])
run('git', ['commit', '-m', 'engine: migrate consumers to Apex and Reversal'])
run('git', ['add', serverPath, panelPath, htmlPath])
run('git', ['commit', '-m', 'visualizer: split Zonda Apex and Reversal layers'])
run('git', ['add', 'SPEC.md'])
run('git', ['commit', '-m', 'docs: specify calibrated Apex and directional Reversal'])
run('git', ['push', 'origin', 'HEAD:apex-reversal-v1'])

mkdirSyncSafe(join(ROOT, 'ci-results'))
writeFileSync(join(ROOT, 'ci-results/apex-rename.md'), `# Apex/Reversal migration\n\n- gate: PASS\n- commits: engine, visualizer, docs\n- old executable-code mentions: 0\n`)
console.log('APEX_RENAME_DONE')

function mkdirSyncSafe(p: string): void {
	if (!existsSync(p)) run('mkdir', ['-p', p])
}
