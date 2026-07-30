import { readFile, writeFile, unlink } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const sourcePath = 'ci/research/simplifiedFullTakeReplay.ts'
const generatedPath = 'ci/research/.fullTakeTimeSweep.generated.ts'
const variantsNeedle = "  { id: 'time-96', family: 'time', timeBars: 96 },\n  { id: 'time-192', family: 'time', timeBars: 192 },\n  { id: 'time-384', family: 'time', timeBars: 384 },"
const variantsReplacement = [64, 80, 96, 112, 128, 160]
  .map((timeBars) => `  { id: 'time-${timeBars}', family: 'time', timeBars: ${timeBars} },`)
  .join('\n')

let source = await readFile(sourcePath, 'utf8')
if (!source.includes(variantsNeedle)) throw new Error('time variant anchor not found')
source = source.replace(variantsNeedle, variantsReplacement)
source = source.replace(
  'let stop=stop0, partial=false, secondTaken=false, realised=0, remaining=1, peak=entry,',
  'let stop=stop0, partial=false, partialAtK=-1, secondTaken=false, realised=0, remaining=1, peak=entry,',
)
source = source.replace(
  'remaining=0.75;partial=true;stop=entry;peak=',
  'remaining=0.75;partial=true;partialAtK=k;stop=entry;peak=',
)
source = source.replace(
  'v.timeBars!=null && k-from+1>=v.timeBars',
  'v.timeBars!=null && partialAtK>=0 && k-partialAtK>=v.timeBars',
)
if (!source.includes('partialAtK=k') || !source.includes('k-partialAtK>=v.timeBars')) throw new Error('post-partial timer patch failed')
await writeFile(generatedPath, source)

try {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('npx', ['tsx', generatedPath], { stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`time sweep exited ${code}`)))
  })
} finally {
  await unlink(generatedPath).catch(() => undefined)
}
