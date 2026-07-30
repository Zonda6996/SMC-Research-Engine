import { readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const run = (cmd: string, args: string[]) => new Promise<void>((resolve, reject) => {
  const p = spawn(cmd, args, { stdio: 'inherit' })
  p.on('error', reject)
  p.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`)))
})
const replaceOnce = (s: string, oldStr: string, newStr: string, label: string) => {
  const at = s.indexOf(oldStr)
  if (at < 0) throw new Error(`anchor not found: ${label}`)
  if (s.indexOf(oldStr, at + oldStr.length) >= 0) throw new Error(`anchor not unique: ${label}`)
  return s.slice(0, at) + newStr + s.slice(at + oldStr.length)
}

const enginePath = 'src/core/confirmation/SimplifiedConfirmationEngine.ts'
let engine = await readFile(enginePath, 'utf8')
engine = replaceOnce(engine,
  "export const SIMPLIFIED_CONFIRMATION_VERSION = 'simplified-confirmation-0.6-apex-veto'",
  "export const SIMPLIFIED_CONFIRMATION_VERSION = 'simplified-confirmation-0.7-post-partial-time-stop'",
  'version')
engine = replaceOnce(engine,
  "\t/** v0.3: полный тейк в R (используется при targetMode='r'). */\n\tfullAtR: number\n\t/**\n\t * v0.3: фильтр",
  "\t/** v0.3: полный тейк в R (используется при targetMode='r'). */\n\tfullAtR: number\n\t/** v0.7: закрыть остаток по close после N полных баров с момента partial; 0 = выключено. */\n\tpostPartialTimeStopBars: number\n\t/**\n\t * v0.3: фильтр",
  'config field')
engine = replaceOnce(engine,
  "\tpartialAtR: 0.40,\n\tfullAtR: 12,\n\tmaxChaseAtr: 0,",
  "\tpartialAtR: 0.40,\n\tfullAtR: 12,\n\tpostPartialTimeStopBars: 0,\n\tmaxChaseAtr: 0,",
  'default disabled')
engine = replaceOnce(engine,
  "\t/** Хронология: PARTIAL (частичка + стоп в БУ), BE (выбило в БУ), FULL, STOP. */\n\tevents: Array<{ state: 'PARTIAL' | 'BE' | 'FULL' | 'STOP'; at: number; price: number }>\n\t/** stop — до частички; be — частичка взята, остаток в БУ; full — обе цели; open — край данных. */\n\toutcome: 'stop' | 'be' | 'full' | 'open'",
  "\t/** Хронология: PARTIAL, BE, FULL, TIME (time-stop остатка), STOP. */\n\tevents: Array<{ state: 'PARTIAL' | 'BE' | 'FULL' | 'TIME' | 'STOP'; at: number; price: number }>\n\t/** stop — до частички; be — остаток в БУ; full — обе цели; time — time-stop после partial; open — край данных. */\n\toutcome: 'stop' | 'be' | 'full' | 'time' | 'open'",
  'entry result types')
engine = replaceOnce(engine,
  "\tlet stop = stop0\n\tlet partialTaken = false\n\tconst risk = Math.abs(entry - stop0)\n\tconst done = (outcome: SimplifiedEntry['outcome'], k: number): number => {\n\t\tout.outcome = outcome\n\t\tconst partMove = partialMovePct * cfg.partialFraction\n\t\tconst restShare = 1 - cfg.partialFraction\n\t\tout.grossMovePct = outcome === 'full' ? partMove + fullMovePct * restShare\n\t\t\t: outcome === 'be' ? partMove\n\t\t\t: -(Math.abs(entry - stop0) / entry) // полный стоп всей позицией\n\t\tout.grossR = risk > 0 ? (out.grossMovePct * entry) / risk : null\n\t\treturn k\n\t}",
  "\tlet stop = stop0\n\tlet partialTaken = false\n\tlet partialTakenAtIndex = -1\n\tconst risk = Math.abs(entry - stop0)\n\tconst done = (outcome: SimplifiedEntry['outcome'], k: number, exitPrice?: number): number => {\n\t\tout.outcome = outcome\n\t\tconst partMove = partialMovePct * cfg.partialFraction\n\t\tconst restShare = 1 - cfg.partialFraction\n\t\tconst timeMove = exitPrice == null ? 0 : (long ? exitPrice - entry : entry - exitPrice) / entry\n\t\tout.grossMovePct = outcome === 'full' ? partMove + fullMovePct * restShare\n\t\t\t: outcome === 'be' ? partMove\n\t\t\t: outcome === 'time' ? partMove + timeMove * restShare\n\t\t\t: -(Math.abs(entry - stop0) / entry) // полный стоп всей позицией\n\t\tout.grossR = risk > 0 ? (out.grossMovePct * entry) / risk : null\n\t\treturn k\n\t}",
  'position state and pnl')
engine = replaceOnce(engine,
  "\t\tif (hitPartial) {\n\t\t\tpartialTaken = true\n\t\t\tstop = entry",
  "\t\tif (hitPartial) {\n\t\t\tpartialTaken = true\n\t\t\tpartialTakenAtIndex = k\n\t\t\tstop = entry",
  'partial index')
engine = replaceOnce(engine,
  "\t\tif (hitFull) {\n\t\t\tout.events.push({ state: 'FULL', at: c.timestamp, price: fullPrice })\n\t\t\treturn done('full', k)\n\t\t}\n\t}\n\tout.outcome = 'open'",
  "\t\tif (hitFull) {\n\t\t\tout.events.push({ state: 'FULL', at: c.timestamp, price: fullPrice })\n\t\t\treturn done('full', k)\n\t\t}\n\t\tif (partialTaken && cfg.postPartialTimeStopBars > 0 && partialTakenAtIndex >= 0\n\t\t\t&& k - partialTakenAtIndex >= cfg.postPartialTimeStopBars) {\n\t\t\tout.events.push({ state: 'TIME', at: c.timestamp, price: c.close })\n\t\t\treturn done('time', k, c.close)\n\t\t}\n\t}\n\tout.outcome = 'open'",
  'time exit')
await writeFile(enginePath, engine)

const testPath = 'tests/simplifiedConfirmation.test.ts'
let tests = await readFile(testPath, 'utf8')
tests = replaceOnce(tests,
  "assert.equal(SIMPLIFIED_CONFIRMATION_VERSION, 'simplified-confirmation-0.6-apex-veto')",
  "assert.equal(SIMPLIFIED_CONFIRMATION_VERSION, 'simplified-confirmation-0.7-post-partial-time-stop')",
  'version test')
tests += `

// ─────────────────────────── v0.7 post-partial time-stop ───────────────────────────

it('v0.7: time-stop начинается только после partial и закрывает LONG по close через N полных баров', () => {
  const ltf: Candle[] = [
    ...away(7, 0),
    bar(7, 96, 106, 95, 100),
    bar(8, 100, 104.5, 99, 104.4),
    ...Array.from({ length: 80 }, (_, i) => bar(9 + i, 105, 105.2, 104.8, 105)),
  ]
  const [r] = detectSimplifiedConfirmation([makePoi()], ltf, {
    targetMode: 'r', partialAtR: 0.4, fullAtR: 12, partialFraction: 0.25,
    postPartialTimeStopBars: 80,
  })
  const e = r!.entries[0]!
  assert.equal(e.outcome, 'time')
  assert.deepEqual(e.events.map(x => x.state), ['PARTIAL', 'TIME'])
  assert.equal(e.events[1]!.at, 88)
  const expectedMove = 0.011 + 0.05 * 0.75
  assert.ok(Math.abs(e.grossMovePct! - expectedMove) < 1e-9)
})

it('v0.7: без partial time-stop не срабатывает; SHORT зеркален', () => {
  const noPartial: Candle[] = [
    ...away(7, 0), bar(7, 96, 106, 95, 100),
    ...Array.from({ length: 100 }, (_, i) => bar(8 + i, 102, 104, 101, 102)),
  ]
  const [open] = detectSimplifiedConfirmation([makePoi()], noPartial, {
    targetMode: 'r', partialAtR: 0.4, fullAtR: 12, partialFraction: 0.25,
    postPartialTimeStopBars: 80,
  })
  assert.equal(open!.entries[0]!.outcome, 'open')

  const longBars: Candle[] = [
    ...away(7, 0), bar(7, 96, 106, 95, 100), bar(8, 100, 104.5, 99, 104.4),
    ...Array.from({ length: 80 }, (_, i) => bar(9 + i, 95, 95.2, 94.8, 95)),
  ]
  const mirror = (b: Candle): Candle => ({ timestamp: b.timestamp, open: 200-b.open, high: 200-b.low, low: 200-b.high, close: 200-b.close, volume: b.volume })
  const [short] = detectSimplifiedConfirmation([makePoi({ direction: 'short', near: 100, far: 110 })], longBars.map(mirror), {
    targetMode: 'r', partialAtR: 0.4, fullAtR: 12, partialFraction: 0.25,
    postPartialTimeStopBars: 80,
  })
  assert.equal(short!.entries[0]!.outcome, 'time')
  assert.deepEqual(short!.entries[0]!.events.map(x => x.state), ['PARTIAL', 'TIME'])
})

it('v0.7: на граничном баре сохраняется консервативный порядок stop → full → time', () => {
  const ltf: Candle[] = [
    ...away(7, 0), bar(7, 96, 106, 95, 100), bar(8, 100, 104.5, 99, 104.4),
    ...Array.from({ length: 79 }, (_, i) => bar(9 + i, 105, 105.2, 104.8, 105)),
    bar(88, 105, 112, 100.1, 105),
  ]
  const [r] = detectSimplifiedConfirmation([makePoi()], ltf, {
    targetMode: 'r', partialAtR: 0.4, fullAtR: 1, partialFraction: 0.25,
    postPartialTimeStopBars: 80,
  })
  assert.equal(r!.entries[0]!.outcome, 'full')
  assert.deepEqual(r!.entries[0]!.events.map(x => x.state), ['PARTIAL', 'FULL'])
})

it('v0.7: time-stop выключен в базовом конфиге и существующих пресетах', () => {
  assert.equal(SIMPLIFIED_CONFIRMATION_CONFIG.postPartialTimeStopBars, 0)
  assert.equal(SIMPLIFIED_HIGH_WR_PRESET.postPartialTimeStopBars, undefined)
  assert.equal(SIMPLIFIED_APEX_VETO_PRESET.postPartialTimeStopBars, undefined)
})
`
await writeFile(testPath, tests)

const specPath = 'SPEC.md'
let spec = await readFile(specPath, 'utf8')
spec += `

## 16.42 Post-partial time-stop: exit-only edge подтверждён, включение отложено (30.07.2026)

- Протокол: BTC/ETH/SOL/XRP/BNB/DOGE/ADA/LINK; 1h зоны → 15m simplified; 2021–2024 train, 2025–2026 untouched test; 5305 одинаковых входов и стопов; cost 0.10% цены; same-bar stop раньше цели.
- Baseline 12R зависит от хвоста: train E +0.076R, но ex-top1% −0.016R; test +0.104R, ex-top1% +0.010R; DD 49.410R.
- После исправления семантики таймер считается от бара PARTIAL. Train выбрал 80 полных 15m-баров: train +0.063R, ex-top1% +0.020R; untouched test +0.089R, ex-top1% +0.046R, PF 1.389, DD 13.424R. Диапазон 64–128 остаётся положительным, поэтому результат не является одиночным пиком.
- Движок v0.7 поддерживает postPartialTimeStopBars и outcome/event TIME. 0 выключает механику; существующие дефолты и пресеты не изменены.
- Включение в SIMPLIFIED_APEX_VETO_PRESET отложено: exit-only replay замораживал входы, а более ранний выход при reentry может породить дополнительные входы. Сначала нужен отдельный end-to-end replay с реальным жизненным циклом зоны.
`
await writeFile(specPath, spec)

await run('npx', ['tsx', '--test', 'tests/*.test.ts'])
await run('npx', ['tsc', '--noEmit'])
await run('bash', ['-lc', 'node --check tools/visualizer/public/*.mjs tools/visualizer/public/{lib,panels}/*.mjs'])
await run('git', ['config', 'user.name', 'github-actions[bot]'])
await run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
await run('git', ['add', enginePath, testPath])
await run('git', ['commit', '-m', 'feat(engine): add post-partial time-stop'])
await run('git', ['add', specPath])
await run('git', ['commit', '-m', 'docs: record full-take exit validation'])
await run('git', ['push', 'origin', 'HEAD:apex-reversal-v1'])
