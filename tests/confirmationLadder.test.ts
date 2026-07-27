import assert from 'node:assert/strict'
import { it } from 'node:test'
import { CONFIRMATION_TF, TF_MS } from '../tools/shared/candleFetcher.js'

it('§14.1: лестница «ТФ зоны → ТФ уточнённого подтверждения» — 1d→1h, 4h→15m, 1h→5m; прочие ТФ зон не строят', () => {
	assert.equal(CONFIRMATION_TF['1d'], '1h')
	assert.equal(CONFIRMATION_TF['4h'], '15m')
	assert.equal(CONFIRMATION_TF['1h'], '5m')
	assert.equal(CONFIRMATION_TF['1w'], undefined) // отложена решением пользователя (недельных баров ~360)
	assert.equal(CONFIRMATION_TF['15m'], undefined)
	// каждая связка ссылается на реальные ТФ
	for (const [zone, conf] of Object.entries(CONFIRMATION_TF)) {
		assert.ok(TF_MS[zone] && TF_MS[conf], `${zone}→${conf}`)
		assert.ok(TF_MS[zone]! > TF_MS[conf]!, 'подтверждение всегда младше зоны')
	}
})
