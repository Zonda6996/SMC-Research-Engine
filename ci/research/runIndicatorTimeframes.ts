import { readFileSync, writeFileSync } from 'node:fs'
const path = 'ci/research/fixIndicatorTimeframes.ts'
const source = readFileSync(path, 'utf8')
const fixed = source.replace('candles[i].timestamp)}const times=', 'candles[i]!.timestamp)}const times=')
if (fixed === source) throw new Error('strict-indexing marker missing')
writeFileSync(path, fixed)
await import('./fixIndicatorTimeframes.js')
