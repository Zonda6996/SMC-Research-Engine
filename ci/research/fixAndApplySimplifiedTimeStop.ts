import { readFile, writeFile } from 'node:fs/promises'

const path = 'ci/research/applySimplifiedTimeStop.ts'
let source = await readFile(path, 'utf8')
const oldStr = "...Array.from({ length: 80 }, (_, i) => bar(9 + i, 95, 95.2, 94.8, 95)),"
const newStr = "...Array.from({ length: 80 }, (_, i) => bar(9 + i, 105, 105.2, 104.8, 105)),"
if (!source.includes(oldStr)) throw new Error('short mirror fixture anchor not found')
source = source.replace(oldStr, newStr)
await writeFile(path, source)
await import('./applySimplifiedTimeStop.js')
