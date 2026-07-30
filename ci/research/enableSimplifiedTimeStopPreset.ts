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
  "export const SIMPLIFIED_CONFIRMATION_VERSION = 'simplified-confirmation-0.7-post-partial-time-stop'",
  "export const SIMPLIFIED_CONFIRMATION_VERSION = 'simplified-confirmation-0.8-time-stop-preset'",
  'version')
engine = replaceOnce(engine,
  "\t...SIMPLIFIED_HIGH_WR_PRESET,\n\tapexVetoBars: 200,\n\t// 'inner' закреплён явно",
  "\t...SIMPLIFIED_HIGH_WR_PRESET,\n\tapexVetoBars: 200,\n\t// 80 × 15m = 20h после PARTIAL; train-selected, затем подтверждён exit-only и end-to-end OOS.\n\tpostPartialTimeStopBars: 80,\n\t// 'inner' закреплён явно",
  'apex preset')
await writeFile(enginePath, engine)

const testPath = 'tests/simplifiedConfirmation.test.ts'
let tests = await readFile(testPath, 'utf8')
tests = replaceOnce(tests,
  "assert.equal(SIMPLIFIED_CONFIRMATION_VERSION, 'simplified-confirmation-0.7-post-partial-time-stop')",
  "assert.equal(SIMPLIFIED_CONFIRMATION_VERSION, 'simplified-confirmation-0.8-time-stop-preset')",
  'version test')
tests = replaceOnce(tests,
  "it('v0.7: time-stop выключен в базовом конфиге и существующих пресетах', () => {\n  assert.equal(SIMPLIFIED_CONFIRMATION_CONFIG.postPartialTimeStopBars, 0)\n  assert.equal(SIMPLIFIED_HIGH_WR_PRESET.postPartialTimeStopBars, undefined)\n  assert.equal(SIMPLIFIED_APEX_VETO_PRESET.postPartialTimeStopBars, undefined)\n})",
  "it('v0.8: базовый конфиг совместим, Apex-пресет включает проверенный time-stop', () => {\n  assert.equal(SIMPLIFIED_CONFIRMATION_CONFIG.postPartialTimeStopBars, 0)\n  assert.equal(SIMPLIFIED_HIGH_WR_PRESET.postPartialTimeStopBars, undefined)\n  assert.equal(SIMPLIFIED_APEX_VETO_PRESET.postPartialTimeStopBars, 80)\n})",
  'preset test')
await writeFile(testPath, tests)

const specPath = 'SPEC.md'
let spec = await readFile(specPath, 'utf8')
spec += `

## 16.43 Post-partial time-stop включён в Apex-пресет после end-to-end проверки (30.07.2026)

- End-to-end replay включил postPartialTimeStopBars=80 непосредственно в SimplifiedConfirmationEngine, поэтому раннее освобождение позиции могло создавать дополнительные re-entry. Число сделок изменилось с 3856/1449 до 3887/1463 (train/test).
- Результат с реальным lifecycle: train E +0.049R, ex-top1% +0.013R; untouched test E +0.082R, ex-top1% +0.041R, PF 1.358, DD 14.748R.
- Против baseline 12R raw test mean и PF ниже (+0.104R, PF 1.457), но tail-robust test mean выше (+0.041R против +0.010R), а DD ниже в 3.35 раза (14.748R против 49.410R). Train ex-top1% меняет знак с −0.016R на +0.013R.
- SIMPLIFIED_APEX_VETO_PRESET включает 80 баров. Для канонической связки 1h→15m это 20 часов после PARTIAL. SIMPLIFIED_CONFIRMATION_CONFIG остаётся с 0, а SIMPLIFIED_HIGH_WR_PRESET не изменён.
- Версия: simplified-confirmation-0.8-time-stop-preset.
`
await writeFile(specPath, spec)

await run('npx', ['tsx', '--test', 'tests/*.test.ts'])
await run('npx', ['tsc', '--noEmit'])
await run('bash', ['-lc', 'node --check tools/visualizer/public/*.mjs tools/visualizer/public/{lib,panels}/*.mjs'])
await run('git', ['config', 'user.name', 'github-actions[bot]'])
await run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
await run('git', ['add', enginePath, testPath])
await run('git', ['commit', '-m', 'feat(engine): enable validated time-stop preset'])
await run('git', ['add', specPath])
await run('git', ['commit', '-m', 'docs: record time-stop end-to-end gate'])
await run('git', ['push', 'origin', 'HEAD:apex-reversal-v1'])
