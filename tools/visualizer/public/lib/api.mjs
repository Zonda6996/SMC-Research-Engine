// lib/api.mjs — общение с сервером визуализатора.

import { $ } from './format.mjs'
import { engineOverrides } from '../panels/config.mjs'

export async function fetchAnalyze() {
	const symbol = $('symbol').value.trim() || 'BTC/USDT'
	const timeframe = document.querySelector('#tfGroup .active')?.dataset.tf || '4h'
	const limit = Number($('limit').value) || 5000
	const source = $('source').value
	const until = $('historyUntil').value
	const q = new URLSearchParams({
		symbol, timeframe, limit: String(limit), source,
		contextTf: $('labContext').value, historyBars: $('labHistory').value,
	})
	if (until) q.set('until', until)
	const ov = engineOverrides()
	if (Object.keys(ov.poi).length) q.set('poiConfig', JSON.stringify(ov.poi))
	if (Object.keys(ov.hm).length) q.set('hmConfig', JSON.stringify(ov.hm))
	if (Object.keys(ov.conf).length) q.set('confConfig', JSON.stringify(ov.conf))
	const r = await fetch(`/api/analyze?${q}`)
	const json = await r.json()
	if (json.error) throw new Error(json.error)
	return json
}

export async function fetchSymbols() {
	try {
		const r = await fetch('/api/symbols')
		const x = await r.json()
		return x.symbols ?? []
	} catch { return [] }
}
