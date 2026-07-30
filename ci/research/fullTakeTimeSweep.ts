import { readFile, writeFile, unlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const sourcePath = 'ci/research/simplifiedFullTakeReplay.ts'
const generatedPath = 'ci/research/.fullTakeTimeSweep.generated.ts'
const needle = "  { id: 'time-96', family: 'time', timeBars: 96 },\n  { id: 'time-192', family: 'time', timeBars: 192 },\n  { id: 'time-384', family: 'time', timeBars: 384 },"
const replacement = [64, 80, 96, 112, 128, 160]
  .map((timeBars) => `  { id: 'time-${timeBars}', family: 'time', timeBars: ${timeBars} },`)
  .join('\n')

const source = await readFile(sourcePath, 'utf8')
if (!source.includes(needle)) throw new Error('time variant anchor not found')
await writeFile(generatedPath, source.replace(needle, replacement))

try {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npx', ['tsx', generatedPath], { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`time sweep exited ${code}`)))
  })
} finally {
  await unlink(generatedPath).catch(() => undefined)
}
