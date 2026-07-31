// redesignShots.ts — QA + скриншоты двух скинов визуализатора (redesign/terminal-ui).
// Classic (index.html) и Terminal (terminal.html): пустой стейт, загрузка fixture,
// вкладки дока/низа, режим зон, дубли id, консольные ошибки, адаптив 1180.
// Запуск: npx tsx ci/research/redesignShots.ts (порт VIZ_PORT=7799, вывод в ci-results/redesign).
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const OUT = process.env.OUT_DIR ?? 'ci-results/redesign'
mkdirSync(`${OUT}`, { recursive: true })
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
try { await import('playwright') } catch {
	execFileSync(NPM, ['install', '--no-save', '--no-audit', '--no-fund', 'playwright'], { stdio: 'inherit', shell: process.platform === 'win32' })
}
const { chromium } = await import('playwright')

const BASE = 'http://127.0.0.1:7799'
let server: ChildProcess | null = null
let browser: any = null
let report = '# Redesign QA — classic polish + terminal skin\n\n'
const errors: string[] = []
const sleep = (n: number) => new Promise((r) => setTimeout(r, n))

async function waitServer(log: () => string) {
	for (let i = 0; i < 60; i++) {
		try { if ((await fetch(BASE)).ok) return } catch { /* ещё не поднялся */ }
		await sleep(500)
	}
	throw Error('server timeout\n' + log())
}

function wirePageWatch(page: any, tag: string) {
	page.on('response', (r: any) => { if (r.status() >= 400 && !r.url().includes('/api/symbols')) errors.push(`${tag} http ${r.status()}: ${r.url()}`) })
	page.on('console', (m: any) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(`${tag} console: ${m.text()}`) })
	page.on('pageerror', (e: any) => errors.push(`${tag} page: ${e.message}`))
}

async function duplicateIds(page: any) {
	return page.evaluate(() => {
		const m = new Map<string, number>()
		document.querySelectorAll('[id]').forEach((e) => m.set(e.id, (m.get(e.id) || 0) + 1))
		return [...m].filter(([, n]) => n > 1).map(([id]) => id)
	})
}

async function loadFixture(page: any) {
	await page.waitForFunction(() => (document.querySelector('#loading') as HTMLElement)?.classList.contains('hidden'), null, { timeout: 60000 })
	await sleep(700) // перерисовка панелей/легенды после загрузки
}

