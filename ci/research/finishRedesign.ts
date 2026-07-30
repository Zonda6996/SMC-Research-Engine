import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'

const OUT = process.env.OUT_DIR ?? 'ci-results'
await mkdir(OUT + '/shots', { recursive: true })

// 1) UI тайм-стопа в упрощённом подтверждении: статус TIME, исход time, метка на графике.
const cp = 'tools/visualizer/public/panels/confirmation.mjs'
let c = await readFile(cp, 'utf8')
function rep(oldStr: string, newStr: string, label: string) {
  const at = c.indexOf(oldStr)
  if (at < 0) throw new Error('anchor missing: ' + label)
  if (c.indexOf(oldStr, at + oldStr.length) >= 0) throw new Error('anchor not unique: ' + label)
  c = c.slice(0, at) + newStr + c.slice(at + oldStr.length)
}
rep(
  "const RU = { PARTIAL: 'частичка взята, стоп в безубыток', BE: 'выбило в безубыток', FULL: 'полный тейк', STOP: 'стоп' }",
  "const RU = { PARTIAL: 'частичка взята, стоп в безубыток', BE: 'выбило в безубыток', FULL: 'полный тейк', TIME: 'тайм-стоп: остаток закрыт по времени (20ч после частички)', STOP: 'стоп' }",
  'RU dict',
)
rep(
  "color: x.state === 'FULL' ? C.green : x.state === 'STOP' ? C.red : C.amber,",
  "color: x.state === 'FULL' ? C.green : x.state === 'STOP' ? C.red : x.state === 'TIME' ? C.purple : C.amber,",
  'marker color',
)
rep(
  "const OUT = { full: 'ФУЛЛ', be: 'БЕЗУБЫТОК после частички', stop: 'СТОП', open: 'ОТКРЫТА (край данных)' }",
  "const OUT = { full: 'ФУЛЛ', be: 'БЕЗУБЫТОК после частички', stop: 'СТОП', time: 'ТАЙМ-СТОП (20ч после частички)', open: 'ОТКРЫТА (край данных)' }",
  'OUT dict',
)
await writeFile(cp, c)

// 2) Полный гейт.
execFileSync('bash', ['-lc', 'npx tsx --test tests/*.test.ts && npx tsc --noEmit && node --check tools/visualizer/public/*.mjs tools/visualizer/public/{lib,panels}/*.mjs'], { stdio: 'inherit' })

// 3) Скриншоты визуализатора (Chromium).
execFileSync('npm', ['install', '--no-save', '--no-audit', '--no-fund', 'playwright'], { stdio: 'inherit' })
const { chromium } = await import('playwright')
const sleep = (n: number) => new Promise((r) => setTimeout(r, n))
const errors: string[] = []
let server: ChildProcess | null = null
let browser: any = null
let report = '# Redesign + time-stop QA\n\n'
async function waitServer(log: () => string) {
  for (let i = 0; i < 60; i++) { try { if ((await fetch('http://127.0.0.1:7788')).ok) return } catch {} await sleep(500) }
  throw new Error('server timeout\n' + log())
}
try {
  let slog = ''
  server = spawn('npx', ['tsx', 'tools/visualizer/server.ts'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  server.stdout?.on('data', (x) => (slog += x))
  server.stderr?.on('data', (x) => (slog += x))
  await waitServer(() => slog)
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.on('response', (r: any) => { if (r.status() >= 400 && !r.url().includes('/api/symbols')) errors.push('http ' + r.status() + ': ' + r.url()) })
  page.on('console', (m: any) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push('console: ' + m.text()) })
  page.on('pageerror', (e: any) => errors.push('page: ' + e.message))
  await page.goto('http://127.0.0.1:7788', { waitUntil: 'domcontentloaded' })
  await page.selectOption('#source', 'fixture')
  await page.click('#loadBtn')
  await page.waitForFunction(() => document.querySelector('#loading')?.classList.contains('hidden'), null, { timeout: 45000 })
  await page.click('#confToggle')
  await page.selectOption('#confEngine', 'simplified')
  await sleep(600)
  const info = await page.evaluate(async () => {
    const m = await import('/panels/confirmation.mjs')
    const xs = m.simplifiedEntries()
    const byOutcome: Record<string, number> = {}
    for (const e of xs) byOutcome[e.outcome] = (byOutcome[e.outcome] || 0) + 1
    return { count: xs.length, byOutcome }
  })
  await page.screenshot({ path: OUT + '/shots/simplified-1600.png', fullPage: true })
  let landedTime = false
  let statusText = ''
  for (let i = 0; i < Math.min(info.count, 500); i++) {
    statusText = (await page.textContent('#confStatusText')) || ''
    if (statusText.includes('ТАЙМ-СТОП')) { landedTime = true; break }
    await page.click('#confNext')
    await sleep(25)
  }
  if (landedTime) await page.screenshot({ path: OUT + '/shots/simplified-time.png', fullPage: true })
  await page.setViewportSize({ width: 1180, height: 900 })
  await sleep(300)
  await page.screenshot({ path: OUT + '/shots/simplified-1180.png', fullPage: true })
  await page.setViewportSize({ width: 1024, height: 800 })
  await sleep(300)
  await page.screenshot({ path: OUT + '/shots/simplified-1024.png', fullPage: true })
  const health = await page.evaluate(() => {
    const el = document.querySelector('#chart') as HTMLElement
    return { chartW: el?.clientWidth || 0, chartH: el?.clientHeight || 0 }
  })
  const ok = info.count > 0 && health.chartW > 400 && health.chartH > 300 && !errors.length
  report += '- simplified trades: ' + info.count + '\n'
  report += '- outcomes: ' + JSON.stringify(info.byOutcome) + '\n'
  report += '- time-stop trade rendered: ' + (landedTime ? 'YES (simplified-time.png)' : 'none in fixture window') + '\n'
  if (landedTime) report += '- time-stop status line: ' + statusText + '\n'
  report += '- chart health: ' + JSON.stringify(health) + '\n'
  report += '- responsive shots: simplified-1600 / 1180 / 1024\n'
  report += '- unexpected errors: ' + errors.length + '\n'
  if (errors.length) report += '\n## Errors\n' + errors.map((x) => '- ' + x).join('\n') + '\n'
  if (!ok) process.exitCode = 1
} catch (e) {
  report += '- fatal: ' + String(e) + '\n'
  process.exitCode = 1
} finally {
  try { await browser?.close() } catch {}
  if (server?.pid) { try { process.kill(-server.pid, 'SIGTERM') } catch {} await sleep(500); try { process.kill(-server.pid, 'SIGKILL') } catch {} }
  await writeFile(OUT + '/redesign-qa.md', report)
  console.log(report)
}
if (process.exitCode && process.exitCode !== 0) throw new Error('redesign QA failed; source not committed')

// 4) Возврат CI в обычный gate и коммит исходников.
await writeFile('ci/task.json', JSON.stringify({ task: 'gate', script: '', args: [], needsPlaywright: false, runLabel: 'gate' }, null, 2) + '\n')
const git = (args: string[]) => execFileSync('git', args, { stdio: 'inherit' })
git(['config', 'user.name', 'github-actions[bot]'])
git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'])
git(['add', cp, 'ci/task.json'])
git(['commit', '-m', 'feat(viz): render post-partial time-stop; reset CI to gate [skip ci]'])
git(['push', 'origin', 'HEAD:apex-reversal-v1'])
