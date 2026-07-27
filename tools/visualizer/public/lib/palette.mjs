// lib/palette.mjs — командная палитра (Cmd/Ctrl+K): загрузка, символы, ТФ, панели,
// экспорт, пресеты. Фильтр по подстроке, ↑↓ — навигация, Enter — выполнить, Esc — закрыть.

import { $, esc } from './format.mjs'
import { listPresets, applyPreset } from '../panels/config.mjs'

let commands = []
let filtered = []
let active = 0
let symbols = []

export function setPaletteSymbols(list) { symbols = list.slice(0, 30) }

function buildCommands() {
	const cmd = (group, title, run, hint = '') => ({ group, title, run, hint })
	const out = [
		cmd('Данные', 'Загрузить данные', () => document.dispatchEvent(new CustomEvent('viz:reload')), 'Enter'),
		cmd('Данные', 'Случайный исторический период', () => $('randomPeriod').click()),
		...['15m', '30m', '1h', '4h', '1d', '1w'].map((tf) => cmd('Таймфрейм', `ТФ ${tf}`, () => {
			document.querySelector(`#tfGroup [data-tf="${tf}"]`)?.click()
		})),
		cmd('Панели', 'Зоны ликвидности (POI)', () => $('poiZoneToggle').click()),
		cmd('Панели', 'Подтверждение 4h→15m', () => $('confToggle').click()),
		cmd('Панели', 'Decision Lab', () => $('labToggle').click()),
		cmd('Панели', 'Heatmap: показать/скрыть', () => $('hmToggle').click()),
		cmd('Экспорт', 'Экспорт зон в JSON', () => $('poiZoneExport').click()),
		cmd('Экспорт', 'Экспорт подтверждения в JSON', () => $('confExport').click()),
		cmd('Настройки', 'Пересчитать с конфигами движков', () => $('cfgApply').click()),
		cmd('Настройки', 'Сбросить конфиги движков', () => $('cfgReset').click()),
		...listPresets().map((n) => cmd('Пресеты', `Применить пресет «${n}»`, () => { applyPreset(n); document.dispatchEvent(new CustomEvent('viz:redraw')) })),
		...symbols.map((s) => cmd('Символ', s, () => { $('symbol').value = s; document.dispatchEvent(new CustomEvent('viz:reload')) })),
	]
	return out
}

function render() {
	const box = $('paletteList')
	if (!filtered.length) { box.innerHTML = '<div class="palette-empty">Ничего не найдено</div>'; return }
	let lastGroup = ''
	box.innerHTML = filtered.map((c, i) => {
		const head = c.group !== lastGroup ? `<div class="palette-group">${esc(c.group)}</div>` : ''
		lastGroup = c.group
		return `${head}<div class="palette-item${i === active ? ' active' : ''}" data-i="${i}"><span>${esc(c.title)}</span>${c.hint ? `<kbd>${esc(c.hint)}</kbd>` : ''}</div>`
	}).join('')
	box.querySelectorAll('.palette-item').forEach((el) => {
		// Ховер меняет только классы (перерисовка DOM под курсором глотала клик),
		// выбор — по mousedown, чтобы не потерять фокус инпута до срабатывания.
		el.onmouseenter = () => {
			box.querySelector('.palette-item.active')?.classList.remove('active')
			active = Number(el.dataset.i)
			el.classList.add('active')
		}
		el.onmousedown = (e) => { e.preventDefault(); run(Number(el.dataset.i)) }
	})
}

function scrollActive() {
	document.querySelector('#paletteList .palette-item.active')?.scrollIntoView({ block: 'nearest' })
}

function filter() {
	const q = $('paletteInput').value.trim().toLowerCase()
	const all = buildCommands()
	filtered = q ? all.filter((c) => (c.group + ' ' + c.title).toLowerCase().includes(q)) : all
	active = 0
	render()
}

function run(i) {
	const c = filtered[i]
	if (!c) return
	closePalette()
	c.run()
}

export function openPalette() {
	$('palette').classList.remove('hidden')
	$('paletteInput').value = ''
	filter()
	$('paletteInput').focus()
}
export function closePalette() { $('palette').classList.add('hidden') }
export const paletteOpen = () => !$('palette').classList.contains('hidden')

export function wirePalette() {
	$('paletteHint').onclick = openPalette
	$('paletteBackdrop').onclick = closePalette
	$('paletteInput').oninput = filter
	$('paletteInput').onkeydown = (e) => {
		if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(filtered.length - 1, active + 1); render(); scrollActive() }
		else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); scrollActive() }
		else if (e.key === 'Enter') { e.preventDefault(); run(active) }
		else if (e.key === 'Escape') closePalette()
	}
}