try {
	let serverLog = ''
	// node + tsx CLI напрямую: на Windows spawn .cmd без shell падает с EINVAL (CVE-2024-27980).
	server = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'tools/visualizer/server.ts'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, VIZ_PORT: '7799' } })
	server.stdout?.on('data', (x) => (serverLog += x))
	server.stderr?.on('data', (x) => (serverLog += x))
	await waitServer(() => serverLog)

	browser = await chromium.launch({ headless: true })

	// ---- Classic ----
	const classic = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
	wirePageWatch(classic, 'classic')
	await classic.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' })
	await sleep(600)
	await classic.screenshot({ path: `${OUT}/classic-empty-1600.png` })
	await classic.selectOption('#source', 'fixture')
	await classic.click('#loadBtn')
	await loadFixture(classic)
	const classicEmptyHidden = await classic.evaluate(() => document.querySelector('#chartEmpty')?.classList.contains('hidden'))
	await classic.screenshot({ path: `${OUT}/classic-loaded-1600.png`, fullPage: true })
	const classicDups = await duplicateIds(classic)
	const classicSwitch = await classic.evaluate(() => !!document.querySelector('#apexChkWrap.switch .knob'))
	await classic.close()

	// ---- Terminal ----
	const tv = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
	wirePageWatch(tv, 'terminal')
	await tv.goto(`${BASE}/terminal.html`, { waitUntil: 'domcontentloaded' })
	await sleep(600)
	await tv.screenshot({ path: `${OUT}/terminal-empty-1600.png` })
	// Поповер «Данные» → fixture → загрузить.
	await tv.click('#tvDataBtn')
	await tv.selectOption('#source', 'fixture')
	await tv.click('#tvDataBtn') // закрыть поповер
	await tv.click('#loadBtn')
	await loadFixture(tv)
	const tvDups = await duplicateIds(tv)
	const tvEmptyHidden = await tv.evaluate(() => document.querySelector('#chartEmpty')?.classList.contains('hidden'))
	const tvChartBg = await tv.evaluate(() => (window as any).__VIZ_CHART_THEME__?.bg ?? null)
	await tv.screenshot({ path: `${OUT}/terminal-loaded-1600.png` })
	// Вкладка «Обзор» (низ).
	await tv.click('#tvBottomTabs [data-btab="overview"]')
	await sleep(400)
	await tv.screenshot({ path: `${OUT}/terminal-overview-1600.png` })
	// Вкладка «Индик.» (док).
	await tv.click('#tvBottomTabs [data-btab="trades"]')
	await tv.click('#tvDockTabs [data-tab="ind"]')
	await sleep(400)
	await tv.screenshot({ path: `${OUT}/terminal-indicators-1600.png` })
	// Режим зон через рэйл.
	await tv.click('#tvRail [data-rail="zones"]')
	await sleep(900)
	const zonesModeOn = await tv.evaluate(() => !document.querySelector('#poiZoneControls')?.classList.contains('hidden'))
	const zonesTabSynced = await tv.evaluate(() => (document.querySelector('#tvDockTabs [data-tab="zones"]') as HTMLElement)?.classList.contains('active'))
	await tv.screenshot({ path: `${OUT}/terminal-zones-1600.png` })
	// Heatmap поверх зон выключить обратно в боевой вид + свернуть док (рэйл panel).
	await tv.click('#tvRail [data-rail="panel"]')
	await sleep(400)
	const dockCollapsed = await tv.evaluate(() => document.querySelector('#tvDock')?.classList.contains('collapsed'))
	await tv.click('#tvRail [data-rail="panel"]')
	// Адаптив 1180.
	await tv.setViewportSize({ width: 1180, height: 900 })
	await sleep(400)
	await tv.screenshot({ path: `${OUT}/terminal-1180.png` })
	const tvConfVisible = await tv.evaluate(() => !!document.querySelector('#confPanel'))
	await tv.close()

	report += [
		`- classic duplicate ids: ${classicDups.length ? JSON.stringify(classicDups) : '0'}`,
		`- classic empty-state hidden after load: ${classicEmptyHidden ? 'PASS' : 'FAIL'}`,
		`- classic indicator switches: ${classicSwitch ? 'PASS' : 'FAIL'}`,
		`- terminal duplicate ids: ${tvDups.length ? JSON.stringify(tvDups) : '0'}`,
		`- terminal empty-state hidden after load: ${tvEmptyHidden ? 'PASS' : 'FAIL'}`,
		`- terminal chart theme hook: ${tvChartBg === '#131722' ? 'PASS' : `FAIL (${tvChartBg})`}`,
		`- terminal zones mode via rail: ${zonesModeOn ? 'PASS' : 'FAIL'}`,
		`- terminal dock tab synced to zones: ${zonesTabSynced ? 'PASS' : 'FAIL'}`,
		`- terminal dock collapse via rail: ${dockCollapsed ? 'PASS' : 'FAIL'}`,
		`- terminal conf panel present: ${tvConfVisible ? 'PASS' : 'FAIL'}`,
		`- console/page/http errors: ${errors.length}`,
		'',
	].join('\n')
	if (errors.length) report += '\n## Errors\n' + errors.map((x) => `- ${x}`).join('\n') + '\n'
	const fail = classicDups.length || tvDups.length || !classicEmptyHidden || !classicSwitch || !tvEmptyHidden || tvChartBg !== '#131722' || !zonesModeOn || !zonesTabSynced || !dockCollapsed || errors.length
	if (fail) process.exitCode = 1
} catch (e) {
	report += `- fatal: ${String(e)}\n`
	process.exitCode = 1
} finally {
	try { await browser?.close() } catch { /* уже закрыт */ }
	if (server?.pid) {
		try { execFileSync('taskkill', ['/F', '/T', '/PID', String(server.pid)]) } catch { /* процесс уже ушёл */ }
	}
	writeFileSync(`${OUT}/qa.md`, report)
	console.log(report)
}
