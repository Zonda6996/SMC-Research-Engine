import { readFile, writeFile, unlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const sourcePath = 'ci/research/simplifiedFullTakeReplay.ts'
const generatedPath = 'ci/research/.fullTakeTimeStopE2e.generated.ts'
let source = await readFile(sourcePath, 'utf8')
const variantsStart = source.indexOf('const VARIANTS: Variant[] = [')
const variantsEnd = source.indexOf('\n]\n\ntype Trade', variantsStart)
if (variantsStart < 0 || variantsEnd < 0) throw new Error('variants block not found')
source = source.slice(0, variantsStart)
  + "const VARIANTS: Variant[] = [\n  { id: 'time-80-e2e', family: 'time', timeBars: 80 },\n]"
  + source.slice(variantsEnd + 2)
const detectOld = 'detectSimplifiedConfirmation(pois,l,SIMPLIFIED_APEX_VETO_PRESET,{events:snap.events})'
const detectNew = "detectSimplifiedConfirmation(pois,l,{...SIMPLIFIED_APEX_VETO_PRESET,postPartialTimeStopBars:80},{events:snap.events})"
if (!source.includes(detectOld)) throw new Error('detect anchor not found')
source = source.replace(detectOld, detectNew)
source = source
  .replaceAll("'simplified-full-take.json'", "'simplified-full-take-e2e.json'")
  .replaceAll("'simplified-full-take.md'", "'simplified-full-take-e2e.md'")
  .replace("let md='# Simplified full-take replay", "let md='# Simplified full-take end-to-end time-stop")
await writeFile(generatedPath, source)
try {
  await new Promise<void>((done, reject) => {
    const tsxCli = resolve('node_modules/tsx/dist/cli.mjs')
    const p = spawn(process.execPath, [tsxCli, generatedPath], { stdio: 'inherit' })
    p.on('error', reject)
    p.on('exit', code => code === 0 ? done() : reject(new Error(`e2e replay exited ${code}`)))
  })
} finally {
  await unlink(generatedPath).catch(() => undefined)
}
