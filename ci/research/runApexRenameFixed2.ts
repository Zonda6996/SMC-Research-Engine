import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const path = 'ci/research/applyApexRename.ts'
let source = readFileSync(path, 'utf8')
const old = "const scan = run('git', ['grep', '-in', 'ggi', '--', 'src', 'tools', 'tests'], true).trim()"
const replacement = "let scan = ''\ntry { scan = run('git', ['grep', '-in', 'ggi', '--', 'src', 'tools', 'tests'], true).trim() }\ncatch (error) {\n\tconst status = (error as { status?: number }).status\n\tif (status !== 1) throw error\n}"
if (!source.includes(old)) throw new Error('не найдена строка git grep для исправления')
source = source.replace(old, replacement)
writeFileSync(path, source)
execFileSync('npx', ['tsx', 'ci/research/runApexRenameFixed.ts'], { stdio: 'inherit' })
